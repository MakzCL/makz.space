// Browser side of raster processing: decode an image once, process it at a given DPI, cache the result as a canvas
// (editor preview) or PNG data URL (machine bed file). The maths lives in geom/raster.ts.
import { DEFAULT_PROC, processRaster, toGrey, toRGBA, type Grey, type RasterProc } from "../geom/raster";

const decoded = new Map<string, Promise<Grey>>();
export function decode(src: string): Promise<Grey> {
  let p = decoded.get(src);
  if (!p) {
    p = new Promise<Grey>((ok, bad) => { const im = new Image(); im.onload = () => { const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext("2d")!; x.drawImage(im, 0, 0); ok(toGrey(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height)); }; im.onerror = () => bad(new Error("Image could not be read")); im.src = src; });
    decoded.set(src, p);
  }
  return p;
}
function canvasOf(g: Grey): HTMLCanvasElement { const c = document.createElement("canvas"); c.width = g.w; c.height = g.h; c.getContext("2d")!.putImageData(new ImageData(toRGBA(g) as unknown as Uint8ClampedArray<ArrayBuffer>, g.w, g.h), 0, 0); return c; }
const procKey = (p: RasterProc) => `${p.mode}|${p.brightness}|${p.contrast}|${p.gamma}|${p.invert ? 1 : 0}|${p.threshold}`;

/** Preview DPI: the engraving look at up to ~1.2 megapixels. */
export const previewDpi = (wMm: number, hMm: number) => Math.max(50, Math.min(254, Math.floor(Math.sqrt(1.2e6 / ((wMm / 25.4) * (hMm / 25.4))))));
const previews = new Map<string, HTMLCanvasElement | "busy">();
/** Processed preview canvas if ready; otherwise starts it and calls onReady when done. */
export function previewCanvas(src: string, wMm: number, hMm: number, proc: RasterProc | undefined, onReady: () => void): HTMLCanvasElement | null {
  const p = proc ?? DEFAULT_PROC; const dpi = previewDpi(wMm, hMm); const key = `${src.length}:${src.slice(-48)}|${wMm.toFixed(3)}x${hMm.toFixed(3)}|${dpi}|${procKey(p)}`;
  const hit = previews.get(key); if (hit && hit !== "busy") return hit; if (hit === "busy") return null;
  previews.set(key, "busy");
  void decode(src).then((g) => { previews.set(key, canvasOf(processRaster(g, wMm, hMm, dpi, p))); if (previews.size > 40) previews.delete(previews.keys().next().value!); onReady(); }, () => previews.delete(key));
  return null;
}
/** The processed image at the job's engraving DPI as a PNG data URL (what the machine receives). */
export async function processedPng(src: string, wMm: number, hMm: number, dpi: number, proc: RasterProc | undefined): Promise<{ url: string; grey: Grey }> {
  const g = processRaster(await decode(src), wMm, hMm, dpi, proc ?? DEFAULT_PROC); return { url: canvasOf(g).toDataURL("image/png"), grey: g };
}
