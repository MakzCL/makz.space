// Code-128 labels must decode back to the same text with a real reader (ZXing).
// Run from factory/:  npx esbuild src/lib/scan.ts --format=esm --platform=node --outfile=tests/.scan.mjs && node tests/barcode.test.mjs
import { code128Svg } from "./.scan.mjs";
import zx from "@zxing/library";
const { MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource, DecodeHintType, BarcodeFormat } = zx;
const codes = ["032X-2301.A", "BIN:A1", "LED-2611", "PO-0021", "#1043", "WT-0031", "abc xyz 09~"];
let bad = 0;
for (const code of codes) {
  const svg = code128Svg(code, { module: 1, height: 10, quiet: 10 });
  const bars = [...svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)].map((m) => [+m[1], +m[2]]);
  const W = +svg.match(/width="(\d+)"/)[1], H = 10, lum = new Uint8ClampedArray(W * H).fill(255);
  for (const [x, w] of bars) for (let y = 0; y < H; y++) for (let i = x; i < x + w; i++) lum[y * W + i] = 0;
  const r = new MultiFormatReader();
  r.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]], [DecodeHintType.PURE_BARCODE, true]]));
  let got = "";
  try { got = r.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, W, H)))).getText(); } catch { /* not decoded */ }
  if (got !== code) { bad++; console.log("FAIL", code, "→", got || "(nothing)"); } else console.log("ok  ", code);
}
if (bad) { console.log(`${bad} BARCODE TESTS FAILED`); process.exit(1); }
console.log("ALL BARCODE TESTS PASSED");
