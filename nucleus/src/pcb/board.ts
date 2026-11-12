// PCB model: two copper layers, integer-nanometre geometry, nets taken from the schematic connectivity
// (the schematic is the single source of truth for which pins belong together).
import type { Project } from "../core/types";
import { connectivity, type Connectivity } from "../connectivity/connectivity";
import { device, simOnly } from "../library/devices";
import { footprint, mm, type Nm, type PadShape } from "./footprints";
import { fillZones, type Zone } from "./zones";

export type Layer = "F.Cu" | "B.Cu";
export const LAYERS: Layer[] = ["F.Cu", "B.Cu"];
export type P = [Nm, Nm];
export interface PcbPart { id: string; part: string; ref: string; footprint: string; at: P; rot: 0 | 90 | 180 | 270; side: "top" | "bottom"; locked?: boolean }
export interface Track { id: string; layer: Layer; a: P; b: P; width: Nm; net: string }
export interface Via { id: string; at: P; drill: Nm; dia: Nm; net: string }
export interface Rules { clearance: Nm; track: Nm; minTrack: Nm; viaDrill: Nm; viaDia: Nm; minDrill: Nm; minAnnular: Nm; edge: Nm; maskMargin: Nm; silkWidth: Nm }
export interface Board { schema: 1; outline: P[]; parts: PcbPart[]; tracks: Track[]; vias: Via[]; rules: Rules; zones?: Zone[] }

/** Defaults sit inside what common low-cost fabs accept for two-layer boards (0.2 mm track/space, 0.3 mm drill). */
export const DEFAULT_RULES: Rules = { clearance: mm(0.2), track: mm(0.25), minTrack: mm(0.15), viaDrill: mm(0.3), viaDia: mm(0.6), minDrill: mm(0.3), minAnnular: mm(0.13), edge: mm(0.3), maskMargin: mm(0.05), silkWidth: mm(0.15) };
export const rectOutline = (w: number, h: number): P[] => [[0, 0], [mm(w), 0], [mm(w), mm(h)], [0, mm(h)]];
export const newBoard = (w = 50, h = 40): Board => ({ schema: 1, outline: rectOutline(w, h), parts: [], tracks: [], vias: [], rules: { ...DEFAULT_RULES } });
export const boardOf = (pr: Project): Board | null => (pr.pcb && (pr.pcb as Board).schema === 1 ? (pr.pcb as Board) : null);

let seq = 0; export const pid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- transforms ----------
/** Footprint-local → board: mirror for the bottom side first, then rotate CCW (y down: (x,y)→(y,−x) per 90°), then translate. */
export function place(p: PcbPart, x: Nm, y: Nm): P {
  let [u, v] = [p.side === "bottom" ? -x : x, y];
  for (let i = 0; i < p.rot / 90; i++) [u, v] = [v, -u];
  return [p.at[0] + u, p.at[1] + v];
}
const turned = (p: PcbPart) => p.rot === 90 || p.rot === 270;

// ---------- pads in board coordinates ----------
export interface WPad { part: string; ref: string; name: string; at: P; shape: PadShape; size: P; drill?: Nm; layers: Layer[]; net: string; key: string }
export function padsOf(b: Board, pr: Project, con: Connectivity = connectivity(pr)): WPad[] {
  const out: WPad[] = [];
  for (const p of b.parts) {
    const f = footprint(p.footprint); if (!f) continue;
    f.pads.forEach((d, i) => {
      const size: P = turned(p) ? [d.size[1], d.size[0]] : [d.size[0], d.size[1]];
      const layers: Layer[] = d.drill ? ["F.Cu", "B.Cu"] : [p.side === "top" ? "F.Cu" : "B.Cu"];
      out.push({ part: p.id, ref: p.ref, name: d.name, at: place(p, d.at[0], d.at[1]), shape: d.shape, size, drill: d.drill, layers, net: con.pinNet.get(`${p.part}:${d.name}`) ?? "", key: `${p.id}#${i}` });
    });
  }
  return out;
}

