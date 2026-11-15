import { createReadStream, existsSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MessageType, P, has, isVoiceType } from "@send/shared";
import { q1 } from "./db.ts";
import { newId } from "./ids.ts";
import { requireUser, uid } from "./auth.ts";
import { bad, forbidden, notFound } from "./errors.ts";
import { onVoiceChange, toChannel, voiceStateOf, voiceStates } from "./gateway.ts";
import { getChannel, loadMember, guildPermData, permsFor, type ChanRow } from "./perms.ts";
import { allowedUrl, previewFor, safeStream } from "./unfurl.ts";

/**
 * SEND Music: a Rythm-style music bot for voice rooms.
 *
 * Someone in a voice room types `/play <song or link>` in any text chat of that server. The bot joins their
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
 * (validated: public address, audio content type), Jamendo when MUSIC_JAMENDO_CLIENT_ID is set, two built-in
 * test tracks, and YouTube. YouTube never hands out audio files, so YouTube tracks play through YouTube's own
 * embedded player on every listener's screen (kind "youtube"), kept on the server's clock like everything else.
 * Spotify, Deezer, Apple Music, Tidal and SoundCloud don't share audio either: their links (songs, albums,
 * playlists) are read for titles and artists, and each song is matched to a playable version (YouTube when
 * YOUTUBE_API_KEY is set, otherwise Audius) when its turn comes. Nothing is downloaded or ripped from any service.
 */

const IDLE_MS = Math.max(10, Number(process.env.MUSIC_IDLE_SECONDS ?? 120)) * 1000;
const AUDIUS = (process.env.MUSIC_AUDIUS_HOST ?? "https://discoveryprovider.audius.co").replace(/\/$/, "");
const AUDIUS_APP = "SEND";
const JAMENDO_ID = process.env.MUSIC_JAMENDO_CLIENT_ID ?? "";
const MAX_QUEUE = 100;
/** Optional YouTube Data API key: YouTube search for song names and Spotify matches, full playlists, durations. */
const YT_KEY = process.env.YOUTUBE_API_KEY ?? "";
const UA = "Mozilla/5.0 (compatible; SENDMusic/1.0; +https://syndo.makz.space)";
const ASSETS = fileURLToPath(new URL("../assets/music/", import.meta.url));
const TEST_TRACKS = [
  { file: "send-test-a.mp3", title: "SEND Test Tone A", duration: 14 },
  { file: "send-test-b.mp3", title: "SEND Test Tone B", duration: 12 },
];

type Source = "test" | "audius" | "jamendo" | "link" | "youtube" | "spotify" | "deezer" | "apple" | "soundcloud" | "tidal";
interface Track {
  id: string; token: string; title: string; artist: string | null; duration: number | null; source: Source; page: string | null;
  /** How listeners play it: an audio stream through SEND, or YouTube's embedded player. */
  kind: "audio" | "youtube";
  /** A file name in assets/music (test tracks), an https URL, or a YouTube video id. Never sent to clients for audio. */
  upstream: string;
  /** Songs read from Spotify and friends: what to search for when its turn comes (then cleared). */
  match?: string | null;
  /** Where a matched song actually plays from, e.g. "YouTube". */
  via?: string | null;
  /** YouTube videos already tried for this song (blocked ones aren't picked again). */
  tried?: string[];
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
/** Services whose single-song links we read for a title and then match. */
const TITLE_ONLY: [RegExp, string, Source][] = [
  [/(^|\.)music\.apple\.com$/i, "Apple Music", "apple"], [/(^|\.)soundcloud\.com$/i, "SoundCloud", "soundcloud"], [/(^|\.)tidal\.com$/i, "Tidal", "tidal"], [/(^|\.)bandcamp\.com$/i, "Bandcamp", "link"],
];
type Item = Omit<Track, "id" | "token" | "requester">;
type Resolved = { ok: true; tracks: Item[]; list?: string | null } | { ok: false; message: string };
const one = (track: Item): Resolved => ({ ok: true, tracks: [track] });

async function audiusJson(path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${AUDIUS}${path}${sep}app_name=${AUDIUS_APP}`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Audius ${r.status}`);
  return r.json();
}
const audiusItem = (t: any): Item => ({ title: String(t.title ?? "Untitled").slice(0, 200), artist: t.user?.name ? String(t.user.name).slice(0, 100) : null, duration: Number(t.duration) || null,
  source: "audius", kind: "audio", page: t.permalink ? `https://audius.co${t.permalink}` : null, upstream: `${AUDIUS}/v1/tracks/${encodeURIComponent(t.id)}/stream?app_name=${AUDIUS_APP}` });
