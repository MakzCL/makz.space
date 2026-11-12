// Content-based format detection for SK Suite. The extension is only a hint: a file is identified by its signature and
// structure, its version is read where the format records one, and a file whose content matches nothing is reported as
// unknown — never guessed. Detection never executes or renders file content.
import { isZip, zipEntries, zipRead, type InflateRaw } from "./zip.ts";

export type FormatId =
  | "cdr" | "cdt" | "cmx" | "ai" | "eps" | "pdf" | "svg" | "svgz" | "dxf" | "dxf-binary" | "dwg" | "hpgl"
  | "png" | "jpeg" | "gif" | "bmp" | "tiff" | "webp" | "psd"
  | "step" | "iges" | "stl" | "stl-binary" | "3mf" | "ole-cad" | "f3d"
  | "proteus-legacy" | "proteus-project"
  | "csv" | "xlsx" | "json"
  | "trotan-project" | "nucleus-project" | "cadra-drawing" | "zip" | "unknown";

export interface Detection {
  format: FormatId;
  /** Human-readable name, e.g. "CorelDRAW drawing". */
  label: string;
  /** Version as recorded in the file, e.g. "CDR 14 (CorelDRAW X4)", "AutoCAD 2018 (AC1032)"; null if the format has none or it is unreadable. */
  version: string | null;
  /** How sure: "signature" = magic bytes / structure matched; "structure" = parsed header; "extension" = only the name suggests it. */
  basis: "signature" | "structure" | "extension" | "none";
  /** Facts learned while detecting (container type, entries, mismatches). */
  notes: string[];
  /** The extension does not match the content (e.g. a PNG renamed to .cdr). */
  extensionMismatch: boolean;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, Math.min(b.length, o + n)));
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

/** CorelDRAW stores its major version as one character after "CDR" in the RIFF form type (libcdr's convention). */
export function cdrVersionFromChar(c: number): number | null {
  if (c === 0x20) return 3;
  if (c >= 0x31 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x5a) return c - 0x37;
  if (c >= 0x61 && c <= 0x7a) return c - 0x57; // lower-case form types seen in some files
  return null;
}
const CDR_RELEASE: Record<number, string> = { 3: "CorelDRAW 3", 4: "CorelDRAW 4", 5: "CorelDRAW 5", 6: "CorelDRAW 6", 7: "CorelDRAW 7", 8: "CorelDRAW 8", 9: "CorelDRAW 9", 10: "CorelDRAW 10", 11: "CorelDRAW 11", 12: "CorelDRAW 12", 13: "CorelDRAW X3", 14: "CorelDRAW X4", 15: "CorelDRAW X5", 16: "CorelDRAW X6", 17: "CorelDRAW X7", 18: "CorelDRAW X8", 19: "CorelDRAW 2017", 20: "CorelDRAW 2018", 21: "CorelDRAW 2019", 22: "CorelDRAW 2020", 23: "CorelDRAW 2021" };
// Releases after 2021 (internal 23) are not mapped: we have not verified which internal number each one writes.
export const cdrRelease = (v: number) => CDR_RELEASE[v] ?? (v > 23 ? `CorelDRAW 2022 or later (internal version ${v})` : `internal version ${v}`);

const DWG_RELEASE: Record<string, string> = { AC1012: "R13", AC1014: "R14", AC1015: "AutoCAD 2000", AC1018: "AutoCAD 2004", AC1021: "AutoCAD 2007", AC1024: "AutoCAD 2010", AC1027: "AutoCAD 2013", AC1032: "AutoCAD 2018" };
const LABEL: Record<FormatId, string> = {
  cdr: "CorelDRAW drawing", cdt: "CorelDRAW template", cmx: "Corel Presentation Exchange (CMX)", ai: "Adobe Illustrator", eps: "Encapsulated PostScript", pdf: "PDF document",
  svg: "SVG", svgz: "Compressed SVG", dxf: "DXF (ASCII)", "dxf-binary": "DXF (binary)", dwg: "AutoCAD DWG", hpgl: "HPGL plot file",
  png: "PNG image", jpeg: "JPEG image", gif: "GIF image", bmp: "BMP image", tiff: "TIFF image", webp: "WebP image", psd: "Photoshop document",
  step: "STEP (ISO 10303-21)", iges: "IGES", stl: "STL (ASCII)", "stl-binary": "STL (binary)", "3mf": "3D Manufacturing Format", "ole-cad": "OLE compound document (SolidWorks / Inventor)", f3d: "Fusion 360 archive",
  "proteus-legacy": "Proteus design file (legacy)", "proteus-project": "Proteus project", csv: "CSV table", xlsx: "Excel workbook", json: "JSON",
  "trotan-project": "TROTAN project", "nucleus-project": "NUCLEUS project", "cadra-drawing": "CADRA drawing", zip: "ZIP archive", unknown: "Unknown format",
};
/** Extensions each format is normally saved with (for the mismatch check). */
const EXTS: Partial<Record<FormatId, string[]>> = {
  cdr: ["cdr", "cdt"], cdt: ["cdt", "cdr"], cmx: ["cmx"], ai: ["ai", "pdf"], eps: ["eps", "ai", "epsf", "ps"], pdf: ["pdf", "ai"], svg: ["svg"], svgz: ["svgz", "svg"], dxf: ["dxf"], "dxf-binary": ["dxf"], dwg: ["dwg"], hpgl: ["plt", "hpgl", "hpg"],
  png: ["png"], jpeg: ["jpg", "jpeg", "jfif"], gif: ["gif"], bmp: ["bmp", "dib"], tiff: ["tif", "tiff"], webp: ["webp"], psd: ["psd", "psb"], step: ["step", "stp"], iges: ["iges", "igs"], stl: ["stl"], "stl-binary": ["stl"], "3mf": ["3mf"],
  "ole-cad": ["sldprt", "sldasm", "slddrw", "ipt", "iam", "idw"], f3d: ["f3d"], csv: ["csv", "txt"], xlsx: ["xlsx"], json: ["json"], "trotan-project": ["trotan", "json"], "nucleus-project": ["nucleus", "json"], "cadra-drawing": ["cadra", "json"],
};
function result(format: FormatId, version: string | null, basis: Detection["basis"], notes: string[], name: string): Detection {
  const ext = extOf(name); const known = EXTS[format];
  return { format, label: LABEL[format], version, basis, notes, extensionMismatch: !!(ext && known && !known.includes(ext) && basis !== "extension") };
}

