// Canvas renderer for the model space: grid, entities by layer colour, selection, previews, snap marker, crosshair.
import { arc3 } from "../core/cad";
import { dimGeometry, dist, polar, sub, ang, type Ent, type V } from "../core/geom";
import type { Drawing } from "../core/cad";

export type Palette = "light" | "granat" | "dark";
export interface View { cx: number; cy: number; s: number } // world centre and pixels per unit
export const THEME = {
  light: { bg: "#ffffff", grid: "#e7e9f3", grid2: "#cfd3e6", axis: "#9aa2cc", fg: "#0b1033", sel: "#3b4cca", snap: "#c27c0e", prev: "#3b4cca", hair: "#0b1033" },
  granat: { bg: "#0b1033", grid: "#141b4a", grid2: "#1e2763", axis: "#3a4596", fg: "#ffffff", sel: "#7d8cff", snap: "#f0b54a", prev: "#9fb0ff", hair: "#d8dcf5" },
  dark: { bg: "#03050f", grid: "#0b0f26", grid2: "#141a3d", axis: "#2b3577", fg: "#ffffff", sel: "#7d8cff", snap: "#f0b54a", prev: "#9fb0ff", hair: "#c9cde3" },
};
export const toScreen = (v: View, w: number, h: number) => (p: V): V => [w / 2 + (p[0] - v.cx) * v.s, h / 2 - (p[1] - v.cy) * v.s];
export const toWorld = (v: View, w: number, h: number) => (q: V): V => [v.cx + (q[0] - w / 2) / v.s, v.cy - (q[1] - h / 2) / v.s];

export interface Overlay { cursor: V | null; snap: { p: V; kind: string } | null; base: V | null; preview: Ent[]; sel: Set<string>; hover: string | null; win: [V, V] | null; showGrid: boolean; grid: number }

export function draw(cv: HTMLCanvasElement, d: Drawing, v: View, pal: Palette, o: Overlay) {
  const dpr = window.devicePixelRatio || 1; const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); const T = THEME[pal]; const S = toScreen(v, w, h); const W = toWorld(v, w, h);
  g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  // grid: the drawing's grid spacing, coarsened until lines are at least 8 px apart
  if (o.showGrid) { let sp = o.grid; while (sp * v.s < 8) sp *= 5; const [x0, y1] = W([0, 0]), [x1, y0] = W([w, h]);
    for (const [step, col] of [[sp, T.grid], [sp * 5, T.grid2]] as const) { g.strokeStyle = col; g.lineWidth = 1; g.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { const X = Math.round(S([x, 0])[0]) + 0.5; g.moveTo(X, 0); g.lineTo(X, h); }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const Y = Math.round(S([0, y])[1]) + 0.5; g.moveTo(0, Y); g.lineTo(w, Y); } g.stroke(); } }
  // UCS icon in the lower-left corner (like a drafting program), not at the origin where it would overlap geometry
  const O: V = [18, h - 18]; g.strokeStyle = T.axis; g.lineWidth = 1.5; g.beginPath(); g.moveTo(O[0], O[1]); g.lineTo(O[0] + 34, O[1]); g.moveTo(O[0], O[1]); g.lineTo(O[0], O[1] - 34); g.stroke(); g.lineWidth = 1;
  g.fillStyle = T.axis; g.font = "10px IBM Plex Mono, monospace"; g.fillText("X", O[0] + 37, O[1] + 4); g.fillText("Y", O[0] - 3, O[1] - 38);
  const o0 = S([0, 0]); if (o0[0] > 0 && o0[0] < w && o0[1] > 0 && o0[1] < h) { g.strokeStyle = T.axis; g.beginPath(); g.moveTo(o0[0] - 5, o0[1]); g.lineTo(o0[0] + 5, o0[1]); g.moveTo(o0[0], o0[1] - 5); g.lineTo(o0[0], o0[1] + 5); g.stroke(); }
  const layers = new Map(d.layers.map((l) => [l.name, l]));
  const colOf = (e: Ent) => { const c = e.color ?? layers.get(e.layer)?.color ?? "#ffffff"; return c.toLowerCase() === "#ffffff" || c.toLowerCase() === "#000000" ? T.fg : c; };
  for (const e of d.ents) { const l = layers.get(e.layer); if (!l?.visible) continue; const on = o.sel.has(e.id), hov = o.hover === e.id;
    ent(g, e, S, v, on ? T.sel : colOf(e), on, hov); }
  g.setLineDash([]);
  for (const e of o.preview) ent(g, e, S, v, T.prev, false, false, true);
  if (o.win) { const [a, b] = o.win.map(S); const crossing = b[0] < a[0]; g.fillStyle = crossing ? "rgba(63,207,142,.12)" : "rgba(88,104,230,.14)"; g.strokeStyle = crossing ? "#3fcf8e" : "#5868e6"; g.setLineDash(crossing ? [5, 4] : []);
    g.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); g.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); g.setLineDash([]); }
  if (o.snap) { const [x, y] = S(o.snap.p); g.strokeStyle = T.snap; g.lineWidth = 2; g.beginPath(); const r = 6;
    switch (o.snap.kind) { case "end": g.rect(x - r, y - r, 2 * r, 2 * r); break; case "mid": g.moveTo(x, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); g.closePath(); break;
      case "center": g.arc(x, y, r, 0, 7); break; case "quad": g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); break;
      case "int": g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); break; case "perp": g.moveTo(x - r, y + r); g.lineTo(x + r, y + r); g.moveTo(x - r, y + r); g.lineTo(x - r, y - r); g.moveTo(x - r, y); g.lineTo(x, y); g.lineTo(x, y + r); break;
      default: g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r); g.lineTo(x + r, y - r); g.closePath(); }
    g.stroke(); g.font = "11px IBM Plex Sans, sans-serif"; g.fillStyle = T.snap; g.fillText({ end: "Endpoint", mid: "Midpoint", center: "Center", quad: "Quadrant", int: "Intersection", perp: "Perpendicular", near: "Nearest", node: "Node" }[o.snap.kind] ?? o.snap.kind, x + 10, y + 18); g.lineWidth = 1; }
  if (o.cursor) { const [x, y] = S(o.cursor); g.strokeStyle = T.hair; g.globalAlpha = 0.75; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(w, Math.round(y) + 0.5); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h); g.stroke(); g.globalAlpha = 1; g.strokeRect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9); }
}

