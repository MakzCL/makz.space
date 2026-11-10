import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChannelType, MessageFlags, MessageType, P, has } from "@syndo/shared";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { bad, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { onVoiceChange, patchVoice, toChannel, toGuild, voiceStateOf, voiceStates } from "../gateway.ts";
import { restrictPublishing } from "../media.ts";
import { getChannel, permsFor, requireChannel } from "../perms.ts";
import { mediaUrl } from "../serialize.ts";
import * as storage from "../storage.ts";
import { createSystemMessage, messageById } from "./messages.ts";

/**
 * Stage channels: a live "stage instance" with a topic; everyone joins the audience,
 * raises a hand to speak, and stage moderators (Manage Channels + Mute Members + Move Members)
 * invite people up or move them back.
 *
 * Announcement channels: messages can be published to every channel that follows them
 * (in any server), arriving as a copy marked with the source server and channel.
 */

const ID = z.string().regex(/^\d{1,20}$/);
const MOD = P.MANAGE_CHANNELS | P.MUTE_MEMBERS | P.MOVE_MEMBERS;

async function stageOut(channelId: string) {
  return q1<any>("select channel_id::text, guild_id::text, topic, started_by::text, created_at from stage_instances where channel_id = $1", [channelId]);
}

export async function stageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  // A stage ends when everyone has left.
  onVoiceChange(async (_uid, prev) => {
    if (!prev?.channel_id || voiceStates().some((v) => v.channel_id === prev.channel_id)) return;
    const s = await q1<any>("delete from stage_instances where channel_id = $1 returning channel_id::text, guild_id::text", [prev.channel_id]);
    if (s) await toGuild(s.guild_id, "STAGE_INSTANCE_DELETE", { channel_id: s.channel_id, guild_id: s.guild_id });
  });

  app.post("/api/stage-instances", async (req) => {
    const me = uid(req);
    const b = z.object({ channel_id: ID, topic: z.string().trim().min(1).max(120), event_id: ID.optional(), notify: z.boolean().default(false) }).parse(req.body);
    const { channel, perms } = await requireChannel(me, b.channel_id);
    if (channel.type !== ChannelType.STAGE) throw bad("Not a stage channel.");
    if (!has(perms, MOD)) throw forbidden("Only stage moderators can start a stage.");
    if (await stageOut(channel.id)) throw bad("This stage is already live.");
    await q("insert into stage_instances(channel_id, guild_id, topic, started_by, event_id) values ($1,$2,$3,$4,$5)", [channel.id, channel.guild_id, b.topic, me, b.event_id ?? null]);
    if (b.event_id) await q("update guild_events set status = 2 where id = $1 and guild_id = $2 and status = 1", [b.event_id, channel.guild_id]);
    const s = await stageOut(channel.id);
    await toGuild(channel.guild_id!, "STAGE_INSTANCE_CREATE", s);
    // The person starting it becomes a speaker if they're in the channel.
    if (voiceStateOf(me)?.channel_id === channel.id) await patchVoice(me, { suppress: false, request_to_speak_at: null });
    await createSystemMessage(channel.id, channel.guild_id, me, MessageType.STAGE_START, b.topic);
    if (b.notify) {
      const { sendPush } = await import("../notify.ts");
      const members = (await q<any>("select user_id::text from members where guild_id = $1 and user_id <> $2 limit 5000", [channel.guild_id, me])).map((r) => r.user_id);
      await sendPush(members, JSON.stringify({ title: `Live on stage: ${b.topic}`, body: channel.name ?? "", tag: `stage-${channel.id}`, url: `/channels/${channel.guild_id}/${channel.id}` })).catch(() => {});
    }
    return s;
  });

  app.patch<{ Params: { cid: string } }>("/api/stage-instances/:cid", async (req) => {
    const { channel, perms } = await requireChannel(uid(req), req.params.cid);
    if (!has(perms, MOD)) throw forbidden("Only stage moderators can change the topic.");
    const { topic } = z.object({ topic: z.string().trim().min(1).max(120) }).parse(req.body);
    const r = await q1("update stage_instances set topic = $2 where channel_id = $1 returning 1", [channel.id, topic]);
    if (!r) throw notFound("Stage");
    const s = await stageOut(channel.id);
    await toGuild(channel.guild_id!, "STAGE_INSTANCE_UPDATE", s);
    await createSystemMessage(channel.id, channel.guild_id, uid(req), MessageType.STAGE_TOPIC, topic);
    return s;
  });

  app.delete<{ Params: { cid: string } }>("/api/stage-instances/:cid", async (req) => {
    const { channel, perms } = await requireChannel(uid(req), req.params.cid);
    if (!has(perms, MOD)) throw forbidden("Only stage moderators can end the stage.");
    const s = await q1<any>("delete from stage_instances where channel_id = $1 returning event_id", [channel.id]);
    if (!s) throw notFound("Stage");
    if (s.event_id) await q("update guild_events set status = 3 where id = $1 and status = 2", [s.event_id]);
    await toGuild(channel.guild_id!, "STAGE_INSTANCE_DELETE", { channel_id: channel.id, guild_id: channel.guild_id });
    for (const v of voiceStates().filter((v) => v.channel_id === channel.id)) await patchVoice(v.user_id, { suppress: true, request_to_speak_at: null });
    await createSystemMessage(channel.id, channel.guild_id, uid(req), MessageType.STAGE_END, "");
    return { ok: true };
  });

  /** Raise/lower my hand, or (moderators) become a speaker myself. */
  app.patch<{ Params: { cid: string } }>("/api/channels/:cid/voice-states/@me", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid);
    if (channel.type !== ChannelType.STAGE) throw bad("Not a stage channel.");
    if (voiceStateOf(me)?.channel_id !== channel.id) throw bad("Join the stage first.");
    const b = z.object({ request_to_speak: z.boolean().optional(), suppress: z.boolean().optional() }).parse(req.body);
    const patch: Record<string, unknown> = {};
    if (b.request_to_speak !== undefined) {
      if (b.request_to_speak && !has(perms, P.REQUEST_TO_SPEAK)) throw forbidden("Raising your hand is turned off here.");
      patch.request_to_speak_at = b.request_to_speak ? new Date().toISOString() : null;
    }
    if (b.suppress !== undefined) {
      if (b.suppress === false && !has(perms, MOD)) throw forbidden("Ask to speak instead.");
      patch.suppress = b.suppress;
      if (b.suppress === false) patch.request_to_speak_at = null;
    }
    const v = await patchVoice(me, patch);
    if (patch.suppress !== undefined) await restrictPublishing(channel.id, me, patch.suppress === false && has(perms, P.SPEAK), has(perms, P.VIDEO)).catch(() => {});
    return v;
  });

  /** Moderators: invite someone up (suppress=false) or move them back to the audience. */
  app.patch<{ Params: { cid: string; uid: string } }>("/api/channels/:cid/voice-states/:uid", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid);
    if (channel.type !== ChannelType.STAGE) throw bad("Not a stage channel.");
    if (!has(perms, MOD)) throw forbidden("Only stage moderators can do that.");
    if (voiceStateOf(req.params.uid)?.channel_id !== channel.id) throw notFound("Voice state");
    const { suppress } = z.object({ suppress: z.boolean() }).parse(req.body);
    const v = await patchVoice(req.params.uid, { suppress, request_to_speak_at: null });
    const theirs = await permsFor(req.params.uid, channel);
    await restrictPublishing(channel.id, req.params.uid, !suppress && has(theirs, P.SPEAK), has(theirs, P.VIDEO)).catch(() => {});
    if (!suppress) await createSystemMessage(channel.id, channel.guild_id, req.params.uid, MessageType.STAGE_SPEAKER, "");
    return v;
  });

  /* ------------------------------------------------- announcements -- */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/followers", async (req) => {
    const me = uid(req);
    const { channel: src } = await requireChannel(me, req.params.cid, P.READ_MESSAGE_HISTORY);
    if (src.type !== ChannelType.ANNOUNCEMENT) throw bad("Only announcement channels can be followed.");
    const { webhook_channel_id } = z.object({ webhook_channel_id: ID }).parse(req.body);
    const { channel: target } = await requireChannel(me, webhook_channel_id, P.MANAGE_WEBHOOKS);
    if (target.type !== ChannelType.TEXT && target.type !== ChannelType.ANNOUNCEMENT) throw bad("Pick a text channel to post into.");
    if (target.id === src.id) throw bad("A channel can't follow itself.");
    const n = await q1<any>("select count(*)::int as n from channel_follows where target_channel_id = $1", [target.id]);
    if (n.n >= 10) throw bad("A channel can follow up to 10 announcement channels.");
    const ins = await q1("insert into channel_follows(source_channel_id, target_channel_id, created_by) values ($1,$2,$3) on conflict do nothing returning 1", [src.id, target.id, me]);
    if (ins) {
      const g = await q1<any>("select name, icon_key from guilds where id = $1", [src.guild_id]);
      await q("insert into webhooks(id, guild_id, channel_id, creator_id, type, name, source_channel_id) values ($1,$2,$3,$4,2,$5,$6)",
        [newId(), target.guild_id, target.id, me, `${g?.name ?? "Server"} #${src.name}`.slice(0, 80), src.id]);
      await createSystemMessage(target.id, target.guild_id, me, MessageType.CHANNEL_FOLLOW_ADD, `${g?.name ?? "Server"} #${src.name}`);
    }
    return { channel_id: src.id, webhook_channel_id: target.id };
  });
  app.delete<{ Params: { cid: string; target: string } }>("/api/channels/:cid/followers/:target", async (req) => {
    const me = uid(req);
    await requireChannel(me, req.params.target, P.MANAGE_WEBHOOKS);
    await q("delete from channel_follows where source_channel_id = $1 and target_channel_id = $2", [req.params.cid, req.params.target]);
    await q("delete from webhooks where type = 2 and source_channel_id = $1 and channel_id = $2", [req.params.cid, req.params.target]);
    return { ok: true };
  });
  app.get<{ Params: { cid: string } }>("/api/channels/:cid/followers", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid);
    const n = await q1<any>("select count(*)::int as n from channel_follows where source_channel_id = $1", [channel.id]);
    return { count: n.n };
  });

  /** Publish an announcement to every following channel. */
  app.post<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/messages/:mid/crosspost", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid, P.SEND_MESSAGES);
    if (channel.type !== ChannelType.ANNOUNCEMENT) throw bad("Only announcement messages can be published.");
    const m = await q1<any>("select * from messages where id = $1 and channel_id = $2 and deleted_at is null", [req.params.mid, channel.id]);
    if (!m) throw notFound("Message");
    if (String(m.author_id) !== me && !has(perms, P.MANAGE_MESSAGES)) throw forbidden("You can only publish your own messages.");
    if (m.flags & MessageFlags.CROSSPOSTED) throw bad("Already published.");
    await q("update messages set flags = flags | 1 where id = $1", [m.id]);
    const g = await q1<any>("select id::text, name, icon_key from guilds where id = $1", [channel.guild_id]);
    const atts = await q<any>("select * from attachments where message_id = $1 order by id", [m.id]);
    const targets = await q<any>("select c.* from channel_follows f join channels c on c.id = f.target_channel_id where f.source_channel_id = $1", [channel.id]);
    const source = { guild_id: g.id, guild_name: g.name, channel_id: channel.id, channel_name: channel.name, message_id: String(m.id) };
    for (const t of targets) {
      const hook = await q1<any>("select id::text from webhooks where type = 2 and source_channel_id = $1 and channel_id = $2", [channel.id, t.id]);
      const id = newId();
      await tx(async (c) => {
        await c.query(`insert into messages(id, channel_id, guild_id, author_id, content, type, flags, source, webhook_id, webhook_name, webhook_avatar, embeds)
          values ($1,$2,$3,null,$4,0,2,$5,$6,$7,$8,$9)`, [id, t.id, t.guild_id, m.content, JSON.stringify(source), hook?.id ?? null, `${g.name} #${channel.name}`.slice(0, 80), mediaUrl(g.icon_key), m.embeds ? JSON.stringify(m.embeds) : null]);
        await c.query("update channels set last_message_id = $2 where id = $1", [t.id, id]);
      });
      for (const a of atts) {
        // Followers can't read the source channel, so each copy gets its own file.
        const nid = newId(), key = `att/g${t.guild_id}/c${t.id}/${nid}`;
        try {
          await storage.put(key, storage.open(a.storage_key) as any);
          await q(`insert into attachments(id, message_id, channel_id, uploader_id, filename, content_type, size, storage_key, width, height, duration, waveform)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [nid, id, t.id, a.uploader_id, a.filename, a.content_type, a.size, key, a.width, a.height, a.duration, a.waveform]);
        } catch (e) { console.error("[crosspost attachment]", e); }
      }
      const msg = await messageById(id, null);
      const tc = await getChannel(String(t.id));
      if (msg && tc) await toChannel(tc, "MESSAGE_CREATE", msg);
    }
    const msg = (await messageById(m.id, me))!;
    const { reactions: _r, ...rest } = msg;
    await toChannel(channel, "MESSAGE_UPDATE", rest);
    return msg;
  });
}