const playableAudius = (x: any) => x && x.is_streamable !== false && !x.is_delete && !x.stream_conditions;

/** Words that matter in a song title ("Never Gonna Give You Up (feat. X)" gives never, gonna, give, you, up). */
const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\((?:feat|ft|with)[^)]*\)|\[[^\]]*\]/g, " ").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !["the", "official", "video", "audio", "lyrics", "feat", "ft", "remastered", "remaster", "version"].includes(w));
/** Does a found track really look like the song asked for? Most of the title's words must be there. */
export function sameSong(wantTitle: string, gotTitle: string, gotArtist?: string | null): boolean {
  const want = words(wantTitle); if (!want.length) return false;
  // A cover, remix or sped-up edit isn't the song, unless that's what was asked for.
  const alt = /\b(remix|cover|nightcore|sped ?up|slowed|reverb|instrumental|karaoke|8d|bass ?boosted|mashup|edit)\b/i;
  if (alt.test(gotTitle) && !alt.test(wantTitle)) return false;
  const got = new Set(words(`${gotTitle} ${gotArtist ?? ""}`));
  return want.filter((w) => got.has(w)).length / want.length >= 0.75;
}

async function searchAudius(query: string, duration?: number | null, title?: string): Promise<Item | null> {
  const d = await audiusJson(`/v1/tracks/search?query=${encodeURIComponent(query)}&limit=10`);
  const ok = (d.data ?? []).filter(playableAudius).filter((x: any) => !title || sameSong(title, String(x.title ?? ""), x.user?.name));
  const t = (duration ? ok.find((x: any) => Math.abs(Number(x.duration) - duration) <= 8) : null) ?? ok[0];
  return t ? audiusItem(t) : null;
}
async function searchJamendo(query: string): Promise<Item | null> {
  if (!JAMENDO_ID) return null;
  const r = await fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(JAMENDO_ID)}&format=json&limit=1&audioformat=mp32&search=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const t = ((await r.json()) as any).results?.[0];
  if (!t?.audio) return null;
  return { title: String(t.name).slice(0, 200), artist: t.artist_name ?? null, duration: Number(t.duration) || null, source: "jamendo", kind: "audio", page: t.shareurl ?? null, upstream: t.audio };
}

