// NUCLEUS main window: header + menus, document tabs, toolbox, browser, canvas, inspector, docks, status bar.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StoreProvider, useStore, type DocKind } from "./store";
import { SchematicCanvas, type Tool } from "./schematic/SchematicCanvas";
import { DevicePicker } from "./panels/DevicePicker";
import { Inspector } from "./panels/Inspector";
import { Browser } from "./panels/Browser";
import { Bottom, type BottomTab } from "./panels/Bottom";
import { Bom, bomCsv, bomLines } from "./panels/Bom";
import { Graph, dl } from "./sim/Instruments";
import { useSim } from "./sim/useSim";
import { Menu, Modal, Split, type MenuItem } from "./kit";
import { Logo } from "./Logo";
import { COMMANDS, conflicts, keyOf, loadKeys, saveKeys } from "./shortcuts";
import * as ops from "../schematic/ops";
import { thToMm } from "../core/units";
import type { Pt } from "../core/types";
import { netlistText } from "../connectivity/connectivity";
import { buildSpice } from "../simulation/netlist";
import { APP_VERSION } from "../storage/file";

export function App() { return <StoreProvider><Shell /></StoreProvider>; }
const pref = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(`nucleus-ui-${k}`); return v ? JSON.parse(v) : d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(`nucleus-ui-${k}`, JSON.stringify(v)); } catch { /* ignore */ } };