// ---------- geometry (doubles hold integer nm exactly up to 2^53) ----------
export type Shape = { t: "cap"; a: P; b: P; r: number } | { t: "rect"; x0: number; y0: number; x1: number; y1: number } | { t: "poly"; rings: P[][] };
export function padShape(p: { at: P; shape: PadShape; size: P }): Shape {
  const [w, h] = p.size, [x, y] = p.at;
  if (p.shape === "rect") return { t: "rect", x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
  if (p.shape === "circle" || w === h) return { t: "cap", a: [x, y], b: [x, y], r: w / 2 };
  return w > h ? { t: "cap", a: [x - (w - h) / 2, y], b: [x + (w - h) / 2, y], r: h / 2 } : { t: "cap", a: [x, y - (h - w) / 2], b: [x, y + (h - w) / 2], r: w / 2 };
}
const ptSeg = (p: P, a: P, b: P) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const cross = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segsCross(a: P, b: P, c: P, d: P) { const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d); return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)); }
export const segSeg = (a: P, b: P, c: P, d: P) => (segsCross(a, b, c, d) ? 0 : Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b)));
const inRect = (p: P, r: { x0: number; y0: number; x1: number; y1: number }) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
function segRect(a: P, b: P, r: { x0: number; y0: number; x1: number; y1: number }) {
  if (inRect(a, r) || inRect(b, r)) return 0;
  const c: P[] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  return Math.min(...c.map((p, i) => segSeg(a, b, p, c[(i + 1) % 4])));
}
const inRings = (p: P, rings: P[][]) => { let c = false; for (const o of rings) for (let i = 0, j = o.length - 1; i < o.length; j = i++) if ((o[i][1] > p[1]) !== (o[j][1] > p[1]) && p[0] < ((o[j][0] - o[i][0]) * (p[1] - o[i][1])) / (o[j][1] - o[i][1]) + o[i][0]) c = !c; return c; };
const ringEdges = (rings: P[][]) => rings.flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]] as [P, P]));
function polyDist(poly: { rings: P[][] }, t: Shape): number {
  if (t.t === "poly") { if (t.rings[0].some((p) => inRings(p, poly.rings)) || poly.rings[0].some((p) => inRings(p, t.rings))) return 0; const e = ringEdges(t.rings); return Math.min(...ringEdges(poly.rings).map(([a, b]) => Math.min(...e.map(([c, d]) => segSeg(a, b, c, d))))); }
  if (t.t === "cap") { if (inRings(t.a, poly.rings)) return 0; return Math.max(0, Math.min(...ringEdges(poly.rings).map(([a, b]) => segSeg(a, b, t.a, t.b))) - t.r); }
  const corners: P[] = [[t.x0, t.y0], [t.x1, t.y0], [t.x1, t.y1], [t.x0, t.y1]]; if (corners.some((c) => inRings(c, poly.rings)) || poly.rings[0].some((p) => inRect(p, t))) return 0;
  return Math.min(...ringEdges(poly.rings).map(([a, b]) => segRect(a, b, t)));
}
/** Edge-to-edge distance between two copper shapes (0 when touching or overlapping). */
export function dist(s: Shape, t: Shape): number {
  if (s.t === "poly") return polyDist(s, t); if (t.t === "poly") return polyDist(t, s);
  if (s.t === "cap" && t.t === "cap") return Math.max(0, segSeg(s.a, s.b, t.a, t.b) - s.r - t.r);
  if (s.t === "rect" && t.t === "rect") return Math.hypot(Math.max(0, t.x0 - s.x1, s.x0 - t.x1), Math.max(0, t.y0 - s.y1, s.y0 - t.y1));
  const [c, r] = s.t === "cap" ? [s, t as Extract<Shape, { t: "rect" }>] : [t as Extract<Shape, { t: "cap" }>, s];
  return Math.max(0, segRect(c.a, c.b, r) - c.r);
}
export const bbox = (s: Shape) => (s.t === "poly" ? [Math.min(...s.rings[0].map((p) => p[0])), Math.min(...s.rings[0].map((p) => p[1])), Math.max(...s.rings[0].map((p) => p[0])), Math.max(...s.rings[0].map((p) => p[1]))] : s.t === "rect" ? [s.x0, s.y0, s.x1, s.y1] : [Math.min(s.a[0], s.b[0]) - s.r, Math.min(s.a[1], s.b[1]) - s.r, Math.max(s.a[0], s.b[0]) + s.r, Math.max(s.a[1], s.b[1]) + s.r]);

