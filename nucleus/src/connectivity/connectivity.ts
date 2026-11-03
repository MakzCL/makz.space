// Connectivity: turns geometry into electrical nets. Rules (deterministic, integer geometry):
//  • a wire end touching another wire anywhere (end or interior = T-junction) connects;
//  • two wires that only cross (no end at the crossing) do NOT connect;
//  • a pin connects to a wire whose end or interior passes through the pin's end point, and to pins at the same point;
//  • a label / power / ground terminal connects to whatever its anchor touches;
//  • nets with the same name connect project-wide (net labels, power and ground terminals);
//  • GND terminals name the net "GND" (SPICE node 0).
import type { Label, Project, Pt } from "../core/types";
import { eq, onSeg, pinsOf, segs, type PinPos } from "../core/geom";

class DSU { p: number[] = []; add() { this.p.push(this.p.length); return this.p.length - 1; } find(a: number): number { while (this.p[a] !== a) { this.p[a] = this.p[this.p[a]]; a = this.p[a]; } return a; } union(a: number, b: number) { const x = this.find(a), y = this.find(b); if (x !== y) this.p[Math.max(x, y)] = Math.min(x, y); } }

export interface NetPin { part: string; ref: string; pin: string; name: string; type: PinPos["type"] }
export interface Net { name: string; auto: boolean; pins: NetPin[]; wires: string[]; labels: string[]; sheets: string[] }
export interface Connectivity {
  nets: Net[];
  pinNet: Map<string, string>;            // `${partId}:${pin}` → net name
  wireNet: Map<string, string>;           // wire id → net name
  labelNet: Map<string, string>;
  junctions: { sheet: string; at: Pt }[]; // dots where 3+ connections meet
  danglingEnds: { sheet: string; at: Pt; wire: string }[];
  nameConflicts: { names: string[]; sheet: string; at: Pt }[];
}
const SAFE = /^[A-Za-z0-9_+\-.$/#]+$/;
export const validNetName = (s: string) => SAFE.test(s) && s.length <= 64;
export const labelNetName = (l: Label) => (l.kind === "ground" ? "GND" : l.name.trim());

export function connectivity(pr: Project): Connectivity {
  const dsu = new DSU();
  const wireNode = new Map<string, number>(), pinNode = new Map<string, number>(), labelNode = new Map<string, number>();
  const pins: (PinPos & { ref: string; sheet: string })[] = [];
  for (const p of pr.parts) for (const q of pinsOf(p)) { pins.push({ ...q, ref: p.ref, sheet: p.sheet }); pinNode.set(`${p.id}:${q.num}`, dsu.add()); }
  for (const w of pr.wires) wireNode.set(w.id, dsu.add());
  for (const l of pr.labels) labelNode.set(l.id, dsu.add());
  const junctionCount = new Map<string, number>(); const bump = (sheet: string, at: Pt, n = 1) => { const k = `${sheet}|${at[0]},${at[1]}`; junctionCount.set(k, (junctionCount.get(k) ?? 0) + n); };
  const bySheet = <T extends { sheet: string }>(xs: T[]) => { const m = new Map<string, T[]>(); for (const x of xs) m.set(x.sheet, [...(m.get(x.sheet) ?? []), x]); return m; };
  const wiresBy = bySheet(pr.wires), pinsBy = bySheet(pins), labelsBy = bySheet(pr.labels);
  const danglingEnds: Connectivity["danglingEnds"] = [];
  for (const [sheet, ws] of wiresBy) {
    const sp = pinsBy.get(sheet) ?? [], sl = labelsBy.get(sheet) ?? [];
    for (const w of ws) {
      const ends = [w.pts[0], w.pts[w.pts.length - 1]];
      for (const e of ends) {
        let touched = 0;
        for (const o of ws) { if (o === w) continue; if (segs(o.pts).some(([a, b]) => onSeg(e, a, b))) { dsu.union(wireNode.get(w.id)!, wireNode.get(o.id)!); touched++; } }
        for (const p of sp) if (eq(p.at, e)) { dsu.union(wireNode.get(w.id)!, pinNode.get(`${p.part}:${p.num}`)!); touched++; }
        for (const l of sl) if (eq(l.at, e)) touched++;
        if (!touched) danglingEnds.push({ sheet, at: e, wire: w.id });
      }
      // pins and labels on the wire's interior
      for (const p of sp) if (!ends.some((e) => eq(e, p.at)) && segs(w.pts).some(([a, b]) => onSeg(p.at, a, b))) { dsu.union(wireNode.get(w.id)!, pinNode.get(`${p.part}:${p.num}`)!); }
      for (const l of sl) if (segs(w.pts).some(([a, b]) => onSeg(l.at, a, b))) dsu.union(wireNode.get(w.id)!, labelNode.get(l.id)!);
    }
  }
  // labels on pins, pins on pins (every sheet, wired or not)
  for (const [sheet, sp] of pinsBy) {
    const sl = labelsBy.get(sheet) ?? [];
    for (const l of sl) for (const p of sp) if (eq(l.at, p.at)) dsu.union(labelNode.get(l.id)!, pinNode.get(`${p.part}:${p.num}`)!);
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) if (eq(sp[i].at, sp[j].at)) dsu.union(pinNode.get(`${sp[i].part}:${sp[i].num}`)!, pinNode.get(`${sp[j].part}:${sp[j].num}`)!);
  }
  // junction dots: at each point count wire ends + pins + 2 for every wire passing straight through; 3 or more = dot
  for (const [sheet, ws] of wiresBy) {
    const pts = new Map<string, Pt>();
    for (const w of ws) for (const e of [w.pts[0], w.pts[w.pts.length - 1]]) pts.set(`${e[0]},${e[1]}`, e);
    for (const p of pinsBy.get(sheet) ?? []) pts.set(`${p.at[0]},${p.at[1]}`, p.at);
    for (const at of pts.values()) {
      let n = 0;
      for (const w of ws) {
        const ends = (eq(w.pts[0], at) ? 1 : 0) + (eq(w.pts[w.pts.length - 1], at) ? 1 : 0);
        if (ends) n += ends; else if (segs(w.pts).some(([a, b]) => onSeg(at, a, b))) n += 2;
        else for (let i = 1; i < w.pts.length - 1; i++) if (eq(w.pts[i], at)) n += 2;
      }
      if (!n) continue;
      n += (pinsBy.get(sheet) ?? []).filter((p) => eq(p.at, at)).length;
      if (n >= 3) bump(sheet, at, n);
    }
  }
  // same name → same net (project-wide)
  const byName = new Map<string, number>(); const nameConflicts: Connectivity["nameConflicts"] = [];
  for (const l of pr.labels) { const n = labelNetName(l); if (!n) continue; const node = labelNode.get(l.id)!; const prev = byName.get(n); if (prev === undefined) byName.set(n, node); else dsu.union(prev, node); }
  // collect groups
  const groups = new Map<number, { pins: NetPin[]; wires: string[]; labels: string[]; names: Set<string>; sheets: Set<string>; at?: Pt }>();
  const g = (node: number) => { const r = dsu.find(node); let x = groups.get(r); if (!x) { x = { pins: [], wires: [], labels: [], names: new Set(), sheets: new Set() }; groups.set(r, x); } return x; };
  for (const p of pins) { const x = g(pinNode.get(`${p.part}:${p.num}`)!); x.pins.push({ part: p.part, ref: p.ref, pin: p.num, name: p.name, type: p.type }); x.sheets.add(p.sheet); }
  for (const w of pr.wires) { const x = g(wireNode.get(w.id)!); x.wires.push(w.id); x.sheets.add(w.sheet); x.at ??= w.pts[0]; }
  for (const l of pr.labels) { const x = g(labelNode.get(l.id)!); x.labels.push(l.id); const n = labelNetName(l); if (n) x.names.add(n); x.sheets.add(l.sheet); x.at ??= l.at; }
  // deterministic auto names: order groups by their lowest "ref.pin"
  const list = [...groups.values()].filter((x) => x.pins.length || x.wires.length || x.labels.length);
  const key = (x: (typeof list)[number]) => x.pins.map((p) => `${p.ref}.${p.pin.padStart(4, "0")}`).sort()[0] ?? `~${x.wires.slice().sort()[0] ?? x.labels.slice().sort()[0]}`;
  list.sort((a, b) => key(a).localeCompare(key(b), "en", { numeric: true }));
  let auto = 0; const nets: Net[] = [];
  for (const x of list) {
    const names = [...x.names].sort();
    if (names.length > 1) nameConflicts.push({ names, sheet: [...x.sheets][0], at: x.at ?? [0, 0] });
    const preferred = names.includes("GND") ? "GND" : names[0];
    nets.push({ name: preferred ?? `N$${++auto}`, auto: !preferred, pins: x.pins.sort((a, b) => `${a.ref}.${a.pin}`.localeCompare(`${b.ref}.${b.pin}`, "en", { numeric: true })), wires: x.wires.sort(), labels: x.labels.sort(), sheets: [...x.sheets].sort() });
  }
  const pinNet = new Map<string, string>(), wireNet = new Map<string, string>(), labelNet = new Map<string, string>();
  for (const n of nets) { for (const p of n.pins) pinNet.set(`${p.part}:${p.pin}`, n.name); for (const w of n.wires) wireNet.set(w, n.name); for (const l of n.labels) labelNet.set(l, n.name); }
  const junctions = [...junctionCount.entries()].filter(([, c]) => c >= 3).map(([k]) => { const [sheet, xy] = k.split("|"); const [x, y] = xy.split(",").map(Number); return { sheet, at: [x, y] as Pt }; });
  return { nets, pinNet, wireNet, labelNet, junctions, danglingEnds, nameConflicts };
}
/** Netlist in a neutral form (ref.pin → net), sorted, for comparisons, exports and PCB transfer. */
export function netlistText(pr: Project, c = connectivity(pr)): string {
  return c.nets.filter((n) => n.pins.length).map((n) => `${n.name}: ${n.pins.map((p) => `${p.ref}.${p.pin}`).join(" ")}`).join("\n");
}
/** The net at a sheet point: a wire passing through it, a pin ending on it, or a label anchored on it. */
export function netAt(pr: Project, c: Connectivity, sheet: string, at: Pt): string | null {
  for (const w of pr.wires) if (w.sheet === sheet && segs(w.pts).some(([a, b]) => onSeg(at, a, b))) return c.wireNet.get(w.id) ?? null;
  for (const p of pr.parts) if (p.sheet === sheet) for (const q of pinsOf(p)) if (eq(q.at, at)) return c.pinNet.get(`${p.id}:${q.num}`) ?? null;
  for (const l of pr.labels) if (l.sheet === sheet && eq(l.at, at)) return c.labelNet.get(l.id) ?? null;
  return null;
}
