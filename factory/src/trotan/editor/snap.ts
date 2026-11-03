// Snapping targets: grid, guides, page edges/centre and other objects' bounding boxes.
import { objBox, type Box, type Doc, type Vec } from "../geom/core";

export interface SnapOpts { grid: number; toGrid: boolean; toObjects: boolean; toGuides: boolean }
export interface SnapLines { x: number | null; y: number | null }
export function targets(doc: Doc, exclude: Set<string>, o: SnapOpts) {
  const xs: number[] = [0, doc.width / 2, doc.width], ys: number[] = [0, doc.height / 2, doc.height];
  if (o.toGuides) for (const g of doc.guides) (g.axis === "x" ? xs : ys).push(g.at);
  if (o.toObjects) for (const ob of doc.objects) {
    if (exclude.has(ob.id) || ob.hidden) continue;
    const b = objBox(ob); if (!b) continue;
    xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}
function best(vals: number[], cands: number[], tol: number, grid: number | null): { d: number; at: number } | null {
  let r: { d: number; at: number } | null = null;
  for (const v of vals) {
    for (const c of cands) { const d = c - v; if (Math.abs(d) <= tol && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, at: c }; }
    if (grid) { const c = Math.round(v / grid) * grid, d = c - v; if (Math.abs(d) <= tol && (!r || Math.abs(d) < Math.abs(r.d) - 1e-9)) r = { d, at: c }; }
  }
  return r;
}
/** Shift a moving box so its edges/centre land on the nearest target. */
export function snapBox(b: Box, t: { xs: number[]; ys: number[] }, tol: number, o: SnapOpts): { dx: number; dy: number; lines: SnapLines } {
  const g = o.toGrid ? o.grid : null;
  const bx = best([b.x, b.x + b.w / 2, b.x + b.w], t.xs, tol, g), by = best([b.y, b.y + b.h / 2, b.y + b.h], t.ys, tol, g);
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, lines: { x: bx?.at ?? null, y: by?.at ?? null } };
}
export function snapPoint(p: Vec, t: { xs: number[]; ys: number[] }, tol: number, o: SnapOpts): { p: Vec; lines: SnapLines } {
  const g = o.toGrid ? o.grid : null;
  const bx = best([p[0]], t.xs, tol, g), by = best([p[1]], t.ys, tol, g);
  return { p: [p[0] + (bx?.d ?? 0), p[1] + (by?.d ?? 0)], lines: { x: bx?.at ?? null, y: by?.at ?? null } };
}
/** Ramer–Douglas–Peucker simplification for freehand strokes. */
export function simplify(pts: Vec[], tol: number): Vec[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!; let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], L = Math.hypot(bx - ax, by - ay) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
