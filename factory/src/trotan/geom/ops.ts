// Booleans, offsets and kerf use Clipper (Angus Johnson, Boost licence) on integer coordinates:
// 1 unit = 0.1 µm, so results are exact to well below any laser's resolution. Curves are flattened
// to 0.005 mm first, so boolean/offset results are polylines (documented in docs/trotan/precision.md).
import ClipperLib from "clipper-lib";
import { dist, flatten, pointInPoly, polyArea, type Polyline, type SubPath, type Vec } from "./core";

const S = 10000; // 1 mm = 10 000 units
type IntPath = { X: number; Y: number }[];
const toInt = (pl: Polyline[]): IntPath[] => pl.filter((p) => p.pts.length > 1).map((p) => p.pts.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
const fromInt = (ps: IntPath[], closed = true): SubPath[] => ps.filter((p) => p.length > 1).map((p) => {
  const pts: Vec[] = p.map((q) => [q.X / S, q.Y / S]);
  return { start: pts[0], closed, segs: [...pts.slice(1), ...(closed ? [pts[0]] : [])].map((pt) => ({ k: "L" as const, p: pt })) };
});

export type BoolOp = "union" | "subtract" | "intersect" | "exclude";
const CT: Record<BoolOp, number> = { union: ClipperLib.ClipType.ctUnion, subtract: ClipperLib.ClipType.ctDifference, intersect: ClipperLib.ClipType.ctIntersection, exclude: ClipperLib.ClipType.ctXor };

/** Boolean of closed shapes. a and b are lists of closed sub-paths (world coordinates). Even-odd fill. */
export function booleanOp(a: SubPath[], b: SubPath[], op: BoolOp, tol = 0.005): SubPath[] {
  const A = toInt(flatten(a.filter((s) => s.closed), tol)), B = toInt(flatten(b.filter((s) => s.closed), tol));
  if (!A.length) throw new Error("Boolean operations need closed shapes");
  const c = new ClipperLib.Clipper();
  c.AddPaths(A, ClipperLib.PolyType.ptSubject, true);
  if (B.length) c.AddPaths(B, ClipperLib.PolyType.ptClip, true);
  const sol: IntPath[] = [];
  c.Execute(CT[op], sol, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return fromInt(ClipperLib.Clipper.CleanPolygons(sol, 1));
}
/** Union of many shapes (used to merge a selection). */
export function unionAll(groups: SubPath[][], tol = 0.005): SubPath[] {
  const c = new ClipperLib.Clipper();
  for (const g of groups) { const P = toInt(flatten(g.filter((s) => s.closed), tol)); if (P.length) c.AddPaths(P, ClipperLib.PolyType.ptSubject, true); }
  const sol: IntPath[] = [];
  c.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromInt(sol);
}
/** Offset (grow > 0, shrink < 0) of closed shapes; open paths become an outline of width 2·|d|. */
export function offsetPaths(ps: SubPath[], d: number, join: "round" | "miter" | "square" = "round", tol = 0.005): SubPath[] {
  const co = new ClipperLib.ClipperOffset(2, 0.002 * S);
  const jt = join === "round" ? ClipperLib.JoinType.jtRound : join === "miter" ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtSquare;
  const closed = toInt(flatten(ps.filter((s) => s.closed), tol)), open = toInt(flatten(ps.filter((s) => !s.closed), tol));
  if (closed.length) co.AddPaths(closed, jt, ClipperLib.EndType.etClosedPolygon);
  if (open.length) co.AddPaths(open, jt, ClipperLib.EndType.etOpenRound);
  const sol: IntPath[] = [];
  co.Execute(sol, d * S);
  return fromInt(sol);
}

/* ------------------------------------------------------------ join / split -- */
/** Joins open sub-paths whose end points meet (within tol mm). Closes a path whose ends meet. */
export function joinPaths(ps: SubPath[], tol = 0.01): SubPath[] {
  const items = ps.map((s) => ({ ...s, segs: [...s.segs] }));
  const end = (s: SubPath): Vec => (s.segs.length ? s.segs[s.segs.length - 1].p : s.start);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < items.length; i++) {
      const a = items[i]; if (a.closed) continue;
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue; const b = items[j]; if (b.closed) continue;
        let bb: SubPath | null = null;
        if (dist(end(a), b.start) <= tol) bb = b;
        else if (dist(end(a), end(b)) <= tol) bb = reverse(b);
        if (bb) { a.segs.push(...bb.segs); items.splice(j, 1); changed = true; break outer; }
      }
    }
  }
  for (const s of items) if (!s.closed && s.segs.length > 1 && dist(end(s), s.start) <= tol) { s.segs[s.segs.length - 1] = { ...s.segs[s.segs.length - 1], p: [...s.start] as Vec }; s.closed = true; }
  return items;
}
function reverse(s: SubPath): SubPath {
  const pts: Vec[] = [s.start, ...s.segs.map((g) => g.p)];
  const segs = [] as SubPath["segs"];
  for (let i = s.segs.length - 1; i >= 0; i--) { const g = s.segs[i]; segs.push(g.k === "C" ? { k: "C", c1: g.c2, c2: g.c1, p: pts[i] } : { k: "L", p: pts[i] }); }
  return { start: pts[pts.length - 1], segs, closed: s.closed };
}
/** Splits sub-path at node index n (0 = start). A closed path opens there; an open path becomes two. */
export function splitAt(s: SubPath, n: number): SubPath[] {
  const pts: Vec[] = [s.start, ...s.segs.map((g) => g.p)];
  if (n < 0 || n >= pts.length) throw new Error("No such node");
  if (s.closed) {
    const k = n === pts.length - 1 ? 0 : n;
    const segs = [...s.segs.slice(k), ...s.segs.slice(0, k)];
    return [{ start: [...pts[k]] as Vec, segs, closed: false }];
  }
  if (n === 0 || n === pts.length - 1) return [s];
  return [{ start: s.start, segs: s.segs.slice(0, n), closed: false }, { start: [...pts[n]] as Vec, segs: s.segs.slice(n), closed: false }];
}

