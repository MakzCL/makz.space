import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { config } from "./config.ts";
import { ApiError, bad } from "./errors.ts";
import * as storage from "./storage.ts";

/**
 * Big attachments go straight to storage in pieces, so no single request has to carry the whole file
 * (Cloudflare caps a request at 100 MB). The backend hands out a signed ticket for one storage key and
 * one exact size; in production the Worker checks it and writes the pieces into R2 with a multipart
 * upload, and the bytes never pass through this server. Without remote storage (local and tests), the
 * same endpoints are served here.
 */
export const PART_SIZE = 32 * 1024 * 1024; // R2 needs equal parts (except the last) of at least 5 MB
export const LARGE_MAX = 500 * 1024 * 1024;
const TTL_MS = 6 * 3600_000;
// Shared with the Worker in production (it already holds the storage token); random per process locally.
const SECRET = config.storageToken || randomBytes(32).toString("hex");

export interface Ticket { key: string; size: number; exp: number; sig: string }
const payload = (key: string, size: number, exp: number) => `${key}\n${size}\n${exp}`;
const sign = (key: string, size: number, exp: number) => createHmac("sha256", SECRET).update(payload(key, size, exp)).digest("base64url");

export function issueTicket(key: string, size: number): Ticket {
  const exp = Date.now() + TTL_MS;
  return { key, size, exp, sig: sign(key, size, exp) };
}
export function checkTicket(t: { key?: unknown; size?: unknown; exp?: unknown; sig?: unknown }): Ticket {
  const key = String(t.key ?? ""), size = Number(t.size), exp = Number(t.exp), sig = String(t.sig ?? "");
  if (!/^att\/[a-z0-9/_.-]+$/i.test(key) || key.includes("..") || !Number.isSafeInteger(size) || size <= 0 || size > LARGE_MAX || !Number.isSafeInteger(exp)) throw bad("This upload isn't valid.");
  const a = Buffer.from(sig), b = Buffer.from(sign(key, size, exp));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(403, "bad_ticket", "This upload isn't valid.");
  if (exp < Date.now()) throw new ApiError(410, "expired", "This upload took too long. Try again.");
  return { key, size, exp, sig };
}

/** Local stand-in for the Worker's /api/uploads/large/* endpoints (only registered without remote storage). */
export async function localLargeUploads(app: FastifyInstance) {
  if (config.storageOrigin) return; // the Worker answers these in production
  const dir = join(config.storageDir, "_parts");
  const q = (req: any) => checkTicket(req.query ?? {});
  const uploadDir = (id: unknown) => { const s = String(id ?? ""); if (!/^[a-f0-9]{32}$/.test(s)) throw bad("Unknown upload."); return join(dir, s); };
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: PART_SIZE + 1024 }, (_req, body, done) => done(null, body));

  app.post("/api/uploads/large/start", async (req) => {
    q(req);
    const id = randomBytes(16).toString("hex");
    await mkdir(join(dir, id), { recursive: true });
    return { upload_id: id, part_size: PART_SIZE };
  });
  app.put("/api/uploads/large/part", async (req) => {
    const t = q(req), qs = req.query as any;
    const n = Number(qs.part), d = uploadDir(qs.upload_id);
    const parts = Math.ceil(t.size / PART_SIZE);
    if (!Number.isInteger(n) || n < 1 || n > parts) throw bad("Unknown piece.");
    const body = req.body as Buffer;
    const want = n < parts ? PART_SIZE : t.size - PART_SIZE * (parts - 1);
    if (!Buffer.isBuffer(body) || body.length !== want) throw bad("That piece is the wrong size.");
    await writeFile(join(d, String(n)), body);
    return { part_number: n, etag: `local-${n}-${body.length}` };
  });
  app.post("/api/uploads/large/complete", async (req) => {
    const t = q(req), d = uploadDir((req.query as any).upload_id);
    const parts = Math.ceil(t.size / PART_SIZE);
    const have = (await readdir(d).catch(() => [])).length;
    if (have !== parts) throw bad("Some pieces are missing.");
    // Stitch the pieces into one object.
    const out = new PassThrough();
    const writing = storage.put(t.key, out, t.size);
    for (let n = 1; n <= parts; n++) await new Promise<void>((res, rej) => { const rs = createReadStream(join(d, String(n))); rs.on("error", rej).on("end", res); rs.pipe(out, { end: false }); });
    out.end();
    const size = await writing;
    await rm(d, { recursive: true, force: true });
    if (size !== t.size) { await storage.remove(t.key); throw bad("The upload didn't arrive complete."); }
    return { ok: true, size };
  });
  app.delete("/api/uploads/large/abort", async (req) => {
    q(req); await rm(uploadDir((req.query as any).upload_id), { recursive: true, force: true }); return { ok: true };
  });
}