function Shell() {
  const S = useStore(); const sim = useSim();
  const [dark, setDark] = useState<boolean>(() => pref("dark", true));
  const [sheetDark, setSheetDark] = useState<boolean>(() => pref("sheetDark", false));
  const [tool, setTool] = useState<Tool>({ k: "select" });
  const [picker, setPicker] = useState(false);
  const [picked, setPicked] = useState<string[]>(() => pref("picked", ["RES", "LED-RED", "VSOURCE"]));
  const [left, setLeft] = useState<number>(() => pref("left", 220)); const [right, setRight] = useState<number>(() => pref("right", 280)); const [bottom, setBottom] = useState<number>(() => pref("bottom", 230));
  const [btab, setBtab] = useState<BottomTab>("sim");
  const [grid, setGrid] = useState(100); const [showGrid, setShowGrid] = useState(true); const [mm, setMm] = useState(true);
  const [cursor, setCursor] = useState<Pt | null>(null); const [zoom, setZoom] = useState(0.08); const [fitSig, setFitSig] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [modal, setModal] = useState<"keys" | "about" | "new" | null>(null);
  const [interactive, setInteractive] = useState(false);
  const [keys, setKeys] = useState(loadKeys);
  useEffect(() => { keep("dark", dark); document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  useEffect(() => keep("sheetDark", sheetDark), [sheetDark]); useEffect(() => keep("picked", picked), [picked]);
  useEffect(() => keep("left", left), [left]); useEffect(() => keep("right", right), [right]); useEffect(() => keep("bottom", bottom), [bottom]);
  useEffect(() => { document.title = `${S.dirty ? "• " : ""}${S.pr.name} — NUCLEUS`; }, [S.pr.name, S.dirty]);
  const doc = S.docs.find((d) => d.id === S.active) ?? S.docs[0];
  const runSim = useCallback(async (a = S.pr.sim.analysis) => { setBtab((t) => (t === "erc" || t === "netlist" ? "sim" : t)); const r = await sim.run(a); if (r && r.analysis !== "op") S.openDoc("graph"); }, [sim, S]);
  const onInteract = useCallback(() => { if (interactive) setTimeout(() => sim.run("op"), 0); }, [interactive, sim]);
  const placeDevice = (id: string) => { setPicked((p) => (p.includes(id) ? p : [...p, id])); setTool({ k: "place", device: id }); setPicker(false); if (doc.kind !== "schematic") S.setActive("schematic"); };
  const sel = S.sel;
  const cmds: Record<string, () => void> = {
    "file.new": () => setModal("new"), "file.open": () => S.open(), "file.save": () => S.save(), "file.saveAs": () => S.save(true),
    "edit.undo": S.undo, "edit.redo": S.redo,
    "edit.delete": () => { if (sel.size) { S.change((p) => ops.deleteItems(p, sel), "Delete"); S.setSel(new Set()); } },
    "edit.duplicate": () => { if (!sel.size) return; let ids: string[] = []; S.change((p) => { const r = ops.duplicate(p, sel, [400, 400]); ids = r.ids; return r.pr; }, "Duplicate"); S.setSel(new Set(ids)); },
    "edit.selectAll": () => S.setSel(new Set([...S.pr.parts, ...S.pr.wires, ...S.pr.labels, ...S.pr.probes].filter((x) => x.sheet === S.sheet).map((x) => x.id))),
    "edit.rotate": () => sel.size && S.change((p) => ops.rotateParts(p, sel), "Rotate"), "edit.rotateCw": () => sel.size && S.change((p) => ops.rotateParts(p, sel, false), "Rotate"),
    "edit.mirror": () => sel.size && S.change((p) => ops.mirrorParts(p, sel), "Mirror"),
    "place.component": () => setPicker(true), "place.wire": () => setTool({ k: "wire" }), "place.label": () => setTool({ k: "label", kind: "net" }), "place.select": () => setTool({ k: "select" }),
    "view.grid": () => setShowGrid((g) => !g), "view.units": () => setMm((m) => !m),
    "design.erc": () => { const f = S.runErc(); setBtab("erc"); S.say(`${f.filter((x) => x.severity === "error").length} errors, ${f.filter((x) => x.severity === "warning").length} warnings`, f.some((x) => x.severity === "error") ? "error" : "ok"); },
    "sim.run": () => runSim(), "sim.stop": sim.stop, "help.keys": () => setModal("keys"),
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select") || document.querySelector(".n-modal") || picker) return;
      const k = keyOf(e);
      const c = COMMANDS.find((x) => keys[x.id] === k && (x.scope === "global" || doc.kind === "schematic"));
      if (!c) return;
      if (tool.k === "place" && (k === "R" || k === "X")) return; // rotating the part being placed
      e.preventDefault(); cmds[c.id]?.();
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });
  const k = (id: string) => keys[id];
  const MENUS: Record<string, MenuItem[]> = {
    File: [{ label: "New project…", key: k("file.new"), onClick: cmds["file.new"] }, { label: "Open…", key: k("file.open"), onClick: cmds["file.open"] }, { label: "Save", key: k("file.save"), onClick: cmds["file.save"] }, { label: "Save as…", key: k("file.saveAs"), onClick: cmds["file.saveAs"] }, { sep: true, label: "" },
      { label: "Export netlist (text)", onClick: () => dl(`${S.pr.name}.net.txt`, netlistText(S.pr, S.con), "text/plain") }, { label: "Export SPICE deck (.cir)", onClick: () => dl(`${S.pr.name}.cir`, buildSpice(S.pr, S.con).text, "text/plain") },
      { label: "Export schematic PDF", disabled: "planned" }],
    Edit: [{ label: `Undo ${S.lastLabel}`, key: k("edit.undo"), onClick: S.undo, disabled: !S.canUndo }, { label: "Redo", key: k("edit.redo"), onClick: S.redo, disabled: !S.canRedo }, { sep: true, label: "" },
      { label: "Rotate", key: k("edit.rotate"), onClick: cmds["edit.rotate"], disabled: !sel.size }, { label: "Mirror", key: k("edit.mirror"), onClick: cmds["edit.mirror"], disabled: !sel.size }, { label: "Duplicate", key: k("edit.duplicate"), onClick: cmds["edit.duplicate"], disabled: !sel.size },
      { label: "Delete", key: k("edit.delete"), onClick: cmds["edit.delete"], disabled: !sel.size }, { label: "Select all", key: k("edit.selectAll"), onClick: cmds["edit.selectAll"] }],
    View: [{ label: "Zoom to fit", key: "F8", onClick: () => setFitSig((n) => n + 1) }, { label: "Grid", key: k("view.grid"), checked: showGrid, onClick: cmds["view.grid"] }, ...[50, 100, 200].map((g) => ({ label: `Snap ${g} th (${thToMm(g).toFixed(2)} mm)`, checked: grid === g, onClick: () => setGrid(g) })),
      { label: mm ? "Show thou" : "Show millimetres", key: k("view.units"), onClick: cmds["view.units"] }, { sep: true, label: "" }, { label: "Dark interface", checked: dark, onClick: () => setDark(!dark) }, { label: "Dark schematic sheet", checked: sheetDark, onClick: () => setSheetDark(!sheetDark) },
      { label: left ? "Hide object browser" : "Show object browser", onClick: () => setLeft(left ? 0 : 220) }, { label: right ? "Hide inspector" : "Show inspector", onClick: () => setRight(right ? 0 : 280) }, { label: bottom ? "Hide bottom dock" : "Show bottom dock", onClick: () => setBottom(bottom ? 0 : 230) }],
    Place: [{ label: "Component…", key: k("place.component"), onClick: cmds["place.component"] }, { label: "Wire", key: k("place.wire"), onClick: cmds["place.wire"] }, { label: "Net label", key: k("place.label"), onClick: cmds["place.label"] },
      { label: "Power terminal", onClick: () => setTool({ k: "label", kind: "power" }) }, { label: "Ground terminal", onClick: () => setTool({ k: "label", kind: "ground" }) }, { label: "Voltage probe", onClick: () => setTool({ k: "probe" }) }],
    Design: [{ label: "Annotate (fill in missing references)", onClick: () => S.change((p) => ops.annotate(p), "Annotate") }, { label: "Re-annotate all", onClick: () => S.change((p) => ops.annotate(p, true), "Re-annotate") }, { label: "Electrical rule check", key: k("design.erc"), onClick: cmds["design.erc"] },
      { label: "Show netlist", onClick: () => setBtab("netlist") }, { label: "Bill of materials", onClick: () => S.openDoc("bom") }],
    Simulation: [{ label: "Run (current analysis)", key: k("sim.run"), onClick: () => runSim() }, { label: "Run DC operating point", onClick: () => runSim("op") }, { label: "Run transient", onClick: () => runSim("tran") }, { label: "Run AC sweep", onClick: () => runSim("ac") }, { label: "Run DC sweep", onClick: () => runSim("dc") },
      { label: "Stop", key: k("sim.stop"), onClick: sim.stop, disabled: sim.state !== "running" }, { sep: true, label: "" }, { label: "Interactive (re-solve when a switch or pot changes)", checked: interactive, onClick: () => setInteractive(!interactive) }, { label: "Instruments", onClick: () => setBtab("instruments") }, { label: "Analysis graph", onClick: () => S.openDoc("graph") }],
    PCB: [{ label: "PCB layout (next milestone)", disabled: "not built yet" }],
    Library: [{ label: "Pick devices…", key: "P", onClick: () => setPicker(true) }, { label: "Symbol editor", disabled: "planned" }, { label: "Footprint editor", disabled: "planned" }],
    Manufacturing: [{ label: "Bill of materials", onClick: () => S.openDoc("bom") }, { label: "Export BOM CSV", onClick: () => dl(`${S.pr.name}-BOM.csv`, bomCsv(bomLines(S.pr))) }, { label: "Gerber / drill", disabled: "needs PCB layout" }],
    Tools: [{ label: "Keyboard shortcuts…", key: k("help.keys"), onClick: () => setModal("keys") }],
    Window: S.docs.map((d) => ({ label: d.title, checked: d.id === S.active, onClick: () => S.setActive(d.id) })),
    Help: [{ label: "Keyboard shortcuts", onClick: () => setModal("keys") }, { label: "About NUCLEUS", onClick: () => setModal("about") }],
  };
  const fmt = (v: number) => (mm ? `${thToMm(v).toFixed(2)}` : `${Math.round(v)}`);
  const errs = S.findings?.filter((f) => f.severity === "error").length ?? 0, warns = S.findings?.filter((f) => f.severity === "warning").length ?? 0;
  const TOOLS: { t: Tool; key: string; label: string; icon: ReactNode }[] = [
    { t: { k: "select" }, key: "S", label: "Selection", icon: <Ico d="M5 3l12 8-5 1.5L15 19l-2.5 1-3-6.5L5 17z" /> },
    { t: { k: "place", device: picked[0] ?? "RES" }, key: "P", label: "Component", icon: <Ico d="M3 12h4m10 0h4M7 9h10v6H7z" /> },
    { t: { k: "wire" }, key: "W", label: "Wire", icon: <Ico d="M3 18h7V6h11" dots /> },
    { t: { k: "label", kind: "net" }, key: "L", label: "Net label", icon: <Ico d="M4 8h11l5 4-5 4H4z" /> },
    { t: { k: "label", kind: "power" }, key: "", label: "Power terminal", icon: <Ico d="M12 21V9M6 9h12M9 5l3-3 3 3" /> },
    { t: { k: "label", kind: "ground" }, key: "", label: "Ground terminal", icon: <Ico d="M12 3v9M5 12h14M8 16h8M11 20h2" /> },
    { t: { k: "probe" }, key: "", label: "Voltage probe", icon: <Ico d="M4 20l5-5m-2-4l6 6 7-13-13 7z" /> },
  ];
  return (
    <div className={`n-app ${dark ? "dark" : "light"}`}>
      <header className="n-head">
        <div className="n-brand"><Logo size={20} /><b>NUCLEUS</b></div>
        <nav className="n-menubar">{Object.keys(MENUS).map((m) => <button key={m} type="button" onClick={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 2, items: MENUS[m] }); }} data-testid={`menu-${m}`}>{m}</button>)}</nav>
        <div className="n-proj"><b>{S.pr.name}</b><span className="n-dim">rev {S.pr.revision} · {S.fileName ?? "not saved yet"}</span><span className={`n-save ${S.dirty ? "dirty" : ""}`}>{S.dirty ? "● unsaved" : "saved"}</span></div>
        <div className="n-qa">
          <button type="button" className="n-ib" onClick={S.undo} disabled={!S.canUndo} title={`Undo ${S.lastLabel} (${k("edit.undo")})`}>↶</button><button type="button" className="n-ib" onClick={S.redo} disabled={!S.canRedo} title={`Redo (${k("edit.redo")})`}>↷</button>
          <button type="button" className="n-ib" onClick={() => S.save()} title={`Save (${k("file.save")})`} data-testid="save">💾</button>
        </div>
      </header>
      <div className="n-tabsbar">{S.docs.map((d, i) => <div key={d.id} className={`n-doctab ${d.id === S.active ? "on" : ""}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/doc", d.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("text/doc"); if (id) S.moveDoc(id, i); }} onClick={() => S.setActive(d.id)} data-testid={`doc-${d.kind}`}>
        <span>{d.title}</span>{S.docs.length > 1 && <button type="button" onClick={(e) => { e.stopPropagation(); S.closeDoc(d.id); }} aria-label={`Close ${d.title}`}>×</button>}</div>)}
        <button type="button" className="n-addtab" onClick={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom, items: (["schematic", "graph", "bom", "pcb"] as DocKind[]).map((kd) => ({ label: kd === "pcb" ? "PCB Layout" : kd === "graph" ? "Analysis graph" : kd === "bom" ? "Bill of materials" : "Schematic", onClick: () => S.openDoc(kd) })) }); }} title="Open a document">+</button>
        <div className="n-transport" data-testid="transport">
          <select className="n-in" value={S.pr.sim.analysis} onChange={(e) => S.change((p) => ({ ...p, sim: { ...p.sim, analysis: e.target.value as typeof p.sim.analysis } }), "Analysis")} title="Analysis"><option value="op">DC op. point</option><option value="tran">Transient</option><option value="ac">AC sweep</option><option value="dc">DC sweep</option></select>
          <button type="button" className="n-ib play" onClick={() => runSim()} disabled={sim.state === "running" || sim.state === "starting"} title={`Run (${k("sim.run")})`} data-testid="sim-run">▶</button>
          <button type="button" className="n-ib" onClick={sim.stop} disabled={sim.state !== "running" && sim.state !== "starting"} title="Stop (Shift+F5)">■</button>
          <button type="button" className="n-ib" onClick={sim.reset} disabled={!S.sim} title="Clear results">⟲</button>
          <span className={`n-simstate ${sim.state}`} data-testid="sim-state">{{ idle: "Ready", starting: "Loading engine…", running: "Solving…", done: `Solved${sim.ms !== null ? ` ${sim.ms} ms` : ""}`, failed: "Failed — see log", stopped: "Stopped" }[sim.state]}</span>
        </div>
      </div>
      <div className="n-body" style={{ gridTemplateColumns: `38px ${left}px 1fr ${right}px` }}>
        <div className="n-toolbox" role="toolbar" aria-label="Tools">{TOOLS.map((x) => { const on = tool.k === x.t.k && (x.t.k !== "label" || (tool.k === "label" && tool.kind === (x.t as { kind: string }).kind)); return <button key={x.label} type="button" className={`n-tool ${on ? "on" : ""}`} title={`${x.label}${x.key ? ` (${x.key})` : ""}`} aria-label={x.label} onClick={() => (x.t.k === "place" ? setPicker(true) : setTool(x.t))} data-testid={`tool-${x.label.split(" ")[0].toLowerCase()}`} disabled={doc.kind !== "schematic"}>{x.icon}</button>; })}</div>
        <aside className="n-left" style={{ display: left ? undefined : "none" }}><Browser picked={picked} dark={dark} onPick={() => setPicker(true)} onPlace={(id) => setTool({ k: "place", device: id })} /><Split side="left" size={left} setSize={setLeft} /></aside>
        <main className="n-center">
          <div className="n-doc">
            {doc.kind === "schematic" && <SchematicCanvas tool={tool} setTool={setTool} dark={sheetDark} grid={grid} showGrid={showGrid} onCursor={setCursor} onZoom={setZoom} interactive={interactive} onInteract={onInteract} fitSignal={fitSig} onMenu={(x, y, items) => setMenu({ x, y, items })} />}
            {doc.kind === "graph" && <Graph dark={dark} />}
            {doc.kind === "bom" && <Bom />}
            {doc.kind === "pcb" && <div className="n-pad"><h3>PCB layout</h3><p>Not built yet — it is the next milestone (board outline, footprints, netlist transfer, two-layer routing, vias, DRC, Gerber/Excellon). This tab does nothing until then.</p></div>}
          </div>
          {bottom > 0 && <div className="n-dock" style={{ height: bottom }}><Split side="bottom" size={bottom} setSize={setBottom} min={120} max={600} /><Bottom tab={btab} setTab={setBtab} sim={sim} dark={dark} /></div>}
        </main>
        <aside className="n-right" style={{ display: right ? undefined : "none" }}><Split side="right" size={right} setSize={setRight} /><Inspector interactive={interactive} onInteract={onInteract} /></aside>
      </div>
      <footer className="n-status" data-testid="statusbar">
        <span>{doc.kind === "schematic" ? (tool.k === "select" ? "Select" : tool.k === "place" ? `Place ${tool.device}` : tool.k === "wire" ? "Wire" : tool.k === "probe" ? "Probe" : tool.k === "label" ? `${tool.kind} label` : "Note") : doc.title}</span>
        <span className="mono">{cursor ? `X ${fmt(cursor[0])}  Y ${fmt(cursor[1])} ${mm ? "mm" : "th"}` : "—"}</span>
        <span>Grid {mm ? `${thToMm(grid).toFixed(2)} mm` : `${grid} th`}{showGrid ? "" : " (hidden)"}</span><span>Zoom {Math.round(zoom * 1000) / 10}%</span>
        <span>{S.pr.parts.length} parts · {S.con.nets.filter((n) => n.pins.length).length} nets</span>
        <span className="n-grow" />
        {interactive && <span className="n-pill">Interactive</span>}
        <button type="button" className={`n-erc-btn ${errs ? "err" : warns ? "warn" : S.findings ? "ok" : ""}`} onClick={() => { if (!S.findings) S.runErc(); setBtab("erc"); if (!bottom) setBottom(230); }} data-testid="erc-counter">ERC {S.findings ? `${errs} errors · ${warns} warnings` : "not run"}</button>
        {S.message && <span className={`n-msg ${S.message.tone}`} data-testid="message">{S.message.text}</span>}
      </footer>
      {menu && <Menu at={menu} items={menu.items} onClose={() => setMenu(null)} />}
      {picker && <DevicePicker dark={dark} onClose={() => setPicker(false)} onPick={placeDevice} />}
      {modal === "keys" && <Keys keys={keys} setKeys={(n) => { setKeys(n); saveKeys(n); }} onClose={() => setModal(null)} />}
      {modal === "about" && <Modal title="About NUCLEUS" onClose={() => setModal(null)}><div className="n-about"><Logo size={40} /><div><b>NUCLEUS {APP_VERSION}</b><p>Electronics design, simulation and PCB engineering.</p><p className="n-dim">Simulation: ngspice 45 (BSD licence) compiled to WebAssembly via EEcircuit-engine (MIT). Runs entirely on this computer.</p></div></div></Modal>}
      {modal === "new" && <NewProject onClose={() => setModal(null)} onCreate={(n) => { S.newFile(n); setModal(null); }} />}
    </div>
  );
}
function Ico({ d, dots }: { d: string; dots?: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} />{dots && <circle cx="10" cy="18" r="1.6" fill="currentColor" />}</svg>; }
function NewProject({ onClose, onCreate }: { onClose: () => void; onCreate: (n: string) => void }) {
  const [n, setN] = useState("New project");
  return <Modal title="New project" onClose={onClose} foot={<><button type="button" className="n-btn" onClick={onClose}>Cancel</button><button type="button" className="n-btn primary" onClick={() => onCreate(n.trim() || "New project")} data-testid="new-ok">Create</button></>}>
    <label className="n-field"><span>Project name</span><input className="n-in" autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onCreate(n.trim() || "New project"); }} data-testid="new-name" /></label>
    <p className="n-dim">Starts with one A4 schematic sheet. The current design is replaced — save it first if needed.</p></Modal>;
}
function Keys({ keys, setKeys, onClose }: { keys: Record<string, string>; setKeys: (k: Record<string, string>) => void; onClose: () => void }) {
  const [rec, setRec] = useState<string | null>(null);
  useEffect(() => { if (!rec) return; const h = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return; setKeys({ ...keys, [rec]: e.key === "Escape" ? keys[rec] : keyOf(e) }); setRec(null); }; window.addEventListener("keydown", h, true); return () => window.removeEventListener("keydown", h, true); }, [rec, keys, setKeys]);
  const c = conflicts(keys);
  return <Modal title="Keyboard shortcuts" wide onClose={onClose} foot={<><button type="button" className="n-btn" onClick={() => setKeys(Object.fromEntries(COMMANDS.map((x) => [x.id, x.keys])))}>Restore defaults</button><button type="button" className="n-btn primary" onClick={onClose}>Done</button></>}>
    <table className="n-tbl"><thead><tr><th>Command</th><th>Applies in</th><th>Key</th></tr></thead><tbody>{COMMANDS.map((x) => <tr key={x.id}><td>{x.label}</td><td className="n-dim">{x.scope}</td><td><button type="button" className="n-btn small mono" onClick={() => setRec(x.id)}>{rec === x.id ? "press a key…" : keys[x.id]}</button></td></tr>)}
      <tr><td>Zoom in / out / fit</td><td className="n-dim">schematic</td><td className="mono">F6 / F7 / F8, mouse wheel</td></tr><tr><td>Pan</td><td className="n-dim">schematic</td><td className="mono">middle mouse or Alt+drag</td></tr></tbody></table>
    {c.length > 0 && <p className="n-err">Conflicts: {c.join("; ")}</p>}</Modal>;
}
