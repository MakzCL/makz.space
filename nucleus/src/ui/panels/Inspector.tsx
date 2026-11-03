// Context-sensitive properties. Every field writes to the model through an undoable change.
import { useStore } from "../store";
import { device } from "../../library/devices";
import * as ops from "../../schematic/ops";
import { Edit, Field } from "../kit";
import { parseValue, formatEng, thToMm } from "../../core/units";
import { partBox } from "../../core/geom";

export function Inspector({ interactive, onInteract }: { interactive: boolean; onInteract: () => void }) {
  const S = useStore(); const { pr, sel, con } = S;
  const ids = [...sel];
  if (!ids.length) return <SheetProps />;
  if (ids.length > 1) return <div className="n-insp"><h4>{ids.length} objects selected</h4><p className="n-dim">Move, rotate (R), mirror (X), duplicate (Ctrl+D) or delete them together.</p></div>;
  const id = ids[0];
  const part = pr.parts.find((p) => p.id === id);
  if (part) {
    const d = device(part.device);
    return (
      <div className="n-insp" data-testid="inspector">
        <h4>{part.ref} <span className="n-dim">· {d.name}</span></h4>
        <Field label="Reference"><Edit first value={part.ref} testid="prop-ref" invalid={(v) => (!/^[A-Za-z]+\d*$/.test(v) ? "Letters then a number, e.g. R1" : pr.parts.some((p) => p.ref === v && p.id !== part.id) ? `${v} is already used` : null)} onCommit={(v) => S.change((p) => ops.setProps(p, part.id, {}, v), "Reference")} /></Field>
        {d.props.map((pd) => (
          <Field key={pd.key} label={`${pd.label}${pd.unit ? ` (${pd.unit})` : ""}`} hint={pd.kind === "value" && part.props[pd.key] && parseValue(part.props[pd.key]) !== null ? `= ${formatEng(parseValue(part.props[pd.key])!, pd.unit ?? "", 4)}` : undefined}>
            {pd.key === "footprint" ? (
              <select className="n-in" value={part.props.footprint ?? ""} data-testid="prop-footprint" onChange={(e) => S.change((p) => ops.setProps(p, part.id, { footprint: e.target.value || undefined }), "Footprint")}>
                <option value="">— none —</option>{d.footprints.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            ) : <Edit value={part.props[pd.key] ?? ""} testid={`prop-${pd.key}`} mono={pd.kind === "value"} invalid={(v) => (pd.required && !v.trim() ? "Required" : pd.kind === "value" && v.trim() && parseValue(v) === null ? "Not a number (e.g. 4k7, 100n, 2.2u, 1meg)" : null)}
              onCommit={(v) => S.change((p) => ops.setProps(p, part.id, { [pd.key]: v.trim() || undefined }), pd.label)} />}
          </Field>
        ))}
        {d.interactive === "switch" && <Field label="State"><button type="button" className="n-btn" data-testid="toggle-switch" onClick={() => { S.change((p) => ops.setState(p, part.id, { closed: !part.state?.closed }), "Switch"); if (interactive) onInteract(); }}>{part.state?.closed ? "Closed — click to open" : "Open — click to close"}</button></Field>}
        {d.interactive === "pot" && <Field label={`Wiper position ${Math.round((part.state?.position ?? 0.5) * 100)} %`}><input type="range" min={0} max={100} value={Math.round((part.state?.position ?? 0.5) * 100)} onChange={(e) => S.change((p) => ops.setState(p, part.id, { position: Number(e.target.value) / 100 }), "Wiper")} onPointerUp={() => interactive && onInteract()} /></Field>}
        <h5>Placement</h5>
        <dl className="n-dl"><dt>Position</dt><dd>{thToMm(part.at[0]).toFixed(2)}, {thToMm(part.at[1]).toFixed(2)} mm</dd><dt>Rotation</dt><dd>{part.rot}°{part.mirror ? ", mirrored" : ""}</dd><dt>Size</dt><dd>{(() => { const b = partBox(part); return `${thToMm(b.x1 - b.x0).toFixed(1)} × ${thToMm(b.y1 - b.y0).toFixed(1)} mm`; })()}</dd></dl>
        <h5>Pins</h5>
        <table className="n-tbl"><thead><tr><th>Pin</th><th>Name</th><th>Net</th></tr></thead><tbody>{d.symbol.pins.map((p) => <tr key={p.num}><td>{p.num}</td><td>{p.name}</td><td className="mono">{con.pinNet.get(`${part.id}:${p.num}`) ?? "—"}</td></tr>)}</tbody></table>
        <h5>Library</h5>
        <dl className="n-dl"><dt>Device</dt><dd>{d.id} (library v{d.libVersion})</dd><dt>Model</dt><dd>{!d.spice ? "none" : d.spice.kind === "element" && d.spice.model ? d.spice.model.name : d.spice.kind === "subckt" ? d.spice.name : d.spice.kind}</dd></dl>
        {d.modelNote && <p className="n-note">{d.modelNote}</p>}
      </div>
    );
  }
  const wire = pr.wires.find((w) => w.id === id);
  if (wire) { const net = con.wireNet.get(wire.id); const n = con.nets.find((x) => x.name === net); let len = 0; for (let i = 1; i < wire.pts.length; i++) len += Math.abs(wire.pts[i][0] - wire.pts[i - 1][0]) + Math.abs(wire.pts[i][1] - wire.pts[i - 1][1]);
    return <div className="n-insp"><h4>Wire</h4><dl className="n-dl"><dt>Net</dt><dd className="mono">{net}</dd><dt>Segments</dt><dd>{wire.pts.length - 1}</dd><dt>Length</dt><dd>{thToMm(len).toFixed(2)} mm</dd><dt>Connects</dt><dd>{n?.pins.map((p) => `${p.ref}.${p.pin}`).join(", ") || "no pins"}</dd></dl>
      {S.sim && net && S.sim.netV.get(net) && S.sim.analysis === "op" && <p className="n-meas">V({net}) = {formatEng(S.sim.netV.get(net)!.re[0], "V", 5)}</p>}</div>; }
  const label = pr.labels.find((l) => l.id === id);
  if (label) return <div className="n-insp"><h4>{label.kind === "ground" ? "Ground terminal" : label.kind === "power" ? "Power terminal" : "Net label"}</h4>
    {label.kind !== "ground" && <Field label="Net name"><Edit first value={label.name} invalid={(v) => (!/^[A-Za-z0-9_+\-.$/#]+$/.test(v) ? "Letters, digits and _ + - . / # only" : null)} onCommit={(v) => S.change((p) => ({ ...p, labels: p.labels.map((l) => (l.id === id ? { ...l, name: v } : l)) }), "Rename net")} /></Field>}
    <dl className="n-dl"><dt>Net</dt><dd className="mono">{con.labelNet.get(id)}</dd></dl></div>;
  const probe = pr.probes.find((p) => p.id === id);
  if (probe) return <div className="n-insp"><h4>Voltage probe</h4><Field label="Name"><Edit first value={probe.name} onCommit={(v) => S.change((p) => ({ ...p, probes: p.probes.map((x) => (x.id === id ? { ...x, name: v } : x)) }), "Probe name")} /></Field><p className="n-dim">Shows the node voltage after a DC operating point (or the last value of a transient run).</p></div>;
  return null;
}
function SheetProps() {
  const S = useStore(); const sh = S.pr.sheets.find((s) => s.id === S.sheet)!;
  const upd = (patch: Partial<typeof sh>) => S.change((p) => ({ ...p, sheets: p.sheets.map((s) => (s.id === sh.id ? { ...s, ...patch } : s)) }), "Sheet");
  return (
    <div className="n-insp"><h4>Sheet · {sh.name}</h4>
      <Field label="Project name"><Edit value={S.pr.name} onCommit={(v) => v.trim() && S.change((p) => ({ ...p, name: v.trim() }), "Rename project")} /></Field>
      <Field label="Sheet name"><Edit value={sh.name} onCommit={(v) => upd({ name: v })} /></Field>
      <Field label="Title"><Edit value={sh.title} onCommit={(v) => upd({ title: v })} /></Field>
      <Field label="Revision"><Edit value={sh.revision} onCommit={(v) => upd({ revision: v })} /></Field>
      <Field label="Author"><Edit value={sh.author} onCommit={(v) => upd({ author: v })} /></Field>
      <Field label="Size"><select className="n-in" value={sh.size} onChange={(e) => upd({ size: e.target.value as typeof sh.size })}><option>A4</option><option>A3</option><option>A2</option></select></Field>
      <p className="n-dim">Select an object to see its properties.</p>
    </div>
  );
}
