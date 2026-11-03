// Laser job model: operation parameters, machine capabilities, validation, toolpath ordering,
// time estimates (always labelled as estimates), kerf, common-line cutting, arrays and nesting.
import { I, apply, boxOfPaths, dist, flatten, leaves, localPaths, mul, objsBox, opOf, polyArea, polyLength, transformPaths, type Box, type Doc, type Mat, type OpType, type Vec } from "./core";
import { depths, duplicateSegments, kerfCompensate, openContours, selfIntersections } from "./ops";

/* ---------------------------------------------------------- capabilities -- */
export interface MachineCaps {
  bedW: number; bedH: number;                 // mm
  laserType: "co2" | "fiber" | "diode";
  maxPowerW: number;                          // W
  maxSpeed: number;                           // mm/s, vector
  maxRasterSpeed: number;                     // mm/s
  accel: number;                              // mm/s², for estimates
  travelSpeed: number;                        // mm/s
  ops: OpType[];                              // operations the controller supports
  freq: { min: number; max: number } | null;  // Hz (pulse frequency), null = not adjustable
  dpi: number[];                              // raster resolutions offered
  focus: { min: number; max: number };        // mm offset range
  airAssist: boolean;
  maxPasses: number;
}
export interface OpParams {
  power: number;      // % of maxPowerW
  speed: number;      // mm/s
  freq: number | null;// Hz
  passes: number;
  focus: number;      // mm
  dpi: number;        // raster only
  air: boolean;
  direction: "down" | "up"; // raster
  order: number;      // processing order (lower first); 0 = standard sequence (raster → … → cut)
}
export const DEFAULT_ORDER: Record<OpType, number> = { raster: 1, mark: 2, vengrave: 3, score: 4, kiss: 5, cut: 6, none: 99 };
export const UNITS = { power: "%", speed: "mm/s", freq: "Hz", passes: "×", focus: "mm", dpi: "DPI", lineSpacing: "mm" } as const;
export const lineSpacing = (dpi: number) => 25.4 / dpi;

export interface Issue { level: "error" | "warning" | "info"; code: string; msg: string; ids?: string[]; at?: Vec }
/** Every parameter is checked against what the machine says it can do. Nothing is clamped silently. */
export function checkParams(op: OpType, p: OpParams, caps: MachineCaps): Issue[] {
  const e: Issue[] = []; const L = (m: string) => e.push({ level: "error", code: "param", msg: `${opLabel(op)}: ${m}` });
  if (!caps.ops.includes(op)) L("this machine does not support this operation");
  if (!(p.power >= 0 && p.power <= 100)) L(`power must be 0–100 ${UNITS.power}`);
  const vmax = op === "raster" ? caps.maxRasterSpeed : caps.maxSpeed;
  if (!(p.speed > 0 && p.speed <= vmax)) L(`speed must be above 0 and at most ${vmax} ${UNITS.speed}`);
  if (!Number.isInteger(p.passes) || p.passes < 1 || p.passes > caps.maxPasses) L(`passes must be 1–${caps.maxPasses}`);
  if (p.focus < caps.focus.min || p.focus > caps.focus.max) L(`focus offset must be ${caps.focus.min}–${caps.focus.max} ${UNITS.focus}`);
  if (p.freq != null) { if (!caps.freq) L("this machine has no adjustable frequency"); else if (p.freq < caps.freq.min || p.freq > caps.freq.max) L(`frequency must be ${caps.freq.min}–${caps.freq.max} ${UNITS.freq}`); }
  if (op === "raster" && !caps.dpi.includes(p.dpi)) L(`resolution must be one of ${caps.dpi.join(", ")} ${UNITS.dpi}`);
  if (p.air && !caps.airAssist) L("this machine has no air assist");
  return e;
}
const opLabel = (o: OpType) => ({ cut: "Cut", kiss: "Kiss cut", score: "Score", vengrave: "Vector engrave", mark: "Mark", raster: "Raster engrave", none: "None" }[o]);

