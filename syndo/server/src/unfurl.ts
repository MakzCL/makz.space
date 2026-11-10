import { createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { Embed } from "@syndo/shared";
import { q, q1 } from "./db.ts";

/**
 * Link previews (Open Graph / Twitter cards, YouTube, direct images) fetched server-side.
 *
 * SSRF protection: only http(s) on ports 80/443, every DNS answer is checked and private,
 * loopback, link-local, CGNAT, multicast and reserved ranges are refused (also on every
 * redirect, and at connect time so DNS rebinding can't slip through). Bodies are capped,
 * requests time out, and nothing is ever fetched for encrypted DMs.
 * Images in previews are served through /api/embed-media with an HMAC so the viewer's IP
 * never reaches the linked site and the proxy can't be used for arbitrary URLs.
 */

const SECRET = process.env.SYNDO_SECRET || randomBytes(32).toString("hex");
const UA = "Mozilla/5.0 (compatible; SENDbot/1.0; +https://syndo.makz.space)";

export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff") || v.startsWith("64:ff9b") || v.startsWith("2001:db8");
}

const safeLookup: any = (host: string, opts: any, cb: any) => {
  dnsLookup(host, { all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const list = (addrs as { address: string; family: number }[]);
    if (!list.length || list.some((a) => privateAddress(a.address))) return cb(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }));
    if (opts?.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
};

export function allowedUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.port && u.port !== "80" && u.port !== "443") return null;
    if (u.username || u.password) return null;
    if (isIP(u.hostname.replace(/^\[|\]$/g, "")) && privateAddress(u.hostname.replace(/^\[|\]$/g, ""))) return null;
    if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(u.hostname)) return null;
    return u;
  } catch { return null; }
}

interface Fetched { status: number; type: string; body: Buffer; url: string; headers: http.IncomingHttpHeaders }

/** GET with SSRF checks, redirects (re-checked), a size cap and a timeout. */
export function safeFetch(raw: string, opts: { maxBytes?: number; accept?: string; redirects?: number; stream?: false } = {}): Promise<Fetched> {
  const max = opts.maxBytes ?? 768 * 1024;
  return new Promise((resolve, reject) => {
    const u = allowedUrl(raw);
    if (!u) return reject(new Error("url not allowed"));
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "GET", lookup: safeLookup, timeout: 6000, headers: { "user-agent": UA, accept: opts.accept ?? "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5", "accept-language": "en" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if ((opts.redirects ?? 0) >= 4) return reject(new Error("too many redirects"));
        return safeFetch(new URL(res.headers.location, u).toString(), { ...opts, redirects: (opts.redirects ?? 0) + 1 }).then(resolve, reject);
      }
      const chunks: Buffer[] = []; let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n > max) { chunks.push(c.subarray(0, Math.max(0, c.length - (n - max)))); req.destroy(); finish(); return; } chunks.push(c); });
      let done = false;
      const finish = () => { if (done) return; done = true; resolve({ status, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks), url: u.toString(), headers: res.headers }); };
      res.on("end", finish); res.on("error", reject); res.on("close", finish);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** POST JSON to a public URL with the same SSRF protection (bot interaction endpoints). */
