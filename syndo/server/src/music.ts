import { createReadStream, existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MessageType, P, has, isVoiceType } from "@send/shared";
import { q1 } from "./db.ts";
import { newId } from "./ids.ts";
import { requireUser, uid } from "./auth.ts";
import { forbidden, notFound } from "./errors.ts";
import { onVoiceChange, toChannel, voiceStateOf, voiceStates } from "./gateway.ts";
import { getChannel, loadMember, guildPermData, permsFor, type ChanRow } from "./perms.ts";
import { allowedUrl, previewFor, safeStream } from "./unfurl.ts";

/**
 * SEND Music: a Rythm-style music bot for voice rooms.
 *
 * Someone in a voice room types `!play <song or link>` in any text chat of that server. The bot joins their
 * room and every client in the room plays the same track at the same position. SEND's voice is peer-to-peer
 * by default, so the server can't be a WebRTC peer; instead the server runs the player (queue, clock, timers)
 * and streams the audio to each listener through /api/music/stream/<token>, and clients stay in sync with the
 * server's clock. Listeners hear it locally, so it is never re-captured into anyone's microphone.
 *
 * Each voice room has its own queue. All changes to a room run one at a time (withRoom), so simultaneous
 * requests can't lose tracks or start two players. Tracks advance when they end; broken tracks are skipped
 * with a message; the bot leaves after MUSIC_IDLE_SECONDS with nobody in the room.
 *
 * Sources: Audius (open catalogue that permits third-party streaming, no key), direct https audio links
 * (validated: public address, audio content type), Jamendo when MUSIC_JAMENDO_CLIENT_ID is set, and two
 * built-in test tracks. YouTube, Spotify, Apple Music, SoundCloud, Deezer and Tidal links only give a title,
 * so the bot explains that and suggests a search instead of pretending to play them.
 */

const IDLE_MS = Math.max(10, Number(process.env.MUSIC_IDLE_SECONDS ?? 120)) * 1000;
const AUDIUS = (process.env.MUSIC_AUDIUS_HOST ?? "https://discoveryprovider.audius.co").replace(/\/$/, "");
const AUDIUS_APP = "SEND";
const JAMENDO_ID = process.env.MUSIC_JAMENDO_CLIENT_ID ?? "";
const MAX_QUEUE = 100;
const ASSETS = fileURLToPath(new URL("../assets/music/", import.meta.url));
const TEST_TRACKS = [
  { file: "send-test-a.mp3", title: "SEND Test Tone A", duration: 14 },
  { file: "send-test-b.mp3", title: "SEND Test Tone B", duration: 12 },
];

type Source = "test" | "audius" | "jamendo" | "link";
interface Track {
  id: string; token: string; title: string; artist: string | null; duration: number | null; source: Source; page: string | null;
  /** A file name in assets/music (test tracks) or an https URL. Never sent to clients. */
  upstream: string;
  requester: { id: string; name: string };
}
interface Room {
  channelId: string; guildId: string; textChannelId: string;
  queue: Track[]; current: Track | null;
  /** Server time (ms) at which the current track's position was 0. */
  startedAt: number; pausedAt: number | null;
  endTimer: NodeJS.Timeout | null; idleTimer: NodeJS.Timeout | null;
}
const rooms = new Map<string, Room>();
const locks = new Map<string, Promise<unknown>>();
const tokens = new Map<string, Track>();

/** Run fn with exclusive access to one room's state. */
function withRoom<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(channelId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(channelId, tail);
  void tail.then(() => { if (locks.get(channelId) === tail) locks.delete(channelId); });
  return run;
}

/* -------------------------------------------------------------------------------- bot user -- */
let botId: string | null = null;
export async function musicBotId(): Promise<string> {
  if (botId) return botId;
  const row = await q1<{ id: string }>("select id::text from users where username = 'sendmusic' and bot");
  if (row) return (botId = row.id);
  const id = newId();
  await q1("insert into users(id, username, display_name, bot) values ($1, 'sendmusic', 'SEND Music', true) on conflict do nothing", [id]);
  const again = await q1<{ id: string }>("select id::text from users where username = 'sendmusic' and bot");
  if (!again) throw new Error("SEND Music bot account could not be created (username taken).");
  return (botId = again.id);
}

