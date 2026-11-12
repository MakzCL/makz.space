// Compares readCdr() with libcdr's reference reader (cdr2xhtml, from libcdr-tools) on every file given.
// Development tool: needs cdr2xhtml on PATH. Usage:
//   node --experimental-strip-types scripts/cdr-compare.ts <file-or-dir>... [--json out.json] [--verbose]
// For each file it reports: shapes in the reference, shapes read, shapes matched in drawing order
// (same bounding box within tolerance), solid fills with the same colour, outlines with the same width,
// and what our reader skipped. Reference paths are sampled, so arcs and curves are compared fairly.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { readCdr, cdrShapes, type CdrShape } from "../src/cdr.ts";

const PT_PER_MM = 72 / 25.4;
interface RefPath { box: Box; fill: string | null; fillOpacity: number; stroke: string | null; width: number }
interface Box { x0: number; y0: number; x1: number; y1: number }

function sampleD(d: string): [number, number][] {
  const tok = d.match(/[MLCQAZmlcqaz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []; const pts: [number, number][] = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0; const n = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    switch (cmd) {
      case "M": x = n(); y = n(); sx = x; sy = y; pts.push([x, y]); cmd = "L"; break;
      case "L": x = n(); y = n(); pts.push([x, y]); break;
      case "C": { const a = [n(), n(), n(), n(), n(), n()]; for (let t = 0.1; t <= 1.0001; t += 0.1) { const u = 1 - t; pts.push([u * u * u * x + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4], u * u * u * y + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5]]); } x = a[4]; y = a[5]; break; }
      case "Q": { const a = [n(), n(), n(), n()]; for (let t = 0.1; t <= 1.0001; t += 0.1) { const u = 1 - t; pts.push([u * u * x + 2 * u * t * a[0] + t * t * a[2], u * u * y + 2 * u * t * a[1] + t * t * a[3]]); } x = a[2]; y = a[3]; break; }
      case "A": {
        // SVG arc to centre parameterisation (SVG 1.1 F.6.5), with the x-axis rotation
        const [rx0, ry0, rotDeg, large, sweep, x2, y2] = [n(), n(), n(), n(), n(), n(), n()];
        const phi = (rotDeg * Math.PI) / 180, cs = Math.cos(phi), sn = Math.sin(phi);
        let rx = Math.abs(rx0), ry = Math.abs(ry0);
        const dx = (x - x2) / 2, dy = (y - y2) / 2, x1p = cs * dx + sn * dy, y1p = -sn * dx + cs * dy;
        const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
        const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
        let k = den ? Math.sqrt(Math.max(0, num / den)) : 0; if (large === sweep) k = -k;
        const cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx;
        const cx = cs * cxp - sn * cyp + (x + x2) / 2, cy = sn * cxp + cs * cyp + (y + y2) / 2;
        const t1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx); let dt = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - t1;
        if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
        for (let st = 1; st <= 64; st++) { const a = t1 + (dt * st) / 64; pts.push([cx + rx * Math.cos(a) * cs - ry * Math.sin(a) * sn, cy + rx * Math.cos(a) * sn + ry * Math.sin(a) * cs]); }
        x = x2; y = y2; break;
      }
      case "Z": case "z": x = sx; y = sy; cmd = ""; break;
      default: i++;
    }
  }
  return pts;
}
const boxOf = (pts: [number, number][]): Box => pts.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

