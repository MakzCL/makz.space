import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Session, COMMANDS, newDrawing, type Drawing } from "../core/cad";
import { bbox, boxOf, distTo, fmt, deg, dist, type Ent, type V, type SnapKind } from "../core/geom";
import { readDxf, readNative, writeDxf, writeNative, writeSvg } from "../core/dxf";
import { draw, rubber, toWorld, type Palette, type View } from "./render";
import { Logo } from "./Logo";

const KEY = "cadra.autosave", PREF = "cadra.prefs";
const pref = <T,>(k: string, d: T): T => { try { return (JSON.parse(localStorage.getItem(PREF) ?? "{}")[k] as T) ?? d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { const o = JSON.parse(localStorage.getItem(PREF) ?? "{}"); o[k] = v; localStorage.setItem(PREF, JSON.stringify(o)); } catch { /* private mode */ } };
const restore = (): Drawing | undefined => { try { const s = localStorage.getItem(KEY); return s ? readNative(s) : undefined; } catch { return undefined; } };

const TOOLS: { group: string; items: [string, string, string][] }[] = [ // [command, label, icon path]
  { group: "Draw", items: [["LINE", "Line (L)", "M4 20 20 4"], ["PLINE", "Polyline (PL)", "M3 19 9 7l6 8 6-10"], ["CIRCLE", "Circle (C)", "M12 4a8 8 0 1 0 0.01 0Z"], ["ARC", "Arc, 3 points (A)", "M4 18A10 10 0 0 1 20 18"], ["RECTANG", "Rectangle (REC)", "M4 6h16v12H4Z"], ["POLYGON", "Polygon (POL)", "M12 3l8 6-3 10H7L4 9Z"], ["TEXT", "Text (T)", "M5 5h14M12 5v14"], ["HATCH", "Hatch (H)", "M4 4h16v16H4ZM4 12 12 4M4 20 20 4M12 20l8-8"]] },
  { group: "Modify", items: [["MOVE", "Move (M)", "M12 3v18M3 12h18M12 3l-3 3m3-3 3 3M12 21l-3-3m3 3 3-3"], ["COPY", "Copy (CO)", "M8 8h12v12H8ZM4 4h12v2M4 4v12h2"], ["ROTATE", "Rotate (RO)", "M19 12a7 7 0 1 1-2-5m2-3v4h-4"], ["SCALE", "Scale (SC)", "M4 20V10h10v10ZM10 4h10v10"], ["MIRROR", "Mirror (MI)", "M12 3v18M9 7 4 17h5ZM15 7l5 10h-5Z"], ["OFFSET", "Offset (O)", "M4 18 18 4M8 20 20 8"], ["TRIM", "Trim (TR)", "M4 12h16M12 4v6m0 4v6"], ["EXTEND", "Extend (EX)", "M3 12h11M18 4v16M11 9l3 3-3 3"], ["FILLET", "Fillet, R option for radius (F)", "M4 20V10a6 6 0 0 1 6-6h10"], ["CHAMFER", "Chamfer (CHA)", "M4 20V10l6-6h10"], ["ARRAYRECT", "Rectangular array (AR)", "M4 4h5v5H4ZM15 4h5v5h-5ZM4 15h5v5H4ZM15 15h5v5h-5Z"], ["ARRAYPOLAR", "Polar array (PA)", "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2"], ["EXPLODE", "Explode (X)", "M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"], ["ERASE", "Erase (E)", "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"]] },
  { group: "Annotate", items: [["DIMLINEAR", "Linear dimension (DLI)", "M4 8v10M20 8v10M4 14h16"], ["DIMALIGNED", "Aligned dimension (DAL)", "M4 16 16 4M7 19 19 7M5 17l12-12"], ["DIMRADIUS", "Radius dimension (DRA)", "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12l6-6"], ["DIMDIAMETER", "Diameter dimension (DDI)", "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M6 18 18 6"], ["DIMANGULAR", "Angular dimension (DAN)", "M4 20h16M4 20 16 6M14 20a10 10 0 0 0-3-7"], ["BLOCK", "Make block (B)", "M4 4h16v16H4ZM8 8h8v8H8Z"], ["INSERT", "Insert block (I)", "M4 4h16v16H4ZM12 8v8M8 12h8"], ["DIST", "Measure distance (DI)", "M3 17 17 3l4 4L7 21ZM7 13l2 2M10 10l2 2M13 7l2 2"]] },
];
const SNAPS: [SnapKind, string][] = [["end", "Endpoint"], ["mid", "Midpoint"], ["center", "Center"], ["quad", "Quadrant"], ["int", "Intersection"], ["perp", "Perpendicular"], ["near", "Nearest"]];

export default function App() {
  const ses = useMemo(() => new Session(restore()), []); const [, bump] = useReducer((x: number) => x + 1, 0);
  const cv = useRef<HTMLCanvasElement>(null); const inp = useRef<HTMLInputElement>(null); const logRef = useRef<HTMLDivElement>(null);
  const [pal, setPal] = useState<Palette>(() => pref<Palette>("palette", "granat")); const [showGrid, setShowGrid] = useState(() => pref("grid", true));
  const [view, setView] = useState<View>({ cx: 100, cy: 60, s: 4 }); const [cur, setCur] = useState<V | null>(null); const [snap, setSnap] = useState<{ p: V; kind: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null); const [win, setWin] = useState<[V, V] | null>(null); const [text, setText] = useState(""); const [name, setName] = useState(() => pref("name", "Drawing1"));
  const [menu, setMenu] = useState<string | null>(null); const [lastCmd, setLastCmd] = useState<string | null>(null); const [dirty, setDirty] = useState(false); const [panel, setPanel] = useState(true);
  const arcPts = useRef<V[]>([]); const pan = useRef<{ x: number; y: number; v: View } | null>(null); const drag = useRef<V | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => { ses.onChange = () => { bump(); }; return () => { ses.onChange = () => {}; }; }, [ses]);
  useEffect(() => { document.documentElement.dataset.theme = pal; keep("palette", pal); }, [pal]);
  useEffect(() => keep("grid", showGrid), [showGrid]);
  useEffect(() => { keep("name", name); }, [name]);
  // autosave the drawing a moment after each change
  const json = writeNative(ses.d);
  useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem(KEY, json); } catch { /* full or private */ } }, 400); return () => clearTimeout(t); }, [json]);
  useEffect(() => { logRef.current?.scrollTo(0, 1e9); }, [ses.log.length]);

  const size = () => { const c = cv.current!; return [c.clientWidth, c.clientHeight] as const; };
  const zoomExtents = useCallback(() => { const b = boxOf(ses.d.ents.filter((e) => ses.layerOf(e.layer)?.visible)); if (!b || !cv.current) return setView({ cx: 100, cy: 60, s: 4 });
    const [w, h] = size(); const bw = Math.max(b[2] - b[0], 1), bh = Math.max(b[3] - b[1], 1); setView({ cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: Math.min((w - 60) / bw, (h - 60) / bh) }); }, [ses]);
  useEffect(() => { if (ses.d.ents.length) requestAnimationFrame(zoomExtents); }, [ses, zoomExtents]);

  // paint
  const preview = [...ses.preview, ...(ses.want && ["point", "dist", "angle"].includes(ses.want.kind) ? rubber(ses.running, ses.prompt, ses.want.base ?? null, snap?.p ?? cur, arcPts.current) : [])];
  useEffect(() => { const c = cv.current; if (!c) return; const f = () => draw(c, ses.d, view, pal, { cursor: cur, snap, base: ses.want?.base ?? null, preview, sel: ses.sel, hover, win, showGrid, grid: ses.s.grid }); f();
    const ro = new ResizeObserver(f); ro.observe(c); return () => ro.disconnect(); });

  const tol = () => 8 / view.s;
  const hit = (p: V): Ent | null => { let best: Ent | null = null, bd = tol(); for (const e of ses.d.ents) { if (!ses.layerOf(e.layer)?.visible) continue; const d = e.t === "text" ? (inBox(p, bbox(e)) ? 0 : Infinity) : distTo(e, p); if (d <= bd) { bd = d; best = e; } } return best; };
  const worldAt = (ev: { clientX: number; clientY: number }): V => { const r = cv.current!.getBoundingClientRect(); const [w, h] = size(); return toWorld(view, w, h)([ev.clientX - r.left, ev.clientY - r.top]); };

  const start = (cmd: string) => { setMenu(null); if (ses.running) { ses.feed({ k: "esc" }); setTimeout(() => start(cmd), 0); return; }
    const up = cmd.trim().split(/\s+/)[0].toUpperCase();
    if (["Z", "ZOOM", "ZE"].includes(up)) { zoomExtents(); ses.say("Command: ZOOM Extents"); return; }
    if (up === "SAVE") return saveNative(); if (up === "OPEN") return fileIn.current?.click(); if (up === "NEW") return newDoc();
    if (up === "DXFOUT") return exportDxf(); if (up === "SVGOUT") return exportSvg();
    setLastCmd(cmd); arcPts.current = []; setDirty(true); void ses.run(cmd).then(() => { arcPts.current = []; bump(); }); requestAnimationFrame(() => inp.current?.focus()); };

  const submit = () => { const t = text.trim(); setText("");
    if (ses.running) { ses.feed(t ? { k: "text", s: t, cursor: cur ?? undefined } : { k: "enter" }); if (ses.running === "ARC" && t) { const p = ses.parsePoint(t, ses.last, cur ?? undefined); if (p) arcPts.current.push(p); } return; }
    if (!t) { if (lastCmd) start(lastCmd); return; } start(t); };

  // pointer
  const onDown = (ev: React.PointerEvent) => { (ev.target as Element).setPointerCapture(ev.pointerId); const p = worldAt(ev);
    if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && ev.shiftKey && !ses.running)) { pan.current = { x: ev.clientX, y: ev.clientY, v: view }; ev.preventDefault(); return; }
    if (ev.button !== 0) return; const w = ses.want;
    if (w && (w.kind === "point" || w.kind === "dist" || w.kind === "angle")) { const q = ses.constrain(p, w.base ?? null, tol()).p; const e = hit(p); if (ses.running === "ARC") arcPts.current.push(q); if (e && w.kind === "point" && /Select|object/i.test(w.prompt)) ses.feed({ k: "pick", id: e.id, p: q }); else ses.feed({ k: "point", p: q }); return; }
    const e = hit(p);
    if (w && w.kind === "select") { if (e) ses.feed({ k: "pick", id: e.id, p }); else if (/Select objects/.test(w.prompt)) drag.current = p; return; }
    if (!ses.running) { if (e) { if (ev.ctrlKey || ev.metaKey) ses.sel.has(e.id) ? ses.sel.delete(e.id) : ses.sel.add(e.id); else if (!ses.sel.has(e.id)) ses.sel.add(e.id); bump(); } else drag.current = p; } };
  const onMove = (ev: React.PointerEvent) => { const p = worldAt(ev);
    if (pan.current) { const k = pan.current; setView({ ...k.v, cx: k.v.cx - (ev.clientX - k.x) / k.v.s, cy: k.v.cy + (ev.clientY - k.y) / k.v.s }); return; }
    if (drag.current) { setWin([drag.current, p]); setCur(p); return; }
    const w = ses.want; const c = w && w.kind !== "select" && w.kind !== "text" && w.kind !== "option" ? ses.constrain(p, w.base ?? null, tol()) : { p, snap: null };
    setCur(c.p); setSnap(c.snap ? { p: c.p, kind: c.snap } : null); setHover(!w || w.kind === "select" ? hit(p)?.id ?? null : null); };
  const onUp = (ev: React.PointerEvent) => { if (pan.current) { pan.current = null; return; }
    if (drag.current) { const a = drag.current, b = worldAt(ev); drag.current = null; setWin(null); if (dist(a, b) * view.s < 4) { if (!ses.running) { ses.sel.clear(); bump(); } return; }
      const crossing = b[0] < a[0]; const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] as const;
      const got = ses.d.ents.filter((e) => ses.editable(e) && (() => { const q = bbox(e); const inside = q[0] >= box[0] && q[1] >= box[1] && q[2] <= box[2] && q[3] <= box[3]; const touch = q[0] <= box[2] && q[2] >= box[0] && q[1] <= box[3] && q[3] >= box[1]; return crossing ? touch : inside; })());
      if (ses.want?.kind === "select") got.forEach((e) => ses.feed({ k: "pick", id: e.id, p: a })); else { got.forEach((e) => ses.sel.add(e.id)); bump(); } } };
  const onWheel = (ev: React.WheelEvent) => { const p = worldAt(ev); const k = Math.exp(-ev.deltaY * 0.0015); setView((v) => { const s = Math.min(5000, Math.max(0.005, v.s * k)); return { s, cx: p[0] - (p[0] - v.cx) * (v.s / s), cy: p[1] - (p[1] - v.cy) * (v.s / s) }; }); };

  // keyboard: typing goes to the command line; AutoCAD-style function keys
  useEffect(() => { const on = (e: KeyboardEvent) => { const t = e.target as HTMLElement; const inOther = (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") && t !== inp.current;
      if (e.key === "F3") { e.preventDefault(); ses.s.osnap = !ses.s.osnap; ses.say(`<Osnap ${ses.s.osnap ? "on" : "off"}>`); }
      else if (e.key === "F7") { e.preventDefault(); setShowGrid((g) => !g); }
      else if (e.key === "F8") { e.preventDefault(); ses.s.ortho = !ses.s.ortho; ses.say(`<Ortho ${ses.s.ortho ? "on" : "off"}>`); }
      else if (e.key === "F9") { e.preventDefault(); ses.s.snap = !ses.s.snap; ses.say(`<Snap ${ses.s.snap ? "on" : "off"}>`); }
      else if (inOther) return;
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (!ses.running) ses.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); if (!ses.running) ses.redo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNative(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { if (t !== inp.current || !text) { e.preventDefault(); ses.d.ents.filter((x) => ses.editable(x)).forEach((x) => ses.sel.add(x.id)); bump(); } }
      else if (e.key === "Escape") { if (ses.running) ses.feed({ k: "esc" }); else { ses.sel.clear(); bump(); } setMenu(null); }
      else if (e.key === "Delete" && !ses.running && ses.sel.size) start("ERASE");
      else if (t !== inp.current && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) inp.current?.focus(); };
    window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on); });

  // files
  const download = (blob: Blob, fn: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fn; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  function saveNative() { setMenu(null); download(new Blob([writeNative(ses.d)], { type: "application/json" }), `${name}.cadra`); setDirty(false); ses.say(`Saved ${name}.cadra`); }
  function exportDxf() { setMenu(null); download(new Blob([writeDxf(ses.d)], { type: "application/dxf" }), `${name}.dxf`); ses.say(`Exported ${name}.dxf (AutoCAD R12 DXF)`); }
  function exportSvg() { setMenu(null); const b = boxOf(ses.d.ents); if (!b) return ses.say("Nothing to export"); download(new Blob([writeSvg(ses.d, b)], { type: "image/svg+xml" }), `${name}.svg`); ses.say(`Exported ${name}.svg`); }
  function newDoc() { setMenu(null); if (dirty && ses.d.ents.length && !confirm("Discard the current drawing?")) return; if (ses.running) ses.feed({ k: "esc" }); load(newDrawing(), "Drawing1"); }
  function load(d: Drawing, nm: string) { ses.commit((x) => { Object.assign(x, structuredClone(d)); }); ses.sel.clear(); setName(nm); setDirty(false); requestAnimationFrame(zoomExtents); }
  const onFile = async (f: File) => { try { const s = await f.text(); const nm = f.name.replace(/\.(dxf|cadra|json)$/i, "");
      if (/\.dxf$/i.test(f.name)) { const r = readDxf(s); load(r.drawing, nm); const sk = Object.entries(r.skipped); ses.say(`Opened ${f.name}: ${r.drawing.ents.length} objects on ${r.drawing.layers.length} layers${sk.length ? `. Not imported: ${sk.map(([k, v]) => `${v}× ${k}`).join(", ")}` : ""}`); }
      else { load(readNative(s), nm); ses.say(`Opened ${f.name}`); } } catch (e) { ses.say(`Could not open ${f.name}: ${(e as Error).message}`); } };

  const selEnts = ses.d.ents.filter((e) => ses.sel.has(e.id)); const one = selEnts.length === 1 ? selEnts[0] : null;
  const setProp = (fn: (e: Ent) => Ent) => { const ids = new Set(selEnts.map((e) => e.id)); ses.commit((d) => { d.ents = d.ents.map((e) => (ids.has(e.id) ? fn(e) : e)); }); };
  const lay = (fn: (d: Drawing) => void) => ses.commit(fn);
  const W = ses.want;
  const MENUS: Record<string, [string, () => void, string?][]> = {
    File: [["New", newDoc, "NEW"], ["Open… (.dxf, .cadra)", () => { setMenu(null); fileIn.current?.click(); }, "OPEN"], ["Save (.cadra)", saveNative, "Ctrl+S"], ["Export DXF (R12)", exportDxf, "DXFOUT"], ["Export SVG", exportSvg, "SVGOUT"]],
    Edit: [["Undo", () => { setMenu(null); ses.undo(); }, "Ctrl+Z"], ["Redo", () => { setMenu(null); ses.redo(); }, "Ctrl+Y"], ["Select all", () => { setMenu(null); ses.d.ents.filter((x) => ses.editable(x)).forEach((x) => ses.sel.add(x.id)); bump(); }, "Ctrl+A"], ["Erase selection", () => start("ERASE"), "Del"]],
    View: [["Zoom extents", () => { setMenu(null); zoomExtents(); }, "Z"], [`${showGrid ? "Hide" : "Show"} grid`, () => { setMenu(null); setShowGrid(!showGrid); }, "F7"], [`${panel ? "Hide" : "Show"} side panel`, () => { setMenu(null); setPanel(!panel); }], ["Colours: Light", () => { setMenu(null); setPal("light"); }], ["Colours: Granat", () => { setMenu(null); setPal("granat"); }], ["Colours: Dark", () => { setMenu(null); setPal("dark"); }]],
    Help: [["List commands", () => start("HELP"), "HELP"], ["Coordinates: x,y · @dx,dy · @dist<angle", () => setMenu(null)], ["Mouse: wheel zooms, middle/right drag pans", () => setMenu(null)]],
  };

  return (
    <div className={`c-app ${panel ? "" : "nopanel"}`} onClick={() => menu && setMenu(null)}>
      <header className="c-head">
        <div className="c-brand"><Logo size={20} /><b>CADRA</b></div>
        <nav className="c-menubar" aria-label="Menu">{Object.keys(MENUS).map((m) => <div key={m} className="c-menuwrap"><button type="button" aria-haspopup="menu" aria-expanded={menu === m} onClick={(e) => { e.stopPropagation(); setMenu(menu === m ? null : m); }}>{m}</button>
          {menu === m && <div className="c-menu" role="menu" onClick={(e) => e.stopPropagation()}>{MENUS[m].map(([l, f, k]) => <button key={l} role="menuitem" type="button" onClick={f}><span>{l}</span>{k && <kbd>{k}</kbd>}</button>)}</div>}</div>)}</nav>
        <div className="c-title"><input aria-label="Drawing name" value={name} onChange={(e) => setName(e.target.value.replace(/[\\/:*?"<>|]/g, ""))} /><span className={dirty ? "c-dirty" : "c-saved"}>{dirty ? "autosaved in this browser" : "saved"}</span></div>
        <div className="c-themes" role="group" aria-label="Colours">{(["light", "granat", "dark"] as Palette[]).map((x) => <button key={x} type="button" className={pal === x ? "on" : ""} aria-pressed={pal === x} onClick={() => setPal(x)} title={{ light: "Light", granat: "Granat", dark: "Dark" }[x]}>{{ light: "L", granat: "G", dark: "D" }[x]}</button>)}</div>
      </header>
      <div className="c-ribbon" role="toolbar" aria-label="Tools">
        {TOOLS.map((g) => <div key={g.group} className="c-group"><div className="c-gbtns">{g.items.map(([c, l, d]) => <button key={c} type="button" className={`c-tool ${ses.running === c ? "on" : ""}`} title={l} aria-label={l} data-cmd={c} onClick={() => start(c)}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg></button>)}</div><span className="c-glabel">{g.group}</span></div>)}
        <div className="c-group c-layersel"><label className="c-glabel" htmlFor="curlayer">Layer</label>
          <select id="curlayer" value={ses.d.current} onChange={(e) => lay((d) => { d.current = e.target.value; })}>{ses.d.layers.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}</select></div>
        <div className="c-group"><div className="c-gbtns"><button type="button" className="c-tool" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!ses.canUndo || !!ses.running} onClick={() => ses.undo()}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></svg></button>
          <button type="button" className="c-tool" title="Zoom extents (Z)" aria-label="Zoom extents" onClick={zoomExtents}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg></button></div><span className="c-glabel">View</span></div>
      </div>
      <main className="c-main">
        <div className="c-canvas" onContextMenu={(e) => e.preventDefault()}>
          <canvas ref={cv} data-testid="canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { setCur(null); setSnap(null); }} onWheel={onWheel} onDoubleClick={(e) => { if (e.button === 1) zoomExtents(); }} />
          {!ses.d.ents.length && !ses.running && <div className="c-empty">Type a command (L for line, C for circle, REC for rectangle) or pick a tool above.<br />Coordinates: <code>x,y</code> absolute · <code>@dx,dy</code> relative · <code>@dist&lt;angle</code> polar.</div>}
        </div>
        {panel && <aside className="c-side">
          <section aria-label="Layers"><h2>Layers <button type="button" className="c-mini" onClick={() => start("LAYER")} title="New layer">+ New</button></h2>
            <table className="c-layers"><tbody>{ses.d.layers.map((l) => { const n = ses.d.ents.filter((e) => e.layer === l.name).length; return <tr key={l.name} className={l.name === ses.d.current ? "cur" : ""}>
              <td><input type="radio" name="cur" aria-label={`Make ${l.name} current`} checked={l.name === ses.d.current} onChange={() => lay((d) => { d.current = l.name; })} /></td>
              <td><button type="button" className={`c-ico ${l.visible ? "" : "off"}`} aria-label={`${l.visible ? "Hide" : "Show"} layer ${l.name}`} aria-pressed={l.visible} title={l.visible ? "Visible" : "Hidden"} onClick={() => lay((d) => { const x = d.layers.find((y) => y.name === l.name)!; x.visible = !x.visible; })}>{l.visible ? <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg> : <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /></svg>}</button></td>
              <td><button type="button" className={`c-ico ${l.locked ? "warn" : "off"}`} aria-label={`${l.locked ? "Unlock" : "Lock"} layer ${l.name}`} aria-pressed={l.locked} title={l.locked ? "Locked" : "Unlocked"} onClick={() => lay((d) => { const x = d.layers.find((y) => y.name === l.name)!; x.locked = !x.locked; })}>{l.locked ? <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg> : <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></svg>}</button></td>
              <td><input type="color" aria-label={`Colour of layer ${l.name}`} value={l.color} onChange={(e) => lay((d) => { d.layers.find((y) => y.name === l.name)!.color = e.target.value; })} /></td>
              <td className="c-lname" title={l.name}>{l.name}</td><td className="c-dimtxt">{n}</td>
              <td>{l.name !== "0" && <button type="button" className="c-ico" aria-label={`Delete layer ${l.name}`} title={n ? "Layer has objects" : "Delete layer"} disabled={n > 0} onClick={() => lay((d) => { d.layers = d.layers.filter((y) => y.name !== l.name); if (d.current === l.name) d.current = "0"; })}>×</button>}</td></tr>; })}</tbody></table></section>
          <section aria-label="Properties"><h2>Properties</h2>
            {!selEnts.length ? <p className="c-dimtxt">No selection. Click objects, or drag a window (left→right: inside, right→left: crossing).</p> : <div className="c-props">
              <div><span>Selected</span><b>{selEnts.length} {one ? kindName(one) : "objects"}</b></div>
              <div><label htmlFor="plyr">Layer</label><select id="plyr" value={selEnts.every((e) => e.layer === selEnts[0].layer) ? selEnts[0].layer : ""} onChange={(e) => setProp((x) => ({ ...x, layer: e.target.value }))}>{!selEnts.every((e) => e.layer === selEnts[0].layer) && <option value="">*varies*</option>}{ses.d.layers.map((l) => <option key={l.name}>{l.name}</option>)}</select></div>
              <div><label htmlFor="pcol">Colour</label><span className="c-row"><input id="pcol" type="color" value={one?.color ?? ses.layerOf(selEnts[0].layer)?.color ?? "#ffffff"} onChange={(e) => setProp((x) => ({ ...x, color: e.target.value }))} /><button type="button" className="c-mini" onClick={() => setProp((x) => { const { color: _c, ...r } = x; return r as Ent; })}>ByLayer</button></span></div>
              {one && measures(one).map(([k, v]) => <div key={k}><span>{k}</span><b className="mono">{v}</b></div>)}
              {one?.t === "text" && <div><label htmlFor="ptxt">Contents</label><input id="ptxt" value={one.s} onChange={(e) => setProp((x) => ({ ...x, s: e.target.value } as Ent))} /></div>}
              {one?.t === "circle" && <div><label htmlFor="prad">Radius</label><input id="prad" type="number" step="any" min="0" defaultValue={fmt(one.r, 4)} key={one.id + one.r} onBlur={(e) => { const v = +e.target.value; if (v > 0) setProp((x) => ({ ...x, r: v } as Ent)); }} /></div>}
              <button type="button" className="c-mini danger" onClick={() => start("ERASE")}>Erase {selEnts.length}</button></div>}</section>
          <section aria-label="Object snaps"><h2>Object snaps</h2><div className="c-snaps">{SNAPS.map(([k, l]) => <label key={k}><input type="checkbox" checked={ses.s.osnapKinds.has(k)} onChange={() => { ses.s.osnapKinds.has(k) ? ses.s.osnapKinds.delete(k) : ses.s.osnapKinds.add(k); bump(); }} />{l}</label>)}</div>
            <label className="c-gridin">Grid / snap spacing <input type="number" min="0.01" step="any" value={ses.s.grid} onChange={(e) => { const v = +e.target.value; if (v > 0) { ses.s.grid = v; bump(); } }} /></label></section>
        </aside>}
      </main>
      <section className="c-cmd" aria-label="Command line">
        <div className="c-log mono" ref={logRef} aria-live="polite">{ses.log.slice(-60).map((l, i) => <div key={i}>{l}</div>)}</div>
        <div className="c-prompt"><span className="mono" title={W?.prompt ?? "Command:"}>{W?.prompt ?? "Command:"}</span>
          {W?.options && <span className="c-opts">{W.options.map((o) => <button key={o} type="button" onClick={() => ses.feed({ k: "text", s: o })}>{o}</button>)}</span>}
          <input ref={inp} className="mono" data-testid="cmdline" aria-label="Command line input" value={text} autoFocus spellCheck={false} autoComplete="off" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" || (e.key === " " && W?.kind !== "text")) { e.preventDefault(); submit(); } }} list="cmds" />
          <datalist id="cmds">{!ses.running && Object.keys(COMMANDS).map((c) => <option key={c} value={c} />)}</datalist></div>
      </section>
      <footer className="c-status">
        <span className="mono c-coords" data-testid="coords">{cur ? `${fmt(cur[0], 4)}, ${fmt(cur[1], 4)}` : "—"}</span>
        {([["SNAP", "snap", "F9"], ["ORTHO", "ortho", "F8"], ["OSNAP", "osnap", "F3"]] as const).map(([l, k, f]) => <button key={k} type="button" className={ses.s[k] ? "on" : ""} aria-pressed={ses.s[k]} title={`${l} (${f})`} onClick={() => { ses.s[k] = !ses.s[k]; bump(); }}>{l}</button>)}
        <button type="button" className={showGrid ? "on" : ""} aria-pressed={showGrid} title="GRID (F7)" onClick={() => setShowGrid(!showGrid)}>GRID</button>
        <span className="c-layerst">Layer <b>{ses.d.current}</b></span>
        <span className="c-dimtxt">{ses.d.ents.length} objects · {ses.d.units} · zoom {fmt(view.s, 3)} px/{ses.d.units}</span>
      </footer>
      <input ref={fileIn} type="file" accept=".dxf,.cadra,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
    </div>
  );
}
const inBox = (p: V, b: [number, number, number, number]) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const kindName = (e: Ent) => ({ line: "line", circle: "circle", arc: "arc", poly: "polyline", text: "text", dim: "dimension", hatch: "hatch", insert: "block reference" })[e.t];
function measures(e: Ent): [string, string][] {
  const f = (v: number) => fmt(v, 4); const area = (P: V[]) => Math.abs(P.reduce((s, p, i) => s + p[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * p[1], 0)) / 2;
  const plen = (P: V[], c: boolean) => P.reduce((s, p, i) => s + (i ? dist(P[i - 1], p) : 0), 0) + (c && P.length > 1 ? dist(P[P.length - 1], P[0]) : 0);
  switch (e.t) {
    case "line": return [["Start", `${f(e.a[0])}, ${f(e.a[1])}`], ["End", `${f(e.b[0])}, ${f(e.b[1])}`], ["Length", f(dist(e.a, e.b))], ["Angle", `${fmt(deg(Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0])), 2)}°`]];
    case "circle": return [["Center", `${f(e.c[0])}, ${f(e.c[1])}`], ["Diameter", f(2 * e.r)], ["Circumference", f(2 * Math.PI * e.r)], ["Area", f(Math.PI * e.r * e.r)]];
    case "arc": { const sw = ((e.a1 - e.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return [["Center", `${f(e.c[0])}, ${f(e.c[1])}`], ["Radius", f(e.r)], ["Total angle", `${fmt(deg(sw), 2)}°`], ["Arc length", f(e.r * sw)]]; }
    case "poly": return [["Vertices", String(e.pts.length)], ["Closed", e.closed ? "Yes" : "No"], ["Length", f(plen(e.pts, e.closed))], ...(e.closed ? [["Area", f(area(e.pts))] as [string, string]] : [])];
    case "hatch": return [["Area", f(area(e.pts))]];
    case "text": return [["Height", f(e.h)], ["Rotation", `${fmt(deg(e.rot), 2)}°`]];
    case "insert": return [["Block", e.name], ["Insertion point", `${f(e.p[0])}, ${f(e.p[1])}`], ["Scale", f(e.k)], ["Rotation", `${fmt(deg(e.rot), 2)}°`]];
    case "dim": return [["Kind", e.kind], ["Measurement", f(e.kind === "diameter" ? 2 * dist(e.p1, e.p2) : e.kind === "radius" ? dist(e.p1, e.p2) : e.kind === "aligned" ? dist(e.p1, e.p2) : Math.abs(e.kind === "horizontal" ? e.p2[0] - e.p1[0] : e.p2[1] - e.p1[1]))]];
  }
}
