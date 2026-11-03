// Built-in device library (NUCLEUS original symbols). Every simulated device carries an explicit SPICE
// definition; models are either standard published parameter sets (credited in modelNote) or clearly
// labelled generic/behavioural models. Devices without `spice` are refused by the simulator.
import type { DeviceDef, Gfx, PinDef, PinType, Pt, PropDef } from "../core/types";

const L = (...pts: Pt[]): Gfx => ({ k: "line", pts });
const pin = (num: string, name: string, at: Pt, dir: PinDef["dir"], len: number, type: PinType, hideName = true): PinDef => ({ num, name, at, dir, len, type, hideName });
const V: PropDef = { key: "value", label: "Value", kind: "value", required: true };
const FP: PropDef = { key: "footprint", label: "Footprint", kind: "text" };
const MPN: PropDef[] = [{ key: "manufacturer", label: "Manufacturer", kind: "text" }, { key: "mpn", label: "Part number", kind: "text" }, { key: "description", label: "Description", kind: "text" }];
const TOL: PropDef = { key: "tolerance", label: "Tolerance", kind: "text" };
const two = (len = 100): PinDef[] => [pin("1", "1", [-200, 0], 0, len, "passive"), pin("2", "2", [200, 0], 180, len, "passive")];
const ref2 = { refAt: [0, -90] as Pt, valueAt: [0, 110] as Pt };

const diodeBody = (): Gfx[] => [L([-200, 0], [-60, 0]), { k: "poly", pts: [[-60, -60], [-60, 60], [40, 0]], fill: true }, L([40, -60], [40, 60]), L([40, 0], [200, 0])];
const arrowsOut = (): Gfx[] => [L([0, -80], [60, -150]), { k: "poly", pts: [[60, -150], [32, -138], [48, -122]], fill: true }, L([40, -60], [100, -130]), { k: "poly", pts: [[100, -130], [72, -118], [88, -102]], fill: true }];
const bjt = (pnp: boolean): Gfx[] => [
  { k: "circle", x: 40, y: 0, r: 130 }, L([-100, 0], [-20, 0]), L([-20, -80], [-20, 80]), L([-20, -40], [100, -100]), L([-20, 40], [100, 100]),
  pnp ? { k: "poly", pts: [[-14, 44], [28, 52], [12, 76]], fill: true } : { k: "poly", pts: [[100, 100], [58, 92], [74, 68]], fill: true },
];
const LED_NOTE = "Generic LED model (not a specific manufacturer's part): forward voltage set by IS/N/RS to the typical value at 20 mA. Check against your LED's datasheet.";
const led = (id: string, colour: string, vf: string, card: string): DeviceDef => ({
  id, name: `LED-${colour.toUpperCase()}`, category: "Indicator", description: `${colour[0].toUpperCase() + colour.slice(1)} LED, generic (Vf ≈ ${vf} at 20 mA)`, prefix: "D",
  symbol: { gfx: [...diodeBody(), ...arrowsOut()], pins: [pin("1", "A", [-200, 0], 0, 140, "passive"), pin("2", "K", [200, 0], 180, 160, "passive")], ...ref2 },
  spice: { kind: "element", letter: "D", order: ["1", "2"], model: { name: `LED_${colour.toUpperCase()}`, card } },
  footprints: ["LED_D5.0mm", "LED_D3.0mm", "LED_0805_2012Metric"], props: [FP, ...MPN], defaults: { footprint: "LED_D5.0mm" }, libVersion: 1, modelNote: LED_NOTE,
});

