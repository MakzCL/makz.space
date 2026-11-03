// The .trotan project file: versioned JSON with the design, operation settings, material reference
// and revision log. Readers upgrade older versions and reject anything they cannot understand.
import type { Doc, OpType } from "./core";
import type { OpParams } from "./laser";

export const FORMAT = "trotan-project";
export const FORMAT_VERSION = 1;
export interface ProjectFile {
  format: typeof FORMAT; formatVersion: number;
  name: string; savedAt: string; app: string;
  doc: Doc;
  ops?: Partial<Record<OpType, OpParams>>;
  material?: { id: string; name: string } | null;
  revisions?: { version: number; note: string; at: string; by?: string }[];
}
export function writeProject(p: Omit<ProjectFile, "format" | "formatVersion" | "savedAt" | "app">): string {
  return JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION, savedAt: new Date().toISOString(), app: "TROTAN", ...p });
}
export function readProject(text: string): ProjectFile {
  let j: ProjectFile;
  try { j = JSON.parse(text); } catch { throw new Error("Not a TROTAN project (not JSON)"); }
  if (j?.format !== FORMAT) throw new Error("Not a TROTAN project file");
  if (typeof j.formatVersion !== "number" || j.formatVersion > FORMAT_VERSION) throw new Error(`This project was saved by a newer TROTAN (format ${j.formatVersion}) — update TROTAN to open it.`);
  checkDoc(j.doc);
  return j;
}
/** Structural check of a design document; throws a readable error on anything malformed. */
export function checkDoc(d: unknown): asserts d is Doc {
  const doc = d as Doc;
  if (!doc || doc.format !== "trotan" || doc.units !== "mm") throw new Error("Design is missing or not in millimetres");
  if (!(doc.width > 0 && doc.height > 0)) throw new Error("Design size must be positive");
  if (!Array.isArray(doc.layers) || !Array.isArray(doc.objects)) throw new Error("Design has no layers/objects");
  const ids = new Set(doc.layers.map((l) => l.id));
  const walk = (os: Doc["objects"]) => { for (const o of os) {
    if (!o || typeof o.id !== "string" || !Array.isArray(o.m) || o.m.length !== 6 || o.m.some((v) => !Number.isFinite(v))) throw new Error("An object has an invalid transform");
    if (!ids.has(o.layer)) throw new Error(`An object refers to a missing layer (${o.layer})`);
    if (o.kind === "group") walk(o.children);
  } };
  walk(doc.objects);
}
