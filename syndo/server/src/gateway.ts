import { closeSfuSession, closeSfuAccount } from "./sfu.ts";
import { removeFromRoom } from "./media.ts";
import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ChannelType, P, has, isDmType, isVoiceType, type VoiceState } from "@send/shared";
import { allowedOrigins } from "./config.ts";
import { q } from "./db.ts";
import { sessionFromToken, tokenFromCookieHeader } from "./auth.ts";
import { getChannel, permsFor, viewers, type ChanRow } from "./perms.ts";
import { buildReady } from "./ready.ts";
import { USER_COLS, userOut } from "./serialize.ts";

/**
 * Real-time gateway (WebSocket at /gateway).
 *
 * - Authenticated by the session cookie on upgrade, or an `identify` frame
 *   carrying a token (bots, native clients).
 * - Every dispatch is permission-filtered per recipient at send time. A
 *   client never "subscribes" to a channel it might lose access to — it is
 *   simply not sent anything it could not fetch over HTTP.
 * - Each frame carries a per-connection sequence `s`. On reconnect the client
 *   receives a fresh READY and re-fetches history after its newest known
 *   message, so gaps are filled from the database, not from memory.
 *
 * Scaling note: the hub is in-process. Running several API nodes needs a
 * pub/sub fan-out (Redis or Postgres NOTIFY); tracked in FEATURE_MATRIX.md.
 */
interface Conn { ws: WebSocket; userId: string; sessionId: string; seq: number; alive: boolean }

const byUser = new Map<string, Set<Conn>>();
const bySession = new Map<string, Set<Conn>>();
/** Visible presence of connected users ("offline" never stored). */
const status = new Map<string, string>();
/** Voice state per user (one voice connection per user). */
const voice = new Map<string, VoiceState & { session_id: string }>();
/** "Playing …" / listening / watching, per user (in memory, cleared on disconnect). */
const activities = new Map<string, { type: number; name: string; details: string | null; state: string | null; started_at: number; url: string | null }>();
export const activityOf = (uid: string) => activities.get(uid) ?? null;
/** Custom statuses ("text under the name") of people who are online, kept in memory for presence updates. */
type CustomStatus = { text: string; emoji?: string | null; expires_at?: string | null };
const customStatuses = new Map<string, CustomStatus>();
const liveStatus = (cs: CustomStatus | null | undefined) =>
  cs && cs.text && !(cs.expires_at && Date.parse(cs.expires_at) < Date.now()) ? { text: cs.text, emoji: cs.emoji ?? null } : null;
export async function setCustomStatus(uid: string, cs: CustomStatus | null) {
  if (cs) customStatuses.set(uid, cs); else customStatuses.delete(uid);
  if (byUser.has(uid)) await broadcastPresence(uid);
}

export const onlineUserIds = () => [...byUser.keys()];
export const isOnline = (uid: string) => byUser.has(uid);
export const presenceOf = (uid: string) => {
  const s = status.get(uid);
  return !s || s === "invisible" ? "offline" : s;
};

function sendRaw(c: Conn, t: string, d: unknown) {
  if (c.ws.readyState !== c.ws.OPEN) return;
  c.ws.send(JSON.stringify({ op: "dispatch", t, s: ++c.seq, d }));
}

export function toUser(uid: string, t: string, d: unknown) {
  for (const c of byUser.get(uid) ?? []) sendRaw(c, t, d);
}
export function toUsers(uids: Iterable<string>, t: string, d: unknown, except?: string) {
  for (const u of new Set(uids)) if (u !== except) toUser(u, t, d);
}

