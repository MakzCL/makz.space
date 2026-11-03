// Every built-in example must be ERC-clean and simulate to its hand-calculated result.
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/examples/examples";
import { buildSpice } from "../src/simulation/netlist";
import { runSpice } from "../src/simulation/engine";
import { mapResult, vDiff, type SimResult } from "../src/simulation/results";
import { erc } from "../src/erc/erc";
import { validate } from "../src/storage/file";

const ex = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
async function run(id: string): Promise<SimResult> {
  const pr = ex(id); const deck = buildSpice(pr, undefined, pr.sim.analysis);
  expect(deck.ok).toBe(true);
  return mapResult(await runSpice(deck.text), deck, pr.sim.analysis, pr.revision);
}
describe("built-in examples", { timeout: 60000 }, () => {
  it("are valid projects with no ERC errors", () => {
    for (const e of EXAMPLES) { const pr = e.build(); expect(() => validate(pr)).not.toThrow(); expect(erc(pr).filter((f) => f.severity === "error"), e.id).toEqual([]); }
  });
  it("divider: OUT = 2.5 V", async () => { expect(vDiff(await run("divider"), "OUT")).toBeCloseTo(2.5, 9); });
  it("LED: about 10 mA, anode 1.6–1.9 V", async () => { const r = await run("led"); const i = -r.branchI.get("v1")![0]; expect(i).toBeGreaterThan(0.0095); expect(i).toBeLessThan(0.0102); const v = vDiff(r, "ANODE"); expect(v).toBeGreaterThan(1.6); expect(v).toBeLessThan(1.9); expect((5 - v) / 330).toBeCloseTo(i, 6); });
  it("RC step: 63.2 % at τ", async () => {
    const r = await run("rc-step"); const t = r.axis!.values, v = r.netV.get("OUT")!.re;
    const i = t.findIndex((x) => x >= 1e-3); const k = (1e-3 - t[i - 1]) / (t[i] - t[i - 1]); expect((v[i - 1] + k * (v[i] - v[i - 1])) / 5).toBeCloseTo(1 - Math.exp(-1), 2);
  });
  it("RC AC: −3 dB at 1/(2πRC)", async () => {
    const r = await run("rc-ac"); const f = r.axis!.values, o = r.netV.get("OUT")!; const fc = 1 / (2 * Math.PI * 1e3 * 100e-9);
    const i = f.findIndex((x) => x >= fc); expect(20 * Math.log10(Math.hypot(o.re[i], o.im![i]))).toBeCloseTo(-3.01, 0);
  });
  it("LED board: about 10 mA through the LED with SW1 pressed", async () => { const r = await run("led-pcb"); const i = -r.branchI.get("v1")![0]; expect(i).toBeGreaterThan(0.0095); expect(i).toBeLessThan(0.0102); });
  it("pot: WIPER = 7.5 V at 25 %", async () => { expect(vDiff(await run("pot"), "WIPER")).toBeCloseTo(7.5, 1); });
});
