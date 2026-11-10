// CADRA geometry: 2D entities in drawing units (mm by default), y up (as in CAD; the view flips it).
// Pure functions: intersections, nearest points, snaps, transforms, offset and trim.

export type V = [number, number];
export const EPS = 1e-9;
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: V, b: V) => a[0] * b[1] - a[1] * b[0];
export const len = (a: V) => Math.hypot(a[0], a[1]);
export const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const ang = (a: V) => Math.atan2(a[1], a[0]);
export const polar = (c: V, r: number, t: number): V => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
export const deg = (r: number) => (r * 180) / Math.PI, rad = (d: number) => (d * Math.PI) / 180;
const TAU = Math.PI * 2;
export const normAng = (t: number) => ((t % TAU) + TAU) % TAU;
/** Is angle t on the CCW sweep from a0 to a1? */
export const onSweep = (t: number, a0: number, a1: number) => { const s = normAng(a1 - a0), u = normAng(t - a0); return u <= s + 1e-12; };

interface Base { id: string; layer: string; color?: string /* ByLayer when absent */ }
export type Line = Base & { t: "line"; a: V; b: V };
export type Circle = Base & { t: "circle"; c: V; r: number };
/** Arc: CCW from a0 to a1 (radians), as in DXF. */
export type Arc = Base & { t: "arc"; c: V; r: number; a0: number; a1: number };
export type Poly = Base & { t: "poly"; pts: V[]; closed: boolean };
export type Text = Base & { t: "text"; p: V; h: number; s: string; rot: number };
/** Linear dimension between p1 and p2, dimension line through `at`; kind sets what is measured. */
export type Dim = Base & { t: "dim"; kind: "aligned" | "horizontal" | "vertical" | "radius" | "diameter" | "angular"; p1: V; p2: V; at: V; text?: string; /** angular: the vertex */ c?: V };
/** Solid hatch filling a closed boundary. */
export type Hatch = Base & { t: "hatch"; pts: V[] };
/** A placed copy of a named block: block-local point q maps to p + rotate(k·(q − base), rot). */
export type Insert = Base & { t: "insert"; name: string; p: V; k: number; rot: number };
export type Ent = Line | Circle | Arc | Poly | Text | Dim | Hatch | Insert;
export interface BlockDef { base: V; ents: Ent[] }
/** Block definitions of the drawing being worked on (the session keeps this in step with its drawing). */
export const BLOCKS = new Map<string, BlockDef>();
export const setBlocks = (b: Record<string, BlockDef> | undefined) => { BLOCKS.clear(); for (const [k, v] of Object.entries(b ?? {})) BLOCKS.set(k, v); };
/** The entities an insert stands for, in drawing coordinates (nested blocks expanded; objects on layer 0 take the insert's layer). */
export function expand(e: Insert, depth = 0): Ent[] {
  const b = BLOCKS.get(e.name); if (!b || depth > 8) return [];
  const c = Math.cos(e.rot), s = Math.sin(e.rot); const f = (q: V): V => { const x = (q[0] - b.base[0]) * e.k, y = (q[1] - b.base[1]) * e.k; return [e.p[0] + x * c - y * s, e.p[1] + x * s + y * c]; };
  return b.ents.flatMap((x) => { const t = transformEnt(x, f, { rot: e.rot, k: e.k }); const own = { ...t, layer: x.layer === "0" ? e.layer : x.layer, color: x.color ?? e.color } as Ent; return own.t === "insert" ? expand(own, depth + 1) : [own]; });
}

let n = 0; export const eid = () => `e${Date.now().toString(36)}${(n++).toString(36)}`;

