// Canvas renderer for the schematic. Reads the model; never stores state.
import type { Gfx, Label, Part, Project, Pt } from "../../core/types";
import { device } from "../../library/devices";
import { partBox, pinsOf, xf } from "../../core/geom";
import type { Connectivity } from "../../connectivity/connectivity";
import { formatEng } from "../../core/units";

export interface View { s: number; x: number; y: number } // screen = world * s + offset
export const toScreen = (v: View, p: Pt): Pt => [p[0] * v.s + v.x, p[1] * v.s + v.y];
export const toWorld = (v: View, x: number, y: number): Pt => [(x - v.x) / v.s, (y - v.y) / v.s];
export interface Theme { bg: string; paper: string; border: string; grid: string; ink: string; body: string; wire: string; pin: string; text: string; ref: string; sel: string; hover: string; net: string; junction: string; probe: string; err: string; warn: string }
export const LIGHT: Theme = { bg: "#c9cde3", paper: "#fbfaf6", border: "#8a8fa8", grid: "#c7c9d6", ink: "#1d2330", body: "#8a1f1f", wire: "#0f5a2e", pin: "#1d2330", text: "#1d2330", ref: "#0b3b8c", sel: "#e0611a", hover: "#2b7bd6", net: "#c218b8", junction: "#0f5a2e", probe: "#7a3cc8", err: "#d12020", warn: "#c98a00" };
export const GRANAT: Theme = { bg: "#080d2b", paper: "#10163d", border: "#3a4380", grid: "#2a3166", ink: "#e9ecff", body: "#ff8f7a", wire: "#3fcf8e", pin: "#cfd3f0", text: "#e9ecff", ref: "#aab3ff", sel: "#f5c85c", hover: "#7b8cff", net: "#ff6fd8", junction: "#3fcf8e", probe: "#c9a2ff", err: "#ff5d4f", warn: "#f5c85c" };
export const DEEP: Theme = { ...GRANAT, bg: "#04061a", paper: "#0a0f30", border: "#2c3570", grid: "#1f2658" };
export const DARK = GRANAT;
export type Palette = "light" | "granat" | "dark";
/** Sheet colours: paper (light, the usual drawing convention) or following the interface palette. */
export const sheetTheme = (palette: Palette, paper: boolean): Theme => (paper || palette === "light" ? LIGHT : palette === "dark" ? DEEP : GRANAT);
export const SHEET_SIZE: Record<string, Pt> = { A4: [11693, 8268], A3: [16535, 11693], A2: [23386, 16535] };
const FONT = "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, Consolas, monospace";

