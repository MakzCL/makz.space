// "Pick devices" dialog: search by part number, category, manufacturer or description; see the symbol,
// pins, simulation model and footprints before placing.
import { useMemo, useState } from "react";
import { DEVICES, searchDevices } from "../../library/devices";
import type { Category } from "../../core/types";
import { Modal } from "../kit";
import { SymbolPreview } from "./SymbolPreview";
const CATS: Category[] = ["Passive", "Semiconductor", "Indicator", "Source", "Analog IC", "Switch", "Connector"];
export function DevicePicker({ onPick, onClose, dark }: { onPick: (id: string) => void; onClose: () => void; dark: boolean }) {
  const [q, setQ] = useState(""); const [cat, setCat] = useState<Category | "">("");
  const list = useMemo(() => searchDevices(q, cat || undefined), [q, cat]);
  const [cur, setCur] = useState(list[0]?.id ?? DEVICES[0].id);
  const d = DEVICES.find((x) => x.id === cur) ?? list[0];
  return (
    <Modal title="Pick device" wide onClose={onClose} foot={<><button type="button" className="n-btn" onClick={onClose}>Cancel</button><button type="button" className="n-btn primary" disabled={!d} onClick={() => d && onPick(d.id)} data-testid="pick-ok">Place</button></>}>
      <div className="n-picker">
        <div className="n-picker-l">
          <input className="n-in" autoFocus placeholder="Keywords: part number, value type, description…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="pick-search"
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && list[0]) onPick((list.find((x) => x.id === cur) ?? list[0]).id); if (e.key === "Escape") onClose(); if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const i = list.findIndex((x) => x.id === cur); const n = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; if (n) setCur(n.id); } }} />
          <div className="n-cats"><button type="button" className={!cat ? "on" : ""} onClick={() => setCat("")}>All</button>{CATS.map((c) => <button key={c} type="button" className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}</div>
          <div className="n-list" role="listbox">
            {list.map((x) => <div key={x.id} role="option" aria-selected={x.id === cur} className={`n-li ${x.id === cur ? "on" : ""}`} onClick={() => setCur(x.id)} onDoubleClick={() => onPick(x.id)} data-testid={`dev-${x.id}`}>
              <b>{x.name}</b><span>{x.description}</span><em>{x.spice ? (x.spice.kind === "ignore" ? "no model needed" : "SPICE") : "no model"}</em></div>)}
            {!list.length && <p className="n-dim">No devices match.</p>}
          </div>
        </div>
        {d && <div className="n-picker-r">
          <SymbolPreview device={d.id} dark={dark} />
          <dl className="n-dl"><dt>Device</dt><dd>{d.name}</dd><dt>Category</dt><dd>{d.category}</dd><dt>Prefix</dt><dd>{d.prefix}</dd>{d.mpn && <><dt>Part number</dt><dd>{d.mpn}</dd></>}
            <dt>Simulation</dt><dd>{!d.spice ? "No model — cannot be simulated" : d.spice.kind === "ignore" ? d.spice.reason : d.spice.kind === "element" && d.spice.model ? `SPICE model ${d.spice.model.name}` : d.spice.kind === "subckt" ? `Subcircuit ${d.spice.name}` : "SPICE primitive"}</dd>
            <dt>Footprints</dt><dd>{d.footprints.length ? d.footprints.join(", ") : "None (simulation only)"}</dd></dl>
          {d.modelNote && <p className="n-note">{d.modelNote}</p>}
          <table className="n-tbl"><thead><tr><th>Pin</th><th>Name</th><th>Type</th></tr></thead><tbody>{d.symbol.pins.map((p) => <tr key={p.num}><td>{p.num}</td><td>{p.name}</td><td>{p.type.replace("_", " ")}</td></tr>)}</tbody></table>
        </div>}
      </div>
    </Modal>
  );
}
