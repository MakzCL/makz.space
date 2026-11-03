// Autorouter: two-layer grid maze router (A*), one connection at a time, shortest first. A cell is usable for a net when
// a track centred there keeps the clearance from every copper item of other nets and from the board edge.
// Its result is checked by the same DRC as hand routing; connections it cannot route are reported, never forced.
import type { Project } from "../core/types";
import { connectivity } from "../connectivity/connectivity";
import { bbox, copperGroups, dist, insideOutline, items, outlineBox, padsOf, pid, ratsnest, segSeg, type Board, type Item, type Layer, type P, type Shape } from "./board";
import { mm } from "./footprints";

export interface RouteResult { board: Board; routed: number; failed: { net: string; from: string; to: string }[]; ms: number }

export function autoroute(b0: Board, pr: Project, opts: { grid?: number; viaCost?: number; maxPasses?: number } = {}): RouteResult {
  const t0 = Date.now(); const b: Board = structuredClone(b0); const con = connectivity(pr); const R = b.rules;
  const g = opts.grid ?? mm(0.125), viaCost = opts.viaCost ?? 12;
  const [bx0, by0, bx1, by1] = outlineBox(b); const W = Math.ceil((bx1 - bx0) / g) + 1, H = Math.ceil((by1 - by0) / g) + 1, N = W * H;
  const cx = (i: number) => bx0 + (i % W) * g, cy = (i: number) => by0 + Math.floor(i / W) * g;
  const nets = new Map<string, number>(); const nid = (n: string) => { if (!n) return -3; let v = nets.get(n); if (v === undefined) { v = nets.size; nets.set(n, v); } return v; };
  // per layer: -1 free, k = only net k may use it, -2 blocked
  const block = [new Int32Array(N).fill(-1), new Int32Array(N).fill(-1)], viaBlock = new Int32Array(N).fill(-1);
  const L = (l: Layer) => (l === "F.Cu" ? 0 : 1);
  const mark = (arr: Int32Array, i: number, k: number) => { const v = arr[i]; arr[i] = v === -1 ? k : v === k ? k : -2; };
  const edges = b.outline.map((p, i) => [p, b.outline[(i + 1) % b.outline.length]] as [P, P]);
  const trackR = R.track / 2, viaR = R.viaDia / 2, slack = g * 0.75;
  for (let i = 0; i < N; i++) { // board edge
    const p: P = [cx(i), cy(i)];
    if (!insideOutline(b, p)) { block[0][i] = block[1][i] = viaBlock[i] = -2; continue; }
    const d = Math.min(...edges.map(([a, c]) => segSeg(p, p, a, c)));
    if (d < R.edge + trackR) { block[0][i] = block[1][i] = -2; } if (d < R.edge + viaR) viaBlock[i] = -2;
  }
  const addItem = (x: Item) => {
    const k = nid(x.net); const [x0, y0, x1, y1] = bbox(x.shape); const reach = R.clearance + Math.max(trackR, viaR) + slack;
    const i0 = Math.max(0, Math.floor((x0 - reach - bx0) / g)), i1 = Math.min(W - 1, Math.ceil((x1 + reach - bx0) / g));
    const j0 = Math.max(0, Math.floor((y0 - reach - by0) / g)), j1 = Math.min(H - 1, Math.ceil((y1 + reach - by0) / g));
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      const i = j * W + ii; const d = dist({ t: "cap", a: [cx(i), cy(i)], b: [cx(i), cy(i)], r: 0 }, x.shape);
      const own = k >= 0 ? k : -2; // copper without a net blocks everyone
      if (d < R.clearance + trackR + slack) for (const l of x.layers) mark(block[L(l)], i, d <= 0 ? own : own);
      if (d < R.clearance + viaR + slack) mark(viaBlock, i, own);
    }
  };
  const pads = padsOf(b, pr, con);
  for (const x of items(b, pads)) addItem(x);
  const failed: RouteResult["failed"] = []; let routed = 0; const skip = new Set<string>();
  for (let pass = 0; pass < (opts.maxPasses ?? 400); pass++) {
    const its = items(b, padsOf(b, pr, con)); const grp = copperGroups(its);
    const wires = ratsnest(b, pr, con).filter((w) => !skip.has(`${w.net}|${w.from}|${w.to}`)).sort((a, c) => Math.hypot(a.a[0] - a.b[0], a.a[1] - a.b[1]) - Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1]));
    const w = wires[0]; if (!w) break;
    const k = nid(w.net);
    const islandOf = (at: P) => grp.get(its.find((x) => x.kind === "pad" && x.net === w.net && x.at[0] === at[0] && x.at[1] === at[1])!.id)!;
    const ga = islandOf(w.a), gb = islandOf(w.b);
    const src: number[] = [], dst = new Set<number>();
    for (const x of its) { const gx = grp.get(x.id); if (gx !== ga && gx !== gb) continue; cellsIn(x.shape, (i, ok) => { if (!ok) return; for (const l of x.layers) { const node = L(l) * N + i; if (gx === ga) src.push(node); else dst.add(node); } }); }
    function cellsIn(s: Shape, f: (i: number, ok: boolean) => void) {
      const [x0, y0, x1, y1] = bbox(s);
      for (let j = Math.max(0, Math.ceil((y0 - by0) / g)); j <= Math.min(H - 1, Math.floor((y1 - by0) / g)); j++) for (let ii = Math.max(0, Math.ceil((x0 - bx0) / g)); ii <= Math.min(W - 1, Math.floor((x1 - bx0) / g)); ii++) {
        const i = j * W + ii; f(i, dist({ t: "cap", a: [cx(i), cy(i)], b: [cx(i), cy(i)], r: 0 }, s) <= 0);
      }
    }
    const path = astar(src, dst, k);
    if (!path) { skip.add(`${w.net}|${w.from}|${w.to}`); failed.push({ net: w.net, from: w.from, to: w.to }); continue; }
    // path → tracks and vias
    const newItems: Item[] = []; let segStart = path[0];
    const emitTrack = (a: number, c: number) => { if (a === c) return; const l: Layer = a >= N ? "B.Cu" : "F.Cu"; const t = { id: pid("t"), layer: l, a: [cx(a % N), cy(a % N)] as P, b: [cx(c % N), cy(c % N)] as P, width: R.track, net: w.net };
      b.tracks.push(t); newItems.push({ id: t.id, kind: "track", layers: [l], shape: { t: "cap", a: t.a, b: t.b, r: t.width / 2 }, net: t.net, label: "", at: t.a }); };
    for (let s = 1; s < path.length; s++) {
      const p0 = path[s - 1], p1 = path[s];
      if (Math.floor(p0 / N) !== Math.floor(p1 / N)) { // layer change at the same cell → via
        emitTrack(segStart, p0); const v = { id: pid("v"), at: [cx(p0 % N), cy(p0 % N)] as P, drill: R.viaDrill, dia: R.viaDia, net: w.net };
        b.vias.push(v); newItems.push({ id: v.id, kind: "via", layers: ["F.Cu", "B.Cu"], shape: { t: "cap", a: v.at, b: v.at, r: v.dia / 2 }, net: v.net, label: "", at: v.at }); segStart = p1; continue;
      }
      const next = path[s + 1];
      const dir = (a: number, c: number) => [(c % N % W) - (a % N % W), Math.floor((c % N) / W) - Math.floor((a % N) / W)].join();
      if (next === undefined || Math.floor(next / N) !== Math.floor(p1 / N) || dir(p0, p1) !== dir(p1, next)) { emitTrack(segStart, p1); segStart = p1; }
    }
    for (const x of newItems) addItem(x);
    routed++;
  }
  return { board: b, routed, failed, ms: Date.now() - t0 };

  function astar(src: number[], dst: Set<number>, k: number): number[] | null {
    if (!src.length || !dst.size) return null;
    const dcells = [...dst]; const tx = dcells.map((n) => cx(n % N)), ty = dcells.map((n) => cy(n % N));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; for (let i = 0; i < tx.length; i++) { minX = Math.min(minX, tx[i]); maxX = Math.max(maxX, tx[i]); minY = Math.min(minY, ty[i]); maxY = Math.max(maxY, ty[i]); }
    const h = (n: number) => { const x = cx(n % N), y = cy(n % N); const dx = Math.max(0, minX - x, x - maxX) / g, dy = Math.max(0, minY - y, y - maxY) / g; return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
    const cost = new Float64Array(2 * N).fill(Infinity), prev = new Int32Array(2 * N).fill(-1);
    const heap: [number, number][] = []; // binary heap of [f, node]
    const push = (f: number, n: number) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const free = (node: number) => { const v = block[Math.floor(node / N)][node % N]; return v === -1 || v === k; };
    for (const s of src) if (free(s) || true) { cost[s] = 0; push(h(s), s); }
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let guard = 0;
    while (heap.length && guard++ < 4_000_000) {
      const [f, n] = pop(); if (f - h(n) > cost[n] + 1e-9) continue;
      if (dst.has(n)) { const out = [n]; let c = n; while (prev[c] !== -1) { c = prev[c]; out.push(c); } return out.reverse(); }
      const layer = Math.floor(n / N), i = n % N, x = i % W, y = Math.floor(i / W);
      for (const [dx, dy, c] of D) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const m = layer * N + yy * W + xx; if (!free(m) && !dst.has(m)) continue;
        if (dx && dy && (!free(layer * N + y * W + xx) || !free(layer * N + yy * W + x))) continue; // no corner cutting
        const nc = cost[n] + c; if (nc < cost[m]) { cost[m] = nc; prev[m] = n; push(nc + h(m), m); }
      }
      const vv = viaBlock[i]; if (vv === -1 || vv === k) { const m = (1 - layer) * N + i; if (free(m) || dst.has(m)) { const nc = cost[n] + viaCost; if (nc < cost[m]) { cost[m] = nc; prev[m] = n; push(nc + h(m), m); } } }
    }
    return null;
  }
}
