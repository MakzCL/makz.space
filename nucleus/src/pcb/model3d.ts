// 3D model of a board, independent of the renderer: everything in millimetres, x right, y away from the viewer on
// the board (board y-down becomes +z), and h = height above the bottom of the board. The 3D view turns this into
// meshes; tests check it directly.
import { footprint, MM, type FootprintDef } from "./footprints";
import { padsOf, place, type Board, type PcbPart } from "./board";
import type { Project } from "../core/types";

export const THICK = 1.6, CU = 0.035; // FR-4 core and 1 oz copper, mm
export interface Body { ref: string; kind: "box" | "cyl" | "cylX" | "dome"; at: [number, number]; rotDeg: number; size: [number, number, number]; lift: number; color: string; side: "top" | "bottom"; top?: string }
export interface Pin { at: [number, number]; size: [number, number]; h: number; side: "top" | "bottom"; color: string }
export interface Copper { kind: "track" | "pad" | "via"; side: "top" | "bottom" | "both"; a: [number, number]; b?: [number, number]; w: number; h?: number; shape?: "rect" | "circle" | "oval"; net: string }
export interface Model3D { outline: [number, number][]; holes: { at: [number, number]; d: number; plated: boolean }[]; copper: Copper[]; silk: { a: [number, number]; b: [number, number]; side: "top" | "bottom" }[]; bodies: Body[]; pins: Pin[]; size: [number, number] }

const m = (v: number) => v / MM;
const P = (p: [number, number]): [number, number] => [m(p[0]), m(p[1])];

