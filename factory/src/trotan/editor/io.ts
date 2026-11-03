// File import/export glue for the editor. Vector parsing runs in a worker (main-thread fallback).
import { exportDxf } from "../geom/dxf";
import { exportSvg, type ImportResult } from "../geom/svg";
import { importSvg } from "../geom/svg";
import { importDxf } from "../geom/dxf";
import { I, uid, type Doc, type Layer, type Mat, type Obj } from "../geom/core";
import { readProject, writeProject, type ProjectFile } from "../geom/project";
import { drawDoc, LIGHT } from "./render";

export const IMPORT_FORMATS = [
  { ext: ".svg", label: "SVG", ok: true }, { ext: ".dxf", label: "DXF (R12–2018 ASCII)", ok: true },
  { ext: ".png", label: "PNG", ok: true }, { ext: ".jpg,.jpeg", label: "JPEG", ok: true }, { ext: ".bmp", label: "BMP", ok: true },
  { ext: ".trotan", label: "TROTAN project", ok: true },
  { ext: ".pdf", label: "PDF — not supported yet (export SVG/DXF from your PDF tool)", ok: false },
  { ext: ".ai,.eps", label: "AI / EPS — not supported (save as SVG or PDF-compatible SVG)", ok: false },
  { ext: ".cdr", label: "CorelDRAW CDR — not supported (proprietary; export SVG/DXF)", ok: false },
  { ext: ".tif,.tiff", label: "TIFF — not supported by browsers yet (export PNG)", ok: false },
];
export const ACCEPT = IMPORT_FORMATS.filter((f) => f.ok).map((f) => f.ext).join(",");

function inWorker(kind: "svg" | "dxf", text: string): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try { w = new Worker(new URL("./importWorker.ts", import.meta.url), { type: "module" }); }
    catch { try { resolve(kind === "svg" ? importSvg(text) : importDxf(text)); } catch (e) { reject(e); } return; }
    const t = setTimeout(() => { w.terminate(); reject(new Error("The file took too long to read (over 60 s)")); }, 60000);
    w.onmessage = (e) => { clearTimeout(t); w.terminate(); if (e.data.ok) resolve(e.data.result); else reject(new Error(e.data.error)); };
    w.onerror = (e) => { clearTimeout(t); w.terminate(); reject(new Error(e.message || "The file could not be read")); };
    w.postMessage({ kind, text });
  });
}
const MAX_BYTES = 60 * 1024 * 1024;
export type Imported = { kind: "vector"; result: ImportResult } | { kind: "project"; project: ProjectFile } | { kind: "image"; obj: Obj; layer: Layer; warnings: string[] };
export async function importFile(f: File, engraveLayer: Layer | undefined): Promise<Imported> {
  if (f.size > MAX_BYTES) throw new Error(`${f.name} is ${(f.size / 1048576).toFixed(0)} MB — the limit is 60 MB`);
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "svg") return { kind: "vector", result: await inWorker("svg", await f.text()) };
  if (ext === "dxf") return { kind: "vector", result: await inWorker("dxf", await f.text()) };
  if (ext === "trotan" || ext === "json") return { kind: "project", project: readProject(await f.text()) };
  if (["png", "jpg", "jpeg", "bmp"].includes(ext)) return importImage(f, engraveLayer);
  const known = IMPORT_FORMATS.find((x) => x.ext.split(",").includes("." + ext));
  throw new Error(known ? known.label : `.${ext} files are not supported`);
}
async function importImage(f: File, layer: Layer | undefined): Promise<Imported> {
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("The image could not be read")); r.readAsDataURL(f); });
  const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Not a valid image (or a format this browser cannot decode)")); i.src = url; });
  const warnings: string[] = [];
  let src = url, pxW = im.naturalWidth, pxH = im.naturalHeight;
  const MAX = 4000;
  if (Math.max(pxW, pxH) > MAX) { // keep projects manageable; record it so nobody is surprised
    const k = MAX / Math.max(pxW, pxH), c = document.createElement("canvas"); c.width = Math.round(pxW * k); c.height = Math.round(pxH * k);
    c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height); src = c.toDataURL("image/png");
    warnings.push(`The image was reduced from ${pxW}×${pxH} to ${c.width}×${c.height} px to keep the project fast.`); pxW = c.width; pxH = c.height;
  }
  const dpi = 96;
  warnings.push(`Placed at ${dpi} DPI (${(im.naturalWidth * 25.4 / dpi).toFixed(1)} × ${(im.naturalHeight * 25.4 / dpi).toFixed(1)} mm) — type the exact size in Width/Height.`);
  const lay: Layer = layer ?? { id: uid("L"), name: "Engrave", color: "#2f6bff", visible: true, locked: false, op: "raster" };
  return { kind: "image", layer: lay, warnings, obj: { id: uid(), layer: lay.id, kind: "image", src, pxW, pxH, w: (im.naturalWidth * 25.4) / dpi, h: (im.naturalHeight * 25.4) / dpi, m: [...I] as Mat, name: f.name } };
}
export function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export const safeName = (s: string) => s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "design";
export function exportAs(doc: Doc, name: string, kind: "svg" | "dxf" | "png" | "trotan", extra?: Partial<ProjectFile>) {
  const n = safeName(name);
  if (kind === "svg") return download(`${n}.svg`, exportSvg(doc), "image/svg+xml");
  if (kind === "dxf") return download(`${n}.dxf`, exportDxf(doc), "application/dxf");
  if (kind === "trotan") return download(`${n}.trotan`, writeProject({ name, doc, ...extra }), "application/json");
  // PNG at 300 DPI on white
  const k = 300 / 25.4, W = Math.max(1, Math.round(doc.width * k)), H = Math.max(1, Math.round(doc.height * k));
  if (W * H > 12e7) throw new Error("This design is too large to export as PNG at 300 DPI");
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  drawDoc(ctx, doc, { zoom: k, x: 0, y: 0 }, W, H, { theme: { ...LIGHT, bg: "#fff", page: "#fff", pageEdge: "#fff" }, sel: new Set(), hover: null, grid: 10, showGrid: false, outline: false, fills: true, redraw: () => {} });
  c.toBlob((b) => b && download(`${n}.png`, b, "image/png"), "image/png");
}
export { readProject };
