// DEFLATE (RFC 1951) and zlib (RFC 1950) decoder, written for @sk/formats.
// Why our own: browser DecompressionStream rejects bytes after the end of a stream and, when it does, drops
// output it had already decoded. CorelDRAW pads its compressed sections, so the platform decoder silently
// truncated drawings. This decoder stops at the end of the stream and reports how many input bytes it used.
// It is bounded: output is capped (zip-bomb protection) and malformed input throws, never loops.

export class InflateError extends Error {}
const fail = (m: string): never => { throw new InflateError(m); };

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Canonical Huffman decoding table: counts per length and symbols sorted by code. */
interface Huff { count: Uint16Array; sym: Uint16Array }
function build(lengths: ArrayLike<number>, n: number): Huff {
  const count = new Uint16Array(16), offs = new Uint16Array(16), sym = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  let left = 1;
  for (let len = 1; len < 16; len++) { left = (left << 1) - count[len]; if (left < 0) fail("over-subscribed Huffman code"); }
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i]) sym[offs[lengths[i]]++] = i;
  return { count, sym };
}
let FIXED: { lit: Huff; dist: Huff } | null = null;
function fixed() {
  if (!FIXED) {
    const l = new Uint8Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    FIXED = { lit: build(l, 288), dist: build(new Uint8Array(30).fill(5), 30) };
  }
  return FIXED;
}

/** Raw DEFLATE. Returns the output and the number of input bytes consumed (the rest is ignored). */
export function inflateRawSync(src: Uint8Array, maxBytes = 512 * 1024 * 1024, start = 0): { data: Uint8Array; used: number } {
  let pos = start, bitBuf = 0, bitCnt = 0;
  let out = new Uint8Array(Math.min(maxBytes, Math.max(1024, src.length * 4))), n = 0;
  const need = (k: number) => {
    if (n + k <= out.length) return;
    if (n + k > maxBytes) fail(`decompressed data exceeds ${maxBytes} bytes`);
    const grown = new Uint8Array(Math.min(maxBytes, Math.max(n + k, out.length * 2))); grown.set(out.subarray(0, n)); out = grown;
  };
  const bits = (k: number) => {
    while (bitCnt < k) { if (pos >= src.length) fail("unexpected end of compressed data"); bitBuf |= src[pos++] << bitCnt; bitCnt += 8; }
    const v = bitBuf & ((1 << k) - 1); bitBuf >>>= k; bitCnt -= k; return v;
  };
  const decode = (h: Huff) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1); const c = h.count[len];
      if (code - c < first) return h.sym[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    return fail("invalid Huffman code");
  };
  let last = 0;
  while (!last) {
    last = bits(1); const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) fail("unexpected end of compressed data");
      const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8); pos += 4;
      if ((len ^ 0xffff) !== nlen) fail("stored block length check failed");
      if (pos + len > src.length) fail("unexpected end of compressed data");
      need(len); out.set(src.subarray(pos, pos + len), n); n += len; pos += len;
      continue;
    }
    if (type === 3) fail("invalid block type");
    let lit: Huff, dist: Huff;
    if (type === 1) ({ lit, dist } = fixed());
    else {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      if (hlit > 286 || hdist > 30) fail("bad code lengths");
      const cl = new Uint8Array(19); for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
      const clh = build(cl, 19); const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const s = decode(clh);
        if (s < 16) lens[i++] = s;
        else {
          let rep = 0, val = 0;
          if (s === 16) { if (!i) fail("repeat with no previous length"); val = lens[i - 1]; rep = 3 + bits(2); }
          else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
          if (i + rep > hlit + hdist) fail("too many code lengths");
          lens.fill(val, i, i + rep); i += rep;
        }
      }
      if (!lens[256]) fail("no end-of-block code");
      lit = build(lens.subarray(0, hlit), hlit); dist = build(lens.subarray(hlit), hdist);
    }
    for (;;) {
      const s = decode(lit);
      if (s < 256) { need(1); out[n++] = s; continue; }
      if (s === 256) break;
      const li = s - 257; if (li >= 29) fail("bad length symbol");
      const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
      const di = decode(dist); if (di >= 30) fail("bad distance symbol");
      const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
      if (d > n) fail("distance before start of output");
      need(len); for (let k = 0; k < len; k++, n++) out[n] = out[n - d];
    }
  }
  return { data: out.slice(0, n), used: pos - start };
}

/** zlib stream (2-byte header, DEFLATE data, Adler-32). Bytes after the checksum are ignored. */
export function inflateZlibSync(src: Uint8Array, maxBytes?: number): Uint8Array {
  if (src.length < 2 || (src[0] & 0x0f) !== 8 || ((src[0] << 8) | src[1]) % 31 !== 0) fail("not a zlib stream");
  if (src[1] & 0x20) fail("zlib preset dictionaries are not supported");
  const { data, used } = inflateRawSync(src, maxBytes, 2);
  const at = 2 + used;
  if (at + 4 <= src.length) {
    let a = 1, b = 0; for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
    const want = ((src[at] << 24) | (src[at + 1] << 16) | (src[at + 2] << 8) | src[at + 3]) >>> 0;
    if ((((b << 16) | a) >>> 0) !== want) fail("zlib checksum mismatch");
  }
  return data;
}
