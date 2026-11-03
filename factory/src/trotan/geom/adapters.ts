// Machine adapter API. An adapter describes a machine and, if (and only if) it has a documented and
// validated interface, submits jobs to it. TROTAN ships one adapter: the virtual laser, which runs the
// toolpath in simulation. Real machines are listed as "no validated interface" and cannot be run.
import type { MachineCaps, Toolpath } from "./laser";
import type { OpType } from "./core";

export interface AdapterInfo {
  id: string;                 // e.g. "virtual"
  name: string;
  manufacturer: string; model: string;
  connection: "simulation" | "local-gateway" | "network" | "none";
  laserType: MachineCaps["laserType"];
  operations: OpType[];
  status: { reports: boolean; safety: string[] };   // what state the machine can report (e-stop, lid, interlocks…)
  submit: "simulation" | "not-available";
  notes: string;
}
export type RunState = "idle" | "running" | "paused" | "done" | "aborted" | "error";
export interface RunProgress { state: RunState; t: number; total: number; item: number; items: number; head: [number, number] | null; laserOn: boolean }
export interface MachineAdapter {
  info(caps: MachineCaps): AdapterInfo;
  /** Readiness as reported by the machine. The virtual laser is always ready; real adapters must report e-stop/interlocks. */
  readiness(): Promise<{ ready: boolean; checks: { name: string; ok: boolean; detail: string }[] }>;
  run(tp: Toolpath, seconds: number, onProgress: (p: RunProgress) => void, signal: AbortSignal, speedUp?: number): Promise<RunState>;
}

/** Virtual laser: follows the ordered toolpath in (accelerated) real time. No hardware involved. */
export const VirtualLaser: MachineAdapter = {
  info: (caps) => ({ id: "virtual", name: "Virtual laser (simulation)", manufacturer: "TROTAN", model: "Simulator", connection: "simulation", laserType: caps.laserType,
    operations: caps.ops, status: { reports: true, safety: ["simulated: no laser, no motion"] }, submit: "simulation",
    notes: "Runs the job in simulation only. It never drives hardware and is not a safety validation." }),
  readiness: async () => ({ ready: true, checks: [{ name: "Simulation", ok: true, detail: "No hardware — nothing to check" }] }),
  run: (tp, seconds, onProgress, signal, speedUp = 20) => new Promise((resolve) => {
    const total = Math.max(0.5, seconds), items = tp.items.length;
    const t0 = performance.now();
    const tick = () => {
      if (signal.aborted) { onProgress({ state: "aborted", t: 0, total, item: 0, items, head: null, laserOn: false }); resolve("aborted"); return; }
      const t = Math.min(total, ((performance.now() - t0) / 1000) * speedUp);
      const k = Math.min(items - 1, Math.floor((t / total) * items));
      const it = tp.items[Math.max(0, k)];
      const head: [number, number] | null = !it ? null : "box" in it ? [it.box.x + it.box.w * ((t * 7) % 1), it.box.y + it.box.h * ((t / total * items) % 1)] : it.pts[Math.min(it.pts.length - 1, Math.floor(((t / total) * items - k) * it.pts.length))];
      onProgress({ state: t >= total ? "done" : "running", t, total, item: k + 1, items, head, laserOn: t < total });
      if (t >= total) resolve("done"); else setTimeout(tick, 50);
    };
    tick();
  }),
};
/** Machines that exist but have no validated interface: shown, configurable, never runnable. */
export const NO_INTERFACE = (manufacturer: string, model: string): AdapterInfo => ({
  id: "none", name: `${manufacturer} ${model}`, manufacturer, model, connection: "none", laserType: "co2", operations: [], status: { reports: false, safety: [] }, submit: "not-available",
  notes: "No documented, authorised control interface has been validated for this machine. Prepare and export the job here, then run it with the manufacturer's software and the machine's own start and safety procedure.",
});
export const ADAPTERS: Record<string, MachineAdapter> = { virtual: VirtualLaser };
