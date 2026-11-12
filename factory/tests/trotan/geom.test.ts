// TROTAN geometry, file and laser-job tests. Run: npm run test:trotan
import { test } from "node:test";
import assert from "node:assert/strict";
import { I, apply, boxOfPaths, ellipsePaths, flatten, inv, mul, newDoc, parsePathData, pathData, polyArea, polyLength, rectPaths, rotate, transformPaths, type Doc, type Mat, type SubPath } from "../../src/trotan/geom/core";
import { booleanOp, duplicateSegments, joinPaths, kerfCompensate, offsetPaths, openContours, selfIntersections, splitAt } from "../../src/trotan/geom/ops";
import { exportSvg, importSvg, lengthMm, parseTransform } from "../../src/trotan/geom/svg";
import { exportDxf, importDxf } from "../../src/trotan/geom/dxf";
import { arrayPlacements, buildToolpath, checkParams, estimate, nestRects, partsArea, placementBox, removeSharedEdges, validateJob, type MachineCaps, type OpParams } from "../../src/trotan/geom/laser";
import { checkDoc, readProject, writeProject } from "../../src/trotan/geom/project";

const near = (a: number, b: number, eps = 1e-6, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const area = (ps: SubPath[]) => flatten(ps, 0.001).reduce((s, p) => s + Math.abs(polyArea(p.pts)), 0);
const CAPS: MachineCaps = { bedW: 600, bedH: 400, laserType: "co2", maxPowerW: 60, maxSpeed: 1000, maxRasterSpeed: 3550, accel: 15000, travelSpeed: 1200, ops: ["cut", "kiss", "score", "vengrave", "mark", "raster"], freq: { min: 1000, max: 60000 }, dpi: [125, 250, 333, 500, 600, 1000], focus: { min: -10, max: 10 }, airAssist: true, maxPasses: 10 };
const P = (o: Partial<OpParams> = {}): OpParams => ({ power: 80, speed: 20, freq: 5000, passes: 1, focus: 0, dpi: 500, air: true, direction: "down", order: 0, ...o });
const sq = (x: number, y: number, s: number): SubPath[] => transformPaths(rectPaths(s, s), [1, 0, 0, 1, x, y]);
function docWith(...objs: { paths: SubPath[]; layer?: string }[]): Doc {
  const d = newDoc(300, 200);
  d.objects = objs.map((o, i) => ({ id: `p${i}`, layer: o.layer ?? "L-cut", kind: "path", m: [...I] as Mat, paths: o.paths }));
  return d;
}

test("units: lengths convert to mm", () => {
  near(lengthMm("10mm")!.mm, 10); near(lengthMm("1in")!.mm, 25.4); near(lengthMm("72pt")!.mm, 25.4); near(lengthMm("96px")!.mm, 25.4); near(lengthMm("96")!.mm, 25.4); near(lengthMm("2.5cm")!.mm, 25);
  assert.equal(lengthMm("50%"), null); assert.equal(lengthMm("abc"), null);
});
test("matrices: inverse and composition are exact", () => {
  const m = mul(rotate(33), [2, 0, 0, 3, 5, -7]);
  const p = apply(inv(m), apply(m, [12.345, -6.789]));
  near(p[0], 12.345, 1e-9); near(p[1], -6.789, 1e-9);
  near(apply(parseTransform("translate(10,20) scale(2)"), [1, 1])[0], 12);
  near(apply(parseTransform("rotate(90 10 10)"), [20, 10])[1], 20, 1e-9);
});
test("path data: all commands parse; output re-parses identically", () => {
  const ps = parsePathData("M10 10 h20 v20 H10 Z m40 0 c0 10 10 10 10 0 s10 -10 10 0 q5 5 10 0 t10 0 a5 5 0 0 1 10 0 l5 5 5 5");
  assert.equal(ps.length, 2); assert.equal(ps[0].closed, true); assert.equal(ps[1].closed, false);
  const again = parsePathData(pathData(ps));
  const a = boxOfPaths(ps)!, b = boxOfPaths(again)!;
  near(a.x, b.x, 1e-3); near(a.w, b.w, 1e-3); near(a.h, b.h, 1e-3);
  assert.throws(() => parsePathData("10 10 L 20 20"), /must start with a command/);
});
test("shapes: exact bounds, area and length", () => {
  const e = ellipsePaths(10, 10);
  const b = boxOfPaths(e)!; near(b.x, -10, 1e-9); near(b.w, 20, 1e-9); near(b.h, 20, 1e-9);
  near(area(e), Math.PI * 100, 0.1); near(polyLength(flatten(e, 0.0005)[0]), 2 * Math.PI * 10, 0.01);
  near(area(rectPaths(30, 20, 5)), 600 - (4 - Math.PI) * 25, 0.05);
});
test("SVG import keeps real size, units and transforms", () => {
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 1000 500">
    <g transform="translate(100,100)"><rect x="0" y="0" width="200" height="100" stroke="#ff0000" fill="none"/></g>
    <circle cx="500" cy="250" r="50" style="stroke:none;fill:#000"/>
    <text x="0" y="0">Hi</text><image href="https://x/y.png" width="10" height="10"/></svg>`;
  const r = importSvg(svg);
  near(r.width, 100); near(r.height, 50);
  assert.equal(r.objects.length, 2);
  const rect = boxOfPaths((r.objects[0] as { paths: SubPath[] }).paths)!;
  near(rect.x, 10, 1e-9); near(rect.y, 10, 1e-9); near(rect.w, 20, 1e-9); near(rect.h, 10, 1e-9);
  assert.equal(r.layers.length, 2);
  assert.equal(r.layers.find((l) => l.color === "#ff0000")!.op, "cut");
  assert.equal(r.layers.find((l) => l.color === "#000000")!.op, "raster");
  assert.ok(r.warnings.some((w) => /text/.test(w))); assert.ok(r.warnings.some((w) => /linked/.test(w)));
});
test("SVG import: px at 96/in, errors on non-SVG", () => {
  const r = importSvg(`<svg width="96" height="96"><path d="M0 0 L96 0" stroke="black"/></svg>`);
  near(r.width, 25.4); near(boxOfPaths((r.objects[0] as { paths: SubPath[] }).paths)!.w, 25.4, 1e-9);
  assert.throws(() => importSvg("<html><body/></html>"), /no <svg>/);
  assert.throws(() => importSvg("<svg><path d='M0 0'"), /Not a valid SVG/);
});
test("SVG export → import round trip preserves geometry in mm", () => {
  const d = docWith({ paths: sq(10, 20, 30) }, { paths: transformPaths(ellipsePaths(15, 5), [1, 0, 0, 1, 100, 60]) });
  const back = importSvg(exportSvg(d));
  near(back.width, 300); near(back.height, 200);
  const b0 = boxOfPaths((back.objects[0] as { paths: SubPath[] }).paths)!, b1 = boxOfPaths((back.objects[1] as { paths: SubPath[] }).paths)!;
  near(b0.x, 10, 1e-3); near(b0.w, 30, 1e-3); near(b1.x, 85, 1e-3); near(b1.h, 10, 1e-3);
});
test("DXF import: units, bulges, circles, y flipped; export → import round trip", () => {
  const dxf = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "1", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "8", "A", "10", "0", "20", "0", "30", "0", "11", "1", "21", "0", "31", "0",
    "0", "CIRCLE", "8", "B", "10", "2", "20", "1", "30", "0", "40", "0.5",
    "0", "LWPOLYLINE", "8", "A", "90", "2", "70", "1", "10", "0", "20", "1", "42", "1", "10", "1", "20", "1", "42", "1",
    "0", "ENDSEC", "0", "EOF"].join("\n");
  const r = importDxf(dxf);
  assert.equal(r.objects.length, 3); assert.equal(r.layers.length, 2);
  near(r.width, 63.5, 1e-6); // 0 → 2.5 in
  const circle = boxOfPaths((r.objects[1] as { paths: SubPath[] }).paths)!; near(circle.w, 25.4, 1e-6);
  const pl = (r.objects[2] as { paths: SubPath[] }).paths[0]; assert.equal(pl.closed, true);
  near(area([pl]), Math.PI * 12.7 * 12.7, 0.5); // two half-circle bulges = a 1 in circle
  const d = docWith({ paths: sq(10, 20, 30) });
  const back = importDxf(exportDxf(d));
  const b = boxOfPaths((back.objects[0] as { paths: SubPath[] }).paths)!; near(b.w, 30, 1e-3); near(b.h, 30, 1e-3);
  assert.throws(() => importDxf("hello"), /DXF/);
});
test("booleans: union, subtract, intersect, exclude give exact areas", () => {
  const a = sq(0, 0, 10), b = sq(5, 5, 10);
  near(area(booleanOp(a, b, "union")), 175, 1e-6); near(area(booleanOp(a, b, "subtract")), 75, 1e-6);
  near(area(booleanOp(a, b, "intersect")), 25, 1e-6); near(area(booleanOp(a, b, "exclude")), 150, 1e-6);
  assert.throws(() => booleanOp([{ start: [0, 0], segs: [{ k: "L", p: [1, 1] }], closed: false }], b, "union"), /closed/);
});
test("offset and kerf compensation", () => {
  near(area(offsetPaths(sq(0, 0, 10), 1)), 100 + 40 + Math.PI, 0.01);
  near(area(offsetPaths(sq(0, 0, 10), -1)), 64, 1e-6);
  const outer = flatten(sq(0, 0, 20))[0].pts, hole = flatten(sq(5, 5, 10))[0].pts;
  const k = kerfCompensate([outer, hole], 0.2);
  const areas = k.map((p) => Math.abs(polyArea(p))).sort((x, y) => y - x);
  near(areas[0], 20.2 * 20.2, 0.01); near(areas[1], 9.8 * 9.8, 1e-6); // outline grows, hole shrinks
});
test("join and split paths", () => {
  const j = joinPaths([{ start: [0, 0], segs: [{ k: "L", p: [10, 0] }], closed: false }, { start: [10, 10], segs: [{ k: "L", p: [10, 0] }], closed: false }, { start: [10, 10], segs: [{ k: "L", p: [0, 0] }], closed: false }]);
  assert.equal(j.length, 1); assert.equal(j[0].closed, true);
  const s = splitAt(sq(0, 0, 10)[0], 2); assert.equal(s.length, 1); assert.equal(s[0].closed, false); assert.deepEqual(s[0].start, [10, 10]);
  const o = splitAt({ start: [0, 0], segs: [{ k: "L", p: [1, 0] }, { k: "L", p: [2, 0] }], closed: false }, 1); assert.equal(o.length, 2);
});
test("validation: open contours, duplicates, self-intersection", () => {
  assert.equal(openContours("a", [{ start: [0, 0], segs: [{ k: "L", p: [5, 5] }], closed: false }]).length, 1);
  assert.equal(openContours("a", sq(0, 0, 5)).length, 0);
  const dup = duplicateSegments([{ id: "a", paths: sq(0, 0, 10) }, { id: "b", paths: sq(10, 0, 10) }]);
  assert.equal(dup.length, 1); assert.deepEqual(dup[0].ids.sort(), ["a", "b"]);
  assert.equal(duplicateSegments([{ id: "a", paths: sq(0, 0, 10) }, { id: "b", paths: sq(20, 0, 10) }]).length, 0);
  const bow: SubPath[] = [{ start: [0, 0], segs: [{ k: "L", p: [10, 10] }, { k: "L", p: [10, 0] }, { k: "L", p: [0, 10] }, { k: "L", p: [0, 0] }], closed: true }];
  assert.equal(selfIntersections("x", bow).length, 1); assert.equal(selfIntersections("y", sq(0, 0, 5)).length, 0);
});
test("common-line cutting removes the shared edge once", () => {
  const list = [{ obj: "a", pts: flatten(sq(0, 0, 10))[0].pts, closed: true }, { obj: "b", pts: flatten(sq(10, 0, 10))[0].pts, closed: true }];
  const before = list.reduce((s, c) => s + polyLength(c), 0), after = removeSharedEdges(list).reduce((s, c) => s + polyLength(c), 0);
  near(before, 80); near(after, 70);
});
test("arrays and nesting stay on the sheet without overlaps", () => {
  const d = docWith({ paths: sq(3, 4, 10) });
  const arr = arrayPlacements(d, 2, 3, 2, 1);
  assert.equal(arr.length, 6);
  const b = placementBox(d, arr[5])!; near(b.x, 24); near(b.y, 11);
  const n = nestRects(d, 8, { w: 35, h: 25 }, 1, 1);
  assert.equal(n.placements.length, 6); assert.equal(n.unplaced, 2);
  const boxes = n.placements.map((p) => placementBox(d, p)!);
  for (const x of boxes) assert.ok(x.x >= 1 - 1e-6 && x.y >= 1 - 1e-6 && x.x + x.w <= 34 + 1e-6 && x.y + x.h <= 24 + 1e-6, "inside sheet margin");
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; assert.ok(!(a.x < c.x + c.w - 1e-6 && c.x < a.x + a.w - 1e-6 && a.y < c.y + c.h - 1e-6 && c.y < a.y + a.h - 1e-6), "no overlap"); }
  // rotated parts fit a narrow sheet
  const tall = docWith({ paths: transformPaths(rectPaths(30, 10), I) });
  assert.equal(nestRects(tall, 1, { w: 12, h: 32 }, 0, 0).placements.length, 1);
  near(partsArea(d, arr), 600, 1e-6);
});
test("toolpath: raster first, holes before outlines, passes repeat", () => {
  const d = docWith({ paths: [...sq(0, 0, 40), ...sq(10, 10, 10)] }, { paths: sq(60, 0, 20), layer: "L-engrave" });
  const tp = buildToolpath(d, [{ id: "1", m: [...I] as Mat }], { ops: { cut: P({ passes: 2 }), raster: P({ speed: 300 }) }, kerf: 0, commonLine: false });
  assert.equal(tp.items[0].op, "raster");
  const cuts = tp.items.filter((x) => x.op === "cut") as { pts: [number, number][]; pass: number }[];
  assert.equal(cuts.length, 4);
  const firstArea = Math.abs(polyArea(cuts[0].pts)); near(firstArea, 100, 1e-6); // hole first
  assert.deepEqual(cuts.map((c) => c.pass), [1, 1, 2, 2]);
  const e1 = estimate(tp, { cut: P({ passes: 2 }), raster: P({ speed: 300 }) }, CAPS), e2 = estimate(tp, { cut: P({ speed: 40, passes: 2 }), raster: P({ speed: 300 }) }, CAPS);
  assert.ok(e1.seconds > 0 && e2.seconds < e1.seconds); assert.equal(e1.label, "estimate");
  near(e1.cutLength, 2 * (160 + 40), 1e-6);
});
test("parameters are checked against machine capabilities", () => {
  assert.equal(checkParams("cut", P(), CAPS).length, 0);
  const errs = checkParams("cut", P({ power: 120, speed: 5000, passes: 0, focus: 20, freq: 10 }), CAPS);
  assert.equal(errs.length, 5);
  assert.equal(checkParams("raster", P({ dpi: 777 }), CAPS).length, 1);
  assert.equal(checkParams("cut", P({ freq: 5000 }), { ...CAPS, freq: null }).length, 1);
});
test("job validation: bed/sheet overflow, prohibited material, unverified settings", () => {
  const d = docWith({ paths: sq(0, 0, 50) });
  const base = { doc: d, caps: CAPS, ops: { cut: P() }, sheet: { w: 100, h: 100 }, margin: 0, materialProhibited: false, profileStatus: { cut: "approved" as const }, hardware: false };
  assert.equal(validateJob({ ...base, placements: [{ id: "a", m: [1, 0, 0, 1, 10, 10] }] }).filter((i) => i.level === "error").length, 0);
  assert.ok(validateJob({ ...base, placements: [{ id: "a", m: [1, 0, 0, 1, 70, 10] }] }).some((i) => i.code === "sheet"));
  assert.ok(validateJob({ ...base, placements: [{ id: "a", m: [1, 0, 0, 1, 580, 10] }], sheet: null }).some((i) => i.code === "bed"));
  assert.ok(validateJob({ ...base, placements: [{ id: "a", m: [...I] as Mat }], materialProhibited: true }).some((i) => i.code === "prohibited" && i.level === "error"));
  const unv = validateJob({ ...base, placements: [{ id: "a", m: [...I] as Mat }], profileStatus: { cut: "untested" } });
  assert.equal(unv.find((i) => i.code === "unverified")!.level, "warning");
  assert.equal(validateJob({ ...base, placements: [{ id: "a", m: [...I] as Mat }], profileStatus: {}, hardware: true }).find((i) => i.code === "unverified")!.level, "error");
  assert.ok(validateJob({ ...base, placements: [] }).some((i) => i.code === "no_copies"));
});
test("project file: versioned, validated", () => {
  const d = docWith({ paths: sq(0, 0, 5) });
  const p = readProject(writeProject({ name: "Test", doc: d }));
  assert.equal(p.name, "Test"); assert.equal(p.doc.objects.length, 1);
  assert.throws(() => readProject(JSON.stringify({ format: "trotan-project", formatVersion: 99, doc: d })), /newer TROTAN/);
  assert.throws(() => readProject("{}"), /Not a TROTAN/);
  const bad = structuredClone(d); bad.objects[0].layer = "nope";
  assert.throws(() => checkDoc(bad), /missing layer/);
});
test("coordinate accuracy: transforms stay exact to 1e-9 mm over 1000 operations", () => {
  let m: Mat = [...I] as Mat;
  for (let i = 0; i < 1000; i++) m = mul(rotate(0.36), m);
  const p = apply(m, [100, 0]); // 360° total
  near(p[0], 100, 1e-9); near(p[1], 0, 1e-9);
});

// ---- CorelDRAW import (reader: packages/sk-formats/src/cdr.ts, verified against libcdr there)
import { readCdr } from "../../../packages/sk-formats/src/cdr";
import { cdrToImport } from "../../src/trotan/geom/cdr";
import { readFileSync } from "node:fs";

test("CorelDRAW X5 → TROTAN: real size, one layer per outline colour, positions in mm", async () => {
  const bytes = new Uint8Array(readFileSync(new URL("../../packages/sk-formats/tests/fixtures/corel-x5-stored.cdr", import.meta.url) /* resolved from the bundled tests/.trotan-geom.mjs */));
  const doc = await readCdr(bytes);
  const r = cdrToImport(doc);
  near(r.width, 210, 1e-6, "A4 width"); near(r.height, 297, 1e-6, "A4 height");
  assert.equal(r.objects.length, 5);
  assert.equal(r.layers.length, 1, "all five have a black outline → one Line layer");
  assert.equal(r.layers[0].color, "#000000"); assert.equal(r.layers[0].op, "cut");
  const b = boxOfPaths((r.objects[0] as { paths: SubPath[] }).paths)!;
  near(b.x, 58.5649 * 25.4 / 72, 1e-3, "x"); near(b.y, 100.1565 * 25.4 / 72, 1e-3, "y");
  assert.match(r.warnings[0], /CorelDRAW X5/);
  assert.ok(!r.warnings.some((w) => w.startsWith("Skipped")), "nothing skipped in this file");
});
