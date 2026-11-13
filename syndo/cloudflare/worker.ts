import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { androidDownload, releaseDownload, releaseUpload } from "./releases";
const TIMEOUT = 3600000;
const bootstrap = `
const fs = require('node:fs'), cp = require('node:child_process'), { promisify } = require('node:util');
const run = promisify(cp.execFile);
(async () => {
  const sha = process.env.SEND_SOURCE_COMMIT;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid source commit');
  fs.mkdirSync('/app', {recursive:true});
  // Runtime cache: the unpacked server + its installed packages for this commit, kept in the
  // private uploads bucket. A cold start then skips the GitHub download and npm install.
  const origin = (process.env.SEND_STORAGE_ORIGIN || '').replace(/\\/$/, '');
  const auth = { authorization: 'Bearer ' + (process.env.SEND_STORAGE_TOKEN || '') };
  const cacheUrl = origin && process.env.SEND_STORAGE_TOKEN ? origin + '/__storage/_runtime/' + sha + '.tgz' : null;
  const t0 = Date.now();
  let cached = false;
  if (cacheUrl) {
    try {
      const c = await fetch(cacheUrl, { headers: auth, signal: AbortSignal.timeout(30000) });
      if (c.ok) {
        fs.writeFileSync('/tmp/runtime.tgz', Buffer.from(await c.arrayBuffer()));
        cp.execFileSync('tar', ['xzf','/tmp/runtime.tgz','-C','/app']);
        fs.rmSync('/tmp/runtime.tgz', {force:true});
        cached = fs.existsSync('/app/syndo/node_modules/tsx/package.json') && fs.existsSync('/app/syndo/server/src/index.ts');
        if (!cached) fs.rmSync('/app/syndo', {recursive:true, force:true});
      } else await c.body?.cancel();
    } catch (e) { console.error('[boot] runtime cache unavailable:', e.message); }
  }
  if (!cached) {
    const r = await fetch('https://codeload.github.com/MakzCL/makz.space/tar.gz/' + sha);
    if (!r.ok) throw new Error('Source download failed: ' + r.status);
    fs.writeFileSync('/tmp/source.tgz', Buffer.from(await r.arrayBuffer()));
    // Only what the API server needs: skips the web app, desktop, Android and the rest of the repo.
    cp.execFileSync('tar', ['xzf','/tmp/source.tgz','--strip-components=1','-C','/app','--wildcards','*/syndo/package.json','*/syndo/package-lock.json','*/syndo/tsconfig.base.json','*/syndo/server/*','*/syndo/shared/*']);
    fs.rmSync('/tmp/source.tgz', {force:true});
    cp.execFileSync('npm', ['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','-w','@send/server','-w','@send/shared'], {cwd:'/app/syndo',stdio:'inherit'});
  }
  console.log('[boot] ' + (cached ? 'runtime cache hit' : 'fresh install') + ' in ' + (Date.now() - t0) + ' ms');
  const child = cp.spawn(process.execPath, ['--import','tsx','server/src/index.ts'], {cwd:'/app/syndo',stdio:'inherit'});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', code => process.exit(code ?? 1));
  // After a fresh install, save the result for the next cold start (once the server is up and idle-ish).
  if (!cached && cacheUrl) setTimeout(async () => {
    try {
      await run('tar', ['czf','/tmp/runtime.tgz','-C','/app','--exclude=syndo/server/uploads','syndo']);
      const buf = fs.readFileSync('/tmp/runtime.tgz');
      fs.rmSync('/tmp/runtime.tgz', {force:true});
      if (buf.length > 24 * 1024 * 1024) return console.error('[boot] runtime too large to cache:', buf.length);
      const u = await fetch(cacheUrl, { method: 'PUT', headers: auth, body: buf });
      console.log('[boot] runtime cached:', u.status, buf.length);
    } catch (e) { console.error('[boot] runtime cache upload failed:', e.message); }
  }, Number(process.env.SEND_RUNTIME_CACHE_DELAY_MS || 60000));
})().catch(e => {console.error(e.message);process.exit(1)});
`;
// Keys the backend picks up when they're saved as Worker secrets (Settings → Variables and Secrets), so turning on
// push, Stripe, GIFs or account connections needs no code change — only a secret and a restart of the backend.
const OPTIONAL_ENV = ["SEND_SECRET", "SEND_VAPID_PUBLIC", "SEND_VAPID_PRIVATE", "SEND_VAPID_SUBJECT", "SEND_STAFF_USER_IDS",
  "SEND_FCM_SERVICE_ACCOUNT", "SEND_APNS_KEY", "SEND_APNS_KEY_ID", "SEND_APNS_TEAM_ID", "SEND_APNS_TOPIC",
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID", "SEND_GIF_PROVIDER", "SEND_GIF_KEY",
  ...["GITHUB", "TWITCH", "SPOTIFY", "REDDIT", "GOOGLE", "XBOX"].flatMap((p) => [`SEND_${p}_CLIENT_ID`, `SEND_${p}_CLIENT_SECRET`])];
