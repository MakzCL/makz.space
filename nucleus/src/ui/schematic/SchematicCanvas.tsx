// The schematic editing surface. All edits go through pure ops (schematic/ops.ts) and the store's undo history.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LabelKind, Part, Pt } from "../../core/types";
import { partBox, pinsOf } from "../../core/geom";
import { device } from "../../library/devices";
import * as ops from "../../schematic/ops";
import { uid } from "../../core/project";
import { useStore } from "../store";
import { SHEET_SIZE, drawPart, drawSheet, hit, pinNear, toScreen, toWorld, type View } from "./render";
import { formatEng } from "../../core/units";
import { netAt } from "../../connectivity/connectivity";

export type Tool = { k: "select" } | { k: "place"; device: string } | { k: "wire" } | { k: "label"; kind: LabelKind } | { k: "probe" } | { k: "note" };
interface Props { tool: Tool; setTool: (t: Tool) => void; theme: import("./render").Theme; grid: number; showGrid: boolean; onCursor: (p: Pt | null) => void; onZoom: (z: number) => void; interactive: boolean; onInteract: () => void; fitSignal: number; onMenu: (x: number, y: number, items: { label: string; key?: string; onClick?: () => void; disabled?: boolean; sep?: boolean }[]) => void }
type Drag = { k: "pan"; s: Pt; v: View } | { k: "move"; p0: Pt; base: ReturnType<typeof useStore>["pr"]; ids: Set<string>; moved: boolean } | { k: "marquee"; s: Pt; e: Pt; add: boolean };

