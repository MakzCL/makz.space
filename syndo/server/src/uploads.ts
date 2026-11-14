import type { FastifyRequest } from "fastify";
import { fileTypeFromBuffer } from "file-type";
import { bad } from "./errors.ts";

export const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/** Read one multipart file fully (bounded) — for avatars, icons, emoji. */
export async function readImage(req: FastifyRequest, maxBytes: number): Promise<{ buf: Buffer; mime: string; ext: string; width: number | null; height: number | null; animated: boolean }> {
  const file = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
  if (!file) throw bad("Attach an image.");
  const buf = await file.toBuffer().catch(() => { throw bad(`Images can be up to ${Math.round(maxBytes / 1048576)} MB.`, "too_large"); });
  if (file.file.truncated) throw bad(`Images can be up to ${Math.round(maxBytes / 1048576)} MB.`, "too_large");
  const t = await fileTypeFromBuffer(buf);
  if (!t || !IMAGE_TYPES.has(t.mime)) throw bad("Use a PNG, JPEG, GIF, WebP or AVIF image.", "bad_type");
  const dims = imageSize(buf, t.mime);
  return { buf, mime: t.mime, ext: t.ext, ...dims, animated: isAnimated(buf, t.mime) };
}

/** Width/height from the header bytes of common formats (no decoding). */
export function imageSize(b: Buffer, mime: string): { width: number | null; height: number | null } {
  try {
    if (mime === "image/png") return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (mime === "image/gif") return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    if (mime === "image/webp") {
      const kind = b.toString("ascii", 12, 16);
      if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      if (kind === "VP8L") { const v = b.readUInt32LE(21); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (kind === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) break;
        const m = b[i + 1]!;
        const len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch { /* fall through */ }
  return { width: null, height: null };
}

export function isAnimated(b: Buffer, mime: string) {
  if (mime === "image/gif") return b.indexOf(Buffer.from("NETSCAPE2.0")) > 0 || countGifFrames(b) > 1;
  if (mime === "image/webp") return b.toString("ascii", 12, 16) === "VP8X" && (b[20]! & 0x02) !== 0;
  if (mime === "image/png") return b.indexOf(Buffer.from("acTL")) > 0;
  return false;
}
const countGifFrames = (b: Buffer) => { let n = 0; for (let i = 0; i < b.length - 1 && n < 2; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9) n++; return n; };

/** Safe download name: no path, no control characters, bounded length. */
export function safeName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "file";
}

/**
 * Shrink an image for display: fit inside `max` pixels and re-encode as WebP (animation kept), only when that
 * actually makes the file smaller. A 10 MB phone photo used as an avatar becomes ~40 KB. If sharp is unavailable
 * or the image can't be decoded, the original is kept.
 */
export async function shrinkImage<T extends { buf: Buffer; mime: string; ext: string; width: number | null; height: number | null; animated: boolean }>(img: T, max: number): Promise<T> {
  try {
    const sharp = (await import("sharp")).default;
    const big = (img.width ?? max + 1) > max || (img.height ?? max + 1) > max;
    if (!big && img.buf.length < 200 * 1024) return img;
    const out = await sharp(img.buf, { animated: img.animated, limitInputPixels: 80_000_000 })
      .rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
      .webp({ quality: img.animated ? 75 : 82, effort: 4 }).toBuffer({ resolveWithObject: true });
    if (out.data.length >= img.buf.length) return img;
    return { ...img, buf: out.data, mime: "image/webp", ext: "webp", width: out.info.width, height: img.animated ? img.height : out.info.height };
  } catch { return img; }
}
/** Pixel limits per kind of image. */
export const IMAGE_MAX = { avatar: 512, icon: 512, banner: 1500, emoji: 256, sticker: 320 } as const;

/** Read an uploaded image and store it under `${prefix}/<id>.<ext>`; returns the storage key. */
export async function saveImage(req: FastifyRequest, prefix: string, maxBytes: number): Promise<string> {
  const img = await shrinkImage(await readImage(req, maxBytes), prefix.includes("banner") ? IMAGE_MAX.banner : IMAGE_MAX.avatar);
  const { newId } = await import("./ids.ts");
  const storage = await import("./storage.ts");
  const key = `${prefix}/${newId()}.${img.ext}`;
  await storage.put(key, img.buf);
  return key;
}

/**
 * Background clean-up: re-encode profile images that were stored at full upload size (some were megabytes).
 * Runs a few at a time from the maintenance loop; each image is only checked once per process.
 */
const checked = new Set<string>();
const SHRINK_TARGETS = [
  { table: "users", col: "avatar_key", max: IMAGE_MAX.avatar, where: "true" }, { table: "users", col: "banner_key", max: IMAGE_MAX.banner, where: "true" },
  { table: "members", col: "avatar_key", max: IMAGE_MAX.avatar, where: "true" }, { table: "members", col: "banner_key", max: IMAGE_MAX.banner, where: "true" },
  { table: "guilds", col: "icon_key", max: IMAGE_MAX.icon, where: "true" }, { table: "guilds", col: "banner_key", max: IMAGE_MAX.banner, where: "true" },
] as const;
export async function shrinkStoredImages(limit = 6) {
  const { q } = await import("./db.ts");
  const storage = await import("./storage.ts");
  let done = 0;
  for (const t of SHRINK_TARGETS) {
    const rows = await q<{ k: string }>(`select distinct ${t.col} as k from ${t.table} where ${t.col} is not null and ${t.col} not like '%.webp' limit 200`).catch(() => []);
    for (const { k } of rows) {
      if (done >= limit) return done;
      if (checked.has(k)) continue;
      checked.add(k);
      try {
        if (Number(await storage.size(k)) < 300 * 1024) continue;
        const chunks: Buffer[] = []; for await (const c of storage.open(k) as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
        const buf = Buffer.concat(chunks), ft = await fileTypeFromBuffer(buf);
        if (!ft || !IMAGE_TYPES.has(ft.mime)) continue;
        const img = await shrinkImage({ buf, mime: ft.mime, ext: ft.ext, ...imageSize(buf, ft.mime), animated: isAnimated(buf, ft.mime) }, t.max);
        if (img.buf === buf) continue;
        const next = k.replace(/\.[a-z0-9]+$/i, ".webp");
        if (next === k) continue;
        await storage.put(next, img.buf);
        await q(`update ${t.table} set ${t.col} = $2 where ${t.col} = $1`, [k, next]);
        await storage.remove(k).catch(() => {});
        checked.add(next); done++;
        console.log(`[images] shrank ${k} ${buf.length} -> ${img.buf.length} bytes`);
      } catch (e) { console.error("[images]", k, (e as Error).message); }
    }
  }
  return done;
}
