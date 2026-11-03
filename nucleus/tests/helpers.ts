import type { Project, Pt } from "../src/core/types";
import { newProject } from "../src/core/project";
import { addLabel, addPart, addWire } from "../src/schematic/ops";
import { pinsOf } from "../src/core/geom";
export class B {
  pr: Project = newProject("test");
  ids: Record<string, string> = {};
  part(name: string, dev: string, at: Pt, rot: 0 | 90 | 180 | 270 = 0, props: Record<string, string> = {}) { const r = addPart(this.pr, dev, "S1", at, rot); this.pr = r.pr; this.ids[name] = r.id; this.pr.parts = this.pr.parts.map((p) => (p.id === r.id ? { ...p, props: { ...p.props, ...props } } : p)); return this; }
  pin(name: string, num: string): Pt { const p = this.pr.parts.find((x) => x.id === this.ids[name])!; return pinsOf(p).find((q) => q.num === num)!.at; }
  /** orthogonal wire a→b (horizontal first) */
  wire(a: Pt, b: Pt, vFirst = false) { const mid: Pt = vFirst ? [a[0], b[1]] : [b[0], a[1]]; this.pr = addWire(this.pr, "S1", [a, mid, b]).pr; return this; }
  connect(a: string, ap: string, b: string, bp: string, vFirst = false) { return this.wire(this.pin(a, ap), this.pin(b, bp), vFirst); }
  gnd(at: Pt) { this.pr = addLabel(this.pr, { sheet: "S1", at, rot: 0, name: "GND", kind: "ground" }).pr; return this; }
  label(at: Pt, name: string) { this.pr = addLabel(this.pr, { sheet: "S1", at, rot: 0, name, kind: "net" }).pr; return this; }
}
/** Standard test layout: source V1 at the origin (+ at top), two-terminal parts stacked at x = 600 (pin 1 on top).
 *  V1+ → A.1 ; A.2 → B.1 ; B.2 → V1− (ground). */
export function chain(src: [string, Record<string, string>], a: [string, Record<string, string>], b: [string, Record<string, string>]): B {
  const t = new B().part("V1", src[0], [0, 0], 0, src[1]).part("A", a[0], [600, -400], 270, a[1]).part("B", b[0], [600, 400], 270, b[1]);
  t.connect("V1", "1", "A", "1", true).connect("A", "2", "B", "1").connect("B", "2", "V1", "2").gnd(t.pin("V1", "2"));
  return t;
}
/** 5 V → R1 10k → mid → R2 10k → GND */
export const divider = () => chain(["VSOURCE", { value: "5" }], ["RES", { value: "10k" }], ["RES", { value: "10k" }]);
