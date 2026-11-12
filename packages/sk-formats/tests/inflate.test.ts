// The built-in DEFLATE/zlib decoder against Node's zlib: stored, fixed and dynamic blocks, every level,
// trailing bytes after the stream, the output cap, and damaged input.
import { test } from "node:test"; import assert from "node:assert/strict"; import zlib from "node:zlib";
import { inflateRawSync, inflateZlibSync, InflateError } from "../src/inflate.ts";

let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const samples = (): Uint8Array[] => {
  const text = new TextEncoder().encode("CorelDRAW RIFF records repeat a lot: loda trfd fild outl ".repeat(400));
  const noise = Uint8Array.from({ length: 70000 }, () => Math.floor(rnd() * 256));
  const runs = Uint8Array.from({ length: 50000 }, (_, i) => (i >> 9) & 3);
  return [new Uint8Array(0), new Uint8Array([7]), text, noise, runs];
};
test("matches zlib for every level and strategy (stored, fixed, dynamic blocks)", () => {
  for (const s of samples()) for (const level of [0, 1, 6, 9]) for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FIXED, zlib.constants.Z_HUFFMAN_ONLY]) {
    assert.deepEqual(inflateZlibSync(zlib.deflateSync(s, { level, strategy })), s);
    const raw = zlib.deflateRawSync(s, { level, strategy }); const r = inflateRawSync(raw);
    assert.deepEqual(r.data, s); assert.equal(r.used, raw.length);
  }
});
test("bytes after the end of the stream are ignored and the consumed length is exact", () => {
  const s = samples()[2]; const raw = zlib.deflateRawSync(s);
  const r = inflateRawSync(new Uint8Array([...raw, 1, 2, 3, 4, 5]));
  assert.deepEqual(r.data, s); assert.equal(r.used, raw.length);
  assert.deepEqual(inflateZlibSync(new Uint8Array([...zlib.deflateSync(s), 0, 0, 0, 0, 0, 0, 0, 0])), s);
});
test("the output cap stops zip bombs", () => {
  assert.throws(() => inflateZlibSync(zlib.deflateSync(new Uint8Array(5_000_000)), 1_000_000), InflateError);
});
test("damaged input throws InflateError, never hangs or returns garbage silently", () => {
  const z = zlib.deflateSync(samples()[2]);
  assert.throws(() => inflateZlibSync(z.subarray(0, z.length >> 1)), InflateError);
  const bad = new Uint8Array(z); bad[z.length - 1] ^= 1; assert.throws(() => inflateZlibSync(bad), /checksum/);
  assert.throws(() => inflateZlibSync(new Uint8Array([0x78, 0x9c, 0xff, 0xff])), InflateError);
  for (let i = 0; i < 300; i++) { const f = new Uint8Array(z); f[2 + Math.floor(rnd() * (f.length - 2))] = Math.floor(rnd() * 256); try { inflateZlibSync(f); } catch (e) { assert.ok(e instanceof InflateError, String(e)); } }
});
