// Schematic geometry helpers: symbol transforms and pin positions in sheet coordinates.
import type { Part, Pt } from "./types";
import { device } from "../library/devices";

/** Symbol-local → sheet: mirror (about the Y axis) first, then rotate CCW in 90° steps, then translate. */
export function xf(p: Pt, rot: Part["rot"], mirror: boolean, at: Pt): Pt {
  let [x, y] = p;
  if (mirror) x = -x;
  for (let r = 0; r < rot; r += 90) [x, y] = [y, -x]; // 90° CCW on screen (y down)
  return [x + at[0], y + at[1]];
}
export const xfDir = (dir: number, rot: number, mirror: boolean) => {
  let d = mirror ? (180 - dir + 360) % 360 : dir;
  d = (d - rot + 360) % 360; // CCW rotation on screen reduces the angle (y down)
  return d;
};
export interface PinPos { part: string; num: string; name: string; at: Pt; type: import("./types").PinType }
export function pinsOf(p: Part): PinPos[] {
  const d = device(p.device);
  return d.symbol.pins.map((pd) => ({ part: p.id, num: pd.num, name: pd.name, at: xf(pd.at, p.rot, p.mirror, p.at), type: pd.type }));
}
export const eq = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
/** Is p on the closed segment a-b (axis-aligned or diagonal, exact integer math)? */
export function onSeg(p: Pt, a: Pt, b: Pt): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (cross !== 0) return false;
  return p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}
export function segs(pts: Pt[]): [Pt, Pt][] { const o: [Pt, Pt][] = []; for (let i = 1; i < pts.length; i++) o.push([pts[i - 1], pts[i]]); return o; }
export const snap = (v: number, g: number) => Math.round(v / g) * g;
/** Symbol bounding box (local), for hit-testing and fit. */
export function symbolBox(devId: string): { x0: number; y0: number; x1: number; y1: number } {
  const d = device(devId); const xs: number[] = [], ys: number[] = [];
  for (const g of d.symbol.gfx) {
    if (g.k === "line" || g.k === "poly") for (const [x, y] of g.pts) { xs.push(x); ys.push(y); }
    else if (g.k === "rect") { xs.push(g.x, g.x + g.w); ys.push(g.y, g.y + g.h); }
    else if (g.k === "circle" || g.k === "arc") { xs.push(g.x - g.r, g.x + g.r); ys.push(g.y - g.r, g.y + g.r); }
    else if (g.k === "text") { xs.push(g.x); ys.push(g.y); }
  }
  for (const p of d.symbol.pins) { xs.push(p.at[0]); ys.push(p.at[1]); }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
export function partBox(p: Part) {
  const b = symbolBox(p.device);
  const c = [xf([b.x0, b.y0], p.rot, p.mirror, p.at), xf([b.x1, b.y1], p.rot, p.mirror, p.at)];
  return { x0: Math.min(c[0][0], c[1][0]), y0: Math.min(c[0][1], c[1][1]), x1: Math.max(c[0][0], c[1][0]), y1: Math.max(c[0][1], c[1][1]) };
}