// ---------- segments as the common currency for intersections ----------
export type Seg = { k: "l"; a: V; b: V } | { k: "c"; c: V; r: number; a0?: number; a1?: number };
export function segsOf(e: Ent): Seg[] {
  switch (e.t) {
    case "line": return [{ k: "l", a: e.a, b: e.b }];
    case "circle": return [{ k: "c", c: e.c, r: e.r }];
    case "arc": return [{ k: "c", c: e.c, r: e.r, a0: e.a0, a1: e.a1 }];
    case "poly": case "hatch": { const p = e.pts, s: Seg[] = []; for (let i = 1; i < p.length; i++) s.push({ k: "l", a: p[i - 1], b: p[i] }); if ((e.t === "hatch" || e.closed) && p.length > 2) s.push({ k: "l", a: p[p.length - 1], b: p[0] }); return s; }
    case "text": { const w = e.s.length * e.h * 0.8; const r = rotPts([[0, 0], [w, 0], [w, e.h], [0, e.h]], e.rot).map((q) => add(q, e.p)); return [0, 1, 2, 3].map((i) => ({ k: "l" as const, a: r[i], b: r[(i + 1) % 4] })); }
    case "dim": return dimGeometry(e).lines.map(([a, b]) => ({ k: "l" as const, a, b }));
    case "insert": return expand(e).flatMap(segsOf);
  }
}
const rotPts = (ps: V[], r: number): V[] => ps.map(([x, y]) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]);
const onSeg = (s: Seg, p: V, tol = 1e-7) => {
  if (s.k === "l") { const d = sub(s.b, s.a), L = dot(d, d); const t = L ? dot(sub(p, s.a), d) / L : 0; return t >= -tol && t <= 1 + tol; }
  return s.a0 === undefined ? true : onSweep(ang(sub(p, s.c)), s.a0, s.a1!);
};
/** Intersections of two segments (infinite = treat lines/arcs as unbounded, for extend/trim boundaries). */
export function segX(s: Seg, t: Seg, infinite = false): V[] {
  let pts: V[] = [];
  if (s.k === "l" && t.k === "l") {
    const r = sub(s.b, s.a), q = sub(t.b, t.a), den = cross(r, q); if (Math.abs(den) < EPS) return [];
    const u = cross(sub(t.a, s.a), q) / den; pts = [add(s.a, mul(r, u))];
  } else if (s.k === "c" && t.k === "c") {
    const d = dist(s.c, t.c); if (d < EPS || d > s.r + t.r + 1e-9 || d < Math.abs(s.r - t.r) - 1e-9) return [];
    const a = (s.r * s.r - t.r * t.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, s.r * s.r - a * a)); const m = add(s.c, mul(sub(t.c, s.c), a / d)); const pr: V = [-(t.c[1] - s.c[1]) / d, (t.c[0] - s.c[0]) / d];
    pts = h < 1e-12 ? [m] : [add(m, mul(pr, h)), sub(m, mul(pr, h))];
  } else {
    const [l, c] = (s.k === "l" ? [s, t] : [t, s]) as [Extract<Seg, { k: "l" }>, Extract<Seg, { k: "c" }>];
    const d = sub(l.b, l.a), f = sub(l.a, c.c); const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - c.r * c.r; const disc = B * B - 4 * A * C;
    if (disc < -1e-12 || A < EPS) return []; const sq = Math.sqrt(Math.max(0, disc));
    pts = (sq < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]).map((u) => add(l.a, mul(d, u)));
  }
  return infinite ? pts : pts.filter((p) => onSeg(s, p) && onSeg(t, p));
}
export const intersections = (a: Ent, b: Ent): V[] => segsOf(a).flatMap((s) => segsOf(b).flatMap((t) => segX(s, t)));

