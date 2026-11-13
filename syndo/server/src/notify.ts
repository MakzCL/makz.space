import type { FastifyInstance } from "fastify";
import webpush from "web-push";
import { z } from "zod";
import { MessageType, type Message } from "@send/shared";
import { q, q1 } from "./db.ts";
import { requireUser, uid } from "./auth.ts";
import { bad } from "./errors.ts";
import { newId } from "./ids.ts";
import { isOnline, presenceOf, toUser } from "./gateway.ts";
import { viewers, type ChanRow } from "./perms.ts";
import { PREFIX } from "./routes/encryption.ts";
import { apnsReady, fcmReady, nativeReady, sendNative, type PushPayload } from "./nativePush.ts";

/**
 * Notification settings (levels, timed mutes, suppress @everyone/@here and role mentions,
 * hide muted channels) and Web Push for when SEND isn't open.
 *
 * Levels: 0 all messages, 1 only @mentions, 2 nothing; a channel setting overrides its server.
 * Defaults: servers → only @mentions; direct messages → all messages.
 * Push goes to people with no open SEND window (or idle), never to Do Not Disturb, never to the author.
 */

const VAPID_PUBLIC = process.env.SEND_VAPID_PUBLIC ?? "";
const VAPID_PRIVATE = process.env.SEND_VAPID_PRIVATE ?? "";
const VAPID_SUBJECT = process.env.SEND_VAPID_SUBJECT ?? "mailto:admin@syndo.makz.space";
const pushReady = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (pushReady) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

interface Setting { scope_id: string; scope_kind: number; level: number | null; muted: boolean; muted_until: string | null; suppress_everyone: boolean; suppress_roles: boolean; mobile_push: boolean }
const isMuted = (s: Setting | undefined) => !!s?.muted && (!s.muted_until || new Date(s.muted_until).getTime() > Date.now());

/** Who should be pushed for this message, honouring every setting. */
export async function pushTargets(channel: ChanRow, msg: Message, info: { author: string; everyone: boolean; users: string[]; roles: string[]; silent: boolean }) {
  if (info.silent) return [];
  const dm = !channel.guild_id;
  let candidates: string[];
  if (dm) candidates = (await q<any>("select user_id::text from channel_recipients where channel_id = $1", [channel.id])).map((r) => r.user_id);
  else {
    // Everyone mentioned, plus anyone who chose "all messages" for this server or channel.
    const all = await q<any>(`select distinct user_id::text from notification_settings where scope_id = any($1::bigint[]) and level = 0`, [[channel.guild_id, channel.id, channel.parent_id].filter(Boolean)]);
    const roleUsers = info.roles.length ? await q<any>("select distinct user_id::text from member_roles where guild_id = $1 and role_id = any($2::bigint[])", [channel.guild_id, info.roles]) : [];
    const everyoneUsers = info.everyone ? await q<any>(`select user_id::text from (select user_id from push_subscriptions union select user_id from device_push_tokens) ps
      where exists (select 1 from members m where m.guild_id = $1 and m.user_id = ps.user_id)`, [channel.guild_id]) : [];
    candidates = [...info.users, ...all.map((r) => r.user_id), ...roleUsers.map((r) => r.user_id), ...everyoneUsers.map((r) => r.user_id)];
  }
  candidates = [...new Set(candidates)].filter((u) => u !== info.author);
  if (!candidates.length) return [];
  // Only people with a push subscription who aren't actively using SEND.
  const subs = await q<any>(`select distinct user_id::text from (select user_id from push_subscriptions union select user_id from device_push_tokens) x
    where user_id = any($1::bigint[])`, [candidates]);
  candidates = subs.map((r) => r.user_id).filter((u) => presenceOf(u) !== "dnd" && (!isOnline(u) || presenceOf(u) === "idle"));
  if (!candidates.length) return [];
  const blocked = new Set((await q<any>("select user_id::text from relationships where type = 2 and other_id = $1 and user_id = any($2::bigint[])", [info.author, candidates])).map((r) => r.user_id));
  const scopes = dm ? ["0"] : [channel.guild_id!, channel.id, ...(channel.parent_id ? [String(channel.parent_id)] : [])];
  const settings = await q<Setting & { user_id: string }>("select user_id::text, scope_id::text, scope_kind, level, muted, muted_until, suppress_everyone, suppress_roles, mobile_push from notification_settings where user_id = any($1::bigint[]) and scope_id = any($2::bigint[])", [candidates, scopes]);
  const vis = await viewers(channel, candidates);
  const out: string[] = [];
  for (const u of candidates) {
    if (blocked.has(u) || !vis.has(u)) continue;
    const mine = settings.filter((s) => s.user_id === u);
    const ch = mine.find((s) => s.scope_id === String(channel.id));
    const cat = channel.parent_id ? mine.find((s) => s.scope_id === String(channel.parent_id)) : undefined;
    const top = mine.find((s) => s.scope_id === (dm ? "0" : String(channel.guild_id)));
    if (isMuted(ch) || isMuted(cat) || (!ch?.level && isMuted(top))) continue;
    if (top && top.mobile_push === false) continue;
    const level = ch?.level ?? cat?.level ?? top?.level ?? (dm ? 0 : 1);
    if (level === 2) continue;
    const direct = info.users.includes(u);
    const viaEveryone = info.everyone && !top?.suppress_everyone;
    const viaRole = info.roles.length > 0 && !top?.suppress_roles;
    if (level === 1 && !dm && !direct && !viaEveryone && !viaRole) continue;
    out.push(u);
  }
  return out;
}