/* YouTube: titles from oEmbed (public, no key), playlists from YouTube's own feed (first 15) or the Data API. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function youtubeRef(u: URL): { video: string | null; list: string | null } | null {
  const h = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  let video: string | null = null;
  if (h === "youtu.be") video = u.pathname.slice(1).split("/")[0] ?? null;
  else if (h === "youtube.com" || h === "music.youtube.com" || h === "youtube-nocookie.com") {
    video = u.searchParams.get("v") ?? (/^\/(shorts|live|embed|v)\/([^/?#]+)/.exec(u.pathname)?.[2] ?? null);
  } else return null;
  const list = u.searchParams.get("list");
  return { video: video && YT_ID.test(video) ? video : null, list: list && /^[A-Za-z0-9_-]{10,64}$/.test(list) ? list : null };
}
const ytItem = (id: string, title: string, artist: string | null, duration: number | null): Item =>
  ({ title: title.slice(0, 200), artist: artist ? artist.replace(/ - Topic$/, "").slice(0, 100) : null, duration, source: "youtube", kind: "youtube", page: `https://www.youtube.com/watch?v=${id}`, upstream: id });

/** Is this video real, public and allowed in other sites' players? (oEmbed says 401 when embedding is off.) */
async function ytOembed(id: string): Promise<{ ok: true; title: string; author: string | null } | { ok: false; reason: string }> {
  const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(8000), headers: { "user-agent": UA } }).catch(() => null);
  if (!r) return { ok: false, reason: "YouTube couldn't be reached" };
  if (r.status === 401 || r.status === 403) return { ok: false, reason: "its owner doesn't allow it to play outside YouTube" };
  if (!r.ok) return { ok: false, reason: "the video doesn't exist or is private" };
  const j: any = await r.json().catch(() => ({}));
  return { ok: true, title: String(j.title ?? "YouTube video"), author: j.author_name ? String(j.author_name) : null };
}
async function ytApi(path: string): Promise<any> {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(YT_KEY)}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`YouTube API ${r.status}`);
  return r.json();
}
const isoSeconds = (d: string) => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? ""); return m ? (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) : null; };
async function ytDurations(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!YT_KEY) return out;
  for (let i = 0; i < ids.length; i += 50) {
    const d = await ytApi(`videos?part=contentDetails,status&id=${ids.slice(i, i + 50).join(",")}`).catch(() => null);
    for (const v of d?.items ?? []) { const s = isoSeconds(v.contentDetails?.duration); if (s) out.set(v.id, s); }
  }
  return out;
}
async function ytVideo(id: string): Promise<Resolved> {
  const o = await ytOembed(id);
  if (!o.ok) return { ok: false, message: `I can't play that YouTube video: ${o.reason}.` };
  return one(ytItem(id, o.title, o.author, (await ytDurations([id])).get(id) ?? null));
}
const xmlText = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
async function ytPlaylist(list: string): Promise<{ title: string | null; items: Item[] } | null> {
  if (YT_KEY) {
    const items: Item[] = []; let page = ""; let title: string | null = null;
    const meta = await ytApi(`playlists?part=snippet&id=${list}`).catch(() => null);
    title = meta?.items?.[0]?.snippet?.title ?? null;
    for (let i = 0; i < 2 && items.length < MAX_QUEUE; i++) {
      const d = await ytApi(`playlistItems?part=snippet&maxResults=50&playlistId=${list}${page ? `&pageToken=${page}` : ""}`).catch(() => null);
      if (!d) break;
      for (const it of d.items ?? []) { const v = it.snippet?.resourceId?.videoId; const t = it.snippet?.title; if (v && t && t !== "Private video" && t !== "Deleted video") items.push(ytItem(v, t, it.snippet?.videoOwnerChannelTitle ?? null, null)); }
      page = d.nextPageToken ?? ""; if (!page) break;
    }
    const durs = await ytDurations(items.map((x) => x.upstream));
    for (const x of items) x.duration = durs.get(x.upstream) ?? null;
    if (items.length) return { title, items };
  }
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(list)}`, { signal: AbortSignal.timeout(8000), headers: { "user-agent": UA } }).catch(() => null);
  if (!r?.ok) return null;
  const xml = await r.text();
  const title = /<feed[\s\S]*?<title>([^<]*)<\/title>/.exec(xml)?.[1] ?? null;
  const items = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1]!; const v = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1]; const t = /<title>([^<]*)<\/title>/.exec(e)?.[1];
    const a = /<author>\s*<name>([^<]*)<\/name>/.exec(e)?.[1];
    return v && t && YT_ID.test(v) ? ytItem(v, xmlText(t), a ? xmlText(a) : null, null) : null;
  }).filter(Boolean) as Item[];
  return items.length ? { title: title ? xmlText(title) : null, items } : null;
}
async function ytSearch(query: string, duration?: number | null, title?: string, exclude: string[] = []): Promise<Item | null> {
  if (!YT_KEY) return null;
  const d = await ytApi(`search?part=snippet&type=video&videoEmbeddable=true&maxResults=5&q=${encodeURIComponent(query)}`).catch((e) => { console.error("[music] youtube search", (e as Error).message); return null; });
  const hits = (d?.items ?? []).filter((x: any) => x.id?.videoId && !exclude.includes(x.id.videoId) && (!title || sameSong(title, xmlText(x.snippet?.title ?? ""), x.snippet?.channelTitle)));
  if (!hits.length) return null;
  const durs = await ytDurations(hits.map((x: any) => x.id.videoId));
  const pick = (duration ? hits.find((x: any) => Math.abs((durs.get(x.id.videoId) ?? 0) - duration) <= 10) : null) ?? hits[0];
  return ytItem(pick.id.videoId, xmlText(pick.snippet?.title ?? "YouTube video"), pick.snippet?.channelTitle ? xmlText(pick.snippet.channelTitle) : null, durs.get(pick.id.videoId) ?? null);
}

/* Spotify and friends: read the song names, play a matching version when the song's turn comes. */
async function page(url: string): Promise<string | null> {
  const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { "user-agent": UA, "accept-language": "en" }, redirect: "follow" }).catch(() => null);
  return r?.ok ? (await r.text()).slice(0, 1_500_000) : null;
}
const metas = (html: string, name: string) => [...html.matchAll(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`, "g"))].map((m) => xmlText(m[1]!));
const matchItem = (source: Source, title: string, artist: string | null, duration: number | null, page: string | null): Item =>
  ({ title: title.slice(0, 200), artist: artist?.slice(0, 100) ?? null, duration, source, kind: "audio", page, upstream: "", match: `${artist ? `${artist} - ` : ""}${title}`.slice(0, 200) });