// ---------- nearest point, distance, bbox ----------
export function nearestOnSeg(s: Seg, p: V): V {
  if (s.k === "l") { const d = sub(s.b, s.a), L = dot(d, d); const t = L ? Math.max(0, Math.min(1, dot(sub(p, s.a), d) / L)) : 0; return add(s.a, mul(d, t)); }
  const t = ang(sub(p, s.c)); if (s.a0 === undefined || onSweep(t, s.a0, s.a1!)) return polar(s.c, s.r, t);
  const e0 = polar(s.c, s.r, s.a0), e1 = polar(s.c, s.r, s.a1!); return dist(p, e0) < dist(p, e1) ? e0 : e1;
}
export const distTo = (e: Ent, p: V) => Math.min(...segsOf(e).map((s) => dist(p, nearestOnSeg(s, p))), e.t === "hatch" && inside(p, e.pts) ? 0 : Infinity);
export function inside(p: V, poly: V[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; }
export type Box = [number, number, number, number];
export function bbox(e: Ent): Box {
  const pts: V[] = [];
  for (const s of segsOf(e)) {
    if (s.k === "l") pts.push(s.a, s.b);
    else { const full = s.a0 === undefined; for (const t of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) if (full || onSweep(t, s.a0!, s.a1!)) pts.push(polar(s.c, s.r, t)); if (!full) pts.push(polar(s.c, s.r, s.a0!), polar(s.c, s.r, s.a1!)); }
  }
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
export const boxOf = (es: Ent[]): Box | null => es.length ? es.map(bbox).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]) : null;

// ---------- object snaps ----------
export type SnapKind = "end" | "mid" | "center" | "quad" | "int" | "perp" | "near" | "node";
export interface Snap { p: V; kind: SnapKind }
export function snapPoints(e: Ent): Snap[] {
  switch (e.t) {
    case "line": return [{ p: e.a, kind: "end" }, { p: e.b, kind: "end" }, { p: mul(add(e.a, e.b), 0.5), kind: "mid" }];
    case "circle": return [{ p: e.c, kind: "center" }, ...[0, 90, 180, 270].map((d) => ({ p: polar(e.c, e.r, rad(d)), kind: "quad" as const }))];
    case "arc": { const m = e.a0 + normAng(e.a1 - e.a0) / 2; return [{ p: e.c, kind: "center" }, { p: polar(e.c, e.r, e.a0), kind: "end" }, { p: polar(e.c, e.r, e.a1), kind: "end" }, { p: polar(e.c, e.r, m), kind: "mid" }]; }
    case "poly": case "hatch": { const s: Snap[] = e.pts.map((p) => ({ p, kind: "end" as const })); segsOf(e).forEach((g) => g.k === "l" && s.push({ p: mul(add(g.a, g.b), 0.5), kind: "mid" })); return s; }
    case "text": return [{ p: e.p, kind: "node" }];
    case "dim": return [{ p: e.p1, kind: "node" }, { p: e.p2, kind: "node" }];
    case "insert": return [{ p: e.p, kind: "node" }, ...expand(e).flatMap(snapPoints).filter((x) => x.kind !== "node")];
  }
}
/** Best snap within `tol` of p: fixed points first (end/mid/center/quad/int), then perpendicular from `from`, then nearest. */
export function findSnap(ents: Ent[], p: V, tol: number, on: Set<SnapKind>, from?: V): Snap | null {
  const near = ents.filter((e) => distTo(e, p) <= tol * 2);
  const cand: Snap[] = [];
  for (const e of near) cand.push(...snapPoints(e).filter((s) => on.has(s.kind)));
  if (on.has("int")) for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) for (const q of intersections(near[i], near[j])) cand.push({ p: q, kind: "int" });
  const best = cand.filter((s) => dist(s.p, p) <= tol).sort((a, b) => dist(a.p, p) - dist(b.p, p))[0]; if (best) return best;
  if (from && on.has("perp")) for (const e of near) for (const s of segsOf(e)) { if (s.k !== "l") continue; const d = sub(s.b, s.a), L = dot(d, d); const t = dot(sub(from, s.a), d) / L; if (t < 0 || t > 1) continue; const q = add(s.a, mul(d, t)); if (dist(q, p) <= tol) return { p: q, kind: "perp" }; }
  if (on.has("near")) for (const e of near) { const q = segsOf(e).map((s) => nearestOnSeg(s, p)).sort((a, b) => dist(a, p) - dist(b, p))[0]; if (q && dist(q, p) <= tol) return { p: q, kind: "near" }; }
  return null;
}