export function safePost(raw: string, body: string, headers: Record<string, string>, timeoutMs = 3000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = allowedUrl(raw);
    if (!u || u.protocol !== "https:") return reject(new Error("url not allowed"));
    const req = https.request(u, { method: "POST", lookup: safeLookup, timeout: timeoutMs, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), "user-agent": UA, ...headers } }, (res) => {
      const chunks: Buffer[] = []; let n = 0;
      res.on("data", (c: Buffer) => { n += c.length; if (n > 256 * 1024) { req.destroy(); return; } chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

/** Signed proxy URL for an image/video in a preview. */
export function proxied(url: string | null | undefined): string | null {
  if (!url || !allowedUrl(url)) return null;
  const sig = createHmac("sha256", SECRET).update(url).digest("base64url").slice(0, 32);
  return `/api/embed-media?u=${encodeURIComponent(url)}&s=${sig}`;
}
export function checkProxySig(url: string, sig: string) {
  const want = createHmac("sha256", SECRET).update(url).digest("base64url").slice(0, 32);
  return sig.length === want.length && sig === want;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
  if (e[0] === "#") { const cp = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, " ").trim();

export function parseMeta(html: string, base: string) {
  const head = html.slice(0, 300_000);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const val = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && val !== undefined && !(key in meta)) meta[key] = decode(val);
  }
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(head)?.[1];
  const abs = (v: string | undefined) => { if (!v) return null; try { return new URL(v, base).toString(); } catch { return null; } };
  return {
    title: meta["og:title"] ?? meta["twitter:title"] ?? (title ? decode(title) : null),
    description: meta["og:description"] ?? meta["twitter:description"] ?? meta["description"] ?? null,
    site_name: meta["og:site_name"] ?? null,
    image: abs(meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"] ?? meta["twitter:image:src"]),
    image_w: Number(meta["og:image:width"]) || null, image_h: Number(meta["og:image:height"]) || null,
    video: abs(meta["og:video:secure_url"] ?? meta["og:video:url"] ?? meta["og:video"]),
    video_type: meta["og:video:type"] ?? null,
    color: /^#[0-9a-f]{6}$/i.test(meta["theme-color"] ?? "") ? meta["theme-color"]! : null,
    card: meta["twitter:card"] ?? null,
  };
}

function youtubeId(u: URL): string | null {
  const h = u.hostname.replace(/^www\.|^m\./, "");
  if (h === "youtu.be") return /^\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
  if (h === "youtube.com" || h === "music.youtube.com") {
    if (u.pathname === "/watch") return /^[\w-]{11}$/.test(u.searchParams.get("v") ?? "") ? u.searchParams.get("v") : null;
    return /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
  }
  return null;
}

/** Build the preview for one URL (cached for a day; failures cached for an hour). */
export async function previewFor(raw: string): Promise<Embed | null> {
  const u = allowedUrl(raw);
  if (!u) return null;
  const key = u.toString().slice(0, 2000);
  const cached = await q1<any>("select data, fetched_at from link_previews where url = $1", [key]);
  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < (cached.data ? 86_400_000 : 3_600_000)) return cached.data;
  }
  let embed: Embed | null = null;
  try {
    const yt = youtubeId(u);
    if (yt) {
      let title: string | null = null, author: string | null = null;
      try {
        const r = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`, { accept: "application/json" });
        if (r.status === 200) { const j = JSON.parse(r.body.toString("utf8")); title = j.title ?? null; author = j.author_name ?? null; }
      } catch { /* title is optional */ }
      embed = { type: "video", url: key, title, site_name: "YouTube", color: "#FF0000", author: author ? { name: author } : null,
        thumbnail: { url: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, width: 480, height: 360 },
        video: { url: `https://www.youtube-nocookie.com/embed/${yt}`, width: 1280, height: 720, embed: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1` } };
    } else {
      const r = await safeFetch(key);
      if (r.status >= 200 && r.status < 300) {
        if (/^image\/(png|jpe?g|gif|webp|avif)/i.test(r.type)) embed = { type: r.type.includes("gif") ? "gifv" : "image", url: key, image: { url: key } };
        else if (/^video\/(mp4|webm)/i.test(r.type)) embed = { type: "video", url: key, video: { url: key } };
        else if (/html/i.test(r.type)) {
          const m = parseMeta(r.body.toString("utf8"), r.url);
          if (m.title || m.description || m.image) {
            const big = m.card === "summary_large_image" || (m.image_w ?? 0) >= 400;
            embed = {
              type: m.video && /mp4|webm/.test(m.video_type ?? m.video) ? "video" : "link",
              url: key, title: m.title?.slice(0, 256) ?? null, description: m.description?.slice(0, 350) ?? null,
              site_name: m.site_name?.slice(0, 100) ?? null, color: m.color,
              ...(m.image ? (big ? { image: { url: m.image, width: m.image_w, height: m.image_h } } : { thumbnail: { url: m.image, width: m.image_w, height: m.image_h } }) : {}),
              ...(m.video && /mp4|webm/.test(m.video_type ?? m.video) ? { video: { url: m.video } } : {}),
            };
          }
        }
      }
    }
  } catch { embed = null; }
  await q("insert into link_previews(url, data, fetched_at) values ($1,$2, now()) on conflict (url) do update set data = excluded.data, fetched_at = now()", [key, embed ? JSON.stringify(embed) : null]);
  return embed;
}

/** Links in message text worth previewing: not in code, not <wrapped>, not ||spoilered||, max 5. */
export function linksIn(content: string): string[] {
  const text = content.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/\|\|[\s\S]*?\|\|/g, " ").replace(/<https?:\/\/[^>\s]+>/g, " ");
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+[^\s<>()"'.,!?:;]/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 5) break;
  }
  return out;
}

/** Signed image URLs for the wire (hydrate). Raw URLs stay in the database. */
export function embedOut(e: Embed): Embed {
  const img = (x: { url: string; width?: number | null; height?: number | null } | null | undefined) => (x ? { ...x, url: proxied(x.url) ?? "" } : x);
  const isYt = e.video?.embed?.startsWith("https://www.youtube-nocookie.com/");
  return {
    ...e,
    thumbnail: isYt && e.thumbnail ? { ...e.thumbnail, url: proxied(e.thumbnail.url) ?? "" } : img(e.thumbnail) ?? null,
    image: img(e.image) ?? null,
    video: e.video ? (isYt ? e.video : { ...e.video, url: proxied(e.video.url) ?? "" }) : null,
    author: e.author ? { ...e.author, icon_url: proxied(e.author.icon_url) } : null,
    footer: e.footer ? { ...e.footer, icon_url: proxied(e.footer.icon_url) } : null,
  };
}
