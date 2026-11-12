// Minimal, defensive ZIP reader: lists entries from the central directory and extracts one entry (stored or deflated).
// Used to look inside container formats (modern CorelDRAW, XLSX, 3MF, F3D). Limits protect against zip bombs.
export interface ZipEntry { name: string; method: number; csize: number; usize: number; offset: number }
export const ZIP_LIMITS = { maxEntries: 20000, maxEntryBytes: 512 * 1024 * 1024 };
/** Inflate a raw DEFLATE stream (browser: DecompressionStream("deflate-raw"); Node: zlib.inflateRawSync). */
export type InflateRaw = (data: Uint8Array, maxBytes: number) => Promise<Uint8Array>;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Entries of a ZIP archive, or null if the central directory cannot be found or is inconsistent. */
export function zipEntries(b: Uint8Array): ZipEntry[] | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = u16(b, eocd + 10), cdOff = u32(b, eocd + 16);
  if (count > ZIP_LIMITS.maxEntries || cdOff >= b.length) return null;
  const out: ZipEntry[] = []; let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) return null;
    const method = u16(b, p + 10), csize = u32(b, p + 20), usize = u32(b, p + 24), nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), offset = u32(b, p + 42);
    if (p + 46 + nlen > b.length) return null;
    out.push({ name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nlen)), method, csize, usize, offset });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/** The bytes of one entry, or null if it is missing, too large, or uses an unsupported compression method. */
export async function zipRead(b: Uint8Array, e: ZipEntry, inflate: InflateRaw | undefined, maxBytes = ZIP_LIMITS.maxEntryBytes): Promise<Uint8Array | null> {
  if (e.usize > maxBytes || e.offset + 30 > b.length || u32(b, e.offset) !== 0x04034b50) return null;
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28); const data = b.subarray(start, start + e.csize);
  if (data.length < e.csize) return null;
  if (e.method === 0) return data;
  if (e.method === 8 && inflate) return inflate(data, Math.min(maxBytes, Math.max(e.usize, 1)));
  return null;
}
