// Project → SPICE netlist (ngspice dialect). Deterministic output; refuses rather than guesses.
import type { Project } from "../core/types";
import { connectivity, type Connectivity } from "../connectivity/connectivity";
import { device } from "../library/devices";
import { parseValue, toSpice } from "../core/units";

export interface SimDiag { level: "error" | "warning" | "info"; message: string; part?: string; net?: string }
export interface SpiceDeck { text: string; nodeOfNet: Map<string, string>; netOfNode: Map<string, string>; elementOfPart: Map<string, string[]>; diags: SimDiag[]; ok: boolean }
const SW_ON = "10m", SW_OFF = "1g";

export function nodeName(net: string) { return net === "GND" ? "0" : `n_${net.replace(/[^A-Za-z0-9_]/g, (ch) => `_${ch.charCodeAt(0).toString(16)}_`).toLowerCase()}`; }
const inst = (letter: string, ref: string) => (ref[0].toUpperCase() === letter ? ref : `${letter}${ref}`);

export function buildSpice(pr: Project, c: Connectivity = connectivity(pr), analysis = pr.sim.analysis): SpiceDeck {
  const diags: SimDiag[] = []; const lines: string[] = []; const models = new Map<string, string>(); const subckts = new Map<string, string>();
  const nodeOfNet = new Map<string, string>(), netOfNode = new Map<string, string>(), elementOfPart = new Map<string, string[]>();
  for (const n of c.nets) { const node = nodeName(n.name); nodeOfNet.set(n.name, node); netOfNode.set(node, n.name); }
  const gnd = c.nets.find((n) => n.name === "GND");
  if (!gnd || !gnd.pins.length) diags.push({ level: "error", message: "No ground reference: place a ground terminal and connect it to the circuit (SPICE measures every voltage against it)." });
  const num = (p: { ref: string; id: string }, v: string | undefined, what: string): string | null => {
    const x = v === undefined ? null : parseValue(v);
    if (x === null) { diags.push({ level: "error", message: `${p.ref}: ${what} “${v ?? ""}” is not a number`, part: p.id }); return null; }
    return toSpice(x);
  };
  let nc = 0;
  const parts = [...pr.parts].sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true }));
  for (const p of parts) {
    const d = device(p.device);
    if (!d.spice) { diags.push({ level: "error", message: `${p.ref} (${d.name}) has no simulation model — it cannot be simulated. Remove it or choose a device with a model.`, part: p.id }); continue; }
    if (d.spice.kind === "ignore") { diags.push({ level: "info", message: `${p.ref}: ${d.spice.reason} — not part of the simulation`, part: p.id }); continue; }
    const node = (pin: string) => { const net = c.pinNet.get(`${p.id}:${pin}`); if (!net) { diags.push({ level: "warning", message: `${p.ref} pin ${pin} is not connected (left floating)`, part: p.id }); return `nc_${++nc}`; } return nodeOfNet.get(net)!; };
    const els: string[] = [];
    const s = d.spice;
    if (s.kind === "element") {
      const nodes = s.order.map(node).join(" ");
      const name = inst(s.letter, p.ref);
      if (s.model) { models.set(s.model.name, `.model ${s.model.name} ${s.model.card}`); lines.push(`${name} ${nodes} ${s.model.name}`); }
      else if (s.value === "value") { const v = num(p, p.props.value, "value"); if (v !== null) { if (parseValue(p.props.value!)! <= 0 && s.letter !== "V") diags.push({ level: "error", message: `${p.ref}: value must be above zero`, part: p.id }); else lines.push(`${name} ${nodes} ${v}`); } }
      else if (s.value === "source") {
        if (d.id === "VSINE") {
          const o = num(p, p.props.offset ?? "0", "offset"), a = num(p, p.props.amplitude, "amplitude"), f = num(p, p.props.frequency, "frequency"), ph = Number(p.props.phase ?? 0), ac = num(p, p.props.ac ?? "0", "AC magnitude");
          if ([o, a, f, ac].every((x) => x !== null)) lines.push(`${name} ${nodes} DC ${o} AC ${ac} SIN(${o} ${a} ${f} 0 0 ${Number.isFinite(ph) ? ph : 0})`);
        } else if (d.id === "VPULSE") {
          const k = ["v1", "v2", "delay", "rise", "fall", "width", "period"].map((key) => num(p, p.props[key] ?? "0", key));
          if (k.every((x) => x !== null)) lines.push(`${name} ${nodes} PULSE(${k.join(" ")})`);
        } else { const v = num(p, p.props.value, d.id === "ISOURCE" ? "current" : "voltage"); if (v !== null) lines.push(`${name} ${nodes} DC ${v}${analysis === "ac" ? " AC 0" : ""}`); }
      }
      els.push(name);
    } else if (s.kind === "subckt") {
      subckts.set(s.name, s.body);
      const params = (s.params ?? []).map((k) => { const v = num(p, p.props[k], k); return v === null ? null : `${k}=${v}`; });
      if (params.every((x) => x !== null)) { lines.push(`X${p.ref} ${s.order.map(node).join(" ")} ${s.name}${params.length ? " " + params.join(" ") : ""}`); els.push(`X${p.ref}`); }
    } else if (s.kind === "switch") {
      const name = inst("R", p.ref); lines.push(`${name} ${s.order.map(node).join(" ")} ${p.state?.closed ? SW_ON : SW_OFF}`); els.push(name);
    } else if (s.kind === "pot") {
      const r = parseValue(p.props.value ?? ""); if (r === null || r <= 0) { diags.push({ level: "error", message: `${p.ref}: “${p.props.value}” is not a valid resistance`, part: p.id }); continue; }
      const pos = Math.min(1, Math.max(0, p.state?.position ?? 0.5));
      const [a, w, b] = s.order.map(node);
      lines.push(`R${p.ref}_A ${a} ${w} ${toSpice(Math.max(pos * r, 1e-3))}`, `R${p.ref}_B ${w} ${b} ${toSpice(Math.max((1 - pos) * r, 1e-3))}`); els.push(`R${p.ref}_A`, `R${p.ref}_B`);
    }
    elementOfPart.set(p.id, els);
  }
  if (!lines.length) diags.push({ level: "error", message: "Nothing to simulate: the schematic has no simulated parts." });
  const sim = pr.sim; const an: string[] = [];
  const val = (v: string, what: string) => { const x = parseValue(v); if (x === null) { diags.push({ level: "error", message: `Simulation setting “${what}” = “${v}” is not a number` }); return "0"; } return toSpice(x); };
  if (analysis === "op") an.push(".op");
  else if (analysis === "tran") { const stop = parseValue(sim.tran.stop), step = parseValue(sim.tran.step); if (!stop || stop <= 0) diags.push({ level: "error", message: "Transient: stop time must be above zero" }); if (step && stop && step > stop) diags.push({ level: "error", message: "Transient: the step is longer than the run" }); an.push(`.tran ${val(sim.tran.step, "step")} ${val(sim.tran.stop, "stop time")} ${val(sim.tran.start || "0", "start time")}${sim.tran.uic ? " uic" : ""}`); }
  else if (analysis === "ac") { if (!pr.parts.some((p) => device(p.device).id === "VSINE" && parseValue(p.props.ac ?? "0"))) diags.push({ level: "error", message: "AC analysis needs a signal: give a sine generator an AC magnitude above 0" }); an.push(`.ac ${sim.ac.type} ${Math.max(1, Math.round(sim.ac.points))} ${val(sim.ac.fstart, "start frequency")} ${val(sim.ac.fstop, "stop frequency")}`); }
  else if (analysis === "dc") { const src = pr.parts.find((p) => p.ref === sim.dc.source); if (!src || !["VSOURCE", "ISOURCE"].includes(src.device)) diags.push({ level: "error", message: `DC sweep: “${sim.dc.source}” is not a DC voltage or current source in this design` }); else an.push(`.dc ${inst(src.device === "VSOURCE" ? "V" : "I", src.ref)} ${val(sim.dc.start, "start")} ${val(sim.dc.stop, "stop")} ${val(sim.dc.step, "step")}`); }
  const text = [`* NUCLUES - ${pr.name} (rev ${pr.revision})`, `.temp ${sim.temp}`, ...[...models.values()].sort(), ...[...subckts.values()], ...lines, ...an, ".end", ""].join("\n")
    // ngspice's WASM build stalls on non-ASCII input: transliterate names, never pass them through
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e\n]/g, "?");
  return { text, nodeOfNet, netOfNode, elementOfPart, diags, ok: !diags.some((d) => d.level === "error") };
}