function optionalEnv(env: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of OPTIONAL_ENV) {
    // Secrets saved before the rename use the old SYNDO_ prefix; either name works.
    const v = env[k] || (k.startsWith("SEND_") ? env[`SYNDO_${k.slice(5)}`] : undefined);
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

/** A hash of the optional settings (never the values themselves) so a changed secret restarts the backend. */
async function envFingerprint(extra: Record<string, string>) {
  const text = Object.keys(extra).sort().map((k) => `${k}=${extra[k]}`).join("\n");
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class SENDBackend extends DurableObject<Env> {
  private starting?: Promise<void>;
  private ready = false;
  /** Commit the running container was started on — a different pinned commit restarts it on the next request. */
  private readyCommit?: string;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running) ctx.waitUntil(ctx.container.setInactivityTimeout(TIMEOUT));
  }
  private async ensureReady() {
    const c = this.ctx.container;
    if (!c) throw new Error("Container not configured");
    // Restart on a new commit, and also when optional secrets change (adding a key in the dashboard must take effect).
    const extra = optionalEnv(this.env as unknown as Record<string, unknown>);
    const fingerprint = await envFingerprint(extra);
    if (c.running && (await this.ctx.storage.get("active-source-commit") !== this.env.SOURCE_COMMIT || await this.ctx.storage.get("active-env") !== fingerprint)) {
      // Record the revision before stopping; a transient allocation failure must
      // not repeatedly destroy the replacement instance on subsequent retries.
      await this.ctx.storage.put("active-source-commit", this.env.SOURCE_COMMIT);
      await c.destroy();
      this.ready = false;
    }
    if (!c.running) c.start({image:"cloudflare/debian-trixie",instance:"basic",enableInternet:true,entrypoint:["node","-e",bootstrap],env:{
      DATABASE_URL:this.env.DATABASE_URL, NODE_ENV:"production", PG_POOL:"5", PORT:"3900",
      SEND_PUBLIC_URL:"https://syndo.makz.space", SEND_COOKIE_SECURE:"1", SEND_TRUST_PROXY:"1",
      SEND_AUTO_MIGRATE:"0", SEND_REQUIRE_DM_E2EE:"0", SEND_SFU_APP_ID:this.env.SFU_APP_ID, SEND_SFU_SECRET:this.env.SFU_APP_SECRET, SEND_MAX_UPLOAD_MB:"25", SEND_STORAGE_ORIGIN:this.env.STORAGE_ORIGIN,
      SEND_STORAGE_TOKEN:this.env.STORAGE_TOKEN, SEND_SOURCE_COMMIT:this.env.SOURCE_COMMIT, SEND_TURN_KEY_ID:this.env.TURN_KEY_ID ?? "", SEND_TURN_KEY_TOKEN:this.env.TURN_KEY_TOKEN ?? "",
      ...extra,
    }});
    await this.ctx.storage.put("active-source-commit", this.env.SOURCE_COMMIT);
    await this.ctx.storage.put("active-env", fingerprint);
    await c.setInactivityTimeout(TIMEOUT);
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      try {
        const r = await c.getTcpPort(3900).fetch("http://container/api/health", {signal:AbortSignal.timeout(2000)});
        await r.body?.cancel();
        if (r.ok) { this.ready = true;
          this.readyCommit = this.env.SOURCE_COMMIT; return; }
      } catch { /* Wait for the process and database to become ready. */ }
      await scheduler.wait(1000);
    }
    throw new Error("Backend did not become ready");
  }
  async fetch(request: Request) {
    // A newer deploy is live (the Worker says which commit): reset this object so it restarts on the new code,
    // settings and secrets. Open connections drop and the apps reconnect within seconds.
    const want = request.headers.get("x-send-commit");
    if (want && want !== this.env.SOURCE_COMMIT) this.ctx.abort("SEND backend updated");
    if (new URL(request.url).pathname === "/api/health" && this.ctx.container?.running && this.readyCommit === this.env.SOURCE_COMMIT) {
      try {
        return await this.ctx.container.getTcpPort(3900).fetch("http://container/api/health", { signal: AbortSignal.timeout(2500) });
      } catch { /* Cold process: start or retry readiness below. */ }
    }
    if (!this.ready || !this.ctx.container?.running || this.readyCommit !== this.env.SOURCE_COMMIT) this.starting ??= this.ensureReady().finally(() => {this.starting = undefined;});
    if (new URL(request.url).pathname === "/api/health" && !this.ready) {
      this.ctx.waitUntil(this.starting!.catch(error => console.error("startup_failed",error.message)));
      return Response.json({ok:false,status:"starting"},{status:503,headers:{"retry-after":"10"}});
    }
    if (this.starting) await this.starting;
    const url = new URL(request.url); url.protocol = "http:"; url.host = "container";
    const forwarded = new Request(url, request); forwarded.headers.delete("host");
    forwarded.headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "127.0.0.1");
    forwarded.headers.set("x-forwarded-proto", "https");
    return this.ctx.container!.getTcpPort(3900).fetch(forwarded);
  }
}
/* Big attachments: the backend signs a ticket (storage key + exact size + expiry) with the shared storage token;
   the browser sends the file here in 32 MB pieces and they go straight into R2 as a multipart upload. */
