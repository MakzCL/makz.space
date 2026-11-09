import type { FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { z } from "zod";
import { q, q1 } from "../db.ts";
import { createSession, requireUser, setCookie, uid } from "../auth.ts";
import { allowedOrigins, config } from "../config.ts";
import { randomToken } from "../crypto.ts";
import { ApiError, bad, notFound, unauthorized } from "../errors.ts";
import { USER_COLS, selfOut, userOut } from "../serialize.ts";
import { safeFetch } from "../unfurl.ts";

/**
 * Passkeys (WebAuthn: Windows Hello, Touch ID, phone), QR-code sign-in from a signed-in phone,
 * and profile Connections (OAuth with each service; Steam uses OpenID and needs no key).
 */

const rpID = () => new URL(config.publicUrl).hostname;
const origins = () => [...allowedOrigins()];

/* -------------------------------------------------------------------------- connections -- */
interface Provider { name: string; authorize: string; token: string; scope: string; env: string; profile: (token: string) => Promise<{ id: string; name: string; url: string | null }> }
const getJson = async (url: string, token: string) => {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, "user-agent": "SEND", accept: "application/json", "client-id": process.env.SYNDO_TWITCH_CLIENT_ID ?? "" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw bad("The service didn't share your profile.");
  return r.json() as Promise<any>;
};
export const PROVIDERS: Record<string, Provider> = {
  github: { name: "GitHub", authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", scope: "read:user", env: "GITHUB",
    profile: async (t) => { const j = await getJson("https://api.github.com/user", t); return { id: String(j.id), name: j.login, url: j.html_url }; } },
  twitch: { name: "Twitch", authorize: "https://id.twitch.tv/oauth2/authorize", token: "https://id.twitch.tv/oauth2/token", scope: "", env: "TWITCH",
    profile: async (t) => { const j = (await getJson("https://api.twitch.tv/helix/users", t)).data?.[0]; return { id: String(j.id), name: j.display_name ?? j.login, url: `https://twitch.tv/${j.login}` }; } },
  spotify: { name: "Spotify", authorize: "https://accounts.spotify.com/authorize", token: "https://accounts.spotify.com/api/token", scope: "user-read-private user-read-currently-playing", env: "SPOTIFY",
    profile: async (t) => { const j = await getJson("https://api.spotify.com/v1/me", t); return { id: String(j.id), name: j.display_name ?? j.id, url: j.external_urls?.spotify ?? null }; } },
  reddit: { name: "Reddit", authorize: "https://www.reddit.com/api/v1/authorize", token: "https://www.reddit.com/api/v1/access_token", scope: "identity", env: "REDDIT",
    profile: async (t) => { const j = await getJson("https://oauth.reddit.com/api/v1/me", t); return { id: String(j.id), name: `u/${j.name}`, url: `https://reddit.com/user/${j.name}` }; } },
  youtube: { name: "YouTube", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/youtube.readonly", env: "GOOGLE",
    profile: async (t) => { const j = (await getJson("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", t)).items?.[0]; if (!j) throw bad("No YouTube channel on that account."); return { id: j.id, name: j.snippet?.title ?? j.id, url: `https://youtube.com/channel/${j.id}` }; } },
  xbox: { name: "Xbox", authorize: "https://login.live.com/oauth20_authorize.srf", token: "https://login.live.com/oauth20_token.srf", scope: "XboxLive.signin offline_access", env: "XBOX",
    profile: async () => { throw bad("Xbox connections need Microsoft partner approval and aren't available yet."); } },
};
const creds = (p: Provider) => ({ id: process.env[`SYNDO_${p.env}_CLIENT_ID`] ?? "", secret: process.env[`SYNDO_${p.env}_CLIENT_SECRET`] ?? "" });
const STATE_KEY = process.env.SYNDO_SECRET || randomToken(32);
const signState = (userId: string, type: string) => { const exp = Date.now() + 600_000; const body = `${userId}.${type}.${exp}`; return `${body}.${createHmac("sha256", STATE_KEY).update(body).digest("base64url").slice(0, 24)}`; };
const readState = (state: string) => {
  const [u, t, exp, sig] = state.split(".");
  if (!u || !t || !exp || !sig || Number(exp) < Date.now()) return null;
  return createHmac("sha256", STATE_KEY).update(`${u}.${t}.${exp}`).digest("base64url").slice(0, 24) === sig ? { userId: u, type: t } : null;
};
const callback = (type: string) => `${config.publicUrl}/api/connections/${type}/callback`;

export async function signinRoutes(app: FastifyInstance) {
  /* ------------------------------------------------------------- passkeys: sign in -- */
  app.post("/api/auth/passkeys/login/options", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async () => {
    const opts = await generateAuthenticationOptions({ rpID: rpID(), userVerification: "preferred", allowCredentials: [] });
    const id = randomToken(18);
    await q("insert into auth_challenges(id, kind, challenge, expires_at) values ($1,'passkey_login',$2, now() + interval '5 minutes')", [id, opts.challenge]);
    return { challenge_id: id, options: opts };
  });
  app.post("/api/auth/passkeys/login/verify", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({ challenge_id: z.string().max(40), response: z.any() }).parse(req.body);
    const ch = await q1<any>("update auth_challenges set status = 'used' where id = $1 and kind = 'passkey_login' and status = 'pending' and expires_at > now() returning challenge", [b.challenge_id]);
    if (!ch) throw bad("That sign-in took too long. Try again.");
    const pk = await q1<any>("select * from passkeys where id = $1", [String(b.response?.id ?? "")]);
    if (!pk) throw new ApiError(401, "unknown_passkey", "That passkey isn't registered with SEND.");
    const v = await verifyAuthenticationResponse({ response: b.response, expectedChallenge: ch.challenge, expectedOrigin: origins(), expectedRPID: rpID(),
      credential: { id: pk.id, publicKey: new Uint8Array(pk.public_key), counter: Number(pk.counter), transports: pk.transports } }).catch(() => null);
    if (!v?.verified) throw new ApiError(401, "bad_passkey", "That passkey couldn't be verified.");
    await q("update passkeys set counter = $2, last_used_at = now() where id = $1", [pk.id, v.authenticationInfo.newCounter]);
    const u = await q1<any>("select * from users where id = $1 and deleted_at is null", [pk.user_id]);
    if (!u) throw unauthorized();
    // A passkey is already two factors (the device + its lock), so no extra code is asked.
    const s = await createSession(u.id, req, false);
    setCookie(reply, s.token);
    return { user: selfOut(u), token: s.token };
  });

  /* --------------------------------------------------------------- QR sign-in (new device) -- */
  app.post("/api/auth/qr", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async () => {
    const id = randomToken(18), secret = randomToken(24);
    await q("insert into auth_challenges(id, kind, challenge, expires_at) values ($1,'qr_login',$2, now() + interval '2 minutes')", [id, secret]);
    return { id, secret, url: `${config.publicUrl}/qr/${id}`, expires_in: 120 };
  });
  /** The new device checks whether its code was scanned/approved (every couple of seconds while it's shown). */
  app.post<{ Params: { id: string } }>("/api/auth/qr/:id/poll", { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { secret } = z.object({ secret: z.string().max(64) }).parse(req.body);
    const ch = await q1<any>("select * from auth_challenges where id = $1 and kind = 'qr_login' and challenge = $2", [req.params.id, secret]);
    if (!ch || new Date(ch.expires_at) < new Date()) return { status: "expired" };
    if (ch.status === "approved") {
      const used = await q1<any>("update auth_challenges set status = 'used' where id = $1 and status = 'approved' returning user_id::text", [ch.id]);
      if (!used) return { status: "expired" };
      const u = await q1<any>("select * from users where id = $1 and deleted_at is null", [used.user_id]);
      const s = await createSession(u.id, req, false);
      setCookie(reply, s.token);
      return { status: "approved", user: selfOut(u), token: s.token };
    }
    return { status: ch.status, user: ch.status === "scanned" ? ch.data?.user ?? null : null };
  });

  await app.register(async (r) => {
    r.addHook("preHandler", requireUser);

    /* ---------------------------------------------------------- passkeys: manage -- */
    r.get("/api/auth/passkeys", async (req) => q("select id, name, created_at, last_used_at from passkeys where user_id = $1 order by created_at", [uid(req)]));
    r.post("/api/auth/passkeys/register/options", async (req) => {
      const me = uid(req);
      const u = await q1<any>("select username, display_name from users where id = $1", [me]);
      const existing = await q<any>("select id, transports from passkeys where user_id = $1", [me]);
      if (existing.length >= 10) throw bad("You can have up to 10 passkeys.");
      const opts = await generateRegistrationOptions({
        rpName: "SEND", rpID: rpID(), userName: u.username, userDisplayName: u.display_name ?? u.username, userID: new TextEncoder().encode(me),
        attestationType: "none", excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      });
      const id = randomToken(18);
      await q("insert into auth_challenges(id, user_id, kind, challenge, expires_at) values ($1,$2,'passkey_register',$3, now() + interval '5 minutes')", [id, me, opts.challenge]);
      return { challenge_id: id, options: opts };
    });
    r.post("/api/auth/passkeys/register/verify", async (req) => {
      const me = uid(req);
      const b = z.object({ challenge_id: z.string().max(40), response: z.any(), name: z.string().trim().max(60).default("Passkey") }).parse(req.body);
      const ch = await q1<any>("update auth_challenges set status = 'used' where id = $1 and user_id = $2 and kind = 'passkey_register' and status = 'pending' and expires_at > now() returning challenge", [b.challenge_id, me]);
      if (!ch) throw bad("That took too long. Try again.");
      const v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: ch.challenge, expectedOrigin: origins(), expectedRPID: rpID(), requireUserVerification: false }).catch((e) => { throw bad(`The passkey couldn't be saved (${(e as Error).message}).`); });
      if (!v.verified || !v.registrationInfo) throw bad("The passkey couldn't be verified.");
      const c = v.registrationInfo.credential;
      await q("insert into passkeys(id, user_id, public_key, counter, transports, name) values ($1,$2,$3,$4,$5,$6)", [c.id, me, Buffer.from(c.publicKey), c.counter, c.transports ?? [], b.name || "Passkey"]);
      return { ok: true };
    });
    r.patch<{ Params: { id: string } }>("/api/auth/passkeys/:id", async (req) => {
      const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
      await q("update passkeys set name = $3 where id = $1 and user_id = $2", [req.params.id, uid(req), name]);
      return { ok: true };
    });
    r.delete<{ Params: { id: string } }>("/api/auth/passkeys/:id", async (req) => {
      await q("delete from passkeys where id = $1 and user_id = $2", [req.params.id, uid(req)]);
      return { ok: true };
    });

    /* ------------------------------------------------------- QR sign-in (signed-in phone) -- */
    r.post<{ Params: { id: string } }>("/api/auth/qr/:id/scan", async (req) => {
      const me = uid(req);
      const u = await q1<any>(`select ${USER_COLS} from users u where id = $1`, [me]);
      const ch = await q1<any>("update auth_challenges set status = 'scanned', user_id = $2, data = $3 where id = $1 and kind = 'qr_login' and status in ('pending','scanned') and expires_at > now() returning id", [req.params.id, me, JSON.stringify({ user: userOut(u) })]);
      if (!ch) throw notFound("Code");
      return { ok: true };
    });
    r.post<{ Params: { id: string } }>("/api/auth/qr/:id/approve", async (req) => {
      const ch = await q1<any>("update auth_challenges set status = 'approved' where id = $1 and kind = 'qr_login' and status = 'scanned' and user_id = $2 and expires_at > now() returning id", [req.params.id, uid(req)]);
      if (!ch) throw notFound("Code");
      return { ok: true };
    });
    r.post<{ Params: { id: string } }>("/api/auth/qr/:id/cancel", async (req) => {
      await q("update auth_challenges set status = 'cancelled' where id = $1 and kind = 'qr_login' and user_id = $2", [req.params.id, uid(req)]);
      return { ok: true };
    });

    /* ------------------------------------------------------------------ connections -- */
    r.get("/api/connections", async (req) => {
      const rows = await q<any>("select type, external_id, name, verified, visible, show_activity, metadata from user_connections where user_id = $1 order by created_at", [uid(req)]);
      return {
        connections: rows.map((c) => ({ type: c.type, id: c.external_id, name: c.name, verified: c.verified, visible: c.visible, show_activity: c.show_activity, url: c.metadata?.url ?? null })),
        available: [...Object.entries(PROVIDERS).map(([k, p]) => ({ type: k, name: p.name, ready: !!creds(p).id && k !== "xbox" })), { type: "steam", name: "Steam", ready: true }],
      };
    });
    r.get<{ Params: { type: string } }>("/api/connections/:type/authorize", async (req) => {
      const t = req.params.type;
      const state = signState(uid(req), t);
      if (t === "steam") {
        const p = new URLSearchParams({ "openid.ns": "http://specs.openid.net/auth/2.0", "openid.mode": "checkid_setup", "openid.return_to": `${callback("steam")}?state=${encodeURIComponent(state)}`,
          "openid.realm": config.publicUrl, "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select", "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select" });
        return { url: `https://steamcommunity.com/openid/login?${p}` };
      }
      const p = PROVIDERS[t];
      if (!p) throw notFound("Service");
      const c = creds(p);
      if (!c.id) throw new ApiError(503, "connection_unavailable", `${p.name} connections aren't set up on this server yet.`);
      const qs = new URLSearchParams({ client_id: c.id, redirect_uri: callback(t), response_type: "code", scope: p.scope, state, ...(t === "reddit" ? { duration: "temporary" } : {}), ...(t === "youtube" ? { access_type: "online", prompt: "select_account" } : {}) });
      return { url: `${p.authorize}?${qs}` };
    });
    r.patch<{ Params: { type: string; id: string } }>("/api/connections/:type/:id", async (req) => {
      const b = z.object({ visible: z.boolean().optional(), show_activity: z.boolean().optional() }).parse(req.body);
      await q("update user_connections set visible = coalesce($4, visible), show_activity = coalesce($5, show_activity) where user_id = $1 and type = $2 and external_id = $3", [uid(req), req.params.type, req.params.id, b.visible ?? null, b.show_activity ?? null]);
      return { ok: true };
    });
    r.delete<{ Params: { type: string; id: string } }>("/api/connections/:type/:id", async (req) => {
      await q("delete from user_connections where user_id = $1 and type = $2 and external_id = $3", [uid(req), req.params.type, req.params.id]);
      return { ok: true };
    });
  });

  /** The service sends the browser back here (signed state ties it to the account that started it). */
  app.get<{ Params: { type: string }; Querystring: Record<string, string> }>("/api/connections/:type/callback", async (req, reply) => {
    const st = readState(String(req.query.state ?? ""));
    const done = (ok: boolean, msg?: string) => reply.redirect(`${config.publicUrl}/settings/connections?${new URLSearchParams(ok ? { connected: req.params.type } : { error: msg ?? "failed" })}`);
    if (!st || st.type !== req.params.type || (req.session && req.session.user_id !== st.userId)) return done(false, "The connection request expired. Try again.");
    try {
      let profile: { id: string; name: string; url: string | null };
      if (st.type === "steam") {
        // Verify the OpenID assertion with Steam itself.
        const params = new URLSearchParams(Object.entries(req.query).filter(([k]) => k.startsWith("openid.")) as [string, string][]);
        params.set("openid.mode", "check_authentication");
        const r = await fetch("https://steamcommunity.com/openid/login", { method: "POST", body: params, headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10000) });
        const text = await r.text();
        const sid = /\/openid\/id\/(\d{17})$/.exec(String(req.query["openid.claimed_id"] ?? ""))?.[1];
        if (!/is_valid\s*:\s*true/.test(text) || !sid) return done(false, "Steam couldn't confirm your account.");
        const xml = await safeFetch(`https://steamcommunity.com/profiles/${sid}?xml=1`, { accept: "text/xml" }).then((x) => x.body.toString("utf8")).catch(() => "");
        const name = /<steamID><!\[CDATA\[([^\]]{1,64})\]\]><\/steamID>/.exec(xml)?.[1] ?? sid;
        profile = { id: sid, name, url: `https://steamcommunity.com/profiles/${sid}` };
      } else {
        const p = PROVIDERS[st.type];
        if (!p) return done(false);
        const c = creds(p);
        const body = new URLSearchParams({ grant_type: "authorization_code", code: String(req.query.code ?? ""), redirect_uri: callback(st.type), client_id: c.id, client_secret: c.secret });
        const r = await fetch(p.token, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...(st.type === "reddit" || st.type === "spotify" ? { authorization: `Basic ${Buffer.from(`${c.id}:${c.secret}`).toString("base64")}` } : {}) }, signal: AbortSignal.timeout(10000) });
        const tok: any = await r.json().catch(() => ({}));
        if (!tok.access_token) return done(false, `${p.name} didn't approve the connection.`);
        profile = await p.profile(tok.access_token);
      }
      const n = await q1<any>("select count(*)::int as n from user_connections where user_id = $1", [st.userId]);
      if (n.n >= 20) return done(false, "You can have up to 20 connections.");
      await q(`insert into user_connections(user_id, type, external_id, name, metadata) values ($1,$2,$3,$4,$5)
        on conflict (user_id, type, external_id) do update set name = excluded.name, metadata = excluded.metadata`, [st.userId, st.type, profile.id, profile.name.slice(0, 100), JSON.stringify({ url: profile.url })]);
      return done(true);
    } catch (e) {
      return done(false, (e as Error).message?.slice(0, 120) || "failed");
    }
  });
}
