// Text → outlines with opentype.js (MIT) and Poppins (SIL Open Font Licence, bundled in /fonts).
// The outline is stored with the text object, so text is real, cuttable geometry.
import opentype from "opentype.js";
import type { SubPath, Vec } from "./core";

export const FONTS: Record<string, string> = {
  "Poppins": "/fonts/Poppins_400Regular.ttf",
  "Poppins SemiBold": "/fonts/Poppins_600SemiBold.ttf",
  "Poppins Bold": "/fonts/Poppins_700Bold.ttf",
};
const cache = new Map<string, Promise<opentype.Font>>();
export function loadFont(name: string): Promise<opentype.Font> {
  const url = FONTS[name] ?? FONTS.Poppins;
  let p = cache.get(url);
  if (!p) { p = fetch(url).then((r) => { if (!r.ok) throw new Error(`Font ${name} could not be loaded`); return r.arrayBuffer(); }).then((b) => opentype.parse(b)); cache.set(url, p); }
  return p;
}
/** Outline of `text` with a cap height-based size in mm; baseline at y = size, left at x = 0. Lines split on \n. */
export function textOutline(font: opentype.Font, text: string, size: number): SubPath[] {
  const out: SubPath[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const path = font.getPath(line, 0, size + i * size * 1.25, size);
    let sp: SubPath | null = null; let cur: Vec = [0, 0];
    for (const c of path.commands as { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]) {
      if (c.type === "M") { sp = { start: [c.x!, c.y!], segs: [], closed: false }; out.push(sp); cur = [c.x!, c.y!]; }
      else if (c.type === "L" && sp) { sp.segs.push({ k: "L", p: [c.x!, c.y!] }); cur = [c.x!, c.y!]; }
      else if (c.type === "C" && sp) { sp.segs.push({ k: "C", c1: [c.x1!, c.y1!], c2: [c.x2!, c.y2!], p: [c.x!, c.y!] }); cur = [c.x!, c.y!]; }
      else if (c.type === "Q" && sp) { const q: Vec = [c.x1!, c.y1!], p: Vec = [c.x!, c.y!]; sp.segs.push({ k: "C", c1: [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])], c2: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p }); cur = p; }
      else if (c.type === "Z" && sp) { if (sp.segs.length && (Math.abs(cur[0] - sp.start[0]) > 1e-9 || Math.abs(cur[1] - sp.start[1]) > 1e-9)) sp.segs.push({ k: "L", p: [...sp.start] as Vec }); sp.closed = true; }
    }
  });
  return out.filter((s) => s.segs.length);
}
