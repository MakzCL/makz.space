// Maps raw simulator vectors back to design objects (nets, parts).
import type { RawResult } from "./engine";
import type { SpiceDeck } from "./netlist";
export interface SimResult {
  analysis: "op" | "tran" | "ac" | "dc"; at: string; revision: number; deck: string;
  axis: { name: string; unit: string; values: number[] } | null;
  netV: Map<string, { re: number[]; im?: number[] }>;    // net name → voltage vector
  branchI: Map<string, number[]>;                         // element name (lower case) → current
  errors: string[]; warnings: string[];
}
export function mapResult(raw: RawResult, deck: SpiceDeck, analysis: SimResult["analysis"], revision: number): SimResult {
  const netV = new Map<string, { re: number[]; im?: number[] }>(), branchI = new Map<string, number[]>();
  let axis: SimResult["axis"] = null;
  for (const v of raw.vectors) {
    const m = /^v\((.+)\)$/i.exec(v.name), i = /^i\((.+)\)$/i.exec(v.name) ?? /^(.+)#branch$/i.exec(v.name);
    if (v.type === "time" || v.type === "frequency" || (analysis === "dc" && v === raw.vectors[0] && !m)) axis = { name: v.name, unit: v.type === "time" ? "s" : v.type === "frequency" ? "Hz" : "V", values: v.re };
    else if (m) { const net = deck.netOfNode.get(m[1].toLowerCase()) ?? deck.netOfNode.get(m[1]); if (net) netV.set(net, { re: v.re, im: v.im }); }
    else if (i) branchI.set(i[1].toLowerCase(), v.re);
    else if (deck.netOfNode.has(v.name.toLowerCase())) netV.set(deck.netOfNode.get(v.name.toLowerCase())!, { re: v.re, im: v.im });
  }
  if (deck.nodeOfNet.has("GND")) netV.set("GND", { re: (axis?.values ?? [0]).map(() => 0) });
  return { analysis, at: new Date().toISOString(), revision, deck: deck.text, axis, netV, branchI, errors: raw.errors, warnings: [] };
}
/** Value of net a minus net b (b defaults to ground) at index i. */
export const vDiff = (r: SimResult, a: string, b = "GND", i = 0) => (r.netV.get(a)?.re[i] ?? NaN) - (b === "GND" ? 0 : r.netV.get(b)?.re[i] ?? NaN);
