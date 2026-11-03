// Raster engraving image processing: greyscale, brightness/contrast/gamma/invert, resampling to the engraving
// resolution, and halftoning (threshold, error-diffusion dithers, ordered Bayer) or greyscale (power follows tone).
// Pure functions on plain arrays so they run in tests, workers and the browser alike. 0 = full burn (black), 255 = none.

export type RasterMode = "threshold" | "floyd" | "jarvis" | "stucki" | "atkinson" | "sierra" | "ordered" | "grey";
export const RASTER_MODES: { v: RasterMode; label: string; hint: string }[] = [
  { v: "floyd", label: "Floyd–Steinberg", hint: "Photos: fine, even grain (the usual choice)" },
  { v: "jarvis", label: "Jarvis–Judice–Ninke", hint: "Photos: smoother, wider spread" },
  { v: "stucki", label: "Stucki", hint: "Photos: sharp, clean" },
  { v: "atkinson", label: "Atkinson", hint: "High contrast, light shadows" },
  { v: "sierra", label: "Sierra", hint: "Between Floyd and Jarvis" },
  { v: "ordered", label: "Ordered (Bayer 8×8)", hint: "Regular pattern, good on wood" },
  { v: "threshold", label: "Black and white", hint: "Logos and text" },
  { v: "grey", label: "Greyscale (3D / power)", hint: "Power follows the tone: depth engraving" },
];
export interface RasterProc { mode: RasterMode; brightness: number; contrast: number; gamma: number; invert: boolean; threshold: number }
export const DEFAULT_PROC: RasterProc = { mode: "floyd", brightness: 0, contrast: 0, gamma: 1, invert: false, threshold: 128 };
export interface Grey { w: number; h: number; px: Uint8ClampedArray }

/** RGBA → luminance (Rec. 601); transparent pixels become white (not engraved). */
export function toGrey(rgba: Uint8ClampedArray | number[], w: number, h: number): Grey {
  const px = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255; const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    px[i] = Math.round(y * a + 255 * (1 - a));
  }
  return { w, h, px };
}
/** Area-average resampling (downscale) / nearest (upscale) to w × h. */
export function resample(g: Grey, w: number, h: number): Grey {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); const px = new Uint8ClampedArray(w * h);
  const sx = g.w / w, sy = g.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = x * sx, x1 = (x + 1) * sx, y0 = y * sy, y1 = (y + 1) * sy;
    if (sx <= 1 && sy <= 1) { px[y * w + x] = g.px[Math.min(g.h - 1, Math.floor(y0)) * g.w + Math.min(g.w - 1, Math.floor(x0))]; continue; }
    let s = 0, a = 0;
    for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
      const wx = Math.min(x1, xx + 1) - Math.max(x0, xx), wy = Math.min(y1, yy + 1) - Math.max(y0, yy), k = wx * wy;
      s += g.px[Math.min(g.h - 1, yy) * g.w + Math.min(g.w - 1, xx)] * k; a += k;
    }
    px[y * w + x] = Math.round(s / a);
  }
  return { w, h, px };
}
/** Brightness (−100…100), contrast (−100…100), gamma (0.2…5, >1 lightens mid-tones), invert. */
export function adjust(g: Grey, p: Pick<RasterProc, "brightness" | "contrast" | "gamma" | "invert">): Grey {
  const lut = new Uint8ClampedArray(256); const c = (259 * (p.contrast * 2.55 + 255)) / (255 * (259 - p.contrast * 2.55));
  for (let v = 0; v < 256; v++) {
    let x = v + p.brightness * 2.55; x = c * (x - 128) + 128; x = 255 * Math.pow(Math.min(1, Math.max(0, x / 255)), 1 / p.gamma); if (p.invert) x = 255 - x;
    lut[v] = Math.round(x);
  }
  const px = new Uint8ClampedArray(g.px.length); for (let i = 0; i < px.length; i++) px[i] = lut[g.px[i]];
  return { w: g.w, h: g.h, px };
}
// error-diffusion kernels: [dx, dy, weight], divisor
const KERNELS: Record<"floyd" | "jarvis" | "stucki" | "atkinson" | "sierra", { k: [number, number, number][]; d: number }> = {
  floyd: { k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]], d: 16 },
  jarvis: { k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]], d: 48 },
  stucki: { k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]], d: 42 },
  atkinson: { k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]], d: 8 }, // only 6/8 of the error is spread
  sierra: { k: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]], d: 32 },
};
const BAYER8 = (() => { const m = [[0]]; let b = m; for (let n = 1; n < 8; n *= 2) { const s = b.length, nb: number[][] = []; for (let y = 0; y < 2 * s; y++) { nb.push([]); for (let x = 0; x < 2 * s; x++) { const q = [[0, 2], [3, 1]][y >= s ? 1 : 0][x >= s ? 1 : 0]; nb[y].push(4 * b[y % s][x % s] + q); } } b = nb; } return b; })();

