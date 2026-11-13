/**
 * Native push for the SEND apps.
 * Android: Firebase Cloud Messaging HTTP v1, authorised with a service account (SEND_FCM_SERVICE_ACCOUNT, the JSON key).
 * iOS: Apple Push Notification service with a token key (SEND_APNS_KEY = the .p8 file, SEND_APNS_KEY_ID, SEND_APNS_TEAM_ID,
 *      optional SEND_APNS_TOPIC, default space.makz.send). Each device says whether it's a development (sandbox) build.
 * Both are optional: without their keys, device tokens are still saved and simply not used.
 */
import { createSign, createPrivateKey, sign as edSign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import { q } from "./db.ts";

export interface PushPayload { title: string; body: string; tag?: string; url?: string; icon?: string }

/* ---------------------------------------------------------------- Firebase (Android) */
interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }
/** Why Firebase isn't usable, for /api/push/key (never includes the key itself). */
export let fcmProblem: null | "missing" | "not_json" | "missing_fields" | "bad_key" = null;
const fcmAccount: ServiceAccount | null = (() => {
  let raw = (process.env.SEND_FCM_SERVICE_ACCOUNT ?? "").trim();
  if (!raw) { fcmProblem = "missing"; return null; }
  // Accept the file pasted as-is, wrapped in quotes, or base64-encoded.
  if (/^['"`]/.test(raw) && raw.at(-1) === raw[0]) raw = raw.slice(1, -1).trim();
  if (!raw.startsWith("{")) { try { const d = Buffer.from(raw, "base64").toString("utf8").trim(); if (d.startsWith("{")) raw = d; } catch { /* not base64 */ } }
  let j: any;
  try { j = JSON.parse(raw); } catch { fcmProblem = "not_json"; console.error("push: SEND_FCM_SERVICE_ACCOUNT must be the whole service account JSON file"); return null; }
  if (!j?.project_id || !j?.client_email || !j?.private_key) { fcmProblem = "missing_fields"; return null; }
  j.private_key = String(j.private_key).replace(/\\n/g, "\n");
  try { createPrivateKey(j.private_key); } catch { fcmProblem = "bad_key"; return null; }
  return j as ServiceAccount;
})();
export const fcmReady = !!fcmAccount;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
let fcmToken: { value: string; exp: number } | null = null;
async function fcmAccess(): Promise<string> {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.value;
  const a = fcmAccount!, now = Math.floor(Date.now() / 1000), aud = a.token_uri ?? "https://oauth2.googleapis.com/token";
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: a.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud, iat: now, exp: now + 3600 }))}`;
  const jwt = `${unsigned}.${b64url(createSign("RSA-SHA256").update(unsigned).sign(a.private_key))}`;
  const r = await fetch(aud, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  const j = await r.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!j.access_token) throw new Error(`fcm auth failed: ${j.error ?? r.status}`);
  fcmToken = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}
/** Returns false when the token is dead and should be forgotten. */
async function sendFcm(token: string, p: PushPayload): Promise<boolean> {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmAccount!.project_id}/messages:send`, {
    method: "POST", headers: { authorization: `Bearer ${await fcmAccess()}`, "content-type": "application/json" },
    // Data only: the app draws the notification itself (avatar, grouping per conversation, opening the right channel).
    body: JSON.stringify({ message: { token, data: { title: p.title, body: p.body, tag: p.tag ?? "", url: p.url ?? "", icon: p.icon ?? "" }, android: { priority: "HIGH", ttl: "3600s" } } }),
  });
  if (r.ok) return true;
  const err = await r.text();
  if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token|registration-token-not-registered/i.test(err)) return false;
  throw new Error(`fcm ${r.status}: ${err.slice(0, 200)}`);
}

/* ---------------------------------------------------------------- Apple (iOS) */
const apns = (() => {
  const key = (process.env.SEND_APNS_KEY ?? "").replace(/\\n/g, "\n"), keyId = process.env.SEND_APNS_KEY_ID ?? "", team = process.env.SEND_APNS_TEAM_ID ?? "";
  if (!key || !keyId || !team) return null;
  try { return { key: createPrivateKey(key), keyId, team, topic: process.env.SEND_APNS_TOPIC || "space.makz.send" }; }
  catch { console.error("push: SEND_APNS_KEY isn't a valid .p8 key"); return null; }
})();
export const apnsReady = !!apns;
let apnsJwt: { value: string; at: number } | null = null;
function apnsAuth() {
  // Apple wants a fresh token at most hourly and at least every 20 minutes apart; 40 minutes is safe.
  if (apnsJwt && Date.now() - apnsJwt.at < 40 * 60_000) return apnsJwt.value;
  const unsigned = `${b64url(JSON.stringify({ alg: "ES256", kid: apns!.keyId }))}.${b64url(JSON.stringify({ iss: apns!.team, iat: Math.floor(Date.now() / 1000) }))}`;
  const sig = edSign("sha256", Buffer.from(unsigned), { key: apns!.key, dsaEncoding: "ieee-p1363" });
  apnsJwt = { value: `${unsigned}.${b64url(sig)}`, at: Date.now() };
  return apnsJwt.value;
}
const sessions = new Map<string, ClientHttp2Session>();
function apnsSession(sandbox: boolean) {
  const host = sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  let s = sessions.get(host);
  if (!s || s.closed || s.destroyed) {
    s = connect(host);
    s.on("error", () => sessions.delete(host)); s.on("close", () => sessions.delete(host));
    s.setTimeout(10 * 60_000, () => s!.close());
    sessions.set(host, s);
  }
  return s;
}
function sendApns(token: string, sandbox: boolean, p: PushPayload): Promise<boolean> {
  const body = JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default", "thread-id": p.tag || undefined, "mutable-content": 1 }, url: p.url ?? "", icon: p.icon ?? "" });
  return new Promise((resolve, reject) => {
    const req = apnsSession(sandbox).request({ ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${apnsAuth()}`,
      "apns-topic": apns!.topic, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600) });
    let status = 0, data = "";
    req.setTimeout(10_000, () => { req.close(); reject(new Error("apns timeout")); });
    req.on("response", (h) => { status = Number(h[":status"]); });
    req.on("data", (c) => { data += c; });
    req.on("end", () => {
      if (status === 200) return resolve(true);
      if (status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(data)) return resolve(false);
      reject(new Error(`apns ${status}: ${data.slice(0, 200)}`));
    });
    req.on("error", reject);
    req.end(body);
  });
}

/* ---------------------------------------------------------------- fan out */
export const nativeReady = () => fcmReady || apnsReady;
export async function sendNative(users: string[], p: PushPayload) {
  if (!users.length || !nativeReady()) return;
  const devices = await q<any>("select id::text, platform, token, sandbox from device_push_tokens where user_id = any($1::bigint[])", [users]);
  await Promise.all(devices.map(async (d) => {
    try {
      const alive = d.platform === "android" ? (fcmReady ? await sendFcm(d.token, p) : true) : (apnsReady ? await sendApns(d.token, d.sandbox, p) : true);
      if (alive) await q("update device_push_tokens set last_ok_at = now() where id = $1", [d.id]);
      else await q("delete from device_push_tokens where id = $1", [d.id]);
    } catch (e) { console.error("push", d.platform, e instanceof Error ? e.message : e); }
  }));
}
