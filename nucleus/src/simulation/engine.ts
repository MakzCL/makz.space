// ngspice (BSD) compiled to WebAssembly, via EEcircuit-engine (MIT). Same engine in the browser worker and in tests.
import { Simulation, type ResultType } from "eecircuit-engine";

export interface Vector { name: string; type: "voltage" | "current" | "time" | "frequency" | "notype"; re: number[]; im?: number[] }
export interface RawResult { plot: string; vectors: Vector[]; points: number; complex: boolean; errors: string[]; log: string }
let sim: Simulation | null = null; let starting: Promise<void> | null = null;
export async function engine(): Promise<Simulation> {
  if (sim && sim.isInitialized()) return sim;
  if (!starting) { sim = new Simulation(); starting = sim.start(); }
  await starting; return sim!;
}
export async function runSpice(deck: string, timeoutMs = 60000): Promise<RawResult> {
  if (/[^\x20-\x7e\n\r\t]/.test(deck)) throw new Error("The SPICE deck contains non-ASCII characters");
  const s = await engine();
  s.setNetList(deck);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const r: ResultType = await Promise.race([s.runSim(), new Promise<never>((_, rej) => { timer = setTimeout(() => { sim = null; starting = null; rej(new Error(`The simulator did not finish within ${timeoutMs / 1000} s`)); }, timeoutMs); })]);
  clearTimeout(timer);
  const errors = s.getError().filter((e) => e.trim());
  const plot = /Plotname:\s*(.*)/.exec(r.header)?.[1]?.trim() ?? "";
  const vectors: Vector[] = r.dataType === "real"
    ? r.data.map((d) => ({ name: d.name, type: d.type, re: d.values as number[] }))
    : r.data.map((d) => ({ name: d.name, type: d.type, re: (d.values as { real: number; img: number }[]).map((v) => v.real), im: (d.values as { real: number; img: number }[]).map((v) => v.img) }));
  return { plot, vectors, points: r.numPoints, complex: r.dataType === "complex", errors, log: s.getInfo?.() ?? "" };
}