// ---------- copper items and connectivity ----------
export interface Item { id: string; kind: "pad" | "track" | "via" | "zone"; layers: Layer[]; shape: Shape; net: string; label: string; at: P }
export function items(b: Board, pads: WPad[], withZones = true): Item[] {
  const base = baseItems(b, pads); if (!withZones || !b.zones?.length) return base;
  const fills = fillZones(b, base); return [...base, ...fills.flatMap((f) => f.polys.map((p, i): Item => ({ id: `${f.zone.id}:${i}`, kind: "zone", layers: [f.zone.layer], shape: { t: "poly", rings: p.rings }, net: f.zone.net, label: `${f.zone.net} pour (${f.zone.layer})`, at: p.rings[0][0] })))];
}
export function baseItems(b: Board, pads: WPad[]): Item[] {
  return [
    ...pads.map((p): Item => ({ id: p.key, kind: "pad", layers: p.layers, shape: padShape(p), net: p.net, label: `${p.ref} pad ${p.name}`, at: p.at })),
    ...b.tracks.map((t): Item => ({ id: t.id, kind: "track", layers: [t.layer], shape: { t: "cap", a: t.a, b: t.b, r: t.width / 2 }, net: t.net, label: `track (${t.layer})`, at: [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2] })),
    ...b.vias.map((v): Item => ({ id: v.id, kind: "via", layers: ["F.Cu", "B.Cu"], shape: { t: "cap", a: v.at, b: v.at, r: v.dia / 2 }, net: v.net, label: "via", at: v.at })),
  ];
}
const shareLayer = (a: Item, b: Item) => a.layers.some((l) => b.layers.includes(l));
/** Union-find over copper that physically touches on a shared layer. */
export function copperGroups(its: Item[]): Map<string, number> {
  const parent = its.map((_, i) => i); const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const bb = its.map((x) => bbox(x.shape));
  for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
    if (bb[i][0] > bb[j][2] || bb[j][0] > bb[i][2] || bb[i][1] > bb[j][3] || bb[j][1] > bb[i][3]) continue;
    if (shareLayer(its[i], its[j]) && dist(its[i].shape, its[j].shape) <= 0.5) parent[find(i)] = find(j);
  }
  return new Map(its.map((x, i) => [x.id, find(i)]));
}

// ---------- ratsnest ----------
export interface Airwire { net: string; a: P; b: P; from: string; to: string }
/** Connections still to route: per net, a minimum spanning tree between the separate copper islands of that net. */
export function ratsnest(b: Board, pr: Project, con?: Connectivity): Airwire[] {
  const pads = padsOf(b, pr, con); const its = items(b, pads); const g = copperGroups(its);
  const byNet = new Map<string, Item[]>();
  for (const x of its) if (x.net && x.kind === "pad") (byNet.get(x.net) ?? byNet.set(x.net, []).get(x.net)!).push(x);
  const out: Airwire[] = [];
  for (const [net, ps] of byNet) {
    // islands: pads grouped by copper group
    const isl = new Map<number, Item[]>(); for (const p of ps) (isl.get(g.get(p.id)!) ?? isl.set(g.get(p.id)!, []).get(g.get(p.id)!)!).push(p);
    const groups = [...isl.values()]; if (groups.length < 2) continue;
    const inTree = new Set([0]);
    while (inTree.size < groups.length) {
      let best: { d: number; i: number; j: number; a: Item; b: Item } | null = null;
      for (const i of inTree) for (let j = 0; j < groups.length; j++) { if (inTree.has(j)) continue;
        for (const a of groups[i]) for (const c of groups[j]) { const d = Math.hypot(a.at[0] - c.at[0], a.at[1] - c.at[1]); if (!best || d < best.d) best = { d, i, j, a, b: c }; } }
      inTree.add(best!.j); out.push({ net, a: best!.a.at, b: best!.b.at, from: best!.a.label, to: best!.b.label });
    }
  }
  return out;
}

