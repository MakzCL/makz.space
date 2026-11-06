/**
 * Test harness: a real Syndo server on a random port against a throwaway
 * PostgreSQL database, driven by independent clients (each with its own
 * cookie jar and WebSocket), exactly as separate browsers would.
 */
export const ORIGIN = "http://syndo.test";
process.env.DATABASE_URL ??= "postgres://syndo:syndo@localhost:5432/syndo_test";
process.env.SYNDO_PUBLIC_URL = ORIGIN;
process.env.SYNDO_DEV_MAIL = "1";
process.env.SYNDO_AUTH_RATE_LIMIT = "10000";
process.env.SYNDO_RATE_LIMIT = "100000";
process.env.SYNDO_STORAGE_DIR = new URL("../../data/test-storage", import.meta.url).pathname;
process.env.SYNDO_JOBS = "0";
process.env.SYNDO_VOICE_MODE = "sfu"; // most tests exercise the token/SFU path; the mesh test switches it
process.env.LIVEKIT_URL = "ws://127.0.0.1:1"; // unreachable on purpose: tokens are minted, enforcement calls fail softly
process.env.LIVEKIT_API_KEY = "testkey";
process.env.LIVEKIT_API_SECRET = "testsecret-testsecret-testsecret-0123";

import WebSocket from "ws";
import type { AddressInfo } from "node:net";

let base = "";
let stop: (() => Promise<void>) | null = null;

export async function startServer() {
  const { pool } = await import("../src/db.ts");
  await pool.query("drop schema public cascade; create schema public;");
  const { migrate } = await import("../src/migrate.ts");
  await migrate(() => {});
  const { buildApp } = await import("../src/app.ts");
  const app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  stop = async () => { await app.close(); await pool.end(); };
  return base;
}
export const stopServer = () => stop?.();

export interface Resp<T = any> { status: number; body: T; headers: Headers }

export class Client {
  cookie = "";
  name: string;
  user: any = null;
  sockets: Gateway[] = [];
  constructor(name: string) { this.name = name; }

  async req<T = any>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Resp<T>> {
    const headers: Record<string, string> = { origin: ORIGIN, ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: any;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(base + path, { method, headers, body: payload, redirect: "manual" });
    const set = r.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [kv] = c.split(";");
      if (kv!.startsWith("syndo_session=")) this.cookie = kv!.endsWith("=") ? "" : kv!;
    }
    const text = await r.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* binary or empty */ }
    return { status: r.status, body: parsed, headers: r.headers };
  }
  get = <T = any>(p: string) => this.req<T>("GET", p);
  post = <T = any>(p: string, b?: unknown) => this.req<T>("POST", p, b ?? {});
  patch = <T = any>(p: string, b?: unknown) => this.req<T>("PATCH", p, b ?? {});
  put = <T = any>(p: string, b?: unknown) => this.req<T>("PUT", p, b ?? {});
  del = <T = any>(p: string, b?: unknown) => this.req<T>("DELETE", p, b);

  async register(username = this.name, password = "correct horse battery") {
    const r = await this.post("/api/auth/register", { email: `${username}@example.test`, username, password, display_name: username[0]!.toUpperCase() + username.slice(1) });
    if (r.status !== 200) throw new Error(`register ${username}: ${r.status} ${JSON.stringify(r.body)}`);
    this.user = r.body.user;
    return this;
  }

  async connect(): Promise<Gateway> {
    const g = new Gateway(base.replace("http", "ws") + "/gateway", this.cookie);
    await g.ready;
    this.sockets.push(g);
    return g;
  }
  close() { this.sockets.forEach((s) => s.close()); }
}

export class Gateway {
  ws: WebSocket;
  events: { t: string; d: any; s: number }[] = [];
  ready: Promise<any>;
  closed: Promise<{ code: number; reason: string }>;
  private waiters: { t: string; pred: (d: any) => boolean; res: (d: any) => void }[] = [];
  constructor(url: string, cookie: string) {
    this.ws = new WebSocket(url, { headers: { cookie, origin: ORIGIN } });
    this.ws.on("message", (raw) => {
      const f = JSON.parse(String(raw));
      if (f.op !== "dispatch") return;
      this.events.push({ t: f.t, d: f.d, s: f.s });
      this.waiters = this.waiters.filter((w) => { if (w.t === f.t && w.pred(f.d)) { w.res(f.d); return false; } return true; });
    });
    this.ready = this.next("READY");
    this.closed = new Promise((res) => this.ws.on("close", (code, reason) => res({ code, reason: String(reason) })));
  }
  /** Wait for a future (or already received, if `seen`) event matching pred. */
  next(t: string, pred: (d: any) => boolean = () => true, ms = 4000, seen = false): Promise<any> {
    if (seen) { const hit = this.events.find((e) => e.t === t && pred(e.d)); if (hit) return Promise.resolve(hit.d); }
    return new Promise((res, rej) => {
      const w = { t, pred, res };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error(`timeout waiting for ${t}`)); }, ms).unref();
    });
  }
  has(t: string, pred: (d: any) => boolean = () => true) { return this.events.some((e) => e.t === t && pred(e.d)); }
  send(op: string, d?: unknown) { this.ws.send(JSON.stringify({ op, d })); }
  close() { try { this.ws.close(); } catch { /* */ } }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the latest dev-outbox email for an address and pull out a token link. */
export async function mailToken(c: Client, to: string, kind: "verify" | "reset") {
  const r = await c.get(`/api/dev/mail?to=${encodeURIComponent(to)}`);
  const mail = (r.body as any[]).find((m) => m.body.includes(`/${kind}?token=`));
  return mail?.body.match(new RegExp(`/${kind}\\?token=([A-Za-z0-9_-]+)`))?.[1] as string | undefined;
}
