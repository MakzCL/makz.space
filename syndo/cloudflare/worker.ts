import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { androidDownload, releaseDownload, releaseUpload } from "./releases";
const TIMEOUT = 3600000;
const bootstrap = `
const fs = require('node:fs'), cp = require('node:child_process'), { promisify } = require('node:util');
const run = promisify(cp.execFile);
(async () => {
  const sha = process.env.SYNDO_SOURCE_COMMIT;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid source commit');
  fs.mkdirSync('/app', {recursive:true});
  // Runtime cache: the unpacked server + its installed packages for this commit, kept in the
  // private uploads bucket. A cold start then skips the GitHub download and npm install.
  const origin = (process.env.SYNDO_STORAGE_ORIGIN || '').replace(/\\/$/, '');
  const auth = { authorization: 'Bearer ' + (process.env.SYNDO_STORAGE_TOKEN || '') };
  const cacheUrl = origin && process.env.SYNDO_STORAGE_TOKEN ? origin + '/__storage/_runtime/' + sha + '.tgz' : null;
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
    cp.execFileSync('npm', ['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','-w','@syndo/server','-w','@syndo/shared'], {cwd:'/app/syndo',stdio:'inherit'});
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
  }, Number(process.env.SYNDO_RUNTIME_CACHE_DELAY_MS || 60000));
})().catch(e => {console.error(e.message);process.exit(1)});
`;
export class SENDBackend extends DurableObject<Env> {
  private starting?: Promise<void>;
  private ready = false;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running) ctx.waitUntil(ctx.container.setInactivityTimeout(TIMEOUT));
  }
  private async ensureReady() {
    const c = this.ctx.container;
    if (!c) throw new Error("Container not configured");
    if (c.running && await this.ctx.storage.get("active-source-commit") !== this.env.SOURCE_COMMIT) {
      // Record the revision before stopping; a transient allocation failure must
      // not repeatedly destroy the replacement instance on subsequent retries.
      await this.ctx.storage.put("active-source-commit", this.env.SOURCE_COMMIT);
      await c.destroy();
      this.ready = false;
    }
    if (!c.running) c.start({image:"cloudflare/debian-trixie",instance:"basic",enableInternet:true,entrypoint:["node","-e",bootstrap],env:{
      DATABASE_URL:this.env.DATABASE_URL, NODE_ENV:"production", PG_POOL:"5", PORT:"3900",
      SYNDO_PUBLIC_URL:"https://syndo.makz.space", SYNDO_COOKIE_SECURE:"1", SYNDO_TRUST_PROXY:"1",
      SYNDO_AUTO_MIGRATE:"0", SYNDO_REQUIRE_DM_E2EE:"1", SYNDO_SFU_APP_ID:this.env.SFU_APP_ID, SYNDO_SFU_SECRET:this.env.SFU_APP_SECRET, SYNDO_MAX_UPLOAD_MB:"25", SYNDO_STORAGE_ORIGIN:this.env.STORAGE_ORIGIN,
      SYNDO_STORAGE_TOKEN:this.env.STORAGE_TOKEN, SYNDO_SOURCE_COMMIT:this.env.SOURCE_COMMIT, SYNDO_TURN_KEY_ID:this.env.TURN_KEY_ID ?? "", SYNDO_TURN_KEY_TOKEN:this.env.TURN_KEY_TOKEN ?? "",
    }});
    await this.ctx.storage.put("active-source-commit", this.env.SOURCE_COMMIT);
    await c.setInactivityTimeout(TIMEOUT);
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      try {
        const r = await c.getTcpPort(3900).fetch("http://container/api/health", {signal:AbortSignal.timeout(2000)});
        await r.body?.cancel();
        if (r.ok) { this.ready = true; return; }
      } catch { /* Wait for the process and database to become ready. */ }
      await scheduler.wait(1000);
    }
    throw new Error("Backend did not become ready");
  }
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/api/health" && this.ctx.container?.running) {
      try {
        return await this.ctx.container.getTcpPort(3900).fetch("http://container/api/health", { signal: AbortSignal.timeout(2500) });
      } catch { /* Cold process: start or retry readiness below. */ }
    }
    if (!this.ready || !this.ctx.container?.running) this.starting ??= this.ensureReady().finally(() => {this.starting = undefined;});
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
export default {
  async fetch(request:Request,env:Env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/downloads/windows") return releaseDownload(request,env);
    if (path === "/api/downloads/android") return androidDownload(request,env);
    if (path.startsWith("/__release/")) return releaseUpload(request,env);
    if (path.startsWith("/__storage/")) return storage(request,env);
    if (path !== "/gateway" && !path.startsWith("/api/")) return new Response(null,{status:404});
    try {
      // One Node process is the backend's realtime coordination unit. The beta
      // caps at one container until a shared event fanout is implemented.
      return await env.BACKEND.getByName("syndo-beta-weur-v3", { locationHint: "weur" }).fetch(request);
    } catch (error) {
      console.error("backend_unavailable", error instanceof Error ? error.message : "Unknown error");
      return Response.json({code:"backend_unavailable",message:"Syndo is starting. Please try again shortly."},{status:503,headers:{"retry-after":"10"}});
    }
  },
} satisfies ExportedHandler<Env>;