/* ------------------------------------------------------------- validation -- */
export interface GeoIssue { kind: "open" | "duplicate" | "self_intersection" | "tiny"; ids: string[]; at?: Vec; detail: string }
/** Duplicate cut lines: segments (flattened, 0.01 mm grid) shared by two paths, in either direction. */
export function duplicateSegments(items: { id: string; paths: SubPath[] }[], tol = 0.01): GeoIssue[] {
  const key = (a: Vec, b: Vec) => { const q = (v: Vec) => `${Math.round(v[0] / tol)},${Math.round(v[1] / tol)}`; const ka = q(a), kb = q(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };
  const seen = new Map<string, { id: string; at: Vec }>();
  const hits = new Map<string, GeoIssue>();
  for (const it of items) {
    const mine = new Set<string>();
    for (const pl of flatten(it.paths, 0.05)) {
      const pts = pl.closed ? [...pl.pts, pl.pts[0]] : pl.pts;
      for (let i = 1; i < pts.length; i++) {
        if (dist(pts[i - 1], pts[i]) < tol) continue;
        const k = key(pts[i - 1], pts[i]);
        if (mine.has(k)) continue; mine.add(k);
        const prev = seen.get(k);
        if (prev && prev.id !== it.id) {
          const hk = [prev.id, it.id].sort().join("+");
          if (!hits.has(hk)) hits.set(hk, { kind: "duplicate", ids: [prev.id, it.id], at: pts[i], detail: "Overlapping cut lines — the laser would cut this edge twice" });
        } else if (!prev) seen.set(k, { id: it.id, at: pts[i] });
      }
    }
  }
  return [...hits.values()];
}
const segInter = (a: Vec, b: Vec, c: Vec, d: Vec): Vec | null => {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
};
/** First self-intersection of each sub-path (non-adjacent segments crossing), or none. */
export function selfIntersections(id: string, ps: SubPath[]): GeoIssue[] {
  const out: GeoIssue[] = [];
  for (const pl of flatten(ps, 0.05)) {
    const p = pl.closed ? [...pl.pts, pl.pts[0]] : pl.pts, n = p.length - 1;
    if (n > 4000) continue; // very dense paths are checked by the job validator in the worker
    let hit: Vec | null = null;
    for (let i = 0; i < n && !hit; i++) for (let j = i + 2; j < n; j++) {
      if (pl.closed && i === 0 && j === n - 1) continue;
      const q = segInter(p[i], p[i + 1], p[j], p[j + 1]); if (q) { hit = q; break; }
    }
    if (hit) out.push({ kind: "self_intersection", ids: [id], at: hit, detail: "Path crosses itself" });
  }
  return out;
}
export function openContours(id: string, ps: SubPath[]): GeoIssue[] {
  return ps.filter((s) => !s.closed && !(s.segs.length && dist(s.segs[s.segs.length - 1].p, s.start) < 0.01)).map((s) => ({ kind: "open" as const, ids: [id], at: s.start, detail: "Open contour — a cut needs a closed outline to free the part" }));
}

/* -------------------------------------------------------- kerf & nesting depth -- */
/** Containment depth of each closed polyline (0 = outer). Even depth = part outline, odd = hole. */
export function depths(polys: Vec[][]): number[] {
  return polys.map((p, i) => polys.reduce((n, q, j) => (j !== i && q.length > 2 && Math.abs(polyArea(q)) > Math.abs(polyArea(p)) && pointInPoly(p[0], q) ? n + 1 : n), 0));
}
/** Kerf compensation: outer outlines grow by kerf/2, holes shrink by kerf/2, so parts come out at size. */
export function kerfCompensate(polys: Vec[][], kerf: number): Vec[][] {
  if (!kerf) return polys;
  const dep = depths(polys);
  return polys.flatMap((p, i) => {
    const sp: SubPath = { start: p[0], closed: true, segs: [...p.slice(1), p[0]].map((pt) => ({ k: "L" as const, p: pt })) };
    const res = offsetPaths([sp], (dep[i] % 2 === 0 ? 1 : -1) * kerf / 2, "round");
    return res.map((r) => [r.start, ...r.segs.map((g) => g.p)].slice(0, -1) as Vec[]);
  });
}
