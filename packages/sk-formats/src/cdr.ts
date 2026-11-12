// SPDX-License-Identifier: MPL-2.0
//
// CorelDRAW (CDR, RIFF-based, CorelDRAW 4 and later) reader: pages, layers, groups, rectangles, ellipses,
// curves, paths and polygons, with transforms, solid fills, outlines and fill opacity.
//
// This file is a TypeScript port of parts of libcdr (https://wiki.documentfoundation.org/DLP/Libraries/libcdr),
// CDRParser.cpp, CommonParser.cpp, CDRContentCollector.cpp, CDRCollector.cpp and CDRTypes.cpp,
// Copyright the libcdr contributors. Like libcdr it is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file, you can obtain one at
// http://mozilla.org/MPL/2.0/. The rest of @sk/formats is not under the MPL.
//
// What it does not read yet is counted in `skipped`, never silently dropped: text, bitmaps, gradient,
// pattern and texture fills, spot-colour palettes, compressed CorelDRAW 1–2 ("WL") files, symbols.
// It never executes anything from the file. Every length is bounded by its container.
import { isZip, zipEntries, zipRead, type InflateRaw } from "./zip.ts";
import { CMYK_LUT_N, CMYK_LUT_ZLIB_B64 } from "./cmyk-lut.ts";
import { inflateRawSync, inflateZlibSync } from "./inflate.ts";

export type CdrVec = [number, number];
export type CdrSeg = { k: "L"; p: CdrVec } | { k: "C"; c1: CdrVec; c2: CdrVec; p: CdrVec };
export interface CdrSubPath { start: CdrVec; segs: CdrSeg[]; closed: boolean }
/** A colour as sRGB hex. `approx` says why it may differ from CorelDRAW's on-screen colour. */
export interface CdrColor { hex: string; model: number; approx?: "cmyk-embedded-profile-ignored" | "lab-unsupported" | "spot-palette-unresolved" | "unknown-model" }
export interface CdrFill { type: "none" | "solid" | "gradient" | "pattern" | "bitmap" | "texture" | "postscript" | "other"; color?: CdrColor }
export interface CdrOutline { color: CdrColor; /** mm */ width: number; dashed: boolean; scalesWithObject: boolean }
export interface CdrShape {
  kind: "shape"; source: "rectangle" | "ellipse" | "curve" | "path" | "polygon";
  /** page coordinates in mm, origin at the page's top-left corner, y down */
  paths: CdrSubPath[]; fill: CdrFill | null; outline: CdrOutline | null; opacity: number;
}
export interface CdrGroup { kind: "group"; children: CdrNode[] }
export type CdrNode = CdrShape | CdrGroup;
export interface CdrLayer { index: number; objects: CdrNode[] }
export interface CdrPage { /** mm */ width: number; height: number; layers: CdrLayer[] }
export interface CdrDocument {
  /** libcdr's version number: 100 × the file format version (1500 = CorelDRAW X5) */
  version: number; container: "riff" | "zip"; pages: CdrPage[];
  /** what was present but not imported, with counts */
  skipped: Record<string, number>; warnings: string[];
}
export interface CdrReadOptions {
  /** raw DEFLATE for ZIP entries; defaults to the built-in decoder (inflate.ts) */
  inflateRaw?: InflateRaw;
  /** stop after this many shapes (default 200 000) */
  maxShapes?: number;
}

const MM_PER_IN = 25.4;
const MAX_NESTING = 64;
const MAX_BYTES = 256 * 1024 * 1024;

class CdrError extends Error {}
const fail = (m: string): never => { throw new CdrError(m); };

// ---------- the RIFF record tree ----------
interface Rec { id: string; list?: string; data: Uint8Array; children: Rec[]; level: number }
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32at = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16at = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);

/** libcdr getCDRVersion: the character after "CDR" in the RIFF form type. */
export function cdrVersionFromFormChar(c: number): number {
  if (c === 0x20) return 300;
  if (c < 0x31) return 0;
  if (c < 0x3a) return 100 * (c - 0x30);
  if (c < 0x41) return 0;
  return 100 * (c - 0x37);
}

