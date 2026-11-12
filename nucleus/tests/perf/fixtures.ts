// Shared fixtures for the benchmark and DRC equivalence check.
import { B } from "../../src/examples/build";
import { sync, newBoard, padsOf, type Board } from "../../src/pcb/board";
import { mm } from "../../src/pcb/footprints";
import type { Project } from "../../src/core/types";
export function ladder(n: number) {
  const b = new B(`ladder ${n}`); b.part("V1", "VSOURCE", [-1000, 0], 0, { value: "5" }); b.label(b.pin("V1", "1"), "N0").gnd(b.pin("V1", "2"));
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 1; i <= n; i++) { const x = (i - 1) % cols, y = Math.floor((i - 1) / cols); b.part(`R${i}`, "RES", [x * 800, y * 600], 0, { value: "1k", footprint: "R_0805_2012Metric" }); b.label(b.pin(`R${i}`, "1"), `N${i - 1}`); if (i < n) b.label(b.pin(`R${i}`, "2"), `N${i}`); else b.gnd(b.pin(`R${i}`, "2")); }
  b.pr.sim.analysis = "op"; return b.pr;
}
export function placedBoard(pr: Project): Board {
  const n = pr.parts.length; const cols = Math.ceil(Math.sqrt(n)); const side = cols * 5 + 10; const { board } = sync(pr, newBoard(side, side));
  board.parts = board.parts.map((p, i) => ({ ...p, at: [mm(5 + (i % cols) * 5), mm(5 + Math.floor(i / cols) * 5)], rot: 0 })); return board;
}

/** Each connection drawn as two segments (top, bottom) joined by a via: > 4 copper objects per part. */
export function denseBoard(pr: Project): Board {
  const board = placedBoard(pr); const pads = padsOf(board, pr); const dense = structuredClone(board); const byNet = new Map<string, typeof pads>(); for (const p of pads) if (p.net) byNet.set(p.net, [...(byNet.get(p.net) ?? []), p]);
  let k = 0; for (const [net, ps] of byNet) for (let i = 1; i < ps.length; i++) { const a = ps[i - 1].at, b2 = ps[i].at, m: [number, number] = [b2[0], a[1]];
    dense.tracks.push({ id: `t${k}`, layer: "F.Cu", a, b: m, width: mm(0.25), net }, { id: `u${k}`, layer: "B.Cu", a: m, b: b2, width: mm(0.25), net }); dense.vias.push({ id: `v${k++}`, at: m, drill: mm(0.3), dia: mm(0.6), net }); }
  return dense;
}
