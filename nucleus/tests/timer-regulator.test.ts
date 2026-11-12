// Test B (555 oscillator) and the LM7805 regulator, simulated with ngspice. Frequencies are measured from the
// solver's waveform (rising edges through VCC/2), not computed from the formula.
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../src/examples/examples";
import { B } from "../src/examples/build";
import { buildSpice } from "../src/simulation/netlist";
import { runSpice } from "../src/simulation/engine";
import { mapResult, vDiff } from "../src/simulation/results";
import { erc } from "../src/erc/erc";
import type { Project } from "../src/core/types";

async function sim(pr: Project) { const deck = buildSpice(pr, undefined, pr.sim.analysis); expect(deck.ok, deck.ok ? "" : JSON.stringify(deck)).toBe(true); return mapResult(await runSpice(deck.text), deck, pr.sim.analysis, pr.revision); }
function edges(t: number[], v: number[], level: number) { const out: number[] = []; for (let i = 1; i < v.length; i++) if (v[i - 1] < level && v[i] >= level) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1])); return out; }
const ne555 = (c = "10n") => { const pr = EXAMPLES.find((e) => e.id === "ne555-astable")!.build(); pr.parts = pr.parts.map((p) => (p.ref === "C1" ? { ...p, props: { ...p.props, value: c } } : p)); return pr; };
async function measure(pr: Project) {
  const r = await sim(pr); const t = r.axis!.values, v = r.netV.get("OUT")!.re; const e = edges(t, v, 4.5).filter((x) => x > 0.5e-3); // skip the first (longer) cycle
  const periods = e.slice(1).map((x, i) => x - e[i]); const T = periods.reduce((a, b) => a + b, 0) / periods.length;
  const hi = Math.max(...v.filter((_, i) => t[i] > 0.5e-3)), lo = Math.min(...v.filter((_, i) => t[i] > 0.5e-3));
  const high = t.map((x, i) => [x, v[i]] as const).filter(([x]) => x > e[0] && x < e[e.length - 1]); const duty = high.filter(([, y]) => y > 4.5).length / high.length;
  return { f: 1 / T, n: periods.length, hi, lo, duty, timMax: Math.max(...r.netV.get("TIM")!.re.filter((_, i) => t[i] > 0.5e-3)), timMin: Math.min(...r.netV.get("TIM")!.re.filter((_, i) => t[i] > 0.5e-3)) };
}

describe("Test B: NE555 astable (ngspice)", { timeout: 120000 }, () => {
  it("oscillates at 1.44/((RA+2RB)C) within 3 %, with the textbook levels", async () => {
    const pr = ne555(); expect(erc(pr).filter((f) => f.severity === "error")).toEqual([]);
    const m = await measure(pr); const f0 = 1.44 / ((1e3 + 2 * 10e3) * 10e-9);
    expect(m.n).toBeGreaterThanOrEqual(10); expect(m.f / f0).toBeGreaterThan(0.97); expect(m.f / f0).toBeLessThan(1.03);
    expect(m.hi).toBeCloseTo((9 - 1.7) * 1000 / 1010, 2); // VCC − 1.7 V through the 10 Ω output into the 1 kΩ load expect(m.lo).toBeLessThan(0.2);
    expect(m.timMax).toBeCloseTo(6, 1); expect(m.timMin).toBeCloseTo(3, 1); // the capacitor swings between 1/3 and 2/3 of VCC
    expect(m.duty).toBeCloseTo((1e3 + 10e3) / (1e3 + 2 * 10e3), 1); // high for (RA+RB)/(RA+2RB) ≈ 52 %
  });
  it("doubling C halves the frequency", async () => {
    const a = await measure(ne555("10n")), b = await measure(ne555("20n")); expect(a.f / b.f).toBeCloseTo(2, 1);
  });
});

describe("LM7805 regulator (ngspice)", { timeout: 60000 }, () => {
  const reg = (vin: string) => { const b = new B("7805").part("V1", "VSOURCE", [-1200, 0], 0, { value: vin }).part("U1", "LM7805", [0, 0]).part("RL", "RES", [1000, 400], 270, { value: "100" });
    b.label(b.pin("V1", "1"), "VIN").label(b.pin("U1", "1"), "VIN").label(b.pin("U1", "3"), "VOUT").label(b.pin("RL", "1"), "VOUT").gnd(b.pin("V1", "2")).gnd(b.pin("U1", "2")).gnd(b.pin("RL", "2")); b.pr.sim.analysis = "op"; return b.pr; };
  it("holds 5 V into 100 Ω from 12 V, and drops out 2 V below a 6 V input", async () => {
    const r = await sim(reg("12")); expect(vDiff(r, "VOUT")).toBeCloseTo(5, 2); expect(-r.branchI.get("v1")![0]).toBeCloseTo(0.05 + 0.005, 3); // 50 mA load + 5 mA quiescent
    expect(vDiff(await sim(reg("6")), "VOUT")).toBeCloseTo(4, 2);
  });
});
