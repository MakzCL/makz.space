import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as OTPAuth from "otpauth";
import { z } from "zod";
import { BRAND } from "@syndo/shared";
import { config } from "./config.ts";
import { q, q1, tx } from "./db.ts";
import { hashPassword, randomCode, randomToken, sha256, verifyPassword } from "./crypto.ts";
import { ApiError, bad, conflict, notFound, unauthorized } from "./errors.ts";
import { newId } from "./ids.ts";
import { sendMail } from "./mail.ts";
import { selfOut } from "./serialize.ts";

export const COOKIE = "syndo_session";

export interface Session { id: string; user_id: string; mfa_pending: boolean; status: string; email_verified: boolean }

declare module "fastify" {
  interface FastifyRequest { session: Session | null; sessionToken: string | null }
}

export function tokenFromCookieHeader(h: string | undefined): string | null {
  if (!h) return null;
  for (const part of h.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Resolve a raw token to a live session, touching last_used_at at most once a minute. */
export async function sessionFromToken(token: string, ip: string | null, ua: string | null): Promise<Session | null> {
  const r = await q1<any>(
    `select s.id::text, s.user_id::text, s.mfa_pending, s.last_used_at, u.status, u.email_verified_at is not null as email_verified
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null`, [sha256(token)]);
  if (!r) return null;
  if (Date.now() - new Date(r.last_used_at).getTime() > 60_000) {
    await q("update sessions set last_used_at = now(), ip = $2, user_agent = coalesce($3, user_agent) where id = $1", [r.id, ip, ua?.slice(0, 300) ?? null]);
  }
  return { id: r.id, user_id: r.user_id, mfa_pending: r.mfa_pending, status: r.status, email_verified: r.email_verified };
}

async function createSession(userId: string, req: FastifyRequest, mfaPending: boolean) {
  const token = randomToken(32);
  const id = newId();
  await q(
    `insert into sessions(id, user_id, token_hash, expires_at, ip, user_agent, mfa_pending)
     values ($1,$2,$3, now() + make_interval(days => $4), $5, $6, $7)`,
    [id, userId, sha256(token), config.sessionDays, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 300), mfaPending]);
  return { id, token };
}

function setCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE, token, {
    path: "/", httpOnly: true, sameSite: "lax", secure: config.cookieSecure, maxAge: config.sessionDays * 86400,
  });
}

/** preHandler: require a fully signed-in session. */
export async function requireUser(req: FastifyRequest) {
  if (!req.session) throw unauthorized();
  if (req.session.mfa_pending) throw new ApiError(401, "mfa_required", "Enter your two-factor code to finish signing in.");
}
export const uid = (req: FastifyRequest) => req.session!.user_id;

/** Hook: resolve the session from cookie or bearer token; enforce Origin on cookie-authenticated writes. */
export async function sessionHook(req: FastifyRequest) {
  req.session = null; req.sessionToken = null;
  const auth = req.headers.authorization;
  let token: string | null = null;
  let viaCookie = false;
  if (auth?.startsWith("Bearer ")) token = auth.slice(7).trim();
  else { token = (req.cookies as Record<string, string | undefined>)[COOKIE] ?? null; viaCookie = !!token; }
  if (viaCookie && req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.origin;
    const allowed = new Set([config.publicUrl, ...config.extraOrigins]);
    if (origin && !allowed.has(origin)) throw new ApiError(403, "bad_origin", "Request origin not allowed.");
    if (!origin && req.headers["x-syndo-client"] !== "1") throw new ApiError(403, "bad_origin", "Missing origin.");
  }
  if (!token) return;
  req.sessionToken = token;
  req.session = await sessionFromToken(token, req.ip, String(req.headers["user-agent"] ?? ""));
}

const PASSWORD = z.string().min(8, "Use at least 8 characters.").max(256);
const USERNAME = z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{2,32}$/, "Usernames use 2–32 letters, numbers, dots or underscores.")
  .refine((s) => !/\.\./.test(s), "No double dots.");
const EMAIL = z.string().trim().toLowerCase().email("That email doesn't look right.").max(254);

async function issueEmailToken(userId: string, kind: "verify" | "reset", hours: number) {
  const token = randomToken(24);
  await q("insert into email_tokens(token_hash, user_id, kind, expires_at) values ($1,$2,$3, now() + make_interval(hours => $4))", [sha256(token), userId, kind, hours]);
  return token;
}
async function sendVerification(userId: string, email: string) {
  const token = await issueEmailToken(userId, "verify", 48);
  await sendMail(email, "Confirm your email", [`Welcome to ${BRAND.name}! Confirm your email address to finish setting up your account.`],
    { label: "Confirm email", url: `${config.publicUrl}/verify?token=${token}` });
}

async function consumeEmailToken(token: string, kind: "verify" | "reset") {
  return q1<{ user_id: string }>(
    `update email_tokens set used_at = now() where token_hash = $1 and kind = $2 and used_at is null and expires_at > now() returning user_id::text`,
    [sha256(token), kind]);
}

