// .nuclues project files (older .nucleus files open too): versioned JSON with a SHA-256 of the canonical project for corruption detection.
import type { Project } from "../core/types";
import { SCHEMA } from "../core/project";
import { DEVICE } from "../library/devices";

export const APP_VERSION = "0.1.0";
export interface FileEnvelope { format: "nucleus-project"; schema: number; app: string; saved: string; sha256: string; project: Project }
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function saveFile(pr: Project): Promise<string> {
  const env: FileEnvelope = { format: "nucleus-project", schema: SCHEMA, app: `NUCLUES ${APP_VERSION}`, saved: new Date().toISOString(), sha256: await sha256(canonical(pr)), project: pr };
  return JSON.stringify(env, null, 1);
}
/** Upgrades older schemas step by step. */
const MIGRATIONS: Record<number, (p: Record<string, unknown>) => Record<string, unknown>> = {};
export class FileError extends Error { constructor(msg: string, public recoverable = false, public project?: Project) { super(msg); } }
export async function openFile(text: string, opts: { acceptChecksumMismatch?: boolean } = {}): Promise<{ project: Project; warnings: string[] }> {
  let env: FileEnvelope;
  try { env = JSON.parse(text); } catch { throw new FileError("This is not a NUCLUES project (the file is not valid JSON)."); }
  if (env?.format !== "nucleus-project" || !env.project) throw new FileError("This is not a NUCLUES project file.");
  if (typeof env.schema !== "number" || env.schema > SCHEMA) throw new FileError(`This project was saved by a newer NUCLUES (schema ${env.schema}). Update NUCLUES to open it.`);
  const warnings: string[] = [];
  const sum = await sha256(canonical(env.project));
  if (sum !== env.sha256) {
    if (!opts.acceptChecksumMismatch) throw new FileError("The project file has been changed or damaged since it was saved (checksum mismatch).", true, env.project);
    warnings.push("Opened despite a checksum mismatch — check the design carefully.");
  }
  let p = env.project as unknown as Record<string, unknown>;
  for (let s = env.schema; s < SCHEMA; s++) { const m = MIGRATIONS[s]; if (!m) throw new FileError(`No upgrade path from schema ${s}.`); p = m(p); warnings.push(`Upgraded from schema ${s} to ${s + 1}.`); }
  const project = p as unknown as Project;
  validate(project);
  return { project, warnings };
}
export function validate(pr: Project) {
  const bad = (m: string) => { throw new FileError(`Project is damaged: ${m}`); };
  if (pr.format !== "nucleus" || !Array.isArray(pr.parts) || !Array.isArray(pr.wires) || !Array.isArray(pr.sheets) || !pr.sheets.length) bad("missing sections");
  const ids = new Set<string>(); const sheets = new Set(pr.sheets.map((s) => s.id));
  for (const x of [...pr.parts, ...pr.wires, ...pr.labels, ...(pr.notes ?? []), ...(pr.probes ?? [])]) { if (ids.has(x.id)) bad(`duplicate id ${x.id}`); ids.add(x.id); if (!sheets.has((x as { sheet: string }).sheet)) bad(`${x.id} is on a missing sheet`); }
  for (const p of pr.parts) { if (!DEVICE.has(p.device)) bad(`${p.ref} uses device “${p.device}” which is not in the library`); if (!p.at.every(Number.isInteger)) bad(`${p.ref} has a non-grid position`); }
  for (const w of pr.wires) if (w.pts.length < 2 || !w.pts.every((q) => q.every(Number.isInteger))) bad(`wire ${w.id} has invalid points`);
}
