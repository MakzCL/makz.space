// Left object browser: devices picked for this project, parts, nets, project tree.
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { device } from "../../library/devices";
import { SymbolPreview } from "./SymbolPreview";
export function Browser({ picked, onPlace, onPick, dark }: { picked: string[]; onPlace: (id: string) => void; onPick: () => void; dark: boolean }) {
  const S = useStore(); const [tab, setTab] = useState<"devices" | "parts" | "nets" | "project">("devices"); const [q, setQ] = useState("");
  const [hov, setHov] = useState<string | null>(picked[0] ?? null);
  const parts = useMemo(() => [...S.pr.parts].sort((a, b) => a.ref.localeCompare(b.ref, "en", { numeric: true })).filter((p) => !q || `${p.ref} ${p.props.value ?? ""} ${p.device}`.toLowerCase().includes(q.toLowerCase())), [S.pr.parts, q]);
  const nets = useMemo(() => S.con.nets.filter((n) => n.pins.length && (!q || n.name.toLowerCase().includes(q.toLowerCase()))), [S.con, q]);
  return (
    <div className="n-browser">
      <div className="n-btabs">{(["devices", "parts", "nets", "project"] as const).map((t) => <button key={t} type="button" className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === "devices" && <>
        <div className="n-brow"><button type="button" className="n-btn small" onClick={onPick} title="Pick devices from the library (P)" data-testid="open-picker">P · Pick devices</button></div>
        <div className="n-blist">{picked.map((id) => <div key={id} className="n-bi" onMouseEnter={() => setHov(id)} onClick={() => onPlace(id)} title="Click, then click on the sheet to place">{device(id).name}</div>)}{!picked.length && <p className="n-dim">No devices picked yet.</p>}</div>
        {hov && <div className="n-bprev"><SymbolPreview device={hov} dark={dark} size={150} /></div>}
      </>}
      {tab !== "devices" && tab !== "project" && <div className="n-brow"><input className="n-in" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      {tab === "parts" && <div className="n-blist">{parts.map((p) => <div key={p.id} className={`n-bi ${S.sel.has(p.id) ? "on" : ""}`} onClick={() => S.focusOn({ sheet: p.sheet, at: p.at, id: p.id })}><b>{p.ref}</b> {p.props.value ?? device(p.device).name}</div>)}</div>}
      {tab === "nets" && <div className="n-blist">{nets.map((n) => <div key={n.name} className="n-bi" title={n.pins.map((p) => `${p.ref}.${p.pin}`).join(" ")} onClick={() => { const w = n.wires[0]; if (w) { const wr = S.pr.wires.find((x) => x.id === w)!; S.focusOn({ sheet: wr.sheet, at: wr.pts[0], id: w }); } }}><b className="mono">{n.name}</b> <span className="n-dim">{n.pins.length} pins</span></div>)}</div>}
      {tab === "project" && <div className="n-blist">
        <div className="n-bi"><b>{S.pr.name}</b> <span className="n-dim">rev {S.pr.revision}</span></div>
        {S.pr.sheets.map((s) => <div key={s.id} className={`n-bi ind ${S.sheet === s.id ? "on" : ""}`} onClick={() => S.setSheet(s.id)}>▸ {s.name} <span className="n-dim">{S.pr.parts.filter((p) => p.sheet === s.id).length} parts</span></div>)}
        <div className="n-bi ind n-dim">{S.pr.parts.length} parts · {S.con.nets.filter((n) => n.pins.length).length} nets · {S.pr.wires.length} wires</div>
      </div>}
    </div>
  );
}