export async function notifyMessage(channel: ChanRow, msg: Message, info: { author: string; everyone: boolean; users: string[]; roles: string[]; silent: boolean }) {
  if (!(pushReady || nativeReady()) || msg.type !== MessageType.DEFAULT && msg.type !== MessageType.REPLY) return;
  const targets = await pushTargets(channel, msg, info);
  if (!targets.length) return;
  const who = msg.member_nick || msg.author.display_name || msg.author.username;
  const encrypted = msg.content.startsWith(PREFIX);
  const guild = channel.guild_id ? await q1<any>("select name from guilds where id = $1", [channel.guild_id]) : null;
  const body = encrypted ? "New message" : (msg.content.replace(/<a?:(\w+):\d+>/g, ":$1:").replace(/<@!?\d+>/g, "@someone").slice(0, 180) || (msg.attachments.length ? "Sent an attachment" : msg.poll ? `Poll: ${msg.poll.question}` : "New message"));
  const payload = JSON.stringify({
    title: guild ? `${who} (#${channel.name}, ${guild.name})` : who,
    body, tag: `ch-${channel.id}`, icon: msg.author.avatar ?? "/brand/send-icon-192.png",
    url: `/channels/${channel.guild_id ?? "@me"}/${channel.id}/${msg.id}`,
  });
  await sendPush(targets, payload);
}

/** Sends to every browser subscription (Web Push) and every app (Android and iOS) the users have. `payload` is JSON. */
export async function sendPush(users: string[], payload: string) {
  if (!users.length) return;
  let p: PushPayload | null = null;
  try { p = JSON.parse(payload); } catch { /* not JSON: browsers only */ }
  await Promise.all([sendWeb(users, payload), p?.title ? sendNative(users, p) : Promise.resolve()]);
}
async function sendWeb(users: string[], payload: string) {
  if (!pushReady) return;
  const subs = await q<any>("select id::text, endpoint, p256dh, auth from push_subscriptions where user_id = any($1::bigint[])", [users]);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: "high" });
      await q("update push_subscriptions set last_ok_at = now() where id = $1", [s.id]);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await q("delete from push_subscriptions where id = $1", [s.id]);
    }
  }));
}