/** Deliver to everyone online who can VIEW the channel (and optionally holds `need`). `d` may depend on the viewer's permissions. */
export async function toChannel(ch: ChanRow, t: string, d: unknown | ((uid: string, perms: bigint) => unknown), opts: { need?: bigint; except?: string } = {}) {
  let candidates: string[];
  if (isDmType(ch.type)) {
    candidates = (await q<{ user_id: string }>("select user_id::text from channel_recipients where channel_id = $1", [ch.id])).map((r) => r.user_id).filter(isOnline);
  } else {
    candidates = await onlineMembers(ch.guild_id!);
  }
  const vis = await viewers(ch, candidates);
  for (const [uid, perms] of vis) {
    if (uid === opts.except) continue;
    if (opts.need && !has(perms, opts.need)) continue;
    const payload = typeof d === "function" ? (d as (u: string, p: bigint) => unknown)(uid, perms) : d;
    if (payload !== null && payload !== undefined) toUser(uid, t, payload);
  }
}

export async function onlineMembers(guildId: string): Promise<string[]> {
  const online = onlineUserIds();
  if (!online.length) return [];
  return (await q<{ user_id: string }>("select user_id::text from members where guild_id = $1 and user_id = any($2::bigint[])", [guildId, online])).map((r) => r.user_id);
}

export async function toGuild(guildId: string, t: string, d: unknown | ((uid: string) => Promise<unknown> | unknown)) {
  for (const uid of await onlineMembers(guildId)) {
    const payload = typeof d === "function" ? await (d as (u: string) => unknown)(uid) : d;
    if (payload) toUser(uid, t, payload);
  }
}

/** People who should see this user's presence: friends and anyone sharing a server. */
async function presenceAudience(uid: string): Promise<string[]> {
  const online = onlineUserIds();
  if (!online.length) return [];
  const rows = await q<{ id: string }>(
    `select other_id::text as id from relationships where user_id = $1 and type = 1 and other_id = any($2::bigint[])
     union select m2.user_id::text from members m1 join members m2 on m2.guild_id = m1.guild_id
      where m1.user_id = $1 and m2.user_id <> $1 and m2.user_id = any($2::bigint[])`, [uid, online]);
  return rows.map((r) => r.id);
}

export async function broadcastPresence(uid: string) {
  const st = presenceOf(uid);
  const d = { user_id: uid, status: st, activity: st === "offline" ? null : activities.get(uid) ?? null, custom_status: st === "offline" ? null : liveStatus(customStatuses.get(uid)) };
  toUsers(await presenceAudience(uid), "PRESENCE_UPDATE", d);
  toUser(uid, "PRESENCE_UPDATE", { ...d, self_status: status.get(uid) ?? "offline" });
}

export async function setStatus(uid: string, s: string) {
  if (!byUser.has(uid)) return;
  status.set(uid, s);
  await broadcastPresence(uid);
}

/** Terminate a session's live connections (revocation, logout, password change). */
export async function closeSession(sessionId: string, reason = "Session ended") {
  for (const c of bySession.get(sessionId) ?? []) {
    sendRaw(c, "SESSION_REVOKED", { reason });
    c.ws.close(4004, reason);
  }
  await closeSfuSession(sessionId);
}
export async function closeUser(uid: string, reason = "Signed out") {
  for (const c of byUser.get(uid) ?? []) { sendRaw(c, "SESSION_REVOKED", { reason }); c.ws.close(4004, reason); }
  await closeSfuAccount(uid);
}

/* -------------------------------------------------------------- voice -- */
export const voiceStates = () => [...voice.values()];
export const voiceStateOf = (uid: string) => voice.get(uid) ?? null;

async function voiceAudience(channelId: string): Promise<{ ch: ChanRow | null }> {
  return { ch: await getChannel(channelId) };
}

type VoiceListener = (uid: string, prev: VoiceState | null, next: VoiceState | null) => Promise<void> | void;
const voiceListeners: VoiceListener[] = [];
export const onVoiceChange = (fn: VoiceListener) => { voiceListeners.push(fn); };

async function voiceUser(uid: string) {
  const r = await q<any>(`select ${USER_COLS} from users u where id = $1`, [uid]);
  return r[0] ? userOut(r[0]) : null;
}

