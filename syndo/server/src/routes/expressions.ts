import type { FastifyInstance, FastifyRequest } from "fastify";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { ChannelType, EXPRESSION_LIMITS, P, emojiUrl, has, type Emoji, type SoundboardSound } from "@syndo/shared";
import { requireUser, uid } from "../auth.ts";
import { q, q1 } from "../db.ts";
import { bad, forbidden, notFound } from "../errors.ts";
import { toUsers, voiceStateOf, voiceStates } from "../gateway.ts";
import { newId } from "../ids.ts";
import { requireChannel, requireGuild } from "../perms.ts";
import { mediaUrl } from "../serialize.ts";
import * as storage from "../storage.ts";
import { readImage } from "../uploads.ts";
import { audit, resyncGuild } from "./guilds.ts";

/**
 * Server expressions: custom emoji and soundboard sounds (MANAGE_EXPRESSIONS to upload/edit),
 * playing a sound into a voice channel (USE_SOUNDBOARD, must be in that channel), and banner
 * art for categories (MANAGE_CHANNELS).
 *
 * Sounds are played by each listener's client (not mixed into anyone's microphone), so deafened
 * people never hear them and everyone can turn the soundboard down locally.
 */
const EMOJI_NAME = z.string().regex(/^[A-Za-z0-9_]{2,32}$/, "Emoji names are 2–32 letters, numbers or underscores.");
const AUDIO: Record<string, string> = { "audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav", "audio/vnd.wave": "wav", "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "m4a" };

export const emojiOut = (r: any): Emoji => ({ id: String(r.id), guild_id: String(r.guild_id), name: r.name, animated: !!r.animated, url: emojiUrl(String(r.id)), creator_id: r.creator_id ? String(r.creator_id) : null });
export const soundOut = (r: any): SoundboardSound => ({ id: String(r.id), guild_id: String(r.guild_id), name: r.name, emoji: r.emoji ?? null, volume: Number(r.volume), url: mediaUrl(r.storage_key)!, duration_ms: r.duration_ms, creator_id: r.creator_id ? String(r.creator_id) : null });

export async function guildExpressions(guildId: string) {
  const [emojis, sounds] = await Promise.all([
    q<any>("select * from guild_emojis where guild_id = $1 order by name", [guildId]),
    q<any>("select * from guild_sounds where guild_id = $1 order by created_at", [guildId]),
  ]);
  return { emojis: emojis.map(emojiOut), sounds: sounds.map(soundOut) };
}

async function readSound(req: FastifyRequest) {
  const file = await req.file({ limits: { fileSize: EXPRESSION_LIMITS.soundBytes, files: 1 } });
  if (!file) throw bad("Attach a sound.");
  const tooBig = () => bad(`Sounds can be up to ${EXPRESSION_LIMITS.soundBytes / 1024} KB.`, "too_large");
  const buf = await file.toBuffer().catch(() => { throw tooBig(); });
  if (file.file.truncated) throw tooBig();
  const t = await fileTypeFromBuffer(buf);
  const ext = t && AUDIO[t.mime];
  if (!ext) throw bad("Use an MP3, OGG, WAV, WebM or M4A sound.", "bad_type");
  return { buf, ext };
}

const lastPlay = new Map<string, number>();

export async function expressionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /* --------------------------------------------------------------- emoji -- */
  app.get<{ Params: { id: string } }>("/api/emojis/:id", async (req, reply) => {
    if (!/^\d{1,20}$/.test(req.params.id)) throw notFound("Emoji");
    const e = await q1<any>("select storage_key from guild_emojis where id = $1", [req.params.id]);
    if (!e) throw notFound("Emoji");
    reply.header("cache-control", "public, max-age=86400");
    return reply.redirect(mediaUrl(e.storage_key)!, 302);
  });

  app.post<{ Params: { id: string }; Querystring: { name?: string } }>("/api/guilds/:id/emojis", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_EXPRESSIONS);
    const name = EMOJI_NAME.parse(req.query.name ?? "");
    const n = await q1<any>("select count(*)::int as n from guild_emojis where guild_id = $1", [guild.id]);
    if (n.n >= EXPRESSION_LIMITS.emojis) throw bad(`A server can have up to ${EXPRESSION_LIMITS.emojis} emoji.`);
    if (await q1("select 1 from guild_emojis where guild_id = $1 and name = $2", [guild.id, name])) throw bad(`There's already an emoji called :${name}:.`);
    const img = await readImage(req, EXPRESSION_LIMITS.emojiBytes);
    const id = newId(), key = `emoji/${guild.id}/${id}.${img.ext}`;
    await storage.put(key, img.buf);
    const row = await q1<any>("insert into guild_emojis(id, guild_id, name, animated, storage_key, creator_id) values ($1,$2,$3,$4,$5,$6) returning *", [id, guild.id, name, img.animated, key, uid(req)]);
    await audit(guild.id, uid(req), "emoji_create", id, { name });
    await resyncGuild(guild.id);
    return emojiOut(row);
  });

  app.patch<{ Params: { id: string; eid: string } }>("/api/guilds/:id/emojis/:eid", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_EXPRESSIONS);
    const { name } = z.object({ name: EMOJI_NAME }).strict().parse(req.body);
    const clash = await q1("select 1 from guild_emojis where guild_id = $1 and name = $2 and id <> $3", [guild.id, name, req.params.eid]);
    if (clash) throw bad(`There's already an emoji called :${name}:.`);
    const row = await q1<any>("update guild_emojis set name = $3 where id = $2 and guild_id = $1 returning *", [guild.id, req.params.eid, name]);
    if (!row) throw notFound("Emoji");
    await audit(guild.id, uid(req), "emoji_update", row.id, { name });
    await resyncGuild(guild.id);
    return emojiOut(row);
  });

  app.delete<{ Params: { id: string; eid: string } }>("/api/guilds/:id/emojis/:eid", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_EXPRESSIONS);
    const row = await q1<any>("delete from guild_emojis where id = $2 and guild_id = $1 returning *", [guild.id, req.params.eid]);
    if (!row) throw notFound("Emoji");
    await storage.remove(row.storage_key).catch(() => {});
    await audit(guild.id, uid(req), "emoji_delete", row.id, { name: row.name });
    await resyncGuild(guild.id);
    return { ok: true };
  });

  /* ---------------------------------------------------------- soundboard -- */
  const SoundMeta = z.object({
    name: z.string().trim().min(1).max(32),
    emoji: z.string().trim().max(64).optional().transform((v) => v || null),
    volume: z.coerce.number().min(0).max(1).default(1),
    duration_ms: z.coerce.number().int().min(1).max(EXPRESSION_LIMITS.soundMs),
  });

  app.post<{ Params: { id: string }; Querystring: Record<string, string> }>("/api/guilds/:id/soundboard", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_EXPRESSIONS);
    const meta = SoundMeta.parse(req.query);
    const n = await q1<any>("select count(*)::int as n from guild_sounds where guild_id = $1", [guild.id]);
    if (n.n >= EXPRESSION_LIMITS.sounds) throw bad(`A server can have up to ${EXPRESSION_LIMITS.sounds} sounds.`);
    const snd = await readSound(req);
    const id = newId(), key = `sounds/${guild.id}/${id}.${snd.ext}`;
    await storage.put(key, snd.buf);
    const row = await q1<any>("insert into guild_sounds(id, guild_id, name, emoji, volume, storage_key, duration_ms, creator_id) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *",
      [id, guild.id, meta.name, meta.emoji, meta.volume, key, meta.duration_ms, uid(req)]);
    await audit(guild.id, uid(req), "sound_create", id, { name: meta.name });
    await resyncGuild(guild.id);
    return soundOut(row);
  });

  app.patch<{ Params: { id: string; sid: string } }>("/api/guilds/:id/soundboard/:sid", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_EXPRESSIONS);
    const b = z.object({ name: z.string().trim().min(1).max(32).optional(), emoji: z.string().trim().max(64).nullable().optional(), volume: z.number().min(0).max(1).optional() }).strict().parse(req.body);
    const sets = Object.entries(b).filter(([, v]) => v !== undefined);
    const row = sets.length
      ? await q1<any>(`update guild_sounds set ${sets.map(([k], i) => `${k} = $${i + 3}`).join(", ")} where id = $2 and guild_id = $1 returning *`, [guild.id, req.params.sid, ...sets.map(([, v]) => (v === "" ? null : v))])
      : await q1<any>("select * from guild_sounds where id = $2 and guild_id = $1", [guild.id, req.params.sid]);
    if (!row) throw notFound("Sound");
    await audit(guild.id, uid(req), "sound_update", row.id, b);
    await resyncGuild(guild.id);
    return soundOut(row);
  });

  app.delete<{ Params: { id: string; sid: string } }>("/api/guilds/:id/soundboard/:sid", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_EXPRESSIONS);
    const row = await q1<any>("delete from guild_sounds where id = $2 and guild_id = $1 returning *", [guild.id, req.params.sid]);
    if (!row) throw notFound("Sound");
    await storage.remove(row.storage_key).catch(() => {});
    await audit(guild.id, uid(req), "sound_delete", row.id, { name: row.name });
    await resyncGuild(guild.id);
    return { ok: true };
  });

  /** Play a sound to everyone in the voice channel I'm in. */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/soundboard", async (req) => {
    const me = uid(req);
    const { sound_id } = z.object({ sound_id: z.string().regex(/^\d{1,20}$/) }).strict().parse(req.body);
    const { channel, perms } = await requireChannel(me, req.params.cid, P.CONNECT);
    if (channel.type !== ChannelType.VOICE && channel.type !== ChannelType.STAGE) throw bad("Sounds play in voice channels.");
    const v = voiceStateOf(me);
    if (!v || v.channel_id !== channel.id) throw bad("Join the voice channel to play sounds.");
    if (!has(perms, P.USE_SOUNDBOARD) || !has(perms, P.SPEAK) || v.server_mute) throw forbidden("You can't use the soundboard here.");
    const now = Date.now();
    if (now - (lastPlay.get(me) ?? 0) < 1500) throw bad("Slow down a little.", "rate_limited");
    lastPlay.set(me, now);
    const s = await q1<any>("select * from guild_sounds where id = $1", [sound_id]);
    if (!s) throw notFound("Sound");
    if (String(s.guild_id) !== String(channel.guild_id)) {
      // Sounds from another server: the player must be a member there, with USE_EXTERNAL_SOUNDS (shares the emoji permission).
      if (!has(perms, P.USE_EXTERNAL_EMOJIS)) throw forbidden("You can't use other servers' sounds here.");
      await requireGuild(me, String(s.guild_id));
    }
    const listeners = voiceStates().filter((x) => x.channel_id === channel.id).map((x) => x.user_id);
    toUsers(listeners, "SOUNDBOARD_PLAY", { channel_id: channel.id, user_id: me, sound: soundOut(s) });
    return { ok: true };
  });

  /* ------------------------------------------------------ channel banner -- */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/banner", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_CHANNELS);
    if (!channel.guild_id) throw bad("Only server channels have banners.");
    const img = await readImage(req, 4 * 1024 * 1024);
    const key = `channel-banners/${channel.guild_id}/${newId()}.${img.ext}`;
    await storage.put(key, img.buf);
    const old = (channel as any).banner_key as string | null;
    await q("update channels set banner_key = $2 where id = $1", [channel.id, key]);
    if (old) await storage.remove(old).catch(() => {});
    await audit(channel.guild_id, uid(req), "channel_banner_update", channel.id);
    await resyncGuild(channel.guild_id);
    return { url: mediaUrl(key) };
  });

  app.delete<{ Params: { cid: string } }>("/api/channels/:cid/banner", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_CHANNELS);
    if (!channel.guild_id) throw bad("Only server channels have banners.");
    const old = (channel as any).banner_key as string | null;
    await q("update channels set banner_key = null where id = $1", [channel.id]);
    if (old) await storage.remove(old).catch(() => {});
    await audit(channel.guild_id, uid(req), "channel_banner_remove", channel.id);
    await resyncGuild(channel.guild_id);
    return { ok: true };
  });
}
