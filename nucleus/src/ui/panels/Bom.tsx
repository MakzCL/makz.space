// Bill of materials from the live schematic data (simulation-only sources excluded).
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { device, simOnly } from "../../library/devices";
import { dl } from "../sim/Instruments";
export interface BomLine { refs: string[]; qty: number; name: string; value: string; footprint: string; manufacturer: string; mpn: string; description: string }
export function bomLines(pr: ReturnType<typeof useStore>["pr"]): BomLine[] {
  const g = new Map<string, BomLine>();
  for (const p of pr.parts) { const d = device(p.device); if (simOnly(d)) continue;
    const k = [d.id, p.props.value ?? "", p.props.footprint ?? "", p.props.mpn ?? d.mpn ?? "", p.props.manufacturer ?? ""].join("|");
    const l = g.get(k) ?? { refs: [], qty: 0, name: d.name, value: p.props.value ?? "", footprint: p.props.footprint ?? "", manufacturer: p.props.manufacturer ?? d.manufacturer ?? "", mpn: p.props.mpn ?? d.mpn ?? "", description: p.props.description ?? d.description };
    l.refs.push(p.ref); l.qty++; g.set(k, l); }
  return [...g.values()].map((l) => ({ ...l, refs: l.refs.sort((a, b) => a.localeCompare(b, "en", { numeric: true })) })).sort((a, b) => a.refs[0].localeCompare(b.refs[0], "en", { numeric: true }));
}
const csvCell = (s: string | number) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
export function bomCsv(lines: BomLine[]) { return ["References,Quantity,Device,Value,Footprint,Manufacturer,Part number,Description", ...lines.map((l) => [l.refs.join(" "), l.qty, l.name, l.value, l.footprint, l.manufacturer, l.mpn, l.description].map(csvCell).join(","))].join("\r\n"); }
export function Bom() {
  const S = useStore(); const [q, setQ] = useState("");
  const lines = useMemo(() => bomLines(S.pr).filter((l) => !q || JSON.stringify(l).toLowerCase().includes(q.toLowerCase())), [S.pr, q]);
  const missing = lines.filter((l) => !l.footprint).length;
  return (
    <div className="n-pad n-bom" data-testid="bom">
      <div className="n-row"><h3>Bill of materials</h3><span className="n-dim">{lines.reduce((a, l) => a + l.qty, 0)} parts · {lines.length} lines · from the current schematic{missing ? ` · ${missing} line(s) without footprint` : ""}</span>
        <input className="n-in" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 160 }} />
        <button type="button" className="n-btn small primary" onClick={() => dl(`${S.pr.name}-BOM.csv`, bomCsv(lines))} data-testid="bom-csv">Export CSV</button></div>
      <table className="n-tbl"><thead><tr><th>References</th><th>Qty</th><th>Device</th><th>Value</th><th>Footprint</th><th>Manufacturer</th><th>Part number</th><th>Description</th></tr></thead>
        <tbody>{lines.map((l) => <tr key={l.refs.join()}><td className="mono">{l.refs.join(", ")}</td><td>{l.qty}</td><td>{l.name}</td><td className="mono">{l.value}</td><td className={l.footprint ? "" : "n-err"}>{l.footprint || "missing"}</td><td>{l.manufacturer}</td><td>{l.mpn}</td><td>{l.description}</td></tr>)}</tbody></table>
      <p className="n-dim">Simulation-only sources (generators, DC sources) are not listed. Edit values and part numbers in the inspector; this table updates immediately.</p>
    </div>
  );
}