// ---------- transforms ----------
export type Xf = (p: V) => V;
export const translate = (d: V): Xf => (p) => add(p, d);
export const rotateAbout = (c: V, t: number): Xf => (p) => { const q = sub(p, c); return add(c, [q[0] * Math.cos(t) - q[1] * Math.sin(t), q[0] * Math.sin(t) + q[1] * Math.cos(t)]); };
export const scaleAbout = (c: V, k: number): Xf => (p) => add(c, mul(sub(p, c), k));
export const mirrorAcross = (a: V, b: V): Xf => (p) => { const d = norm(sub(b, a)); const q = sub(p, a); const proj = mul(d, dot(q, d)); return add(a, sub(mul(proj, 2), q)); };
/** Apply a point transform to an entity; `angleOf` tells how angles map (rotation) and `flip` for mirrors; `k` scales lengths. */
export function transformEnt(e: Ent, f: Xf, o: { rot?: number; flip?: boolean; k?: number } = {}): Ent {
  const k = o.k ?? 1, rot = o.rot ?? 0;
  switch (e.t) {
    case "line": return { ...e, a: f(e.a), b: f(e.b) };
    case "circle": return { ...e, c: f(e.c), r: e.r * k };
    case "arc": { const c = f(e.c), p0 = f(polar(e.c, e.r, e.a0)), p1 = f(polar(e.c, e.r, e.a1)); const a0 = ang(sub(p0, c)), a1 = ang(sub(p1, c)); return o.flip ? { ...e, c, r: e.r * k, a0: a1, a1: a0 } : { ...e, c, r: e.r * k, a0, a1 }; }
    case "poly": case "hatch": return { ...e, pts: e.pts.map(f) } as Ent;
    case "text": return { ...e, p: f(e.p), h: e.h * k, rot: e.rot + rot };
    case "dim": return { ...e, p1: f(e.p1), p2: f(e.p2), at: f(e.at), ...(e.c ? { c: f(e.c) } : {}) };
    case "insert": return { ...e, p: f(e.p), k: e.k * k, rot: e.rot + rot };
  }
}

// ---------- offset ----------
/** Offset by distance d to the side of point `side` (lines, circles, arcs, polylines with mitred corners). */
export function offsetEnt(e: Ent, d: number, side: V): Ent | null {
  if (e.t === "line") { const n0: V = norm([-(e.b[1] - e.a[1]), e.b[0] - e.a[0]]); const s = dot(sub(side, e.a), n0) >= 0 ? 1 : -1; const o = mul(n0, d * s); return { ...e, id: eid(), a: add(e.a, o), b: add(e.b, o) }; }
  if (e.t === "circle" || e.t === "arc") { const r = dist(side, e.c) > e.r ? e.r + d : e.r - d; if (r <= EPS) return null; return { ...e, id: eid(), r }; }
  if (e.t === "poly") {
    const P = e.pts; if (P.length < 2) return null;
    const segN = (i: number): V => { const a = P[i], b = P[(i + 1) % P.length]; return norm([-(b[1] - a[1]), b[0] - a[0]]); };
    // side: sign from the segment nearest to `side`
    let bi = 0, bd = Infinity; for (let i = 0; i < P.length - (e.closed ? 0 : 1); i++) { const q = nearestOnSeg({ k: "l", a: P[i], b: P[(i + 1) % P.length] }, side); const dd = dist(q, side); if (dd < bd) { bd = dd; bi = i; } }
    const s = dot(sub(side, P[bi]), segN(bi)) >= 0 ? 1 : -1;
    const nSeg = e.closed ? P.length : P.length - 1; const lines: [V, V][] = [];
    for (let i = 0; i < nSeg; i++) { const o = mul(segN(i), d * s); lines.push([add(P[i], o), add(P[(i + 1) % P.length], o)]); }
    const out: V[] = [];
    for (let i = 0; i < P.length; i++) {
      const prev = e.closed ? lines[(i - 1 + nSeg) % nSeg] : lines[i - 1], next = e.closed ? lines[i % nSeg] : lines[i];
      if (!prev) { out.push(next[0]); continue; } if (!next) { out.push(prev[1]); continue; }
      const x = segX({ k: "l", a: prev[0], b: prev[1] }, { k: "l", a: next[0], b: next[1] }, true)[0]; out.push(x ?? next[0]);
    }
    return { ...e, id: eid(), pts: out };
  }
  return null;
}