function reference(file: string): RefPath[] | null {
  let out: string;
  try { out = execFileSync("cdr2xhtml", [file], { encoding: "utf8", timeout: 30000, maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
  // libcdr writes patterns and gradients in <svg:defs>; only drawn paths count
  out = out.replace(/<svg:defs>[\s\S]*?<\/svg:defs>/g, "");
  const refs: RefPath[] = [];
  for (const m of out.matchAll(/<svg:path d="([^"]*)"[^>]*?style="([^"]*)"/g)) {
    const st = Object.fromEntries(m[2].split(";").map((kv) => kv.split(":").map((s) => s.trim())).filter((kv) => kv[0]));
    const fill = st.fill && st.fill !== "none" ? st.fill : null;
    refs.push({ box: boxOf(sampleD(m[1])), fill, fillOpacity: st["fill-opacity"] !== undefined ? Number(st["fill-opacity"]) : 1, stroke: st.stroke && st.stroke !== "none" ? st.stroke : null, width: Number(st["stroke-width"] ?? 0) });
  }
  return refs;
}

function oursBox(s: CdrShape): Box {
  const pts: [number, number][] = [];
  for (const sp of s.paths) {
    let p = sp.start; pts.push(p);
    for (const g of sp.segs) {
      if (g.k === "L") pts.push(g.p);
      else for (let t = 0.1; t <= 1.0001; t += 0.1) { const u = 1 - t; pts.push([u * u * u * p[0] + 3 * u * u * t * g.c1[0] + 3 * u * t * t * g.c2[0] + t * t * t * g.p[0], u * u * u * p[1] + 3 * u * u * t * g.c1[1] + 3 * u * t * t * g.c2[1] + t * t * t * g.p[1]]); }
      p = g.p;
    }
  }
  const b = boxOf(pts); return { x0: b.x0 * PT_PER_MM, y0: b.y0 * PT_PER_MM, x1: b.x1 * PT_PER_MM, y1: b.y1 * PT_PER_MM };
}
const close = (a: Box, b: Box) => { const tol = Math.max(0.05, 0.002 * Math.max(a.x1 - a.x0, a.y1 - a.y0)); return Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.y0 - b.y0) <= tol && Math.abs(a.x1 - b.x1) <= tol && Math.abs(a.y1 - b.y1) <= tol; };
const chan = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const colourDiff = (a: string, b: string) => Math.max(...chan(a).map((v, i) => Math.abs(v - chan(b)[i])));

export interface FileResult { file: string; version?: number; reference: number; read: number; matched: number; fillsExact: number; fillsApprox: number; fillsChecked: number; maxCmykDiff: number; outlinesMatched: number; outlinesChecked: number; skipped?: Record<string, number>; error?: string }

export async function compare(file: string, verbose = false): Promise<FileResult | null> {
  const ref = reference(file); if (!ref) return null;
  const r: FileResult = { file: basename(file), reference: ref.length, read: 0, matched: 0, fillsExact: 0, fillsApprox: 0, fillsChecked: 0, maxCmykDiff: 0, outlinesMatched: 0, outlinesChecked: 0 };
  try {
    const doc = await readCdr(new Uint8Array(readFileSync(file))); // built-in decoders only, as in the browser
    r.version = doc.version; r.skipped = doc.skipped;
    const ours = doc.pages.flatMap((p) => p.layers.flatMap((l) => cdrShapes(l.objects)));
    r.read = ours.length;
    // walk both lists in drawing order; a shape we skipped (or an extra one) costs a re-sync, not the rest of the file
    let j = 0;
    for (let i = 0; i < ref.length; i++) {
      let k = j; while (k < ours.length && k < j + 8 && !close(ref[i].box, oursBox(ours[k]))) k++;
      if (k >= ours.length || k >= j + 8) { if (verbose) console.log(`  ref #${i} unmatched`, ref[i]); continue; }
      j = k + 1; r.matched++;
      const o = ours[k], f = ref[i];
      if (f.fill?.startsWith("#") && o.fill?.type === "solid" && o.fill.color) {
        r.fillsChecked++; const d = colourDiff(f.fill, o.fill.color.hex);
        if (d <= 2) r.fillsExact++; else if (o.fill.color.approx?.startsWith("cmyk")) { r.fillsApprox++; r.maxCmykDiff = Math.max(r.maxCmykDiff, d); }
        else if (verbose) console.log(`  fill ${i}: ref ${f.fill} ours ${o.fill.color.hex} model ${o.fill.color.model}`);
      }
      if (f.stroke) { r.outlinesChecked++; if (o.outline && Math.abs(o.outline.width * PT_PER_MM - f.width) < 0.01 + 0.002 * f.width) r.outlinesMatched++; else if (verbose) console.log(`  outline ${i}: ref ${f.width}pt ours ${o.outline ? (o.outline.width * PT_PER_MM).toFixed(4) : "none"}`); }
    }
  } catch (e) { r.error = (e as Error).message; }
  return r;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const verbose = args.includes("--verbose"); const ji = args.indexOf("--json"); const jsonOut = ji >= 0 ? args[ji + 1] : null;
  const files = args.filter((a, i) => !a.startsWith("--") && i !== ji + 1 || ji < 0 && !a.startsWith("--")).flatMap((a) => statSync(a).isDirectory() ? readdirSync(a).map((f) => join(a, f)) : [a]).sort();
  const results: FileResult[] = [];
  for (const f of files) {
    const r = await compare(f, verbose); if (!r) continue; results.push(r);
    console.log(`${r.file.padEnd(48)} v${String(r.version ?? "?").padEnd(5)} ref ${String(r.reference).padStart(4)} read ${String(r.read).padStart(4)} matched ${String(r.matched).padStart(4)} fills ${r.fillsExact}+${r.fillsApprox}~/${r.fillsChecked} outlines ${r.outlinesMatched}/${r.outlinesChecked}${r.error ? ` ERROR ${r.error}` : ""}`);
  }
  const sum = (k: keyof FileResult) => results.reduce((a, r) => a + (r[k] as number), 0);
  console.log(`\nfiles ${results.length}, errors ${results.filter((r) => r.error).length}; shapes: reference ${sum("reference")}, read ${sum("read")}, matched ${sum("matched")}; fills exact ${sum("fillsExact")}, CMYK-approx ${sum("fillsApprox")} (max channel diff ${Math.max(0, ...results.map((r) => r.maxCmykDiff))}), of ${sum("fillsChecked")}; outlines ${sum("outlinesMatched")}/${sum("outlinesChecked")}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
}
