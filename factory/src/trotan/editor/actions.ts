// Pure document operations used by the editor (and unit-tested): every function returns a new Doc.
import { I, about, bake, boxOfPaths, clonePaths, findObj, inv, localPaths, mul, objBox, objsBox, scale, toPathObj, transformPaths, uid, worldPaths, type Box, type Doc, type Layer, type Mat, type Obj, type PathObj, type SubPath, type Vec } from "../geom/core";
import { booleanOp, joinPaths, offsetPaths, splitAt, unionAll, type BoolOp } from "../geom/ops";

const mapTop = (d: Doc, ids: Set<string>, fn: (o: Obj) => Obj): Doc => ({ ...d, objects: d.objects.map((o) => (ids.has(o.id) ? fn(o) : o)) });
export const selected = (d: Doc, ids: string[]) => d.objects.filter((o) => ids.includes(o.id));
export const selBox = (d: Doc, ids: string[]): Box | null => objsBox(selected(d, ids));

/** Pre-multiply a world-space transform onto the selected objects. */
export function transformSel(d: Doc, ids: string[], m: Mat): Doc { const s = new Set(ids); return mapTop(d, s, (o) => ({ ...o, m: mul(m, o.m) })); }
export const moveSel = (d: Doc, ids: string[], dx: number, dy: number) => transformSel(d, ids, [1, 0, 0, 1, dx, dy]);
export function scaleSel(d: Doc, ids: string[], sx: number, sy: number, anchor: Vec) { return transformSel(d, ids, about(scale(sx, sy), anchor)); }
export function rotateSel(d: Doc, ids: string[], deg: number, center?: Vec) {
  const b = selBox(d, ids); if (!b) return d;
  const c = center ?? [b.x + b.w / 2, b.y + b.h / 2];
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  return transformSel(d, ids, about([cs, sn, -sn, cs, 0, 0], c));
}
export function mirrorSel(d: Doc, ids: string[], axis: "h" | "v") {
  const b = selBox(d, ids); if (!b) return d;
  return transformSel(d, ids, about(axis === "h" ? scale(-1, 1) : scale(1, -1), [b.x + b.w / 2, b.y + b.h / 2]));
}
/** Numeric geometry: set the selection's bounding box (mm). Keeps the aspect ratio if asked. */
export function setSelBox(d: Doc, ids: string[], next: Partial<Box>, keepRatio: boolean): Doc {
  const b = selBox(d, ids); if (!b) return d;
  let w = next.w ?? b.w, h = next.h ?? b.h;
  if (keepRatio && b.w > 0 && b.h > 0) { if (next.w !== undefined && next.h === undefined) h = (w * b.h) / b.w; else if (next.h !== undefined && next.w === undefined) w = (h * b.w) / b.h; }
  const sx = b.w > 1e-9 ? w / b.w : 1, sy = b.h > 1e-9 ? h / b.h : 1;
  const x = next.x ?? b.x, y = next.y ?? b.y;
  if (!(w > 0) && b.w > 0) throw new Error("Width must be above 0");
  if (!(h > 0) && b.h > 0) throw new Error("Height must be above 0");
  return transformSel(d, ids, mul([1, 0, 0, 1, x, y], mul(scale(sx, sy), [1, 0, 0, 1, -b.x, -b.y])));
}
export type Align = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
/** Align to the selection's bounds, or to the page when one object is selected. */
export function alignSel(d: Doc, ids: string[], how: Align): Doc {
  const objs = selected(d, ids); if (!objs.length) return d;
  const ref: Box = objs.length === 1 ? { x: 0, y: 0, w: d.width, h: d.height } : selBox(d, ids)!;
  return { ...d, objects: d.objects.map((o) => {
    if (!ids.includes(o.id)) return o;
    const b = objBox(o); if (!b) return o;
    const dx = how === "left" ? ref.x - b.x : how === "right" ? ref.x + ref.w - b.x - b.w : how === "hcenter" ? ref.x + ref.w / 2 - b.x - b.w / 2 : 0;
    const dy = how === "top" ? ref.y - b.y : how === "bottom" ? ref.y + ref.h - b.y - b.h : how === "vcenter" ? ref.y + ref.h / 2 - b.y - b.h / 2 : 0;
    return { ...o, m: mul([1, 0, 0, 1, dx, dy], o.m) };
  }) };
}
/** Equal gaps between neighbours (needs 3+). */
export function distributeSel(d: Doc, ids: string[], axis: "h" | "v"): Doc {
  const items = selected(d, ids).map((o) => ({ o, b: objBox(o)! })).filter((x) => x.b);
  if (items.length < 3) return d;
  const k = axis === "h" ? "x" : "y", s = axis === "h" ? "w" : "h";
  items.sort((a, b) => a.b[k] - b.b[k]);
  const first = items[0].b, last = items[items.length - 1].b;
  const total = last[k] + last[s] - first[k], used = items.reduce((t, x) => t + x.b[s], 0);
  const gap = (total - used) / (items.length - 1);
  let pos = first[k] + first[s] + gap;
  const moves = new Map<string, number>();
  for (const it of items.slice(1, -1)) { moves.set(it.o.id, pos - it.b[k]); pos += it.b[s] + gap; }
  return { ...d, objects: d.objects.map((o) => (moves.has(o.id) ? { ...o, m: mul(axis === "h" ? [1, 0, 0, 1, moves.get(o.id)!, 0] : [1, 0, 0, 1, 0, moves.get(o.id)!], o.m) } : o)) };
}
export function groupSel(d: Doc, ids: string[]): { doc: Doc; id: string | null } {
  const objs = selected(d, ids); if (objs.length < 2) return { doc: d, id: null };
  const g: Obj = { id: uid("g"), layer: objs[0].layer, kind: "group", m: [...I] as Mat, children: objs };
  const firstIdx = d.objects.findIndex((o) => ids.includes(o.id));
  const rest = d.objects.filter((o) => !ids.includes(o.id));
  rest.splice(Math.min(firstIdx, rest.length), 0, g);
  return { doc: { ...d, objects: rest }, id: g.id };
}
export function ungroupSel(d: Doc, ids: string[]): { doc: Doc; ids: string[] } {
  const out: Obj[] = []; const newIds: string[] = [];
  for (const o of d.objects) {
    if (ids.includes(o.id) && o.kind === "group") for (const c of o.children) { out.push({ ...c, m: mul(o.m, c.m) }); newIds.push(c.id); }
    else out.push(o);
  }
  return { doc: { ...d, objects: out }, ids: newIds.length ? newIds : ids };
}
export function arrange(d: Doc, ids: string[], how: "front" | "back" | "forward" | "backward"): Doc {
  const objs = [...d.objects]; const s = new Set(ids);
  if (how === "front") return { ...d, objects: [...objs.filter((o) => !s.has(o.id)), ...objs.filter((o) => s.has(o.id))] };
  if (how === "back") return { ...d, objects: [...objs.filter((o) => s.has(o.id)), ...objs.filter((o) => !s.has(o.id))] };
  if (how === "forward") for (let i = objs.length - 2; i >= 0; i--) { if (s.has(objs[i].id) && !s.has(objs[i + 1].id)) [objs[i], objs[i + 1]] = [objs[i + 1], objs[i]]; }
  else for (let i = 1; i < objs.length; i++) { if (s.has(objs[i].id) && !s.has(objs[i - 1].id)) [objs[i], objs[i - 1]] = [objs[i - 1], objs[i]]; }
  return { ...d, objects: objs };
}
const reid = (o: Obj): Obj => (o.kind === "group" ? { ...o, id: uid(), children: o.children.map(reid) } : { ...o, id: uid() });
export function duplicateSel(d: Doc, ids: string[], dx = 5, dy = 5): { doc: Doc; ids: string[] } {
  const copies = selected(d, ids).map((o) => ({ ...reid(structuredClone(o)), m: mul([1, 0, 0, 1, dx, dy], o.m) }));
  return { doc: { ...d, objects: [...d.objects, ...copies] }, ids: copies.map((c) => c.id) };
}
export function pasteObjs(d: Doc, objs: Obj[], dx = 5, dy = 5): { doc: Doc; ids: string[] } {
  const layerIds = new Set(d.layers.map((l) => l.id));
  const copies = objs.map((o) => ({ ...reid(structuredClone(o)), layer: layerIds.has(o.layer) ? o.layer : d.layers[0].id, m: mul([1, 0, 0, 1, dx, dy], o.m) }));
  return { doc: { ...d, objects: [...d.objects, ...copies] }, ids: copies.map((c) => c.id) };
}
export const deleteSel = (d: Doc, ids: string[]): Doc => ({ ...d, objects: d.objects.filter((o) => !ids.includes(o.id)) });
/** Shapes and text become editable paths (geometry unchanged). */
export function convertToPaths(d: Doc, ids: string[]): Doc {
  return mapTop(d, new Set(ids), (o) => (o.kind === "group" ? { ...o, children: o.children.map((c) => toPathObj(c) ?? c) } : toPathObj(o) ?? o));
}
/** Booleans on closed shapes. Union/intersect/exclude use all; subtract = bottom-most minus the rest. */
export function booleanSel(d: Doc, ids: string[], op: BoolOp): { doc: Doc; id: string } {
  const objs = d.objects.filter((o) => ids.includes(o.id) && o.kind !== "image");
  if (objs.length < 2) throw new Error("Select at least two vector shapes");
  const shapes = objs.map((o) => worldPaths(o).filter((s) => s.closed));
  if (shapes.some((s) => !s.length)) throw new Error("Booleans need closed shapes — close open paths first");
  let res: SubPath[];
  if (op === "union") res = unionAll(shapes);
  else { res = shapes[0]; for (const s of shapes.slice(1)) res = booleanOp(res, s, op); }
  const out: PathObj = { id: uid(), layer: objs[0].layer, kind: "path", m: [...I] as Mat, paths: res };
  const idx = d.objects.findIndex((o) => o.id === objs[0].id);
  const rest = d.objects.filter((o) => !ids.includes(o.id) || o.kind === "image");
  rest.splice(Math.min(idx, rest.length), 0, out);
  return { doc: { ...d, objects: rest }, id: out.id };
}
export function offsetSel(d: Doc, ids: string[], dist: number): { doc: Doc; ids: string[] } {
  const made: Obj[] = [];
  for (const o of selected(d, ids)) { if (o.kind === "image") continue; const r = offsetPaths(worldPaths(o), dist); if (r.length) made.push({ id: uid(), layer: o.layer, kind: "path", m: [...I] as Mat, paths: r }); }
  if (!made.length) throw new Error("Nothing to offset");
  return { doc: { ...d, objects: [...d.objects, ...made] }, ids: made.map((m) => m.id) };
}
/** Joins the selected paths' open ends (within tol) into one object. */
export function joinSel(d: Doc, ids: string[], tol = 0.05): { doc: Doc; id: string } {
  const objs = selected(d, ids).filter((o) => o.kind !== "image" && o.kind !== "group");
  if (!objs.length) throw new Error("Select paths to join");
  const all = objs.flatMap((o) => worldPaths(o));
  const out: PathObj = { id: uid(), layer: objs[0].layer, kind: "path", m: [...I] as Mat, paths: joinPaths(all, tol) };
  return { doc: { ...d, objects: [...d.objects.filter((o) => !objs.some((x) => x.id === o.id)), out] }, id: out.id };
}
/** Break a path object into one object per sub-path (e.g. after import). */
export function breakApart(d: Doc, ids: string[]): { doc: Doc; ids: string[] } {
  const out: Obj[] = []; const nids: string[] = [];
  for (const o of d.objects) {
    if (ids.includes(o.id) && (o.kind === "path" || o.kind === "text") && localPaths(o).length > 1) {
      for (const sp of clonePaths(localPaths(o))) { const n: PathObj = { id: uid(), layer: o.layer, kind: "path", m: o.m, paths: [sp] }; out.push(n); nids.push(n.id); }
    } else out.push(o);
  }
  return { doc: { ...d, objects: out }, ids: nids };
}

