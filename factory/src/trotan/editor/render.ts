import { previewCanvas } from "./rasterPreview";
// Canvas 2D renderer with cached Path2D per object (immutable objects → WeakMap cache), hit testing,
// rulers and guides. World units are mm; screen = world × zoom + offset.
import { boxOfPaths, leaves, localPaths, pathData, transformPaths, type Box, type Doc, type Mat, type Obj, type OpType, type Vec } from "../geom/core";

export interface View { zoom: number; x: number; y: number }
export const toWorld = (v: View, sx: number, sy: number): Vec => [(sx - v.x) / v.zoom, (sy - v.y) / v.zoom];
export const toScreen = (v: View, p: Vec): Vec => [p[0] * v.zoom + v.x, p[1] * v.zoom + v.y];
export const RULER = 22;

const cache = new WeakMap<Obj, { key: string; path: Path2D; box: Box | null }>();
export function geomOf(o: Obj, m: Mat) {
  const key = m.join(",");
  const c = cache.get(o);
  if (c && c.key === key) return c;
  const ps = transformPaths(localPaths(o), m);
  const r = { key, path: new Path2D(pathData(ps)), box: boxOfPaths(ps) };
  cache.set(o, r); return r;
}

const images = new Map<string, HTMLImageElement>();
export function imageFor(src: string, onload: () => void) {
  let im = images.get(src);
  if (!im) { im = new Image(); im.onload = onload; im.src = src; images.set(src, im); }
  return im;
}
export interface Theme { bg: string; page: string; pageEdge: string; grid: string; gridMajor: string; ruler: string; rulerText: string; sel: string; guide: string; text: string }
// Canvas colours for the three ecosystem palettes.
export const GRANAT: Theme = { bg: "#080d2b", page: "#10163d", pageEdge: "#2c3570", grid: "rgba(255,255,255,.05)", gridMajor: "rgba(255,255,255,.10)", ruler: "#0e1440", rulerText: "#8a91c4", sel: "#5868e6", guide: "#f5c85c", text: "#ffffff" };
export const DEEP: Theme = { bg: "#04061a", page: "#0c1233", pageEdge: "#232c70", grid: "rgba(255,255,255,.045)", gridMajor: "rgba(255,255,255,.09)", ruler: "#080c28", rulerText: "#8a91c4", sel: "#5868e6", guide: "#f5c85c", text: "#ffffff" };
export const LIGHT: Theme = { bg: "#e9ebf6", page: "#ffffff", pageEdge: "#c9cde3", grid: "rgba(11,16,51,.05)", gridMajor: "rgba(11,16,51,.10)", ruler: "#f3f4fa", rulerText: "#676d96", sel: "#3b4cca", guide: "#9a6400", text: "#0b1033" };
export const DARK = GRANAT;
export type Palette = "light" | "granat" | "dark";
export const canvasTheme = (p: Palette): Theme => (p === "light" ? LIGHT : p === "dark" ? DEEP : GRANAT);

