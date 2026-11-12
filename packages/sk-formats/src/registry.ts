// Importer / exporter registry shared by SK Suite applications. Each adapter declares what it really does, at one of the
// support levels below, with the evidence (tests) for that claim. Applications keep their own document models; only this
// contract and the detection are shared. The launcher uses `routeFor` to decide which application opens a file.
import type { Detection, FormatId } from "./detect.ts";

export type App = "trotan" | "cadra" | "nucleus" | "kortana" | "factory";
/** The support levels from the SK Suite interoperability specification (weakest first). */
export type Level = "unsupported" | "preview-only" | "partial-import" | "verified-import" | "verified-import-export" | "verified-round-trip";
export const LEVEL_LABEL: Record<Level, string> = {
  unsupported: "Unsupported", "preview-only": "Preview only", "partial-import": "Partial editable import", "verified-import": "Verified editable import",
  "verified-import-export": "Verified import and export", "verified-round-trip": "Verified round-trip (defined features and versions)",
};

export interface Adapter {
  id: string;
  app: App;
  formats: FormatId[];
  label: string;
  read: Level;
  write: Level;
  /** Versions this level was verified against; anything else is untested. */
  versionsVerified: string[];
  preserves: string[];
  unsupported: string[];
  limitations: string[];
  /** Test files or suites that back the stated level. */
  tests: string[];
}

export class Registry {
  private list: Adapter[] = [];
  register(a: Adapter) { if (this.list.some((x) => x.id === a.id)) throw new Error(`Adapter ${a.id} registered twice`); this.list.push(a); return this; }
  all(app?: App) { return this.list.filter((a) => !app || a.app === app); }
  /** The adapter of `app` that reads `format`, or null. */
  reader(app: App, format: FormatId) { return this.list.find((a) => a.app === app && a.formats.includes(format) && a.read !== "unsupported") ?? null; }
  writer(app: App, format: FormatId) { return this.list.find((a) => a.app === app && a.formats.includes(format) && a.write !== "unsupported") ?? null; }
  /** Every app that can read this detected file, best support first. */
  readersFor(d: Detection) {
    const order: Level[] = ["verified-round-trip", "verified-import-export", "verified-import", "partial-import", "preview-only"];
    return this.list.filter((a) => a.formats.includes(d.format) && a.read !== "unsupported").sort((a, b) => order.indexOf(a.read) - order.indexOf(b.read));
  }
}

/** Default application per format for the launcher (an app may still be offered when it has a reader). */
export const DEFAULT_APP: Partial<Record<FormatId, App>> = {
  cdr: "trotan", cdt: "trotan", cmx: "trotan", ai: "trotan", eps: "trotan", pdf: "trotan", svg: "trotan", svgz: "trotan", hpgl: "trotan",
  png: "trotan", jpeg: "trotan", gif: "trotan", bmp: "trotan", tiff: "trotan", webp: "trotan", psd: "trotan",
  dwg: "cadra", dxf: "cadra", "dxf-binary": "cadra", step: "cadra", iges: "cadra", stl: "cadra", "stl-binary": "cadra", "3mf": "cadra", "ole-cad": "cadra", f3d: "cadra",
  "proteus-legacy": "nucleus", "proteus-project": "nucleus", "nucleus-project": "nucleus", "trotan-project": "trotan", "cadra-drawing": "cadra",
  csv: "kortana", xlsx: "kortana",
};
/** Where a file should open, and why. Never routes on the extension alone when the content says otherwise. */
export function routeFor(d: Detection, reg: Registry): { app: App | null; adapter: Adapter | null; reason: string } {
  if (d.format === "unknown" || d.format === "zip") return { app: null, adapter: null, reason: `Not a recognised format${d.notes.length ? ` (${d.notes[0]})` : ""}` };
  const def = DEFAULT_APP[d.format] ?? null; const readers = reg.readersFor(d);
  const pick = readers.find((a) => a.app === def) ?? readers[0] ?? null;
  if (!pick) return { app: def, adapter: null, reason: `${d.label}${d.version ? ` ${d.version}` : ""} is recognised, but no SK Suite application can read it yet` };
  return { app: pick.app, adapter: pick, reason: `${d.label} → ${pick.app.toUpperCase()} (${LEVEL_LABEL[pick.read]})` };
}

/** What an import produced and what it lost; shown to the user before the import is committed. */
export interface ImportReport {
  file: string; detection: Detection; adapter: string;
  counts: Record<string, number>;
  warnings: { code: string; message: string; severity: "info" | "warning" | "loss" }[];
}
