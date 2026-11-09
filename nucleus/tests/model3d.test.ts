import { describe, expect, it } from "vitest";
import { model3d, THICK } from "../src/pcb/model3d";
import { boardOf } from "../src/pcb/board";
import { EXAMPLES } from "../src/examples/examples";

describe("3D board model", () => {
  const ex = EXAMPLES.find((e) => e.id === "led-pcb")!; const pr = ex.build(); const b = boardOf(pr)!;
  const m = model3d(b, pr);
  it("has the board outline and size in millimetres", () => { expect(m.outline.length).toBeGreaterThanOrEqual(4); expect(m.size[0]).toBeGreaterThan(5); expect(m.size[0]).toBeLessThan(200); expect(THICK).toBe(1.6); });
  it("has one body per part, sitting on the board", () => {
    expect(m.bodies.map((x) => x.ref).sort()).toEqual(b.parts.map((p) => p.ref).sort());
    for (const x of m.bodies) { expect(x.size.every((v) => v > 0 && v < 80)).toBe(true); expect(Number.isFinite(x.at[0]) && Number.isFinite(x.at[1])).toBe(true); }
  });
  it("puts a plated hole at every through-hole pad and via", () => {
    const tht = m.copper.filter((c) => c.kind === "pad" && c.side === "both").length; const vias = b.vias.length;
    expect(m.holes.length).toBe(tht + vias); expect(m.holes.every((h) => h.d > 0.2 && h.d < 3)).toBe(true);
  });
  it("carries every track with its width", () => { expect(m.copper.filter((c) => c.kind === "track").length).toBe(b.tracks.length); });
  it("mirrors rotation for bottom-side parts", () => {
    const p = { ...b.parts[0], side: "bottom" as const, rot: 90 as const }; const m2 = model3d({ ...b, parts: [p] }, pr);
    expect(m2.bodies[0].side).toBe("bottom"); expect(m2.bodies[0].rotDeg).toBe(-90);
  });
});