function gfx(ctx: CanvasRenderingContext2D, g: Gfx, s: number, ink: string) {
  ctx.beginPath();
  switch (g.k) {
    case "line": g.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); break;
    case "poly": g.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); if (g.fill) { ctx.fillStyle = ink; ctx.fill(); } ctx.stroke(); break;
    case "rect": ctx.rect(g.x, g.y, g.w, g.h); if (g.fill) { ctx.fillStyle = ink; ctx.fill(); } ctx.stroke(); break;
    case "circle": ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); if (g.fill) { ctx.fillStyle = ink; ctx.fill(); } ctx.stroke(); break;
    case "arc": ctx.arc(g.x, g.y, g.r, (g.a0 * Math.PI) / 180, (g.a1 * Math.PI) / 180); ctx.stroke(); break;
    case "text": break; // drawn upright separately
  }
  void s;
}
function upright(ctx: CanvasRenderingContext2D, v: View, at: Pt, text: string, size: number, color: string, align: CanvasTextAlign = "left", font = FONT, weight = "") {
  const [x, y] = toScreen(v, at);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.font = `${weight} ${Math.max(7, size * v.s)}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}
export interface DrawOpts { theme: Theme; sel: Set<string>; hover: string | null; hoverPin: Pt | null; netHighlight: string | null; con: Connectivity; grid: number; showGrid: boolean; probeValues: Map<string, string>; marks: { at: Pt; level: "error" | "warning" | "info"; id: string }[]; focusMark: string | null }

export function drawSheet(ctx: CanvasRenderingContext2D, pr: Project, sheetId: string, v: View, W: number, H: number, o: DrawOpts) {
  const t = o.theme, dpr = devicePixelRatio;
  const sheet = pr.sheets.find((s) => s.id === sheetId)!;
  const [sw, sh] = SHEET_SIZE[sheet.size] ?? SHEET_SIZE.A4;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
  const w = () => ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
  w();
  // paper, grid, border, title block (sheet origin at the paper centre)
  const x0 = -sw / 2, y0 = -sh / 2;
  ctx.fillStyle = t.paper; ctx.fillRect(x0, y0, sw, sh);
  if (o.showGrid && o.grid * v.s >= 6) {
    const [wx0, wy0] = toWorld(v, 0, 0), [wx1, wy1] = toWorld(v, W, H);
    ctx.fillStyle = t.grid; const r = 1.3 / v.s;
    for (let x = Math.max(x0, Math.ceil(wx0 / o.grid) * o.grid); x <= Math.min(-x0, wx1); x += o.grid)
      for (let y = Math.max(y0, Math.ceil(wy0 / o.grid) * o.grid); y <= Math.min(-y0, wy1); y += o.grid) ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.lineWidth = 6; ctx.strokeStyle = t.border; ctx.strokeRect(x0 + 200, y0 + 200, sw - 400, sh - 400);
  const tb: Pt = [-x0 - 200 - 4000, -y0 - 200 - 900];
  ctx.lineWidth = 5; ctx.strokeRect(tb[0], tb[1], 4000, 900);
  ctx.beginPath(); ctx.moveTo(tb[0], tb[1] + 450); ctx.lineTo(tb[0] + 4000, tb[1] + 450); ctx.moveTo(tb[0] + 2800, tb[1] + 450); ctx.lineTo(tb[0] + 2800, tb[1] + 900); ctx.stroke();
  upright(ctx, v, [tb[0] + 80, tb[1] + 150], "TITLE", 60, t.border); upright(ctx, v, [tb[0] + 80, tb[1] + 320], sheet.title || pr.name, 130, t.text, "left", FONT, "600");
  upright(ctx, v, [tb[0] + 80, tb[1] + 560], `${pr.name}  ·  ${sheet.name}`, 80, t.text); upright(ctx, v, [tb[0] + 80, tb[1] + 760], sheet.author ? `By ${sheet.author}` : "NUCLUES", 70, t.border);
  upright(ctx, v, [tb[0] + 2880, tb[1] + 560], `REV ${sheet.revision}`, 80, t.text); upright(ctx, v, [tb[0] + 2880, tb[1] + 760], `Project rev ${pr.revision}`, 70, t.border);
  w();
  // wires
  const lw = Math.max(8, 1.6 / v.s);
  for (const wr of pr.wires) {
    if (wr.sheet !== sheetId) continue;
    const net = o.con.wireNet.get(wr.id); const hl = net && net === o.netHighlight;
    ctx.strokeStyle = o.sel.has(wr.id) ? t.sel : hl ? t.net : o.hover === wr.id ? t.hover : t.wire;
    ctx.lineWidth = hl || o.sel.has(wr.id) ? lw * 1.8 : lw; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath(); wr.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  }
  ctx.fillStyle = t.junction;
  for (const j of o.con.junctions) if (j.sheet === sheetId) { ctx.beginPath(); ctx.arc(j.at[0], j.at[1], Math.max(22, 3.5 / v.s), 0, Math.PI * 2); ctx.fill(); }
  // parts
  for (const p of pr.parts) if (p.sheet === sheetId) drawPart(ctx, p, v, o, false);
  // terminals / labels
  for (const l of pr.labels) if (l.sheet === sheetId) drawLabel(ctx, l, v, o);
  // probes
  for (const pb of pr.probes) if (pb.sheet === sheetId) {
    w(); const [x, y] = pb.at; const c = o.sel.has(pb.id) ? t.sel : t.probe;
    ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60, y - 120); ctx.lineTo(x + 120, y - 60); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 90, y - 90); ctx.lineTo(x + 200, y - 200); ctx.stroke();
    const val = o.probeValues.get(pb.id);
    upright(ctx, v, [x + 220, y - 220], `${pb.name}${val ? `: ${val}` : ""}`, 90, c, "left", MONO, "600");
  }
  // diagnostics
  for (const m of o.marks) {
    const [x, y] = toScreen(v, m.at); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = m.level === "error" ? t.err : m.level === "warning" ? t.warn : t.hover; const r = m.id === o.focusMark ? 13 : 8;
    ctx.strokeStyle = col; ctx.lineWidth = m.id === o.focusMark ? 3 : 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.6, y - r * 0.6); ctx.lineTo(x + r * 0.6, y + r * 0.6); ctx.moveTo(x + r * 0.6, y - r * 0.6); ctx.lineTo(x - r * 0.6, y + r * 0.6); ctx.stroke();
  }
  if (o.hoverPin) { const [x, y] = toScreen(v, o.hoverPin); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.strokeStyle = t.hover; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 6, 12, 12); }
}
export function drawPart(ctx: CanvasRenderingContext2D, p: Part, v: View, o: Pick<DrawOpts, "theme" | "sel" | "hover" | "netHighlight" | "con">, ghost: boolean) {
  const t = o.theme, dpr = devicePixelRatio, d = device(p.device);
  const selected = o.sel.has(p.id), hov = o.hover === p.id;
  ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
  ctx.save(); ctx.translate(p.at[0], p.at[1]); ctx.rotate((-p.rot * Math.PI) / 180); ctx.scale(p.mirror ? -1 : 1, 1);
  ctx.globalAlpha = ghost ? 0.55 : 1;
  const ink = selected ? t.sel : hov ? t.hover : t.body;
  ctx.strokeStyle = ink; ctx.lineWidth = Math.max(10, 1.5 / v.s); ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const g of d.symbol.gfx) gfx(ctx, g, v.s, ink);
  // pins
  for (const pin of d.symbol.pins) {
    const net = o.con.pinNet.get(`${p.id}:${pin.num}`); const hl = net && net === o.netHighlight;
    const dx = [1, 0, -1, 0][pin.dir / 90], dy = [0, 1, 0, -1][pin.dir / 90];
    ctx.strokeStyle = hl ? t.net : selected ? t.sel : t.pin; ctx.lineWidth = Math.max(9, 1.3 / v.s);
    ctx.beginPath(); ctx.moveTo(pin.at[0], pin.at[1]); ctx.lineTo(pin.at[0] + dx * pin.len, pin.at[1] + dy * pin.len); ctx.stroke();
  }
  ctx.restore(); ctx.globalAlpha = ghost ? 0.55 : 1;
  for (const g of d.symbol.gfx) if (g.k === "text") upright(ctx, v, xf([g.x, g.y], p.rot, p.mirror, p.at), g.text, g.size ?? 60, ink, g.anchor === "middle" ? "center" : "left");
  // pin numbers/names for ICs and connectors
  if (v.s > 0.05) for (const pin of d.symbol.pins) {
    if (pin.hideName && d.category !== "Analog IC") continue;
    const inner = [pin.at[0] + [1, 0, -1, 0][pin.dir / 90] * pin.len * 0.5, pin.at[1] + [0, 1, 0, -1][pin.dir / 90] * pin.len * 0.5 - 35] as Pt;
    upright(ctx, v, xf(inner, p.rot, p.mirror, p.at), pin.num, 45, t.border, "center", MONO);
  }
  // text stays upright: on parts turned by 90°/270° it goes beside the body instead of rotating with the symbol
  const turned = p.rot === 90 || p.rot === 270; const bb = partBox(p); const cy = (bb.y0 + bb.y1) / 2;
  const refAt: Pt = turned ? [bb.x1 + 50, cy - 55] : xf(d.symbol.refAt, p.rot, p.mirror, p.at), valAt: Pt = turned ? [bb.x1 + 50, cy + 55] : xf(d.symbol.valueAt, p.rot, p.mirror, p.at);
  const dx = refAt[0] - p.at[0]; // text placed beside the body reads away from it; text above/below stays centred
  const align: CanvasTextAlign = turned || dx > 20 ? "left" : dx < -20 ? "right" : "center";
  upright(ctx, v, p.refOffset ? [p.at[0] + p.refOffset[0], p.at[1] + p.refOffset[1]] : refAt, p.ref, 80, selected ? t.sel : t.ref, align, FONT, "600");
  const value = p.props.value ?? d.name;
  upright(ctx, v, p.valueOffset ? [p.at[0] + p.valueOffset[0], p.at[1] + p.valueOffset[1]] : valAt, d.interactive === "switch" ? `${value === d.name ? "" : value} ${p.state?.closed ? "[ON]" : "[OFF]"}`.trim() : d.interactive === "pot" ? `${value} @${Math.round((p.state?.position ?? 0.5) * 100)}%` : value, 70, t.text, align);
  ctx.globalAlpha = 1;
  if (selected) { const b = partBox(p); ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y); ctx.strokeStyle = t.sel; ctx.lineWidth = 1 / v.s; ctx.setLineDash([6 / v.s, 4 / v.s]); ctx.strokeRect(b.x0 - 30, b.y0 - 30, b.x1 - b.x0 + 60, b.y1 - b.y0 + 60); ctx.setLineDash([]); }
}
export function drawLabel(ctx: CanvasRenderingContext2D, l: Label, v: View, o: Pick<DrawOpts, "theme" | "sel" | "hover" | "netHighlight" | "con">) {
  const t = o.theme, dpr = devicePixelRatio; const [x, y] = l.at; const sel = o.sel.has(l.id);
  const c = sel ? t.sel : o.hover === l.id ? t.hover : l.kind === "net" ? t.wire : t.ink;
  ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y); ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = Math.max(10, 1.5 / v.s);
  if (l.kind === "ground") {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 100); ctx.moveTo(x - 100, y + 100); ctx.lineTo(x + 100, y + 100); ctx.moveTo(x - 60, y + 140); ctx.lineTo(x + 60, y + 140); ctx.moveTo(x - 25, y + 180); ctx.lineTo(x + 25, y + 180); ctx.stroke();
  } else if (l.kind === "power") {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 100); ctx.moveTo(x - 80, y - 100); ctx.lineTo(x + 80, y - 100); ctx.stroke();
    upright(ctx, v, [x, y - 170], l.name, 80, c, "center", FONT, "600");
  } else {
    ctx.beginPath(); ctx.arc(x, y, Math.max(12, 2 / v.s), 0, Math.PI * 2); ctx.fill();
    upright(ctx, v, [x + 30, y - 60], l.name, 80, c, "left", FONT, "600");
  }
}
/** Hit-test: topmost part, then label, probe, wire. */
export function hit(pr: Project, sheet: string, p: Pt, tol: number): { id: string; kind: "part" | "wire" | "label" | "probe" } | null {
  for (let i = pr.probes.length - 1; i >= 0; i--) { const q = pr.probes[i]; if (q.sheet === sheet && p[0] >= q.at[0] - tol && p[0] <= q.at[0] + 220 && p[1] >= q.at[1] - 220 && p[1] <= q.at[1] + tol) return { id: q.id, kind: "probe" }; }
  for (let i = pr.labels.length - 1; i >= 0; i--) { const l = pr.labels[i]; if (l.sheet !== sheet) continue; const box = l.kind === "ground" ? [l.at[0] - 110, l.at[1] - tol, l.at[0] + 110, l.at[1] + 190] : l.kind === "power" ? [l.at[0] - 120, l.at[1] - 220, l.at[0] + 120, l.at[1] + tol] : [l.at[0] - tol, l.at[1] - 110, l.at[0] + 60 * l.name.length + 60, l.at[1] + tol]; if (p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3]) return { id: l.id, kind: "label" }; }
  for (let i = pr.parts.length - 1; i >= 0; i--) { const q = pr.parts[i]; if (q.sheet !== sheet) continue; const b = partBox(q); if (p[0] >= b.x0 - tol && p[0] <= b.x1 + tol && p[1] >= b.y0 - tol && p[1] <= b.y1 + tol) {
    // prefer pins' wires: if exactly on a pin end, still the part
    return { id: q.id, kind: "part" }; } }
  for (const w of pr.wires) { if (w.sheet !== sheet) continue; for (let i = 1; i < w.pts.length; i++) if (distSeg(p, w.pts[i - 1], w.pts[i]) <= tol) return { id: w.id, kind: "wire" }; }
  return null;
}
export function distSeg(p: Pt, a: Pt, b: Pt) { const dx = b[0] - a[0], dy = b[1] - a[1]; const L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
export function pinNear(pr: Project, sheet: string, p: Pt, tol: number): Pt | null {
  let best: Pt | null = null, bd = tol;
  for (const q of pr.parts) if (q.sheet === sheet) for (const pin of pinsOf(q)) { const d = Math.hypot(pin.at[0] - p[0], pin.at[1] - p[1]); if (d <= bd) { bd = d; best = pin.at; } }
  return best;
}
export const fmtV = (v: number) => formatEng(v, "V", 4);