/* -------------------------------------------------------------------------------- sources -- */
const fmt = (s: number | null) => s == null ? "?:??" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const METADATA_ONLY: [RegExp, string][] = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i, "YouTube"], [/(^|\.)spotify\.com$/i, "Spotify"], [/(^|\.)music\.apple\.com$/i, "Apple Music"],
  [/(^|\.)soundcloud\.com$/i, "SoundCloud"], [/(^|\.)deezer\.com$/i, "Deezer"], [/(^|\.)tidal\.com$/i, "Tidal"], [/(^|\.)bandcamp\.com$/i, "Bandcamp"],
];
type Resolved = { ok: true; track: Omit<Track, "id" | "token" | "requester"> } | { ok: false; message: string };

async function audiusJson(path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${AUDIUS}${path}${sep}app_name=${AUDIUS_APP}`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Audius ${r.status}`);
  return r.json();
}
const audiusTrack = (t: any): Resolved => ({
  ok: true, track: { title: String(t.title ?? "Untitled").slice(0, 200), artist: t.user?.name ? String(t.user.name).slice(0, 100) : null, duration: Number(t.duration) || null,
    source: "audius" as const, page: t.permalink ? `https://audius.co${t.permalink}` : null, upstream: `${AUDIUS}/v1/tracks/${encodeURIComponent(t.id)}/stream?app_name=${AUDIUS_APP}` },
});

async function searchAudius(query: string): Promise<Resolved | null> {
  const d = await audiusJson(`/v1/tracks/search?query=${encodeURIComponent(query)}&limit=10`);
  const t = (d.data ?? []).find((x: any) => x.is_streamable !== false && !x.is_delete && !x.stream_conditions);
  return t ? audiusTrack(t) : null;
}
async function searchJamendo(query: string): Promise<Resolved | null> {
  if (!JAMENDO_ID) return null;
  const r = await fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(JAMENDO_ID)}&format=json&limit=1&audioformat=mp32&search=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const t = ((await r.json()) as any).results?.[0];
  if (!t?.audio) return null;
  return { ok: true, track: { title: String(t.name).slice(0, 200), artist: t.artist_name ?? null, duration: Number(t.duration) || null, source: "jamendo", page: t.shareurl ?? null, upstream: t.audio } };
}

/** Check that a URL really serves audio before we queue it or play it. */
async function probe(url: string): Promise<{ ok: true; type: string } | { ok: false; reason: string }> {
  try {
    const res = await safeStream(url, { range: "bytes=0-1" });
    res.destroy();
    const status = res.statusCode ?? 0, type = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (status !== 200 && status !== 206) return { ok: false, reason: `the server answered ${status}` };
    if (!/^audio\//.test(type) && type !== "application/ogg") return { ok: false, reason: type ? `it's ${type}, not audio` : "it didn't say what it is" };
    return { ok: true, type };
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, reason: m === "url not allowed" || /blocked/.test(m) ? "that address isn't allowed" : "it couldn't be reached" };
  }
}

async function resolve(input: string): Promise<Resolved> {
  const text = input.trim().replace(/^<(.+)>$/, "$1");
  const test = /^test(?:\s*([12ab]))?$/i.exec(text);
  if (test) { const t = TEST_TRACKS[/[2b]/i.test(test[1] ?? "") ? 1 : 0]!; return { ok: true, track: { title: t.title, artist: "SEND", duration: t.duration, source: "test", page: null, upstream: t.file } }; }
  if (/^https?:\/\//i.test(text)) {
    let u: URL; try { u = new URL(text); } catch { return { ok: false, message: "That link isn't a valid address." }; }
    const meta = METADATA_ONLY.find(([re]) => re.test(u.hostname));
    if (meta) {
      const title = await previewFor(text).then((e) => e?.title ?? null).catch(() => null);
      return { ok: false, message: `That's a ${meta[1]} link${title ? ` (**${title}**)` : ""}. ${meta[1]} only shares the title and artwork, not audio SEND is allowed to stream, so I can't play it.${title ? ` Try \`!play ${title.slice(0, 80)}\` to search Audius instead.` : ""}` };
    }
    if (/(^|\.)audius\.co$/i.test(u.hostname)) {
      const d = await audiusJson(`/v1/resolve?url=${encodeURIComponent(text)}`).catch(() => null);
      const t = d?.data;
      if (t?.id && t.title) return t.is_streamable === false ? { ok: false, message: "That Audius track isn't available for streaming." } : audiusTrack(t);
      return { ok: false, message: "I couldn't find that Audius track. Only track links work (not playlists or profiles yet)." };
    }
    if (!allowedUrl(text) || u.protocol !== "https:") return { ok: false, message: "I can only play public https:// audio links." };
    const p = await probe(text);
    if (!p.ok) return { ok: false, message: `I can't play that link: ${p.reason}. Send a direct link to an audio file (mp3, ogg, opus, m4a, wav, flac) or search by name.` };
    const name = decodeURIComponent(u.pathname.split("/").pop() || u.hostname).replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 120) || u.hostname;
    return { ok: true, track: { title: name, artist: u.hostname, duration: null, source: "link", page: null, upstream: text } };
  }
  const hit = await searchAudius(text).catch((e) => { console.error("[music] audius", (e as Error).message); return null; }) ?? await searchJamendo(text).catch(() => null);
  return hit ?? { ok: false, message: `No playable results for **${text.slice(0, 100)}**.` };
}

