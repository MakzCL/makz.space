// Manufacturing outputs: Gerber RS-274X (with X2 file attributes), Excellon drill, pick-and-place CSV, and a zip of them.
// Coordinates: millimetres, format 4.6, so a coordinate is exactly the integer nanometre value. Gerber Y points up,
// so board y (down) is written as (top − y); the drill file and placement file use the same transform.
import type { Project } from "../core/types";
import { connectivity } from "../connectivity/connectivity";
import { baseItems, courtyardOf, outlineBox, padsOf, place, type Board, type Layer, type P } from "./board";
import { fillZones } from "./zones";
import { footprint, mm } from "./footprints";
import { APP_VERSION } from "../storage/file";

export interface FabFile { name: string; text: string }
const n6 = (nm: number) => (nm / 1e6).toFixed(6);

class Gerber {
  private ap = new Map<string, number>(); private body: string[] = []; private cur = -1;
  constructor(private func: string, private top: number) {}
  private x = (p: P) => `X${Math.round(p[0])}Y${Math.round(this.top - p[1])}`;
  private use(def: string) { let d = this.ap.get(def); if (d === undefined) { d = 10 + this.ap.size; this.ap.set(def, d); } if (d !== this.cur) { this.body.push(`D${d}*`); this.cur = d; } }
  flash(shape: "C" | "R" | "O", w: number, h: number, at: P) { this.use(shape === "C" ? `C,${n6(w)}` : `${shape},${n6(w)}X${n6(h)}`); this.body.push(`${this.x(at)}D03*`); }
  line(width: number, a: P, b: P) { this.use(`C,${n6(width)}`); this.body.push(`${this.x(a)}D02*`, `${this.x(b)}D01*`); }
  poly(width: number, pts: P[]) { this.use(`C,${n6(width)}`); this.body.push(`${this.x(pts[0])}D02*`, ...pts.slice(1).map((p) => `${this.x(p)}D01*`), `${this.x(pts[0])}D01*`); }
  /** Filled region (copper pour): outer ring dark, holes cleared. */
  region(rings: P[][]) {
    const ring = (r: P[]) => { this.body.push("G36*", `${this.x(r[0])}D02*`, ...r.slice(1).map((p) => `${this.x(p)}D01*`), `${this.x(r[0])}D01*`, "G37*"); };
    ring(rings[0]); if (rings.length > 1) { this.body.push("%LPC*%"); rings.slice(1).forEach(ring); this.body.push("%LPD*%"); }
  }
  get empty() { return this.body.length === 0; }
  text(): string {
    return [`G04 NUCLUES ${APP_VERSION} Gerber RS-274X*`, `%TF.GenerationSoftware,NUCLUES,NUCLUES,${APP_VERSION}*%`, `%TF.FileFunction,${this.func}*%`, "%TF.FilePolarity,Positive*%",
      "%FSLAX46Y46*%", "%MOMM*%", "%LPD*%", ...[...this.ap].map(([def, d]) => `%ADD${d}${def}*%`), "G01*", ...this.body, "M02*", ""].join("\n");
  }
}