// ---------- trim ----------
/** Trim the piece of `e` that contains `pick`, cut at its intersections with `cutters`. Returns the remaining entities. */
export function trimEnt(e: Ent, cutters: Ent[], pick: V): Ent[] | null {
  const xs = cutters.filter((c) => c.id !== e.id).flatMap((c) => intersections(e, c));
  if (e.t === "line") {
    const d = sub(e.b, e.a), L = dot(d, d); const ts = [...new Set(xs.map((p) => dot(sub(p, e.a), d) / L).filter((t) => t > 1e-9 && t < 1 - 1e-9))].sort((a, b) => a - b);
    if (!ts.length) return null; const tp = dot(sub(pick, e.a), d) / L; const cuts = [0, ...ts, 1];
    const out: Ent[] = []; for (let i = 0; i + 1 < cuts.length; i++) { if (tp >= cuts[i] && tp <= cuts[i + 1]) continue; out.push({ ...e, id: i === 0 ? e.id : eid(), a: add(e.a, mul(d, cuts[i])), b: add(e.a, mul(d, cuts[i + 1])) }); }
    return out;
  }
  if (e.t === "circle" || e.t === "arc") {
    const base = e.t === "arc" ? e.a0 : 0, span = e.t === "arc" ? normAng(e.a1 - e.a0) || TAU : TAU;
    const us = [...new Set(xs.map((p) => normAng(ang(sub(p, e.c)) - base)).filter((u) => u > 1e-9 && u < span - 1e-9).map((u) => +u.toFixed(12)))].sort((a, b) => a - b);
    if (!us.length || (e.t === "circle" && us.length < 2)) return null;
    const up = normAng(ang(sub(pick, e.c)) - base);
    if (e.t === "circle") { // remove the arc between the two cuts around the pick; keep the rest as one arc
      let i = us.findIndex((u) => u > up); if (i < 0) i = 0; const hi = us[i], lo = us[(i - 1 + us.length) % us.length];
      return [{ id: e.id, layer: e.layer, color: e.color, t: "arc", c: e.c, r: e.r, a0: base + hi, a1: base + lo }];
    }
    const cuts = [0, ...us, span]; const out: Ent[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) { if (up >= cuts[i] && up <= cuts[i + 1]) continue; out.push({ ...e, id: i === 0 ? e.id : eid(), a0: base + cuts[i], a1: base + cuts[i + 1] } as Arc); }
    return out;
  }
  return null;
}