/* --------------------------------------------------------------------------------- state -- */
const position = (r: Room) => r.current ? Math.max(0, (r.pausedAt ?? Date.now()) - r.startedAt) : 0;
const publicTrack = (t: Track) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, source: t.source, page: t.page, requester: t.requester, stream_url: `/api/music/stream/${t.token}` });
function stateOf(r: Room | undefined, channelId: string) {
  return { channel_id: channelId, guild_id: r?.guildId ?? null, bot_id: botId, active: !!r, playing: r?.current ? publicTrack(r.current) : null,
    paused: r?.pausedAt != null, position_ms: r ? position(r) : 0, server_time: Date.now(), queue: (r?.queue ?? []).map(publicTrack) };
}
async function broadcast(channelId: string) {
  const ch = await getChannel(channelId);
  if (ch) await toChannel(ch, "MUSIC_STATE", stateOf(rooms.get(channelId), channelId));
}
async function say(r: Room, content: string) {
  const ch = await getChannel(r.textChannelId);
  if (!ch) return;
  const bot = await musicBotId();
  const { createSystemMessage } = await import("./routes/messages.ts");
  await createSystemMessage(ch.id, ch.guild_id, bot, MessageType.DEFAULT, content);
}

function forget(t: Track) { tokens.delete(t.token); }
function clearTimer(r: Room) { if (r.endTimer) clearTimeout(r.endTimer); r.endTimer = null; }
function armTimer(r: Room) {
  clearTimer(r);
  if (!r.current || r.pausedAt != null || r.current.duration == null) return;
  const track = r.current;
  const left = track.duration! * 1000 - position(r) + 600;
  r.endTimer = setTimeout(() => { void withRoom(r.channelId, async () => { if (rooms.get(r.channelId) === r && r.current === track) await next(r, true); }); }, Math.max(0, left));
  r.endTimer.unref?.();
}

/** Start the next playable track (inside the room lock). Broken tracks are skipped with a message. */
async function next(r: Room, announce: boolean) {
  if (r.current) forget(r.current);
  r.current = null; r.pausedAt = null; clearTimer(r);
  while (r.queue.length) {
    const t = r.queue.shift()!;
    const check = t.source === "test" ? (existsSync(ASSETS + t.upstream) ? { ok: true as const } : { ok: false as const, reason: "the file is missing" }) : await probe(t.upstream);
    if (!check.ok) { forget(t); await say(r, `⚠️ Skipped **${t.title}** (requested by ${t.requester.name}): it couldn't be played, ${check.reason}.`); continue; }
    r.current = t; r.startedAt = Date.now();
    armTimer(r);
    if (announce) await say(r, `🎶 Now playing **${t.title}**${t.artist ? ` by ${t.artist}` : ""} \`${fmt(t.duration)}\`, requested by ${t.requester.name}.`);
    break;
  }
  if (!r.current) await say(r, "The queue is empty. Add more with `!play`, or I'll leave when the room is empty.").catch(() => {});
  await broadcast(r.channelId);
}

async function disconnect(r: Room, why: string | null) {
  clearTimer(r); if (r.idleTimer) clearTimeout(r.idleTimer);
  for (const t of [r.current, ...r.queue]) if (t) forget(t);
  rooms.delete(r.channelId);
  if (why) await say(r, why).catch(() => {});
  await broadcast(r.channelId);
}