// ---------- forward annotation (schematic → board) ----------
export interface SyncReport { added: string[]; removed: string[]; changed: string[]; missing: string[] }
export function sync(pr: Project, b0: Board | null): { board: Board; report: SyncReport } {
  const b: Board = b0 ? structuredClone(b0) : newBoard();
  const rep: SyncReport = { added: [], removed: [], changed: [], missing: [] };
  const want = pr.parts.filter((p) => { const d = device(p.device); return d && !simOnly(d); });
  const keep = new Set(want.map((p) => p.id));
  for (const bp of b.parts.filter((x) => !keep.has(x.part))) rep.removed.push(bp.ref);
  b.parts = b.parts.filter((x) => keep.has(x.part));
  // drop copper of nets that no longer exist is left to the user (DRC reports it); new parts go in a row below the board
  const [, , , maxY] = outlineBox(b); let cursor = 0;
  for (const p of want.sort((a, c) => a.ref.localeCompare(c.ref, undefined, { numeric: true }))) {
    const fpName = p.props.footprint || device(p.device)!.footprints[0];
    const f = fpName ? footprint(fpName) : undefined;
    if (!f) { rep.missing.push(`${p.ref}${fpName ? ` (${fpName})` : ""}`); b.parts = b.parts.filter((x) => x.part !== p.id); continue; }
    const ex = b.parts.find((x) => x.part === p.id);
    if (ex) { if (ex.footprint !== f.name || ex.ref !== p.ref) { rep.changed.push(p.ref); ex.footprint = f.name; ex.ref = p.ref; } continue; }
    const w = f.courtyard[2] - f.courtyard[0];
    b.parts.push({ id: pid("fp"), part: p.id, ref: p.ref, footprint: f.name, at: [cursor - f.courtyard[0], maxY + mm(5) - f.courtyard[1]], rot: 0, side: "top" });
    cursor += w + mm(2); rep.added.push(p.ref);
  }
  return { board: b, report: rep };
}
export function outlineBox(b: Board): [Nm, Nm, Nm, Nm] { const xs = b.outline.map((p) => p[0]), ys = b.outline.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
export function insideOutline(b: Board, p: P): boolean { // even-odd point in polygon
  let c = false; const o = b.outline;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) if ((o[i][1] > p[1]) !== (o[j][1] > p[1]) && p[0] < ((o[j][0] - o[i][0]) * (p[1] - o[i][1])) / (o[j][1] - o[i][1]) + o[i][0]) c = !c;
  return c;
}
/** Courtyard of a placed part in board coordinates. */
export function courtyardOf(p: PcbPart): [Nm, Nm, Nm, Nm] | null {
  const f = footprint(p.footprint); if (!f) return null; const [x0, y0, x1, y1] = f.courtyard;
  const c = [place(p, x0, y0), place(p, x1, y1)];
  return [Math.min(c[0][0], c[1][0]), Math.min(c[0][1], c[1][1]), Math.max(c[0][0], c[1][0]), Math.max(c[0][1], c[1][1])];
}

// ---------- spatial index ----------
/** Uniform-grid index over axis-aligned boxes [x0, y0, x1, y1]: the broad phase for DRC, so each object is only
 * compared with its neighbours instead of every other object. Query results are ascending and unique. */
export class BoxGrid {
  private cells = new Map<number, number[]>(); private stamp: Int32Array; private q = 0; private ox: number; private oy: number; private n: number; private brute: boolean;
  /** cell = 0 makes a brute-force index (every query returns every box): the reference the tests compare against. */
  constructor(boxes: readonly (readonly number[] | null)[], private cell: number) {
    this.n = boxes.length; this.brute = cell === 0;
    this.stamp = new Int32Array(boxes.length); if (this.brute) { this.ox = this.oy = 0; return; } let ox = Infinity, oy = Infinity; for (const b of boxes) if (b) { ox = Math.min(ox, b[0]); oy = Math.min(oy, b[1]); }
    this.ox = Number.isFinite(ox) ? ox : 0; this.oy = Number.isFinite(oy) ? oy : 0; if (!(cell > 0)) this.cell = 1;
    boxes.forEach((b, i) => { if (b) this.cover(b, (k) => { const c = this.cells.get(k); if (c) c.push(i); else this.cells.set(k, [i]); }); });
  }
  private cover(b: readonly number[], f: (k: number) => void) {
    const c = this.cell, i0 = Math.floor((b[0] - this.ox) / c), i1 = Math.floor((b[2] - this.ox) / c), j0 = Math.floor((b[1] - this.oy) / c), j1 = Math.floor((b[3] - this.oy) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) f(i * 2097152 + j); // 2^21 cells per axis
  }
  /** Indices of boxes whose cells overlap box b (a superset of the boxes that intersect b), ascending. */
  query(b: readonly number[]): number[] {
    if (this.brute) return Array.from({ length: this.n }, (_, i) => i);
    const out: number[] = []; const id = ++this.q;
    this.cover(b, (k) => { const c = this.cells.get(k); if (c) for (const i of c) if (this.stamp[i] !== id) { this.stamp[i] = id; out.push(i); } });
    return out.sort((a, c) => a - c);
  }
}
/** A sensible cell size: twice the median box size, never below `min`. */
export function gridCell(boxes: readonly (readonly number[] | null)[], min: number): number {
  const s = boxes.filter((b): b is readonly number[] => !!b).map((b) => Math.max(b[2] - b[0], b[3] - b[1])).sort((a, c) => a - c);
  return Math.max(min, 2 * (s[s.length >> 1] ?? min));
}