// --- a small stroke font for reference designators on the silkscreen (cell 4 × 6 units, y down) ---
const FONT: Record<string, number[][]> = {
  A: [[0, 6, 0, 2, 2, 0, 4, 2, 4, 6], [0, 3, 4, 3]], B: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [3, 3, 4, 4, 4, 5, 3, 6, 0, 6]], C: [[4, 0, 0, 0, 0, 6, 4, 6]], D: [[0, 0, 3, 0, 4, 1, 4, 5, 3, 6, 0, 6, 0, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]], F: [[4, 0, 0, 0, 0, 6], [0, 3, 3, 3]], G: [[4, 0, 0, 0, 0, 6, 4, 6, 4, 3, 2, 3]], H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]], I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  J: [[1, 0, 4, 0], [3, 0, 3, 6, 0, 6, 0, 4]], K: [[0, 0, 0, 6], [4, 0, 0, 3, 4, 6]], L: [[0, 0, 0, 6, 4, 6]], M: [[0, 6, 0, 0, 2, 3, 4, 0, 4, 6]], N: [[0, 6, 0, 0, 4, 6, 4, 0]], O: [[0, 0, 4, 0, 4, 6, 0, 6, 0, 0]],
  P: [[0, 6, 0, 0, 4, 0, 4, 3, 0, 3]], Q: [[0, 0, 4, 0, 4, 6, 0, 6, 0, 0], [2, 4, 4, 6]], R: [[0, 6, 0, 0, 4, 0, 4, 3, 0, 3, 4, 6]], S: [[4, 0, 0, 0, 0, 3, 4, 3, 4, 6, 0, 6]], T: [[0, 0, 4, 0], [2, 0, 2, 6]],
  U: [[0, 0, 0, 6, 4, 6, 4, 0]], V: [[0, 0, 2, 6, 4, 0]], W: [[0, 0, 1, 6, 2, 3, 3, 6, 4, 0]], X: [[0, 0, 4, 6], [4, 0, 0, 6]], Y: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]], Z: [[0, 0, 4, 0, 0, 6, 4, 6]],
  "0": [[0, 0, 4, 0, 4, 6, 0, 6, 0, 0], [0, 6, 4, 0]], "1": [[1, 1, 2, 0, 2, 6], [1, 6, 3, 6]], "2": [[0, 0, 4, 0, 4, 3, 0, 3, 0, 6, 4, 6]], "3": [[0, 0, 4, 0, 4, 6, 0, 6], [1, 3, 4, 3]], "4": [[0, 0, 0, 3, 4, 3], [4, 0, 4, 6]],
  "5": [[4, 0, 0, 0, 0, 3, 4, 3, 4, 6, 0, 6]], "6": [[4, 0, 0, 0, 0, 6, 4, 6, 4, 3, 0, 3]], "7": [[0, 0, 4, 0, 1, 6]], "8": [[0, 0, 4, 0, 4, 6, 0, 6, 0, 0], [0, 3, 4, 3]], "9": [[4, 3, 0, 3, 0, 0, 4, 0, 4, 6, 0, 6]],
  "-": [[0, 3, 4, 3]], _: [[0, 6, 4, 6]], "+": [[0, 3, 4, 3], [2, 1, 2, 5]],
};
/** Text as stroke segments: height h, centred on `at`, upright. */
export function strokeText(s: string, at: P, h: number): [P, P][] {
  const u = h / 6, adv = 6 * u, w = s.length * adv - 2 * u, out: [P, P][] = [];
  [...s.toUpperCase()].forEach((ch, i) => { const g = FONT[ch]; if (!g) return; const ox = at[0] - w / 2 + i * adv, oy = at[1] - h / 2;
    for (const st of g) for (let k = 0; k + 3 < st.length; k += 2) out.push([[ox + st[k] * u, oy + st[k + 1] * u], [ox + st[k + 2] * u, oy + st[k + 3] * u]]); });
  return out;
}

