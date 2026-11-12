// readCdr against libcdr's reference output for the real CorelDRAW X5 fixture, plus the container paths
// (stored ZIP, deflated ZIP, compressed "cmpr" lists, block-length tables) and every refusal path.
// The wider check against the 84-file LibreOffice corpus is scripts/cdr-compare.ts (docs/CDR_IMPORT_VERIFICATION.md).
import { test } from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import { readCdr, cdrShapes, CdrError, type CdrDocument } from "../src/cdr.ts";
import { zipEntries, zipRead } from "../src/zip.ts";

const dir = path.join(import.meta.dirname, "fixtures");
const opts = { inflateRaw: async (d: Uint8Array, max: number) => new Uint8Array(zlib.inflateRawSync(d, { maxOutputLength: max })) };
const read = (f: string, o: Parameters<typeof readCdr>[1] = opts) => readCdr(new Uint8Array(fs.readFileSync(path.join(dir, f))), o);
const PT = 72 / 25.4;

// cdr2xhtml (libcdr 0.1.7) for corel-x5-stored.cdr, in points: rectangle corners, fill, stroke width
const LIBCDR_X5 = [
  { x0: 58.5649, y0: 100.1565, x1: 520.1467, y1: 179.6635, fill: "#0000ff" },
  { x0: 66.2947, y0: 213.8956, x1: 527.8765, y1: 308.8621, fill: "#ff0000" },
  { x0: 57.4608, y0: 356.3456, x1: 559.9001, y1: 452.4163, fill: "#6699ff" },
  { x0: 59.6693, y0: 496.5868, x1: 565.4214, y1: 608.1174, fill: "#006633" },
  { x0: 250.3389, y0: 117.5899, x1: 580.8158, y1: 577.5111, fill: "#1b1918", opacity: 0 },
];
function checkX5(doc: CdrDocument) {
  assert.equal(doc.version, 1500);
  assert.equal(doc.pages.length, 1);
  assert.ok(Math.abs(doc.pages[0].width - 210) < 1e-6 && Math.abs(doc.pages[0].height - 297) < 1e-6, "A4 page from the mcfg record");
  const shapes = doc.pages.flatMap((p) => p.layers.flatMap((l) => cdrShapes(l.objects)));
  assert.equal(shapes.length, 5);
  shapes.forEach((s, i) => {
    const r = LIBCDR_X5[i]; assert.equal(s.source, "rectangle");
    const xs = [s.paths[0].start[0], ...s.paths[0].segs.map((g) => g.p[0])].map((v) => v * PT), ys = [s.paths[0].start[1], ...s.paths[0].segs.map((g) => g.p[1])].map((v) => v * PT);
    for (const [got, want] of [[Math.min(...xs), r.x0], [Math.min(...ys), r.y0], [Math.max(...xs), r.x1], [Math.max(...ys), r.y1]]) assert.ok(Math.abs(got - want) < 0.001, `shape ${i}: ${got} vs ${want}`);
    assert.equal(s.paths[0].closed, true);
    assert.equal(s.fill?.type, "solid"); assert.equal(s.fill?.color?.hex, r.fill);
    assert.ok(s.outline && Math.abs(s.outline.width * PT - 0.5669) < 0.0005, "0.2 mm outline from the named style");
    assert.equal(s.outline?.color.hex, "#000000");
    assert.equal(s.opacity, r.opacity ?? 1);
  });
  assert.deepEqual(doc.skipped, {});
}

test("CorelDRAW X5 (stored ZIP): geometry, page, fills, outlines and opacity match libcdr", async () => checkX5(await read("corel-x5-stored.cdr")));
test("CorelDRAW X5 (deflated ZIP): same result", async () => checkX5(await read("corel-x5-deflated.cdr")));
test("deflated ZIP with no platform decompressor: the built-in decoder reads it", async () => checkX5(await read("corel-x5-deflated.cdr", {})));
test("a ZIP whose drawing cannot be decompressed: a clear error, not a partial import", async () => {
  await assert.rejects(read("corel-x5-deflated.cdr", { inflateRaw: async () => { throw new Error("boom"); } }), (e: Error) => e instanceof CdrError && /could not be decompressed/.test(e.message));
});

