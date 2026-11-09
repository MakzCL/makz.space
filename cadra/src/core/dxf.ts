// DXF exchange. Writes AutoCAD R12 ASCII DXF (the most widely readable flavour): LINE, CIRCLE, ARC, POLYLINE, TEXT,
// dimensions written as plain lines and text, hatches as SOLID-filled boundary polylines on their layer. Reads the
// common 2D entities of any ASCII DXF version: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE/VERTEX, TEXT, MTEXT, HATCH
// (polyline boundaries), DIMENSION (linear/aligned/radius/diameter) and INSERT is reported as skipped.
import { deg, dimGeometry, eid, rad, type Ent, type V } from "./geom";
import { newDrawing, type Drawing, type Layer } from "./cad";

const ACI: [number, string][] = [[1, "#ff0000"], [2, "#ffff00"], [3, "#00ff00"], [4, "#00ffff"], [5, "#0000ff"], [6, "#ff00ff"], [7, "#ffffff"], [8, "#808080"], [9, "#c0c0c0"], [30, "#ff7f00"], [40, "#ffbf00"], [140, "#3f9fff"], [150, "#007fff"], [210, "#ff00bf"]];
const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const toAci = (hex: string) => { const c = rgbOf(hex); let best = 7, bd = Infinity; for (const [n, h] of ACI) { const d = rgbOf(h).reduce((s, v, i) => s + (v - c[i]) ** 2, 0); if (d < bd) { bd = d; best = n; } } return best; };
export const fromAci = (n: number) => ACI.find(([k]) => k === Math.abs(n))?.[1] ?? "#ffffff";
const num = (v: number) => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(9)).toString();
const safe = (s: string) => s.replace(/[\r\n]+/g, " ");

export function writeDxf(d: Drawing): string {
  const o: string[] = []; const g = (c: number, v: string | number) => o.push(String(c), typeof v === "number" ? num(v) : v);
  const ext = d.ents.length ? d.ents : [];
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSUNITS"); g(70, d.units === "mm" ? 4 : 1); g(9, "$CLAYER"); g(8, d.current); void ext; g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 1); g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, 0); g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, d.layers.length);
  for (const l of d.layers) { g(0, "LAYER"); g(2, safe(l.name)); g(70, l.locked ? 4 : 0); g(62, l.visible ? toAci(l.color) : -toAci(l.color)); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB"); g(0, "TABLE"); g(2, "STYLE"); g(70, 1); g(0, "STYLE"); g(2, "STANDARD"); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, "txt"); g(4, ""); g(0, "ENDTAB");
  g(0, "ENDSEC"); g(0, "SECTION"); g(2, "ENTITIES");
  const head = (t: string, e: Ent) => { g(0, t); g(8, safe(e.layer)); if (e.color) g(62, toAci(e.color)); };
  const poly = (e: Ent, pts: V[], closed: boolean) => { head("POLYLINE", e); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0); for (const p of pts) { g(0, "VERTEX"); g(8, safe(e.layer)); g(10, p[0]); g(20, p[1]); g(30, 0); } g(0, "SEQEND"); g(8, safe(e.layer)); };
  const text = (e: Ent, p: V, h: number, s: string, rot: number) => { head("TEXT", e); g(10, p[0]); g(20, p[1]); g(30, 0); g(40, h); g(1, safe(s)); if (rot) g(50, deg(rot)); };
  for (const e of d.ents) {
    if (e.t === "line") { head("LINE", e); g(10, e.a[0]); g(20, e.a[1]); g(30, 0); g(11, e.b[0]); g(21, e.b[1]); g(31, 0); }
    else if (e.t === "circle") { head("CIRCLE", e); g(10, e.c[0]); g(20, e.c[1]); g(30, 0); g(40, e.r); }
    else if (e.t === "arc") { head("ARC", e); g(10, e.c[0]); g(20, e.c[1]); g(30, 0); g(40, e.r); g(50, ((deg(e.a0) % 360) + 360) % 360); g(51, ((deg(e.a1) % 360) + 360) % 360); }
    else if (e.t === "poly") poly(e, e.pts, e.closed);
    else if (e.t === "text") text(e, e.p, e.h, e.s, e.rot);
    else if (e.t === "hatch") poly(e, e.pts, true);
    else if (e.t === "dim") { const dg = dimGeometry(e); for (const [a, b] of dg.lines) { head("LINE", e); g(10, a[0]); g(20, a[1]); g(30, 0); g(11, b[0]); g(21, b[1]); g(31, 0); } text(e, dg.textAt, 2.5, dg.text, dg.textRot); }
  }
  g(0, "ENDSEC"); g(0, "EOF"); return o.join("\r\n") + "\r\n";
}