const PART_SIZE = 32 * 1024 * 1024, LARGE_MAX = 500 * 1024 * 1024;
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function checkTicket(url: URL, env: Env): Promise<{ key: string; size: number } | Response> {
  const key = url.searchParams.get("key") ?? "", size = Number(url.searchParams.get("size")), exp = Number(url.searchParams.get("exp")), sig = url.searchParams.get("sig") ?? "";
  const no = (status: number, message: string) => Response.json({ code: "bad_ticket", message }, { status });
  if (!/^att\/[a-z0-9/_.-]+$/i.test(key) || key.includes("..") || !Number.isSafeInteger(size) || size <= 0 || size > LARGE_MAX || !Number.isSafeInteger(exp)) return no(400, "This upload isn't valid.");
  const secret = (env as unknown as { STORAGE_TOKEN?: string }).STORAGE_TOKEN ?? "";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = new TextEncoder().encode(b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${key}\n${size}\n${exp}`))));
  const got = new TextEncoder().encode(sig);
  if (!secret || got.byteLength !== want.byteLength || !timingSafeEqual(got, want)) return no(403, "This upload isn't valid.");
  if (exp < Date.now()) return no(410, "This upload took too long. Try again.");
  return { key, size };
}
export async function largeUpload(request: Request, env: Env) {
  const url = new URL(request.url), action = url.pathname.slice("/api/uploads/large/".length);
  const t = await checkTicket(url, env);
  if (t instanceof Response) return t;
  const parts = Math.ceil(t.size / PART_SIZE);
  const uploadId = url.searchParams.get("upload_id") ?? "";
  try {
    if (action === "start" && request.method === "POST") {
      const up = await env.UPLOADS.createMultipartUpload(t.key);
      return Response.json({ upload_id: up.uploadId, part_size: PART_SIZE });
    }
    if (action === "part" && request.method === "PUT") {
      const n = Number(url.searchParams.get("part")), len = Number(request.headers.get("content-length"));
      const want = n < parts ? PART_SIZE : t.size - PART_SIZE * (parts - 1);
      if (!Number.isInteger(n) || n < 1 || n > parts || len !== want || !request.body) return Response.json({ code: "bad_part", message: "That piece is the wrong size." }, { status: 400 });
      const part = await env.UPLOADS.resumeMultipartUpload(t.key, uploadId).uploadPart(n, request.body);
      return Response.json({ part_number: part.partNumber, etag: part.etag });
    }
    if (action === "complete" && request.method === "POST") {
      const body = await request.json<{ parts: { part_number: number; etag: string }[] }>();
      if (!Array.isArray(body?.parts) || body.parts.length !== parts) return Response.json({ code: "bad_parts", message: "Some pieces are missing." }, { status: 400 });
      const obj = await env.UPLOADS.resumeMultipartUpload(t.key, uploadId).complete(body.parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));
      if (obj.size !== t.size) { await env.UPLOADS.delete(t.key); return Response.json({ code: "incomplete", message: "The upload didn't arrive complete." }, { status: 400 }); }
      return Response.json({ ok: true, size: obj.size });
    }
    if (action === "abort" && request.method === "DELETE") { await env.UPLOADS.resumeMultipartUpload(t.key, uploadId).abort(); return Response.json({ ok: true }); }
  } catch (e) {
    console.error("large_upload", e instanceof Error ? e.message : e);
    return Response.json({ code: "upload_failed", message: "The upload failed. Try again." }, { status: 502 });
  }
  return new Response(null, { status: 405 });
}

/* Big files are read straight from R2: the backend checks permission and redirects here with a link signed for
   one key and one set of response headers (an hour). Ranges work, so video seeking does too. */
export async function fileRead(request: Request, env: Env) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
  const url = new URL(request.url), q = (k: string) => url.searchParams.get(k) ?? "";
  const key = q("key"), type = q("type"), disp = q("disp"), exp = Number(q("exp")), sig = q("sig");
  const notFound = () => Response.json({ code: "not_found", message: "File doesn't exist or you can't see it." }, { status: 404 });
  if (!/^att\/[a-z0-9/_.-]+$/i.test(key) || key.includes("..") || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(type) || !/^(inline|attachment); filename\*=UTF-8''[^\r\n]{1,800}$/.test(disp) || !Number.isSafeInteger(exp) || exp * 1000 < Date.now()) return notFound();
  const secret = (env as unknown as { STORAGE_TOKEN?: string }).STORAGE_TOKEN ?? "";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = new TextEncoder().encode(b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`read\n${key}\n${type}\n${disp}\n${exp}`))));
  const got = new TextEncoder().encode(sig);
  if (!secret || got.byteLength !== want.byteLength || !timingSafeEqual(got, want)) return notFound();
  const headers = new Headers({ "content-type": type, "content-disposition": disp, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=3600", "accept-ranges": "bytes" });
  if (request.method === "HEAD") {
    const h = await env.UPLOADS.head(key); if (!h) return notFound();
    headers.set("content-length", String(h.size)); return new Response(null, { headers });
  }
  let obj: R2ObjectBody | null;
  try { obj = await env.UPLOADS.get(key, { range: request.headers }); } catch { return new Response(null, { status: 416 }); }
  if (!obj) return notFound();
  headers.set("etag", obj.httpEtag);
  if (request.headers.has("range") && obj.range && "offset" in obj.range) {
    const offset = obj.range.offset ?? 0, length = obj.range.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`); headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

export async function storage(request: Request, env: Env) {
  const supplied = new TextEncoder().encode(request.headers.get("authorization") ?? "");
  const expected = new TextEncoder().encode(`Bearer ${env.STORAGE_TOKEN}`);
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied,expected)) return new Response(null,{status:404});
  const url = new URL(request.url), key = url.pathname.slice("/__storage/".length);
  const valid = (v:string) => /^[a-z0-9/_.-]+$/i.test(v) && !v.includes("..");
  if (request.method === "DELETE" && url.searchParams.has("prefix")) {
    const prefix = url.searchParams.get("prefix")!;
    if (!valid(prefix) || !prefix.endsWith("/")) return new Response(null,{status:400});
    for (;;) {
      const page = await env.UPLOADS.list({prefix,limit:1000});
      if (!page.objects.length) break;
      await env.UPLOADS.delete(page.objects.map(o=>o.key));
    }
    return new Response(null,{status:204});
  }
  if (!valid(key)) return new Response(null,{status:400});
  if (request.method === "PUT") {
    const bytes = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 25*1024*1024) return new Response(null,{status:413});
    await env.UPLOADS.put(key,request.body ?? new ArrayBuffer(0));
    return new Response(null,{status:204});
  }
  if (request.method === "DELETE") { await env.UPLOADS.delete(key); return new Response(null,{status:204}); }
  if (request.method === "HEAD") {
    const obj = await env.UPLOADS.head(key);
    return new Response(null,{status:obj?200:404,headers:obj?{"content-length":String(obj.size)}:{}});
  }
  if (request.method === "GET") {
    const obj = await env.UPLOADS.get(key,{range:request.headers});
    if (!obj) return new Response(null,{status:404});
    const headers = new Headers({"accept-ranges":"bytes","cache-control":"no-store"});
    if (obj.range && "offset" in obj.range && "length" in obj.range) {
      const {offset=0,length=obj.size} = obj.range;
      headers.set("content-range",`bytes ${offset}-${offset+length-1}/${obj.size}`);
      headers.set("content-length",String(length));
      return new Response(obj.body,{status:206,headers});
    }
    headers.set("content-length",String(obj.size));
    return new Response(obj.body,{headers});
  }
  return new Response(null,{status:405});
}
/* Public profile media (avatars, banners, server icons, emoji, stickers, sounds): unguessable, never-changing keys,
   served straight from R2 and cached at the edge for a year, so they load without touching the backend. */
