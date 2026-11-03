import type { Project, SimConfig } from "./types";
export const SCHEMA = 1;
export const uid = (p = "") => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const DEFAULT_SIM: SimConfig = {
  analysis: "op",
  tran: { stop: "10m", step: "10u", start: "0", uic: false },
  ac: { type: "dec", points: 20, fstart: "10", fstop: "1meg" },
  dc: { source: "", start: "0", stop: "5", step: "0.1" },
  temp: 27,
};
export function newProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    format: "nucleus", schema: SCHEMA, id: uid("p"), name, created: now, modified: now, revision: 1, revisions: [{ n: 1, at: now, note: "Created" }], units: "mm",
    sheets: [{ id: "S1", name: "Root sheet", size: "A4", title: name, revision: "A", author: "" }],
    parts: [], wires: [], labels: [], notes: [], probes: [], sim: structuredClone(DEFAULT_SIM), instruments: [], pcb: null,
    settings: { grid: 100, ercIgnore: [] },
  };
}