export async function publishVoice(uid: string, prev: VoiceState | null, next: VoiceState | null) {
  // Tell people first (this is what moves the name tag under the channel), then run the
  // slower bookkeeping (call records, ringing) — it must never hold the update back.
  const chIds = new Set([prev?.channel_id, next?.channel_id].filter(Boolean) as string[]);
  // Include who it is, so every client can show the name and picture (even people it hasn't loaded yet).
  const payload = next ? { ...next, user: await voiceUser(uid) } : { user_id: uid, channel_id: null, guild_id: prev?.guild_id ?? null };
  await Promise.all([...chIds].map(async (id) => {
    const { ch } = await voiceAudience(id);
    if (ch) await toChannel(ch, "VOICE_STATE_UPDATE", payload);
  })).catch((e) => console.error("[voice publish]", e));
  for (const fn of voiceListeners) await Promise.resolve(fn(uid, prev, next)).catch((e) => console.error("[voice listener]", e));
}

export async function setVoice(uid: string, sessionId: string, d: any): Promise<string | null> {
  const prev = voice.get(uid) ?? null;
  if (!d?.channel_id) {
    if (prev) {
      voice.delete(uid);
      // Announce the leave immediately; closing the media session talks to the SFU and can take seconds.
      await publishVoice(uid, prev, null);
      removeFromRoom(prev.channel_id, uid).catch((e) => console.error("[voice leave]", e));
    }
    return null;
  }
  const ch = await getChannel(String(d.channel_id));
  if (!ch || !(isVoiceType(ch.type) || isDmType(ch.type))) return "Not a voice channel.";
  const perms = await permsFor(uid, ch);
  if (!has(perms, P.VIEW_CHANNEL) || !has(perms, P.CONNECT)) return "You can't join this voice channel.";
  const member = ch.guild_id ? (await q<any>("select mute, deaf from members where guild_id = $1 and user_id = $2", [ch.guild_id, uid]))[0] : null;
  const next: VoiceState & { session_id: string } = {
    user_id: uid, channel_id: ch.id, guild_id: ch.guild_id, session_id: sessionId,
    self_mute: !!d.self_mute, self_deaf: !!d.self_deaf, self_video: !!d.self_video && has(perms, P.VIDEO), self_stream: !!d.self_stream && has(perms, P.VIDEO),
    server_mute: !!member?.mute || !has(perms, P.SPEAK), server_deaf: !!member?.deaf,
  };
  if (ch.type === ChannelType.STAGE) {
    // Stage: everyone joins the audience; speakers stay speakers while they remain in the channel.
    const same = prev && prev.channel_id === ch.id;
    next.suppress = same ? prev!.suppress ?? true : true;
    next.request_to_speak_at = same ? prev!.request_to_speak_at ?? null : null;
  }
  if (prev && prev.channel_id === ch.id && prev.activity_id) next.activity_id = prev.activity_id;
  voice.set(uid, next);
  await publishVoice(uid, prev && prev.channel_id !== next.channel_id ? prev : null, next);
  return null;
}

/** Change stage/activity fields of a live voice state (stage moderation, activities). */
export async function patchVoice(uid: string, patch: Partial<VoiceState>) {
  const cur = voice.get(uid);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  voice.set(uid, next);
  await publishVoice(uid, null, next);
  return next;
}

/** Drop a user from voice (kick, ban, lost CONNECT). Media is cut by media.ts. */
export async function dropVoice(uid: string) {
  const prev = voice.get(uid);
  if (!prev) return;
  voice.delete(uid);
  await publishVoice(uid, prev, null);
  toUser(uid, "VOICE_DISCONNECTED", { channel_id: prev.channel_id });
}

/* ------------------------------------------------------------- server -- */
export function attachGateway(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/gateway")) return;
    const origin = req.headers.origin;
    if (origin && !allowedOrigins().has(origin)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
  });

  const ping = setInterval(() => {
    for (const set of byUser.values()) for (const c of set) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false; c.ws.ping();
    }
  }, 30_000);
  ping.unref();
  return wss;
}