/** Halftone or greyscale: returns 0 (burn) / 255 (no burn) for halftone modes; 0…255 levels for "grey". */
export function halftone(g: Grey, mode: RasterMode, threshold = 128, serpentine = true): Grey {
  const { w, h } = g; const out = new Uint8ClampedArray(w * h);
  if (mode === "grey") { out.set(g.px); return { w, h, px: out }; }
  if (mode === "threshold") { for (let i = 0; i < out.length; i++) out[i] = g.px[i] < threshold ? 0 : 255; return { w, h, px: out }; }
  if (mode === "ordered") { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = g.px[y * w + x] < ((BAYER8[y & 7][x & 7] + 0.5) * 255) / 64 ? 0 : 255; return { w, h, px: out }; }
  const K = KERNELS[mode]; const buf = new Float32Array(w * h); for (let i = 0; i < buf.length; i++) buf[i] = g.px[i];
  for (let y = 0; y < h; y++) {
    const rev = serpentine && y % 2 === 1;
    for (let k = 0; k < w; k++) {
      const x = rev ? w - 1 - k : k, i = y * w + x, old = buf[i], nv = old < threshold ? 0 : 255, err = old - nv; out[i] = nv;
      for (const [dx, dy, wt] of K.k) { const xx = x + (rev ? -dx : dx), yy = y + dy; if (xx >= 0 && xx < w && yy < h) buf[yy * w + xx] += (err * wt) / K.d; }
    }
  }
  return { w, h, px: out };
}
/** Full pipeline at the engraving resolution: w_mm × h_mm at dpi. */
export function processRaster(src: Grey, wMm: number, hMm: number, dpi: number, p: RasterProc): Grey {
  const tw = Math.max(1, Math.round((wMm / 25.4) * dpi)), th = Math.max(1, Math.round((hMm / 25.4) * dpi));
  return halftone(adjust(resample(src, tw, th), p), p.mode, p.threshold);
}
/** Share of the area that is burned (0…1); for grey, the mean burn level. */
export const coverage = (g: Grey) => { let s = 0; for (const v of g.px) s += 255 - v; return s / (255 * g.px.length); };
/** Engraving lines and their burned lengths: rows with nothing to burn are skipped; each row runs from its first to last burn pixel. */
export function rasterLines(g: Grey, dpi: number): { lines: number; lengthMm: number } {
  let lines = 0, len = 0; const pxMm = 25.4 / dpi;
  for (let y = 0; y < g.h; y++) { let a = -1, b = -1; for (let x = 0; x < g.w; x++) if (g.px[y * g.w + x] < 255) { if (a < 0) a = x; b = x; } if (a >= 0) { lines++; len += (b - a + 1) * pxMm; } }
  return { lines, lengthMm: len };
}
/** Engraving time (s): burned line lengths at speed, plus per-line turnaround with overscan (acceleration distance). */
export function rasterSeconds(g: Grey, dpi: number, speedMmS: number, accel: number): number {
  const { lines, lengthMm } = rasterLines(g, dpi); const over = (speedMmS * speedMmS) / (2 * accel); // distance to reach speed
  return lengthMm / speedMmS + lines * ((2 * over) / speedMmS + (2 * speedMmS) / accel);
}
/** Grey → RGBA for drawing/export (burn shown black on white, or with an engraving tint). */
export function toRGBA(g: Grey, tint: [number, number, number] = [0, 0, 0]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.px.length; i++) { const k = g.px[i] / 255; out[i * 4] = Math.round(tint[0] + (255 - tint[0]) * k); out[i * 4 + 1] = Math.round(tint[1] + (255 - tint[1]) * k); out[i * 4 + 2] = Math.round(tint[2] + (255 - tint[2]) * k); out[i * 4 + 3] = 255; }
  return out;
}
