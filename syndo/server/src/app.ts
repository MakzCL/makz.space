import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { BRAND } from "@syndo/shared";
import { authRoutes, sessionHook } from "./auth.ts";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { ApiError, notFound } from "./errors.ts";
import { attachGateway } from "./gateway.ts";
import * as storage from "./storage.ts";
import { dmRoutes } from "./routes/dms.ts";
import { guildRoutes, inviteRoutes } from "./routes/guilds.ts";
import { attachmentDownloadRoute, messageRoutes } from "./routes/messages.ts";
import { userRoutes } from "./routes/users.ts";
import { voiceRoutes } from "./routes/voice.ts";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: process.env.SYNDO_TRUST_PROXY === "1", bodyLimit: 1024 * 1024 });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.limits.max_upload_bytes, files: 1, fields: 10 } });
  await app.register(rateLimit, {
    max: Number(process.env.SYNDO_RATE_LIMIT ?? 600), timeWindow: "1 minute",
    keyGenerator: (req) => req.session?.user_id ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, code: "rate_limited", message: `Slow down — try again in ${Math.ceil(ctx.ttl / 1000)}s.`, retry_after: Math.ceil(ctx.ttl / 1000) }),
  });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    if (req.url.startsWith("/api/")) await sessionHook(req);
  });

  app.setErrorHandler((err: FastifyError | ApiError | ZodError, _req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ code: "invalid", message: first?.message ?? "Invalid request.", field: first?.path.join("."), issues: err.issues.slice(0, 5) });
    }
    if (err instanceof ApiError) {
      if ((err as any).retryAfter) reply.header("retry-after", (err as any).retryAfter);
      return reply.code(err.status).send({ code: err.code, message: err.message, retry_after: (err as any).retryAfter });
    }
    const fe = err as FastifyError;
    if (fe.statusCode === 429) return reply.code(429).send(fe);
    if (fe.code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ code: "too_large", message: "That file is too large." });
    if (fe.statusCode && fe.statusCode < 500) return reply.code(fe.statusCode).send({ code: fe.code ?? "invalid", message: fe.message });
    console.error(err);
    return reply.code(500).send({ code: "internal", message: "Something went wrong on our side. Please try again." });
  });

  app.get("/api/health", async () => {
    await pool.query("select 1");
    return { ok: true, name: BRAND.name };
  });
  /** Instance metadata — identical limits for every account, published openly. */
  app.get("/api/instance", async () => ({ name: BRAND.name, tagline: BRAND.tagline, limits: config.limits, registration: true }));

  /** Public profile media (avatars, banners, server icons). Unguessable keys; attachments never use this route. */
  app.get<{ Params: { "*": string } }>("/api/media/*", async (req, reply) => {
    const key = req.params["*"];
    if (!/^(avatars|banners|guild-icons|guild-banners|role-icons|emoji|stickers)\/\d+\/\d+\.(png|jpg|gif|webp|avif)$/.test(key)) throw notFound("File");
    try { reply.header("content-length", await storage.size(key)); } catch { throw notFound("File"); }
    const ext = key.split(".").pop()!;
    reply.header("content-type", ({ png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" } as Record<string, string>)[ext]);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    return reply.send(storage.open(key));
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(dmRoutes);
  await app.register(guildRoutes);
  await app.register(inviteRoutes);
  await app.register(messageRoutes);
  await app.register(attachmentDownloadRoute);
  await app.register(voiceRoutes);

  // Serve the built web client when present (single-origin deployment).
  const web = new URL("../../web/dist/", import.meta.url).pathname;
  if (existsSync(web)) {
    await app.register(fastifyStatic, { root: web, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.method !== "GET") return reply.code(404).send({ code: "not_found", message: "Not found." });
      return reply.sendFile("index.html");
    });
  }

  attachGateway(app.server);
  return app;
}
