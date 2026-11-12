// The spatial index must not change DRC results: grid DRC and all-pairs DRC give identical findings, in order.
import { describe, expect, it } from "vitest";
import { drc } from "../src/pcb/drc";
import { autoroute } from "../src/pcb/route";
import { ledBoardPlaced } from "../src/examples/examples";
import { BoxGrid } from "../src/pcb/board";
import { ladder, denseBoard, placedBoard } from "./perf/fixtures";
const key = (f: ReturnType<typeof drc>[number]) => `${f.rule}|${f.severity}|${f.message}|${f.ids.join(",")}`;

describe("DRC spatial index", { timeout: 120000 }, () => {
  it("returns exactly the brute-force findings on the routed LED board, a placed 120-part board and a dense board", () => {
    const { b, board } = ledBoardPlaced(); const routed = autoroute(board, b.pr).board; const pr = ladder(120);
    for (const [bd, p] of [[routed, b.pr], [placedBoard(pr), pr], [denseBoard(pr), pr]] as const) {
      const fast = drc(bd, p).map(key), ref = drc(bd, p, { bruteForce: true }).map(key);
      expect(fast).toEqual(ref);
    }
    expect(drc(denseBoard(pr), pr).filter((f) => f.rule === "short").length).toBeGreaterThan(50); // the dense board really has conflicts to find
  });
  it("finds every overlapping box and returns unique ascending indices", () => {
    let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const boxes = Array.from({ length: 400 }, () => { const x = r() * 1000, y = r() * 1000, w = r() * 40, h = r() * 40; return [x, y, x + w, y + h]; });
    const g = new BoxGrid(boxes, 30);
    for (let k = 0; k < 50; k++) { const q = boxes[Math.floor(r() * boxes.length)].map((v, i) => v + (i < 2 ? -5 : 5));
      const got = g.query(q); const want = boxes.map((b, i) => [b, i] as const).filter(([b]) => b[0] <= q[2] && q[0] <= b[2] && b[1] <= q[3] && q[1] <= b[3]).map(([, i]) => i);
      for (const i of want) expect(got).toContain(i); expect([...got].sort((a, c) => a - c)).toEqual(got); expect(new Set(got).size).toBe(got.length); }
  });
});