// ---------- dimensions ----------
/** Lines, text position and measured value of a dimension. */
export function dimGeometry(d: Dim): { lines: [V, V][]; text: string; textAt: V; textRot: number; value: number } {
  if (d.kind === "angular" && d.c) {
    const c = d.c, r = Math.max(dist(c, d.at), 1e-6), t1 = ang(sub(d.p1, c)), t2 = ang(sub(d.p2, c)), ta = ang(sub(d.at, c));
    const [a0, a1] = onSweep(ta, t1, t2) ? [t1, t2] : [t2, t1]; const sw = normAng(a1 - a0) || TAU; const n = Math.max(8, Math.ceil(sw / 0.08));
    const lines: [V, V][] = []; for (let i = 0; i < n; i++) lines.push([polar(c, r, a0 + (sw * i) / n), polar(c, r, a0 + (sw * (i + 1)) / n)]);
    for (const [p, t] of [[d.p1, t1], [d.p2, t2]] as [V, number][]) { const L = dist(c, p); if (L < r) lines.push([p, polar(c, r + 1.5, t)]); }
    const mid = a0 + sw / 2; const tr = normAng(mid - Math.PI / 2 + Math.PI / 2) % Math.PI - Math.PI / 2; // tangent, kept readable
    const v = deg(sw); return { lines, value: v, text: d.text ?? `${fmt(v, 1)}°`, textAt: polar(c, r + 2, mid), textRot: tr };
  }
  if (d.kind === "radius" || d.kind === "diameter") {
    const r = dist(d.p1, d.p2), v = d.kind === "radius" ? r : 2 * r; const dir = norm(sub(d.p2, d.p1));
    const a = d.kind === "radius" ? d.p1 : sub(d.p1, mul(dir, r));
    return { lines: [[a, d.at]], value: v, text: d.text ?? `${d.kind === "radius" ? "R" : "Ø"}${fmt(v)}`, textAt: d.at, textRot: 0 };
  }
  const dir: V = d.kind === "horizontal" ? [1, 0] : d.kind === "vertical" ? [0, 1] : norm(sub(d.p2, d.p1));
  const nrm: V = [-dir[1], dir[0]]; const off = dot(sub(d.at, d.p1), nrm);
  const q1 = add(d.p1, mul(nrm, off)), q2 = add(d.p1, add(mul(nrm, off), mul(dir, dot(sub(d.p2, d.p1), dir))));
  const value = Math.abs(dot(sub(d.p2, d.p1), dir)); const ext = Math.sign(off || 1) * 1.5;
  const p2on = add(d.p2, mul(nrm, dot(sub(q2, d.p2), nrm)));
  const lines: [V, V][] = [[d.p1, add(q1, mul(nrm, ext))], [d.p2, add(p2on, mul(nrm, ext))], [q1, q2]];
  const tick = (p: V, s: number) => { const t = mul(add(dir, nrm), 1.2 * s); return [sub(p, t), add(p, t)] as [V, V]; }; lines.push(tick(q1, 1), tick(q2, 1));
  let tr = ang(dir); if (tr > Math.PI / 2 + 1e-9 || tr < -Math.PI / 2 - 1e-9) tr += Math.PI;
  return { lines, value, text: d.text ?? fmt(value), textAt: add(mul(add(q1, q2), 0.5), mul(nrm, 2 * Math.sign(off || 1))), textRot: tr };
}
export const fmt = (v: number, dp = 2) => (Math.round(v * 10 ** dp) / 10 ** dp).toString();

// ---------- extend ----------
/** Extend the end of a line or arc nearest `pick` to the closest boundary it would meet. */
export function extendEnt(e: Ent, bounds: Ent[], pick: V): Ent | null {
  const bs = bounds.filter((b) => b.id !== e.id).flatMap(segsOf);
  if (e.t === "line") {
    const endB = dist(pick, e.b) <= dist(pick, e.a); const from = endB ? e.a : e.b, to = endB ? e.b : e.a; const d = sub(to, from), L = dot(d, d); if (L < EPS) return null;
    let best = Infinity; for (const b of bs) for (const p of segX({ k: "l", a: from, b: to }, b, true)) { if (!onSeg(b, p)) continue; const t = dot(sub(p, from), d) / L; if (t > 1 + 1e-9 && t < best) best = t; }
    if (!Number.isFinite(best)) return null; const q = add(from, mul(d, best)); return endB ? { ...e, b: q } : { ...e, a: q };
  }
  if (e.t === "arc") {
    const atEnd = dist(pick, polar(e.c, e.r, e.a1)) <= dist(pick, polar(e.c, e.r, e.a0)); let best = Infinity;
    for (const b of bs) for (const p of segX({ k: "c", c: e.c, r: e.r }, b, true)) { if (!onSeg(b, p)) continue; const t = ang(sub(p, e.c)); const g = atEnd ? normAng(t - e.a1) : normAng(e.a0 - t); if (g > 1e-9 && g < best && g < TAU - normAng(e.a1 - e.a0) - 1e-9) best = g; }
    if (!Number.isFinite(best)) return null; return atEnd ? { ...e, a1: e.a1 + best } : { ...e, a0: e.a0 - best };
  }
  return null;
}

