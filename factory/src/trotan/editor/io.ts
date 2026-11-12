// File import/export glue for the editor. Vector parsing runs in a worker (main-thread fallback).
import { exportDxf } from "../geom/dxf";
import { exportSvg, type ImportResult } from "../geom/svg";
import { importSvg } from "../geom/svg";
import { importDxf } from "../geom/dxf";
import { I, uid, type Doc, type Layer, type Mat, type Obj } from "../geom/core";
import { readProject, writeProject, type ProjectFile } from "../geom/project";
import { drawDoc, LIGHT } from "./render";
import { detect, defaultRegistry, type Detection } from "../../../../packages/sk-formats/src/index.ts";

export const IMPORT_FORMATS = [
  { ext: ".svg,.svgz", label: "SVG / SVGZ", ok: true }, { ext: ".dxf", label: "DXF (R12–2018 ASCII)", ok: true },
  { ext: ".png", label: "PNG", ok: true }, { ext: ".jpg,.jpeg", label: "JPEG", ok: true }, { ext: ".bmp", label: "BMP", ok: true }, { ext: ".gif", label: "GIF (first frame)", ok: true }, { ext: ".webp", label: "WebP", ok: true },
  { ext: ".trotan", label: "TROTAN project", ok: true },
  { ext: ".cdr,.cdt", label: "CorelDRAW CDR — recognised with its version; import coming next", ok: false },
  { ext: ".cmx", label: "Corel CMX — recognised; import coming with CDR", ok: false },
  { ext: ".pdf,.ai", label: "PDF / Illustrator — recognised; vector import planned", ok: false },
  { ext: ".eps", label: "EPS — recognised; not supported (save as SVG or PDF)", ok: false },
  { ext: ".dwg", label: "DWG — recognised; needs a licensed DWG library (save as DXF)", ok: false },
  { ext: ".tif,.tiff", label: "TIFF — recognised; browsers cannot decode it (export PNG)", ok: false },
  { ext: ".psd", label: "Photoshop PSD — recognised; not supported yet (export PNG)", ok: false },
  { ext: ".plt,.hpgl", label: "HPGL / PLT — recognised; import planned", ok: false },
];
/** Every extension TROTAN recognises, so recognised-but-unsupported files can still be picked and get a precise answer. */
export const ACCEPT = IMPORT_FORMATS.map((f) => f.ext).join(",");
const REG = defaultRegistry();
/** Browser DEFLATE decompression with an output limit (zip-bomb protection). */
async function inflate(data: Uint8Array, max: number, kind: "deflate-raw" | "gzip" = "deflate-raw"): Promise<Uint8Array> {
  const r = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(kind)).getReader(); const parts: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; n += value.length; if (n > max) { await r.cancel(); throw new Error(`Decompressed data is larger than ${(max / 1048576).toFixed(0)} MB`); } parts.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
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
export type Imported = ({ kind: "vector"; result: ImportResult } | { kind: "project"; project: ProjectFile } | { kind: "image"; obj: Obj; layer: Layer; warnings: string[] }) & { detection: Detection };
/** Identify the file by its content (never by its name alone), then use the matching importer or explain precisely why not. */
export async function importFile(f: File, engraveLayer: Layer | undefined): Promise<Imported> {
  if (f.size > MAX_BYTES) throw new Error(`${f.name} is ${(f.size / 1048576).toFixed(0)} MB — the limit is 60 MB`);
  const bytes = new Uint8Array(await f.arrayBuffer());
  const d = await detect(bytes, f.name, { inflateRaw: (x, max) => inflate(x, max) });
  const named = d.extensionMismatch ? [`${f.name} is really a ${d.label} file (the name says otherwise); it was read as ${d.label}.`] : [];
  const text = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
  const vector = (result: ImportResult): Imported => ({ kind: "vector", result: { ...result, warnings: [...named, ...result.warnings] }, detection: d });
  switch (d.format) {
    case "svg": return vector(await inWorker("svg", text(bytes)));
    case "svgz": return vector(await inWorker("svg", text(await inflate(bytes, MAX_BYTES * 4, "gzip"))));
    case "dxf": return vector(await inWorker("dxf", text(bytes)));
    case "trotan-project": return { kind: "project", project: readProject(text(bytes)), detection: d };
    case "png": case "jpeg": case "bmp": case "gif": case "webp": { const r = await importImage(f, engraveLayer); return { ...r, warnings: [...named, ...r.warnings], detection: d } as Imported; }
  }
  const what = `${d.label}${d.version ? ` (${d.version})` : ""}`;
  if (d.format === "unknown" || d.format === "zip") throw new Error(`${f.name}: not a file TROTAN recognises${d.notes[0] ? ` — ${d.notes[0]}` : ""}. Nothing was imported.`);
  const a = REG.all("trotan").find((x) => x.formats.includes(d.format));
  throw new Error(`${f.name} is a ${what} file. ${a?.limitations[0] ?? "TROTAN cannot import it yet."} Nothing was imported.`);
}
async function importImage(f: File, layer: Layer | undefined): Promise<{ kind: "image"; obj: Obj; layer: Layer; warnings: string[] }> {
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