/* ------------------------------------------------------------- placement -- */
/** One copy of a design on the bed. m maps design coordinates (mm) to bed coordinates (mm). */
export interface Placement { id: string; m: Mat }
export function designBox(doc: Doc): Box | null { return objsBox(doc.objects.filter((o) => !o.hidden && opOf(doc, o) !== "none")) ?? objsBox(doc.objects); }
export function arrayPlacements(doc: Doc, rows: number, cols: number, gapX: number, gapY: number, origin: Vec = [0, 0]): Placement[] {
  const b = designBox(doc); if (!b) return [];
  const out: Placement[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ id: `a${r}-${c}`, m: [1, 0, 0, 1, origin[0] - b.x + c * (b.w + gapX), origin[1] - b.y + r * (b.h + gapY)] });
  return out;
}
export function placementBox(doc: Doc, p: Placement): Box | null {
  return boxOfPaths(leaves(doc.objects.filter((o) => !o.hidden)).flatMap(({ o, m }) => transformPaths(localPaths(o), mul(p.m, m))));
}

/** Rectangle nesting (MaxRects, best-short-side fit) of `count` copies, optionally rotated 90°. */
export function nestRects(doc: Doc, count: number, sheet: { w: number; h: number }, margin: number, spacing: number, allowRotate = true): { placements: Placement[]; unplaced: number } {
  const b = designBox(doc); if (!b) return { placements: [], unplaced: count };
  const W = sheet.w - 2 * margin + spacing, H = sheet.h - 2 * margin + spacing;
  const iw = b.w + spacing, ih = b.h + spacing;
  let free: Box[] = [{ x: 0, y: 0, w: W, h: H }];
  const placements: Placement[] = [];
  for (let n = 0; n < count; n++) {
    let best: { r: Box; rot: boolean; score: number } | null = null;
    for (const f of free) for (const rot of allowRotate ? [false, true] : [false]) {
      const w = rot ? ih : iw, h = rot ? iw : ih;
      if (w <= f.w + 1e-9 && h <= f.h + 1e-9) { const score = Math.min(f.w - w, f.h - h); if (!best || score < best.score) best = { r: { x: f.x, y: f.y, w, h }, rot, score }; }
    }
    if (!best) return { placements, unplaced: count - n };
    const { r, rot } = best;
    // design bbox → placed rectangle (rotation by 90° about the box origin)
    const m: Mat = rot ? [0, 1, -1, 0, margin + r.x + b.y + b.h, margin + r.y - b.x] : [1, 0, 0, 1, margin + r.x - b.x, margin + r.y - b.y];
    placements.push({ id: `n${n}`, m });
    const next: Box[] = [];
    for (const f of free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { next.push(f); continue; }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    free = next.filter((a, i) => !next.some((c, j) => j !== i && a.x >= c.x && a.y >= c.y && a.x + a.w <= c.x + c.w && a.y + a.h <= c.y + c.h && (j < i || a.w !== c.w || a.h !== c.h || a.x !== c.x || a.y !== c.y)));
  }
  return { placements, unplaced: 0 };
}

/* -------------------------------------------------------------- toolpath -- */
export interface PathItem { op: OpType; obj: string; pts: Vec[]; closed: boolean; pass: number; length: number }
export interface RasterItem { op: "raster"; obj: string; box: Box; pass: number }
export interface Toolpath { items: (PathItem | RasterItem)[]; travel: { from: Vec; to: Vec }[]; issues: Issue[] }

export interface BuildOpts { ops: Partial<Record<OpType, OpParams>>; kerf: number; commonLine: boolean; tol?: number }
/** All copies → ordered toolpath: raster first, then marks/engraves/scores, cuts last with holes before
 * outlines; nearest-neighbour within each step; passes repeat each step. */
export function buildToolpath(doc: Doc, placements: Placement[], o: BuildOpts): Toolpath {
  const tol = o.tol ?? 0.02;
  const groups = new Map<OpType, { obj: string; pts: Vec[]; closed: boolean }[]>();
  const rasters: { obj: string; box: Box }[] = [];
  for (const pl of placements) {
    for (const { o: ob, m, top } of leaves(doc.objects.filter((x) => !x.hidden))) {
      const op = ob.op ?? top.op ?? opOf(doc, top.kind === "group" ? ob : top);
      if (op === "none") continue;
      const world = mul(pl.m, m);
      const paths = transformPaths(localPaths(ob), world);
      if (op === "raster" || ob.kind === "image") { const b = boxOfPaths(paths); if (b) rasters.push({ obj: ob.id, box: b }); continue; }
      const arr = groups.get(op) ?? []; groups.set(op, arr);
      for (const p of flatten(paths, tol)) if (p.pts.length > 1) arr.push({ obj: ob.id, pts: p.pts, closed: p.closed });
    }
  }
  const issues: Issue[] = [];
  // kerf & common-line on cuts
  const cut = groups.get("cut");
  if (cut?.length) {
    if (o.kerf > 0) {
      const closed = cut.filter((c) => c.closed), open = cut.filter((c) => !c.closed);
      const comp = kerfCompensate(closed.map((c) => c.pts), o.kerf);
      groups.set("cut", [...comp.map((pts, i) => ({ obj: closed[Math.min(i, closed.length - 1)]?.obj ?? "", pts, closed: true })), ...open]);
      if (open.length) issues.push({ level: "warning", code: "kerf_open", msg: "Kerf compensation only applies to closed outlines; open cuts are cut as drawn." });
    }
    if (o.commonLine) {
      const before = (groups.get("cut") ?? []).reduce((s, c) => s + polyLength({ pts: c.pts, closed: c.closed }), 0);
      groups.set("cut", removeSharedEdges(groups.get("cut")!));
      const after = (groups.get("cut") ?? []).reduce((s, c) => s + polyLength({ pts: c.pts, closed: c.closed }), 0);
      if (before - after > 0.01) issues.push({ level: "info", code: "common_line", msg: `Common-line cutting removed ${(before - after).toFixed(1)} mm of repeated cuts.` });
    }
  }
  const items: Toolpath["items"] = [];
  const travel: Toolpath["travel"] = [];
  let head: Vec = [0, 0];
  const steps = [...new Set<OpType>([...groups.keys(), ...(rasters.length ? ["raster" as OpType] : [])])]
    .sort((a, b) => (o.ops[a]?.order || DEFAULT_ORDER[a]) - (o.ops[b]?.order || DEFAULT_ORDER[b])); // order 0 = standard sequence
  for (const op of steps) {
    const passes = Math.max(1, o.ops[op]?.passes ?? 1);
    for (let pass = 1; pass <= passes; pass++) {
      if (op === "raster") {
        for (const r of [...rasters].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
          const s: Vec = [r.box.x, r.box.y]; travel.push({ from: lastEnd(items) ?? [0, 0], to: s }); items.push({ op: "raster", obj: r.obj, box: r.box, pass }); head = [r.box.x + r.box.w, r.box.y + r.box.h];
        }
        continue;
      }
      let rest = [...groups.get(op)!];
      if (op === "cut") { // holes (deeper) first, then outlines; nearest neighbour inside each depth
        const closedIdx = rest.map((c, i) => (c.closed ? i : -1)).filter((i) => i >= 0);
        const dep = depths(closedIdx.map((i) => rest[i].pts));
        const depthOf = new Map(closedIdx.map((i, k) => [rest[i], dep[k]]));
        const levels = [...new Set(dep)].sort((a, b) => b - a);
        const ordered: typeof rest = [];
        for (const lv of levels) ordered.push(...nearest(rest.filter((c) => depthOf.get(c) === lv), head, (h) => { head = h; }));
        ordered.push(...nearest(rest.filter((c) => !c.closed), head, (h) => { head = h; }));
        rest = ordered;
      } else rest = nearest(rest, head, (h) => { head = h; });
      for (const c of rest) {
        travel.push({ from: lastEnd(items) ?? [0, 0], to: c.pts[0] });
        items.push({ op, obj: c.obj, pts: c.pts, closed: c.closed, pass, length: polyLength({ pts: c.pts, closed: c.closed }) });
        head = c.closed ? c.pts[0] : c.pts[c.pts.length - 1];
      }
    }
  }
  return { items, travel: travel.filter((t) => dist(t.from, t.to) > 1e-6), issues };
}
const lastEnd = (items: Toolpath["items"]): Vec | null => { const it = items[items.length - 1]; if (!it) return null; if (it.op === "raster") return [(it as RasterItem).box.x + (it as RasterItem).box.w, (it as RasterItem).box.y + (it as RasterItem).box.h]; const p = it as PathItem; return p.closed ? p.pts[0] : p.pts[p.pts.length - 1]; };
/** Greedy nearest-neighbour ordering; closed paths may start at their nearest vertex, open paths may be reversed. */
function nearest<T extends { pts: Vec[]; closed: boolean }>(list: T[], from: Vec, setHead: (h: Vec) => void): T[] {
  const left = [...list], out: T[] = []; let h = from;
  while (left.length) {
    let bi = 0, bd = Infinity, bk = 0, rev = false;
    for (let i = 0; i < left.length; i++) {
      const c = left[i];
      if (c.closed) { const step = Math.max(1, Math.floor(c.pts.length / 64)); for (let k = 0; k < c.pts.length; k += step) { const d = dist(h, c.pts[k]); if (d < bd) { bd = d; bi = i; bk = k; rev = false; } } }
      else { const d0 = dist(h, c.pts[0]), d1 = dist(h, c.pts[c.pts.length - 1]); if (d0 < bd) { bd = d0; bi = i; bk = 0; rev = false; } if (d1 < bd) { bd = d1; bi = i; bk = 0; rev = true; } }
    }
    const c = left.splice(bi, 1)[0];
    const pts = c.closed ? [...c.pts.slice(bk), ...c.pts.slice(0, bk)] : rev ? [...c.pts].reverse() : c.pts;
    out.push({ ...c, pts }); h = c.closed ? pts[0] : pts[pts.length - 1];
  }
  setHead(h); return out;
}
/** Common-line cutting: an edge shared by two parts is cut once. Remaining edges are re-chained. */
export function removeSharedEdges(list: { obj: string; pts: Vec[]; closed: boolean }[], tol = 0.01): { obj: string; pts: Vec[]; closed: boolean }[] {
  const q = (v: Vec) => `${Math.round(v[0] / tol)},${Math.round(v[1] / tol)}`;
  const seen = new Set<string>(); const segs: { obj: string; a: Vec; b: Vec }[] = [];
  let removed = 0;
  for (const c of list) {
    const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
    for (let i = 1; i < pts.length; i++) {
      const ka = q(pts[i - 1]), kb = q(pts[i]), k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (ka === kb) continue;
      if (seen.has(k)) { removed++; continue; }
      seen.add(k); segs.push({ obj: c.obj, a: pts[i - 1], b: pts[i] });
    }
  }
  if (!removed) return list;
  // chain segments back into polylines
  const out: { obj: string; pts: Vec[]; closed: boolean }[] = [];
  const used = new Array(segs.length).fill(false);
  const byStart = new Map<string, number[]>(); segs.forEach((s, i) => { const k = q(s.a); byStart.set(k, [...(byStart.get(k) ?? []), i]); });
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = true;
    const pts: Vec[] = [segs[i].a, segs[i].b]; let k = q(segs[i].b);
    for (;;) { const nx = (byStart.get(k) ?? []).find((j) => !used[j]); if (nx === undefined) break; used[nx] = true; pts.push(segs[nx].b); k = q(segs[nx].b); }
    const closed = pts.length > 3 && q(pts[0]) === q(pts[pts.length - 1]);
    out.push({ obj: segs[i].obj, pts: closed ? pts.slice(0, -1) : pts, closed });
  }
  return out;
}