/** Body for a footprint (nominal package dimensions; colours are generic, not any vendor's). */
interface Shape { kind: Body["kind"]; size: [number, number, number]; lift?: number; color: string; top?: string; pins?: { h: number; color: string } }
function shapeFor(f: FootprintDef): Shape | null {
  const n = f.name;
  if (/^R_0805/.test(n)) return { kind: "box", size: [2.0, 1.25, 0.5], color: "#1b1b1f", top: "#2a2a30" };
  if (/^R_0603/.test(n)) return { kind: "box", size: [1.6, 0.8, 0.45], color: "#1b1b1f" };
  if (/^C_08/.test(n)) return { kind: "box", size: [2.0, 1.25, 0.85], color: "#b98e55" };
  if (/^C_06/.test(n)) return { kind: "box", size: [1.6, 0.8, 0.8], color: "#b98e55" };
  if (/^L_0805/.test(n)) return { kind: "box", size: [2.0, 1.25, 0.9], color: "#5b5d66" };
  if (/^LED_0805/.test(n)) return { kind: "box", size: [2.0, 1.25, 0.8], color: "#f2f0e8", top: "#ff6a4a" };
  if (/^D_SOD-123/.test(n)) return { kind: "box", size: [2.7, 1.6, 1.1], color: "#1b1b1f" };
  if (/^R_Axial/.test(n)) return { kind: "cylX", size: [6.3, 2.5, 2.5], lift: 0.4, color: "#c9b38a", pins: { h: 1.6, color: "#c7c9cf" } };
  if (/^L_Axial/.test(n)) return { kind: "cylX", size: [5.3, 2.2, 2.2], lift: 0.4, color: "#2f7d55", pins: { h: 1.4, color: "#c7c9cf" } };
  if (/^C_Disc/.test(n)) return { kind: "box", size: [5.0, 2.5, 5.5], lift: 1.5, color: "#d27a2c", pins: { h: 1.5, color: "#c7c9cf" } };
  if (/^CP_Radial_D5/.test(n)) return { kind: "cyl", size: [5.0, 5.0, 11], lift: 0.3, color: "#24345f", top: "#b9bec9" };
  if (/^CP_Radial_D8/.test(n)) return { kind: "cyl", size: [8.0, 8.0, 11.5], lift: 0.3, color: "#24345f", top: "#b9bec9" };
  if (/^LED_D5/.test(n)) return { kind: "dome", size: [5.0, 5.0, 8.6], lift: 1, color: "#e8432f", pins: { h: 1, color: "#c7c9cf" } };
  if (/^LED_D3/.test(n)) return { kind: "dome", size: [3.0, 3.0, 5.3], lift: 1, color: "#e8432f", pins: { h: 1, color: "#c7c9cf" } };
  if (/^D_DO-35/.test(n)) return { kind: "cylX", size: [3.8, 1.8, 1.8], lift: 0.4, color: "#d96b3b", pins: { h: 1.3, color: "#c7c9cf" } };
  if (/^D_DO-41/.test(n)) return { kind: "cylX", size: [5.2, 2.7, 2.7], lift: 0.4, color: "#1b1b1f", pins: { h: 1.7, color: "#c7c9cf" } };
  if (/^TO-92/.test(n)) return { kind: "box", size: [4.8, 3.8, 4.5], lift: 2, color: "#1b1b1f", pins: { h: 2, color: "#c7c9cf" } };
  if (/^PinHeader_1x(\d+)/.test(n)) return { kind: "box", size: [2.54 * f.pads.length, 2.54, 2.5], color: "#1b1b1f", pins: { h: 8.5, color: "#d8b45a" } };
  if (/^Potentiometer/.test(n)) return { kind: "box", size: [9.5, 4.8, 10], color: "#2b56b8", top: "#d8d0b0" };
  if (/^SW_SPST_Slide/.test(n)) return { kind: "box", size: [8.6, 3.6, 3.5], color: "#1b1b1f", top: "#c7c9cf" };
  if (/^SOIC/.test(n)) return { kind: "box", size: [3.9, 4.9, 1.55], lift: 0.1, color: "#1b1b1f", top: "#26262c" };
  if (/^DIP/.test(n)) return { kind: "box", size: [6.35, 9.8, 3.3], lift: 0.5, color: "#1b1b1f", pins: { h: 0.5, color: "#c7c9cf" } };
  return null;
}
/** Footprint-local centre of the body: the middle of the silkscreen outline (or of the pads). */
function bodyCentre(f: FootprintDef): [number, number] {
  const xs = f.silk.length ? f.silk.flatMap((s) => [s[0], s[2]]) : f.pads.map((p) => p.at[0]); const ys = f.silk.length ? f.silk.flatMap((s) => [s[1], s[3]]) : f.pads.map((p) => p.at[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
const silkBox = (f: FootprintDef): [number, number] => { const xs = f.silk.flatMap((s) => [s[0], s[2]]), ys = f.silk.flatMap((s) => [s[1], s[3]]); return xs.length ? [m(Math.max(...xs) - Math.min(...xs)), m(Math.max(...ys) - Math.min(...ys))] : [1, 1]; };

/** Rotation of a placed part about the board normal, in degrees CCW as seen from above (board y is down). */
const rotOf = (p: PcbPart) => (p.side === "bottom" ? -p.rot : p.rot);

export function model3d(b: Board, pr: Project): Model3D {
  const pads = padsOf(b, pr);
  const xs = b.outline.map((p) => m(p[0])), ys = b.outline.map((p) => m(p[1]));
  const out: Model3D = { outline: b.outline.map(P), holes: [], copper: [], silk: [], bodies: [], pins: [], size: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] };
  for (const pd of pads) {
    const side = pd.layers.length === 2 ? "both" : pd.layers[0] === "F.Cu" ? "top" : "bottom";
    out.copper.push({ kind: "pad", side, a: P(pd.at), b: [m(pd.size[0]), m(pd.size[1])], w: 0, shape: pd.shape, net: pd.net });
    if (pd.drill) out.holes.push({ at: P(pd.at), d: m(pd.drill), plated: true });
  }
  for (const t of b.tracks) out.copper.push({ kind: "track", side: t.layer === "F.Cu" ? "top" : "bottom", a: P(t.a), b: P(t.b), w: m(t.width), net: t.net });
  for (const v of b.vias) { out.copper.push({ kind: "via", side: "both", a: P(v.at), w: m(v.dia), net: v.net }); out.holes.push({ at: P(v.at), d: m(v.drill), plated: true }); }
  for (const p of b.parts) {
    const f = footprint(p.footprint); if (!f) continue; const side = p.side;
    for (const s of f.silk) out.silk.push({ a: P(place(p, s[0], s[1])), b: P(place(p, s[2], s[3])), side });
    const sh = shapeFor(f); const c = bodyCentre(f); const at = P(place(p, c[0], c[1]));
    const size: [number, number, number] = sh ? sh.size : [...silkBox(f), 2] as [number, number, number];
    out.bodies.push({ ref: p.ref, kind: sh?.kind ?? "box", at, rotDeg: rotOf(p), size, lift: sh?.lift ?? 0, color: sh?.color ?? "#3a3d48", top: sh?.top, side });
    if (sh?.pins && f.pads.some((d) => d.drill)) for (const d of f.pads) out.pins.push({ at: P(place(p, d.at[0], d.at[1])), size: [0.6, 0.6], h: sh.pins.h + (sh.lift ?? 0), side, color: sh.pins.color });
  }
  return out;
}