function ent(g: CanvasRenderingContext2D, e: Ent, S: (p: V) => V, v: View, col: string, sel: boolean, hov: boolean, prev = false) {
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = hov ? 2.5 : sel ? 1.8 : 1.2; g.setLineDash(sel || prev ? [6, 4] : []);
  const path = (pts: V[], close: boolean) => { g.beginPath(); pts.forEach((p, i) => { const q = S(p); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); if (close) g.closePath(); };
  switch (e.t) {
    case "line": path([e.a, e.b], false); g.stroke(); break;
    case "poly": path(e.pts, e.closed); g.stroke(); break;
    case "circle": { const c = S(e.c); g.beginPath(); g.arc(c[0], c[1], e.r * v.s, 0, Math.PI * 2); g.stroke(); break; }
    case "arc": { const c = S(e.c); g.beginPath(); g.arc(c[0], c[1], e.r * v.s, -e.a0, -e.a1, true); g.stroke(); break; }
    case "hatch": { path(e.pts, true); g.save(); g.clip(); g.globalAlpha = 0.16; g.fill(); g.globalAlpha = 0.8; g.lineWidth = 1; g.setLineDash([]);
      const xs = e.pts.map(S); const x0 = Math.min(...xs.map((p) => p[0])), x1 = Math.max(...xs.map((p) => p[0])), y0 = Math.min(...xs.map((p) => p[1])), y1 = Math.max(...xs.map((p) => p[1]));
      g.beginPath(); for (let k = x0 - (y1 - y0); k < x1; k += 8) { g.moveTo(k, y1); g.lineTo(k + (y1 - y0), y0); } g.stroke(); g.restore(); if (sel) { path(e.pts, true); g.stroke(); } break; }
    case "text": { const p = S(e.p); const px = e.h * v.s; if (px < 1.5) { g.fillRect(p[0], p[1] - 1, Math.max(2, e.s.length * px * 0.6), 1); break; }
      g.save(); g.translate(p[0], p[1]); g.rotate(-e.rot); g.font = `${px * 1.4}px "IBM Plex Sans", sans-serif`; g.textBaseline = "alphabetic"; g.fillText(e.s, 0, 0); if (sel) { g.setLineDash([3, 3]); g.strokeRect(0, -px * 1.1, g.measureText(e.s).width, px * 1.3); } g.restore(); break; }
    case "dim": { const dg = dimGeometry(e); for (const [a, b] of dg.lines) { path([a, b], false); g.stroke(); }
      // linear dimensions use drafting ticks (in dimGeometry); radius and diameter get an arrowhead on the curve
      if (e.kind === "radius" || e.kind === "diameter") { const r = dist(e.p1, e.p2), t0 = ang(sub(e.p2, e.p1)); const tips: [V, number][] = [[e.p2, t0 + Math.PI]]; if (e.kind === "diameter") tips.push([polar(e.p1, r, t0 + Math.PI), t0]);
        g.setLineDash([]); const as = Math.max(1.5, Math.min(3, r / 3)); for (const [tip, t] of tips) { const p1 = S(polar(tip, as, t + 0.25)), p2 = S(polar(tip, as, t - 0.25)), q = S(tip); g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.closePath(); g.fill(); } }
      const tp = S(dg.textAt); const px = Math.max(9, 2.5 * v.s * 1.4); g.save(); g.translate(tp[0], tp[1]); let r = -dg.textRot; if (r < -Math.PI / 2 || r > Math.PI / 2) r += Math.PI; g.rotate(r); g.font = `${px}px "IBM Plex Mono", monospace`; g.textAlign = "center"; g.textBaseline = "bottom"; g.fillText(dg.text, 0, -2); g.restore(); break; }
  }
}

/** Rubber-band preview for the command waiting for a point. */
export function rubber(cmd: string | null, prompt: string, base: V | null, cur: V | null, prevPts: V[]): Ent[] {
  if (!cmd || !base || !cur) return []; const E = { id: "~", layer: "" };
  if (cmd === "CIRCLE" && /radius/i.test(prompt)) return [{ ...E, t: "circle", c: base, r: dist(base, cur) }];
  if (cmd === "CIRCLE" && /second end/i.test(prompt)) return [{ ...E, t: "circle", c: [(base[0] + cur[0]) / 2, (base[1] + cur[1]) / 2], r: dist(base, cur) / 2 }];
  if (cmd === "RECTANG") return [{ ...E, t: "poly", pts: [base, [cur[0], base[1]], cur, [base[0], cur[1]]], closed: true }];
  if (cmd === "ARC" && prevPts.length === 2) { const a = arc3(prevPts[0], prevPts[1], cur); if (a) return [{ ...E, t: "arc", ...a }]; }
  if (cmd === "DIMLINEAR" || cmd === "DIMALIGNED") return [{ ...E, t: "line", a: base, b: cur }];
  return [{ ...E, t: "line", a: base, b: cur }];
}