async function spotifyTrack(id: string): Promise<Item | null> {
  const html = await page(`https://open.spotify.com/track/${id}`);
  const title = html ? metas(html, "og:title")[0] : null;
  if (!html || !title) return null;
  const artist = metas(html, "music:musician_description")[0] ?? metas(html, "og:description")[0]?.split(" · ")[0] ?? null;
  return matchItem("spotify", title, artist, Number(metas(html, "music:duration")[0]) || null, `https://open.spotify.com/track/${id}`);
}
async function pool<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await fn(xs[k]!); } }));
  return out;
}
async function spotify(u: URL): Promise<Resolved> {
  const m = /^\/(?:intl-[a-z-]+\/)?(track|album|playlist)\/([A-Za-z0-9]{10,40})/.exec(u.pathname);
  if (!m) return { ok: false, message: "I can read Spotify song, album and playlist links." };
  if (m[1] === "track") { const t = await spotifyTrack(m[2]!); return t ? one(t) : { ok: false, message: "I couldn't read that Spotify song." }; }
  const html = await page(`https://open.spotify.com/${m[1]}/${m[2]}`);
  const ids = html ? [...new Set(metas(html, "music:song").map((x) => /track\/([A-Za-z0-9]+)/.exec(x)?.[1]).filter(Boolean) as string[])].slice(0, 50) : [];
  if (!ids.length) return { ok: false, message: `I couldn't read that Spotify ${m[1]}. It may be private.` };
  const items = (await pool(ids, 8, (id) => spotifyTrack(id).catch(() => null))).filter(Boolean) as Item[];
  const name = (metas(html!, "og:title")[0] ?? "").replace(/^Listen to /, "").replace(/ - (Album|Playlist) by .*$/, "").replace(/ \| Spotify$/, "") || null;
  return items.length ? { ok: true, tracks: items, list: name } : { ok: false, message: `I couldn't read the songs in that Spotify ${m[1]}.` };
}
/** Deezer has an open public API for songs, albums and playlists. */
async function deezer(u: URL): Promise<Resolved> {
  let url = u;
  if (/^(link\.)?deezer\.page\.link$|^dzr\.page\.link$/i.test(u.hostname)) { const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(8000) }).catch(() => null); const to = r?.headers.get("location"); if (to) try { url = new URL(to); } catch { /* */ } }
  const m = /\/(track|album|playlist)\/(\d+)/.exec(url.pathname);
  if (!m) return { ok: false, message: "I can read Deezer song, album and playlist links." };
  const r = await fetch(`https://api.deezer.com/${m[1]}/${m[2]}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  const d: any = r?.ok ? await r.json().catch(() => null) : null;
  if (!d || d.error) return { ok: false, message: `I couldn't read that Deezer ${m[1]}.` };
  const it = (t: any) => matchItem("deezer", String(t.title), t.artist?.name ?? null, Number(t.duration) || null, t.link ?? null);
  if (m[1] === "track") return one(it(d));
  return { ok: true, tracks: (d.tracks?.data ?? []).slice(0, MAX_QUEUE).map(it), list: d.title ?? null };
}

/** "Artist - Song (Official Video) [4K]" to "Artist - Song", for finding another version of a YouTube song. */
const cleanTitle = (s: string) => s.replace(/[([](?:official|lyrics?|audio|video|visuali[sz]er|music video|hd|4k|remaster(?:ed)?|mv|live)[^)\]]*[)\]]/gi, "").replace(/\s*\|.*$/, "").replace(/\s{2,}/g, " ").trim();
/** A YouTube video whose owner blocks other players: look for another version of the song instead of skipping it. */
async function replaceBlocked(t: Track): Promise<boolean> {
  // One more try per song, never picking a video that was already blocked.
  if (t.kind !== "youtube" || (t.tried?.length ?? 0) >= 2) return false;
  const original = t.upstream, before = { kind: t.kind, via: t.via ?? null };
  t.tried = [...(t.tried ?? []), original];
  t.match = `${t.artist && !t.title.toLowerCase().includes(t.artist.toLowerCase()) ? `${t.artist} - ` : ""}${t.source === "youtube" ? cleanTitle(t.title) : t.title}`.slice(0, 200);
  const ok = await findPlayable(t).catch(() => false);
  if (!ok || (t.kind === "youtube" && t.upstream === original)) { t.match = null; t.kind = before.kind; t.upstream = original; t.via = before.via; return false; }
  return true;
}

