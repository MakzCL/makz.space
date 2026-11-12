// Footprints generated from package dimensions (IPC-7351 nominal density for SMD; common THT drill/pad sizes).
// All geometry is in integer nanometres, relative to the footprint origin, +y down (as on screen).
// Pad names match the schematic pin numbers of the devices that use the footprint.

export type Nm = number;
export const MM = 1_000_000;
export const mm = (v: number): Nm => Math.round(v * MM);

export type PadShape = "rect" | "circle" | "oval";
export interface PadDef {
  name: string; at: [Nm, Nm]; shape: PadShape; size: [Nm, Nm];
  /** drill diameter for through-hole pads; absent for SMD */
  drill?: Nm;
}
export interface FootprintDef {
  name: string; description: string; pads: PadDef[];
  /** silkscreen outline segments [x1,y1,x2,y2] */
  silk: [Nm, Nm, Nm, Nm][];
  /** courtyard rectangle (keep-out between parts) */
  courtyard: [Nm, Nm, Nm, Nm];
  smd: boolean;
}

const rectSilk = (w: number, h: number): [Nm, Nm, Nm, Nm][] => { const x = mm(w / 2), y = mm(h / 2); return [[-x, -y, x, -y], [x, -y, x, y], [x, y, -x, y], [-x, y, -x, -y]]; };
const court = (pads: PadDef[], silk: [Nm, Nm, Nm, Nm][], margin = 0.25): [Nm, Nm, Nm, Nm] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pads) { x0 = Math.min(x0, p.at[0] - p.size[0] / 2); x1 = Math.max(x1, p.at[0] + p.size[0] / 2); y0 = Math.min(y0, p.at[1] - p.size[1] / 2); y1 = Math.max(y1, p.at[1] + p.size[1] / 2); }
  for (const s of silk) { x0 = Math.min(x0, s[0], s[2]); x1 = Math.max(x1, s[0], s[2]); y0 = Math.min(y0, s[1], s[3]); y1 = Math.max(y1, s[1], s[3]); }
  const m = mm(margin); return [x0 - m, y0 - m, x1 + m, y1 + m];
};
const fp = (name: string, description: string, pads: PadDef[], silk: [Nm, Nm, Nm, Nm][]): FootprintDef => ({ name, description, pads, silk, courtyard: court(pads, silk), smd: pads.every((p) => !p.drill) });

/** Two-terminal chip (resistor/capacitor/inductor/LED): pad size and centre-to-centre distance from IPC-7351 nominal. */
function chip(name: string, desc: string, padW: number, padH: number, pitch: number, bodyL: number, bodyW: number): FootprintDef {
  const pads: PadDef[] = [{ name: "1", at: [mm(-pitch / 2), 0], shape: "rect", size: [mm(padW), mm(padH)] }, { name: "2", at: [mm(pitch / 2), 0], shape: "rect", size: [mm(padW), mm(padH)] }];
  const y = mm(bodyW / 2 + 0.2), x = mm(bodyL / 2 - 0.1);
  return fp(name, desc, pads, [[-x, -y, x, -y], [-x, y, x, y]]);
}
/** Two-lead through-hole part with pitch p (axial or radial). */
function tht2(name: string, desc: string, pitch: number, drill: number, pad: number, body: [number, number], square: "" | "1" | "2" | boolean = ""): FootprintDef {
  const sq = square === true ? "1" : square;
  const pads: PadDef[] = [{ name: "1", at: [0, 0], shape: sq === "1" ? "rect" : "circle", size: [mm(pad), mm(pad)], drill: mm(drill) }, { name: "2", at: [mm(pitch), 0], shape: sq === "2" ? "rect" : "circle", size: [mm(pad), mm(pad)], drill: mm(drill) }];
  const cx = mm(pitch / 2), w = mm(body[0] / 2), h = mm(body[1] / 2);
  return fp(name, desc, pads, [[cx - w, -h, cx + w, -h], [cx + w, -h, cx + w, h], [cx + w, h, cx - w, h], [cx - w, h, cx - w, -h]]);
}
function inline(name: string, desc: string, n: number, pitch: number, drill: number, padW: number, padH: number, pin1Square: boolean, body: [number, number], names?: string[]): FootprintDef {
  const pads: PadDef[] = Array.from({ length: n }, (_, i) => ({ name: names?.[i] ?? String(i + 1), at: [mm(i * pitch), 0] as [Nm, Nm], shape: (i === 0 && pin1Square ? "rect" : padW === padH ? "circle" : "oval") as PadShape, size: [mm(padW), mm(padH)] as [Nm, Nm], drill: mm(drill) }));
  const cx = mm(((n - 1) * pitch) / 2), w = mm(body[0] / 2), h = mm(body[1] / 2);
  return fp(name, desc, pads, [[cx - w, -h, cx + w, -h], [cx + w, -h, cx + w, h], [cx + w, h, cx - w, h], [cx - w, h, cx - w, -h]]);
}
/** Dual row: SOIC (SMD) or DIP (THT). Pin 1 top-left, numbering counter-clockwise. */
function dual(name: string, desc: string, n: number, pitch: number, rowSpan: number, pad: [number, number], drill: number | null, body: [number, number]): FootprintDef {
  const half = n / 2, pads: PadDef[] = [];
  for (let i = 0; i < n; i++) {
    const left = i < half, k = left ? i : n - 1 - i;
    pads.push({ name: String(i + 1), at: [mm(left ? -rowSpan / 2 : rowSpan / 2), mm((k - (half - 1) / 2) * pitch)], shape: drill ? (i === 0 ? "rect" : "circle") : "rect", size: [mm(pad[0]), mm(pad[1])], ...(drill ? { drill: mm(drill) } : {}) });
  }
  const s = rectSilk(body[0], body[1]); const notch: [Nm, Nm, Nm, Nm] = [mm(-0.6), mm(-body[1] / 2), mm(0.6), mm(-body[1] / 2 + 0.6)];
  return fp(name, desc, pads, [...s, notch]);
}