export interface DxfRead { drawing: Drawing; skipped: Record<string, number> }
export function readDxf(src: string): DxfRead {
  const lines = src.replace(/\r/g, "").split("\n"); const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) { const c = parseInt(lines[i].trim(), 10); if (Number.isNaN(c)) throw new Error(`Not an ASCII DXF file (bad group code on line ${i + 1})`); pairs.push([c, lines[i + 1].trim()]); }
  const d = newDrawing(); d.layers = []; const skipped: Record<string, number> = {}; const skip = (t: string) => (skipped[t] = (skipped[t] ?? 0) + 1);
  const layer = (name: string) => { const n = name || "0"; if (!d.layers.some((l) => l.name === n)) d.layers.push({ name: n, color: "#ffffff", visible: true, locked: false }); return n; };
  // group records by "0" markers
  const recs: { type: string; g: [number, string][] }[] = []; let section = ""; let cur: { type: string; g: [number, string][] } | null = null; const secs: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { if (cur) recs.push(cur); cur = null;
      if (v === "SECTION") { section = pairs[i + 1]?.[1] ?? ""; secs.push(section); i++; continue; } if (v === "ENDSEC") { section = ""; continue; } if (v === "EOF") break;
      if (section === "ENTITIES" || section === "TABLES" || section === "HEADER") cur = { type: `${section}:${v}`, g: [] }; continue; }
    if (cur) cur.g.push([c, v]);
    else if (section === "HEADER" && c === 9 && v === "$INSUNITS") { const u = +pairs[i + 1][1]; d.units = u === 1 ? "in" : "mm"; }
  }
  if (cur) recs.push(cur);
  if (!secs.length) throw new Error("No DXF sections found");
  const F = (g: [number, string][], c: number, def = 0) => { const x = g.find(([k]) => k === c); return x ? parseFloat(x[1]) : def; };
  const S = (g: [number, string][], c: number, def = "") => g.find(([k]) => k === c)?.[1] ?? def;
  const base = (g: [number, string][]) => { const col = g.find(([k]) => k === 62); return { id: eid(), layer: layer(S(g, 8, "0")), ...(col && +col[1] > 0 && +col[1] < 256 ? { color: fromAci(+col[1]) } : {}) }; };
  let open: { e: Ent & { t: "poly" }; } | null = null;
  for (const r of recs) {
    const [sec, t] = r.type.split(":"); const g = r.g;
    if (sec === "TABLES") { if (t === "LAYER") { const name = S(g, 2); if (name) { const c = F(g, 62, 7), fl = F(g, 70, 0); const l: Layer = { name, color: fromAci(c), visible: c >= 0, locked: (fl & 4) !== 0 }; const i = d.layers.findIndex((x) => x.name === name); if (i >= 0) d.layers[i] = l; else d.layers.push(l); } } continue; }
    if (sec !== "ENTITIES") continue;
    if (t === "VERTEX" && open) { open.e.pts.push([F(g, 10), F(g, 20)]); continue; }
    if (t === "SEQEND") { if (open && open.e.pts.length > 1) d.ents.push(open.e); open = null; continue; }
    switch (t) {
      case "LINE": d.ents.push({ ...base(g), t: "line", a: [F(g, 10), F(g, 20)], b: [F(g, 11), F(g, 21)] }); break;
      case "CIRCLE": d.ents.push({ ...base(g), t: "circle", c: [F(g, 10), F(g, 20)], r: F(g, 40) }); break;
      case "ARC": d.ents.push({ ...base(g), t: "arc", c: [F(g, 10), F(g, 20)], r: F(g, 40), a0: rad(F(g, 50)), a1: rad(F(g, 51)) }); break;
      case "LWPOLYLINE": { const xs = g.filter(([k]) => k === 10).map(([, v]) => +v), ys = g.filter(([k]) => k === 20).map(([, v]) => +v); if (g.some(([k, v]) => k === 42 && +v !== 0)) skip("LWPOLYLINE bulges (drawn straight)");
        d.ents.push({ ...base(g), t: "poly", pts: xs.map((x, i) => [x, ys[i]] as V), closed: (F(g, 70) & 1) === 1 }); break; }
      case "POLYLINE": open = { e: { ...base(g), t: "poly", pts: [], closed: (F(g, 70) & 1) === 1 } }; break;
      case "TEXT": d.ents.push({ ...base(g), t: "text", p: [F(g, 10), F(g, 20)], h: F(g, 40, 2.5), s: S(g, 1), rot: rad(F(g, 50)) }); break;
      case "MTEXT": d.ents.push({ ...base(g), t: "text", p: [F(g, 10), F(g, 20)], h: F(g, 40, 2.5), s: g.filter(([k]) => k === 3 || k === 1).map(([, v]) => v).join("").replace(/\\P/g, " ").replace(/\\[A-Za-z][^;]*;|[{}]/g, ""), rot: rad(F(g, 50)) }); break;
      case "HATCH": { const xs: V[] = []; let inPath = false; for (const [k, v] of g) { if (k === 92) inPath = true; else if (inPath && k === 10) xs.push([+v, NaN]); else if (inPath && k === 20 && xs.length && Number.isNaN(xs[xs.length - 1][1])) xs[xs.length - 1][1] = +v; else if (k === 97) break; }
        const pts = xs.filter((p) => Number.isFinite(p[1])); if (pts.length >= 3) d.ents.push({ ...base(g), t: "hatch", pts }); else skip("HATCH (non-polyline boundary)"); break; }
      case "DIMENSION": { const ty = F(g, 70) & 7; const p13: V = [F(g, 13), F(g, 23)], p14: V = [F(g, 14), F(g, 24)], p10: V = [F(g, 10), F(g, 20)], p15: V = [F(g, 15), F(g, 25)]; const rot = F(g, 50);
        if (ty === 0 || ty === 1) d.ents.push({ ...base(g), t: "dim", kind: ty === 1 ? "aligned" : Math.abs(Math.sin(rad(rot))) > 0.5 ? "vertical" : "horizontal", p1: p13, p2: p14, at: p10 });
        else if (ty === 3) d.ents.push({ ...base(g), t: "dim", kind: "diameter", p1: [(p10[0] + p15[0]) / 2, (p10[1] + p15[1]) / 2], p2: p15, at: p10 });
        else if (ty === 4) d.ents.push({ ...base(g), t: "dim", kind: "radius", p1: p10, p2: p15, at: p15 });
        else skip("DIMENSION (angular/ordinate)"); break; }
      default: skip(t);
    }
  }
  if (!d.layers.length) d.layers.push({ name: "0", color: "#ffffff", visible: true, locked: false });
  if (!d.layers.some((l) => l.name === "Dimensions")) d.layers.push({ name: "Dimensions", color: "#5ec8ff", visible: true, locked: false });
  d.current = d.layers[0].name; return { drawing: d, skipped };
}