/** A playable version of a song read from Spotify and friends: YouTube (with a key), then Audius. */
async function findPlayable(t: Track): Promise<boolean> {
  // Only accept a result whose title really matches the song (a wrong song is worse than a skip).
  const title = t.source === "youtube" ? cleanTitle(t.title).replace(/^.*? - /, "") : t.title;
  const hit = await ytSearch(t.match!, t.duration, title, t.tried ?? []) ?? await searchAudius(t.match!, t.duration, title).catch(() => null);
  if (!hit) return false;
  t.kind = hit.kind; t.upstream = hit.upstream; t.via = hit.source === "youtube" ? "YouTube" : "Audius";
  if (hit.duration) t.duration = hit.duration;
  t.match = null;
  return true;
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
  if (test) { const t = TEST_TRACKS[/[2b]/i.test(test[1] ?? "") ? 1 : 0]!; return one({ title: t.title, artist: "SEND", duration: t.duration, source: "test", kind: "audio", page: null, upstream: t.file }); }
  if (/^https?:\/\//i.test(text)) {
    let u: URL; try { u = new URL(text); } catch { return { ok: false, message: "That link isn't a valid address." }; }
    const yt = youtubeRef(u);
    if (yt) {
      // A playlist link (or a video inside a playlist): queue the playlist, starting with that video.
      if (yt.list && !/^RD/.test(yt.list)) {
        const pl = await ytPlaylist(yt.list);
        if (pl) {
          let items = pl.items;
          if (yt.video) { const first = items.find((x) => x.upstream === yt.video); items = first ? [first, ...items.filter((x) => x !== first)] : items; }
          return { ok: true, tracks: items, list: pl.title };
        }
        if (!yt.video) return { ok: false, message: "I couldn't read that YouTube playlist. It may be private, or a mix that only exists for one person." };
      }
      return yt.video ? ytVideo(yt.video) : { ok: false, message: "That YouTube link doesn't point to a video or playlist." };
    }
    if (/(^|\.)spotify\.com$/i.test(u.hostname) || /^spotify\.link$/i.test(u.hostname)) {
      if (/^spotify\.link$/i.test(u.hostname)) { const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": UA } }).catch(() => null); if (r?.url) try { u = new URL(r.url); } catch { /* */ } }
      return spotify(u);
    }
    if (/(^|\.)deezer\.com$/i.test(u.hostname) || /page\.link$/i.test(u.hostname)) return deezer(u);
    if (/(^|\.)audius\.co$/i.test(u.hostname)) {
      const d = await audiusJson(`/v1/resolve?url=${encodeURIComponent(text)}`).catch(() => null);
      const t = d?.data;
      if (t?.playlist_name && t.id) {
        const tr = await audiusJson(`/v1/playlists/${encodeURIComponent(t.id)}/tracks`).catch(() => null);
        const items = (tr?.data ?? []).filter(playableAudius).slice(0, MAX_QUEUE).map(audiusItem);
        return items.length ? { ok: true, tracks: items, list: String(t.playlist_name) } : { ok: false, message: "That Audius playlist has no tracks I can stream." };
      }
      if (t?.id && t.title) return t.is_streamable === false ? { ok: false, message: "That Audius track isn't available for streaming." } : one(audiusItem(t));
      return { ok: false, message: "I couldn't find that Audius track or playlist." };
    }
    const named = TITLE_ONLY.find(([re]) => re.test(u.hostname));
    if (named) {
      const e = await previewFor(text).catch(() => null);
      const title = e?.title?.replace(/ on Apple Music$| \| Listen online for free on SoundCloud$| on TIDAL$/i, "").trim();
      if (!title) return { ok: false, message: `I couldn't read that ${named[1]} link.` };
      return one(matchItem(named[2], title, null, null, text));
    }
    if (!allowedUrl(text) || u.protocol !== "https:") return { ok: false, message: "I can only play public https:// audio links." };
    const p = await probe(text);
    if (!p.ok) return { ok: false, message: `I can't play that link: ${p.reason}. Send a YouTube, Spotify, Deezer or Audius link, a direct link to an audio file (mp3, ogg, opus, m4a, wav, flac), or search by name.` };
    const name = decodeURIComponent(u.pathname.split("/").pop() || u.hostname).replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 120) || u.hostname;
    return one({ title: name, artist: u.hostname, duration: null, source: "link", kind: "audio", page: null, upstream: text });
  }
  const hit = await ytSearch(text) ?? await searchAudius(text).catch((e) => { console.error("[music] audius", (e as Error).message); return null; }) ?? await searchJamendo(text).catch(() => null);
  return hit ? one(hit) : { ok: false, message: `No playable results for **${text.slice(0, 100)}**.` };
}

