import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChannelType, MessageType, P, has, isDmType, isVoiceType } from "@syndo/shared";
import { config } from "../config.ts";
import { q, q1 } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { ApiError, bad, forbidden } from "../errors.ts";
import { onVoiceChange, toChannel, voiceStates } from "../gateway.ts";
import { mediaConfigured, mintToken, roomName } from "../media.ts";
import { getChannel, requireChannel } from "../perms.ts";
import { createSystemMessage, messageById } from "./messages.ts";

/**
 * Voice/video/screen-share admission. The API decides *whether* someone may
 * join and *what* they may publish; the SFU enforces it through the token's
 * grants. Removing access later goes through media.ts (removeParticipant).
 */

/** DM / group-DM calls: ringing state and the call record in the conversation. */
interface Call { channelId: string; messageId: string; startedAt: number; ringing: Set<string>; joined: Set<string>; timer: NodeJS.Timeout | null }
const calls = new Map<string, Call>();
const RING_MS = 45_000;

async function publishCall(c: Call) {
  const ch = await getChannel(c.channelId);
  if (ch) await toChannel(ch, "CALL_UPDATE", { channel_id: c.channelId, message_id: c.messageId, ringing: [...c.ringing], started_at: c.startedAt });
}

async function finishCall(c: Call) {
  calls.delete(c.channelId);
  if (c.timer) clearTimeout(c.timer);
  const record = { state: c.joined.size > 1 ? "ended" : "missed", participants: [...c.joined], duration_s: Math.round((Date.now() - c.startedAt) / 1000) };
  await q("update messages set content = $2 where id = $1", [c.messageId, JSON.stringify(record)]);
  const ch = await getChannel(c.channelId);
  if (ch) {
    await toChannel(ch, "CALL_DELETE", { channel_id: c.channelId });
    const msg = await messageById(c.messageId, null);
    if (msg) { const { reactions: _r, ...rest } = msg; await toChannel(ch, "MESSAGE_UPDATE", rest); }
  }
}

onVoiceChange(async (userId, prev, next) => {
  if (next && calls.has(next.channel_id)) {
    const c = calls.get(next.channel_id)!;
    c.joined.add(userId);
    if (c.ringing.delete(userId)) await publishCall(c);
  }
  if (prev && (!next || next.channel_id !== prev.channel_id)) {
    const c = calls.get(prev.channel_id);
    if (c && !voiceStates().some((v) => v.channel_id === prev.channel_id)) await finishCall(c);
  }
});

export async function voiceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.post("/api/voice/token", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { channel_id } = z.object({ channel_id: z.string().regex(/^\d{1,20}$/) }).parse(req.body);
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, channel_id, P.CONNECT);
    if (!isVoiceType(channel.type) && !isDmType(channel.type)) throw bad("That isn't a voice channel.");
    if (!mediaConfigured() && !config.livekit.apiKey) throw new ApiError(503, "media_unavailable", "Voice and video aren't set up on this server yet. The operator needs to configure LiveKit (see DEPLOYMENT.md).");
    if (channel.user_limit > 0 && !has(perms, P.MOVE_MEMBERS)) {
      const inside = voiceStates().filter((v) => v.channel_id === channel.id && v.user_id !== me).length;
      if (inside >= channel.user_limit) throw forbidden("This voice channel is full.");
    }
    const member = channel.guild_id ? await q1<any>("select mute, deaf from members where guild_id = $1 and user_id = $2", [channel.guild_id, me]) : null;
    const u = await q1<any>("select username, display_name from users where id = $1", [me]);
    const speak = has(perms, P.SPEAK) && !member?.mute;
    const video = has(perms, P.VIDEO);
    const token = await mintToken({ userId: me, name: u.display_name || u.username, channelId: channel.id, speak, video });
    return {
      url: config.livekit.url, token, room: roomName(channel.id),
      grants: { speak, video, vad: has(perms, P.USE_VAD), priority: has(perms, P.PRIORITY_SPEAKER), soundboard: has(perms, P.USE_SOUNDBOARD) },
      channel: { id: channel.id, bitrate: channel.bitrate || 96000, user_limit: channel.user_limit },
      limits: { max_voice_bitrate_kbps: config.limits.max_voice_bitrate_kbps, max_stream_height: config.limits.max_stream_height, max_stream_fps: config.limits.max_stream_fps, max_stream_bitrate_kbps: config.limits.max_stream_bitrate_kbps },
    };
  });

  /** Start ringing the other people in a DM / group DM. */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/call", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const me = uid(req);
    const { channel } = await requireChannel(me, req.params.cid, P.CONNECT);
    if (channel.type !== ChannelType.DM && channel.type !== ChannelType.GROUP_DM) throw bad("Calls ring in DMs and group DMs.");
    let c = calls.get(channel.id);
    const others = (await q<{ user_id: string }>("select user_id::text from channel_recipients where channel_id = $1 and user_id <> $2", [channel.id, me])).map((r) => r.user_id);
    if (!c) {
      const msg = await createSystemMessage(channel.id, null, me, MessageType.CALL, JSON.stringify({ state: "ongoing" }));
      c = { channelId: channel.id, messageId: msg!.id, startedAt: Date.now(), ringing: new Set(), joined: new Set([me]), timer: null };
      calls.set(channel.id, c);
    }
    const inCall = new Set(voiceStates().filter((v) => v.channel_id === channel.id).map((v) => v.user_id));
    for (const o of others) if (!inCall.has(o)) c.ringing.add(o);
    if (c.timer) clearTimeout(c.timer);
    const call = c;
    c.timer = setTimeout(async () => {
      call.ringing.clear();
      await publishCall(call);
      if (!voiceStates().some((v) => v.channel_id === call.channelId && v.user_id !== me)) {
        if (!voiceStates().some((v) => v.channel_id === call.channelId)) await finishCall(call);
      }
    }, RING_MS);
    c.timer.unref?.();
    await publishCall(c);
    return { message_id: c.messageId, ringing: [...c.ringing] };
  });

  /** Decline (callee) or stop ringing (caller cancels). */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/call/decline", async (req) => {
    const me = uid(req);
    await requireChannel(me, req.params.cid);
    const c = calls.get(req.params.cid);
    if (!c) return { ok: true };
    if (c.joined.has(me) && !voiceStates().some((v) => v.channel_id === c.channelId && v.user_id !== me)) {
      c.ringing.clear(); // caller cancelled
    } else c.ringing.delete(me);
    await publishCall(c);
    if (!voiceStates().some((v) => v.channel_id === c.channelId)) await finishCall(c);
    return { ok: true };
  });

  app.get<{ Params: { cid: string } }>("/api/channels/:cid/call", async (req) => {
    await requireChannel(uid(req), req.params.cid);
    const c = calls.get(req.params.cid);
    return c ? { channel_id: c.channelId, message_id: c.messageId, ringing: [...c.ringing], started_at: c.startedAt } : null;
  });
}

export const activeCalls = () => [...calls.values()].map((c) => ({ channel_id: c.channelId, message_id: c.messageId, ringing: [...c.ringing], started_at: c.startedAt }));
