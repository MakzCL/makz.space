// TROTAN geometry core. Units: millimetres, y axis pointing down, origin top-left (like SVG).
// Every shape is real geometry: rectangles, ellipses, polygons and text all convert to cubic
// Bézier sub-paths, and every operation (transform, boolean, offset, export) works on those.

export type Vec = [number, number];
/** Affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG order). */
export type Mat = [number, number, number, number, number, number];
export interface Seg { k: "L" | "C"; p: Vec; c1?: Vec; c2?: Vec }
export interface SubPath { start: Vec; segs: Seg[]; closed: boolean }
export interface Polyline { pts: Vec[]; closed: boolean }

export type OpType = "cut" | "score" | "vengrave" | "raster" | "mark" | "kiss" | "none";
export const OP_TYPES: OpType[] = ["cut", "kiss", "score", "vengrave", "mark", "raster", "none"];
export const OP_LABEL: Record<OpType, string> = {
  cut: "Cut", kiss: "Kiss cut", score: "Score", vengrave: "Vector engrave", mark: "Mark", raster: "Raster engrave", none: "Not processed",
};
/** Optional per-layer parameter overrides (used by material test cards: one setting per cell). */
export interface LayerParams { power?: number; speed?: number; passes?: number; freq?: number | null; focus?: number; dpi?: number; air?: boolean }
export interface Layer { id: string; name: string; color: string; visible: boolean; locked: boolean; op: OpType; params?: LayerParams }

interface Base { id: string; layer: string; name?: string; m: Mat; locked?: boolean; hidden?: boolean; op?: OpType | null }
export type PathObj = Base & { kind: "path"; paths: SubPath[] };
export type RectObj = Base & { kind: "rect"; w: number; h: number; r: number };
export type EllipseObj = Base & { kind: "ellipse"; rx: number; ry: number };
export type PolygonObj = Base & { kind: "polygon"; n: number; r: number; star: number };
/** Text keeps its string and the outline (in local units) produced from the font, so it is cuttable geometry. */
export type TextObj = Base & { kind: "text"; text: string; size: number; font: string; paths: SubPath[] };
/** Raster image placed at w × h mm. src is a data URL (kept with the project, not only in the browser). */
export type ImageObj = Base & { kind: "image"; src: string; w: number; h: number; pxW: number; pxH: number; /** engraving image processing (dither mode, brightness…); absent = defaults */ proc?: import("./raster").RasterProc };
export type GroupObj = Base & { kind: "group"; children: Obj[] };
export type Obj = PathObj | RectObj | EllipseObj | PolygonObj | TextObj | ImageObj | GroupObj;

export interface Guide { axis: "x" | "y"; at: number }
export interface Doc {
  format: "trotan"; version: 1; units: "mm";
  width: number; height: number;
  layers: Layer[]; objects: Obj[]; guides: Guide[];
}

export const EPS = 1e-9;
export const I: Mat = [1, 0, 0, 1, 0, 0];