async function revokeSessions(userId: string, exceptId: string | null) {
  const { closeSession } = await import("./gateway.ts");
  const rows = await q<{ id: string }>(
    "update sessions set revoked_at = now() where user_id = $1 and revoked_at is null and ($2::bigint is null or id <> $2) returning id::text", [userId, exceptId]);
  await Promise.all(rows.map((r) => closeSession(r.id, "Signed out from another device")));
}

function totp(secret: string) {
  return new OTPAuth.TOTP({ issuer: BRAND.name, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}
async function checkSecondFactor(userId: string, code: string): Promise<boolean> {
  const u = await q1<any>("select mfa_secret, mfa_enabled from users where id = $1", [userId]);
  if (!u?.mfa_enabled || !u.mfa_secret) return false;
  const clean = code.replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(clean)) return totp(u.mfa_secret).validate({ token: clean, window: 1 }) !== null;
  const used = await q1("update mfa_recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning 1", [userId, sha256(clean.toLowerCase())]);
  return !!used;
}
async function newRecoveryCodes(userId: string) {
  const codes = Array.from({ length: 10 }, () => randomCode(10).toLowerCase());
  await tx(async (c) => {
    await c.query("delete from mfa_recovery_codes where user_id = $1", [userId]);
    for (const code of codes) await c.query("insert into mfa_recovery_codes(user_id, code_hash) values ($1,$2)", [userId, sha256(code)]);
  });
  return codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`);
}

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: Number(process.env.SYNDO_AUTH_RATE_LIMIT ?? 10), timeWindow: "1 minute" } } };

  app.post("/api/auth/register", strict, async (req, reply) => {
    const body = z.object({ email: EMAIL, username: USERNAME, password: PASSWORD, display_name: z.string().trim().max(32).optional() }).parse(req.body);
    const exists = await q1<any>("select username = $1 as u, email = $2 as e from users where username = $1 or email = $2 limit 1", [body.username, body.email]);
    if (exists?.u) throw conflict("That username is taken.", "username_taken");
    if (exists?.e) throw conflict("An account already uses that email. Try signing in or resetting your password.", "email_taken");
    const id = newId();
    await q("insert into users(id, username, email, password_hash, display_name) values ($1,$2,$3,$4,$5)",
      [id, body.username, body.email, await hashPassword(body.password), body.display_name || null]);
    
    const s = await createSession(id, req, false);
    setCookie(reply, s.token);
    return { user: selfOut(await q1("select * from users where id = $1", [id])), token: s.token };
  });

  app.post("/api/auth/login", strict, async (req, reply) => {
    const body = z.object({ login: z.string().trim().toLowerCase().min(1).max(254), password: z.string().max(256) }).parse(req.body);
    const u = await q1<any>("select * from users where (email = $1 or username = $1) and deleted_at is null and bot = false", [body.login]);
    if (!(await verifyPassword(body.password, u?.password_hash ?? null)) || !u) throw new ApiError(401, "bad_credentials", "That login or password isn't right.");
    const s = await createSession(u.id, req, !!u.mfa_enabled);
    setCookie(reply, s.token);
    if (u.mfa_enabled) return { mfa_required: true, token: s.token };
    return { user: selfOut(u), token: s.token };
  });

  app.post("/api/auth/mfa/verify", strict, async (req) => {
    if (!req.session) throw unauthorized();
    if (!req.session.mfa_pending) return { ok: true };
    const { code } = z.object({ code: z.string().max(32) }).parse(req.body);
    if (!(await checkSecondFactor(req.session.user_id, code))) throw new ApiError(401, "bad_code", "That code didn't work. Codes change every 30 seconds.");
    await q("update sessions set mfa_pending = false where id = $1", [req.session.id]);
    return { user: selfOut(await q1("select * from users where id = $1", [req.session.user_id])) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.session) {
      await q("update sessions set revoked_at = now() where id = $1", [req.session.id]);
      await (await import("./gateway.ts")).closeSession(req.session.id, "Signed out");
    }
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.post("/api/auth/verify-email", strict, async (req) => {
    const { token } = z.object({ token: z.string().max(100) }).parse(req.body);
    const t = await consumeEmailToken(token, "verify");
    if (!t) throw bad("This link has expired or was already used.", "bad_token");
    await q("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [t.user_id]);
    (await import("./gateway.ts")).toUser(t.user_id, "USER_UPDATE", selfOut(await q1("select * from users where id = $1", [t.user_id])));
    return { ok: true };
  });

  app.post("/api/auth/resend-verification", { ...strict, preHandler: requireUser }, async (req) => {
    const u = await q1<any>("select email, email_verified_at from users where id = $1", [uid(req)]);
    if (u.email_verified_at) return { ok: true, already: true };
    await sendVerification(uid(req), u.email);
    return { ok: true };
  });

  app.post("/api/auth/forgot-password", strict, async (req) => {
    const { email } = z.object({ email: EMAIL }).parse(req.body);
    const u = await q1<any>("select id from users where email = $1 and deleted_at is null", [email]);
    if (u) {
      const token = await issueEmailToken(u.id, "reset", 1);
      await sendMail(email, "Reset your password", ["Someone (hopefully you) asked to reset your password. The link works for one hour."],
        { label: "Choose a new password", url: `${config.publicUrl}/reset?token=${token}` });
    }
    return { ok: true }; // same answer either way: no account enumeration
  });

  app.post("/api/auth/reset-password", strict, async (req) => {
    const { token, password } = z.object({ token: z.string().max(100), password: PASSWORD }).parse(req.body);
    const t = await consumeEmailToken(token, "reset");
    if (!t) throw bad("This link has expired or was already used.", "bad_token");
    await q("update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1", [t.user_id, await hashPassword(password)]);
    await revokeSessions(t.user_id, null);
    return { ok: true };
  });

  app.post("/api/auth/change-password", { ...strict, preHandler: requireUser }, async (req) => {
    const { current, next } = z.object({ current: z.string().max(256), next: PASSWORD }).parse(req.body);
    const u = await q1<any>("select password_hash from users where id = $1", [uid(req)]);
    if (!(await verifyPassword(current, u.password_hash))) throw new ApiError(401, "bad_credentials", "Your current password isn't right.");
    await q("update users set password_hash = $2 where id = $1", [uid(req), await hashPassword(next)]);
    await revokeSessions(uid(req), req.session!.id);
    return { ok: true };
  });

  app.get("/api/auth/sessions", { preHandler: requireUser }, async (req) => {
    const rows = await q<any>(
      "select id::text, created_at, last_used_at, ip, user_agent from sessions where user_id = $1 and revoked_at is null and expires_at > now() order by last_used_at desc", [uid(req)]);
    return rows.map((r) => ({ ...r, current: r.id === req.session!.id }));
  });

  app.delete<{ Params: { id: string } }>("/api/auth/sessions/:id", { preHandler: requireUser }, async (req) => {
    const r = await q1("update sessions set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id", [req.params.id, uid(req)]);
    if (!r) throw notFound("Session");
    await (await import("./gateway.ts")).closeSession(req.params.id, "This session was signed out from another device");
    return { ok: true };
  });

  app.post("/api/auth/sessions/revoke-others", { preHandler: requireUser }, async (req) => {
    await revokeSessions(uid(req), req.session!.id);
    return { ok: true };
  });

  app.post("/api/auth/mfa/setup", { preHandler: requireUser }, async (req) => {
    const u = await q1<any>("select username, mfa_enabled from users where id = $1", [uid(req)]);
    if (u.mfa_enabled) throw conflict("Two-factor is already on.");
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    await q("update users set mfa_secret = $2 where id = $1", [uid(req), secret]);
    const t = new OTPAuth.TOTP({ issuer: BRAND.name, label: u.username, secret: OTPAuth.Secret.fromBase32(secret) });
    return { secret, otpauth_url: t.toString() };
  });

  app.post("/api/auth/mfa/enable", { ...strict, preHandler: requireUser }, async (req) => {
    const { code } = z.object({ code: z.string().max(12) }).parse(req.body);
    const u = await q1<any>("select mfa_secret, mfa_enabled from users where id = $1", [uid(req)]);
    if (u.mfa_enabled) throw conflict("Two-factor is already on.");
    if (!u.mfa_secret || totp(u.mfa_secret).validate({ token: code.replace(/\s/g, ""), window: 1 }) === null) throw bad("That code didn't match. Check your authenticator app's clock.", "bad_code");
    await q("update users set mfa_enabled = true where id = $1", [uid(req)]);
    return { recovery_codes: await newRecoveryCodes(uid(req)) };
  });

  app.post("/api/auth/mfa/disable", { ...strict, preHandler: requireUser }, async (req) => {
    const { code } = z.object({ code: z.string().max(32) }).parse(req.body);
    if (!(await checkSecondFactor(uid(req), code))) throw bad("That code didn't work.", "bad_code");
    await q("update users set mfa_enabled = false, mfa_secret = null where id = $1", [uid(req)]);
    await q("delete from mfa_recovery_codes where user_id = $1", [uid(req)]);
    return { ok: true };
  });

  app.post("/api/auth/mfa/recovery-codes", { ...strict, preHandler: requireUser }, async (req) => {
    const { code } = z.object({ code: z.string().max(32) }).parse(req.body);
    if (!(await checkSecondFactor(uid(req), code))) throw bad("That code didn't work.", "bad_code");
    return { recovery_codes: await newRecoveryCodes(uid(req)) };
  });

  if (config.devMail) {
    app.get<{ Querystring: { to?: string } }>("/api/dev/mail", async (req) =>
      q("select id, to_address, subject, body, created_at from mail_outbox where ($1::text is null or to_address = $1) order by id desc limit 20", [req.query.to ?? null]));
  }
}

export { revokeSessions };