// ---------- fillet / chamfer between two lines ----------
function corner(l1: Line, l2: Line, p1: V, p2: V) {
  const r = sub(l1.b, l1.a), q = sub(l2.b, l2.a), den = cross(r, q); if (Math.abs(den) < EPS * (len(r) * len(q) || 1)) return null;
  const X = add(l1.a, mul(r, cross(sub(l2.a, l1.a), q) / den)); const d1 = norm(r), d2 = norm(q);
  const u1 = dot(sub(p1, X), d1) >= 0 ? d1 : mul(d1, -1), u2 = dot(sub(p2, X), d2) >= 0 ? d2 : mul(d2, -1);
  const far = (l: Line, u: V) => (dot(sub(l.a, X), u) >= dot(sub(l.b, X), u) ? l.a : l.b);
  return { X, u1, u2, f1: far(l1, u1), f2: far(l2, u2) };
}
/** Round the corner between two lines with radius r (r = 0 makes a sharp corner). Picks say which sides to keep. */
export function filletLines(l1: Line, l2: Line, r: number, p1: V, p2: V): { l1: Line; l2: Line; arc: Arc | null } | string {
  const k = corner(l1, l2, p1, p2); if (!k) return "Lines are parallel";
  if (r <= 0) return { l1: { ...l1, a: k.f1, b: k.X }, l2: { ...l2, a: k.X, b: k.f2 }, arc: null };
  const th = Math.acos(Math.max(-1, Math.min(1, dot(k.u1, k.u2)))); if (th < 1e-6 || Math.PI - th < 1e-6) return "Lines are parallel";
  const t = r / Math.tan(th / 2); if (dot(sub(k.f1, k.X), k.u1) < t - 1e-9 || dot(sub(k.f2, k.X), k.u2) < t - 1e-9) return "Radius is too large for these lines";
  const T1 = add(k.X, mul(k.u1, t)), T2 = add(k.X, mul(k.u2, t)), C = add(k.X, mul(norm(add(k.u1, k.u2)), r / Math.sin(th / 2)));
  let a0 = ang(sub(T1, C)), a1 = ang(sub(T2, C)); if (normAng(a1 - a0) > Math.PI) [a0, a1] = [a1, a0];
  return { l1: { ...l1, a: k.f1, b: T1 }, l2: { ...l2, a: T2, b: k.f2 }, arc: { id: eid(), layer: l1.layer, color: l1.color, t: "arc", c: C, r, a0, a1 } };
}
/** Bevel the corner: distance d1 along the first line and d2 along the second from their intersection. */
export function chamferLines(l1: Line, l2: Line, d1: number, d2: number, p1: V, p2: V): { l1: Line; l2: Line; edge: Line } | string {
  const k = corner(l1, l2, p1, p2); if (!k) return "Lines are parallel";
  if (dot(sub(k.f1, k.X), k.u1) < d1 - 1e-9 || dot(sub(k.f2, k.X), k.u2) < d2 - 1e-9) return "Chamfer distance is too large for these lines";
  const T1 = add(k.X, mul(k.u1, d1)), T2 = add(k.X, mul(k.u2, d2));
  return { l1: { ...l1, a: k.f1, b: T1 }, l2: { ...l2, a: T2, b: k.f2 }, edge: { id: eid(), layer: l1.layer, color: l1.color, t: "line", a: T1, b: T2 } };
}