const listeners = (channelId: string) => voiceStates().filter((v) => v.channel_id === channelId).length;
function checkIdle(r: Room) {
  if (listeners(r.channelId) > 0) { if (r.idleTimer) { clearTimeout(r.idleTimer); r.idleTimer = null; } return; }
  if (r.idleTimer) return;
  r.idleTimer = setTimeout(() => { void withRoom(r.channelId, async () => { if (rooms.get(r.channelId) === r && listeners(r.channelId) === 0) await disconnect(r, `👋 Left the voice room: nobody was listening for ${Math.round(IDLE_MS / 1000)} seconds.`); }); }, IDLE_MS);
  r.idleTimer.unref?.();
}


/* ------------------------------------------------------------------------------ commands -- */
const HELP = [
  "**SEND Music**: join a voice room, then type these in any text chat of this server:",
  "`!play <song name or link>`: play now, or add to the queue (`!p`)",
  "`!queue`: what's playing and what's next (`!q`)",
  "`!nowplaying`: the current track and progress (`!np`)",
  "`!pause`, `!resume`: pause and carry on",
  "`!skip`: next track (`!s`). Skipping someone else's track needs DJ rights.",
  "`!stop`: clear the queue and disconnect (needs DJ rights when others are listening)",
  "`!help`: this list",
  "",
  `**Sources**: song names are searched on Audius${JAMENDO_ID ? " and Jamendo" : ""}. Links: Audius tracks and direct https audio files (mp3, ogg, opus, m4a, wav, flac). \`!play test\` plays a built-in test track. YouTube, Spotify, Apple Music, SoundCloud, Deezer, Tidal and Bandcamp links only provide titles, so they can't be played.`,
  "**DJ rights**: a role named DJ, or Move Members or Manage Channels permission in the voice room.",
].join("\n");

async function isDj(userId: string, voice: ChanRow): Promise<boolean> {
  const perms = await permsFor(userId, voice);
  if (has(perms, P.MOVE_MEMBERS) || has(perms, P.MANAGE_CHANNELS)) return true;
  const [member, data] = await Promise.all([loadMember(voice.guild_id!, userId), guildPermData(voice.guild_id!)]);
  const dj = new Set(data?.roles.filter((r: any) => String(r.name).trim().toLowerCase() === "dj").map((r: any) => String(r.id)) ?? []);
  return !!member && ((member as any).roles ?? []).some((id: any) => dj.has(String(id)));
}

const COMMANDS: Record<string, string> = { play: "play", p: "play", queue: "queue", q: "queue", nowplaying: "np", np: "np", pause: "pause", resume: "resume", unpause: "resume", skip: "skip", s: "skip", next: "skip", stop: "stop", leave: "stop", disconnect: "stop", help: "help" };

