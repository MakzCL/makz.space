// Stand-in for the desktop app's sendapp:// handler (desktop-tauri/src-tauri/src/bundle.rs), for browser tests:
// serves web/dist and passes /api calls to the server with its own session jar, redirecting direct paths.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
const [,, DIST, SERVER, PORT] = process.argv;
const jar = new Map();
export const token = () => jar.get("send_session") ?? jar.get("syndo_session") ?? null;
const DIRECT = ["/api/media/", "/api/files/read", "/api/emotes/img/", "/api/music/stream/", "/api/downloads/"];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".wasm": "application/wasm", ".mp3": "audio/mpeg", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".jpg": "image/jpeg" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__token") { res.end(JSON.stringify(token())); return; }
  if (u.pathname.startsWith("/api/")) {
    if ((req.method === "GET" || req.method === "HEAD") && DIRECT.some((p) => u.pathname.startsWith(p))) { res.writeHead(307, { location: SERVER + u.pathname + u.search, "cache-control": "no-store" }); res.end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = {};
    for (const h of ["content-type", "accept", "accept-language", "range", "if-none-match", "if-modified-since", "x-send-client", "x-syndo-client"]) if (req.headers[h]) headers[h] = req.headers[h];
    headers.origin = SERVER; headers["x-send-client"] = "1";
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(SERVER + u.pathname + u.search, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: "manual" });
    for (const c of r.headers.getSetCookie()) { const [kv, ...attrs] = c.split(";"); const [k, v] = kv.split("="); if (!["send_session", "syndo_session"].includes(k.trim())) continue; if (!v || attrs.some((a) => /max-age=0|1970/i.test(a))) jar.delete(k.trim()); else jar.set(k.trim(), v.trim()); }
    const out = {};
    for (const h of ["content-type", "cache-control", "content-range", "accept-ranges", "etag", "last-modified", "content-disposition", "location", "retry-after", "x-content-type-options"]) { let v = r.headers.get(h); if (v == null) continue; if (h === "location" && v.startsWith(SERVER)) v = v.slice(SERVER.length); out[h] = v; }
    res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const clean = u.pathname.replace(/^\/+/, "");
  let file = clean ? join(DIST, clean) : null, body = null;
  if (file) body = await readFile(file).catch(() => null);
  if (!body && (!clean.includes(".") || clean.startsWith("channels/") || clean.startsWith("invite/"))) { file = join(DIST, "index.html"); body = await readFile(file); }
  if (!body) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }); res.end(body);
}).listen(Number(PORT), () => console.log("fake app on", PORT));
