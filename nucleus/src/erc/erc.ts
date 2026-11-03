// Electrical Rule Check. Every finding points at a real object (part, net, wire or label) and a location.
import type { Project, Pt } from "../core/types";
import { connectivity, validNetName, type Connectivity } from "../connectivity/connectivity";
import { device, simOnly } from "../library/devices";
import { pinsOf } from "../core/geom";
import { parseValue } from "../core/units";

export type Severity = "error" | "warning" | "info";
export interface Finding { id: string; rule: string; severity: Severity; message: string; fix?: string; part?: string; net?: string; wire?: string; label?: string; sheet: string; at: Pt }
export const ERC_RULES: Record<string, { label: string; severity: Severity }> = {
  "duplicate-ref": { label: "Duplicate reference", severity: "error" },
  "unannotated": { label: "Unannotated part", severity: "error" },
  "unconnected-pin": { label: "Unconnected pin", severity: "warning" },
  "unconnected-input": { label: "Unconnected input or power pin", severity: "error" },
  "output-conflict": { label: "Outputs driving each other", severity: "error" },
  "undriven-input": { label: "Input with no driver", severity: "warning" },
  "power-not-driven": { label: "Power pin with no supply", severity: "error" },
  "single-pin-net": { label: "Net with only one pin", severity: "warning" },
  "missing-value": { label: "Missing or invalid value", severity: "error" },
  "missing-footprint": { label: "No footprint assigned", severity: "warning" },
  "invalid-net-name": { label: "Invalid net name", severity: "error" },
  "net-name-conflict": { label: "Net has two names", severity: "warning" },
  "dangling-wire": { label: "Wire end not connected", severity: "warning" },
};
const DRIVERS = new Set(["output", "bidir", "tristate", "power_out", "open_collector", "passive"]);

export function erc(pr: Project, c: Connectivity = connectivity(pr)): Finding[] {
  const out: Finding[] = []; let n = 0;
  const add = (f: Omit<Finding, "id" | "severity"> & { severity?: Severity }) => { if (pr.settings.ercIgnore.includes(f.rule)) return; out.push({ severity: ERC_RULES[f.rule].severity, ...f, id: `e${++n}` }); };
  const partById = new Map(pr.parts.map((p) => [p.id, p]));
  // references
  const seen = new Map<string, string>();
  for (const p of pr.parts) {
    if (!/^[A-Za-z]+\d+$/.test(p.ref)) add({ rule: "unannotated", message: `${p.ref} has no number — annotate the design`, fix: "Design → Annotate", part: p.id, sheet: p.sheet, at: p.at });
    else if (seen.has(p.ref)) add({ rule: "duplicate-ref", message: `${p.ref} is used by more than one part`, fix: "Rename one of them or annotate", part: p.id, sheet: p.sheet, at: p.at });
    seen.set(p.ref, p.id);
    const d = device(p.device);
    for (const pd of d.props) if (pd.required) {
      const v = p.props[pd.key];
      if (!v?.trim()) add({ rule: "missing-value", message: `${p.ref}: ${pd.label} is empty`, part: p.id, sheet: p.sheet, at: p.at });
      else if (pd.kind === "value" && parseValue(v) === null) add({ rule: "missing-value", message: `${p.ref}: “${v}” is not a valid ${pd.label.toLowerCase()} (examples: 4k7, 100n, 2.2u, 1meg)`, part: p.id, sheet: p.sheet, at: p.at });
    }
    if (!simOnly(d) && d.footprints.length && !p.props.footprint?.trim()) add({ rule: "missing-footprint", message: `${p.ref} has no footprint`, fix: `Choose one of: ${d.footprints.join(", ")}`, part: p.id, sheet: p.sheet, at: p.at });
  }
  // pins
  const pinAt = new Map<string, Pt>();
  for (const p of pr.parts) for (const q of pinsOf(p)) pinAt.set(`${p.id}:${q.num}`, q.at);
  for (const p of pr.parts) for (const q of pinsOf(p)) {
    if (q.type === "nc") continue;
    const net = c.nets.find((x) => x.name === c.pinNet.get(`${p.id}:${q.num}`));
    const alone = !net || (net.pins.length === 1 && net.labels.length === 0 && net.wires.length === 0);
    if (alone) add({ rule: q.type === "input" || q.type === "power_in" ? "unconnected-input" : "unconnected-pin", message: `${p.ref} pin ${q.num}${q.name !== q.num ? ` (${q.name})` : ""} is not connected`, part: p.id, sheet: p.sheet, at: q.at });
  }
  // nets
  for (const net of c.nets) {
    const at = (net.pins[0] && pinAt.get(`${net.pins[0].part}:${net.pins[0].pin}`)) || [0, 0] as Pt;
    const sheet = (net.pins[0] && partById.get(net.pins[0].part)?.sheet) || net.sheets[0] || pr.sheets[0].id;
    if (!net.auto && !validNetName(net.name)) add({ rule: "invalid-net-name", message: `Net name “${net.name}” contains characters that are not allowed`, fix: "Use letters, digits and _ + - . / #", net: net.name, sheet, at });
    const types = net.pins.map((p) => p.type);
    const outs = net.pins.filter((p) => p.type === "output" || p.type === "power_out");
    const sources = net.pins.filter((p) => device(partById.get(p.part)!.device).category === "Source");
    if (outs.length - sources.length > 1 || (outs.length > 1 && sources.length < outs.length && outs.some((o) => o.type === "output"))) add({ rule: "output-conflict", message: `Net ${net.name}: ${outs.map((o) => `${o.ref}.${o.pin}`).join(", ")} all drive it`, net: net.name, sheet, at });
    if (types.includes("input") && !types.some((t) => DRIVERS.has(t)) && net.labels.length === 0) add({ rule: "undriven-input", message: `Net ${net.name} has inputs but nothing drives it`, net: net.name, sheet, at });
    if (types.includes("power_in") && !types.some((t) => t === "power_out") && !net.labels.some((id) => pr.labels.find((l) => l.id === id)?.kind !== "net") && !types.includes("passive"))
      add({ rule: "power-not-driven", message: `Net ${net.name} feeds power pins but has no supply or power terminal`, fix: "Connect a supply, or a power/ground terminal", net: net.name, sheet, at });
    if (net.pins.length === 1 && (net.wires.length || net.labels.length) && net.pins[0].type !== "nc") add({ rule: "single-pin-net", message: `Net ${net.name} connects to only ${net.pins[0].ref}.${net.pins[0].pin}`, net: net.name, sheet, at });
  }
  for (const k of c.nameConflicts) add({ rule: "net-name-conflict", message: `One net carries the names ${k.names.join(" and ")} — they are joined`, sheet: k.sheet, at: k.at, net: k.names[0] });
  for (const d of c.danglingEnds) add({ rule: "dangling-wire", message: "Wire end is not connected to anything", wire: d.wire, sheet: d.sheet, at: d.at });
  const rank = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
