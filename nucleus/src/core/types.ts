// The NUCLUES project model. The model is the source of truth; rendering only reads it.
// Schematic coordinates: integer thou. Rotations: 0/90/180/270 degrees counter-clockwise (y down).

export type Pt = [number, number];
export type PinType = "passive" | "input" | "output" | "bidir" | "tristate" | "power_in" | "power_out" | "open_collector" | "nc";
export const PIN_TYPES: PinType[] = ["passive", "input", "output", "bidir", "tristate", "power_in", "power_out", "open_collector", "nc"];

/** Symbol graphics in symbol-local thou; pins end at their connection point. */
export type Gfx =
  | { k: "line"; pts: Pt[]; w?: number }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: boolean }
  | { k: "circle"; x: number; y: number; r: number; fill?: boolean }
  | { k: "arc"; x: number; y: number; r: number; a0: number; a1: number }
  | { k: "poly"; pts: Pt[]; fill?: boolean }
  | { k: "text"; x: number; y: number; text: string; size?: number; anchor?: "start" | "middle" | "end" };
export interface PinDef { num: string; name: string; at: Pt; len: number; dir: 0 | 90 | 180 | 270; type: PinType; hideName?: boolean }
export interface SymbolDef { gfx: Gfx[]; pins: PinDef[]; refAt: Pt; valueAt: Pt }

/** How a device becomes simulator input. Never guessed: a device without `spice` cannot be simulated. */
export type SpiceDef =
  | { kind: "element"; letter: "R" | "C" | "L" | "V" | "I" | "D" | "Q" | "M"; order: string[]; value?: "value" | "source"; model?: { name: string; card: string } }
  | { kind: "subckt"; order: string[]; name: string; body: string; params?: string[] }
  | { kind: "switch"; order: string[] }
  | { kind: "pot"; order: [string, string, string] }   // ends + wiper
  | { kind: "ignore"; reason: string };                // connects nets only (connectors, test points)
export type Category = "Passive" | "Semiconductor" | "Source" | "Analog IC" | "Switch" | "Connector" | "Indicator";
export interface PropDef { key: string; label: string; kind: "value" | "text" | "number" | "choice"; unit?: string; choices?: string[]; required?: boolean; help?: string }
export interface DeviceDef {
  id: string; name: string; category: Category; description: string; prefix: string;
  manufacturer?: string; mpn?: string; datasheet?: string;
  symbol: SymbolDef; spice?: SpiceDef; footprints: string[];
  props: PropDef[]; defaults: Record<string, string>;
  interactive?: "switch" | "pot";
  libVersion: number; modelNote?: string;
}

export interface Part {
  id: string; ref: string; device: string; sheet: string;
  at: Pt; rot: 0 | 90 | 180 | 270; mirror: boolean;
  props: Record<string, string>;        // value, footprint, tolerance, mpn, manufacturer, …
  refOffset?: Pt; valueOffset?: Pt;
  state?: { closed?: boolean; position?: number }; // interactive parts
}
export interface Wire { id: string; sheet: string; pts: Pt[] } // orthogonal polyline
export type LabelKind = "net" | "power" | "ground" | "port";
export interface Label { id: string; sheet: string; at: Pt; rot: 0 | 90 | 180 | 270; name: string; kind: LabelKind }
export interface Note { id: string; sheet: string; at: Pt; text: string; size: number }
export interface Probe { id: string; sheet: string; at: Pt; kind: "voltage"; name: string; ref?: Pt | null } // ref = second point for differential
export interface Sheet { id: string; name: string; size: "A4" | "A3" | "A2"; title: string; revision: string; author: string }

export type AnalysisKind = "op" | "tran" | "ac" | "dc";
export interface SimConfig {
  analysis: AnalysisKind;
  tran: { stop: string; step: string; start: string; uic: boolean };
  ac: { type: "dec" | "oct" | "lin"; points: number; fstart: string; fstop: string };
  dc: { source: string; start: string; stop: string; step: string };
  temp: number;
}
export interface InstrumentDef { id: string; kind: "multimeter" | "scope"; name: string; channels: { net: string; ref?: string; color: string; scale?: number }[]; mode?: "dcv" | "acv" | "dci" }

export interface Revision { n: number; at: string; note: string }
export interface Project {
  format: "nucleus"; schema: number;
  id: string; name: string; created: string; modified: string;
  revision: number; revisions: Revision[];
  units: "mm" | "th";
  sheets: Sheet[]; parts: Part[]; wires: Wire[]; labels: Label[]; notes: Note[]; probes: Probe[];
  sim: SimConfig; instruments: InstrumentDef[];
  pcb: unknown | null;                  // PCB model (pcb/), null until the board is created
  settings: { grid: number; ercIgnore: string[] };
}
