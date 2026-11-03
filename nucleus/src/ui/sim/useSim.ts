// Simulation runner: validate → build deck → solve in the worker → map back onto nets.
import { useCallback, useRef, useState } from "react";
import type { AnalysisKind } from "../../core/types";
import { buildSpice, type SimDiag } from "../../simulation/netlist";
import { mapResult } from "../../simulation/results";
import type { RawResult } from "../../simulation/engine";
import { useStore } from "../store";

export type SimState = "idle" | "starting" | "running" | "done" | "failed" | "stopped";
export interface SimLog { at: string; level: "error" | "warning" | "info"; text: string; part?: string }
let worker: Worker | null = null; let seq = 0;
const mk = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
export function useSim() {
  const S = useStore();
  const [state, setState] = useState<SimState>("idle");
  const [log, setLog] = useState<SimLog[]>([]);
  const [deck, setDeck] = useState("");
  const [ms, setMs] = useState<number | null>(null);
  const cur = useRef<{ id: number; reject: (e: Error) => void } | null>(null);
  const push = (l: SimLog[]) => setLog((x) => [...x, ...l].slice(-500));
  const stop = useCallback(() => { if (cur.current) { worker?.terminate(); worker = null; cur.current.reject(new Error("Stopped")); cur.current = null; setState("stopped"); push([{ at: new Date().toISOString(), level: "info", text: "Simulation stopped by the user (engine restarted)." }]); } }, []);
  const run = useCallback(async (analysis: AnalysisKind = S.pr.sim.analysis) => {
    if (cur.current) return;
    const pr = S.pr; const d = buildSpice(pr, undefined, analysis); setDeck(d.text);
    const now = () => new Date().toISOString();
    push([{ at: now(), level: "info", text: `${analysis.toUpperCase()} analysis — ${pr.parts.length} parts, ${S.con.nets.length} nets` }, ...d.diags.map((x: SimDiag) => ({ at: now(), level: x.level, text: x.message, part: x.part }))]);
    if (!d.ok) { setState("failed"); push([{ at: now(), level: "error", text: "Simulation not started — fix the errors above." }]); return null; }
    setState(worker ? "running" : "starting");
    worker ??= mk();
    const id = ++seq; const t0 = performance.now();
    try {
      const raw = await new Promise<RawResult>((res, rej) => {
        cur.current = { id, reject: rej };
        worker!.onmessage = (e) => { if (e.data.id !== id) return; if (e.data.ok) res(e.data.r); else rej(new Error(e.data.error)); };
        worker!.onerror = (e) => rej(new Error(e.message || "The simulator crashed"));
        worker!.postMessage({ id, deck: d.text });
      });
      cur.current = null;
      setMs(Math.round(performance.now() - t0));
      if (raw.errors.length) push(raw.errors.map((t) => ({ at: now(), level: "warning" as const, text: `ngspice: ${t}` })));
      if (!raw.vectors.length) { setState("failed"); push([{ at: now(), level: "error", text: "The simulator returned no results — see the ngspice messages above (often a floating node or a short circuit across a source)." }]); return null; }
      const r = mapResult(raw, d, analysis, pr.revision); r.at = now();
      S.setSim(r); setState("done");
      push([{ at: now(), level: "info", text: `Solved: ${raw.plot} · ${raw.points} point${raw.points === 1 ? "" : "s"} · ${Math.round(performance.now() - t0)} ms` }]);
      return r;
    } catch (e) {
      cur.current = null; if ((e as Error).message !== "Stopped") { setState("failed"); push([{ at: now(), level: "error", text: (e as Error).message }]); worker?.terminate(); worker = null; }
      return null;
    }
  }, [S]);
  return { state, log, deck, ms, run, stop, reset: () => { S.setSim(null); setState("idle"); }, clearLog: () => setLog([]) };
}
export type SimApi = ReturnType<typeof useSim>;
