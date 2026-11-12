// Detection must identify each fixture by content, read its version where the format records one, flag wrong
// extensions, and never guess for unknown content. Fixture origins: tests/fixtures/README.md.
import { test } from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import { detect, cdrVersionFromChar, defaultRegistry, routeFor, ADAPTERS, type FormatId } from "../src/index.ts";

const dir = path.join(import.meta.dirname, "fixtures");
const inflateRaw = async (d: Uint8Array, max: number) => new Uint8Array(zlib.inflateRawSync(d, { maxOutputLength: max }));
const det = (f: string) => detect(new Uint8Array(fs.readFileSync(path.join(dir, f))), f, { inflateRaw });

const CASES: [string, FormatId, string | null | RegExp][] = [
  ["corel-x5-stored.cdr", "cdr", "CDR 15 (CorelDRAW X5)"], ["corel-x5-deflated.cdr", "cdr", "CDR 15 (CorelDRAW X5)"], ["corel.cmx", "cmx", "CMX 1 (32-bit)"],
  ["img.png", "png", null], ["img.jpg", "jpeg", null], ["img.gif", "gif", /^8[79]a$/], ["img.bmp", "bmp", null], ["img.tif", "tiff", /endian/], ["img.webp", "webp", /VP8/],
  ["min.pdf", "pdf", "PDF 1.7"], ["illustrator.ai", "ai", /PDF-based Illustrator \(PDF 1.6\)/], ["ps-illustrator.ai", "ai", /PostScript-based Illustrator/], ["min.eps", "eps", "EPSF 3.0"],
  ["min.svg", "svg", "1.1"], ["min.svgz", "svgz", null], ["r12.dxf", "dxf", /R12 or earlier|AC1009/], ["r2018.dxf", "dxf", "AutoCAD 2018 (AC1032)"],
  ["synthetic-header.dwg", "dwg", "AutoCAD 2018 (AC1032)"], ["min.step", "step", /AUTOMOTIVE_DESIGN/], ["min.igs", "iges", null], ["ascii.stl", "stl", null], ["binary.stl", "stl-binary", "1 triangles"],
  ["min.3mf", "3mf", null], ["min.xlsx", "xlsx", null], ["synthetic-ole.sldprt", "ole-cad", null], ["synthetic-header.psd", "psd", "PSD"], ["plot.plt", "hpgl", null], ["table.csv", "csv", null],
  ["project.trotan", "trotan-project", null], ["project.nucleus", "nucleus-project", null], ["drawing.cadra", "cadra-drawing", null],
];
for (const [f, fmt, ver] of CASES) test(`${f} → ${fmt}`, async () => {
  const d = await det(f); assert.equal(d.format, fmt, JSON.stringify(d)); assert.notEqual(d.basis, "none");
  if (ver instanceof RegExp) assert.match(d.version ?? "", ver); else if (ver !== null) assert.equal(d.version, ver);
  assert.equal(d.extensionMismatch, false, `unexpected mismatch for ${f}`);
});
test("the real zipped CorelDRAW file: version read from inside the container, matching libcdr's rule", async () => {
  const d = await det("corel-x5-deflated.cdr"); assert.equal(d.basis, "structure"); assert.match(d.notes[0], /content\/riffData\.cdr/);
  const v = Number(d.version!.match(/CDR (\d+)/)![1]); assert.ok(v >= 14, "zipped CDR files start at X4 (14)");
});
test("a renamed PNG is a PNG, flagged as a mismatch; a .cdr that is not CDR is not called CDR", async () => {
  const p = await det("renamed-png.cdr"); assert.equal(p.format, "png"); assert.equal(p.extensionMismatch, true);
  const c = await det("corrupt-not-riff.cdr"); assert.notEqual(c.format, "cdr"); assert.equal(c.format, "unknown");
});
test("random bytes are unknown; Proteus files are recognised by name only and say so", async () => {
  assert.equal((await det("noise.xyz")).format, "unknown");
  const p = await det("random.dsn"); assert.equal(p.format, "proteus-legacy"); assert.equal(p.basis, "extension");
  assert.equal((await det("other.zip")).format, "zip");
});
test("without a decompressor the zipped CDR is still recognised, with no version claimed", async () => {
  const d = await detect(new Uint8Array(fs.readFileSync(path.join(dir, "corel-x5-deflated.cdr"))), "x.cdr");
  assert.equal(d.format, "cdr"); assert.equal(d.version, null); assert.ok(d.notes.some((n) => /not read/.test(n)));
});
test("CDR version characters follow libcdr: ' ' = 3, '7' = 7, 'E' = 14, 'N' = 23", () => {
  assert.equal(cdrVersionFromChar(0x20), 3); assert.equal(cdrVersionFromChar(0x37), 7); assert.equal(cdrVersionFromChar(0x45), 14); assert.equal(cdrVersionFromChar(0x4e), 23); assert.equal(cdrVersionFromChar(0x30), null);
});
test("routing: SVG → TROTAN, DXF → CADRA (TROTAN also reads it), CDR → TROTAN (partial import), CMX recognised but no reader yet, unknown → nowhere", async () => {
  const reg = defaultRegistry();
  assert.equal(routeFor(await det("min.svg"), reg).app, "trotan");
  const dxf = await det("r2018.dxf"); assert.equal(routeFor(dxf, reg).app, "cadra"); assert.deepEqual(reg.readersFor(dxf).map((a) => a.app).sort(), ["cadra", "trotan"]);
  const cdr = routeFor(await det("corel-x5-stored.cdr"), reg); assert.equal(cdr.app, "trotan"); assert.equal(cdr.adapter?.read, "partial-import");
  const cmx = routeFor(await det("corel.cmx"), reg); assert.equal(cmx.adapter, null); assert.match(cmx.reason, /no SK Suite application can read it yet/);
  assert.equal(routeFor(await det("noise.xyz"), reg).app, null);
});
test("every adapter claiming more than 'unsupported' names the tests behind the claim (except declared untested CSV)", () => {
  for (const a of ADAPTERS) if (a.read !== "unsupported" || a.write !== "unsupported") assert.ok(a.tests.length > 0 || a.limitations.some((l) => /not covered by an automated test/.test(l)), a.id);
});
