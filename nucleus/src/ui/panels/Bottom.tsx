// Bottom dock: simulation control + log, ERC diagnostics, netlist / SPICE deck, instruments.
import { useStore } from "../store";
import type { SimApi } from "../sim/useSim";
import { Multimeter, Scope, dl } from "../sim/Instruments";
import { netlistText } from "../../connectivity/connectivity";
import { ERC_RULES } from "../../erc/erc";
import type { AnalysisKind } from "../../core/types";
import { buildSpice } from "../../simulation/netlist";

export type BottomTab = "sim" | "instruments" | "erc" | "netlist";
export function Bottom({ tab, setTab, sim, dark }: { tab: BottomTab; setTab: (t: BottomTab) => void; sim: SimApi; dark: string }) {
  const S = useStore();
  const errs = S.findings?.filter((f) => f.severity === "error").length ?? 0, warns = S.findings?.filter((f) => f.severity === "warning").length ?? 0;
  return (
    <div className="n-bottom">
      <div className="n-btabs h">
        <button type="button" className={tab === "sim" ? "on" : ""} onClick={() => setTab("sim")} data-testid="tab-sim">Simulation</button>
        <button type="button" className={tab === "instruments" ? "on" : ""} onClick={() => setTab("instruments")} data-testid="tab-instruments">Instruments</button>
        <button type="button" className={tab === "erc" ? "on" : ""} onClick={() => setTab("erc")} data-testid="tab-erc">Rule check {S.findings ? <span className={`n-cnt ${errs ? "err" : warns ? "warn" : "ok"}`}>{errs} / {warns}</span> : null}</button>
        <button type="button" className={tab === "netlist" ? "on" : ""} onClick={() => setTab("netlist")}>Netlist</button>
      </div>
      <div className="n-bottom-b">
        {tab === "sim" && <SimPanel sim={sim} />}
        {tab === "instruments" && <div className="n-instr"><Multimeter sim={sim} /><Scope dark={dark} sim={sim} /></div>}
        {tab === "erc" && <ErcPanel />}
        {tab === "netlist" && <NetlistPanel />}
      </div>
    </div>
  );
}
function SimPanel({ sim }: { sim: SimApi }) {
  const S = useStore(); const c = S.pr.sim;
  const set = (patch: Partial<typeof c>) => S.change((p) => ({ ...p, sim: { ...p.sim, ...patch } }), "Simulation settings");
  return (
    <div className="n-simp">
      <div className="n-simset">
        <label>Analysis <select className="n-in" value={c.analysis} onChange={(e) => set({ analysis: e.target.value as AnalysisKind })} data-testid="sim-analysis">
          <option value="op">DC operating point</option><option value="tran">Transient</option><option value="ac">AC small-signal</option><option value="dc">DC sweep</option></select></label>
        {c.analysis === "tran" && <><label>Stop <input className="n-in mono" value={c.tran.stop} onChange={(e) => set({ tran: { ...c.tran, stop: e.target.value } })} /></label><label>Max step <input className="n-in mono" value={c.tran.step} onChange={(e) => set({ tran: { ...c.tran, step: e.target.value } })} /></label><label><input type="checkbox" checked={c.tran.uic} onChange={(e) => set({ tran: { ...c.tran, uic: e.target.checked } })} /> Start from zero (UIC)</label></>}
        {c.analysis === "ac" && <><label>Sweep <select className="n-in" value={c.ac.type} onChange={(e) => set({ ac: { ...c.ac, type: e.target.value as "dec" } })}><option value="dec">decade</option><option value="oct">octave</option><option value="lin">linear</option></select></label><label>Points <input className="n-in mono" value={c.ac.points} onChange={(e) => set({ ac: { ...c.ac, points: Number(e.target.value) || 10 } })} /></label><label>From <input className="n-in mono" value={c.ac.fstart} onChange={(e) => set({ ac: { ...c.ac, fstart: e.target.value } })} /></label><label>To <input className="n-in mono" value={c.ac.fstop} onChange={(e) => set({ ac: { ...c.ac, fstop: e.target.value } })} /></label></>}
        {c.analysis === "dc" && <><label>Source <select className="n-in" value={c.dc.source} onChange={(e) => set({ dc: { ...c.dc, source: e.target.value } })}><option value="">choose…</option>{S.pr.parts.filter((p) => p.device === "VSOURCE" || p.device === "ISOURCE").map((p) => <option key={p.id}>{p.ref}</option>)}</select></label><label>From <input className="n-in mono" value={c.dc.start} onChange={(e) => set({ dc: { ...c.dc, start: e.target.value } })} /></label><label>To <input className="n-in mono" value={c.dc.stop} onChange={(e) => set({ dc: { ...c.dc, stop: e.target.value } })} /></label><label>Step <input className="n-in mono" value={c.dc.step} onChange={(e) => set({ dc: { ...c.dc, step: e.target.value } })} /></label></>}
        <label>Temp °C <input className="n-in mono" value={c.temp} onChange={(e) => set({ temp: Number(e.target.value) || 27 })} style={{ width: 54 }} /></label>
        <button type="button" className="n-btn small" onClick={sim.clearLog}>Clear log</button>
      </div>
      <div className="n-log" data-testid="sim-log">{sim.log.map((l, i) => <div key={i} className={`n-logl ${l.level}`} onClick={() => { const p = S.pr.parts.find((x) => x.id === l.part); if (p) S.focusOn({ sheet: p.sheet, at: p.at, id: p.id }); }}><span>{l.at.slice(11, 19)}</span>{l.text}</div>)}{!sim.log.length && <div className="n-dim">Engine: ngspice 45 (WebAssembly, runs locally — no internet needed). Press F5 or ▶ to run.</div>}</div>
    </div>
  );
}
function ErcPanel() {
  const S = useStore(); const f = S.findings;
  return (
    <div className="n-erc" data-testid="erc-panel">
      <div className="n-row"><button type="button" className="n-btn small primary" onClick={() => { const r = S.runErc(); S.say(r.length ? `${r.filter((x) => x.severity === "error").length} errors, ${r.filter((x) => x.severity === "warning").length} warnings` : "No electrical rule problems", r.some((x) => x.severity === "error") ? "error" : "ok"); }} data-testid="run-erc">Run ERC</button>
        <span className="n-dim">{f ? `${f.length} finding${f.length === 1 ? "" : "s"} · rules: ${Object.keys(ERC_RULES).length}` : "Not run yet"}</span></div>
      <table className="n-tbl n-erct"><thead><tr><th>Severity</th><th>Rule</th><th>Where</th><th>Description</th><th>Suggestion</th><th /></tr></thead>
        <tbody>{f?.map((x) => { const p = S.pr.parts.find((q) => q.id === x.part); return (
          <tr key={x.id} className={x.severity} onClick={() => S.focusOn({ sheet: x.sheet, at: x.at, id: x.part ?? x.wire ?? x.label })} data-testid="erc-row">
            <td><span className={`n-sev ${x.severity}`}>{x.severity}</span></td><td>{ERC_RULES[x.rule].label}</td><td className="mono">{p?.ref ?? x.net ?? ""}</td><td>{x.message}</td><td className="n-dim">{x.fix ?? ""}</td>
            <td><button type="button" className="n-link" onClick={(e) => { e.stopPropagation(); S.change((pr) => ({ ...pr, settings: { ...pr.settings, ercIgnore: [...pr.settings.ercIgnore, x.rule] } }), "Ignore ERC rule"); S.runErc(); }} title="Stop reporting this rule for the project">ignore rule</button></td></tr>); })}
          {f && !f.length && <tr><td colSpan={6} className="n-ok">No problems found.</td></tr>}</tbody></table>
      {S.pr.settings.ercIgnore.length > 0 && <p className="n-dim">Ignored rules: {S.pr.settings.ercIgnore.map((r) => ERC_RULES[r]?.label ?? r).join(", ")} · <button type="button" className="n-link" onClick={() => S.change((pr) => ({ ...pr, settings: { ...pr.settings, ercIgnore: [] } }), "Restore ERC rules")}>restore all</button></p>}
    </div>
  );
}
function NetlistPanel() {
  const S = useStore(); const text = netlistText(S.pr, S.con); const deck = buildSpice(S.pr, S.con).text;
  return <div className="n-netl"><div><div className="n-row"><b>Netlist</b><button type="button" className="n-btn small" onClick={() => dl(`${S.pr.name}.net.txt`, text, "text/plain")}>Export</button></div><pre className="mono">{text || "(empty)"}</pre></div>
    <div><div className="n-row"><b>SPICE deck</b><button type="button" className="n-btn small" onClick={() => dl(`${S.pr.name}.cir`, deck, "text/plain")}>Export .cir</button></div><pre className="mono" data-testid="spice-deck">{deck}</pre></div></div>;
}