/** Called after a message is posted in a server text chat. Returns true if it was a music command. */
export async function handleMusicCommand(text: ChanRow, userId: string, content: string): Promise<boolean> {
  const m = /^!([a-z]+)(?:\s+([\s\S]*))?$/i.exec(content.trim());
  const cmd = m && COMMANDS[m[1]!.toLowerCase()];
  if (!cmd || !text.guild_id) return false;
  const arg = (m![2] ?? "").trim().slice(0, 300);
  const reply = async (msg: string) => {
    const bot = await musicBotId();
    const { createSystemMessage } = await import("./routes/messages.ts");
    await createSystemMessage(text.id, text.guild_id, bot, MessageType.DEFAULT, msg);
  };
  try {
    if (cmd === "help") { await reply(HELP); return true; }
    const vs = voiceStateOf(userId);
    const voice = vs?.channel_id ? await getChannel(vs.channel_id) : null;
    if (!voice || voice.guild_id !== text.guild_id || !isVoiceType(voice.type)) {
      await reply(`<@${userId}> join a voice room in this server first, then use \`!${m![1]!.toLowerCase()}\` again.`);
      return true;
    }
    const user = await q1<any>("select username, display_name from users where id = $1", [userId]);
    const name = user?.display_name || user?.username || "someone";
    if (cmd === "play") {
      if (!arg) { await reply("Tell me what to play: `!play <song name or link>`. Try `!play test` for a test track."); return true; }
      const perms = await permsFor(userId, voice);
      if (!has(perms, P.CONNECT)) { await reply("You can't use music in this voice room."); return true; }
      const found = await resolve(arg);
      if (!found.ok) { await reply(found.message); return true; }
      await withRoom(voice.id, async () => {
        if (voiceStateOf(userId)?.channel_id !== voice.id) { await reply(`<@${userId}> you left the voice room, so I didn't add that.`); return; }
        let r = rooms.get(voice.id);
        if (!r) { r = { channelId: voice.id, guildId: voice.guild_id!, textChannelId: text.id, queue: [], current: null, startedAt: 0, pausedAt: null, endTimer: null, idleTimer: null }; rooms.set(voice.id, r); }
        r.textChannelId = text.id;
        if (r.queue.length >= MAX_QUEUE) { await reply(`The queue is full (${MAX_QUEUE} tracks).`); return; }
        const t: Track = { ...found.track, id: newId(), token: randomBytes(18).toString("base64url"), requester: { id: userId, name } };
        tokens.set(t.token, t);
        r.queue.push(t);
        const extra = t.source === "link" ? " Length shows once a listener's player reads the file." : "";
        if (!r.current) await next(r, true);
        else { await reply(`➕ Queued **${t.title}**${t.artist ? ` by ${t.artist}` : ""} \`${fmt(t.duration)}\` at position ${r.queue.length}, requested by ${name}.${extra}`); await broadcast(r.channelId); }
        checkIdle(r);
      });
      return true;
    }
    await withRoom(voice.id, async () => {
      const r = rooms.get(voice.id);
      if (!r || (!r.current && !r.queue.length)) { await reply(cmd === "stop" && r ? (await disconnect(r, null), "⏹️ Stopped and left the voice room.") : "Nothing is playing in your voice room. Start with `!play <song>`."); return; }
      switch (cmd) {
        case "queue": {
          const lines = [r.current ? `**Now playing:** ${r.current.title}${r.current.artist ? ` by ${r.current.artist}` : ""} \`${fmt(position(r) / 1000)} / ${fmt(r.current.duration)}\` (requested by ${r.current.requester.name})${r.pausedAt != null ? " ⏸️ paused" : ""}` : "**Now playing:** nothing"];
          if (r.queue.length) lines.push("**Up next:**", ...r.queue.slice(0, 15).map((t, i) => `${i + 1}. ${t.title}${t.artist ? ` by ${t.artist}` : ""} \`${fmt(t.duration)}\` (requested by ${t.requester.name})`));
          else lines.push("Nothing queued after this.");
          if (r.queue.length > 15) lines.push(`…and ${r.queue.length - 15} more.`);
          await reply(lines.join("\n")); break;
        }
        case "np": {
          const c = r.current!; const pos = position(r) / 1000;
          const bar = c.duration ? (() => { const n = Math.round(Math.min(1, pos / c.duration!) * 16); return "▬".repeat(n) + "🔘" + "▬".repeat(16 - n); })() : "";
          await reply(`🎶 **${c.title}**${c.artist ? ` by ${c.artist}` : ""}${c.page ? ` (<${c.page}>)` : ""}\n${bar} \`${fmt(pos)} / ${fmt(c.duration)}\`${r.pausedAt != null ? " ⏸️ paused" : ""}\nRequested by ${c.requester.name}`); break;
        }
        case "pause":
          if (r.pausedAt != null) { await reply("Already paused. `!resume` to carry on."); break; }
          r.pausedAt = Date.now(); clearTimer(r); await broadcast(r.channelId); await reply(`⏸️ Paused by ${name}.`); break;
        case "resume":
          if (r.pausedAt == null) { await reply("It's already playing."); break; }
          r.startedAt += Date.now() - r.pausedAt; r.pausedAt = null; armTimer(r); await broadcast(r.channelId); await reply(`▶️ Resumed by ${name}.`); break;
        case "skip": {
          const c = r.current;
          if (c && c.requester.id !== userId && listeners(voice.id) > 1 && !(await isDj(userId, voice))) { await reply(`Only ${c.requester.name} or someone with DJ rights can skip this track.`); break; }
          await reply(`⏭️ Skipped **${c?.title ?? "the track"}**.`);
          await next(r, true); break;
        }
        case "stop":
          if (listeners(voice.id) > 1 && !(await isDj(userId, voice))) { await reply("Stopping for everyone needs DJ rights (a DJ role, or Move Members). You can `!skip` your own tracks."); break; }
          await disconnect(r, `⏹️ Stopped by ${name}: cleared the queue and left the voice room.`); break;
      }
    });
  } catch (e) {
    console.error("[music]", e);
    await reply("Something went wrong with that music command. Try again in a moment.").catch(() => {});
  }
  return true;
}