export function fabFiles(b: Board, pr: Project, base = "board"): FabFile[] {
  const con = connectivity(pr); const pads = padsOf(b, pr, con); const [, , , top] = outlineBox(b); const R = b.rules;
  const cu: Record<Layer, Gerber> = { "F.Cu": new Gerber("Copper,L1,Top", top), "B.Cu": new Gerber("Copper,L2,Bot", top) };
  const mask = { "F.Cu": new Gerber("Soldermask,Top", top), "B.Cu": new Gerber("Soldermask,Bot", top) };
  const paste = { "F.Cu": new Gerber("Paste,Top", top), "B.Cu": new Gerber("Paste,Bot", top) }; // stencil openings: SMD pads, 1:1
  const silk = { top: new Gerber("Legend,Top", top), bottom: new Gerber("Legend,Bot", top) };
  const edge = new Gerber("Profile,NP", top);
  const kind = (s: string) => (s === "circle" ? "C" : s === "rect" ? "R" : "O") as "C" | "R" | "O";
  for (const p of pads) for (const l of p.layers) {
    cu[l].flash(kind(p.shape), p.size[0], p.size[1], p.at);
    mask[l].flash(kind(p.shape), p.size[0] + 2 * R.maskMargin, p.size[1] + 2 * R.maskMargin, p.at);
    if (!p.drill) paste[l].flash(kind(p.shape), p.size[0], p.size[1], p.at);
  }
  for (const f of fillZones(b, baseItems(b, pads))) for (const poly of f.polys) cu[f.zone.layer].region(poly.rings); // pours first, pads and tracks on top
  for (const t of b.tracks) cu[t.layer].line(t.width, t.a, t.b);
  for (const v of b.vias) for (const l of ["F.Cu", "B.Cu"] as Layer[]) cu[l].flash("C", v.dia, v.dia, v.at); // vias are tented (covered by mask)
  for (const p of b.parts) {
    const f = footprint(p.footprint); if (!f) continue; const g = silk[p.side];
    for (const s of f.silk) g.line(R.silkWidth, place(p, s[0], s[1]), place(p, s[2], s[3]));
    const c = courtyardOf(p)!; // same placement as on screen: centred above the courtyard
    for (const [a, e] of strokeText(p.ref, [(c[0] + c[2]) / 2, c[1] - mm(0.9)], mm(1.0))) g.line(R.silkWidth, p.side === "bottom" ? [c[0] + c[2] - a[0], a[1]] : a, p.side === "bottom" ? [c[0] + c[2] - e[0], e[1]] : e);
  }
  edge.poly(mm(0.1), b.outline);
  const files: FabFile[] = [
    { name: `${base}-F_Cu.gbr`, text: cu["F.Cu"].text() }, { name: `${base}-B_Cu.gbr`, text: cu["B.Cu"].text() },
    { name: `${base}-F_Mask.gbr`, text: mask["F.Cu"].text() }, { name: `${base}-B_Mask.gbr`, text: mask["B.Cu"].text() },
    { name: `${base}-F_Silkscreen.gbr`, text: silk.top.text() },
  ];
  if (!silk.bottom.empty) files.push({ name: `${base}-B_Silkscreen.gbr`, text: silk.bottom.text() });
  for (const [l, n] of [["F.Cu", "F_Paste"], ["B.Cu", "B_Paste"]] as const) if (!paste[l].empty) files.push({ name: `${base}-${n}.gbr`, text: paste[l].text() });
  files.push({ name: `${base}-Edge_Cuts.gbr`, text: edge.text() }, { name: `${base}-PTH.drl`, text: excellon(b, pads.filter((p) => p.drill).map((p) => ({ at: p.at, d: p.drill! })).concat(b.vias.map((v) => ({ at: v.at, d: v.drill }))), top) });
  files.push({ name: `${base}-pos.csv`, text: placement(b, pr, top) });
  return files;
}

/** Excellon drill file (plated holes), metric, decimal coordinates; tools sorted by diameter. */
export function excellon(b: Board, holes: { at: P; d: number }[], top: number): string {
  void b; const tools = [...new Set(holes.map((h) => h.d))].sort((a, c) => a - c);
  const xy = (p: P) => `X${(p[0] / 1e6).toFixed(3)}Y${((top - p[1]) / 1e6).toFixed(3)}`;
  return ["M48", `; NUCLUES ${APP_VERSION} drill file, plated through holes`, "FMAT,2", "METRIC", ...tools.map((d, i) => `T${i + 1}C${(d / 1e6).toFixed(3)}`), "G90", "%", "G05",
    ...tools.flatMap((d, i) => [`T${i + 1}`, ...holes.filter((h) => h.d === d).map((h) => xy(h.at))]), "M30", ""].join("\n");
}

/** Pick-and-place: every part with its centre, rotation and side (mm, Y up like the Gerbers). */
export function placement(b: Board, pr: Project, top: number): string {
  const rows = b.parts.map((p) => { const s = pr.parts.find((x) => x.id === p.part); return [p.ref, s?.props.value ?? "", p.footprint, (p.at[0] / 1e6).toFixed(4), ((top - p.at[1]) / 1e6).toFixed(4), String(p.rot), p.side]; });
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [["Ref", "Val", "Package", "PosX", "PosY", "Rot", "Side"], ...rows.sort((a, c) => a[0].localeCompare(c[0], undefined, { numeric: true }))].map((r) => r.map(q).join(",")).join("\n") + "\n";
}

// --- zip (store method) so the fab files download as one archive ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (const x of d) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [], central: Uint8Array[] = []; let off = 0;
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255], u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = crc32(f.data), n = f.data.length;
    const head = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0), ...name]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(n), ...u32(n), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...name]));
    parts.push(head, f.data); off += head.length + n;
  }
  const cd = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd), ...u32(off), ...u16(0)]);
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let p = 0; for (const c of all) { out.set(c, p); p += c.length; } return out;
}