export const DEVICES: DeviceDef[] = [
  { id: "RES", name: "RES", category: "Passive", description: "Resistor", prefix: "R",
    symbol: { gfx: [L([-200, 0], [-100, 0]), { k: "rect", x: -100, y: -40, w: 200, h: 80 }, L([100, 0], [200, 0])], pins: two(), ...ref2 },
    spice: { kind: "element", letter: "R", order: ["1", "2"], value: "value" },
    footprints: ["R_0805_2012Metric", "R_0603_1608Metric", "R_Axial_DIN0207_L6.3mm_P10.16mm"], props: [V, TOL, FP, ...MPN], defaults: { value: "10k", tolerance: "1%", footprint: "R_0805_2012Metric" }, libVersion: 1 },
  { id: "CAP", name: "CAP", category: "Passive", description: "Capacitor, non-polarised", prefix: "C",
    symbol: { gfx: [L([-200, 0], [-30, 0]), L([-30, -80], [-30, 80]), L([30, -80], [30, 80]), L([30, 0], [200, 0])], pins: two(170), ...ref2 },
    spice: { kind: "element", letter: "C", order: ["1", "2"], value: "value" },
    footprints: ["C_0805_2012Metric", "C_0603_1608Metric", "C_Disc_D5.0mm_P5.00mm"], props: [V, { key: "voltage", label: "Voltage rating", kind: "text" }, FP, ...MPN], defaults: { value: "100n", voltage: "50V", footprint: "C_0805_2012Metric" }, libVersion: 1 },
  { id: "CAP-POL", name: "CAP-POL", category: "Passive", description: "Electrolytic capacitor (pin 1 = +)", prefix: "C",
    symbol: { gfx: [L([-200, 0], [-30, 0]), { k: "rect", x: -40, y: -80, w: 20, h: 160 }, { k: "arc", x: 110, y: 0, r: 90, a0: 140, a1: 220 }, L([20, 0], [200, 0]), { k: "text", x: -80, y: -60, text: "+", size: 60 }], pins: [pin("1", "+", [-200, 0], 0, 160, "passive"), pin("2", "-", [200, 0], 180, 180, "passive")], ...ref2 },
    spice: { kind: "element", letter: "C", order: ["1", "2"], value: "value" },
    footprints: ["CP_Radial_D5.0mm_P2.00mm", "CP_Radial_D8.0mm_P3.50mm"], props: [V, { key: "voltage", label: "Voltage rating", kind: "text" }, FP, ...MPN], defaults: { value: "10u", voltage: "25V", footprint: "CP_Radial_D5.0mm_P2.00mm" }, libVersion: 1 },
  { id: "IND", name: "IND", category: "Passive", description: "Inductor", prefix: "L",
    symbol: { gfx: [L([-200, 0], [-100, 0]), ...[-75, -25, 25, 75].map((x): Gfx => ({ k: "arc", x, y: 0, r: 25, a0: 180, a1: 360 })), L([100, 0], [200, 0])], pins: two(), ...ref2 },
    spice: { kind: "element", letter: "L", order: ["1", "2"], value: "value" },
    footprints: ["L_0805_2012Metric", "L_Axial_L5.3mm_D2.2mm_P10.16mm"], props: [V, FP, ...MPN], defaults: { value: "10u", footprint: "L_0805_2012Metric" }, libVersion: 1 },
  { id: "1N4148", name: "1N4148", category: "Semiconductor", description: "Small-signal switching diode", prefix: "D", manufacturer: "Generic", mpn: "1N4148",
    symbol: { gfx: diodeBody(), pins: [pin("1", "A", [-200, 0], 0, 140, "passive"), pin("2", "K", [200, 0], 180, 160, "passive")], ...ref2 },
    spice: { kind: "element", letter: "D", order: ["1", "2"], model: { name: "D1N4148", card: "D(IS=4.352n N=1.906 BV=110 IBV=0.0001 RS=0.6458 CJO=7.048p VJ=0.869 M=0.03 FC=0.5 TT=3.48n)" } },
    footprints: ["D_DO-35_SOD27_P7.62mm_Horizontal", "D_SOD-123"], props: [FP, ...MPN], defaults: { footprint: "D_DO-35_SOD27_P7.62mm_Horizontal" }, libVersion: 1, modelNote: "Widely published 1N4148 parameter set." },
  { id: "1N4733A", name: "1N4733A", category: "Semiconductor", description: "Zener diode 5.1 V (generic model)", prefix: "D", mpn: "1N4733A",
    symbol: { gfx: [L([-200, 0], [-60, 0]), { k: "poly", pts: [[-60, -60], [-60, 60], [40, 0]], fill: true }, L([20, -80], [40, -60], [40, 60], [60, 80]), L([40, 0], [200, 0])], pins: [pin("1", "A", [-200, 0], 0, 140, "passive"), pin("2", "K", [200, 0], 180, 160, "passive")], ...ref2 },
    spice: { kind: "element", letter: "D", order: ["1", "2"], model: { name: "DZ5V1", card: "D(IS=1n RS=2 BV=5.1 IBV=49m CJO=100p)" } },
    footprints: ["D_DO-41_SOD81_P10.16mm_Horizontal"], props: [FP, ...MPN], defaults: { footprint: "D_DO-41_SOD81_P10.16mm_Horizontal" }, libVersion: 1, modelNote: "Generic zener model: breakdown 5.1 V at 49 mA." },
  led("LED-RED", "red", "1.75 V", "D(IS=1e-20 N=1.6 RS=2 CJO=20p BV=5 IBV=10u)"),
  led("LED-GREEN", "green", "2.05 V", "D(IS=1e-22 N=1.7 RS=2 CJO=20p BV=5 IBV=10u)"),
  led("LED-BLUE", "blue", "3.0 V", "D(IS=1e-27 N=1.9 RS=3 CJO=20p BV=5 IBV=10u)"),
  { id: "2N3904", name: "2N3904", category: "Semiconductor", description: "NPN general-purpose transistor", prefix: "Q", mpn: "2N3904",
    symbol: { gfx: bjt(false), pins: [pin("1", "E", [100, 200], 270, 100, "passive"), pin("2", "B", [-200, 0], 0, 100, "passive"), pin("3", "C", [100, -200], 90, 100, "passive")], refAt: [190, -40], valueAt: [190, 60] },
    spice: { kind: "element", letter: "Q", order: ["3", "2", "1"], model: { name: "Q2N3904", card: "NPN(IS=6.734f XTI=3 EG=1.11 VAF=74.03 BF=416.4 NE=1.259 ISE=6.734f IKF=66.78m XTB=1.5 BR=.7371 NC=2 ISC=0 IKR=0 RC=1 CJC=3.638p MJC=.3085 VJC=.75 FC=.5 CJE=4.493p MJE=.2593 VJE=.75 TR=239.5n TF=301.2p ITF=.4 VTF=4 XTF=2 RB=10)" } },
    footprints: ["TO-92_Inline", "SOT-23"], props: [FP, ...MPN], defaults: { footprint: "TO-92_Inline" }, libVersion: 1, modelNote: "Widely published 2N3904 Gummel-Poon parameters. Pin numbers follow TO-92 (E-B-C)." },
  { id: "2N3906", name: "2N3906", category: "Semiconductor", description: "PNP general-purpose transistor", prefix: "Q", mpn: "2N3906",
    symbol: { gfx: bjt(true), pins: [pin("1", "E", [100, 200], 270, 100, "passive"), pin("2", "B", [-200, 0], 0, 100, "passive"), pin("3", "C", [100, -200], 90, 100, "passive")], refAt: [190, -40], valueAt: [190, 60] },
    spice: { kind: "element", letter: "Q", order: ["3", "2", "1"], model: { name: "Q2N3906", card: "PNP(IS=1.41f XTI=3 EG=1.11 VAF=18.7 BF=180.7 NE=1.5 ISE=0 IKF=80m XTB=1.5 BR=4.977 NC=2 ISC=0 IKR=0 RC=2.5 CJC=9.728p MJC=.5776 VJC=.75 FC=.5 CJE=8.063p MJE=.3677 VJE=.75 TR=33.42n TF=179.3p ITF=.4 VTF=4 XTF=6 RB=10)" } },
    footprints: ["TO-92_Inline", "SOT-23"], props: [FP, ...MPN], defaults: { footprint: "TO-92_Inline" }, libVersion: 1, modelNote: "Widely published 2N3906 Gummel-Poon parameters. Pin numbers follow TO-92 (E-B-C)." },
  { id: "2N7000", name: "2N7000", category: "Semiconductor", description: "N-channel MOSFET 60 V 200 mA (approximate model)", prefix: "Q", mpn: "2N7000",
    symbol: { gfx: [L([-200, 0], [-40, 0]), L([-40, -70], [-40, 70]), L([0, -90], [0, -40]), L([0, -20], [0, 20]), L([0, 40], [0, 90]), L([0, -70], [100, -70], [100, -100]), L([0, 70], [100, 70], [100, 100]), L([0, 0], [100, 0], [100, 70]), { k: "poly", pts: [[0, 0], [36, -18], [36, 18]], fill: true }], pins: [pin("1", "S", [100, 200], 270, 100, "passive"), pin("2", "G", [-200, 0], 0, 160, "passive"), pin("3", "D", [100, -200], 90, 100, "passive")], refAt: [170, -40], valueAt: [170, 60] },
    spice: { kind: "element", letter: "M", order: ["3", "2", "1", "1"], model: { name: "M2N7000", card: "NMOS(LEVEL=1 VTO=2.1 KP=0.093 RD=0.5 RS=0.5 CBD=30p CBS=30p)" } },
    footprints: ["TO-92_Inline", "SOT-23"], props: [FP, ...MPN], defaults: { footprint: "TO-92_Inline" }, libVersion: 1, modelNote: "Approximate level-1 model (threshold and transconductance only). Good for switching logic, not for precise linear work." },
  { id: "OPAMP", name: "OPAMP", category: "Analog IC", description: "Op-amp, ideal behavioural (gain 100 000, rail-to-rail output)", prefix: "U",
    symbol: { gfx: [{ k: "poly", pts: [[-200, -200], [-200, 200], [200, 0]] }, { k: "text", x: -170, y: -85, text: "−", size: 60 }, { k: "text", x: -170, y: 125, text: "+", size: 60 }], pins: [pin("2", "IN-", [-300, -100], 0, 100, "input"), pin("3", "IN+", [-300, 100], 0, 100, "input"), pin("1", "OUT", [300, 0], 180, 100, "output"), pin("8", "V+", [0, -200], 90, 100, "power_in"), pin("4", "V-", [0, 200], 270, 100, "power_in")], refAt: [60, -150], valueAt: [60, 170] },
    spice: { kind: "subckt", order: ["3", "2", "8", "4", "1"], name: "NUC_OPAMP_IDEAL", body: `.subckt NUC_OPAMP_IDEAL inp inn vp vn out
Rin inp inn 10meg
Bout o1 0 V = max(min(1e5*(V(inp)-V(inn)), V(vp)), V(vn))
Rout o1 out 75
Rsup vp vn 100k
.ends` },
    footprints: ["SOIC-8_3.9x4.9mm_P1.27mm", "DIP-8_W7.62mm"], props: [FP, ...MPN], defaults: { footprint: "SOIC-8_3.9x4.9mm_P1.27mm" }, libVersion: 1, modelNote: "Behavioural model: no bandwidth limit, no slew rate, output clamps exactly to the supply rails. Pin numbers follow the common single op-amp SO-8 pinout." },
  { id: "VSOURCE", name: "VSOURCE", category: "Source", description: "DC voltage source (simulation only)", prefix: "V",
    symbol: { gfx: [{ k: "circle", x: 0, y: 0, r: 100 }, { k: "text", x: 0, y: -25, text: "+", size: 60, anchor: "middle" }, { k: "text", x: 0, y: 65, text: "−", size: 60, anchor: "middle" }], pins: [pin("1", "+", [0, -200], 90, 100, "power_out"), pin("2", "-", [0, 200], 270, 100, "power_out")], refAt: [130, -40], valueAt: [130, 60] },
    spice: { kind: "element", letter: "V", order: ["1", "2"], value: "source" }, footprints: [],
    props: [{ ...V, label: "Voltage", unit: "V" }], defaults: { value: "5" }, libVersion: 1 },
  { id: "BATTERY", name: "BATTERY", category: "Source", description: "Battery (ideal DC source with internal resistance)", prefix: "BAT",
    symbol: { gfx: [L([0, -200], [0, -40]), L([-80, -40], [80, -40]), L([-40, -10], [40, -10]), L([-80, 20], [80, 20]), L([-40, 50], [40, 50]), L([0, 50], [0, 200]), { k: "text", x: 70, y: -60, text: "+", size: 50 }], pins: [pin("1", "+", [0, -200], 90, 160, "power_out"), pin("2", "-", [0, 200], 270, 150, "power_out")], refAt: [120, -40], valueAt: [120, 60] },
    spice: { kind: "subckt", order: ["1", "2"], name: "NUC_BATTERY", params: ["value", "rint"], body: `.subckt NUC_BATTERY p n params: value=9 rint=0.5
V1 p1 n DC {value}
R1 p1 p {rint}
.ends` },
    footprints: ["BatteryHolder_2xAA"], props: [{ ...V, label: "Voltage", unit: "V" }, { key: "rint", label: "Internal resistance", kind: "value", unit: "Ω" }, FP], defaults: { value: "9", rint: "0.5", footprint: "BatteryHolder_2xAA" }, libVersion: 1 },
  { id: "ISOURCE", name: "ISOURCE", category: "Source", description: "DC current source (simulation only); current flows out of +", prefix: "I",
    symbol: { gfx: [{ k: "circle", x: 0, y: 0, r: 100 }, L([0, 60], [0, -50]), { k: "poly", pts: [[0, -60], [-24, -20], [24, -20]], fill: true }], pins: [pin("1", "+", [0, -200], 90, 100, "power_out"), pin("2", "-", [0, 200], 270, 100, "power_out")], refAt: [130, -40], valueAt: [130, 60] },
    spice: { kind: "element", letter: "I", order: ["2", "1"], value: "source" }, footprints: [],
    props: [{ ...V, label: "Current", unit: "A" }], defaults: { value: "1m" }, libVersion: 1 },
  { id: "VSINE", name: "VSINE", category: "Source", description: "Sine generator (simulation only)", prefix: "V",
    symbol: { gfx: [{ k: "circle", x: 0, y: 0, r: 100 }, { k: "arc", x: -30, y: 0, r: 30, a0: 180, a1: 360 }, { k: "arc", x: 30, y: 0, r: 30, a0: 0, a1: 180 }], pins: [pin("1", "+", [0, -200], 90, 100, "power_out"), pin("2", "-", [0, 200], 270, 100, "power_out")], refAt: [130, -40], valueAt: [130, 60] },
    spice: { kind: "element", letter: "V", order: ["1", "2"], value: "source" }, footprints: [],
    props: [{ key: "offset", label: "Offset", kind: "value", unit: "V" }, { key: "amplitude", label: "Amplitude", kind: "value", unit: "V", required: true }, { key: "frequency", label: "Frequency", kind: "value", unit: "Hz", required: true }, { key: "phase", label: "Phase", kind: "number", unit: "°" }, { key: "ac", label: "AC magnitude (AC analysis)", kind: "value", unit: "V" }],
    defaults: { offset: "0", amplitude: "1", frequency: "1k", phase: "0", ac: "1" }, libVersion: 1 },
  { id: "VPULSE", name: "VPULSE", category: "Source", description: "Pulse / square generator (simulation only)", prefix: "V",
    symbol: { gfx: [{ k: "circle", x: 0, y: 0, r: 100 }, L([-50, 30], [-20, 30], [-20, -30], [20, -30], [20, 30], [50, 30])], pins: [pin("1", "+", [0, -200], 90, 100, "power_out"), pin("2", "-", [0, 200], 270, 100, "power_out")], refAt: [130, -40], valueAt: [130, 60] },
    spice: { kind: "element", letter: "V", order: ["1", "2"], value: "source" }, footprints: [],
    props: [{ key: "v1", label: "Low", kind: "value", unit: "V" }, { key: "v2", label: "High", kind: "value", unit: "V", required: true }, { key: "delay", label: "Delay", kind: "value", unit: "s" }, { key: "rise", label: "Rise", kind: "value", unit: "s" }, { key: "fall", label: "Fall", kind: "value", unit: "s" }, { key: "width", label: "Pulse width", kind: "value", unit: "s", required: true }, { key: "period", label: "Period", kind: "value", unit: "s", required: true }],
    defaults: { v1: "0", v2: "5", delay: "0", rise: "1u", fall: "1u", width: "0.5m", period: "1m" }, libVersion: 1 },
  { id: "SW-SPST", name: "SW-SPST", category: "Switch", description: "Toggle switch (interactive in simulation)", prefix: "SW", interactive: "switch",
    symbol: { gfx: [L([-200, 0], [-80, 0]), { k: "circle", x: -70, y: 0, r: 10 }, { k: "circle", x: 70, y: 0, r: 10 }, L([-62, -6], [70, -70]), L([80, 0], [200, 0])], pins: two(120), ...ref2 },
    spice: { kind: "switch", order: ["1", "2"] }, footprints: ["SW_SPST_Slide"], props: [FP, ...MPN], defaults: { footprint: "SW_SPST_Slide" }, libVersion: 1, modelNote: "Simulated as 10 mΩ closed / 1 GΩ open." },
  { id: "BUTTON", name: "BUTTON", category: "Switch", description: "Push button, normally open (interactive in simulation)", prefix: "SW", interactive: "switch",
    symbol: { gfx: [L([-200, 0], [-80, 0]), { k: "circle", x: -70, y: 0, r: 10 }, { k: "circle", x: 70, y: 0, r: 10 }, L([-90, -40], [90, -40]), L([0, -40], [0, -100]), L([-40, -100], [40, -100]), L([80, 0], [200, 0])], pins: two(120), ...ref2 },
    spice: { kind: "switch", order: ["1", "2"] }, footprints: ["SW_PUSH_6mm"], props: [FP, ...MPN], defaults: { footprint: "SW_PUSH_6mm" }, libVersion: 1, modelNote: "Simulated as 10 mΩ pressed / 1 GΩ released." },
  { id: "POT", name: "POT", category: "Passive", description: "Potentiometer (interactive in simulation)", prefix: "RV", interactive: "pot",
    symbol: { gfx: [L([-200, 0], [-100, 0]), { k: "rect", x: -100, y: -40, w: 200, h: 80 }, L([100, 0], [200, 0]), L([0, -200], [0, -40]), { k: "poly", pts: [[0, -42], [-20, -80], [20, -80]], fill: true }], pins: [pin("1", "1", [-200, 0], 0, 100, "passive"), pin("3", "3", [200, 0], 180, 100, "passive"), pin("2", "W", [0, -200], 90, 160, "passive")], refAt: [-150, -90], valueAt: [0, 110] },
    spice: { kind: "pot", order: ["1", "2", "3"] }, footprints: ["Potentiometer_Bourns_3296W_Vertical"], props: [V, FP, ...MPN], defaults: { value: "10k", footprint: "Potentiometer_Bourns_3296W_Vertical" }, libVersion: 1 },
  { id: "CONN-2", name: "CONN-SIL2", category: "Connector", description: "Pin header 1×2, 2.54 mm", prefix: "J",
    symbol: { gfx: [{ k: "rect", x: -100, y: -60, w: 100, h: 220 }], pins: [pin("1", "1", [-200, 0], 0, 100, "passive", false), pin("2", "2", [-200, 100], 0, 100, "passive", false)], refAt: [-50, -90], valueAt: [-50, 220] },
    spice: { kind: "ignore", reason: "Connector: joins nets only" }, footprints: ["PinHeader_1x02_P2.54mm_Vertical"], props: [FP, ...MPN], defaults: { footprint: "PinHeader_1x02_P2.54mm_Vertical" }, libVersion: 1 },
  { id: "CONN-3", name: "CONN-SIL3", category: "Connector", description: "Pin header 1×3, 2.54 mm", prefix: "J",
    symbol: { gfx: [{ k: "rect", x: -100, y: -60, w: 100, h: 320 }], pins: [pin("1", "1", [-200, 0], 0, 100, "passive", false), pin("2", "2", [-200, 100], 0, 100, "passive", false), pin("3", "3", [-200, 200], 0, 100, "passive", false)], refAt: [-50, -90], valueAt: [-50, 320] },
    spice: { kind: "ignore", reason: "Connector: joins nets only" }, footprints: ["PinHeader_1x03_P2.54mm_Vertical"], props: [FP, ...MPN], defaults: { footprint: "PinHeader_1x03_P2.54mm_Vertical" }, libVersion: 1 },
];
export const DEVICE = new Map(DEVICES.map((d) => [d.id, d]));
export const device = (id: string) => { const d = DEVICE.get(id); if (!d) throw new Error(`Unknown device ${id}`); return d; };
/** Parts that never go to the PCB (simulation primitives). */
export const simOnly = (d: DeviceDef) => d.category === "Source" && d.footprints.length === 0;
export function searchDevices(q: string, category?: string): DeviceDef[] {
  const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return DEVICES.filter((d) => (!category || d.category === category) && t.every((w) => `${d.id} ${d.name} ${d.description} ${d.category} ${d.mpn ?? ""} ${d.manufacturer ?? ""}`.toLowerCase().includes(w)));
}
