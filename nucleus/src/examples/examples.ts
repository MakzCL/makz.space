// Built-in example circuits. Each one is checked by tests/examples.test.ts against a hand calculation,
// so opening an example shows a circuit that is known to simulate correctly.
import type { Project } from "../core/types";
import { B, chain } from "./build";
import { newBoard, sync } from "../pcb/board";
import { mm } from "../pcb/footprints";

/** LED board: J1 power in, R1 + D1 LED, SW1 push button to ground, C1 decoupling (V1 powers it in simulation only). */
export function ledBoardSchematic(name = "LED board") {
  const b = new B(name)
    .part("J1", "CONN-2", [0, 0]).part("R1", "RES", [1000, 0], 0, { value: "330", footprint: "R_0805_2012Metric" })
    .part("D1", "LED-RED", [2000, 0]).part("SW1", "BUTTON", [3000, 0]).part("C1", "CAP", [4000, 0], 0, { value: "100n" });
  b.label(b.pin("J1", "1"), "VCC").label(b.pin("R1", "1"), "VCC").label(b.pin("C1", "1"), "VCC")
    .label(b.pin("R1", "2"), "LED_A").label(b.pin("D1", "1"), "LED_A").label(b.pin("D1", "2"), "SW").label(b.pin("SW1", "1"), "SW")
    .gnd(b.pin("J1", "2")).gnd(b.pin("SW1", "2")).gnd(b.pin("C1", "2"));
  return b;
}
/** The same with its 40 × 30 mm board, parts placed and not yet routed. */
export function ledBoardPlaced(name = "LED board") {
  const b = ledBoardSchematic(name);
  const { board } = sync(b.pr, newBoard(40, 30));
  const at: Record<string, [number, number, 0 | 90 | 180 | 270]> = { J1: [5, 8, 90], R1: [16, 8, 0], D1: [26, 7, 0], SW1: [25, 17, 0], C1: [10, 20, 0] };
  board.parts = board.parts.map((p) => ({ ...p, at: [mm(at[p.ref][0]), mm(at[p.ref][1])], rot: at[p.ref][2] }));
  return { b, board };
}

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
  { id: "led-pcb", title: "LED board: schematic to PCB", summary: "LED, button and decoupling on a 40 × 30 mm board, parts placed. Open the PCB tab: Autoroute, DRC, then Gerber.", expect: "LED ≈ 10 mA when SW1 is pressed",
    build: () => { const { b, board } = ledBoardPlaced(); b.part("V1", "VSOURCE", [-1200, 200], 0, { value: "5" }).label(b.pin("V1", "1"), "VCC").gnd(b.pin("V1", "2")); b.state("SW1", { closed: true }); b.pr.pcb = board; b.pr.sim.analysis = "op"; return b.pr; } },
  { id: "ne555-astable", title: "555 timer oscillator (astable)", summary: "NE555 with RA 1 kΩ, RB 10 kΩ, C 10 nF from 9 V. Transient, 3 ms.", expect: "OUT ≈ 6.9 kHz square wave (1.44 / ((RA + 2RB)·C)), high ≈ 7.3 V",
    build: () => { const b = new B("555 astable").part("V1", "VSOURCE", [-1600, 0], 0, { value: "9" }).part("U1", "NE555", [0, 0])
      .part("RA", "RES", [-1000, -900], 270, { value: "1k" }).part("RB", "RES", [-1000, 100], 270, { value: "10k" }).part("C1", "CAP", [-1000, 1100], 270, { value: "10n" })
      .part("C2", "CAP", [600, 1100], 270, { value: "10n" }).part("RL", "RES", [1300, 600], 270, { value: "1k" });
      b.label(b.pin("V1", "1"), "VCC").label(b.pin("U1", "8"), "VCC").label(b.pin("U1", "4"), "VCC").label(b.pin("RA", "1"), "VCC")
        .label(b.pin("RA", "2"), "DIS").label(b.pin("U1", "7"), "DIS").label(b.pin("RB", "1"), "DIS")
        .label(b.pin("RB", "2"), "TIM").label(b.pin("U1", "2"), "TIM").label(b.pin("U1", "6"), "TIM").label(b.pin("C1", "1"), "TIM")
        .label(b.pin("U1", "5"), "CV").label(b.pin("C2", "1"), "CV").label(b.pin("U1", "3"), "OUT").label(b.pin("RL", "1"), "OUT")
        .gnd(b.pin("V1", "2")).gnd(b.pin("U1", "1")).gnd(b.pin("C1", "2")).gnd(b.pin("C2", "2")).gnd(b.pin("RL", "2"));
      b.pr.sim.analysis = "tran"; b.pr.sim.tran = { stop: "3m", step: "1u", start: "0", uic: false }; return b.pr; } },
  { id: "pot", title: "Potentiometer (interactive)", summary: "10 V across a 10 kΩ potentiometer; drag the wiper with interactive simulation on.", expect: "WIPER = 7.5 V at 25 %",
    build: () => { const b = new B("Potentiometer").part("V1", "VSOURCE", [0, 0], 0, { value: "10" }).part("RV1", "POT", [600, -400], 270, { value: "10k" }).part("R1", "RES", [1400, 0], 270, { value: "1meg" });
      b.connect("V1", "1", "RV1", "1", true).connect("RV1", "3", "V1", "2", true).connect("RV1", "2", "R1", "1").gnd(b.pin("V1", "2")).gnd(b.pin("R1", "2"));
      b.state("RV1", { position: 0.25 }).label(b.pin("R1", "1"), "WIPER"); b.pr.sim.analysis = "op"; return b.pr; } },
];