export function SchematicCanvas(P: Props) {
  const S = useStore(); const { pr, con, sel, setSel, sheet } = S;
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ W: 800, H: 600 });
  const [view, setView] = useState<View>({ s: 0.08, x: 400, y: 300 });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ rot: Part["rot"]; mirror: boolean }>({ rot: 0, mirror: false });
  const [wire, setWire] = useState<{ pts: Pt[]; vFirst: boolean } | null>(null);
  const [ask, setAsk] = useState<{ at: Pt; kind: LabelKind; s: Pt } | null>(null);
  const drag = useRef<Drag | null>(null); const [marq, setMarq] = useState<{ s: Pt; e: Pt } | null>(null);
  const theme = P.theme;
  useLayoutEffect(() => { const el = wrap.current!; const ro = new ResizeObserver(() => setSize({ W: el.clientWidth, H: el.clientHeight })); ro.observe(el); setSize({ W: el.clientWidth, H: el.clientHeight }); return () => ro.disconnect(); }, []);
  const fit = useCallback(() => {
    const items = pr.parts.filter((p) => p.sheet === sheet).map(partBox);
    for (const w of pr.wires) if (w.sheet === sheet) for (const [x, y] of w.pts) items.push({ x0: x, y0: y, x1: x, y1: y });
    const [sw, sh] = SHEET_SIZE[pr.sheets.find((s) => s.id === sheet)?.size ?? "A4"];
    const b = items.length ? { x0: Math.min(...items.map((i) => i.x0)) - 600, y0: Math.min(...items.map((i) => i.y0)) - 600, x1: Math.max(...items.map((i) => i.x1)) + 600, y1: Math.max(...items.map((i) => i.y1)) + 600 } : { x0: -sw / 2, y0: -sh / 2, x1: sw / 2, y1: sh / 2 };
    const s = Math.min(size.W / (b.x1 - b.x0), size.H / (b.y1 - b.y0));
    setView({ s, x: size.W / 2 - ((b.x0 + b.x1) / 2) * s, y: size.H / 2 - ((b.y0 + b.y1) / 2) * s });
  }, [pr, sheet, size]);
  const fitted = useRef(""); useEffect(() => { const k = `${pr.id}|${sheet}`; if (fitted.current !== k && size.W > 100) { fitted.current = k; fit(); } }, [pr.id, sheet, size.W, fit]);
  useEffect(() => { if (P.fitSignal) fit(); }, [P.fitSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { P.onZoom(view.s); }, [view.s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (S.focus && S.focus.sheet === sheet) { const s = Math.max(view.s, 0.12); setView({ s, x: size.W / 2 - S.focus.at[0] * s, y: size.H / 2 - S.focus.at[1] * s }); if (S.focus.id) setSel(new Set([S.focus.id])); } }, [S.focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapPt = useCallback((w: Pt, toPins = true): Pt => {
    if (toPins) { const pn = pinNear(pr, sheet, w, 8 / view.s + 20); if (pn) return pn; }
    return [Math.round(w[0] / P.grid) * P.grid, Math.round(w[1] / P.grid) * P.grid];
  }, [pr, sheet, view.s, P.grid]);
  const netHighlight = useMemo(() => { const one = [...sel][0]; if (!one) return null; return con.wireNet.get(one) ?? con.labelNet.get(one) ?? null; }, [sel, con]);
  const probeValues = useMemo(() => {
    const m = new Map<string, string>(); const r = S.sim; if (!r) return m;
    for (const pb of pr.probes) {
      const net = netAt(pr, con, pb.sheet, pb.at); const vv = net ? r.netV.get(net) : null;
      if (!vv) { m.set(pb.id, net ? "—" : "not on a net"); continue; }
      if (r.analysis === "op") m.set(pb.id, formatEng(vv.re[0], "V", 4));
      else if (r.analysis === "tran") m.set(pb.id, `${formatEng(vv.re[vv.re.length - 1], "V", 4)} (end)`);
      else if (r.analysis === "dc") m.set(pb.id, "see graph");
      else m.set(pb.id, `${formatEng(20 * Math.log10(Math.hypot(vv.re[vv.re.length - 1], vv.im?.[vv.re.length - 1] ?? 0)), "dB", 3)} (fmax)`);
    }
    return m;
  }, [S.sim, pr, con]);
  const marks = useMemo(() => (S.findings ?? []).filter((f) => f.sheet === sheet).map((f) => ({ at: f.at, level: f.severity, id: f.id })), [S.findings, sheet]);

  // Read-only automation hook (used by the end-to-end tests): where things are on screen. It cannot change the design.
  useEffect(() => {
    (window as unknown as { __nucleus?: unknown }).__nucleus = {
      toScreen: (x: number, y: number) => { const r = cv.current!.getBoundingClientRect(); const [sx, sy] = toScreen(view, [x, y]); return [r.left + sx, r.top + sy]; },
      pin: (ref: string, num: string) => { const p = pr.parts.find((q) => q.ref === ref); return p ? pinsOf(p).find((q) => q.num === num)?.at ?? null : null; },
      parts: () => pr.parts.map((p) => ({ ref: p.ref, device: p.device, at: p.at, props: p.props })),
    };
  });
  // ---------------------------------------------------------------- draw
  useEffect(() => {
    const c = cv.current; if (!c) return; const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(size.W * dpr) || c.height !== Math.round(size.H * dpr)) { c.width = Math.round(size.W * dpr); c.height = Math.round(size.H * dpr); }
    const ctx = c.getContext("2d")!;
    const hoverPin = cursor && (P.tool.k === "wire" || P.tool.k === "label" || P.tool.k === "probe") ? pinNear(pr, sheet, cursor, 8 / view.s + 20) : null;
    drawSheet(ctx, pr, sheet, view, size.W, size.H, { theme, sel, hover, hoverPin, netHighlight, con, grid: P.grid, showGrid: P.showGrid, probeValues, marks, focusMark: null });
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
    if (P.tool.k === "place" && cursor) { const at = snapPt(cursor, false); drawPart(ctx, { id: "ghost", ref: `${device(P.tool.device).prefix}?`, device: P.tool.device, sheet, at, rot: ghost.rot, mirror: ghost.mirror, props: { ...device(P.tool.device).defaults } }, view, { theme, sel: new Set(), hover: null, netHighlight: null, con }, true); }
    if (wire && cursor) {
      const pts = [...wire.pts, ...route(wire.pts[wire.pts.length - 1], snapPt(cursor), wire.vFirst)];
      ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y); ctx.strokeStyle = theme.hover; ctx.lineWidth = Math.max(8, 1.6 / view.s); ctx.setLineDash([30, 20]);
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.setLineDash([]);
    }
    if (marq) { const [x0, y0] = toScreen(view, marq.s), [x1, y1] = toScreen(view, marq.e); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.strokeStyle = theme.hover; ctx.fillStyle = "rgba(78,163,255,.12)"; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0); }
    if (cursor && P.tool.k !== "select") { const [x, y] = toScreen(view, snapPt(cursor, P.tool.k !== "place")); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.strokeStyle = theme.hover; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke(); }
  });

  // ---------------------------------------------------------------- input
  const world = (e: { clientX: number; clientY: number }): Pt => { const r = cv.current!.getBoundingClientRect(); return toWorld(view, e.clientX - r.left, e.clientY - r.top); };
  const tol = 6 / view.s + 10;
  const finishWire = (pts: Pt[]) => { setWire(null); if (pts.length < 2) return; S.change((p) => ops.addWire(p, sheet, pts).pr, "Wire"); };
  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const w = world(e);
    if (e.button === 1 || (e.button === 0 && e.altKey)) { drag.current = { k: "pan", s: [e.clientX, e.clientY], v: view }; return; }
    const t = P.tool;
    if (t.k === "place") { const at = snapPt(w, false); let id = ""; S.change((p) => { const r = ops.addPart(p, t.device, sheet, at, ghost.rot, ghost.mirror); id = r.id; return r.pr; }, `Place ${t.device}`); setSel(new Set([id])); return; }
    if (t.k === "wire") {
      const p = snapPt(w);
      if (!wire) { setWire({ pts: [p], vFirst: false }); return; }
      const last = wire.pts[wire.pts.length - 1]; const pts = [...wire.pts, ...route(last, p, wire.vFirst)];
      const onPin = pinNear(pr, sheet, p, 1); const onWire = ops.wireHit(pr, sheet, p);
      if ((onPin || onWire) && pts.length > 1) finishWire(pts); else setWire({ ...wire, pts });
      return;
    }
    if (t.k === "label") { const p = snapPt(w); if (t.kind === "ground") S.change((x) => ops.addLabel(x, { sheet, at: p, rot: 0, name: "GND", kind: "ground" }).pr, "Ground"); else { const r = cv.current!.getBoundingClientRect(); setAsk({ at: p, kind: t.kind, s: [e.clientX - r.left, e.clientY - r.top] }); } return; }
    if (t.k === "probe") { const p = snapPt(w); const n = pr.probes.length + 1; S.change((x) => ({ ...x, probes: [...x.probes, { id: uid("pb"), sheet, at: p, kind: "voltage", name: `P${n}` }] }), "Voltage probe"); return; }
    // select
    const h = hit(pr, sheet, w, tol);
    if (h) {
      const part = h.kind === "part" ? pr.parts.find((p) => p.id === h.id) : null;
      if (P.interactive && part && device(part.device).interactive === "switch") { S.change((x) => ops.setState(x, part.id, { closed: !part.state?.closed }), `${part.ref} ${part.state?.closed ? "open" : "closed"}`); P.onInteract(); return; }
      let ids = sel.has(h.id) ? sel : new Set([h.id]);
      if (e.shiftKey || e.ctrlKey) { ids = new Set(sel); if (ids.has(h.id)) ids.delete(h.id); else ids.add(h.id); setSel(ids); return; }
      setSel(ids); drag.current = { k: "move", p0: w, base: pr, ids, moved: false }; return;
    }
    if (!e.shiftKey) setSel(new Set());
    drag.current = { k: "marquee", s: w, e: w, add: e.shiftKey }; setMarq({ s: w, e: w });
  };
  const onMove = (e: React.PointerEvent) => {
    const w = world(e); setCursor(w); P.onCursor(snapPt(w, P.tool.k !== "place" && P.tool.k !== "select"));
    const d = drag.current;
    if (!d) { if (P.tool.k === "select") { const h = hit(pr, sheet, w, tol); setHover(h?.id ?? null); } return; }
    if (d.k === "pan") { setView({ ...d.v, x: d.v.x + e.clientX - d.s[0], y: d.v.y + e.clientY - d.s[1] }); return; }
    if (d.k === "marquee") { d.e = w; setMarq({ s: d.s, e: w }); return; }
    const dx = Math.round((w[0] - d.p0[0]) / P.grid) * P.grid, dy = Math.round((w[1] - d.p0[1]) / P.grid) * P.grid;
    if (dx || dy || d.moved) { d.moved = true; S.setPreview(ops.moveItems(d.base, d.ids, dx, dy)); }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (d.k === "move" && d.moved) { const w = world(e); const dx = Math.round((w[0] - d.p0[0]) / P.grid) * P.grid, dy = Math.round((w[1] - d.p0[1]) / P.grid) * P.grid; S.setPreview(null); if (dx || dy) S.change(() => ops.moveItems(d.base, d.ids, dx, dy), "Move"); }
    if (d.k === "marquee") {
      setMarq(null); const x0 = Math.min(d.s[0], d.e[0]), x1 = Math.max(d.s[0], d.e[0]), y0 = Math.min(d.s[1], d.e[1]), y1 = Math.max(d.s[1], d.e[1]);
      if (x1 - x0 > 1 || y1 - y0 > 1) {
        const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        const ids = new Set(d.add ? sel : []);
        for (const p of pr.parts) if (p.sheet === sheet) { const b = partBox(p); if (inside(b.x0, b.y0) && inside(b.x1, b.y1)) ids.add(p.id); }
        for (const w of pr.wires) if (w.sheet === sheet && w.pts.every(([x, y]) => inside(x, y))) ids.add(w.id);
        for (const l of pr.labels) if (l.sheet === sheet && inside(...l.at)) ids.add(l.id);
        for (const l of pr.probes) if (l.sheet === sheet && inside(...l.at)) ids.add(l.id);
        setSel(ids);
      }
    }
  };
  const onDouble = (e: React.MouseEvent) => {
    if (wire) { finishWire(wire.pts); return; }
    const h = hit(pr, sheet, world(e), tol); if (h) { setSel(new Set([h.id])); document.querySelector<HTMLInputElement>("[data-inspector-first]")?.focus(); }
  };
  useEffect(() => {
    const c = cv.current!; const wh = (e: WheelEvent) => { e.preventDefault(); const r = c.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top; setView((v) => { const s = Math.max(0.005, Math.min(2, v.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); return { s, x: sx - ((sx - v.x) * s) / v.s, y: sy - ((sy - v.y) * s) / v.s }; }); };
    c.addEventListener("wheel", wh, { passive: false }); return () => c.removeEventListener("wheel", wh);
  }, []);
  // keys handled here belong to the canvas; global ones are in the shortcut registry
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select") || document.querySelector(".n-modal")) return;
      const key = e.key.toLowerCase();
      if (e.key === "Escape") { if (wire) { setWire(null); return; } if (P.tool.k !== "select") { P.setTool({ k: "select" }); return; } setSel(new Set()); return; }
      if (e.key === " " && wire) { e.preventDefault(); setWire({ ...wire, vFirst: !wire.vFirst }); return; }
      if (e.key === "Enter" && wire) { finishWire(wire.pts); return; }
      if (P.tool.k === "place" && !e.ctrlKey) { if (key === "r") setGhost((g) => ({ ...g, rot: ((g.rot + 90) % 360) as Part["rot"] })); if (key === "x") setGhost((g) => ({ ...g, mirror: !g.mirror })); return; }
      if (e.key === "F6") { e.preventDefault(); zoomBy(1.4); } else if (e.key === "F7") { e.preventDefault(); zoomBy(1 / 1.4); } else if (e.key === "F8") { e.preventDefault(); fit(); }
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  const zoomBy = (f: number) => setView((v) => { const s = Math.max(0.005, Math.min(2, v.s * f)); const cx = cursor ? toScreen(v, cursor) : [size.W / 2, size.H / 2]; return { s, x: cx[0] - ((cx[0] - v.x) * s) / v.s, y: cx[1] - ((cx[1] - v.y) * s) / v.s }; });
  const ctxMenu = (e: React.MouseEvent) => {
    e.preventDefault(); const h = hit(pr, sheet, world(e), tol);
    let ids = sel; if (h && !sel.has(h.id)) { ids = new Set([h.id]); setSel(ids); }
    const n = ids.size;
    P.onMenu(e.clientX, e.clientY, n ? [
      { label: "Rotate 90° anticlockwise", key: "R", onClick: () => S.change((p) => ops.rotateParts(p, ids), "Rotate") },
      { label: "Rotate 90° clockwise", key: "Shift+R", onClick: () => S.change((p) => ops.rotateParts(p, ids, false), "Rotate") },
      { label: "Mirror", key: "X", onClick: () => S.change((p) => ops.mirrorParts(p, ids), "Mirror") },
      { sep: true, label: "" },
      { label: "Duplicate", key: "Ctrl+D", onClick: () => { let out: string[] = []; S.change((p) => { const r = ops.duplicate(p, ids, [400, 400]); out = r.ids; return r.pr; }, "Duplicate"); setSel(new Set(out)); } },
      { label: "Delete", key: "Del", onClick: () => { S.change((p) => ops.deleteItems(p, ids), "Delete"); setSel(new Set()); } },
      { sep: true, label: "" },
      { label: h?.kind === "wire" ? `Highlight net ${con.wireNet.get(h.id)}` : "Properties", onClick: () => document.querySelector<HTMLInputElement>("[data-inspector-first]")?.focus() },
    ] : [
      { label: "Zoom to fit", key: "F8", onClick: fit }, { label: "Zoom in", key: "F6", onClick: () => zoomBy(1.4) }, { label: "Zoom out", key: "F7", onClick: () => zoomBy(1 / 1.4) },
    ]);
  };
  const cursorCss = P.tool.k === "select" ? (drag.current?.k === "pan" ? "grabbing" : hover ? "move" : "default") : "crosshair";
  return (
    <div className="n-canvas" ref={wrap} data-testid="schematic">
      <canvas ref={cv} style={{ width: size.W, height: size.H, cursor: cursorCss }} data-testid="schematic-canvas"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble} onContextMenu={ctxMenu} onPointerLeave={() => { setCursor(null); P.onCursor(null); setHover(null); }} />
      {wire && <div className="n-hint">Wire: click corners, click a pin or wire to finish · Space flips the bend · Enter/double-click ends · Esc cancels</div>}
      {P.tool.k === "place" && <div className="n-hint">Placing {P.tool.device}: click to place · R rotate · X mirror · Esc done</div>}
      {ask && <LabelAsk kind={ask.kind} s={ask.s} onCancel={() => setAsk(null)} onDone={(name) => { const a = ask; setAsk(null); if (!name.trim()) return; S.change((x) => ops.addLabel(x, { sheet, at: a.at, rot: 0, name: name.trim(), kind: a.kind }).pr, a.kind === "power" ? "Power terminal" : "Net label"); }} />}
    </div>
  );
}
/** Orthogonal route from a to b: one bend. */
export function route(a: Pt, b: Pt, vFirst: boolean): Pt[] {
  if (a[0] === b[0] || a[1] === b[1]) return [b];
  return vFirst ? [[a[0], b[1]], b] : [[b[0], a[1]], b];
}
function LabelAsk({ kind, s, onDone, onCancel }: { kind: LabelKind; s: Pt; onDone: (n: string) => void; onCancel: () => void }) {
  const [t, setT] = useState(kind === "power" ? "VCC" : "");
  return <input className="n-ask" autoFocus value={t} placeholder={kind === "power" ? "Supply name (e.g. VCC, +5V)" : "Net name"} style={{ left: s[0] + 10, top: s[1] - 14 }} data-testid="label-input"
    onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onDone(t); if (e.key === "Escape") onCancel(); }} onBlur={() => onDone(t)} />;
}