/* --------------------------------------------------------------------------------- state -- */
const position = (r: Room) => r.current ? Math.max(0, (r.pausedAt ?? Date.now()) - r.startedAt) : 0;
const publicTrack = (t: Track) => ({ id: t.id, title: t.title, artist: t.artist, duration: t.duration, source: t.source, page: t.page, requester: t.requester,
  kind: t.match ? null : t.kind, video_id: t.kind === "youtube" && !t.match ? t.upstream : null, via: t.via ?? null, stream_url: `/api/music/stream/${t.token}` });
const SOURCE_NAME: Partial<Record<Source, string>> = { spotify: "Spotify", deezer: "Deezer", apple: "Apple Music", soundcloud: "SoundCloud", tidal: "Tidal" };
const from = (t: Track) => t.via && SOURCE_NAME[t.source] ? ` (from ${SOURCE_NAME[t.source]}, playing from ${t.via})` : t.kind === "youtube" ? " (YouTube)" : "";
function stateOf(r: Room | undefined, channelId: string) {
  // `controls`: this backend accepts /api/music/:cid/control (the web app shows its buttons only then).
  return { channel_id: channelId, guild_id: r?.guildId ?? null, bot_id: botId, controls: true, active: !!r, playing: r?.current ? publicTrack(r.current) : null,
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
  // Songs with no playable version are listed in one message, not one message each.
  const unmatched: string[] = [];
  const flush = async () => {
    if (!unmatched.length) return;
    const list = unmatched.slice(0, 5).map((x) => `**${x}**`).join(", ") + (unmatched.length > 5 ? ` and ${unmatched.length - 5} more` : "");
    await say(r, `⚠️ Skipped ${list}: I couldn't find a version I can play.`);
    unmatched.length = 0;
  };
  while (r.queue.length) {
    const t = r.queue.shift()!;
    if (t.match && !(await findPlayable(t).catch(() => false))) { forget(t); unmatched.push(`${t.title}${t.artist ? ` by ${t.artist}` : ""}`); continue; }
    let check: { ok: true } | { ok: false; reason: string } = t.source === "test" ? (existsSync(ASSETS + t.upstream) ? { ok: true as const } : { ok: false as const, reason: "the file is missing" })
      : t.kind === "youtube" ? await ytOembed(t.upstream) : await probe(t.upstream);
    if (!check.ok && t.kind === "youtube" && /outside YouTube/.test(check.reason) && await replaceBlocked(t)) {
      check = t.kind === "youtube" ? await ytOembed(t.upstream) : await probe(t.upstream);
      if (check.ok) await say(r, `ℹ️ **${t.title}** can't play outside YouTube, so I found another version on ${t.via}.`);
    }
    if (!check.ok) { forget(t); await say(r, `⚠️ Skipped **${t.title}** (requested by ${t.requester.name}): it couldn't be played, ${check.reason}.`); continue; }
    await flush();
    r.current = t; r.startedAt = Date.now();
    armTimer(r);
    if (announce) await say(r, `🎶 Now playing **${t.title}**${t.artist ? ` by ${t.artist}` : ""} \`${fmt(t.duration)}\`${from(t)}, requested by ${t.requester.name}.`);
    break;
  }
  await flush();
  if (!r.current) await say(r, "The queue is empty. Add more with `/play`, or I'll leave when the room is empty.").catch(() => {});
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
  "**SEND Music**: join a voice room, then type these in any text chat of this server (type / to see them):",
  "`/play <song name or link>`: play now, or add to the queue",
  "`/queue`: what's playing and what's next",
  "`/nowplaying`: the current track and progress",
  "`/pause`, `/resume`: pause and carry on",
  "`/skip`: next track. Skipping someone else's track needs DJ rights.",
  "`/stop`: clear the queue and disconnect (needs DJ rights when others are listening)",
  "`/music`: this list",
  "",
  `**Sources**: song names are searched on ${YT_KEY ? "YouTube, then " : ""}Audius${JAMENDO_ID ? " and Jamendo" : ""}. Links: YouTube videos and playlists (they play in YouTube's player on your screen), Spotify and Deezer songs, albums and playlists, Apple Music, SoundCloud and Tidal songs (matched to a playable version), Audius tracks and playlists, and direct https audio files. \`/play test\` plays a built-in test track.`,
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

/** Runs one music command (from /commands or the call screen's buttons); the bot answers in `text`. */
export async function handleMusicCommand(text: ChanRow, userId: string, content: string): Promise<boolean> {
  // "!play x" (internal) and "/play x" (the call screen's buttons) both work.
  const m = /^[!/]([a-z]+)(?:\s+([\s\S]*))?$/i.exec(content.trim());
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
      await reply(`<@${userId}> join a voice room in this server first, then use \`/${m![1]!.toLowerCase()}\` again.`);
      return true;
    }
    const user = await q1<any>("select username, display_name from users where id = $1", [userId]);
    const name = user?.display_name || user?.username || "someone";
    if (cmd === "play") {
      if (!arg) { await reply("Tell me what to play: `/play <song name or link>`. Try `/play test` for a test track."); return true; }
      const perms = await permsFor(userId, voice);
      if (!has(perms, P.CONNECT)) { await reply("You can't use music in this voice room."); return true; }
      const found = await resolve(arg);
      if (!found.ok) { await reply(found.message); return true; }
      await withRoom(voice.id, async () => {
        if (voiceStateOf(userId)?.channel_id !== voice.id) { await reply(`<@${userId}> you left the voice room, so I didn't add that.`); return; }
        let r = rooms.get(voice.id);
        if (!r) { r = { channelId: voice.id, guildId: voice.guild_id!, textChannelId: text.id, queue: [], current: null, startedAt: 0, pausedAt: null, endTimer: null, idleTimer: null }; rooms.set(voice.id, r); }
        r.textChannelId = text.id;
        const room = MAX_QUEUE - r.queue.length;
        if (room <= 0) { await reply(`The queue is full (${MAX_QUEUE} tracks).`); return; }
        const added: Track[] = found.tracks.slice(0, room).map((x) => ({ ...x, id: newId(), token: randomBytes(18).toString("base64url"), requester: { id: userId, name } }));
        for (const t of added) { tokens.set(t.token, t); r.queue.push(t); }
        const cut = found.tracks.length - added.length;
        if (added.length > 1 || found.list) {
          const matched = added.some((t) => t.match) ? " Songs from other services are matched to a playable version when their turn comes." : "";
          await reply(`➕ Added **${added.length}** ${added.length === 1 ? "song" : "songs"}${found.list ? ` from **${found.list}**` : ""}, requested by ${name}.${cut > 0 ? ` ${cut} more didn't fit: the queue holds ${MAX_QUEUE}.` : ""}${matched}`);
          if (!r.current) await next(r, true); else await broadcast(r.channelId);
        } else {
          const t = added[0]!;
          const extra = t.source === "link" ? " Length shows once a listener's player reads the file." : t.match ? ` I'll find a playable version of this ${SOURCE_NAME[t.source] ?? ""} song when its turn comes.` : "";
          if (!r.current) await next(r, true);
          else { await reply(`➕ Queued **${t.title}**${t.artist ? ` by ${t.artist}` : ""} \`${fmt(t.duration)}\` at position ${r.queue.length}, requested by ${name}.${extra}`); await broadcast(r.channelId); }
        }
        checkIdle(r);
      });
      return true;
    }
    await withRoom(voice.id, async () => {
      const r = rooms.get(voice.id);
      if (!r || (!r.current && !r.queue.length)) { await reply(cmd === "stop" && r ? (await disconnect(r, null), "⏹️ Stopped and left the voice room.") : "Nothing is playing in your voice room. Start with `/play <song>`."); return; }
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
          if (r.pausedAt != null) { await reply("Already paused. `/resume` to carry on."); break; }
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
          if (listeners(voice.id) > 1 && !(await isDj(userId, voice))) { await reply("Stopping for everyone needs DJ rights (a DJ role, or Move Members). You can `/skip` your own tracks."); break; }
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

  /**
   * The call screen's music controls. Runs exactly the same command as typing it in chat (same checks, DJ rules and
   * bot messages); the bot answers in the room's music chat, or in the voice room's own chat if nothing's playing yet.
   */
  app.post<{ Params: { cid: string } }>("/api/music/:cid/control", { preHandler: requireUser, config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ action: z.enum(["play", "pause", "resume", "skip", "stop"]), query: z.string().trim().max(300).optional() }).parse(req.body);
    const me = uid(req);
    if (voiceStateOf(me)?.channel_id !== req.params.cid) throw forbidden("Join the voice room first.");
    const voice = await getChannel(req.params.cid);
    if (!voice?.guild_id || !isVoiceType(voice.type)) throw notFound("Voice room");
    if (b.action === "play" && !b.query) throw bad("Type a song name or a link.");
    const room = rooms.get(voice.id);
    let text = room ? await getChannel(room.textChannelId) : null;
    if (!text || !has(await permsFor(me, text), P.VIEW_CHANNEL)) text = voice;
    await handleMusicCommand(text, me, `/${b.action}${b.query ? ` ${b.query.replace(/\s+/g, " ")}` : ""}`);
    return stateOf(rooms.get(voice.id), voice.id);
  });

  /** Slash commands from the message box (/play, /queue, /nowplaying, /pause, /resume, /skip, /stop, /music). */
  app.post("/api/music/command", { preHandler: requireUser, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ channel_id: z.string().regex(/^\d{1,20}$/), command: z.enum(["play", "queue", "nowplaying", "pause", "resume", "skip", "stop", "help"]), query: z.string().trim().max(300).optional() }).parse(req.body);
    const me = uid(req);
    const text = await getChannel(b.channel_id);
    if (!text?.guild_id) throw bad("Music commands work in server channels.");
    const perms = await permsFor(me, text);
    if (!has(perms, P.VIEW_CHANNEL) || !has(perms, P.SEND_MESSAGES)) throw forbidden("You can't use commands in this channel.");
    if (b.command === "play" && !b.query) throw bad("Type a song name or a link after /play.");
    if (b.command !== "help") {
      const vs = voiceStateOf(me);
      const voice = vs?.channel_id ? await getChannel(vs.channel_id) : null;
      if (!voice || voice.guild_id !== text.guild_id || !isVoiceType(voice.type)) throw bad(`Join a voice room in this server first, then use /${b.command} again.`);
    }
    await handleMusicCommand(text, me, `!${b.command === "nowplaying" ? "np" : b.command}${b.query ? ` ${b.query.replace(/\s+/g, " ")}` : ""}`);
    return { ok: true };
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
    const b = z.object({ track_id: z.string().max(24), code: z.number().int().optional() }).parse(req.body);
    if (voiceStateOf(uid(req))?.channel_id !== req.params.cid) throw forbidden("Join the voice room first.");
    await withRoom(req.params.cid, async () => {
      const r = rooms.get(req.params.cid); const c = r?.current;
      if (!r || !c || c.id !== b.track_id || c.source === "test") return;
      if (c.kind === "youtube") {
        // YouTube's player error codes: 2 bad id, 5 can't play here, 100 removed or private, 101/150/153 not allowed in other players.
        const why = b.code === 100 ? "it was removed or is private" : b.code === 101 || b.code === 150 || b.code === 153 ? "its owner doesn't allow it to play outside YouTube" : b.code === 2 || b.code === 5 ? "YouTube's player couldn't play it" : null;
        if (!why) return;
        if ((b.code === 101 || b.code === 150 || b.code === 153) && await replaceBlocked(c)) {
          if (c.duration != null) { r.startedAt = Date.now(); r.pausedAt = null; armTimer(r); } else { r.startedAt = Date.now(); r.pausedAt = null; clearTimer(r); }
          await say(r, `ℹ️ **${c.title}** can't play outside YouTube, so I found another version on ${c.via}.`); await broadcast(r.channelId); return;
        }
        await say(r, `⚠️ Skipped **${c.title}**: ${why}.`); await next(r, true);
        return;
      }
      const p = await probe(c.upstream);
      if (!p.ok) { await say(r, `⚠️ Skipped **${c.title}**: it stopped playing (${p.reason}).`); await next(r, true); }
    });
    return { ok: true };
  });

  /** The audio itself. The token is unguessable and only lives while the track is queued or playing. */
  app.get<{ Params: { token: string } }>("/api/music/stream/:token", async (req, reply) => {
    const t = tokens.get(req.params.token);
    if (!t || t.kind !== "audio" || t.match) throw notFound("Track");
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