/* -------------------------------------------------------------- estimate -- */
export interface Estimate { seconds: number; byOp: Partial<Record<OpType, number>>; travel: number; cutLength: number; label: "estimate" }
/** Physics-based estimate: vector moves with acceleration ramps, raster lines with overscan, travel
 * at the travel speed. It is an estimate until calibrated against the real machine. */
export function estimate(tp: Toolpath, ops: Partial<Record<OpType, OpParams>>, caps: MachineCaps): Estimate {
  const byOp: Partial<Record<OpType, number>> = {}; let cutLength = 0;
  const ramp = (v: number) => v / caps.accel; // time lost per stop–start at speed v
  for (const it of tp.items) {
    const p = ops[it.op]; if (!p) continue;
    let s = 0;
    if (it.op === "raster") {
      const b = (it as RasterItem).box, ls = lineSpacing(p.dpi), lines = Math.max(1, Math.ceil(b.h / ls));
      const over = (p.speed * p.speed) / (2 * caps.accel);
      s = lines * ((b.w + 2 * over) / p.speed + ramp(p.speed));
    } else {
      const pi = it as PathItem; const pts = pi.closed ? [...pi.pts, pi.pts[0]] : pi.pts;
      let corners = 0;
      for (let i = 1; i + 1 < pts.length; i++) {
        const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]], b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
        const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1]);
        if (la > 1e-9 && lb > 1e-9 && (a[0] * b[0] + a[1] * b[1]) / (la * lb) < Math.cos(Math.PI / 6)) corners++;
      }
      s = pi.length / p.speed + (corners + 1) * ramp(p.speed);
      if (it.op === "cut") cutLength += pi.length;
    }
    byOp[it.op] = (byOp[it.op] ?? 0) + s;
  }
  const travelLen = tp.travel.reduce((a, t) => a + dist(t.from, t.to), 0);
  const travel = travelLen / caps.travelSpeed + tp.travel.length * ramp(caps.travelSpeed) * 0.5;
  const seconds = Object.values(byOp).reduce((a, b) => a + (b ?? 0), 0) + travel;
  return { seconds, byOp, travel, cutLength, label: "estimate" };
}

