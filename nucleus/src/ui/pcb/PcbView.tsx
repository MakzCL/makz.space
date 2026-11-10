// PCB layout editor: board view, part placement (move / rotate / flip), interactive routing with vias,
// autorouter, DRC list, layer visibility, board setup and manufacturing exports. All edits go through the
// project store, so undo/redo and saving cover the board too.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { model3d } from "../../pcb/model3d";
const Board3D = lazy(() => import("./Board3D"));
import { useStore } from "../store";
import { baseItems, boardOf, courtyardOf, items, newBoard, outlineBox, padsOf, pid, place, ratsnest, rectOutline, sync, dist, type Board, type Layer, type P, type PcbPart } from "../../pcb/board";
import { drc, type DrcFinding } from "../../pcb/drc";
import { autoroute } from "../../pcb/route";
import { fabFiles, strokeText, zip } from "../../pcb/gerber";
import { footprint, mm } from "../../pcb/footprints";
import { fillArea, fillZones } from "../../pcb/zones";
import type { Project } from "../../core/types";

export const pcbCommand = (cmd: string) => window.dispatchEvent(new CustomEvent("nucleus:pcb", { detail: cmd }));
type Tool = "select" | "route" | "via";
type View = { s: number; x: number; y: number }; // screen = world(nm) * s + offset
const GRIDS = [0.1, 0.25, 0.5, 1.27].map(mm);
const COL = { board: "#0f1a14", edge: "#f5c85c", "F.Cu": "#e0533f", "B.Cu": "#3f7fe0", pad: "#d9a441", hole: "#05070f", silk: "#e9ecff", rats: "#f2f2f2", sel: "#ffffff", err: "#ff3b6b", warn: "#f5c85c" };