export interface DrawOpts { theme: Theme; sel: Set<string>; hover: string | null; grid: number; showGrid: boolean; outline: boolean; fills: boolean; redraw: () => void; layerFilter?: (id: string) => boolean }
const OP_FILL: Partial<Record<OpType, boolean>> = { raster: true };
/** Draw page, grid and the design. */
export function drawDoc(ctx: CanvasRenderingContext2D, doc: Doc, v: View, W: number, H: number, o: DrawOpts) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = o.theme.bg; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(v.zoom, 0, 0, v.zoom, v.x, v.y);
  ctx.fillStyle = o.theme.page; ctx.fillRect(0, 0, doc.width, doc.height);
  if (o.showGrid && o.grid * v.zoom >= 4) {
    const [x0, y0] = toWorld(v, 0, 0), [x1, y1] = toWorld(v, W, H);
    const g = o.grid, sx = Math.max(0, Math.floor(x0 / g) * g), sy = Math.max(0, Math.floor(y0 / g) * g);
    ctx.lineWidth = 1 / v.zoom;
    for (const major of [false, true]) {
      ctx.beginPath(); ctx.strokeStyle = major ? o.theme.gridMajor : o.theme.grid;
      for (let x = sx; x <= Math.min(x1, doc.width); x += g) { const isM = Math.abs((x / g) % 10) < 1e-6; if (isM === major) { ctx.moveTo(x, 0); ctx.lineTo(x, doc.height); } }
      for (let y = sy; y <= Math.min(y1, doc.height); y += g) { const isM = Math.abs((y / g) % 10) < 1e-6; if (isM === major) { ctx.moveTo(0, y); ctx.lineTo(doc.width, y); } }
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1 / v.zoom; ctx.strokeStyle = o.theme.pageEdge; ctx.strokeRect(0, 0, doc.width, doc.height);
  const layers = new Map(doc.layers.map((l) => [l.id, l]));
  const [vx0, vy0] = toWorld(v, 0, 0), [vx1, vy1] = toWorld(v, W, H);
  for (const { o: ob, m, top } of leaves(doc.objects)) {
    if (top.hidden || ob.hidden) continue;
    const layer = layers.get(top.kind === "group" ? ob.layer : top.layer) ?? layers.get(ob.layer);
    if (!layer || !layer.visible || (o.layerFilter && !o.layerFilter(layer.id))) continue;
    const g = geomOf(ob, m);
    if (g.box && (g.box.x > vx1 || g.box.y > vy1 || g.box.x + g.box.w < vx0 || g.box.y + g.box.h < vy0)) continue; // off screen
    const op = ob.op ?? top.op ?? layer.op;
    if (ob.kind === "image") {
      const im = imageFor(ob.src, o.redraw);
      // engraved images show what the laser will burn (dithered at the engraving look); others show the original
      const pv = op === "raster" ? previewCanvas(ob.src, ob.w * Math.hypot(m[0], m[1]), ob.h * Math.hypot(m[2], m[3]), ob.proc, o.redraw) : null;
      if (pv || (im.complete && im.naturalWidth)) { ctx.save(); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]); ctx.globalAlpha = op === "none" ? 0.35 : 1; if (pv) ctx.imageSmoothingEnabled = false; ctx.drawImage(pv ?? im, 0, 0, ob.w, ob.h); ctx.restore(); }
      ctx.lineWidth = 1 / v.zoom; ctx.strokeStyle = layer.color; ctx.setLineDash([4 / v.zoom, 3 / v.zoom]); ctx.stroke(g.path); ctx.setLineDash([]);
      continue;
    }
    if (o.fills && !o.outline && (OP_FILL[op] || ob.kind === "text" && op !== "cut")) { ctx.fillStyle = hexA(layer.color, 0.28); ctx.fill(g.path, "evenodd"); }
    const isSel = o.sel.has(top.id), isHover = o.hover === top.id;
    ctx.lineWidth = (isSel || isHover ? 1.6 : 1) / v.zoom;
    ctx.strokeStyle = op === "none" ? hexA(layer.color, 0.4) : layer.color;
    ctx.stroke(g.path);
  }
}
export function hexA(hex: string, a: number) { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

/** Top-level object under a world point (topmost first). Strokes within tol mm, insides of closed shapes and images. */
export function hitTest(ctx: CanvasRenderingContext2D, doc: Doc, p: Vec, tol: number): string | null {
  const layers = new Map(doc.layers.map((l) => [l.id, l]));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineWidth = tol * 2;
  try {
    for (let i = doc.objects.length - 1; i >= 0; i--) {
      const top = doc.objects[i];
      const l = layers.get(top.layer); if (top.hidden || !l?.visible || l.locked || top.locked) continue;
      for (const { o, m } of leaves([top])) {
        const g = geomOf(o, m);
        if (!g.box || p[0] < g.box.x - tol || p[0] > g.box.x + g.box.w + tol || p[1] < g.box.y - tol || p[1] > g.box.y + g.box.h + tol) continue;
        if (ctx.isPointInStroke(g.path, p[0], p[1]) || ctx.isPointInPath(g.path, p[0], p[1], "evenodd")) return top.id;
      }
    }
  } finally { ctx.restore(); }
  return null;
}

/** Rulers (mm) along the top and left edges. */
export function drawRulers(ctx: CanvasRenderingContext2D, v: View, W: number, H: number, t: Theme, cursor: Vec | null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = t.ruler; ctx.fillRect(0, 0, W, RULER); ctx.fillRect(0, 0, RULER, H);
  ctx.strokeStyle = t.rulerText; ctx.fillStyle = t.rulerText; ctx.font = "10px 'Cabinet Grotesk', Poppins, sans-serif"; ctx.lineWidth = 1;
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const step = steps.find((s) => s * v.zoom >= 50) ?? 1000, minor = step / (step % 5 === 0 ? 5 : 2);
  ctx.beginPath();
  const [x0, y0] = toWorld(v, RULER, RULER), [x1, y1] = toWorld(v, W, H);
  for (let x = Math.floor(x0 / minor) * minor; x <= x1; x += minor) { const sx = Math.round(x * v.zoom + v.x) + 0.5; const big = Math.abs(x / step - Math.round(x / step)) < 1e-6; ctx.moveTo(sx, RULER); ctx.lineTo(sx, big ? 6 : 15); if (big) ctx.fillText(String(Math.round(x)), sx + 3, 10); }
  for (let y = Math.floor(y0 / minor) * minor; y <= y1; y += minor) { const sy = Math.round(y * v.zoom + v.y) + 0.5; const big = Math.abs(y / step - Math.round(y / step)) < 1e-6; ctx.moveTo(RULER, sy); ctx.lineTo(big ? 6 : 15, sy); if (big) { ctx.save(); ctx.translate(10, sy + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(String(Math.round(y)), 0, 0); ctx.restore(); } }
  ctx.stroke();
  if (cursor) { const [sx, sy] = toScreen(v, cursor); ctx.strokeStyle = t.sel; ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, RULER); ctx.moveTo(0, sy); ctx.lineTo(RULER, sy); ctx.stroke(); }
  ctx.fillStyle = t.ruler; ctx.fillRect(0, 0, RULER, RULER);
}
