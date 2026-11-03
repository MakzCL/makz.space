// Built-in example circuits. Each one is checked by tests/examples.test.ts against a hand calculation,
// so opening an example shows a circuit that is known to simulate correctly.
import type { Project } from "../core/types";
import { B, chain } from "./build";

export interface Example { id: string; title: string; summary: string; expect: string; build: () => Project }

export const EXAMPLES: Example[] = [
  { id: "divider", title: "Voltage divider", summary: "5 V across 10 kΩ + 10 kΩ. DC operating point.", expect: "OUT = 2.500 V",
    build: () => { const b = chain(["VSOURCE", { value: "5" }], ["RES", { value: "10k" }], ["RES", { value: "10k" }], "Voltage divider"); b.label(b.pin("B", "1"), "OUT"); b.pr.sim.analysis = "op"; return b.pr; } },
  { id: "led", title: "LED with series resistor", summary: "5 V, 330 Ω and a red LED (generic model). DC operating point.", expect: "about 10 mA; LED ≈ 1.6–1.9 V",
    build: () => { const b = chain(["VSOURCE", { value: "5" }], ["RES", { value: "330" }], ["LED-RED", {}], "LED with series resistor"); b.label(b.pin("B", "1"), "ANODE"); b.pr.sim.analysis = "op"; return b.pr; } },
  { id: "rc-step", title: "RC charging (step response)", summary: "0→5 V step into 1 kΩ / 1 µF (τ = 1 ms). Transient, 5 ms.", expect: "OUT = 63.2 % of 5 V at 1 ms",
    build: () => { const b = chain(["VPULSE", { v1: "0", v2: "5", delay: "0", rise: "1n", fall: "1n", width: "1", period: "2" }], ["RES", { value: "1k" }], ["CAP", { value: "1u" }], "RC charging");
      b.label(b.pin("B", "1"), "OUT"); b.pr.sim.analysis = "tran"; b.pr.sim.tran = { stop: "5m", step: "5u", start: "0", uic: true }; return b.pr; } },
  { id: "rc-ac", title: "RC low-pass (frequency response)", summary: "1 kΩ / 100 nF low-pass. AC sweep 10 Hz – 100 kHz.", expect: "−3 dB at 1.59 kHz",
    build: () => { const b = chain(["VSINE", { amplitude: "1", frequency: "1k", ac: "1" }], ["RES", { value: "1k" }], ["CAP", { value: "100n" }], "RC low-pass");
      b.label(b.pin("B", "1"), "OUT"); b.pr.sim.analysis = "ac"; b.pr.sim.ac = { type: "dec", points: 50, fstart: "10", fstop: "100k" }; return b.pr; } },
  { id: "pot", title: "Potentiometer (interactive)", summary: "10 V across a 10 kΩ potentiometer; drag the wiper with interactive simulation on.", expect: "WIPER = 7.5 V at 25 %",
    build: () => { const b = new B("Potentiometer").part("V1", "VSOURCE", [0, 0], 0, { value: "10" }).part("RV1", "POT", [600, -400], 270, { value: "10k" }).part("R1", "RES", [1400, 0], 270, { value: "1meg" });
      b.connect("V1", "1", "RV1", "1", true).connect("RV1", "3", "V1", "2", true).connect("RV1", "2", "R1", "1").gnd(b.pin("V1", "2")).gnd(b.pin("R1", "2"));
      b.state("RV1", { position: 0.25 }).label(b.pin("R1", "1"), "WIPER"); b.pr.sim.analysis = "op"; return b.pr; } },
];
