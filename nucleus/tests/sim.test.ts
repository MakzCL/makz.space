// Simulation tests: analytic expectations, plus cross-checks against native ngspice when installed.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildSpice } from "../src/simulation/netlist";
import { runSpice } from "../src/simulation/engine";
import { mapResult, vDiff } from "../src/simulation/results";
import { B, chain, divider } from "./helpers";
import { connectivity } from "../src/connectivity/connectivity";
import type { Project } from "../src/core/types";

async function sim(pr: Project, analysis: Project["sim"]["analysis"] = pr.sim.analysis) {
  const deck = buildSpice(pr, undefined, analysis); expect(deck.diags.filter((d) => d.level === "error")).toEqual([]);
  return { r: mapResult(await runSpice(deck.text), deck, analysis, pr.revision), deck };
}
/** the net between the two chained parts */
const mid = (b: B) => connectivity(b.pr).pinNet.get(`${b.ids.B}:1`)!;
const native = (() => { try { execFileSync("ngspice", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();
function nativeOp(deck: string, net: string): number {
  const f = "/tmp/nucleus-xcheck.cir";
  writeFileSync(f, deck.replace(".op", `.op\n.control\nop\nprint v(${net})\n.endc`));
  const out = execFileSync("ngspice", ["-b", f], { encoding: "utf8" });
  return Number(/=\s*([-+0-9.eE]+)/.exec(out.split("\n").find((l) => l.toLowerCase().startsWith(`v(${net})`))!)![1]);
}

describe("SPICE", { timeout: 60000 }, () => {
  it("10k/10k divider across 5 V gives 2.5 V (and native ngspice agrees)", async () => {
    const { r, deck } = await sim(divider().pr, "op");
    expect(vDiff(r, "N$2")).toBeCloseTo(2.5, 9);
    expect(vDiff(r, "N$1")).toBeCloseTo(5, 9);
    expect(deck.text).toMatch(/^R1 n_n_24_1 n_n_24_2 10k$/m);
    if (native) expect(nativeOp(deck.text, "n_n_24_2")).toBeCloseTo(2.5, 6);
  });
  it("RC charging reaches 63.2 % at t = RC (1 kΩ, 1 µF → 1 ms)", async () => {
    const b = chain(["VPULSE", { v1: "0", v2: "5", delay: "0", rise: "1n", fall: "1n", width: "1", period: "2" }], ["RES", { value: "1k" }], ["CAP", { value: "1u" }]);
    b.pr.sim.tran = { stop: "5m", step: "1u", start: "0", uic: true };
    const { r } = await sim(b.pr, "tran");
    const t = r.axis!.values, v = r.netV.get(mid(b))!.re;
    const at = (x: number) => { const i = t.findIndex((tt) => tt >= x); const k = (x - t[i - 1]) / (t[i] - t[i - 1]); return v[i - 1] + k * (v[i] - v[i - 1]); };
    expect(at(1e-3) / 5).toBeCloseTo(1 - Math.exp(-1), 2);
    expect(at(5e-3) / 5).toBeCloseTo(1 - Math.exp(-5), 2);
  });
  it("RC low-pass is −3 dB at fc = 1/(2πRC)", async () => {
    const b = chain(["VSINE", { amplitude: "1", frequency: "1k", ac: "1" }], ["RES", { value: "1k" }], ["CAP", { value: "100n" }]);
    b.pr.sim.ac = { type: "dec", points: 200, fstart: "10", fstop: "100k" };
    const { r } = await sim(b.pr, "ac");
    const f = r.axis!.values, out = r.netV.get(mid(b))!; const fc = 1 / (2 * Math.PI * 1e3 * 100e-9);
    const i = f.findIndex((x) => x >= fc); const mag = Math.hypot(out.re[i], out.im![i]);
    expect(20 * Math.log10(mag)).toBeCloseTo(-3.01, 0);
  });
  it("LED with 330 Ω from 5 V draws about 10 mA (generic red model); ERC-clean circuit", async () => {
    const b = chain(["VSOURCE", { value: "5" }], ["RES", { value: "330" }], ["LED-RED", {}]);
    const { r } = await sim(b.pr, "op");
    const i = -(r.branchI.get("v1")![0]);
    expect(i).toBeGreaterThan(0.0095); expect(i).toBeLessThan(0.0102);
    expect(vDiff(r, mid(b))).toBeGreaterThan(1.6); expect(vDiff(r, mid(b))).toBeLessThan(1.9);
  });
  it("refuses instead of guessing: no ground, bad value", async () => {
    const b = new B().part("V1", "VSOURCE", [0, 0]).part("R1", "RES", [600, 0], 90, { value: "abc" }); b.connect("V1", "1", "R1", "1");
    const d = buildSpice(b.pr, undefined, "op");
    expect(d.ok).toBe(false);
    expect(d.diags.map((x) => x.message).join("\n")).toMatch(/No ground/);
    expect(d.diags.map((x) => x.message).join("\n")).toMatch(/R1: value “abc” is not a number/);
  });
  it("interactive switch and potentiometer change the solution", async () => {
    // V1 10 V across the potentiometer ends; 1 MΩ load on the wiper
    const b = new B().part("V1", "VSOURCE", [0, 0], 0, { value: "10" }).part("RV1", "POT", [600, -400], 270, { value: "10k" }).part("R1", "RES", [1400, 0], 270, { value: "1meg" });
    b.connect("V1", "1", "RV1", "1", true).connect("RV1", "3", "V1", "2", true).connect("RV1", "2", "R1", "1").gnd(b.pin("V1", "2")).gnd(b.pin("R1", "2"));
    b.pr.parts = b.pr.parts.map((p) => (p.id === b.ids.RV1 ? { ...p, state: { position: 0.25 } } : p));
    const wiperNet = connectivity(b.pr).pinNet.get(`${b.ids.RV1}:2`)!;
    const { r } = await sim(b.pr, "op");
    expect(vDiff(r, wiperNet)).toBeCloseTo(7.5, 1); // 25 % of the track from pin 1 (10 V) towards pin 3 (0 V)
    // the switch: open → no current; closed → I = V/R
    const s = new B().part("V1", "VSOURCE", [0, 0], 0, { value: "5" }).part("SW1", "SW-SPST", [600, -400], 270).part("R1", "RES", [600, 400], 270, { value: "1k" });
    s.connect("V1", "1", "SW1", "1", true).connect("SW1", "2", "R1", "1").connect("R1", "2", "V1", "2").gnd(s.pin("V1", "2"));
    const open = (await sim(s.pr, "op")).r; expect(Math.abs(open.branchI.get("v1")![0])).toBeLessThan(1e-8);
    s.pr.parts = s.pr.parts.map((p) => (p.id === s.ids.SW1 ? { ...p, state: { closed: true } } : p));
    const closed = (await sim(s.pr, "op")).r; expect(-closed.branchI.get("v1")![0]).toBeCloseTo(5e-3, 5);
  });
});