export function PcbView({ dark }: { dark: string }) {
  const S = useStore(); const pr = S.pr; const board = boardOf(pr);
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ W: 900, H: 600 }); const [view, setView] = useState<View>({ s: 1e-5, x: 40, y: 40 });
  const [tool, setTool] = useState<Tool>("select"); const [layer, setLayer] = useState<Layer>("F.Cu");
  const [show, setShow] = useState({ "F.Cu": true, "B.Cu": true, silk: true, rats: true });
  const [grid, setGrid] = useState(GRIDS[1]); const [sel, setSel] = useState<string | null>(null);
  const [findings, setFindings] = useState<DrcFinding[] | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const [route, setRoute] = useState<{ pts: P[]; layer: Layer; net: string; width: number; vias: P[] } | null>(null);
  const [cursor, setCursor] = useState<P | null>(null); const [view3d, setView3d] = useState(false); const [setup, setSetup] = useState(false); const [zoneDlg, setZoneDlg] = useState(false);
  const drag = useRef<{ k: "pan"; s: P; v: View } | { k: "move"; id: string; off: P; base: Project; moved: boolean } | null>(null);

  useLayoutEffect(() => { const el = wrap.current; if (!el) return; /* no canvas until the board exists */ const ro = new ResizeObserver(() => setSize({ W: el.clientWidth, H: el.clientHeight })); ro.observe(el); setSize({ W: el.clientWidth, H: el.clientHeight }); return () => ro.disconnect(); }, [!!board]);
  const setBoard = useCallback((fn: (b: Board) => Board, label: string) => S.change((p) => { const b = boardOf(p) ?? newBoard(); const nb = fn(structuredClone(b)); return { ...p, pcb: nb, modified: new Date().toISOString() }; }, label), [S]);
  const fit = useCallback(() => {
    if (!board) return; const [x0, y0, x1, y1] = outlineBox(board); let X0 = x0, Y0 = y0, X1 = x1, Y1 = y1;
    for (const p of board.parts) { const c = courtyardOf(p); if (c) { X0 = Math.min(X0, c[0]); Y0 = Math.min(Y0, c[1]); X1 = Math.max(X1, c[2]); Y1 = Math.max(Y1, c[3]); } }
    const m = mm(4); X0 -= m; Y0 -= m; X1 += m; Y1 += m; const s = Math.min(size.W / (X1 - X0), size.H / (Y1 - Y0));
    setView({ s, x: size.W / 2 - ((X0 + X1) / 2) * s, y: size.H / 2 - ((Y0 + Y1) / 2) * s });
  }, [board, size]);
  const fitted = useRef(""); useEffect(() => { const k = `${pr.id}|${!!board}`; if (board && size.W > 100 && fitted.current !== k) { fitted.current = k; fit(); } }, [pr.id, board, size.W, fit]);

  const pads = useMemo(() => (board ? padsOf(board, pr, S.con) : []), [board, pr, S.con]);
  const fills = useMemo(() => (board?.zones?.length ? fillZones(board, baseItems(board, pads)) : []), [board, pads]);
  const rats = useMemo(() => (board ? ratsnest(board, pr, S.con) : []), [board, pr, S.con]);
  const toW = (x: number, y: number): P => [(x - view.x) / view.s, (y - view.y) / view.s];
  const snap = (p: P): P => [Math.round(p[0] / grid) * grid, Math.round(p[1] / grid) * grid];
  const copperAt = useCallback((p: P, layers: Layer[]) => {
    if (!board) return null; const pt = { t: "cap" as const, a: p, b: p, r: 3 / view.s };
    return items(board, pads).find((x) => x.layers.some((l) => layers.includes(l)) && dist(pt, x.shape) <= 0) ?? null;
  }, [board, pads, view.s]);
  const partAt = useCallback((p: P) => board?.parts.slice().reverse().find((x) => { const c = courtyardOf(x); return c && p[0] >= c[0] && p[0] <= c[2] && p[1] >= c[1] && p[1] <= c[3]; }) ?? null, [board]);

  // ---------- commands (menu, toolbar, keys) ----------
  const update = useCallback(() => {
    const { report } = sync(pr, board);
    S.change((p) => ({ ...p, pcb: sync(p, boardOf(p)).board, modified: new Date().toISOString() }), "Update PCB from schematic");
    const parts = [report.added.length && `added ${report.added.join(", ")}`, report.removed.length && `removed ${report.removed.join(", ")}`, report.changed.length && `updated ${report.changed.join(", ")}`, report.missing.length && `no footprint: ${report.missing.join(", ")}`].filter(Boolean);
    S.say(parts.length ? `PCB: ${parts.join("; ")}` : "PCB already matches the schematic", report.missing.length ? "error" : "ok"); setTimeout(fit, 50);
  }, [pr, board, S, fit]);
  const runDrc = useCallback(() => { if (!board) return; const f = drc(board, pr); setFindings(f); const e = f.filter((x) => x.severity === "error").length; S.say(`DRC: ${e} errors, ${f.length - e} warnings`, e ? "error" : "ok"); }, [board, pr, S]);
  const doRoute = useCallback(() => {
    if (!board) return; setBusy("Autorouting…");
    setTimeout(() => { try { const r = autoroute(board, pr); S.change((p) => ({ ...p, pcb: r.board, modified: new Date().toISOString() }), "Autoroute");
      S.say(r.failed.length ? `Autorouter: ${r.routed} routed, ${r.failed.length} could not be routed (${r.failed.map((f) => f.net).join(", ")}) after ${r.attempts} attempt${r.attempts === 1 ? "" : "s"} with rip-up and retry. Move parts apart or route them by hand.` : `Autorouter: all ${r.routed} connections routed in ${(r.ms / 1000).toFixed(1)} s${r.attempts > 1 ? ` (${r.attempts} attempts, rip-up and retry)` : ""}`, r.failed.length ? "error" : "ok");
      setFindings(drc(r.board, pr)); } finally { setBusy(null); } }, 30);
  }, [board, pr, S]);
  const exportFab = useCallback(() => {
    if (!board) return; const f = drc(board, pr).filter((x) => x.severity === "error");
    if (f.length && !window.confirm(`DRC has ${f.length} error(s). Export manufacturing files anyway?`)) return;
    const base = pr.name.replace(/[^\w-]+/g, "_"); const files = fabFiles(board, pr, base);
    const data = zip(files.map((x) => ({ name: x.name, data: new TextEncoder().encode(x.text) })));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/zip" })); a.download = `${base}-fab.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    S.say(`Exported ${files.length} files: Gerber layers, drill, pick-and-place`, "ok");
  }, [board, pr, S]);
  const rotate = useCallback((id: string) => setBoard((b) => { b.parts = b.parts.map((p) => (p.id === id ? { ...p, rot: ((p.rot + 90) % 360) as PcbPart["rot"] } : p)); return b; }, "Rotate part"), [setBoard]);
  const flip = useCallback((id: string) => setBoard((b) => { b.parts = b.parts.map((p) => (p.id === id ? { ...p, side: p.side === "top" ? "bottom" : "top" } : p)); return b; }, "Flip part"), [setBoard]);
  const del = useCallback((id: string) => {
    if (board?.parts.some((p) => p.id === id)) { S.say("Parts come from the schematic: delete the part there, then Update PCB.", "info"); return; }
    setBoard((b) => { b.tracks = b.tracks.filter((t) => t.id !== id); b.vias = b.vias.filter((v) => v.id !== id); return b; }, "Delete"); setSel(null);
  }, [board, S, setBoard]);
  useEffect(() => {
    const h = (e: Event) => { const c = (e as CustomEvent).detail as string;
      if (c === "update") update(); else if (c === "drc") runDrc(); else if (c === "autoroute") doRoute(); else if (c === "export") exportFab(); else if (c === "setup") setSetup(true); else if (c === "zone") setZoneDlg(true); else if (c === "fit") fit(); else if (c === "3d") setView3d(true);
      else if (c === "unroute") { setBoard((b) => ({ ...b, tracks: [], vias: [] }), "Remove all tracks"); } };
    window.addEventListener("nucleus:pcb", h); return () => window.removeEventListener("nucleus:pcb", h);
  }, [update, runDrc, doRoute, exportFab, fit, setBoard]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select") || document.querySelector(".n-modal")) return;
      const key = e.key.toLowerCase();
      if (key === "escape") { setRoute(null); setTool("select"); }
      else if (key === "x" && !e.ctrlKey) setTool("route"); else if (key === "s" && !e.ctrlKey) setTool("select");
      else if (key === "v" && route) { // via + layer change at the last point
        const at = route.pts[route.pts.length - 1]; const nl: Layer = route.layer === "F.Cu" ? "B.Cu" : "F.Cu";
        commit(route, true); setRoute({ pts: [at], layer: nl, net: route.net, width: route.width, vias: [] }); setLayer(nl); setBoard((b) => { b.vias.push({ id: pid("v"), at, drill: b.rules.viaDrill, dia: b.rules.viaDia, net: route.net }); return b; }, "Via");
      } else if (key === "v" && !e.ctrlKey) setTool("via");
      else if (key === "l") setLayer((l) => (l === "F.Cu" ? "B.Cu" : "F.Cu"));
      else if (key === "backspace" && route) { setRoute(route.pts.length > 1 ? { ...route, pts: route.pts.slice(0, -1) } : null); e.preventDefault(); }
      else if (sel && key === "r") rotate(sel); else if (sel && key === "f") flip(sel); else if (sel && (key === "delete" || key === "backspace")) del(sel);
      else return; e.preventDefault();
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  function commit(r: NonNullable<typeof route>, keepOpen = false) {
    if (r.pts.length < 2) { if (!keepOpen) setRoute(null); return; }
    setBoard((b) => { for (let i = 1; i < r.pts.length; i++) b.tracks.push({ id: pid("t"), layer: r.layer, a: r.pts[i - 1], b: r.pts[i], width: r.width, net: r.net }); return b; }, "Route track");
    if (!keepOpen) setRoute(null);
  }
  /** 45° posture: from a toward b, a diagonal then a straight run (or straight only). */
  const leg = (a: P, b: P): P[] => { const dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.min(Math.abs(dx), Math.abs(dy)); if (!d || Math.abs(dx) === Math.abs(dy)) return [b]; return [[a[0] + Math.sign(dx) * d, a[1] + Math.sign(dy) * d], b]; };

  // ---------- drawing ----------
  useEffect(() => {
    const c = cv.current; if (!c) return; const dpr = devicePixelRatio || 1; c.width = size.W * dpr; c.height = size.H * dpr; const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement); ctx.fillStyle = css.getPropertyValue("--bg").trim() || "#0b1033"; ctx.fillRect(0, 0, size.W, size.H);
    if (!board) return; const s = view.s, X = (p: P) => [p[0] * s + view.x, p[1] * s + view.y] as const;
    // board
    ctx.beginPath(); board.outline.forEach((p, i) => { const [x, y] = X(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = COL.board; ctx.fill(); ctx.strokeStyle = COL.edge; ctx.lineWidth = 1.5; ctx.stroke();
    // grid dots when zoomed in enough
    if (grid * s > 7) { const [x0, y0, x1, y1] = outlineBox(board); ctx.fillStyle = "rgba(255,255,255,.12)"; for (let x = Math.ceil(x0 / grid) * grid; x <= x1; x += grid) for (let y = Math.ceil(y0 / grid) * grid; y <= y1; y += grid) { const [u, v] = X([x, y]); ctx.fillRect(u - 0.5, v - 0.5, 1, 1); } }
    const order: Layer[] = layer === "F.Cu" ? ["B.Cu", "F.Cu"] : ["F.Cu", "B.Cu"];
    for (const L of order) {
      if (!show[L]) continue; const alpha = L === layer ? 1 : 0.45;
      ctx.globalAlpha = alpha * 0.55; ctx.fillStyle = COL[L];
      for (const f of fills) if (f.zone.layer === L) for (const poly of f.polys) { ctx.beginPath(); for (const r of poly.rings) r.forEach((p, i) => { const [x, y] = X(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill("evenodd"); }
      ctx.globalAlpha = alpha; ctx.strokeStyle = COL[L]; ctx.lineCap = "round";
      for (const t of board.tracks) if (t.layer === L) { const [a, b] = [X(t.a), X(t.b)]; ctx.lineWidth = Math.max(1, t.width * s); ctx.strokeStyle = t.id === sel ? COL.sel : COL[L]; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      for (const p of pads) if (p.layers.includes(L) && !(p.drill && L !== layer)) { ctx.fillStyle = p.drill ? COL.pad : COL[L]; padPath(ctx, p, X, s); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    for (const v of board.vias) { const [x, y] = X(v.at); ctx.fillStyle = v.id === sel ? COL.sel : "#b9bdc9"; ctx.beginPath(); ctx.arc(x, y, Math.max(2, (v.dia / 2) * s), 0, 7); ctx.fill(); ctx.fillStyle = COL.hole; ctx.beginPath(); ctx.arc(x, y, Math.max(1, (v.drill / 2) * s), 0, 7); ctx.fill(); }
    for (const p of pads) if (p.drill) { const [x, y] = X(p.at); ctx.fillStyle = COL.hole; ctx.beginPath(); ctx.arc(x, y, Math.max(1, (p.drill / 2) * s), 0, 7); ctx.fill(); }
    // pad numbers / nets when zoomed in
    if (s > 2.2e-5) { ctx.fillStyle = "#0b1033"; ctx.font = `${Math.min(11, 0.6e6 * s)}px IBM Plex Mono, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; for (const p of pads) { const [x, y] = X(p.at); ctx.fillText(p.name, x, y); } }
    // silkscreen + selection
    if (show.silk) for (const p of board.parts) {
      const f = footprint(p.footprint); if (!f) continue; ctx.strokeStyle = p.side === "top" ? COL.silk : "#8fa4ff"; ctx.globalAlpha = p.side === "top" ? 0.9 : 0.6; ctx.lineWidth = Math.max(1, board.rules.silkWidth * s);
      for (const l of f.silk) { const a = X(place(p, l[0], l[1])), b = X(place(p, l[2], l[3])); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      const c = courtyardOf(p)!; for (const [a, b] of strokeText(p.ref, [(c[0] + c[2]) / 2, c[1] - mm(0.9)], mm(1))) { const u = X(a), w = X(b); ctx.beginPath(); ctx.moveTo(u[0], u[1]); ctx.lineTo(w[0], w[1]); ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (p.id === sel) { const [x0, y0] = X([c[0], c[1]]), [x1, y1] = X([c[2], c[3]]); ctx.setLineDash([4, 3]); ctx.strokeStyle = COL.sel; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]); }
    }
    if (show.rats) { ctx.strokeStyle = COL.rats; ctx.globalAlpha = 0.7; ctx.lineWidth = 1; for (const w of rats) { const a = X(w.a), b = X(w.b); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } ctx.globalAlpha = 1; }
    if (route && cursor) { // route preview
      const pts = [...route.pts, ...leg(route.pts[route.pts.length - 1], snap(cursor))]; ctx.strokeStyle = COL[route.layer]; ctx.globalAlpha = 0.8; ctx.lineWidth = Math.max(1, route.width * s); ctx.lineCap = "round";
      ctx.beginPath(); pts.forEach((p, i) => { const [x, y] = X(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (const f of findings ?? []) { const [x, y] = X(f.at); ctx.strokeStyle = f.severity === "error" ? COL.err : COL.warn; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke(); }
  });

  // ---------- pointer ----------
  const onDown = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect(); const w = toW(e.clientX - r.left, e.clientY - r.top);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) { drag.current = { k: "pan", s: [e.clientX, e.clientY], v: view }; return; }
    if (!board) return;
    if (tool === "route") {
      if (!route) { const it = copperAt(w, [layer]); if (!it) { S.say("Start a track on a pad, track or via", "info"); return; } setRoute({ pts: [it.kind === "pad" || it.kind === "via" ? it.at : snap(w)], layer, net: it.net, width: board.rules.track, vias: [] }); return; }
      const end = copperAt(w, [route.layer]); const last = route.pts[route.pts.length - 1];
      if (end && end.net && end.net !== route.net) { S.say(`That is net ${end.net}; this track is ${route.net}`, "error"); return; }
      const target: P = end && (end.kind === "pad" || end.kind === "via") ? end.at : snap(w); const r2 = { ...route, pts: [...route.pts, ...leg(last, target)] };
      if (end && end.net === route.net && !(end.at[0] === route.pts[0][0] && end.at[1] === route.pts[0][1])) commit(r2); else setRoute(r2);
      return;
    }
    if (tool === "via") { const it = copperAt(w, ["F.Cu", "B.Cu"]); setBoard((b) => { b.vias.push({ id: pid("v"), at: snap(w), drill: b.rules.viaDrill, dia: b.rules.viaDia, net: it?.net ?? "" }); return b; }, "Via"); return; }
    const part = partAt(w); const cu = copperAt(w, [layer, "F.Cu", "B.Cu"]);
    const hitTrack = cu && cu.kind !== "pad" ? cu.id : null;
    if (hitTrack) { setSel(hitTrack); return; }
    if (part) { setSel(part.id); if (!part.locked) drag.current = { k: "move", id: part.id, off: [w[0] - part.at[0], w[1] - part.at[1]], base: pr, moved: false }; return; }
    setSel(null);
  };
  const onMove = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect(); const w = toW(e.clientX - r.left, e.clientY - r.top); setCursor(w);
    const d = drag.current; if (!d) return;
    if (d.k === "pan") { setView({ ...d.v, x: d.v.x + e.clientX - d.s[0], y: d.v.y + e.clientY - d.s[1] }); return; }
    const at = snap([w[0] - d.off[0], w[1] - d.off[1]]); d.moved = true;
    const b = boardOf(d.base)!; S.setPreview({ ...d.base, pcb: { ...b, parts: b.parts.map((p) => (p.id === d.id ? { ...p, at } : p)) } });
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d?.k === "move" && d.moved && S.preview) { const nb = boardOf(S.preview)!; S.change((p) => ({ ...p, pcb: nb, modified: new Date().toISOString() }), "Move part"); } else S.setPreview(null); };
  const onWheel = (e: React.WheelEvent) => { const r = cv.current!.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const k = Math.exp(-e.deltaY * 0.0015); const s = Math.min(1e-3, Math.max(1e-6, view.s * k)); setView({ s, x: mx - ((mx - view.x) / view.s) * s, y: my - ((my - view.y) / view.s) * s }); };

  // read-only automation hook for end-to-end tests: page coordinates of a pad
  useEffect(() => { (window as unknown as { __nucleusPcb?: unknown }).__nucleusPcb = { pad: (ref: string, name: string) => { const p = pads.find((x) => x.ref === ref && x.name === name); const r = cv.current?.getBoundingClientRect(); return p && r ? [r.left + p.at[0] * view.s + view.x, r.top + p.at[1] * view.s + view.y] : null; }, part: (ref: string) => { const p = board?.parts.find((x) => x.ref === ref); const r = cv.current?.getBoundingClientRect(); return p && r ? [r.left + p.at[0] * view.s + view.x, r.top + p.at[1] * view.s + view.y, p.at[0], p.at[1]] : null; } }; });
  const selPart = board?.parts.find((p) => p.id === sel); const selTrack = board?.tracks.find((t) => t.id === sel); const selVia = board?.vias.find((v) => v.id === sel);
  const nErr = findings?.filter((f) => f.severity === "error").length ?? 0;
  if (!board) return (
    <div className="n-pad n-pcb-empty" data-testid="pcb-empty"><h3>PCB layout</h3>
      <p className="n-dim">Create the board from the schematic: every part with a footprint is placed beside a 50 × 40 mm board outline, with its connections shown as ratsnest lines. Simulation-only sources are left out.</p>
      <button type="button" className="n-btn primary" onClick={update} data-testid="pcb-create">Create PCB from schematic</button></div>);
  return (
    <div className="n-pcb" data-testid="pcb">
      <div className="n-pcb-bar">
        <div className="n-seg">{(["select", "route", "via"] as Tool[]).map((t) => <button key={t} type="button" className={tool === t ? "on" : ""} onClick={() => { setTool(t); setRoute(null); }} data-testid={`pcb-tool-${t}`} title={{ select: "Select / move (S)", route: "Route track (X)", via: "Place via (V)" }[t]}>{{ select: "Select", route: "Route", via: "Via" }[t]}</button>)}</div>
        <div className="n-seg">{(["F.Cu", "B.Cu"] as Layer[]).map((l) => <button key={l} type="button" className={layer === l ? "on" : ""} onClick={() => setLayer(l)} title="Active layer (L toggles)"><i className="n-sw" style={{ background: COL[l] }} />{l === "F.Cu" ? "Top" : "Bottom"}</button>)}</div>
        <label className="n-chk"><input type="checkbox" checked={show["F.Cu"]} onChange={(e) => setShow({ ...show, "F.Cu": e.target.checked })} />Top</label>
        <label className="n-chk"><input type="checkbox" checked={show["B.Cu"]} onChange={(e) => setShow({ ...show, "B.Cu": e.target.checked })} />Bottom</label>
        <label className="n-chk"><input type="checkbox" checked={show.silk} onChange={(e) => setShow({ ...show, silk: e.target.checked })} />Silk</label>
        <label className="n-chk"><input type="checkbox" checked={show.rats} onChange={(e) => setShow({ ...show, rats: e.target.checked })} />Ratsnest</label>
        <select className="n-in" value={grid} onChange={(e) => setGrid(Number(e.target.value))} title="Grid">{GRIDS.map((g) => <option key={g} value={g}>{g / 1e6} mm</option>)}</select>
        <span className="n-grow" />
        <button type="button" className="n-btn" onClick={update} data-testid="pcb-update">Update from schematic</button>
        <button type="button" className="n-btn" onClick={doRoute} disabled={!!busy} data-testid="pcb-autoroute">{busy ?? "Autoroute"}</button>
        <button type="button" className="n-btn" onClick={runDrc} data-testid="pcb-drc">DRC</button>
        <button type="button" className="n-btn" onClick={() => setView3d(true)} data-testid="pcb-3d" title="3D view of the board">3D view</button>
        <button type="button" className="n-btn primary" onClick={exportFab} data-testid="pcb-export">Gerber / drill…</button>
      </div>
      {view3d && <Suspense fallback={<div className="n-3d"><div className="n-3derr">Loading 3D view…</div></div>}><Board3D model={model3d(board, pr)} onClose={() => setView3d(false)} /></Suspense>}
      <div className="n-pcb-main">
        <div className="n-pcb-canvas" ref={wrap}>
          <canvas ref={cv} style={{ width: size.W, height: size.H, cursor: tool === "select" ? "default" : "crosshair" }} data-testid="pcb-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={() => route && commit(route)} />
        </div>
        <aside className="n-pcb-side">
          <section><h4>Status</h4>
            <p data-testid="pcb-status">{board.parts.length} part{board.parts.length === 1 ? "" : "s"} · {board.tracks.length} track{board.tracks.length === 1 ? "" : "s"} · {board.vias.length} via{board.vias.length === 1 ? "" : "s"}<br />{rats.length ? <b className="n-warn">{rats.length} connections to route</b> : <b className="n-ok">All connections routed</b>}</p>
            {cursor && <p className="n-dim">X {(cursor[0] / 1e6).toFixed(2)} Y {(cursor[1] / 1e6).toFixed(2)} mm · {layer}</p>}
          </section>
          {selPart && <section><h4>{selPart.ref}</h4><p className="n-dim">{selPart.footprint}<br />{(selPart.at[0] / 1e6).toFixed(2)}, {(selPart.at[1] / 1e6).toFixed(2)} mm · {selPart.rot}° · {selPart.side}</p>
            <div className="n-row"><button type="button" className="n-btn" onClick={() => rotate(selPart.id)}>Rotate (R)</button><button type="button" className="n-btn" onClick={() => flip(selPart.id)}>Flip (F)</button>
              <button type="button" className="n-btn" onClick={() => setBoard((b) => { b.parts = b.parts.map((p) => (p.id === selPart.id ? { ...p, locked: !p.locked } : p)); return b; }, selPart.locked ? "Unlock" : "Lock")}>{selPart.locked ? "Unlock" : "Lock"}</button></div></section>}
          {selTrack && <section><h4>Track</h4><p className="n-dim">Net {selTrack.net || "—"} · {selTrack.layer}</p>
            <label className="n-field"><span>Width (mm)</span><input className="n-in" type="number" step="0.05" min="0.1" defaultValue={selTrack.width / 1e6} key={selTrack.id} onBlur={(e) => { const v = mm(Number(e.target.value)); if (v > 0) setBoard((b) => { b.tracks = b.tracks.map((t) => (t.id === selTrack.id ? { ...t, width: v } : t)); return b; }, "Track width"); }} /></label>
            <button type="button" className="n-btn" onClick={() => del(selTrack.id)}>Delete (Del)</button></section>}
          {selVia && <section><h4>Via</h4><p className="n-dim">Net {selVia.net || "—"} · drill {selVia.drill / 1e6} mm · Ø {selVia.dia / 1e6} mm</p><button type="button" className="n-btn" onClick={() => del(selVia.id)}>Delete (Del)</button></section>}
          <section><h4>Design rules {findings && <span className={nErr ? "n-err" : "n-ok"}>{nErr ? `${nErr} errors` : "clean"}</span>}</h4>
            {!findings ? <p className="n-dim">Run DRC to check clearances, connections, drills and the board edge.</p> :
              <ul className="n-drc" data-testid="pcb-drc-list">{findings.slice(0, 200).map((f, i) => <li key={i} className={f.severity} onClick={() => { const s = Math.max(view.s, 3e-5); setView({ s, x: size.W / 2 - f.at[0] * s, y: size.H / 2 - f.at[1] * s }); if (f.ids[0]) setSel(f.ids[0].split("#")[0]); }}>{f.message}</li>)}{!findings.length && <li className="ok">No problems found.</li>}</ul>}
          </section>
          <section><h4>Copper pours</h4>
            {(board.zones ?? []).map((z) => { const f = fills.find((x) => x.zone.id === z.id); return <div key={z.id} className="n-zone"><span><b>{z.net}</b> · {z.layer === "F.Cu" ? "top" : "bottom"}{z.thermal ? " · thermal" : " · solid"}<br /><small className="n-dim">{f ? `${f.polys.length} area${f.polys.length === 1 ? "" : "s"}, ${f.polys.reduce((a, p) => a + fillArea(p), 0).toFixed(0)} mm²` : ""}</small></span>
              <button type="button" className="n-btn" onClick={() => setBoard((b) => ({ ...b, zones: (b.zones ?? []).filter((x) => x.id !== z.id) }), "Remove pour")}>Remove</button></div>; })}
            <button type="button" className="n-btn" onClick={() => setZoneDlg(true)} data-testid="pcb-add-zone">Add copper pour…</button></section>
          <section><h4>Rules</h4><p className="n-dim">Clearance {board.rules.clearance / 1e6} mm · track {board.rules.track / 1e6} mm · via {board.rules.viaDrill / 1e6}/{board.rules.viaDia / 1e6} mm · edge {board.rules.edge / 1e6} mm</p><button type="button" className="n-btn" onClick={() => setSetup(true)}>Board setup…</button></section>
          <p className="n-dim n-keys">Keys: S select · X route · V via (while routing: via + change layer) · L layer · R rotate · F flip · Backspace undo segment · Esc cancel · double-click to finish · right-drag pans</p>
        </aside>
      </div>
      {zoneDlg && <ZoneDialog nets={[...new Set(pads.map((p) => p.net).filter(Boolean))].sort()} layer={layer} onClose={() => setZoneDlg(false)} onAdd={(z) => { setBoard((b) => ({ ...b, zones: [...(b.zones ?? []), { id: pid("z"), ...z }] }), "Add copper pour"); setZoneDlg(false); }} />}
      {setup && <Setup board={board} onClose={() => setSetup(false)} onSave={(b) => { setBoard(() => b, "Board setup"); setSetup(false); }} />}
      <span hidden>{dark}</span>
    </div>
  );
}

function padPath(ctx: CanvasRenderingContext2D, p: { at: P; shape: string; size: P }, X: (p: P) => readonly [number, number], s: number) {
  const [x, y] = X(p.at), w = p.size[0] * s, h = p.size[1] * s; ctx.beginPath();
  if (p.shape === "circle") ctx.arc(x, y, w / 2, 0, 7);
  else if (p.shape === "oval") { const r = Math.min(w, h) / 2; ctx.roundRect(x - w / 2, y - h / 2, w, h, r); }
  else ctx.rect(x - w / 2, y - h / 2, w, h);
}

function Setup({ board, onClose, onSave }: { board: Board; onClose: () => void; onSave: (b: Board) => void }) {
  const [x0, y0, x1, y1] = outlineBox(board);
  const [v, setV] = useState({ w: (x1 - x0) / 1e6, h: (y1 - y0) / 1e6, clearance: board.rules.clearance / 1e6, track: board.rules.track / 1e6, viaDrill: board.rules.viaDrill / 1e6, viaDia: board.rules.viaDia / 1e6, edge: board.rules.edge / 1e6, minDrill: board.rules.minDrill / 1e6, minAnnular: board.rules.minAnnular / 1e6, minTrack: board.rules.minTrack / 1e6 });
  const F = (k: keyof typeof v, label: string) => <label className="n-field"><span>{label}</span><input className="n-in" type="number" step="0.01" min="0" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} data-testid={`setup-${k}`} /></label>;
  const ok = v.w > 1 && v.h > 1 && v.viaDia > v.viaDrill && v.track > 0;
  return (
    <div className="n-modal-bg"><div className="n-modal" role="dialog" aria-label="Board setup"><h3>Board setup</h3>
      <div className="n-grid2">{F("w", "Board width (mm)")}{F("h", "Board height (mm)")}{F("clearance", "Clearance (mm)")}{F("track", "Track width (mm)")}{F("minTrack", "Minimum track (mm)")}{F("viaDrill", "Via drill (mm)")}{F("viaDia", "Via diameter (mm)")}{F("minDrill", "Minimum drill (mm)")}{F("minAnnular", "Minimum annular ring (mm)")}{F("edge", "Copper to edge (mm)")}</div>
      <div className="n-row end"><button type="button" className="n-btn" onClick={onClose}>Cancel</button><button type="button" className="n-btn primary" disabled={!ok} data-testid="setup-save" onClick={() => onSave({ ...board, outline: rectOutline(v.w, v.h), rules: { ...board.rules, clearance: mm(v.clearance), track: mm(v.track), minTrack: mm(v.minTrack), viaDrill: mm(v.viaDrill), viaDia: mm(v.viaDia), minDrill: mm(v.minDrill), minAnnular: mm(v.minAnnular), edge: mm(v.edge) } })}>Save</button></div>
    </div></div>);
}

function ZoneDialog({ nets, layer, onClose, onAdd }: { nets: string[]; layer: Layer; onClose: () => void; onAdd: (z: { net: string; layer: Layer; thermal: boolean }) => void }) {
  const [net, setNet] = useState(nets.includes("GND") ? "GND" : nets[0] ?? ""); const [l, setL] = useState<Layer>(layer); const [thermal, setThermal] = useState(true);
  return (
    <div className="n-modal-bg"><div className="n-modal" role="dialog" aria-label="Copper pour"><h3>Add copper pour</h3>
      <div className="n-grid2">
        <label className="n-field"><span>Net</span><select className="n-in" value={net} onChange={(e) => setNet(e.target.value)} data-testid="zone-net">{nets.map((n) => <option key={n}>{n}</option>)}</select></label>
        <label className="n-field"><span>Layer</span><select className="n-in" value={l} onChange={(e) => setL(e.target.value as Layer)} data-testid="zone-layer"><option value="F.Cu">Top copper</option><option value="B.Cu">Bottom copper</option></select></label>
      </div>
      <label className="n-chk" style={{ padding: "0 12px" }}><input type="checkbox" checked={thermal} onChange={(e) => setThermal(e.target.checked)} />Thermal relief on through-hole pads (easier to solder)</label>
      <p className="n-dim" style={{ padding: "0 12px" }}>Fills the whole board on that layer, keeping the clearance from other nets and the edge; areas that do not touch the net are removed.</p>
      <div className="n-row end"><button type="button" className="n-btn" onClick={onClose}>Cancel</button><button type="button" className="n-btn primary" disabled={!net} onClick={() => onAdd({ net, layer: l, thermal })} data-testid="zone-add">Add pour</button></div>
    </div></div>);
}
