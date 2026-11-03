// Copper pours (zones): a net fills an area on one layer, keeping the clearance from every other net and the board
// edge, joining its own net's copper (solid or thermal-relief connections), with thin slivers and unconnected islands
// removed. Polygon maths: Clipper (Angus Johnson, Boost licence), integer nanometres.
import ClipperLib from "clipper-lib";
import type { Board, Item, Layer, P, Shape } from "./board";
import { mm, type Nm } from "./footprints";

export interface Zone { id: string; net: string; layer: Layer; outline?: P[]; clearance?: Nm; minWidth?: Nm; thermal?: boolean; thermalGap?: Nm; spoke?: Nm }
/** One filled area: rings[0] is the outer edge, the rest are holes. */
export interface FillPoly { rings: P[][] }
export interface ZoneFill { zone: Zone; polys: FillPoly[] }

type Path = { X: number; Y: number }[];
const C = ClipperLib;
const ARC = mm(0.002); // arc approximation tolerance
const toPath = (pts: P[]): Path => pts.map(([x, y]) => ({ X: Math.round(x), Y: Math.round(y) }));
const fromPath = (p: Path): P[] => p.map((q) => [q.X, q.Y]);
function offset(paths: Path[], delta: number, join = C.JoinType.jtRound, end = C.EndType.etClosedPolygon): Path[] {
  const co = new C.ClipperOffset(2, ARC); co.AddPaths(paths, join, end); const out: Path[] = []; co.Execute(out, delta); return out;
}
function clip(subj: Path[], clipP: Path[], type: number): Path[] {
  const c = new C.Clipper(); c.AddPaths(subj, C.PolyType.ptSubject, true); c.AddPaths(clipP, C.PolyType.ptClip, true); const out: Path[] = [];
  c.Execute(type, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero); return out;
}
/** A copper shape grown by `grow` as polygons. */
export function shapePoly(s: Shape, grow: number): Path[] {
  if (s.t === "rect") return offset([toPath([[s.x0, s.y0], [s.x1, s.y0], [s.x1, s.y1], [s.x0, s.y1]])], grow, grow > 0 ? C.JoinType.jtRound : C.JoinType.jtMiter);
  if (s.t === "poly") return grow ? offset(s.rings.map(toPath), grow) : s.rings.map(toPath);
  const r = s.r + grow; if (r <= 0) return [];
  if (s.a[0] === s.b[0] && s.a[1] === s.b[1]) { const n = Math.max(16, Math.ceil(Math.PI / Math.acos(1 - ARC / r))); return [Array.from({ length: n }, (_, i) => ({ X: Math.round(s.a[0] + r * Math.cos((2 * Math.PI * i) / n)), Y: Math.round(s.a[1] + r * Math.sin((2 * Math.PI * i) / n)) }))]; }
  return offset([toPath([s.a, s.b])], r, C.JoinType.jtRound, C.EndType.etOpenRound);
}

/** Fill every zone on the board. `copper` = pads, tracks and vias (zones are filled in list order; earlier fills count as copper for later ones). */
export function fillZones(b: Board, copper: Item[]): ZoneFill[] {
  const out: ZoneFill[] = []; const placed: Item[] = [...copper];
  for (const z of b.zones ?? []) {
    const clr = (z.clearance ?? b.rules.clearance) + ARC * 2, minW = z.minWidth ?? mm(0.2);
    const area = offset([toPath(z.outline ?? b.outline)], 0, C.JoinType.jtMiter);
    const boardIn = offset([toPath(b.outline)], -(b.rules.edge + ARC * 2), C.JoinType.jtMiter);
    let fill = clip(area, boardIn, C.ClipType.ctIntersection);
    const others: Path[] = [], own: Path[] = [];
    for (const x of placed) {
      if (!x.layers.includes(z.layer)) continue;
      if (x.net && x.net === z.net) own.push(...shapePoly(x.shape, 0));
      else others.push(...shapePoly(x.shape, clr));
    }
    if (others.length) fill = clip(fill, others, C.ClipType.ctDifference);
    // thermal relief: own-net through-hole pads keep a gap with four spokes instead of a solid joint
    if (z.thermal) for (const x of placed) if (x.kind === "pad" && x.net === z.net && x.layers.length === 2 && x.layers.includes(z.layer)) {
      const gap = z.thermalGap ?? mm(0.3), sp = z.spoke ?? mm(0.4); const ring = shapePoly(x.shape, gap);
      const [cx, cy] = x.at; const L = mm(10);
      const spokes = [toPath([[cx - L, cy - sp / 2], [cx + L, cy - sp / 2], [cx + L, cy + sp / 2], [cx - L, cy + sp / 2]]), toPath([[cx - sp / 2, cy - L], [cx + sp / 2, cy - L], [cx + sp / 2, cy + L], [cx - sp / 2, cy + L]])];
      const cut = clip(ring, spokes, C.ClipType.ctDifference); fill = clip(fill, cut, C.ClipType.ctDifference);
      fill = clip(fill, clip(ring, spokes, C.ClipType.ctIntersection), C.ClipType.ctUnion);
    }
    // remove slivers narrower than the minimum width (opening), then keep only islands that touch the net's copper
    fill = offset(offset(fill, -minW / 2), minW / 2);
    const tree = new C.PolyTree(); { const c = new C.Clipper(); c.AddPaths(fill, C.PolyType.ptSubject, true); c.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero); }
    const polys: FillPoly[] = [];
    const walk = (node: ClipperLib.PolyNode) => { for (const ch of node.Childs()) { if (!ch.IsHole()) { const rings = [ch.Contour(), ...ch.Childs().map((h) => h.Contour())]; if (own.length && clip(rings, own, C.ClipType.ctIntersection).length) polys.push({ rings: rings.map(fromPath) }); for (const h of ch.Childs()) walk(h); } } };
    walk(tree);
    out.push({ zone: z, polys });
    for (const p of polys) placed.push({ id: `${z.id}:${polys.indexOf(p)}`, kind: "zone", layers: [z.layer], shape: { t: "poly", rings: p.rings }, net: z.net, label: `${z.net} pour (${z.layer})`, at: p.rings[0][0] });
  }
  return out;
}
/** Items for the filled zones (for connectivity, DRC, rendering, Gerber). */
export const zoneItems = (fills: ZoneFill[]): Item[] => fills.flatMap((f) => f.polys.map((p, i): Item => ({ id: `${f.zone.id}:${i}`, kind: "zone", layers: [f.zone.layer], shape: { t: "poly", rings: p.rings }, net: f.zone.net, label: `${f.zone.net} pour (${f.zone.layer})`, at: p.rings[0][0] })));
/** Area in mm² (outer minus holes), used by tests and the zone panel. */
export const fillArea = (p: FillPoly) => p.rings.reduce((a, r, i) => { let s = 0; for (let k = 0; k < r.length; k++) { const [x1, y1] = r[k], [x2, y2] = r[(k + 1) % r.length]; s += x1 * y2 - x2 * y1; } return a + (i === 0 ? 1 : -1) * Math.abs(s / 2); }, 0) / 1e12;
