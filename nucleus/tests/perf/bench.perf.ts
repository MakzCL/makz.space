// Performance benchmark: npx vitest run --config vitest.perf.config.ts  → tests/perf/results.json
// Resistor ladders of N parts (V1 → R1 → … → RN → GND, nets by label) exercise the real code paths.
import { it } from "vitest";
import fs from "node:fs"; import os from "node:os";
import { ladder, placedBoard, denseBoard } from "./fixtures";
import { connectivity } from "../../src/connectivity/connectivity";
import { erc } from "../../src/erc/erc";
import { buildSpice } from "../../src/simulation/netlist";
import { runSpice } from "../../src/simulation/engine";
import { saveFile, openFile } from "../../src/storage/file";
import { moveItems } from "../../src/schematic/ops";
import { ratsnest, padsOf } from "../../src/pcb/board";
import { drc } from "../../src/pcb/drc";

const time = async <T,>(f: () => T | Promise<T>, reps = 1): Promise<{ ms: number; v: T }> => { let v!: T; const t0 = performance.now(); for (let i = 0; i < reps; i++) v = await f(); return { ms: (performance.now() - t0) / reps, v }; };
it("benchmark", async () => {
  const out: Record<string, unknown> = { date: new Date().toISOString(), cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), node: process.version, rows: [] as unknown[] };
  for (const n of [100, 500, 2000]) {
    const build = await time(() => ladder(n)); const pr = build.v; const row: Record<string, number | string> = { parts: n };
    row.buildMs = build.ms;
    row.connectivityMs = (await time(() => connectivity(pr), 5)).ms;
    const c = connectivity(pr); row.nets = c.nets.length;
    row.ercMs = (await time(() => erc(pr, c), 3)).ms;
    row.netlistMs = (await time(() => buildSpice(pr, c), 3)).ms;
    const sv = await time(() => saveFile(pr), 3); row.saveMs = sv.ms; row.fileKB = Math.round(sv.v.length / 1024);
    row.openMs = (await time(() => openFile(sv.v), 3)).ms;
    row.moveOnePartMs = (await time(() => moveItems(pr, new Set([pr.parts[Math.floor(n / 2)].id]), 100, 0), 10)).ms;
    const deck = buildSpice(pr, c); const sim = await time(() => runSpice(deck.text)); row.ngspiceOpMs = sim.ms;
    const heapBefore = process.memoryUsage().heapUsed;
    const board = placedBoard(pr); row.pcbSyncMs = (await time(() => placedBoard(pr))).ms;
    const pads = padsOf(board, pr); row.pads = pads.length;
    row.ratsnestMs = (await time(() => ratsnest(board, pr))).ms;
    row.drcUnroutedMs = (await time(() => drc(board, pr))).ms;
    const dense = denseBoard(pr);
    row.boardObjects = pads.length + dense.tracks.length + dense.vias.length;
    const dd = await time(() => drc(dense, pr)); row.drcDenseMs = dd.ms; row.drcFindings = dd.v.length;
    row.heapMB = Math.round((process.memoryUsage().heapUsed - heapBefore) / 2 ** 20);
    (out.rows as unknown[]).push(row); console.log(JSON.stringify(row));
  }
  fs.writeFileSync("tests/perf/results.json", JSON.stringify(out, null, 1));
});