async function riffOf(f: string): Promise<Uint8Array> {
  const b = new Uint8Array(fs.readFileSync(path.join(dir, f))); const e = zipEntries(b)!.find((x) => x.name === "content/riffData.cdr")!;
  return (await zipRead(b, e, opts.inflateRaw))!;
}
const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const ascii = (s: string) => new TextEncoder().encode(s);
/** Wrap a RIFF's body in one compressed "cmpr" list, as CorelDRAW 8–12 store their documents. */
function compressBody(riff: Uint8Array, blocks: number[] = [], body = riff.subarray(12), pad = 0): Uint8Array {
  const z = zlib.deflateSync(body), zb = cat(zlib.deflateSync(cat(...blocks.map(le32))), new Uint8Array(pad));
  const list = cat(ascii("cmpr"), le32(z.length), new Uint8Array(12), ascii("CPng"), new Uint8Array([1, 0, 4, 0]), z, zb);
  const inner = cat(ascii("LIST"), le32(list.length), list);
  return cat(ascii("RIFF"), le32(inner.length + 4), riff.subarray(8, 12), inner);
}
test("compressed lists (CorelDRAW 8–12 layout) decode to the same drawing", async () => {
  checkX5(await readCdr(compressBody(await riffOf("corel-x5-stored.cdr")), opts));
});
test("record lengths given as indices into the block-length table are resolved", async () => {
  const riff = await riffOf("corel-x5-stored.cdr"); const body = riff.slice(12);
  const realLen = new DataView(body.buffer, body.byteOffset).getUint32(4, true);
  new DataView(body.buffer, body.byteOffset).setUint32(4, 0, true); // first record's length → index 0
  checkX5(await readCdr(compressBody(riff, [realLen], body), opts));
});
test("regression: padding after a compressed section is ignored and nothing is truncated (browser decoders dropped output here)", async () => {
  checkX5(await readCdr(compressBody(await riffOf("corel-x5-stored.cdr"), [], undefined, 12), {}));
});
test("a damaged compressed section: a clear error", async () => {
  const f = compressBody(await riffOf("corel-x5-stored.cdr")); f[60] ^= 0xff; f[61] ^= 0xff;
  await assert.rejects(readCdr(f, {}), (e: Error) => e instanceof CdrError && /compressed section is damaged/.test(e.message));
});

test("refusals: not CDR, CorelDRAW 1–2, CorelDRAW 3, damaged input", async () => {
  await assert.rejects(read("img.png"), /no RIFF header/);
  await assert.rejects(read("corrupt-not-riff.cdr"), CdrError);
  await assert.rejects(readCdr(cat(ascii("WLe\0"), new Uint8Array(64)), opts), /CorelDRAW 1–2/);
  await assert.rejects(readCdr(cat(ascii("RIFF"), le32(4), ascii("CDR ")), opts), /CorelDRAW 3/);
  await assert.rejects(readCdr(cat(ascii("RIFF"), le32(4), ascii("WAVE")), opts), /Not a CorelDRAW drawing/);
});
test("a truncated file never throws past the reader and never invents shapes", async () => {
  const riff = await riffOf("corel-x5-stored.cdr");
  for (const cut of [100, 1000, 4000, Math.floor(riff.length / 2), riff.length - 10]) {
    const doc = await readCdr(riff.subarray(0, cut), opts).catch((e) => { assert.ok(e instanceof Error); return null; });
    if (doc) assert.ok(doc.pages.flatMap((p) => p.layers.flatMap((l) => cdrShapes(l.objects))).length <= 5);
  }
});
test("the shape limit is honoured and reported", async () => {
  const doc = await read("corel-x5-stored.cdr", { ...opts, maxShapes: 2 });
  assert.equal(doc.pages.flatMap((p) => p.layers.flatMap((l) => cdrShapes(l.objects))).length, 2);
  assert.equal(doc.skipped["shapes beyond the limit"], 3);
});