/* -------------------------------------------------------------------------------- routes -- */
export async function musicRoutes(app: FastifyInstance) {
  // Leave rooms nobody is listening in (registered here, not at import time, to avoid an import cycle).
  onVoiceChange((_u, prev, next) => {
    for (const id of new Set([prev?.channel_id, next?.channel_id])) { const r = id ? rooms.get(id) : undefined; if (r) checkIdle(r); }
  });
  /** Current music state of a voice room (for people joining it). */
  app.get<{ Params: { cid: string } }>("/api/music/:cid", { preHandler: requireUser }, async (req) => {
    const ch = await getChannel(req.params.cid);
    if (!ch || !isVoiceType(ch.type)) throw notFound("Voice room");
    if (!has(await permsFor(uid(req), ch), P.VIEW_CHANNEL)) throw forbidden();
    await musicBotId();
    return stateOf(rooms.get(ch.id), ch.id);
  });

  /** A listener's player read the length of a track whose source didn't say. */
  app.post<{ Params: { cid: string } }>("/api/music/:cid/duration", { preHandler: requireUser }, async (req) => {
    const b = z.object({ track_id: z.string().max(24), duration: z.number().min(1).max(6 * 3600) }).parse(req.body);
    if (voiceStateOf(uid(req))?.channel_id !== req.params.cid) throw forbidden("Join the voice room first.");
    await withRoom(req.params.cid, async () => {
      const r = rooms.get(req.params.cid);
      if (r?.current?.id === b.track_id && r.current.duration == null) { r.current.duration = Math.round(b.duration); armTimer(r); await broadcast(r.channelId); }
    });
    return { ok: true };
  });

  /** A listener's player couldn't play the track: check it ourselves and skip it if it's really broken. */
  app.post<{ Params: { cid: string } }>("/api/music/:cid/error", { preHandler: requireUser }, async (req) => {
    const b = z.object({ track_id: z.string().max(24) }).parse(req.body);
    if (voiceStateOf(uid(req))?.channel_id !== req.params.cid) throw forbidden("Join the voice room first.");
    await withRoom(req.params.cid, async () => {
      const r = rooms.get(req.params.cid); const c = r?.current;
      if (!r || !c || c.id !== b.track_id || c.source === "test") return;
      const p = await probe(c.upstream);
      if (!p.ok) { await say(r, `⚠️ Skipped **${c.title}**: it stopped playing (${p.reason}).`); await next(r, true); }
    });
    return { ok: true };
  });

  /** The audio itself. The token is unguessable and only lives while the track is queued or playing. */
  app.get<{ Params: { token: string } }>("/api/music/stream/:token", async (req, reply) => {
    const t = tokens.get(req.params.token);
    if (!t) throw notFound("Track");
    const range = typeof req.headers.range === "string" && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;
    reply.header("cache-control", "no-store").header("x-content-type-options", "nosniff");
    if (t.source === "test") {
      const path = ASSETS + t.upstream, size = statSync(path).size;
      reply.header("accept-ranges", "bytes").type("audio/mpeg");
      const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
        if (start >= size || start > end) return reply.code(416).header("content-range", `bytes */${size}`).send();
        return reply.code(206).header("content-range", `bytes ${start}-${end}/${size}`).header("content-length", end - start + 1).send(createReadStream(path, { start, end }));
      }
      return reply.header("content-length", size).send(createReadStream(path));
    }
    let res;
    try { res = await safeStream(t.upstream, range ? { range } : {}); } catch { return reply.code(502).send({ message: "The music source couldn't be reached." }); }
    const status = res.statusCode ?? 502, type = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if ((status !== 200 && status !== 206) || (!/^audio\//.test(type) && type !== "application/ogg")) { res.destroy(); return reply.code(502).send({ message: "The music source didn't return audio." }); }
    reply.code(status).type(type);
    for (const h of ["content-length", "content-range", "accept-ranges"]) if (res.headers[h]) reply.header(h, res.headers[h] as string);
    req.raw.on("close", () => res.destroy());
    return reply.send(res);
  });
}

export const musicState = (channelId: string) => stateOf(rooms.get(channelId), channelId);