const MEDIA_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", webm: "audio/webm", m4a: "audio/mp4" };
export async function media(request: Request, env: Env, ctx: ExecutionContext) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
  const url = new URL(request.url), key = url.pathname.slice("/api/media/".length);
  const ok = /^(avatars|banners|member-avatars|member-banners|guild-icons|guild-banners|role-icons|emoji|stickers|channel-banners)\/\d+\/\d+\.(png|jpg|gif|webp|avif)$/.test(key) || /^sounds\/\d+\/\d+\.(mp3|ogg|wav|webm|m4a)$/.test(key);
  if (!ok) return Response.json({ code: "not_found", message: "File doesn't exist." }, { status: 404 });
  const cache = (caches as unknown as { default: Cache }).default, cacheKey = new Request(`${url.origin}/api/media/${key}`);
  const hit = await cache.match(cacheKey);
  if (hit) return request.method === "HEAD" ? new Response(null, { headers: hit.headers }) : hit;
  const obj = await env.UPLOADS.get(key);
  if (!obj) return Response.json({ code: "not_found", message: "File doesn't exist." }, { status: 404, headers: { "cache-control": "no-store" } });
  const headers = new Headers({ "content-type": MEDIA_TYPES[key.split(".").pop()!] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable",
    "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff", "etag": obj.httpEtag, "content-length": String(obj.size), "access-control-allow-origin": "*" });
  const res = new Response(obj.body, { headers });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return request.method === "HEAD" ? new Response(null, { headers }) : res;
}
export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/media/")) return media(request,env,ctx);
    if (path === "/api/downloads/windows") return releaseDownload(request,env);
    if (path === "/api/downloads/android") return androidDownload(request,env);
    if (path.startsWith("/__release/")) return releaseUpload(request,env);
    if (path.startsWith("/__storage/")) return storage(request,env);
    if (path.startsWith("/api/uploads/large/")) return largeUpload(request,env);
    if (path === "/api/files/read") return fileRead(request,env);
    if (path !== "/gateway" && !path.startsWith("/api/")) return new Response(null,{status:404});
    try {
      // One Node process is the backend's realtime coordination unit. The beta
      // caps at one container until a shared event fanout is implemented.
      const forward = new Request(request); forward.headers.set("x-send-commit", env.SOURCE_COMMIT);
      return await env.BACKEND.getByName("syndo-beta-weur-v5", { locationHint: "weur" }).fetch(forward);
    } catch (error) {
      console.error("backend_unavailable", error instanceof Error ? error.message : "Unknown error");
      return Response.json({code:"backend_unavailable",message:"SEND is starting. Please try again shortly."},{status:503,headers:{"retry-after":"10"}});
    }
  },
} satisfies ExportedHandler<Env>;