/* ------------------------------------------------------------------ matrices -- */
export function mul(m: Mat, n: Mat): Mat { // m ∘ n (apply n first, then m)
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
export function apply(m: Mat, p: Vec): Vec { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
export function inv(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < EPS) throw new Error("Matrix cannot be inverted (zero size)");
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0];
export const rotate = (deg: number): Mat => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
/** Transform about a point: translate(p) · m · translate(−p). */
export const about = (m: Mat, p: Vec): Mat => mul(translate(p[0], p[1]), mul(m, translate(-p[0], -p[1])));
/** Rotation angle in degrees and scale factors of a matrix (for numeric display). */
export function decompose(m: Mat) {
  const sx = Math.hypot(m[0], m[1]), rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const det = m[0] * m[3] - m[1] * m[2];
  return { rot, sx, sy: det / (sx || 1), skewFree: Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 };
}

/* --------------------------------------------------------------------- ids -- */
let idn = 0;
export const uid = (p = "o") => `${p}${Date.now().toString(36)}${(idn++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* --------------------------------------------------------------- sub-paths -- */
export const clonePaths = (ps: SubPath[]): SubPath[] => ps.map((s) => ({ start: [...s.start] as Vec, closed: s.closed, segs: s.segs.map((g) => ({ k: g.k, p: [...g.p] as Vec, ...(g.c1 ? { c1: [...g.c1] as Vec, c2: [...g.c2!] as Vec } : {}) })) }));
export function transformPaths(ps: SubPath[], m: Mat): SubPath[] {
  return ps.map((s) => ({ start: apply(m, s.start), closed: s.closed, segs: s.segs.map((g) => g.k === "C" ? { k: "C", c1: apply(m, g.c1!), c2: apply(m, g.c2!), p: apply(m, g.p) } : { k: "L", p: apply(m, g.p) }) }));
}
export function reversePath(s: SubPath): SubPath {
  const pts: Vec[] = [s.start, ...s.segs.map((g) => g.p)];
  const segs: Seg[] = [];
  for (let i = s.segs.length - 1; i >= 0; i--) {
    const g = s.segs[i];
    segs.push(g.k === "C" ? { k: "C", c1: g.c2!, c2: g.c1!, p: pts[i] } : { k: "L", p: pts[i] });
  }
  return { start: pts[pts.length - 1], segs, closed: s.closed };
}

/** Circle/ellipse arc approximation constant. */
const KAPPA = 0.5522847498307936;
export function rectPaths(w: number, h: number, r = 0): SubPath[] {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r < EPS) return [{ start: [0, 0], closed: true, segs: [{ k: "L", p: [w, 0] }, { k: "L", p: [w, h] }, { k: "L", p: [0, h] }, { k: "L", p: [0, 0] }] }];
  const k = r * (1 - KAPPA);
  return [{ start: [r, 0], closed: true, segs: [
    { k: "L", p: [w - r, 0] }, { k: "C", c1: [w - k, 0], c2: [w, k], p: [w, r] },
    { k: "L", p: [w, h - r] }, { k: "C", c1: [w, h - k], c2: [w - k, h], p: [w - r, h] },
    { k: "L", p: [r, h] }, { k: "C", c1: [k, h], c2: [0, h - k], p: [0, h - r] },
    { k: "L", p: [0, r] }, { k: "C", c1: [0, k], c2: [k, 0], p: [r, 0] },
  ] }];
}
export function ellipsePaths(rx: number, ry: number): SubPath[] {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return [{ start: [rx, 0], closed: true, segs: [
    { k: "C", c1: [rx, ky], c2: [kx, ry], p: [0, ry] }, { k: "C", c1: [-kx, ry], c2: [-rx, ky], p: [-rx, 0] },
    { k: "C", c1: [-rx, -ky], c2: [-kx, -ry], p: [0, -ry] }, { k: "C", c1: [kx, -ry], c2: [rx, -ky], p: [rx, 0] },
  ] }];
}
export function polygonPaths(n: number, r: number, star = 0): SubPath[] {
  n = Math.max(3, Math.round(n));
  const pts: Vec[] = [];
  const count = star > 0 ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const rr = star > 0 && i % 2 ? r * star : r;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    pts.push([rr * Math.cos(a), rr * Math.sin(a)]);
  }
  return [{ start: pts[0], closed: true, segs: [...pts.slice(1), pts[0]].map((p) => ({ k: "L" as const, p })) }];
}
/** Geometry of an object in its own (local) coordinates. Images and groups have none here. */
export function localPaths(o: Obj): SubPath[] {
  switch (o.kind) {
    case "path": return o.paths;
    case "rect": return rectPaths(o.w, o.h, o.r);
    case "ellipse": return ellipsePaths(o.rx, o.ry);
    case "polygon": return polygonPaths(o.n, o.r, o.star);
    case "text": return o.paths;
    case "image": return rectPaths(o.w, o.h);
    case "group": return [];
  }
}
/** Leaf objects with their world matrix (groups flattened). */
export function leaves(objs: Obj[], parent: Mat = I, out: { o: Obj; m: Mat; top: Obj }[] = [], top?: Obj): { o: Obj; m: Mat; top: Obj }[] {
  for (const o of objs) {
    const m = mul(parent, o.m);
    if (o.kind === "group") leaves(o.children, m, out, top ?? o);
    else out.push({ o, m, top: top ?? o });
  }
  return out;
}
export function worldPaths(o: Obj, parent: Mat = I): SubPath[] {
  if (o.kind === "group") return leaves(o.children, mul(parent, o.m)).filter((l) => l.o.kind !== "image").flatMap((l) => transformPaths(localPaths(l.o), l.m));
  return transformPaths(localPaths(o), mul(parent, o.m));
}

/* ----------------------------------------------------------------- flatten -- */
function bez(p0: Vec, c1: Vec, c2: Vec, p: Vec, t: number): Vec {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1]];
}
/** Cubic → line segments; the number of steps keeps the chord error under tol (mm). */
export function flattenCubic(p0: Vec, c1: Vec, c2: Vec, p: Vec, tol: number, out: Vec[]) {
  const dd = Math.max(Math.hypot(p0[0] - 2 * c1[0] + c2[0], p0[1] - 2 * c1[1] + c2[1]), Math.hypot(c1[0] - 2 * c2[0] + p[0], c1[1] - 2 * c2[1] + p[1]));
  const n = Math.max(1, Math.min(512, Math.ceil(Math.sqrt((3 * dd) / (4 * Math.max(tol, 1e-6))))));
  for (let i = 1; i <= n; i++) out.push(bez(p0, c1, c2, p, i / n));
}
export function flatten(ps: SubPath[], tol = 0.01): Polyline[] {
  return ps.map((s) => {
    const pts: Vec[] = [s.start];
    let cur = s.start;
    for (const g of s.segs) {
      if (g.k === "C") flattenCubic(cur, g.c1!, g.c2!, g.p, tol, pts); else pts.push(g.p);
      cur = g.p;
    }
    if (s.closed && pts.length > 1 && dist(pts[0], pts[pts.length - 1]) < 1e-9) pts.pop();
    return { pts, closed: s.closed };
  });
}
export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function polyLength(p: Polyline) {
  let L = 0; for (let i = 1; i < p.pts.length; i++) L += dist(p.pts[i - 1], p.pts[i]);
  if (p.closed && p.pts.length > 1) L += dist(p.pts[p.pts.length - 1], p.pts[0]);
  return L;
}
/** Signed area (positive = clockwise on screen, since y points down). */
export function polyArea(pts: Vec[]) {
  let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]);
  return a / 2;
}
export function pointInPoly(p: Vec, pts: Vec[]) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i][1] > p[1]) !== (pts[j][1] > p[1]) && p[0] < ((pts[j][0] - pts[i][0]) * (p[1] - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
  }
  return c;
}

/* -------------------------------------------------------------------- bbox -- */
export interface Box { x: number; y: number; w: number; h: number }
export const emptyBox = (): Box => ({ x: Infinity, y: Infinity, w: -Infinity, h: -Infinity });
export function boxOfPoints(pts: Vec[]): Box | null {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** Exact bounds: cubic extrema are found analytically (no flattening error). */
export function boxOfPaths(ps: SubPath[]): Box | null {
  const pts: Vec[] = [];
  for (const s of ps) {
    pts.push(s.start); let cur = s.start;
    for (const g of s.segs) {
      pts.push(g.p);
      if (g.k === "C") for (const t of cubicExtrema(cur, g.c1!, g.c2!, g.p)) pts.push(bez(cur, g.c1!, g.c2!, g.p, t));
      cur = g.p;
    }
  }
  return boxOfPoints(pts);
}
function cubicExtrema(p0: Vec, c1: Vec, c2: Vec, p: Vec): number[] {
  const ts: number[] = [];
  for (const i of [0, 1]) {
    const a = -p0[i] + 3 * c1[i] - 3 * c2[i] + p[i], b = 2 * (p0[i] - 2 * c1[i] + c2[i]), c = c1[i] - p0[i];
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); continue; }
    const d = b * b - 4 * a * c; if (d < 0) continue;
    const s = Math.sqrt(d); ts.push((-b + s) / (2 * a), (-b - s) / (2 * a));
  }
  return ts.filter((t) => t > 0 && t < 1);
}
export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
export function objBox(o: Obj, parent: Mat = I): Box | null {
  if (o.kind === "group") { let b: Box | null = null; for (const c of o.children) b = unionBox(b, objBox(c, mul(parent, o.m))); return b; }
  return boxOfPaths(transformPaths(localPaths(o), mul(parent, o.m)));
}
export function objsBox(objs: Obj[]): Box | null { let b: Box | null = null; for (const o of objs) b = unionBox(b, objBox(o)); return b; }

/* --------------------------------------------------------- SVG path data -- */
const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
/** Parses SVG path data (all commands, arcs converted to cubics). */
export function parsePathData(d: string): SubPath[] {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: SubPath[] = [];
  let i = 0, cmd = "", cur: Vec = [0, 0], startP: Vec = [0, 0], sp: SubPath | null = null;
  let lastC: Vec | null = null, lastQ: Vec | null = null;
  const num = () => { const v = Number(toks[i++]); if (!Number.isFinite(v)) throw new Error("Invalid number in path data"); return v; };
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  const ensure = () => { if (!sp) { sp = { start: [...cur] as Vec, segs: [], closed: false }; out.push(sp); } return sp; };
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) throw new Error("Path data must start with a command");
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const rx = (v: number) => (rel ? cur[0] + v : v), ry = (v: number) => (rel ? cur[1] + v : v);
    switch (C) {
      case "M": { const x = rx(num()), y = ry(num()); cur = [x, y]; startP = [x, y]; sp = { start: [x, y], segs: [], closed: false }; out.push(sp); cmd = rel ? "l" : "L"; lastC = lastQ = null; continue; }
      case "L": { const p: Vec = [rx(num()), ry(num())]; ensure().segs.push({ k: "L", p }); cur = p; lastC = lastQ = null; break; }
      case "H": { const p: Vec = [rel ? cur[0] + num() : num(), cur[1]]; ensure().segs.push({ k: "L", p }); cur = p; lastC = lastQ = null; break; }
      case "V": { const p: Vec = [cur[0], rel ? cur[1] + num() : num()]; ensure().segs.push({ k: "L", p }); cur = p; lastC = lastQ = null; break; }
      case "C": { const c1: Vec = [rx(num()), ry(num())], c2: Vec = [rx(num()), ry(num())], p: Vec = [rx(num()), ry(num())]; ensure().segs.push({ k: "C", c1, c2, p }); cur = p; lastC = c2; lastQ = null; break; }
      case "S": { const c1: Vec = lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : [...cur] as Vec; const c2: Vec = [rx(num()), ry(num())], p: Vec = [rx(num()), ry(num())]; ensure().segs.push({ k: "C", c1, c2, p }); cur = p; lastC = c2; lastQ = null; break; }
      case "Q": { const q: Vec = [rx(num()), ry(num())], p: Vec = [rx(num()), ry(num())]; ensure().segs.push(quadToCubic(cur, q, p)); cur = p; lastQ = q; lastC = null; break; }
      case "T": { const q: Vec = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : [...cur] as Vec; const p: Vec = [rx(num()), ry(num())]; ensure().segs.push(quadToCubic(cur, q, p)); cur = p; lastQ = q; lastC = null; break; }
      case "A": { const ax = num(), ay = num(), rotDeg = num(), large = num(), sweep = num(); const p: Vec = [rx(num()), ry(num())]; for (const g of arcToCubics(cur, ax, ay, rotDeg, !!large, !!sweep, p)) ensure().segs.push(g); cur = p; lastC = lastQ = null; break; }
      case "Z": { const s = ensure(); if (dist(cur, s.start) > 1e-9) s.segs.push({ k: "L", p: [...s.start] as Vec }); s.closed = true; cur = [...startP] as Vec; sp = null; lastC = lastQ = null; cmd = ""; continue; }
      default: throw new Error(`Unsupported path command ${cmd}`);
    }
    if (!isNum()) cmd = i < toks.length ? "" : cmd;
  }
  return out.filter((s) => s.segs.length > 0);
}
function quadToCubic(p0: Vec, q: Vec, p: Vec): Seg {
  return { k: "C", c1: [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])], c2: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p };
}
/** SVG elliptical arc (endpoint form) → cubic segments, ≤ 90° each. */
export function arcToCubics(p0: Vec, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean, p: Vec): Seg[] {
  if (dist(p0, p) < 1e-12) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-12 || ry < 1e-12) return [{ k: "L", p }];
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0[0] - p[0]) / 2, dy = (p0[1] - p[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p[0]) / 2, cy = sin * cx1 + cos * cy1 + (p0[1] + p[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2))), step = dt / n;
  const segs: Seg[] = [];
  const pt = (t: number): Vec => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t: number): Vec => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let k = 0; k < n; k++) {
    const a = t1 + k * step, b = a + step, al = (4 / 3) * Math.tan(step / 4);
    const pa = pt(a), pb = k === n - 1 ? p : pt(b), da = der(a), db = der(b);
    segs.push({ k: "C", c1: [pa[0] + al * da[0], pa[1] + al * da[1]], c2: [pb[0] - al * db[0], pb[1] - al * db[1]], p: pb });
  }
  return segs;
}
const f = (n: number) => { const s = (Math.round(n * 10000) / 10000).toString(); return s === "-0" ? "0" : s; };
export function pathData(ps: SubPath[]): string {
  return ps.map((s) => `M${f(s.start[0])} ${f(s.start[1])}` + s.segs.map((g, i) => {
    if (s.closed && i === s.segs.length - 1 && g.k === "L" && dist(g.p, s.start) < 1e-9) return "";
    return g.k === "C" ? `C${f(g.c1![0])} ${f(g.c1![1])} ${f(g.c2![0])} ${f(g.c2![1])} ${f(g.p[0])} ${f(g.p[1])}` : `L${f(g.p[0])} ${f(g.p[1])}`;
  }).join("") + (s.closed ? "Z" : "")).join("");
}
export { NUM };

/* --------------------------------------------------------- doc helpers -- */
export function newDoc(w = 600, h = 400): Doc {
  return { format: "trotan", version: 1, units: "mm", width: w, height: h, guides: [],
    layers: [
      { id: "L-cut", name: "Cut", color: "#ff3b30", visible: true, locked: false, op: "cut" },
      { id: "L-engrave", name: "Engrave", color: "#2f6bff", visible: true, locked: false, op: "raster" },
      { id: "L-score", name: "Score", color: "#21b573", visible: true, locked: false, op: "score" },
    ],
    objects: [] };
}
export function findObj(objs: Obj[], id: string): Obj | null {
  for (const o of objs) { if (o.id === id) return o; if (o.kind === "group") { const f2 = findObj(o.children, id); if (f2) return f2; } }
  return null;
}
/** Operation that applies to an object: its own override, else its layer's. */
export function opOf(doc: Doc, o: Obj): OpType { return o.op ?? doc.layers.find((l) => l.id === o.layer)?.op ?? "none"; }
/** Convert any vector object into an editable path (keeps its matrix). */
export function toPathObj(o: Obj): PathObj | null {
  if (o.kind === "image" || o.kind === "group") return null;
  return { id: o.id, layer: o.layer, name: o.name, m: o.m, locked: o.locked, hidden: o.hidden, op: o.op, kind: "path", paths: clonePaths(localPaths(o)) };
}
/** Bake the matrix into the geometry (path becomes identity-transformed). */
export function bake(o: PathObj): PathObj { return { ...o, m: [...I] as Mat, paths: transformPaths(o.paths, o.m) }; }