/** Native file: lossless JSON. */
export const writeNative = (d: Drawing) => JSON.stringify(d);
export function readNative(s: string): Drawing { const d = JSON.parse(s); if (d?.format !== "cadra" || !Array.isArray(d.ents) || !Array.isArray(d.layers)) throw new Error("Not a CADRA drawing"); return d; }

/** SVG export of the visible layers (for documents and the web). */
export function writeSvg(d: Drawing, box: [number, number, number, number]): string {
  const [x0, y0, x1, y1] = box; const pad = Math.max(x1 - x0, y1 - y0) * 0.04 || 5; const W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad;
  const vis = new Map(d.layers.map((l) => [l.name, l])); const P = (p: V) => `${num(p[0])},${num(-p[1])}`; const out: string[] = [];
  for (const e of d.ents) { const l = vis.get(e.layer); if (!l?.visible) continue; const col = e.color ?? (l.color.toLowerCase() === "#ffffff" ? "#000000" : l.color);
    if (e.t === "line") out.push(`<line x1="${num(e.a[0])}" y1="${num(-e.a[1])}" x2="${num(e.b[0])}" y2="${num(-e.b[1])}" stroke="${col}"/>`);
    else if (e.t === "circle") out.push(`<circle cx="${num(e.c[0])}" cy="${num(-e.c[1])}" r="${num(e.r)}" stroke="${col}" fill="none"/>`);
    else if (e.t === "arc") { const s = [e.c[0] + e.r * Math.cos(e.a0), e.c[1] + e.r * Math.sin(e.a0)] as V, t = [e.c[0] + e.r * Math.cos(e.a1), e.c[1] + e.r * Math.sin(e.a1)] as V; const sw = (((e.a1 - e.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); out.push(`<path d="M${P(s)} A${num(e.r)},${num(e.r)} 0 ${sw > Math.PI ? 1 : 0} 0 ${P(t)}" stroke="${col}" fill="none"/>`); }
    else if (e.t === "poly" || e.t === "hatch") out.push(`<polyline points="${(e.t === "hatch" || e.closed ? [...e.pts, e.pts[0]] : e.pts).map(P).join(" ")}" stroke="${col}" fill="${e.t === "hatch" ? col : "none"}"${e.t === "hatch" ? ' fill-opacity="0.25"' : ""}/>`);
    else if (e.t === "text") out.push(`<text x="${num(e.p[0])}" y="${num(-e.p[1])}" font-size="${num(e.h * 1.4)}" fill="${col}" font-family="sans-serif" transform="rotate(${num(-deg(e.rot))} ${P(e.p).replace(",", " ")})">${esc(e.s)}</text>`);
    else if (e.t === "dim") { const g = dimGeometry(e); g.lines.forEach(([a, b]) => out.push(`<line x1="${num(a[0])}" y1="${num(-a[1])}" x2="${num(b[0])}" y2="${num(-b[1])}" stroke="${col}"/>`)); out.push(`<text x="${num(g.textAt[0])}" y="${num(-g.textAt[1])}" font-size="3.5" fill="${col}" text-anchor="middle" font-family="sans-serif" transform="rotate(${num(-deg(g.textRot))} ${P(g.textAt).replace(",", " ")})">${esc(g.text)}</text>`); } }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0 - pad)} ${num(-y1 - pad)} ${num(W)} ${num(H)}" width="${num(W)}${d.units}" height="${num(H)}${d.units}" stroke-width="${num(Math.max(W, H) / 800)}" stroke-linecap="round">\n${out.join("\n")}\n</svg>\n`;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