const SETTING = z.object({
  scope_kind: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]).optional(),
  muted: z.boolean().optional(),
  /** Minutes to mute for (15, 60, 480, 1440, …); null = until I turn it back on. */
  mute_minutes: z.number().int().min(1).max(60 * 24 * 365).nullable().optional(),
  suppress_everyone: z.boolean().optional(),
  suppress_roles: z.boolean().optional(),
  hide_muted: z.boolean().optional(),
  mobile_push: z.boolean().optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/users/@me/notification-settings", async (req) =>
    q("select scope_id::text, scope_kind, level, muted, muted_until, suppress_everyone, suppress_roles, hide_muted, mobile_push from notification_settings where user_id = $1", [uid(req)]));

  /** scope: a server id, a channel/category id, or "dms". */
  app.put<{ Params: { scope: string } }>("/api/users/@me/notification-settings/:scope", async (req) => {
    const me = uid(req);
    const b = SETTING.parse(req.body);
    const scope = req.params.scope === "dms" ? "0" : req.params.scope;
    if (!/^\d{1,20}$/.test(scope)) throw bad("Invalid scope.");
    if (b.scope_kind === 0 && !(await q1("select 1 from members where guild_id = $1 and user_id = $2", [scope, me]))) throw bad("You're not in that server.");
    if (b.scope_kind === 1) {
      const { requireChannel } = await import("./perms.ts");
      await requireChannel(me, scope);
    }
    const cur = await q1<any>("select * from notification_settings where user_id = $1 and scope_id = $2", [me, scope]);
    const mutedUntil = b.muted === undefined ? cur?.muted_until ?? null : b.muted && b.mute_minutes ? new Date(Date.now() + b.mute_minutes * 60_000).toISOString() : null;
    const row = await q1<any>(`insert into notification_settings(user_id, scope_id, scope_kind, level, muted, muted_until, suppress_everyone, suppress_roles, hide_muted, mobile_push)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (user_id, scope_id) do update set level = excluded.level, muted = excluded.muted, muted_until = excluded.muted_until,
        suppress_everyone = excluded.suppress_everyone, suppress_roles = excluded.suppress_roles, hide_muted = excluded.hide_muted, mobile_push = excluded.mobile_push
      returning scope_id::text, scope_kind, level, muted, muted_until, suppress_everyone, suppress_roles, hide_muted, mobile_push`,
      [me, scope, b.scope_kind, b.level === undefined ? cur?.level ?? null : b.level, b.muted ?? cur?.muted ?? false, mutedUntil,
       b.suppress_everyone ?? cur?.suppress_everyone ?? false, b.suppress_roles ?? cur?.suppress_roles ?? false, b.hide_muted ?? cur?.hide_muted ?? false, b.mobile_push ?? cur?.mobile_push ?? true]);
    toUser(me, "NOTIFICATION_SETTINGS_UPDATE", row);
    return row;
  });

  app.get("/api/push/key", async () => ({ key: pushReady ? VAPID_PUBLIC : null, native: { android: fcmReady, ios: apnsReady } }));

  /** The Android and iOS apps register their push token here (one row per device; a token moves to whoever signs in on it). */
  app.post("/api/push/devices", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const b = z.object({ platform: z.enum(["android", "ios"]), token: z.string().min(16).max(4096).regex(/^[A-Za-z0-9:_\-.]+$/), sandbox: z.boolean().optional(), app_version: z.string().max(40).optional() }).parse(req.body);
    await q(`insert into device_push_tokens(id, user_id, platform, token, sandbox, app_version) values ($1,$2,$3,$4,$5,$6)
             on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, sandbox = excluded.sandbox, app_version = excluded.app_version`,
      [newId(), uid(req), b.platform, b.token, b.sandbox ?? false, b.app_version ?? null]);
    return { ok: true, active: b.platform === "android" ? fcmReady : apnsReady };
  });
  app.delete("/api/push/devices", async (req) => {
    const b = z.object({ token: z.string().max(4096) }).parse(req.body);
    await q("delete from device_push_tokens where user_id = $1 and token = $2", [uid(req), b.token]);
    return { ok: true };
  });
  app.post("/api/push/subscriptions", async (req) => {
    if (!pushReady) throw bad("Push notifications aren't set up on this server yet.");
    const b = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(req.body);
    if (!/^https:\/\//.test(b.endpoint)) throw bad("Invalid push endpoint.");
    await q(`insert into push_subscriptions(id, user_id, endpoint, p256dh, auth, user_agent) values ($1,$2,$3,$4,$5,$6)
             on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      [newId(), uid(req), b.endpoint, b.keys.p256dh, b.keys.auth, String(req.headers["user-agent"] ?? "").slice(0, 300)]);
    return { ok: true };
  });
  app.delete("/api/push/subscriptions", async (req) => {
    const b = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await q("delete from push_subscriptions where user_id = $1 and endpoint = $2", [uid(req), b.endpoint]);
    return { ok: true };
  });
  app.post("/api/push/test", async (req) => {
    await sendPush([uid(req)], JSON.stringify({ title: "SEND", body: "Push notifications are working.", tag: "test", url: "/channels/@me" }));
    return { ok: true };
  });
}