export interface DetectOptions { inflateRaw?: InflateRaw }

/** Identify a file from its bytes. `name` is used only as a hint and for the extension-mismatch flag. */
export async function detect(bytes: Uint8Array, name = "", opts: DetectOptions = {}): Promise<Detection> {
  const b = bytes, ext = extOf(name), notes: string[] = [];
  const head = ascii(b, 0, 1024);
  // ---- RIFF family: CorelDRAW (CDR / CMX) and WebP
  if (ascii(b, 0, 4) === "RIFF" && b.length >= 12) {
    const form = ascii(b, 8, 4);
    if (form.slice(0, 3).toUpperCase() === "CDR") { const v = cdrVersionFromChar(b[11]); notes.push("RIFF container"); return result(ext === "cdt" ? "cdt" : "cdr", v ? `CDR ${v} (${cdrRelease(v)})` : null, "signature", notes, name); }
    if (form.slice(0, 3) === "CMX") return result("cmx", form[3] === "1" ? "CMX 1 (32-bit)" : `CMX (form ${form})`, "signature", notes, name);
    if (form === "WEBP") return result("webp", ascii(b, 12, 4).trim(), "signature", notes, name);
  }
  if (b.length >= 4 && b[0] === 0x57 && b[1] === 0x4c) return result("cdr", "CDR 2 (CorelDRAW 2, \"WL\" format)", "signature", ["pre-RIFF CorelDRAW 2 file"], name);
  // ---- ZIP containers
  if (isZip(b)) {
    const entries = zipEntries(b);
    if (!entries) return result("zip", null, "signature", ["ZIP signature, but the central directory is missing or damaged"], name);
    const names = new Set(entries.map((e) => e.name));
    const cdrMain = entries.find((e) => e.name === "content/riffData.cdr" || e.name === "content/root.dat");
    if (cdrMain) {
      notes.push(`ZIP container (${entries.length} entries), drawing stream ${cdrMain.name}`);
      const inner = await zipRead(b, cdrMain, opts.inflateRaw, 64 * 1024 * 1024).catch(() => null);
      let version: string | null = null;
      if (inner && ascii(inner, 0, 4) === "RIFF" && ascii(inner, 8, 3).toUpperCase() === "CDR") { const v = cdrVersionFromChar(inner[11]); version = v ? `CDR ${v} (${cdrRelease(v)})` : null; }
      else notes.push(inner ? "drawing stream is not a CDR RIFF stream" : "drawing stream not read (no decompressor available)");
      return result(ext === "cdt" ? "cdt" : "cdr", version, "structure", notes, name);
    }
    if (names.has("xl/workbook.xml")) return result("xlsx", null, "structure", [`${entries.length} entries`], name);
    if (names.has("3D/3dmodel.model")) return result("3mf", null, "structure", [], name);
    if (entries.some((e) => e.name.endsWith(".f3d") || e.name === "Manifest.dat")) return result("f3d", null, "structure", ["Fusion archive structure (contents proprietary)"], name);
    return result("zip", null, "signature", [`${entries.length} entries; not a format SK Suite recognises`], name);
  }
  // ---- images
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return result("png", null, "signature", notes, name);
  if (startsWith(b, [0xff, 0xd8, 0xff])) return result("jpeg", null, "signature", notes, name);
  if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) return result("gif", head.slice(3, 6), "signature", notes, name);
  if (head.startsWith("BM") && b.length >= 18 && (b[2] | (b[3] << 8) | (b[4] << 16)) <= b.length + 1024) return result("bmp", null, "signature", notes, name);
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return result("tiff", startsWith(b, [0x49, 0x49]) ? "little-endian" : "big-endian", "signature", notes, name);
  if (head.startsWith("8BPS")) return result("psd", b[5] === 2 ? "PSB (large document)" : "PSD", "signature", notes, name);
  // ---- PDF / Illustrator / PostScript
  if (head.startsWith("%PDF-")) {
    const v = head.slice(5, 8); const chunk = ascii(b, 0, Math.min(b.length, 2 * 1024 * 1024));
    const ai = /Adobe Illustrator|AIPrivateData|illustrator:/i.test(chunk);
    if (ai || ext === "ai") return result("ai", `PDF-based Illustrator (PDF ${v})${ai ? "" : "; no Illustrator marker found"}`, ai ? "structure" : "signature", ai ? ["Illustrator private data present"] : [], name);
    return result("pdf", `PDF ${v}`, "signature", notes, name);
  }
  if (startsWith(b, [0xc5, 0xd0, 0xd3, 0xc6])) return result("eps", "DOS EPS binary (PostScript + preview)", "signature", notes, name);
  if (head.startsWith("%!PS-Adobe")) {
    const creator = head.match(/%%Creator:\s*([^\r\n]+)/)?.[1] ?? ""; const eps = /EPSF-(\d\.\d)/.exec(head.split(/\r?\n/)[0] ?? "")?.[1];
    if (/Illustrator/i.test(creator)) return result("ai", `PostScript-based Illustrator (${creator.trim()})`, "structure", [], name);
    return result("eps", eps ? `EPSF ${eps}` : "PostScript", "signature", creator ? [`Creator: ${creator.trim()}`] : [], name);
  }
  // ---- gzip (SVGZ)
  if (startsWith(b, [0x1f, 0x8b])) return result(ext === "svgz" || ext === "svg" ? "svgz" : "unknown", null, ext === "svgz" || ext === "svg" ? "signature" : "none", ["gzip-compressed"], name);
  // ---- CAD
  if (/^AC10\d\d/.test(head)) { const code = head.slice(0, 6); return result("dwg", DWG_RELEASE[code] ? `${DWG_RELEASE[code]} (${code})` : code, "signature", notes, name); }
  if (head.startsWith("AutoCAD Binary DXF")) return result("dxf-binary", null, "signature", notes, name);
  if (head.startsWith("ISO-10303-21;")) { const schema = ascii(b, 0, 8192).match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/)?.[1]; return result("step", schema ?? null, "signature", notes, name); }
  if (b.length >= 84 && ext === "stl" && !head.startsWith("solid")) { const n = b[80] | (b[81] << 8) | (b[82] << 16) | (b[83] << 24); if (84 + 50 * n === b.length) return result("stl-binary", `${n} triangles`, "structure", [], name); }
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return result("ole-cad", null, "signature", ["OLE compound document; the CAD payload inside is proprietary"], name);
  // ---- text formats
  const text = head.replace(/^﻿/, "");
  const trimmed = text.trimStart();
  if (/^0\s*\r?\n\s*SECTION/.test(trimmed) || /^999\r?\n/.test(trimmed)) { const v = ascii(b, 0, 4096).match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/)?.[1]; return result("dxf", v ? `${DWG_RELEASE[v] ?? v} (${v})` : "version not stated (R12 or earlier)", "structure", notes, name); }
  if (trimmed.startsWith("solid") && /facet\s+normal/.test(ascii(b, 0, 4096))) return result("stl", null, "structure", notes, name);
  if (/^.{72}S\s*0*1\r?\n/.test(text) && /^.{72}[GD]/m.test(ascii(b, 0, 8192))) return result("iges", null, "structure", notes, name);
  if (trimmed.startsWith("<")) {
    const x = ascii(b, 0, 4096);
    if (/<svg[\s>]/i.test(x)) return result("svg", x.match(/<svg[^>]*\sversion="([^"]+)"/)?.[1] ?? null, "structure", notes, name);
  }
  if (trimmed.startsWith("{")) {
    const fmt = ascii(b, 0, 4096).match(/"format"\s*:\s*"([^"]+)"/)?.[1];
    if (fmt === "trotan") return result("trotan-project", null, "structure", notes, name);
    if (fmt === "nucleus-project" || fmt === "nucleus") return result("nucleus-project", null, "structure", notes, name);
    if (fmt === "cadra") return result("cadra-drawing", null, "structure", notes, name);
    return result("json", null, "structure", notes, name);
  }
  if (/^(IN;|IN\s|\x1bE|PU;|PA|SP\d)/.test(trimmed) && ["plt", "hpgl", "hpg"].includes(ext)) return result("hpgl", null, "structure", ["HPGL commands at the start"], name);
  if (["csv", "txt"].includes(ext) && /^[^\0]*[,;\t][^\0]*\r?\n/.test(text)) return result("csv", null, "structure", notes, name);
  // ---- known by name only: proprietary formats with no public structure we check
  if (["dsn", "lyt"].includes(ext)) return result("proteus-legacy", null, "extension", ["Proteus 7/8 design files use an undocumented binary format; content not verified"], name);
  if (ext === "pdsprj") return result("proteus-project", null, "extension", ["Proteus 8/9 project; undocumented container; content not verified"], name);
  return result("unknown", null, "none", ext ? [`.${ext} extension, but the content matches no known format`] : [], name);
}
