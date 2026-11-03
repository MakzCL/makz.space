// Small programmatic schematic builder, shared by the built-in examples and the tests.
import type { Project, Pt } from "../core/types";
import { newProject } from "../core/project";
import { addLabel, addPart, addWire } from "../schematic/ops";
import { pinsOf } from "../core/geom";

export class B {
  pr: Project;
  ids: Record<string, string> = {};
  constructor(name = "test") { this.pr = newProject(name); }
  part(name: string, dev: string, at: Pt, rot: 0 | 90 | 180 | 270 = 0, props: Record<string, string> = {}) { const r = addPart(this.pr, dev, "S1", at, rot); this.pr = r.pr; this.ids[name] = r.id; this.pr.parts = this.pr.parts.map((p) => (p.id === r.id ? { ...p, props: { ...p.props, ...props } } : p)); return this; }
  pin(name: string, num: string): Pt { const p = this.pr.parts.find((x) => x.id === this.ids[name])!; return pinsOf(p).find((q) => q.num === num)!.at; }
  /** orthogonal wire a→b (horizontal first unless vFirst) */
  wire(a: Pt, b: Pt, vFirst = false) { const mid: Pt = vFirst ? [a[0], b[1]] : [b[0], a[1]]; this.pr = addWire(this.pr, "S1", [a, mid, b]).pr; return this; }
  connect(a: string, ap: string, b: string, bp: string, vFirst = false) { return this.wire(this.pin(a, ap), this.pin(b, bp), vFirst); }
  gnd(at: Pt) { this.pr = addLabel(this.pr, { sheet: "S1", at, rot: 0, name: "GND", kind: "ground" }).pr; return this; }
  label(at: Pt, name: string) { this.pr = addLabel(this.pr, { sheet: "S1", at, rot: 0, name, kind: "net" }).pr; return this; }
  state(name: string, state: NonNullable<import("../core/types").Part["state"]>) { this.pr.parts = this.pr.parts.map((p) => (p.id === this.ids[name] ? { ...p, state: { ...p.state, ...state } } : p)); return this; }
}
/** Standard layout: source V1 at the origin (+ on top), two-terminal parts A and B stacked at x = 600 (pin 1 on top).
 *  V1+ → A.1 ; A.2 → B.1 ; B.2 → V1− (ground). */
export function chain(src: [string, Record<string, string>], a: [string, Record<string, string>], b: [string, Record<string, string>], name = "test"): B {
  const t = new B(name).part("V1", src[0], [0, 0], 0, src[1]).part("A", a[0], [600, -400], 270, a[1]).part("B", b[0], [600, 400], 270, b[1]);
  t.connect("V1", "1", "A", "1", true).connect("A", "2", "B", "1").connect("B", "2", "V1", "2").gnd(t.pin("V1", "2"));
  return t;
}
