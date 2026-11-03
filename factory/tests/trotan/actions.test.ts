// Editor operations: exact numeric geometry, transforms keep shapes, booleans, nodes, groups, layers.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../../src/trotan/editor/actions";
import { newDoc, objBox, worldPaths, flatten, polyArea, type Doc, type Obj } from "../../src/trotan/geom/core";
import { sameParams } from "../../src/trotan/prod/sameParams";
import { evalNum } from "../../src/trotan/evalNum";
import { simplify, snapBox, snapPoint, targets } from "../../src/trotan/editor/snap";

const rect = (id: string, x: number, y: number, w: number, h: number): Obj => ({ id, layer: "L-cut", kind: "rect", w, h, r: 0, m: [1, 0, 0, 1, x, y] });
const doc = (...objs: Obj[]): Doc => ({ ...newDoc(), objects: objs });
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
const area = (o: Obj) => flatten(worldPaths(o), 0.001).reduce((s, p) => s + Math.abs(polyArea(p.pts)), 0);

test("setSelBox: exact size and position, ratio kept on request", () => {
  let d = doc(rect("a", 3, 4, 20, 10));
  d = A.setSelBox(d, ["a"], { w: 50 }, true);
  let b = objBox(d.objects[0])!; near(b.w, 50); near(b.h, 25); near(b.x, 3); near(b.y, 4);
  d = A.setSelBox(d, ["a"], { x: 10.005, y: 0.1, h: 30 }, false);
  b = objBox(d.objects[0])!; near(b.x, 10.005); near(b.y, 0.1); near(b.h, 30); near(b.w, 50);
  assert.throws(() => A.setSelBox(d, ["a"], { w: 0 }, false), /above 0/);
});
test("rotate 90° twice and mirror twice return to the original box", () => {
  const d0 = doc(rect("a", 10, 20, 30, 12));
  let d = A.rotateSel(A.rotateSel(d0, ["a"], 90), ["a"], -90);
  const b0 = objBox(d0.objects[0])!, b1 = objBox(d.objects[0])!;
  for (const k of ["x", "y", "w", "h"] as const) near(b1[k], b0[k], 1e-9);
  d = A.mirrorSel(A.mirrorSel(d0, ["a"], "h"), ["a"], "h");
  near(objBox(d.objects[0])!.x, 10);
});
test("align, distribute", () => {
  let d = doc(rect("a", 0, 0, 10, 10), rect("b", 50, 5, 10, 10), rect("c", 13, 40, 10, 10));
  d = A.alignSel(d, ["a", "b", "c"], "top"); assert.deepEqual(d.objects.map((o) => objBox(o)!.y), [0, 0, 0]);
  d = A.distributeSel(d, ["a", "b", "c"], "h"); near(objBox(d.objects[2])!.x, 25);
});
test("group/ungroup keep world positions; duplicate gets new ids", () => {
  let d = doc(rect("a", 5, 5, 10, 10), rect("b", 30, 5, 10, 10));
  const g = A.groupSel(d, ["a", "b"]); d = A.moveSel(g.doc, [g.id!], 7, 3);
  const u = A.ungroupSel(d, [g.id!]);
  assert.deepEqual(u.doc.objects.map((o) => [objBox(o)!.x, objBox(o)!.y]), [[12, 8], [37, 8]]);
  const dup = A.duplicateSel(u.doc, ["a"]); assert.equal(dup.doc.objects.length, 3); assert.notEqual(dup.ids[0], "a");
});
test("booleans: union and subtract give exact areas", () => {
  const d = doc(rect("a", 0, 0, 20, 10), rect("b", 10, 0, 20, 10));
  const u = A.booleanSel(d, ["a", "b"], "union"); near(area(u.doc.objects[0]), 300, 1e-3);
  const s = A.booleanSel(d, ["a", "b"], "subtract"); near(area(s.doc.objects[0]), 100, 1e-3);
  assert.throws(() => A.booleanSel(doc(rect("a", 0, 0, 1, 1)), ["a"], "union"), /two/);
});
test("nodes: inserting a node keeps the curve; deleting and moving nodes", () => {
  let d = A.convertToPaths(doc({ id: "e", layer: "L-cut", kind: "ellipse", rx: 10, ry: 10, m: [1, 0, 0, 1, 50, 50] }), ["e"]);
  const before = area(d.objects[0]);
  d = A.insertNode(d, "e", 0, 0, 0.37); near(area(d.objects[0]), before, 1e-4);
  assert.equal(A.nodesOf(d.objects[0] as never).length, 5);
  d = A.moveNode(d, { obj: "e", sp: 0, node: 0 }, "p", [5, 0]); near(objBox(d.objects[0])!.x + objBox(d.objects[0])!.w, 65, 1e-6);
  d = A.deleteNode(d, { obj: "e", sp: 0, node: 1 }); assert.equal(A.nodesOf(d.objects[0] as never).length, 4);
});
test("layers: cannot remove a used or last layer; import merges same colour+operation", () => {
  const d = doc(rect("a", 0, 0, 1, 1));
  assert.throws(() => A.removeLayer(d, "L-cut"), /Move or delete/);
  const r = A.placeImport(d, [{ ...rect("x", 0, 0, 10, 10), layer: "imp" }], [{ id: "imp", name: "red", color: "#ff3b30", visible: true, locked: false, op: "cut" }]);
  assert.equal(r.doc.layers.length, 3); assert.equal(r.doc.objects[1].layer, "L-cut");
  near(objBox(r.doc.objects[1])!.x, (600 - 10) / 2);
});
test("approved-settings comparison ignores raster-only fields for vector ops", () => {
  const p = { power: 60, speed: 20, passes: 1, focus: 0, freq: null, dpi: 500, air: true };
  assert.ok(sameParams("cut", p, { ...p, dpi: 254 })); assert.ok(!sameParams("raster", p, { ...p, dpi: 254 })); assert.ok(!sameParams("cut", p, { ...p, power: 61 }));
});
test("numeric fields accept arithmetic, reject anything else", () => {
  assert.equal(evalNum("25.4*2"), 50.8); assert.equal(evalNum("(10+5)/3"), 5); assert.equal(evalNum("-3"), -3);
  assert.equal(evalNum("alert(1)"), null); assert.equal(evalNum("1/0"), null); assert.equal(evalNum(""), null);
});
test("snapping and stroke simplification", () => {
  const d = doc(rect("a", 100, 100, 50, 20));
  const t = targets(d, new Set(), { grid: 10, toGrid: true, toObjects: true, toGuides: true });
  const r = snapBox({ x: 151.5, y: 0, w: 10, h: 10 }, t, 2, { grid: 10, toGrid: false, toObjects: true, toGuides: true }); near(r.dx, -1.5);
  const p = snapPoint([99.2, 30.6], t, 1, { grid: 10, toGrid: true, toObjects: true, toGuides: true }); assert.deepEqual(p.p, [100, 30]);
  assert.equal(simplify([[0, 0], [1, 0.001], [2, 0], [3, 0]], 0.01).length, 2);
});
