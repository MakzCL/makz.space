// Design rule check. Every finding names the rule, the measured value, the limit and where it is.
import type { Project } from "../core/types";
import { connectivity } from "../connectivity/connectivity";
import { BoxGrid, gridCell, bbox, copperGroups, courtyardOf, dist, insideOutline, items, padsOf, ratsnest, segSeg, type Board, type Item, type P } from "./board";
import { footprint } from "./footprints";

export type DrcRule = "short" | "clearance" | "unrouted" | "track-width" | "drill" | "annular" | "edge" | "outside" | "courtyard" | "dangling" | "footprint";
export interface DrcFinding { rule: DrcRule; severity: "error" | "warning"; message: string; at: P; ids: string[] }
const f2 = (nm: number) => (nm / 1e6).toFixed(3).replace(/\.?0+$/, "") + " mm";

/** opts.bruteForce compares every pair of objects (slow; the reference for the spatial-index tests). */
export function drc(b: Board, pr: Project, opts: { bruteForce?: boolean } = {}): DrcFinding[] {
  const con = connectivity(pr); const pads = padsOf(b, pr, con); const its = items(b, pads); const R = b.rules; const out: DrcFinding[] = [];
  const bb = its.map((x) => bbox(x.shape));
  // clearance and shorts between different nets on a shared layer (a pad without a net is its own net)
  const netOf = (x: Item) => x.net || `#${x.id}`;
  const grid = new BoxGrid(bb, opts.bruteForce ? 0 : gridCell(bb, R.clearance * 4)); const C = R.clearance;
  for (let i = 0; i < its.length; i++) for (const j of grid.query([bb[i][0] - C, bb[i][1] - C, bb[i][2] + C, bb[i][3] + C])) {
    if (j <= i) continue; const a = its[i], c = its[j]; if (netOf(a) === netOf(c) || !a.layers.some((l) => c.layers.includes(l))) continue;
    if (a.kind === "pad" && c.kind === "pad" && a.id.split("#")[0] === c.id.split("#")[0] && a.label === c.label) continue;
    if (bb[i][0] - R.clearance > bb[j][2] || bb[j][0] - R.clearance > bb[i][2] || bb[i][1] - R.clearance > bb[j][3] || bb[j][1] - R.clearance > bb[i][3]) continue;
    const d = dist(a.shape, c.shape);
    if (d <= 0) out.push({ rule: "short", severity: "error", message: `Short: ${a.label} (${a.net || "no net"}) touches ${c.label} (${c.net || "no net"})`, at: a.at, ids: [a.id, c.id] });
    else if (d < R.clearance - 0.5) out.push({ rule: "clearance", severity: "error", message: `Clearance ${f2(d)} < ${f2(R.clearance)}: ${a.label} (${a.net || "no net"}) and ${c.label} (${c.net || "no net"})`, at: a.at, ids: [a.id, c.id] });
  }
  for (const w of ratsnest(b, pr, con)) out.push({ rule: "unrouted", severity: "error", message: `Unrouted: net ${w.net}, ${w.from} → ${w.to}`, at: w.a, ids: [] });
  for (const t of b.tracks) if (t.width < R.minTrack) out.push({ rule: "track-width", severity: "error", message: `Track width ${f2(t.width)} < ${f2(R.minTrack)}`, at: t.a, ids: [t.id] });
  for (const v of b.vias) {
    if (v.drill < R.minDrill) out.push({ rule: "drill", severity: "error", message: `Via drill ${f2(v.drill)} < ${f2(R.minDrill)}`, at: v.at, ids: [v.id] });
    if ((v.dia - v.drill) / 2 < R.minAnnular) out.push({ rule: "annular", severity: "error", message: `Via annular ring ${f2((v.dia - v.drill) / 2)} < ${f2(R.minAnnular)}`, at: v.at, ids: [v.id] });
  }
  for (const p of pads) if (p.drill) {
    if (p.drill < R.minDrill) out.push({ rule: "drill", severity: "error", message: `${p.ref} pad ${p.name}: drill ${f2(p.drill)} < ${f2(R.minDrill)}`, at: p.at, ids: [p.key] });
    const ring = (Math.min(p.size[0], p.size[1]) - p.drill) / 2;
    if (ring < R.minAnnular) out.push({ rule: "annular", severity: "error", message: `${p.ref} pad ${p.name}: annular ring ${f2(ring)} < ${f2(R.minAnnular)}`, at: p.at, ids: [p.key] });
  }
  // board edge
  const edges = b.outline.map((p, i) => [p, b.outline[(i + 1) % b.outline.length]] as [P, P]);
  its.forEach((x, i) => {
    const corners: P[] = [[bb[i][0], bb[i][1]], [bb[i][2], bb[i][1]], [bb[i][2], bb[i][3]], [bb[i][0], bb[i][3]]];
    if (!corners.every((c) => insideOutline(b, c))) { out.push({ rule: "outside", severity: "error", message: `${x.label} is outside the board outline`, at: x.at, ids: [x.id] }); return; }
    const s = x.shape; const d = Math.min(...edges.map(([e0, e1]) => (s.t === "cap" ? Math.max(0, segSeg(s.a, s.b, e0, e1) - s.r) : dist(s, { t: "cap", a: e0, b: e1, r: 0 }))));
    if (d < R.edge - 0.5) out.push({ rule: "edge", severity: "error", message: `${x.label} is ${f2(d)} from the board edge (minimum ${f2(R.edge)})`, at: x.at, ids: [x.id] });
  });
  // courtyards
  const cy = b.parts.map((p) => ({ p, c: courtyardOf(p) }));
  const cyBoxes = cy.map((x) => x.c); const cyGrid = new BoxGrid(cyBoxes, opts.bruteForce ? 0 : gridCell(cyBoxes, 1e5));
  for (let i = 0; i < cy.length; i++) for (const j of cy[i].c ? cyGrid.query(cy[i].c!) : []) {
    if (j <= i) continue; const A = cy[i], C = cy[j]; if (!A.c || !C.c || A.p.side !== C.p.side) continue;
    if (A.c[0] < C.c[2] && C.c[0] < A.c[2] && A.c[1] < C.c[3] && C.c[1] < A.c[3]) out.push({ rule: "courtyard", severity: "warning", message: `${A.p.ref} and ${C.p.ref} courtyards overlap`, at: A.p.at, ids: [A.p.id, C.p.id] });
  }
  for (const p of b.parts) if (!footprint(p.footprint)) out.push({ rule: "footprint", severity: "error", message: `${p.ref}: footprint ${p.footprint} not found`, at: p.at, ids: [p.id] });
  // dangling track ends (touch nothing else)
  const g = copperGroups(its); void g;
  for (const t of b.tracks) for (const end of [t.a, t.b]) {
    const dot = { t: "cap" as const, a: end, b: end, r: 0 };
    const h = t.width / 2; const touches = grid.query([end[0] - h, end[1] - h, end[0] + h, end[1] + h]).some((k) => { const x = its[k]; return x.id !== t.id && x.layers.some((l) => l === t.layer) && dist(dot, x.shape) <= h; });
    if (!touches) out.push({ rule: "dangling", severity: "warning", message: `Track end on ${t.layer} connects to nothing`, at: end, ids: [t.id] });
  }
  return out;
}