/** A little-endian cursor over one record's bytes. Reading past the end throws, which ends that record only. */
class Cur {
  p = 0; readonly b: Uint8Array; readonly v: DataView;
  constructor(b: Uint8Array) { this.b = b; this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  get left() { return this.b.length - this.p; }
  need(n: number) { if (this.p + n > this.b.length || this.p < 0) throw new RangeError("record ends early"); }
  seek(p: number) { this.p = p; }
  skip(n: number) { this.p += n; }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  s16() { this.need(2); const x = this.v.getInt16(this.p, true); this.p += 2; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  s32() { this.need(4); const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
  f64() { this.need(8); const x = this.v.getFloat64(this.p, true); this.p += 8; return x; }
  fixed() { const x = this.u32(); return ((x >>> 16) << 16 >> 16) + (x & 0xffff) / 0xffff; }
}

// ---------- geometry helpers (object space, inches, y up as in CorelDRAW) ----------
type Path = CdrSubPath[];
type Trafo = [number, number, number, number, number, number]; // x' = a x + b y + c ; y' = d x + e y + f (libcdr CDRTransform v0 v1 x0 v3 v4 y0)
const apply = (t: Trafo, [x, y]: CdrVec): CdrVec => [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
const mapPath = (p: Path, f: (v: CdrVec) => CdrVec): Path => p.map((s) => ({ start: f(s.start), closed: s.closed, segs: s.segs.map((g) => (g.k === "L" ? { k: "L", p: f(g.p) } : { k: "C", c1: f(g.c1), c2: f(g.c2), p: f(g.p) })) }));

class PathBuilder {
  subs: Path = [];
  private cur: CdrSubPath | null = null;
  private last: CdrVec = [0, 0];
  moveTo(x: number, y: number) { this.cur = { start: [x, y], segs: [], closed: false }; this.subs.push(this.cur); this.last = [x, y]; }
  private ensure() { if (!this.cur) this.moveTo(this.last[0], this.last[1]); return this.cur!; }
  lineTo(x: number, y: number) { this.ensure().segs.push({ k: "L", p: [x, y] }); this.last = [x, y]; }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number) { this.ensure().segs.push({ k: "C", c1: [x1, y1], c2: [x2, y2], p: [x, y] }); this.last = [x, y]; }
  quadTo(qx: number, qy: number, x: number, y: number) {
    const [x0, y0] = this.last;
    this.cubicTo(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
  }
  /** SVG-style elliptical arc (rotation 0), as cubic Béziers of at most 90° each. */
  arcTo(rx: number, ry: number, large: boolean, sweep: boolean, x: number, y: number) {
    const [x1, y1] = this.last;
    if (rx === 0 || ry === 0 || (x1 === x && y1 === y)) { this.lineTo(x, y); return; }
    const dx = (x1 - x) / 2, dy = (y1 - y) / 2;
    let rxs = rx * rx, rys = ry * ry;
    const lam = (dx * dx) / rxs + (dy * dy) / rys;
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; rxs = rx * rx; rys = ry * ry; }
    const num = rxs * rys - rxs * dy * dy - rys * dx * dx, den = rxs * dy * dy + rys * dx * dx;
    let k = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den)); if (large === sweep) k = -k;
    const cxp = (k * rx * dy) / ry, cyp = (-k * ry * dx) / rx;
    const cx = cxp + (x1 + x) / 2, cy = cyp + (y1 + y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (dx - cxp) / rx, (dy - cyp) / ry);
    let dt = ang((dx - cxp) / rx, (dy - cyp) / ry, (-dx - cxp) / rx, (-dy - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), step = dt / n, h = (4 / 3) * Math.tan(step / 4);
    let a = t1;
    for (let i = 0; i < n; i++) {
      const b = a + step, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      const ex = i === n - 1 ? x : cx + rx * cb, ey = i === n - 1 ? y : cy + ry * sb;
      this.cubicTo(cx + rx * (ca - h * sa), cy + ry * (sa + h * ca), cx + rx * (cb + h * sb), cy + ry * (sb - h * cb), ex, ey);
      a = b;
    }
  }
  close() { if (this.cur) { this.cur.closed = true; this.last = this.cur.start; this.cur = null; } }
}

// ---------- colours (libcdr CDRParser::readColor and CDRParserState::_getRGBColor) ----------
interface RawColor { model: number; palette: number; value: number }
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
/** CMYK (0–1 each) → sRGB through the GenericCMYK lookup table (see cmyk-lut.ts), quadrilinear. */
function lutRgb(lut: Uint8Array, q: number[]): [number, number, number] {
  const N = CMYK_LUT_N, f = q.map((x) => Math.max(0, Math.min(1, x)) * (N - 1)), i0 = f.map((x) => Math.min(Math.floor(x), N - 2)), fr = f.map((x, i) => x - i0[i]);
  const acc = [0, 0, 0];
  for (let corner = 0; corner < 16; corner++) {
    let w = 1, idx = 0;
    for (let d = 0; d < 4; d++) { const bit = (corner >> (3 - d)) & 1; w *= bit ? fr[d] : 1 - fr[d]; idx = idx * N + i0[d] + bit; }
    if (w) for (let ch = 0; ch < 3; ch++) acc[ch] += w * lut[idx * 3 + ch];
  }
  return [acc[0], acc[1], acc[2]];
}
let LUT: Uint8Array | null = null;
function cmykLut(): Uint8Array {
  if (LUT) return LUT;
  const z = Uint8Array.from(atob(CMYK_LUT_ZLIB_B64), (ch) => ch.charCodeAt(0));
  const d = inflateZlibSync(z, 1 << 20);
  for (let i = 3; i < d.length; i++) d[i] = (d[i] + d[i - 3]) & 255;
  return (LUT = d);
}
function toRgb(c: RawColor, embeddedProfile: boolean): CdrColor {
  const lut = cmykLut();
  const v = c.value, c0 = v & 0xff, c1 = (v >>> 8) & 0xff, c2 = (v >>> 16) & 0xff, c3 = (v >>> 24) & 0xff, m = c.model;
  // CMYK goes through the same public-domain profile libcdr uses by default. A file's own embedded CMYK
  // profile is not applied yet.
  const cmyk = (C: number, M: number, Y: number, K: number): CdrColor => ({ hex: rgbHex(...lutRgb(lut, [C, M, Y, K])), model: m, ...(embeddedProfile ? { approx: "cmyk-embedded-profile-ignored" as const } : {}) });
  const hue = ((c1 << 8) | c0) % 361;
  const sat3 = (): [number, number, number] => hue < 120 ? [(120 - hue) / 60, hue / 60, 0] : hue < 240 ? [0, (240 - hue) / 60, (hue - 120) / 60] : [(hue - 240) / 60, 0, (360 - hue) / 60];
  switch (m) {
    case 0x01: case 0x02: case 0x15: return cmyk(c0 / 100, c1 / 100, c2 / 100, c3 / 100);
    case 0x03: case 0x11: return cmyk(c0 / 255, c1 / 255, c2 / 255, c3 / 255);
    case 0x04: return { hex: rgbHex(255 - c0, 255 - c1, 255 - c2), model: m };
    case 0x05: return { hex: rgbHex(c2, c1, c0), model: m };
    case 0x06: { const s = c2 / 255, br = c3 / 255; const [r, g, b] = sat3().map((x) => 255 * (1 - s + s * Math.min(1, x)) * br); return { hex: rgbHex(r, g, b), model: m }; }
    case 0x07: {
      const l = c2 / 255, s = c3 / 255; const t = sat3().map((x) => 2 * s * Math.min(1, x) + 1 - s);
      const [r, g, b] = t.map((x) => (l < 0.5 ? 255 * l * x : 255 * ((1 - l) * x + 2 * l - 1))); return { hex: rgbHex(r, g, b), model: m };
    }
    case 0x08: return { hex: c0 ? "#000000" : "#ffffff", model: m };
    case 0x09: return { hex: rgbHex(c0, c0, c0), model: m };
    case 0x14: return { hex: rgbHex((255 * c0) / 100, (255 * c0) / 100, (255 * c0) / 100), model: m };
    case 0x0c: case 0x12: return { hex: "#808080", model: m, approx: "lab-unsupported" };
    case 0x19: return { hex: "#808080", model: m, approx: "spot-palette-unresolved" };
    default: return { hex: "#808080", model: m, approx: "unknown-model" };
  }
}

// ---------- the reader ----------
interface FillStyle { type: CdrFill["type"]; color?: RawColor }
interface LineStyle { lineType: number; width: number; stretch: number; color: RawColor; dashes: number }
interface PageSize { w: number; h: number; ox: number; oy: number }

export async function readCdr(bytes: Uint8Array, opts: CdrReadOptions = {}): Promise<CdrDocument> {
  let riff = bytes; let container: CdrDocument["container"] = "riff"; const external: (Uint8Array | null)[] = [];
  if (isZip(bytes)) {
    container = "zip";
    const ents = zipEntries(bytes) ?? fail("The ZIP container is damaged");
    const raw: InflateRaw = opts.inflateRaw ?? (async (d, max) => inflateRawSync(d, max).data);
    const get = async (name: string) => { const e = ents.find((x) => x.name === name); return e ? zipRead(bytes, e, raw).catch(() => null) : null; };
    const main = (await get("content/riffData.cdr")) ?? (await get("content/root.dat"));
    if (!main) fail(ents.some((e) => e.name.startsWith("content/")) ? "The CorelDRAW drawing inside the ZIP could not be decompressed" : "This ZIP file holds no CorelDRAW drawing");
    riff = main!;
    const list = await get("content/dataFileList.dat");
    if (list) for (const name of new TextDecoder("latin1").decode(list).split("\n").filter(Boolean)) external.push(await get(`content/data/${name}`));
  }
  if (riff.length >= 2 && riff[0] === 0x57 && riff[1] === 0x4c) fail("CorelDRAW 1–2 files (\"WL\" format) are not supported yet. Open the file in a newer CorelDRAW and save it again.");
  if (riff.length < 12 || fourcc(riff, 0) !== "RIFF") fail("Not a CorelDRAW drawing (no RIFF header)");
  const form = fourcc(riff, 8);
  if (form.slice(0, 3).toLowerCase() !== "cdr") fail(`Not a CorelDRAW drawing (RIFF form "${form}")`);
  let version = cdrVersionFromFormChar(riff[11]);
  if (version < 300) fail(`Unsupported CorelDRAW version character "${form[3]}"`);
  if (version < 400) fail("CorelDRAW 3 files are not supported yet (their shapes are stored differently). Open the file in a newer CorelDRAW and save it again.");
  let p16 = version < 600;

  const skipped: Record<string, number> = {}; const warnings: string[] = [];
  const skip = (what: string, n = 1) => { skipped[what] = (skipped[what] ?? 0) + n; };

  // 1. decode the record tree (CDRParser::parseRecord), decompressing "cmpr" lists
  let budget = MAX_BYTES;
  const parseList = async (b: Uint8Array, start: number, end: number, blocks: number[], level: number): Promise<Rec[]> => {
    if (level > MAX_NESTING) fail("Records are nested too deeply");
    const out: Rec[] = []; let pos = start;
    while (pos < end) {
      while (pos < end && b[pos] === 0) pos++;
      if (pos + 8 > end) break;
      const id = fourcc(b, pos); let len = u32at(b, pos + 4); if (blocks.length > len) len = blocks[len];
      const at = pos + 8; const stop = Math.min(end, at + len);
      if (id === "RIFF" || id === "LIST") {
        if (at + 4 > end) break;
        const list = fourcc(b, at);
        if (list === "sytr") skip("symbol definitions (CorelDRAW X6+)");
        else if (list === "stlt" && version >= 700) out.push({ id: "stlt", data: b.subarray(at + 4, stop), children: [], level });
        else if (list === "cmpr") {
          const csize = u32at(b, at + 4);
          if (fourcc(b, at + 20) !== "CPng" || u16at(b, at + 24) !== 1 || u16at(b, at + 26) !== 4) fail("A compressed section has an unknown header");
          const dataAt = at + 28;
          // built-in decoder: it stops at the end of each stream, so CorelDRAW's padding after it is ignored
          const unz = (d: Uint8Array) => { try { return inflateZlibSync(d, Math.max(0, budget)); } catch (e) { return fail(`A compressed section is damaged (${(e as Error).message})`); } };
          const content = unz(b.subarray(dataAt, Math.min(stop, dataAt + csize))); budget -= content.length;
          const blk = unz(b.subarray(Math.min(stop, dataAt + csize), stop)); budget -= blk.length;
          if (budget < 0) fail("The decompressed drawing is too large");
          const lens: number[] = []; for (let i = 0; i + 4 <= blk.length; i += 4) lens.push(u32at(blk, i));
          out.push({ id, list, data: content, children: await parseList(content, 0, content.length, lens, level + 1), level });
        } else out.push({ id, list, data: b.subarray(at, stop), children: await parseList(b, at + 4, stop, blocks, level + 1), level });
      } else {
        let data = b.subarray(at, stop);
        // CorelDRAW X6+: a 16-byte record can point into a stream of its own (CDRParser::_redirectX6Chunk)
        if (version >= 1600 && len === 0x10 && data.length >= 12) {
          const n = u32at(data, 0), l2 = u32at(data, 4);
          if (n === 0xffffffff) data = data.subarray(8, 8 + l2);
          else if (n < external.length && external[n]) { const o = u32at(data, 8); data = external[n]!.subarray(o, o + l2); }
          else data = new Uint8Array(0);
        }
        // the "vrsn" record overrides the version in the RIFF header (CDRParser::readVersion)
        if (id === "vrsn" && data.length >= 2) { const v = u16at(data, 0); if (v >= 300 && v < 10000) { version = v; p16 = v < 600; } }
        out.push({ id, data, children: [], level });
      }
      pos = at + len;
      if (len === 0 && at >= end) break;
    }
    return out;
  };
  const root = await parseList(riff, 0, riff.length, [], 0);
  if (version < 400) fail("CorelDRAW 3 files are not supported yet. Open the file in a newer CorelDRAW and save it again.");

  // shared record readers (CommonParser)
  const coord = (c: Cur) => (p16 ? c.s16() / 1000 : c.s32() / 254000);
  const unsigned = (c: Cur) => (p16 ? c.u16() : c.u32());
  const angle = (c: Cur) => (p16 ? (Math.PI * c.s16()) / 1800 : (Math.PI * c.s32()) / 180000000);
  const rectCoord = (c: Cur) => (version < 1500 ? coord(c) : c.f64() / 254000);
  const readColor = (c: Cur): RawColor => {
    if (version >= 500) {
      let model = c.u16(), palette = 0;
      if (model === 0x01 && version >= 1300) model = 0x19;
      if (model === 0x1e) { model = 0x19; palette = 0x1e; } else { palette = c.u16(); c.skip(4); }
      return { model, palette, value: c.u32() };
    }
    if (version >= 400) {
      const model = c.u16(), C = c.u16(), M = c.u16(), Y = c.u16(), K = c.u16(); c.skip(2);
      return { model, palette: 0, value: ((K & 0xff) << 24 | (Y & 0xff) << 16 | (M & 0xff) << 8 | (C & 0xff)) >>> 0 };
    }
    return { model: c.u8(), palette: 0, value: c.u32() };
  };

  // 2. styles pass (CDRStylesCollector): fills, outlines, page sizes
  const fills = new Map<number, FillStyle>(), lines = new Map<number, LineStyle>();
  const pageSizes: PageSize[] = []; let defPage: PageSize = { w: 8.5, h: 11, ox: -4.25, oy: -5.5 };
  const FILL_TYPES: Record<number, CdrFill["type"]> = { 0: "none", 1: "solid", 2: "gradient", 7: "pattern", 9: "bitmap", 10: "pattern", 11: "texture", 14: "postscript" };
  const readFild = (d: Uint8Array) => {
    const c = new Cur(d); const id = c.u32(); if (version >= 1300) c.skip(8);
    const t = c.u16(); const fs: FillStyle = { type: FILL_TYPES[t] ?? "other" };
    if (t === 1) { c.skip(version >= 1300 ? 13 : 2); fs.color = readColor(c); }
    fills.set(id, fs);
  };
  const readOutl = (d: Uint8Array) => {
    const c = new Cur(d); const id = c.u32();
    if (version >= 1300) { let tag = 0, l = 0; for (let guard = 0; tag !== 1 && guard < 64; guard++) { c.skip(l); tag = c.u32(); l = c.u32(); } }
    const lineType = c.u16(); c.u16(); c.u16(); // caps, join
    if (version < 1300 && version >= 600) c.skip(2);
    const width = coord(c); const stretch = c.u16() / 100;
    if (version >= 600) c.skip(2);
    angle(c);
    if (version >= 1300) c.skip(46); else if (version >= 600) c.skip(52);
    const color = readColor(c);
    c.skip(version < 600 ? 10 : 16);
    const dashes = c.u16();
    lines.set(id, { lineType, width, stretch, color, dashes });
  };
  const pageSizeFromLoda = (d: Uint8Array): PageSize | null => {
    const lo = lodaArgs(d); if (!lo) return null;
    for (const a of lo.args) if (a.type === 0x4aba) { const c = new Cur(d); c.seek(a.off); const w = coord(c), h = coord(c); return { w, h, ox: -w / 2, oy: -h / 2 }; }
    return null;
  };
  const lodaArgs = (d: Uint8Array, styd = false) => {
    const c = new Cur(d);
    try {
      const chunkLen = unsigned(c), n = unsigned(c), argsAt = unsigned(c), typesAt = unsigned(c), chunkType = unsigned(c); const parent = styd ? chunkType : undefined;
      if (argsAt >= d.length || typesAt >= d.length) return null;
      const count = Math.min(n, Math.floor((d.length - argsAt) / 4));
      const offs: number[] = []; c.seek(argsAt); for (let i = 0; i < count; i++) offs.push(unsigned(c));
      const types: number[] = new Array(count); c.seek(typesAt); for (let i = count; i > 0; i--) types[i - 1] = unsigned(c);
      return { chunkLen, chunkType, parent, args: offs.map((off, i) => ({ off, type: types[i] })) };
    } catch { return null; }
  };
  // named styles (CorelDRAW 7+: the "stlt" table; 3–6: "styd" records): fill and outline ids, with a parent
  interface NamedStyle { parent: number; fill?: number; line?: number }
  const styles = new Map<number, NamedStyle>();
  const readStlt = (d: Uint8Array, set11: boolean) => {
    const c = new Cur(d); const nRec = c.u32(); if (!nRec) return;
    const pairs = (size: number) => { const m = new Map<number, number>(); const n = Math.min(c.u32(), Math.floor(c.left / size)); for (let i = 0; i < n; i++) { const id = c.u32(); c.skip(4); m.set(id, c.u32()); c.skip(size - 12); } return m; };
    const fillIds = pairs(12 + (version >= 1300 ? 48 : 0)), outlIds = pairs(12);
    const nFonts = Math.min(c.u32(), Math.floor(c.left / (4 + 4 + 8 + (p16 ? 2 : 4) + 2 * (version < 1000 ? 12 : 20))));
    for (let i = 0; i < nFonts; i++) { c.skip(4 + (version < 1000 ? 12 : 20) + 4 + 8); coord(c); if (version >= 1000) c.skip(8); c.skip(4 + 8); }
    pairs(12); // aligns
    const nInt = c.u32(); for (let i = 0; i < nInt && c.left >= 52; i++) c.skip(52);
    c.skip(152 * c.u32()); c.skip(784 * c.u32()); // set5s, tabs
    const nBul = c.u32();
    for (let i = 0; i < nBul && c.left >= 16; i++) {
      c.skip(40); if (version > 1300) c.skip(4);
      if (version >= 1300) c.skip(c.u32() ? 68 : 12);
      else { c.skip(20); if (version >= 1000) c.skip(8); if (c.u32()) c.skip(8); c.skip(8); }
    }
    const indSize = 4 + 3 * (p16 ? 2 : 4); const nInd = Math.min(c.u32(), Math.floor(c.left / indSize)); c.skip(nInd * (indSize + 12)); // (bounded by 16-byte entries, read as 28: as libcdr)
    c.skip((version >= 1300 ? 36 : 32) * c.u32()); c.skip(28 * c.u32()); // hyphens, drop caps
    if (set11) c.skip(12 * c.u32());
    const found = new Map<number, NamedStyle>();
    for (let i = 0; i < nRec && c.left >= 32; i++) {
      const num = c.u32(), id = c.u32(), parent = c.u32(); c.skip(8);
      let nameLen = c.u32(); if (version >= 1200) nameLen *= 2; c.skip(nameLen);
      const f = c.u32(), o = c.u32();
      if (num > 1) c.skip(set11 ? 20 : 16);
      if (num > 2) c.skip(20);
      found.set(id, { parent, fill: f ? fillIds.get(f) : undefined, line: o ? outlIds.get(o) : undefined });
    }
    for (const [k, v] of found) styles.set(k, v);
  };
  const readStyd = (d: Uint8Array) => {
    if (version >= 700) return;
    const c0 = new Cur(d); const id = c0.u16(); const lo = lodaArgs(d.subarray(2), true); if (!lo) return;
    const st: NamedStyle = { parent: lo.parent ?? 0 }; const c = new Cur(d.subarray(2));
    for (const a of lo.args) { c.seek(a.off); if (a.type === 0xcd) st.fill = c.u32(); else if (a.type === 0xd2) st.line = c.u32(); }
    styles.set(id, st);
  };
  const stylesWalk = (rs: Rec[]) => {
    for (const r of rs) {
      try {
        if (r.list === "page") pageSizes.push({ ...defPage });
        if (r.id === "fild" || r.id === "fill") readFild(r.data);
        else if (r.id === "outl") readOutl(r.data);
        else if (r.id === "stlt") { try { readStlt(r.data, version > 800); } catch (e) { if (version === 800) readStlt(r.data, true); else throw e; } }
        else if (r.id === "styd") readStyd(r.data);
        else if (r.id === "mcfg") {
          const c = new Cur(r.data); if (version >= 1300) c.skip(12); else if (version >= 900) c.skip(4); else if (version < 700 && version >= 600) c.skip(0x1c);
          let w: number, h: number;
          if (version < 400) { c.skip(2); const x0 = coord(c), y0 = coord(c), x1 = coord(c), y1 = coord(c); w = Math.abs(x1 - x0); h = Math.abs(y1 - y0); } else { w = coord(c); h = coord(c); }
          const ps = { w, h, ox: -w / 2, oy: -h / 2 }; if (pageSizes.length) pageSizes[pageSizes.length - 1] = ps; else defPage = ps;
        }
        else if (r.id === "loda" || r.id === "lobj") { const ps = pageSizeFromLoda(r.data); if (ps) { if (pageSizes.length) pageSizes[pageSizes.length - 1] = ps; else defPage = ps; } }
      } catch { skip("damaged style records"); }
      if (r.children.length) stylesWalk(r.children);
    }
  };
  stylesWalk(root);

  let embeddedProfile = false; const findIccd = (rs: Rec[]): void => { for (const r of rs) { if (r.id === "iccd") embeddedProfile = true; findIccd(r.children); } }; findIccd(root);
  const rgb = (c: RawColor) => toRgb(c, embeddedProfile);

  // 3. content pass (CDRContentCollector)
  const pages: CdrPage[] = []; let page: CdrPage | null = null; let pageGeom = pageSizes[0] ?? defPage; let pageIndex = 0;
  let pendingIgnored: CdrNode[] = []; // objects on an ignored (master) page are drawn on the next page, as libcdr does
  let layer: CdrLayer | null = null; let layerHidden = false; let layerFlagsPending = false; let pageFlagsPending = false; let ignorePage = false;
  const stack: CdrNode[][] = []; let shapes = 0; const maxShapes = opts.maxShapes ?? 200000;
  const target = (): CdrNode[] => {
    if (stack.length) return stack[stack.length - 1];
    if (!page || ignorePage) return pendingIgnored;
    if (!layer) { layer = { index: page.layers.length, objects: [] }; page.layers.push(layer); }
    return layer.objects;
  };

  interface Obj { path: PathBuilder; source?: CdrShape["source"]; trafos: Trafo[]; fill?: number; line?: number; style?: number; opacity: number; polygon?: { n: number; next: number; rx: number; ry: number; cx: number; cy: number } }
  const readTrfd = (d: Uint8Array): Trafo[] => {
    const c = new Cur(d); const out: Trafo[] = [];
    const chunkLen = unsigned(c), n = unsigned(c), argsAt = unsigned(c);
    if (argsAt >= d.length) return out;
    const count = Math.min(n, Math.floor((d.length - argsAt) / 4));
    const offs: number[] = []; c.seek(argsAt); for (let i = 0; i < count; i++) offs.push(unsigned(c));
    for (const off of offs) {
      c.seek(off); if (version >= 1300) c.skip(8);
      if (c.u16() !== 0x08) continue;
      if (version >= 600) c.skip(6);
      if (version >= 500) {
        const div = version < 600 ? 1000 : 254000;
        const a = c.f64(), b = c.f64(), x0 = c.f64() / div, dd = c.f64(), e = c.f64(), y0 = c.f64() / div; out.push([a, b, x0, dd, e, y0]);
      } else { const a = c.fixed(), b = c.fixed(), x0 = c.s32() / 1000, dd = c.fixed(), e = c.fixed(), y0 = c.s32() / 1000; out.push([a, b, x0, dd, e, y0]); }
    }
    void chunkLen; return out;
  };
  const points = (c: Cur, n: number) => {
    const pts: CdrVec[] = [], types: number[] = [];
    for (let i = 0; i < n; i++) pts.push([coord(c), coord(c)]);
    for (let i = 0; i < n; i++) types.push(c.u8());
    return { pts, types };
  };
  /** CommonParser::processPath */
  const outputPath = (pb: PathBuilder, pts: CdrVec[], types: number[]) => {
    let ctl: CdrVec[] = [];
    for (let k = 0; k < pts.length; k++) {
      const t = types[k], closed = (t & 0x08) !== 0, [x, y] = pts[k];
      if (!(t & 0x40) && !(t & 0x80)) { if (closed) pb.close(); ctl = []; pb.moveTo(x, y); }
      else if ((t & 0x40) && !(t & 0x80)) { ctl = []; pb.lineTo(x, y); if (closed) pb.close(); }
      else if (!(t & 0x40) && (t & 0x80)) { if (ctl.length >= 2) pb.cubicTo(ctl[0][0], ctl[0][1], ctl[1][0], ctl[1][1], x, y); else pb.lineTo(x, y); if (closed) pb.close(); ctl = []; }
      else ctl.push(pts[k]);
    }
  };
  const pointSize = 2 * (p16 ? 2 : 4) + 1;
  const readRectangle = (c: Cur, pb: PathBuilder) => {
    const x0 = rectCoord(c), y0 = rectCoord(c); let r0 = 0, r1 = 0, r2 = 0, r3 = 0, corner = 0, sx = 1, sy = 1;
    if (version < 1500) { r3 = rectCoord(c); r2 = version < 900 ? r3 : rectCoord(c); r1 = version < 900 ? r3 : rectCoord(c); r0 = version < 900 ? r3 : rectCoord(c); }
    else {
      let s = c.f64(); if (Math.abs(s) > 1e-10) sx = s; s = c.f64(); if (Math.abs(s) > 1e-10) sy = s;
      const scaleWith = c.u8(); c.skip(7);
      if (scaleWith === 0) {
        r3 = c.f64(); corner = c.u8(); c.skip(15); r2 = c.f64(); c.skip(16); r1 = c.f64(); c.skip(16); r0 = c.f64();
        const k = Math.min(Math.abs((x0 * sx) / 2), Math.abs((y0 * sy) / 2)); r3 *= k; r2 *= k; r1 *= k; r0 *= k;
      } else { r3 = rectCoord(c); corner = c.u8(); c.skip(15); r2 = rectCoord(c); c.skip(16); r1 = rectCoord(c); c.skip(16); r0 = rectCoord(c); }
    }
    const crn = (qx: number, qy: number, cx1: number, cy1: number, x: number, y: number) => { if (corner === 0) pb.quadTo(qx, qy, x, y); else if (corner === 1) pb.quadTo(cx1, cy1, x, y); else pb.lineTo(x, y); };
    pb.moveTo(0, r0 > 0 ? -r0 / sy : 0);
    if (r1 > 0) { pb.lineTo(0, y0 + r1 / sy); crn(0, y0, r1 / sx, y0 + r1 / sy, r1 / sx, y0); } else pb.lineTo(0, y0);
    if (r2 > 0) { pb.lineTo(x0 - r2 / sx, y0); crn(x0, y0, x0 - r2 / sx, y0 + r2 / sy, x0, y0 + r2 / sy); } else pb.lineTo(x0, y0);
    if (r3 > 0) { pb.lineTo(x0, -r3 / sy); crn(x0, 0, x0 - r3 / sx, -r3 / sy, x0 - r3 / sx, 0); } else pb.lineTo(x0, 0);
    if (r0 > 0) { pb.lineTo(r0 / sx, 0); crn(0, 0, r0 / sx, -r0 / sy, 0, -r0 / sy); } else pb.lineTo(0, 0);
    pb.close();
  };
  const norm = (a: number) => { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; };
  const readEllipse = (c: Cur, pb: PathBuilder) => {
    const x = coord(c), y = coord(c); let a1 = norm(angle(c)), a2 = norm(angle(c)); const pie = unsigned(c) !== 0;
    const cx = x / 2, cy = y / 2, rx = Math.abs(cx), ry = Math.abs(cy);
    if (Math.abs(a1 - a2) > 1e-10) {
      if (a2 < a1) a2 += 2 * Math.PI;
      const x0 = cx + rx * Math.cos(a1), y0 = cy - ry * Math.sin(a1), x1 = cx + rx * Math.cos(a2), y1 = cy - ry * Math.sin(a2);
      pb.moveTo(x0, y0); pb.arcTo(rx, ry, a2 - a1 > Math.PI, false, x1, y1);
      if (pie) { pb.lineTo(cx, cy); pb.lineTo(x0, y0); pb.close(); }
    } else {
      a2 += Math.PI / 2;
      const x0 = cx + rx * Math.cos(a1), y0 = cy - ry * Math.sin(a1), x1 = cx + rx * Math.cos(a2), y1 = cy - ry * Math.sin(a2);
      pb.moveTo(x0, y0); pb.arcTo(rx, ry, false, false, x1, y1); pb.arcTo(rx, ry, true, false, x0, y0); pb.close();
    }
  };
  const readLoda = (d: Uint8Array, o: Obj) => {
    const lo = lodaArgs(d); if (!lo) { skip("damaged object records"); return; }
    const c = new Cur(d); const ct = lo.chunkType; const old = version < 400;
    const is = (newT: number, oldT: number) => (old ? ct === oldT : ct === newT);
    for (const a of lo.args) {
      c.seek(a.off);
      try {
        if (a.type === 0x1e) {
          if (ct === 0x0a && version >= 600) skip("embedded OLE objects");
          else if (is(0x01, 0x00)) { readRectangle(c, o.path); o.source = "rectangle"; }
          else if (is(0x02, 0x01)) { readEllipse(c, o.path); o.source = "ellipse"; }
          else if (is(0x03, 0x02)) { let n = c.u16(); c.skip(2); n = Math.min(n, Math.floor(c.left / pointSize)); const p = points(c, n); outputPath(o.path, p.pts, p.types); o.source = "curve"; }
          else if (ct === 0x25) { c.skip(4); let n = c.u16() + c.u16(); n = c.left < 16 ? 0 : Math.min(n, Math.floor((c.left - 16) / pointSize)); c.skip(16); const p = points(c, n); outputPath(o.path, p.pts, p.types); o.source = "path"; }
          else if (ct === 0x14) { let n = c.u16(); n = Math.min(n, Math.floor(c.left / pointSize)); c.skip(2); const p = points(c, n); outputPath(o.path, p.pts, p.types); o.source = "polygon"; }
          else if (is(0x04, 0x03)) skip("artistic text");
          else if (is(0x06, 0x05)) skip("paragraph text");
          else if (is(0x05, 0x04)) skip("bitmaps");
          else if (ct === 0x26) skip("B-spline curves");
          else skip(`objects of unknown type ${ct}`);
        } else if (a.type === 0x14) { if (old) skip("CorelDRAW 3 inline fills"); else { const id = c.u32(); if (id) o.fill = id; } }
        else if (a.type === 0x0a) { if (old) skip("CorelDRAW 3 inline outlines"); else { const id = c.u32(); if (id) o.line = id; } }
        else if (a.type === 0x2af8) {
          if (version < 1300) c.skip(4);
          const n = c.u32(); let next = c.u32(); if (next <= 1) next = c.u32(); else c.skip(4);
          if (version >= 1300) c.skip(4);
          const rx = c.f64(), ry = c.f64(), cx = coord(c), cy = coord(c); o.polygon = { n, next, rx, ry, cx, cy };
        } else if (a.type === 0x1f40) { c.skip(version < 1300 ? 10 : 14); o.opacity = c.u16() / 1000; }
        else if (a.type === 0xc8) { const s = unsigned(c); if (s) o.style = s; }
      } catch { skip("damaged object records"); }
    }
  };
  /** CDRPolygon::create */
  const makePolygon = (pb: PathBuilder, pg: NonNullable<Obj["polygon"]>) => {
    if (!pg.n || !pb.subs.length) return;
    const step = (2 * Math.PI) / pg.n; const base = pb.subs.map((s) => mapPath([s], (v) => v)[0]); let tmp = base; const out: Path = [...pb.subs];
    const rot = (k: number): Trafo => [Math.cos(k * step), Math.sin(k * step), 0, -Math.sin(k * step), Math.cos(k * step), 0];
    const MAX = 100000; const add = (p: Path) => { if (out.length < MAX) out.push(...p); };
    if (pg.next && pg.n % pg.next) { const t = rot(pg.next); for (let i = 1; i < pg.n; i++) { tmp = mapPath(tmp, (v) => apply(t, v)); add(tmp); } }
    else {
      const t = rot(pg.next), shift = rot(1);
      for (let i = 0; i < pg.next; i++) {
        if (i) { tmp = mapPath(tmp, (v) => apply(shift, v)); add(tmp); }
        for (let j = 1; j < pg.n / pg.next; j++) { tmp = mapPath(tmp, (v) => apply(t, v)); add(tmp); }
      }
    }
    if (out.length) out[out.length - 1].closed = true;
    pb.subs = mapPath(out, (v) => apply([pg.rx, 0, pg.cx, 0, pg.ry, pg.cy], v));
  };
  const flush = (o: Obj) => {
    if (!o.path.subs.length) return;
    if (shapes >= maxShapes) { skip("shapes beyond the limit"); return; }
    if (o.polygon && o.source === "polygon") makePolygon(o.path, o.polygon);
    const pg = pageGeom;
    const toPage = (v: CdrVec): CdrVec => {
      let p = v; for (const t of o.trafos) p = apply(t, p);
      return [(p[0] - pg.ox) * MM_PER_IN, (pg.h - (p[1] - pg.oy)) * MM_PER_IN];
    };
    const paths = mapPath(o.path.subs.filter((s) => s.segs.length || s.closed), toPage);
    if (!paths.length) return;
    // damaged numbers (NaN, infinities, kilometre-sized shapes) never reach the editor
    const okv = (v: CdrVec) => Number.isFinite(v[0]) && Number.isFinite(v[1]) && Math.abs(v[0]) < 1e6 && Math.abs(v[1]) < 1e6;
    if (!paths.every((sp) => okv(sp.start) && sp.segs.every((g) => okv(g.p) && (g.k === "L" || (okv(g.c1) && okv(g.c2)))))) { skip("shapes with invalid coordinates"); return; }
    // the object's own fill and outline, else its named style's (CDRParserState::getRecursedStyle: the nearest style that sets one)
    const fromStyle = (k: "fill" | "line") => { const seen = new Set<number>(); let id = o.style; while (id && !seen.has(id)) { seen.add(id); const st = styles.get(id); if (!st) return undefined; if (st[k] !== undefined) return st[k]; id = st.parent; } return undefined; };
    const fillId = o.fill ?? fromStyle("fill"), lineId = o.line ?? fromStyle("line");
    const fs = fillId !== undefined ? fills.get(fillId) : undefined;
    const ls = lineId !== undefined ? lines.get(lineId) : undefined;
    let fill: CdrFill | null = null;
    if (fs && fs.type !== "none") { fill = { type: fs.type, color: fs.color ? rgb(fs.color) : undefined }; if (fs.type !== "solid") skip(`${fs.type === "other" ? "special (fountain/mesh)" : fs.type} fills (shape imported without its fill)`); }
    let outline: CdrOutline | null = null;
    if (ls && !(ls.lineType & 0x1) && (ls.lineType & 0x6)) {
      const scales = (ls.lineType & 0x20) !== 0; let k = 1;
      if (scales) { const t = o.trafos[0]; if (t) k = Math.max(Math.hypot(t[0], t[3]), Math.hypot(t[1], t[4])); }
      outline = { color: rgb(ls.color), width: ls.width * k * ls.stretch * MM_PER_IN, dashed: ls.dashes > 0 && (ls.lineType & 0x4) !== 0, scalesWithObject: scales };
    }
    for (const col of [fill?.color, outline?.color]) if (col?.approx === "spot-palette-unresolved") skip("spot (palette) colours shown as grey");
    shapes++;
    target().push({ kind: "shape", source: o.source ?? "curve", paths, fill, outline, opacity: o.opacity });
  };

  const walk = (rs: Rec[], obj: Obj | null) => {
    for (const r of rs) {
      if (r.list) {
        switch (r.list) {
          case "page":
            if (page && !ignorePage) pages.push(page);
            pageGeom = pageSizes[pageIndex++] ?? defPage;
            page = { width: pageGeom.w * MM_PER_IN, height: pageGeom.h * MM_PER_IN, layers: [] }; layer = null; pageFlagsPending = true; ignorePage = false;
            walk(r.children, null);
            continue;
          case "layr":
            layer = page && !ignorePage ? { index: page.layers.length, objects: [] } : null;
            if (layer) page!.layers.push(layer);
            layerFlagsPending = true; layerHidden = false;
            walk(r.children, null);
            layer = null;
            continue;
          case "obj ": {
            if (layerHidden) { skip("objects on hidden, non-printing layers"); continue; }
            const o: Obj = { path: new PathBuilder(), trafos: [], opacity: 1 };
            walk(r.children, o); flush(o);
            continue;
          }
          case "grp ": case "lnkg": {
            const g: CdrGroup = { kind: "group", children: [] };
            target().push(g); stack.push(g.children);
            walk(r.children, null);
            stack.pop();
            continue;
          }
          case "vect": case "clpt": skip(r.list === "vect" ? "vector pattern definitions" : "clip (PowerClip) containers"); continue;
        }
        walk(r.children, obj);
        continue;
      }
      try {
        switch (r.id) {
          case "flgs": {
            const f = new Cur(r.data).u32();
            if (layerFlagsPending) { layerFlagsPending = false; layerHidden = !(f & 0x00ff0000) && (f & 0x100) !== 0; }
            if (pageFlagsPending) { pageFlagsPending = false; if (f & 0x00ff0000 && version >= 400) ignorePage = true; }
            break;
          }
          case "loda": case "lobj": if (obj) readLoda(r.data, obj); break;
          case "trfd": if (obj) obj.trafos = readTrfd(r.data); break;
          // (text: counted once, from its object record above)
        }
      } catch { skip("damaged records"); }
    }
  };
  walk(root, null);
  if (page && !ignorePage) pages.push(page);
  if (pendingIgnored.length) {
    if (pages[0]) pages[0].layers.unshift({ index: 0, objects: pendingIgnored });
    else skip("objects outside any page", pendingIgnored.length);
    warnings.push(`${pendingIgnored.length} object(s) from the master page or desktop were placed on page 1, as libcdr does.`);
    pendingIgnored = [];
  }
  // CorelDRAW stores the top-most object first; libcdr draws in reverse (m_reverseOrder). Return bottom → top.
  const reverse = (ns: CdrNode[]) => { ns.reverse(); for (const n of ns) if (n.kind === "group") reverse(n.children); };
  for (const p of pages) { p.layers = p.layers.filter((l) => l.objects.length).reverse(); p.layers.forEach((l, i) => { l.index = i; reverse(l.objects); }); }
  if (Object.keys(skipped).some((k) => k.includes("text"))) warnings.push("Text is not imported yet. Convert text to curves in CorelDRAW (Ctrl+Q) before saving, or it will be missing.");
  return { version, container, pages, skipped, warnings };
}

/** Every shape in a node list, depth first, in drawing order. */
export function cdrShapes(nodes: CdrNode[]): CdrShape[] {
  const out: CdrShape[] = [];
  const go = (ns: CdrNode[]) => { for (const n of ns) if (n.kind === "shape") out.push(n); else go(n.children); };
  go(nodes); return out;
}
export { CdrError };
