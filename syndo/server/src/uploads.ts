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

function isAnimated(b: Buffer, mime: string) {
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
