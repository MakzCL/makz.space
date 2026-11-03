// Raster processing tests (laser engraving image pipeline). Run: npm run test:trotan
import { test } from "node:test";
import assert from "node:assert/strict";
import { adjust, coverage, halftone, processRaster, rasterLines, rasterSeconds, resample, toGrey, type Grey } from "../../src/trotan/geom/raster";

const flat = (w: number, h: number, v: number): Grey => ({ w, h, px: new Uint8ClampedArray(w * h).fill(v) });
const ramp = (w: number, h: number): Grey => { const g = flat(w, h, 0); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g.px[y * w + x] = Math.round((x / (w - 1)) * 255); return g; };
const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: expected ${b} ±${eps}, got ${a}`);

test("greyscale: Rec. 601 luminance; transparent pixels are white (not engraved)", () => {
  const g = toGrey([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0], 4, 1);
  assert.deepEqual([...g.px], [76, 150, 29, 255]);
});
test("error-diffusion dithers keep the average tone (50 % grey → about half the pixels burned)", () => {
  for (const m of ["floyd", "jarvis", "stucki", "sierra"] as const) near(coverage(halftone(flat(200, 200, 128), m)), 0.5, 0.01, m);
  near(coverage(halftone(flat(200, 200, 64), "floyd")), 0.75, 0.01, "25 % grey → 75 % burned");
  // Atkinson spreads only 6/8 of the error: light and dark extremes clip, mid-grey stays close
  near(coverage(halftone(flat(200, 200, 128), "atkinson")), 0.5, 0.03, "atkinson");
});
test("ordered (Bayer 8×8): exact coverage for 64 tone levels", () => {
  for (const v of [32, 96, 160, 224]) { const c = coverage(halftone(flat(64, 64, v), "ordered")); near(c, 1 - (Math.floor((v * 64) / 255 + 0.5)) / 64, 1 / 64, `level ${v}`); }
});
test("threshold, invert and brightness behave as stated", () => {
  assert.equal(coverage(halftone(ramp(256, 1), "threshold", 128)), 128 / 256);
  assert.deepEqual([...adjust(flat(1, 1, 0), { brightness: 0, contrast: 0, gamma: 1, invert: true }).px], [255]);
  assert.ok(adjust(flat(1, 1, 100), { brightness: 20, contrast: 0, gamma: 1, invert: false }).px[0] === 151);
  assert.ok(adjust(flat(1, 1, 128), { brightness: 0, contrast: 0, gamma: 2, invert: false }).px[0] > 128, "gamma > 1 lightens mid-tones");
});
test("resampling keeps the mean (area average) and processing runs at the engraving DPI", () => {
  const g = ramp(1000, 10); const r = resample(g, 100, 1); near(r.px.reduce((a, v) => a + v, 0) / 100, g.px.reduce((a, v) => a + v, 0) / 10000, 0.6, "mean");
  const out = processRaster(flat(10, 10, 0), 25.4, 12.7, 254, { mode: "threshold", brightness: 0, contrast: 0, gamma: 1, invert: false, threshold: 128 });
  assert.equal(out.w, 254); assert.equal(out.h, 127); // 25.4 mm × 12.7 mm at 254 dpi
});
test("raster time: blank lines are skipped, each line is first-to-last burn plus turnaround", () => {
  const g = flat(100, 10, 255); for (let x = 10; x < 60; x++) g.px[2 * 100 + x] = 0; g.px[5 * 100 + 90] = 0; // two lines with burn
  const L = rasterLines(g, 254); assert.equal(L.lines, 2); near(L.lengthMm, (50 + 1) * 0.1, 1e-9, "length");
  const s = rasterSeconds(g, 254, 500, 10000); const over = (500 * 500) / 20000; near(s, 5.1 / 500 + 2 * ((2 * over) / 500 + 1000 / 10000), 1e-9, "seconds");
});