async function onConnection(ws: WebSocket, req: IncomingMessage) {
  let conn: Conn | null = null;
  const identify = async (token: string | null) => {
    const sess = token ? await sessionFromToken(token, req.socket.remoteAddress ?? null, String(req.headers["user-agent"] ?? "")) : null;
    if (!sess || sess.mfa_pending) { ws.close(4001, "Not signed in"); return; }
    conn = { ws, userId: sess.user_id, sessionId: sess.id, seq: 0, alive: true };
    const first = !byUser.has(conn.userId);
    if (!byUser.has(conn.userId)) byUser.set(conn.userId, new Set());
    byUser.get(conn.userId)!.add(conn);
    if (!bySession.has(conn.sessionId)) bySession.set(conn.sessionId, new Set());
    bySession.get(conn.sessionId)!.add(conn);
    if (first) {
      status.set(conn.userId, sess.status);
      const own = (await q<{ custom_status: CustomStatus | null }>("select custom_status from users where id = $1", [conn.userId]))[0];
      if (own?.custom_status) customStatuses.set(conn.userId, own.custom_status); else customStatuses.delete(conn.userId);
    }
    const presences: Record<string, string> = {};
    const acts: Record<string, unknown> = {};
    const statuses: Record<string, unknown> = {};
    for (const uid of await presenceAudience(conn.userId)) {
      presences[uid] = presenceOf(uid); const a = activities.get(uid); if (a && presences[uid] !== "offline") acts[uid] = a;
      const cs = presences[uid] !== "offline" ? liveStatus(customStatuses.get(uid)) : null; if (cs) statuses[uid] = cs;
    }
    const vs = voiceStates().filter(Boolean);
    // Only voice states in channels this user can see.
    const visible: VoiceState[] = [];
    for (const v of vs) {
      const ch = await getChannel(v.channel_id);
      if (ch && has(await permsFor(conn.userId, ch), P.VIEW_CHANNEL)) visible.push({ ...v, user: await voiceUser(v.user_id) } as VoiceState);
    }
    sendRaw(conn, "READY", { ...(await buildReady(conn.userId, conn.sessionId, presences, visible)), activities: acts, custom_statuses: statuses });
    if (first) await broadcastPresence(conn.userId);
  };

  ws.on("pong", () => { if (conn) conn.alive = true; });
  ws.on("message", async (raw) => {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    try {
      if (msg.op === "identify" && !conn) return await identify(typeof msg.token === "string" ? msg.token : null);
      if (!conn) return;
      conn.alive = true;
      if (msg.op === "heartbeat") return ws.send(JSON.stringify({ op: "heartbeat_ack" }));
      if (msg.op === "status" && ["online", "idle", "dnd", "invisible"].includes(msg.d?.status)) {
        await q("update users set status = $2 where id = $1", [conn.userId, msg.d.status]);
        return await setStatus(conn.userId, msg.d.status);
      }
      if (msg.op === "call_signal") {
        // Peer-to-peer call setup (offer/answer/ICE/state). Only between two people in the same voice channel.
        const d = msg.d ?? {};
        if (typeof d.to !== "string" || typeof d.type !== "string" || !/^(offer|answer|ice|state|knock|bye)$/.test(d.type)) return;
        const mine = voice.get(conn.userId), theirs = voice.get(d.to);
        if (!mine || !theirs || mine.channel_id !== theirs.channel_id || mine.session_id !== conn.sessionId) return;
        const payload = JSON.stringify(d.data ?? null);
        if (payload.length > 60_000) return;
        toUser(d.to, "CALL_SIGNAL", { from: conn.userId, channel_id: mine.channel_id, type: d.type, data: d.data ?? null });
        return;
      }
      if (msg.op === "afk") {
        // Automatic idle after inactivity: only changes how "online" looks, never the chosen status.
        const chosen = (await q<any>("select status from users where id = $1", [conn.userId]))[0]?.status ?? "online";
        if (chosen !== "online") return;
        const want = msg.d?.afk ? "idle" : "online";
        if (status.get(conn.userId) !== want) await setStatus(conn.userId, want);
        return;
      }
      if (msg.op === "activity") {
        // Start/join/leave an activity in my voice channel.
        const id = msg.d?.activity_id;
        if (id !== null && (typeof id !== "string" || !/^[a-z0-9_-]{2,40}$/i.test(id))) return;
        const mine = voice.get(conn.userId);
        if (!mine || mine.session_id !== conn.sessionId) return;
        await patchVoice(conn.userId, { activity_id: id });
        return;
      }
      if (msg.op === "activity_event") {
        // Shared state of an activity (video position, strokes, moves), relayed to everyone in it.
        const mine = voice.get(conn.userId);
        if (!mine?.activity_id || mine.session_id !== conn.sessionId) return;
        const payload = JSON.stringify(msg.d ?? null);
        if (payload.length > 16_000) return;
        const now = Date.now();
        const bucket = (conn as any).actRate ?? { at: now, n: 0 };
        if (now - bucket.at > 1000) { bucket.at = now; bucket.n = 0; }
        if (++bucket.n > 30) return;
        (conn as any).actRate = bucket;
        for (const v of voice.values()) if (v.channel_id === mine.channel_id && v.activity_id === mine.activity_id && v.user_id !== conn.userId)
          toUser(v.user_id, "ACTIVITY_EVENT", { from: conn.userId, channel_id: mine.channel_id, activity_id: mine.activity_id, data: msg.d ?? null });
        return;
      }
      if (msg.op === "presence_activity") {
        // "Playing …" from the desktop app or a bot. Validated and kept in memory only.
        const a = msg.d;
        const clean = a && typeof a.name === "string" && a.name.trim() ? {
          type: [0, 1, 2, 3, 5].includes(a.type) ? a.type : 0, name: String(a.name).slice(0, 128), details: typeof a.details === "string" ? a.details.slice(0, 128) : null,
          state: typeof a.state === "string" ? a.state.slice(0, 128) : null, started_at: Number.isFinite(a.started_at) ? Number(a.started_at) : Date.now(),
          url: typeof a.url === "string" && /^https:\/\//.test(a.url) ? a.url.slice(0, 300) : null,
        } : null;
        const prefs = await q<any>("select settings->>'share_activity' as share from users where id = $1", [conn.userId]);
        if (prefs[0]?.share === "false" && clean) return;
        if (clean) activities.set(conn.userId, clean); else activities.delete(conn.userId);
        await broadcastPresence(conn.userId);
        return;
      }
      if (msg.op === "voice_state") {
        const err = await setVoice(conn.userId, conn.sessionId, msg.d);
        if (err) ws.send(JSON.stringify({ op: "error", d: { op: "voice_state", message: err } }));
        return;
      }
    } catch (e) {
      ws.send(JSON.stringify({ op: "error", d: { message: "Something went wrong." } }));
      console.error("[gateway]", e);
    }
  });
  ws.on("close", async () => {
    const c = conn as Conn | null;
    if (!c) return;
    byUser.get(c.userId)?.delete(c);
    bySession.get(c.sessionId)?.delete(c);
    if (!bySession.get(c.sessionId)?.size) bySession.delete(c.sessionId);
    const v = voice.get(c.userId);
    if (v && v.session_id === c.sessionId) { voice.delete(c.userId); await publishVoice(c.userId, v, null).catch(() => {}); }
    if (!byUser.get(c.userId)?.size) {
      byUser.delete(c.userId);
      status.delete(c.userId);
      activities.delete(c.userId); customStatuses.delete(c.userId);
      await broadcastPresence(c.userId).catch(() => {});
    }
  });

  ws.send(JSON.stringify({ op: "hello", d: { heartbeat_interval: 30_000 } }));
  const cookieToken = tokenFromCookieHeader(req.headers.cookie);
  if (cookieToken) await identify(cookieToken);
  else setTimeout(() => { if (!conn) ws.close(4001, "Identify timeout"); }, 10_000).unref();
}

export { ChannelType };