/* ------------------------------------------------------------- validation -- */
export interface ValidateCtx {
  doc: Doc; placements: Placement[]; caps: MachineCaps; ops: Partial<Record<OpType, OpParams>>;
  sheet: { w: number; h: number; origin?: Vec } | null; margin: number;
  materialProhibited: boolean; materialName?: string;
  profileStatus: Partial<Record<OpType, "approved" | "testing" | "untested" | "retired" | "missing">>;
  hardware: boolean; // true = real machine: unverified settings block the job
}
export function validateJob(c: ValidateCtx): Issue[] {
  const out: Issue[] = [];
  const used = new Set<OpType>();
  for (const { o, top } of leaves(c.doc.objects.filter((x) => !x.hidden))) { const op = o.op ?? opOf(c.doc, top.kind === "group" ? o : top); if (op !== "none") used.add(op); }
  if (!used.size) out.push({ level: "error", code: "empty", msg: "Nothing to process — give at least one layer or object an operation." });
  if (!c.placements.length) out.push({ level: "error", code: "no_copies", msg: "Place at least one copy on the bed." });
  if (c.materialProhibited) out.push({ level: "error", code: "prohibited", msg: `${c.materialName ?? "This material"} is prohibited on this machine.` });
  for (const op of used) {
    const p = c.ops[op];
    if (!p) { out.push({ level: "error", code: "no_params", msg: `${opLabel(op)}: no parameters set.` }); continue; }
    out.push(...checkParams(op, p, c.caps));
    const st = c.profileStatus[op] ?? "missing";
    if (st !== "approved") out.push({ level: c.hardware ? "error" : "warning", code: "unverified", msg: `${opLabel(op)}: settings for this material and machine are ${st === "missing" ? "not set up" : st} — ${c.hardware ? "an authorised operator must approve them before production" : "simulation only until approved"}.` });
  }
  // bed & sheet boundaries, overlaps
  const boxes = c.placements.map((p) => ({ p, b: placementBox(c.doc, p) })).filter((x) => x.b) as { p: Placement; b: Box }[];
  for (const { p, b } of boxes) {
    if (b.x < -1e-6 || b.y < -1e-6 || b.x + b.w > c.caps.bedW + 1e-6 || b.y + b.h > c.caps.bedH + 1e-6) out.push({ level: "error", code: "bed", msg: "A copy lies outside the machine's working area.", ids: [p.id] });
    else if (c.sheet) {
      const o = c.sheet.origin ?? [0, 0], m = c.margin;
      if (b.x < o[0] + m - 1e-6 || b.y < o[1] + m - 1e-6 || b.x + b.w > o[0] + c.sheet.w - m + 1e-6 || b.y + b.h > o[1] + c.sheet.h - m + 1e-6) out.push({ level: "error", code: "sheet", msg: "A copy lies outside the material sheet (or its margin).", ids: [p.id] });
    }
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].b, b = boxes[j].b;
    if (a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6) { out.push({ level: "warning", code: "overlap", msg: "Two copies overlap.", ids: [boxes[i].p.id, boxes[j].p.id] }); }
  }
  // geometry (design level)
  const cutItems = leaves(c.doc.objects.filter((x) => !x.hidden)).filter(({ o, top }) => (o.op ?? opOf(c.doc, top.kind === "group" ? o : top)) === "cut" && o.kind !== "image");
  for (const { o, m } of cutItems) {
    const ps = transformPaths(localPaths(o), m);
    for (const g of openContours(o.id, ps)) out.push({ level: "warning", code: "open", msg: g.detail, ids: g.ids, at: g.at });
    for (const g of selfIntersections(o.id, ps)) out.push({ level: "warning", code: "self_intersection", msg: g.detail, ids: g.ids, at: g.at });
    for (const pl of flatten(ps, 0.05)) if (pl.closed && Math.abs(polyArea(pl.pts)) < 0.01) out.push({ level: "warning", code: "tiny", msg: "A cut shape is smaller than 0.01 mm² and may burn away.", ids: [o.id] });
  }
  for (const g of duplicateSegments(cutItems.map(({ o, m }) => ({ id: o.id, paths: transformPaths(localPaths(o), m) })))) out.push({ level: "warning", code: "duplicate", msg: g.detail, ids: g.ids, at: g.at });
  return out;
}
/** Area of finished parts (outlines minus holes) for all copies, mm². */
export function partsArea(doc: Doc, placements: Placement[]): number {
  let total = 0;
  const cut = leaves(doc.objects.filter((x) => !x.hidden)).filter(({ o, top }) => (o.op ?? opOf(doc, top.kind === "group" ? o : top)) === "cut");
  const polys = cut.flatMap(({ o, m }) => flatten(transformPaths(localPaths(o), m), 0.05).filter((p) => p.closed).map((p) => p.pts));
  const dep = depths(polys);
  const one = polys.reduce((s, p, i) => s + (dep[i] % 2 === 0 ? 1 : -1) * Math.abs(polyArea(p)), 0);
  total = one * placements.length;
  return Math.max(0, total);
}
export const pointOnBed = (p: Placement, v: Vec) => apply(p.m, v);
export { I };