/* ----------------------------------------------------------- node editing -- */
export interface NodeRef { obj: string; sp: number; node: number } // node 0 = start, k = segs[k-1].p
/** Node positions (world) of a path object; ignores the closing duplicate of a closed path. */
export function nodesOf(o: PathObj): { sp: number; node: number; p: Vec; in?: Vec; out?: Vec }[] {
  const ps = transformPaths(o.paths, o.m); const out: { sp: number; node: number; p: Vec; in?: Vec; out?: Vec }[] = [];
  ps.forEach((s, si) => {
    const pts: Vec[] = [s.start, ...s.segs.map((g) => g.p)];
    const n = s.closed && s.segs.length && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9 ? pts.length - 1 : pts.length;
    for (let k = 0; k < n; k++) {
      const inSeg = k > 0 ? s.segs[k - 1] : s.closed ? s.segs[s.segs.length - 1] : undefined;
      const outSeg = s.segs[k];
      out.push({ sp: si, node: k, p: pts[k], in: inSeg?.k === "C" ? inSeg.c2 : undefined, out: outSeg?.k === "C" ? outSeg.c1 : undefined });
    }
  });
  return out;
}
/** Move a node (with its handles) or one handle by a world delta. Path matrix is baked first. */
export function moveNode(d: Doc, ref: NodeRef, part: "p" | "in" | "out", delta: Vec): Doc {
  const o0 = findObj(d.objects, ref.obj); if (!o0 || o0.kind !== "path") return d;
  const o = bake(o0); const paths = clonePaths(o.paths); const s = paths[ref.sp]; if (!s) return d;
  const add = (v: Vec): Vec => [v[0] + delta[0], v[1] + delta[1]];
  const last = s.segs.length - 1;
  const inSeg = ref.node > 0 ? s.segs[ref.node - 1] : s.closed ? s.segs[last] : undefined;
  const outSeg = s.segs[ref.node];
  if (part === "p") {
    if (ref.node === 0) { s.start = add(s.start); if (s.closed && s.segs[last]) s.segs[last].p = [...s.start] as Vec; } else s.segs[ref.node - 1].p = add(s.segs[ref.node - 1].p);
    if (inSeg?.k === "C") inSeg.c2 = add(inSeg.c2!);
    if (outSeg?.k === "C") outSeg.c1 = add(outSeg.c1!);
  } else if (part === "in" && inSeg?.k === "C") inSeg.c2 = add(inSeg.c2!);
  else if (part === "out" && outSeg?.k === "C") outSeg.c1 = add(outSeg.c1!);
  return mapTop(d, new Set([o.id]), () => ({ ...o, paths }));
}
export function deleteNode(d: Doc, ref: NodeRef): Doc {
  const o0 = findObj(d.objects, ref.obj); if (!o0 || o0.kind !== "path") return d;
  const o = bake(o0); const paths = clonePaths(o.paths); const s = paths[ref.sp];
  const count = s.segs.length + (s.closed ? 0 : 1);
  if (count <= 2) { paths.splice(ref.sp, 1); return paths.length ? mapTop(d, new Set([o.id]), () => ({ ...o, paths })) : deleteSel(d, [o.id]); }
  if (ref.node === 0) { if (s.closed) { s.start = [...s.segs[0].p] as Vec; s.segs = s.segs.slice(1); s.segs[s.segs.length - 1] = { ...s.segs[s.segs.length - 1], p: [...s.start] as Vec }; } else { s.start = s.segs[0].p; s.segs = s.segs.slice(1); } }
  else { const a = s.segs[ref.node - 1], b = s.segs[ref.node]; s.segs.splice(ref.node - 1, b ? 2 : 1, ...(b ? [{ k: b.k, p: b.p, c1: a.k === "C" ? a.c1 : b.c1, c2: b.c2 } as typeof b] : [])); }
  return mapTop(d, new Set([o.id]), () => ({ ...o, paths }));
}
/** Insert a node in segment k (1-based end node) at parameter t (de Casteljau split keeps the curve identical). */
export function insertNode(d: Doc, obj: string, sp: number, seg: number, t = 0.5): Doc {
  const o0 = findObj(d.objects, obj); if (!o0 || o0.kind !== "path") return d;
  const o = bake(o0); const paths = clonePaths(o.paths); const s = paths[sp]; const g = s.segs[seg]; if (!g) return d;
  const p0 = seg === 0 ? s.start : s.segs[seg - 1].p;
  const L = (a: Vec, b: Vec, u: number): Vec => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  if (g.k === "L") s.segs.splice(seg, 1, { k: "L", p: L(p0, g.p, t) }, { k: "L", p: g.p });
  else { const a = L(p0, g.c1!, t), b = L(g.c1!, g.c2!, t), c = L(g.c2!, g.p, t), ab = L(a, b, t), bc = L(b, c, t), m = L(ab, bc, t); s.segs.splice(seg, 1, { k: "C", c1: a, c2: ab, p: m }, { k: "C", c1: bc, c2: c, p: g.p }); }
  return mapTop(d, new Set([o.id]), () => ({ ...o, paths }));
}
/** Line ↔ curve for segment k. */
export function toggleSegment(d: Doc, obj: string, sp: number, seg: number): Doc {
  const o0 = findObj(d.objects, obj); if (!o0 || o0.kind !== "path") return d;
  const o = bake(o0); const paths = clonePaths(o.paths); const s = paths[sp]; const g = s.segs[seg]; if (!g) return d;
  const p0 = seg === 0 ? s.start : s.segs[seg - 1].p;
  s.segs[seg] = g.k === "C" ? { k: "L", p: g.p } : { k: "C", c1: [p0[0] + (g.p[0] - p0[0]) / 3, p0[1] + (g.p[1] - p0[1]) / 3], c2: [p0[0] + (2 * (g.p[0] - p0[0])) / 3, p0[1] + (2 * (g.p[1] - p0[1])) / 3], p: g.p };
  return mapTop(d, new Set([o.id]), () => ({ ...o, paths }));
}
export function splitNode(d: Doc, ref: NodeRef): Doc {
  const o0 = findObj(d.objects, ref.obj); if (!o0 || o0.kind !== "path") return d;
  const o = bake(o0); const paths = clonePaths(o.paths);
  paths.splice(ref.sp, 1, ...splitAt(paths[ref.sp], ref.node));
  return mapTop(d, new Set([o.id]), () => ({ ...o, paths }));
}
export function setClosed(d: Doc, obj: string, sp: number, closed: boolean): Doc {
  const o0 = findObj(d.objects, obj); if (!o0 || o0.kind !== "path") return d;
  const o = bake(o0); const paths = clonePaths(o.paths); const s = paths[sp];
  if (closed && !s.closed) { const e = s.segs[s.segs.length - 1].p; if (Math.hypot(e[0] - s.start[0], e[1] - s.start[1]) > 1e-9) s.segs.push({ k: "L", p: [...s.start] as Vec }); s.closed = true; }
  else if (!closed) s.closed = false;
  return mapTop(d, new Set([o.id]), () => ({ ...o, paths }));
}