const LIST: FootprintDef[] = [
  chip("R_0805_2012Metric", "Resistor 0805 (2012 metric)", 1.025, 1.4, 1.825, 2.0, 1.25),
  chip("R_0603_1608Metric", "Resistor 0603 (1608 metric)", 0.8, 0.95, 1.55, 1.6, 0.8),
  chip("C_0805_2012Metric", "Capacitor 0805 (2012 metric)", 1.0, 1.45, 1.9, 2.0, 1.25),
  chip("C_0603_1608Metric", "Capacitor 0603 (1608 metric)", 0.8, 0.95, 1.55, 1.6, 0.8),
  chip("L_0805_2012Metric", "Inductor 0805 (2012 metric)", 1.05, 1.2, 2.0, 2.0, 1.25),
  chip("LED_0805_2012Metric", "LED 0805 (2012 metric); pad 1 anode, pad 2 cathode", 1.025, 1.4, 1.825, 2.0, 1.25),
  chip("D_SOD-123", "Diode SOD-123; pad 1 anode, pad 2 cathode", 0.91, 1.22, 3.3, 2.7, 1.6),
  tht2("R_Axial_DIN0207_L6.3mm_P10.16mm", "Resistor axial DIN0207, 10.16 mm pitch", 10.16, 0.8, 1.6, [6.3, 2.5]),
  tht2("L_Axial_L5.3mm_D2.2mm_P10.16mm", "Inductor axial, 10.16 mm pitch", 10.16, 0.8, 1.6, [5.3, 2.2]),
  tht2("C_Disc_D5.0mm_P5.00mm", "Ceramic disc capacitor, 5.00 mm pitch", 5.0, 0.8, 1.6, [7.0, 2.5]),
  tht2("CP_Radial_D5.0mm_P2.00mm", "Electrolytic capacitor D5 mm, 2.00 mm pitch; pad 1 positive", 2.0, 0.8, 1.6, [5.0, 5.0], true),
  tht2("CP_Radial_D8.0mm_P3.50mm", "Electrolytic capacitor D8 mm, 3.50 mm pitch; pad 1 positive", 3.5, 1.0, 2.0, [8.0, 8.0], true),
  tht2("LED_D5.0mm", "LED 5 mm, 2.54 mm pitch; pad 1 anode, square pad 2 cathode", 2.54, 0.9, 1.8, [5.8, 5.8], "2"),
  tht2("LED_D3.0mm", "LED 3 mm, 2.54 mm pitch; pad 1 anode, square pad 2 cathode", 2.54, 0.9, 1.8, [3.8, 3.8], "2"),
  tht2("D_DO-35_SOD27_P7.62mm_Horizontal", "Diode DO-35, 7.62 mm pitch; pad 1 anode, square pad 2 cathode", 7.62, 0.8, 1.6, [4.0, 2.0], "2"),
  tht2("D_DO-41_SOD81_P10.16mm_Horizontal", "Diode DO-41, 10.16 mm pitch; pad 1 anode, square pad 2 cathode", 10.16, 1.1, 2.2, [5.2, 2.7], "2"),
  inline("TO-220-3_Vertical", "TO-220, three leads in line, 2.54 mm pitch, vertical", 3, 2.54, 1.0, 1.8, 1.8, true, [10.0, 4.6]),
  inline("TO-92_Inline", "TO-92, three leads in line, 1.27 mm pitch", 3, 1.27, 0.75, 1.05, 1.5, true, [4.8, 3.6]),
  inline("PinHeader_1x02_P2.54mm_Vertical", "Pin header 1×2, 2.54 mm", 2, 2.54, 1.0, 1.7, 1.7, true, [5.08, 2.54]),
  inline("PinHeader_1x03_P2.54mm_Vertical", "Pin header 1×3, 2.54 mm", 3, 2.54, 1.0, 1.7, 1.7, true, [7.62, 2.54]),
  inline("Potentiometer_Bourns_3296W_Vertical", "Trimmer 3296W, three pins 2.54 mm (1, wiper, 3)", 3, 2.54, 1.0, 1.6, 1.6, false, [9.5, 4.8], ["1", "2", "3"]),
  inline("SW_SPST_Slide", "Slide switch, two pins 2.54 mm", 2, 2.54, 1.0, 1.7, 1.7, false, [8.0, 3.5]),
  inline("BatteryHolder_2xAA", "Battery leads (wire pads), 5.08 mm", 2, 5.08, 1.2, 2.5, 2.5, true, [8.0, 3.5]),
  dual("SOIC-8_3.9x4.9mm_P1.27mm", "SOIC-8, 3.9 × 4.9 mm body, 1.27 mm pitch", 8, 1.27, 4.95, [1.95, 0.6], null, [3.9, 4.9]),
  dual("DIP-8_W7.62mm", "DIP-8, 7.62 mm row spacing", 8, 2.54, 7.62, [1.6, 1.6], 0.8, [6.4, 9.8]),
];
// SOT-23: pins 1 and 2 on one side, 3 on the other (IPC-7351 nominal)
LIST.push(fp("SOT-23", "SOT-23 (pins 1-2 bottom, 3 top)", [
  { name: "1", at: [mm(-0.95), mm(1.1)], shape: "rect", size: [mm(0.6), mm(0.7)] },
  { name: "2", at: [mm(0.95), mm(1.1)], shape: "rect", size: [mm(0.6), mm(0.7)] },
  { name: "3", at: [0, mm(-1.1)], shape: "rect", size: [mm(0.6), mm(0.7)] },
], rectSilk(2.9, 1.3).filter((_, i) => i % 2 === 1)));
// 6 mm tactile push button: four legs, two pairs internally connected → pads 1,1,2,2
LIST.push(fp("SW_PUSH_6mm", "Tactile switch 6 × 6 mm (two legs per terminal)", [
  { name: "1", at: [0, 0], shape: "circle", size: [mm(2.0), mm(2.0)], drill: mm(1.1) },
  { name: "2", at: [mm(6.5), 0], shape: "circle", size: [mm(2.0), mm(2.0)], drill: mm(1.1) },
  { name: "1", at: [0, mm(4.5)], shape: "circle", size: [mm(2.0), mm(2.0)], drill: mm(1.1) },
  { name: "2", at: [mm(6.5), mm(4.5)], shape: "circle", size: [mm(2.0), mm(2.0)], drill: mm(1.1) },
], [[mm(0.25), mm(-0.75), mm(6.25), mm(-0.75)], [mm(0.25), mm(5.25), mm(6.25), mm(5.25)], [mm(-0.75), mm(1.0), mm(-0.75), mm(3.5)], [mm(7.25), mm(1.0), mm(7.25), mm(3.5)]]));

export const FOOTPRINTS: Record<string, FootprintDef> = Object.fromEntries(LIST.map((f) => [f.name, f]));
export const footprint = (name: string): FootprintDef | undefined => FOOTPRINTS[name];