/* ------------------------------------------------------------------ layers -- */
export function addLayer(d: Doc, l: Partial<Layer> = {}): { doc: Doc; id: string } {
  const COLORS = ["#ff3b30", "#2f6bff", "#21b573", "#ff9f0a", "#bf5af2", "#00c7be", "#ff375f", "#8e8e93"];
  const id = uid("L");
  const layer: Layer = { id, name: `Layer ${d.layers.length + 1}`, color: COLORS[d.layers.length % COLORS.length], visible: true, locked: false, op: "cut", ...l };
  return { doc: { ...d, layers: [...d.layers, layer] }, id };
}
export const updateLayer = (d: Doc, id: string, patch: Partial<Layer>): Doc => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
export function removeLayer(d: Doc, id: string): Doc {
  if (d.layers.length < 2) throw new Error("A design needs at least one layer");
  if (d.objects.some((o) => o.layer === id)) throw new Error("Move or delete the objects on this layer first");
  return { ...d, layers: d.layers.filter((l) => l.id !== id) };
}
export const moveToLayer = (d: Doc, ids: string[], layer: string): Doc => mapTop(d, new Set(ids), (o) => ({ ...o, layer }));
/** Import: add objects/layers and centre them on the page (or place at the origin when bigger). */
export function placeImport(d: Doc, objs: Obj[], layers: Layer[]): { doc: Doc; ids: string[] } {
  const known = new Map(d.layers.map((l) => [`${l.color}|${l.op}`, l.id]));
  const remap = new Map<string, string>(); const newLayers: Layer[] = [];
  for (const l of layers) { const k = `${l.color}|${l.op}`; const ex = known.get(k); if (ex) remap.set(l.id, ex); else { newLayers.push(l); known.set(k, l.id); } }
  const fixed = objs.map((o) => ({ ...o, layer: remap.get(o.layer) ?? o.layer }));
  const b = objsBox(fixed);
  const dx = b ? (b.w < d.width ? (d.width - b.w) / 2 - b.x : -b.x) : 0, dy = b ? (b.h < d.height ? (d.height - b.h) / 2 - b.y : -b.y) : 0;
  const moved = fixed.map((o) => ({ ...o, m: mul([1, 0, 0, 1, dx, dy], o.m) }));
  return { doc: { ...d, layers: [...d.layers, ...newLayers], objects: [...d.objects, ...moved] }, ids: moved.map((o) => o.id) };
}
export { boxOfPaths, inv };
