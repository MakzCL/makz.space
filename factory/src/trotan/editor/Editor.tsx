// DESIGN workspace: the vector editor. Canvas 2D view over the document model; every edit goes through
// pure functions in actions.ts and the session (undo/redo, autosave). Units are millimetres throughout.
import { Circle, Hand, Hexagon, MousePointer2, PenTool, Pencil, Slash, Spline, Square, Type, Upload } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "../../components/Toast";
import { I, dist, findObj, transformPaths, uid, type Doc, type Layer, type Mat, type Obj, type PathObj, type SubPath, type Vec } from "../geom/core";
import { loadFont, textOutline } from "../geom/text";
import { errText } from "../data";
import { useSession } from "../session";
import { Menu, Modal, type MenuItem } from "../ui";
import * as A from "./actions";
import { ACCEPT, IMPORT_FORMATS, exportAs, importFile } from "./io";
import { RULER, canvasTheme, type Palette, drawDoc, drawRulers, hitTest, toScreen, toWorld, type View } from "./render";
import { simplify, snapBox, snapPoint, targets, type SnapLines, type SnapOpts } from "./snap";
import { Panels } from "./Panels";
import { useSplit } from "../ui";

export type Tool = "select" | "node" | "pen" | "pencil" | "line" | "rect" | "ellipse" | "polygon" | "text" | "hand";
const TOOLS: { t: Tool; key: string; label: string; icon: ReactNode }[] = [
  { t: "select", key: "V", label: "Select / transform", icon: <MousePointer2 size={17} /> },
  { t: "node", key: "A", label: "Edit nodes", icon: <Spline size={17} /> },
  { t: "pen", key: "P", label: "Pen (click = corner, drag = curve)", icon: <PenTool size={17} /> },
  { t: "pencil", key: "B", label: "Pencil (freehand)", icon: <Pencil size={17} /> },
  { t: "line", key: "L", label: "Line", icon: <Slash size={17} /> },
  { t: "rect", key: "R", label: "Rectangle", icon: <Square size={17} /> },
  { t: "ellipse", key: "E", label: "Ellipse", icon: <Circle size={17} /> },
  { t: "polygon", key: "Y", label: "Polygon / star", icon: <Hexagon size={17} /> },
  { t: "text", key: "T", label: "Text (outlined Poppins)", icon: <Type size={17} /> },
  { t: "hand", key: "H", label: "Pan (or hold Space)", icon: <Hand size={17} /> },
];
let clipboard: Obj[] = [];
const HANDLES: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
const CURSORS = ["nwse-resize", "ns-resize", "nesw-resize", "ew-resize", "nwse-resize", "ns-resize", "nesw-resize", "ew-resize"];
type Drag =
  | { k: "pan"; s: Vec; v: View }
  | { k: "move"; p0: Vec; base: Doc; ids: string[]; label: string }
  | { k: "scale"; p0: Vec; base: Doc; ids: string[]; h: number; b: { x: number; y: number; w: number; h: number } }
  | { k: "rotate"; p0: Vec; base: Doc; ids: string[]; c: Vec }
  | { k: "marquee"; s: Vec; e: Vec; add: boolean }
  | { k: "node"; p0: Vec; base: Doc; ref: A.NodeRef; part: "p" | "in" | "out" }
  | { k: "create"; p0: Vec; base: Doc; id: string; tool: Tool; moved: boolean }
  | { k: "pencil"; pts: Vec[]; base: Doc; id: string }
  | { k: "guide"; axis: "x" | "y"; index: number | null; at: number }
  | { k: "pen" };
interface PenPt { p: Vec; inH?: Vec; outH?: Vec }
const loadPref = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };

export function Editor({ palette, readOnly }: { palette: Palette; readOnly: boolean }) {
  const S = useSession(); const toast = useToast();
  const { doc, sel, setSel } = S;
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), fileIn = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState({ W: 800, H: 600 });
  const [view, setView] = useState<View>({ zoom: 1, x: 60, y: 60 });
  const [tool, setToolS] = useState<Tool>("select");
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [nodeSel, setNodeSel] = useState<A.NodeRef | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [textAt, setTextAt] = useState<{ p: Vec; s: Vec } | null>(null);
  const [opts, setOpts] = useState(() => loadPref("trotan-editor", { grid: 10, showGrid: true, toGrid: false, toObjects: true, toGuides: true, outline: false, polySides: 6, star: 0, font: "Poppins", textSize: 10 }));
  const [activeLayer, setActiveLayer] = useState<string>(doc.layers[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  /** Import review: shown when an import skipped content, so the loss is seen before anything is added. */
  const [review, setReview] = useState<{ file: string; what: string; count: number; notes: string[]; done: (ok: boolean) => void } | null>(null);
  const askReview = (file: string, what: string, count: number, notes: string[]) => new Promise<boolean>((done) => setReview({ file, what, count, notes, done }));
  const [space, setSpace] = useState(false);
  const drag = useRef<Drag | null>(null), marquee = useRef<{ s: Vec; e: Vec } | null>(null), snapL = useRef<SnapLines>({ x: null, y: null });
  const pen = useRef<PenPt[]>([]); const [, bump] = useState(0);
  const fitted = useRef<string | null>(null);
  const split = useSplit("editor-right", 300, 240, 520);
  const theme = canvasTheme(palette);
  useEffect(() => { try { localStorage.setItem("trotan-editor", JSON.stringify(opts)); } catch { /* ignore */ } }, [opts]);
  useEffect(() => { if (!doc.layers.some((l) => l.id === activeLayer)) setActiveLayer(doc.layers.find((l) => l.op === "cut")?.id ?? doc.layers[0]?.id ?? ""); }, [doc.layers, activeLayer]);

  const edit = useCallback((fn: (d: Doc) => Doc, label: string) => { if (readOnly) { toast("You can view this design but not change it", "info"); return; } try { S.change(fn, label); } catch (e) { toast(errText(e), "error"); } }, [S, readOnly, toast]);
  /** Run an action that also returns new selection ids. */
  const editSel = useCallback((fn: (d: Doc) => { doc: Doc; ids?: string[]; id?: string | null }, label: string) => {
    if (readOnly) { toast("You can view this design but not change it", "info"); return; }
    try { const r = fn(S.doc); S.change(() => r.doc, label); setSel(r.ids ?? (r.id ? [r.id] : [])); } catch (e) { toast(errText(e), "error"); }
  }, [S, readOnly, setSel, toast]);

  /* ------------------------------------------------------------------ view */
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ W: el.clientWidth, H: el.clientHeight })); ro.observe(el);
    setSize({ W: el.clientWidth, H: el.clientHeight }); return () => ro.disconnect();
  }, []);
  const fit = useCallback(() => {
    const { W, H } = size; const pad = 40;
    const z = Math.min((W - RULER - pad * 2) / doc.width, (H - RULER - pad * 2) / doc.height);
    const zoom = Math.max(0.02, z); setView({ zoom, x: RULER + (W - RULER - doc.width * zoom) / 2, y: RULER + (H - RULER - doc.height * zoom) / 2 });
  }, [size, doc.width, doc.height]);
  useEffect(() => { const k = S.project?.id ?? "none"; if (fitted.current !== k && size.W > 100) { fitted.current = k; fit(); } }, [S.project?.id, size.W, fit]);
  const zoomAt = (f: number, sx = size.W / 2, sy = size.H / 2) => setView((v) => { const z = Math.max(0.02, Math.min(400, v.zoom * f)); return { zoom: z, x: sx - ((sx - v.x) * z) / v.zoom, y: sy - ((sy - v.y) * z) / v.zoom }; });
  const zoomTo = (z: number) => setView((v) => { const sx = size.W / 2, sy = size.H / 2; return { zoom: z, x: sx - ((sx - v.x) * z) / v.zoom, y: sy - ((sy - v.y) * z) / v.zoom }; });

  /* ---------------------------------------------------------------- render */
  const st = useRef({ doc, view, sel, hover, tool, nodeSel, opts, theme, size, cursor });
  st.current = { doc, view, sel, hover, tool, nodeSel, opts, theme, size, cursor };
  const raf = useRef(0);
  const draw = useCallback(() => {
    raf.current = 0;
    const c = cv.current; if (!c) return;
    const { doc: d, view: v, sel: s, hover: h, tool: t, nodeSel: ns, opts: o, theme: th, size: { W, H }, cursor: cur } = st.current;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext("2d")!; ctx.save(); ctx.scale(dpr, dpr);
    const vv = { ...v, x: v.x, y: v.y };
    // drawDoc sets its own transform, so fold the device pixel ratio in
    drawDoc(ctx, d, { zoom: vv.zoom * dpr, x: vv.x * dpr, y: vv.y * dpr }, W * dpr, H * dpr, { theme: th, sel: new Set(s), hover: h, grid: o.grid, showGrid: o.showGrid, outline: o.outline, fills: true, redraw: () => req() });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // guides
    ctx.lineWidth = 1; ctx.strokeStyle = th.guide; ctx.setLineDash([5, 4]);
    for (const g of d.guides) { ctx.beginPath(); if (g.axis === "x") { const x = Math.round(g.at * v.zoom + v.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); } else { const y = Math.round(g.at * v.zoom + v.y) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke(); }
    ctx.setLineDash([]);
    const dg = drag.current;
    if (dg?.k === "guide") { ctx.strokeStyle = th.guide; ctx.beginPath(); if (dg.axis === "x") { const x = dg.at * v.zoom + v.x; ctx.moveTo(x, 0); ctx.lineTo(x, H); } else { const y = dg.at * v.zoom + v.y; ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke(); }
    // selection
    const b = A.selBox(d, s);
    if (b && (t === "select" || t === "hand")) {
      const [x0, y0] = toScreen(v, [b.x, b.y]), [x1, y1] = toScreen(v, [b.x + b.w, b.y + b.h]);
      ctx.strokeStyle = th.sel; ctx.setLineDash([4, 3]); ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0); ctx.setLineDash([]);
      if (!readOnly) {
        ctx.fillStyle = th.page; ctx.strokeStyle = th.sel;
        for (const [hx, hy] of HANDLES) { const x = x0 + (x1 - x0) * hx, y = y0 + (y1 - y0) * hy; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); }
        const rx = (x0 + x1) / 2, ry = y0 - 22; ctx.beginPath(); ctx.moveTo(rx, y0); ctx.lineTo(rx, ry + 5); ctx.stroke(); ctx.beginPath(); ctx.arc(rx, ry, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // nodes
    if (t === "node") for (const id of s) {
      const o = findObj(d.objects, id); if (!o || o.kind !== "path") continue;
      for (const n of A.nodesOf(o)) {
        const [x, y] = toScreen(v, n.p);
        ctx.strokeStyle = th.sel; ctx.lineWidth = 1;
        for (const hnd of [n.in, n.out]) if (hnd) { const [hx, hy] = toScreen(v, hnd); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke(); ctx.beginPath(); ctx.arc(hx, hy, 3.5, 0, Math.PI * 2); ctx.fillStyle = th.page; ctx.fill(); ctx.stroke(); }
        const on = ns && ns.obj === id && ns.sp === n.sp && ns.node === n.node;
        ctx.fillStyle = on ? th.sel : th.page; ctx.fillRect(x - 4, y - 4, 8, 8); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }
    }
    // pen in progress
    if (t === "pen" && pen.current.length) {
      const sp = penPath(pen.current, false); ctx.save(); ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);
      ctx.lineWidth = 1.5 / v.zoom; ctx.strokeStyle = th.sel; ctx.stroke(new Path2D(spData(sp)));
      if (cur && !(drag.current?.k === "pen")) { const l = pen.current[pen.current.length - 1]; ctx.setLineDash([4 / v.zoom, 3 / v.zoom]); ctx.beginPath(); ctx.moveTo(l.p[0], l.p[1]); ctx.lineTo(cur[0], cur[1]); ctx.stroke(); ctx.setLineDash([]); }
      ctx.restore();
      for (const q of pen.current) { const [x, y] = toScreen(v, q.p); ctx.fillStyle = th.page; ctx.strokeStyle = th.sel; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); if (q.outH) { const [hx, hy] = toScreen(v, q.outH); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hx, hy); ctx.stroke(); } }
    }
    // marquee + snap lines
    if (marquee.current) { const [x0, y0] = toScreen(v, marquee.current.s), [x1, y1] = toScreen(v, marquee.current.e); ctx.fillStyle = "rgba(58,160,255,.10)"; ctx.strokeStyle = th.sel; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0); }
    const sl = snapL.current; if (drag.current && (sl.x != null || sl.y != null)) { ctx.strokeStyle = "#ff2fb4"; ctx.lineWidth = 1; ctx.beginPath(); if (sl.x != null) { const x = Math.round(sl.x * v.zoom + v.x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); } if (sl.y != null) { const y = Math.round(sl.y * v.zoom + v.y) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke(); }
    drawRulers(ctx, v, W, H, th, cur);
    ctx.restore();
  }, [readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const req = useCallback(() => { if (!raf.current) raf.current = requestAnimationFrame(draw); }, [draw]);
  useEffect(() => { req(); });
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ------------------------------------------------------------- helpers */
  const world = (e: { clientX: number; clientY: number }): Vec => { const r = cv.current!.getBoundingClientRect(); return toWorld(view, e.clientX - r.left, e.clientY - r.top); };
  const screen = (e: { clientX: number; clientY: number }): Vec => { const r = cv.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const snapOpts: SnapOpts = { grid: opts.grid, toGrid: opts.toGrid, toObjects: opts.toObjects, toGuides: opts.toGuides };
  const tol = 6 / view.zoom;
  const snapP = (p: Vec, exclude: string[] = [], free = false): Vec => { if (free) { snapL.current = { x: null, y: null }; return p; } const r = snapPoint(p, targets(doc, new Set(exclude), snapOpts), tol, snapOpts); snapL.current = r.lines; return r.p; };
  const layerFor = (): Layer | undefined => doc.layers.find((l) => l.id === activeLayer && !l.locked) ?? doc.layers.find((l) => !l.locked);
  const setTool = useCallback((t: Tool) => { if (pen.current.length) finishPen(false); setToolS(t); setNodeSel(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAt(sp: Vec): number | "rot" | null {
    const b = A.selBox(doc, sel); if (!b || readOnly) return null;
    const [x0, y0] = toScreen(view, [b.x, b.y]), [x1, y1] = toScreen(view, [b.x + b.w, b.y + b.h]);
    if (Math.hypot(sp[0] - (x0 + x1) / 2, sp[1] - (y0 - 22)) < 8) return "rot";
    for (let i = 0; i < HANDLES.length; i++) { const [hx, hy] = HANDLES[i]; if (Math.abs(sp[0] - (x0 + (x1 - x0) * hx)) < 7 && Math.abs(sp[1] - (y0 + (y1 - y0) * hy)) < 7) return i; }
    return null;
  }
  function nodeAt(sp: Vec): { ref: A.NodeRef; part: "p" | "in" | "out" } | null {
    for (const id of sel) {
      const o = findObj(doc.objects, id); if (!o || o.kind !== "path") continue;
      for (const n of A.nodesOf(o)) {
        for (const part of ["in", "out"] as const) { const h = n[part]; if (h) { const [x, y] = toScreen(view, h); if (Math.hypot(sp[0] - x, sp[1] - y) < 6) return { ref: { obj: id, sp: n.sp, node: n.node }, part }; } }
        const [x, y] = toScreen(view, n.p); if (Math.hypot(sp[0] - x, sp[1] - y) < 7) return { ref: { obj: id, sp: n.sp, node: n.node }, part: "p" };
      }
    }
    return null;
  }
  function segmentAt(p: Vec): { obj: string; sp: number; seg: number; t: number } | null {
    let best: { obj: string; sp: number; seg: number; t: number; d: number } | null = null;
    for (const id of sel) {
      const o = findObj(doc.objects, id); if (!o || o.kind !== "path") continue;
      transformPaths(o.paths, o.m).forEach((s, si) => {
        let p0 = s.start;
        s.segs.forEach((g, gi) => {
          for (let k = 1; k < 40; k++) {
            const t = k / 40, u = 1 - t;
            const q: Vec = g.k === "L" ? [p0[0] + (g.p[0] - p0[0]) * t, p0[1] + (g.p[1] - p0[1]) * t]
              : [u * u * u * p0[0] + 3 * u * u * t * g.c1![0] + 3 * u * t * t * g.c2![0] + t * t * t * g.p[0], u * u * u * p0[1] + 3 * u * u * t * g.c1![1] + 3 * u * t * t * g.c2![1] + t * t * t * g.p[1]];
            const dd = dist(q, p); if (dd < tol && (!best || dd < best.d)) best = { obj: id, sp: si, seg: gi, t, d: dd };
          }
          p0 = g.p;
        });
      });
    }
    return best;
  }
  function guideAt(sp: Vec): number | null {
    for (let i = doc.guides.length - 1; i >= 0; i--) { const g = doc.guides[i]; const s = g.axis === "x" ? g.at * view.zoom + view.x : g.at * view.zoom + view.y; if (Math.abs((g.axis === "x" ? sp[0] : sp[1]) - s) < 4) return i; }
    return null;
  }
  function finishPen(close: boolean) {
    const pts = pen.current; pen.current = []; bump((n) => n + 1);
    if (pts.length < 2) return;
    const l = layerFor(); if (!l) { toast("Unlock a layer to draw on", "error"); return; }
    const o: PathObj = { id: uid(), layer: l.id, kind: "path", m: [...I] as Mat, paths: [penPath(pts, close)] };
    edit((d) => ({ ...d, objects: [...d.objects, o] }), "Pen path"); setSel([o.id]);
  }

  /* -------------------------------------------------------------- pointer */
  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const sp = screen(e), p = world(e);
    if (e.button === 1 || space || tool === "hand") { drag.current = { k: "pan", s: sp, v: view }; return; }
    if (sp[0] < RULER || sp[1] < RULER) { if (!readOnly && !(sp[0] < RULER && sp[1] < RULER)) drag.current = { k: "guide", axis: sp[1] < RULER ? "y" : "x", index: null, at: sp[1] < RULER ? p[1] : p[0] }; return; }
    if (readOnly && tool !== "select") return;
    if (tool === "select") {
      const h = handleAt(sp);
      if (h === "rot") { const b = A.selBox(doc, sel)!; drag.current = { k: "rotate", p0: p, base: doc, ids: sel, c: [b.x + b.w / 2, b.y + b.h / 2] }; return; }
      if (h != null) { drag.current = { k: "scale", p0: p, base: doc, ids: sel, h, b: A.selBox(doc, sel)! }; return; }
      const ctx = cv.current!.getContext("2d")!;
      const hit = hitTest(ctx, doc, p, 4 / view.zoom);
      if (hit) {
        let ids = sel.includes(hit) ? sel : [hit];
        if (e.shiftKey) { ids = sel.includes(hit) ? sel.filter((x) => x !== hit) : [...sel, hit]; setSel(ids); return; }
        setSel(ids);
        if (readOnly) return;
        let base = doc;
        if (e.altKey) { const r = A.duplicateSel(doc, ids, 0, 0); base = r.doc; ids = r.ids; setSel(ids); }
        drag.current = { k: "move", p0: p, base, ids, label: e.altKey ? "Duplicate" : "Move" };
        return;
      }
      const gi = guideAt(sp);
      if (gi != null && !readOnly) { const g = doc.guides[gi]; drag.current = { k: "guide", axis: g.axis, index: gi, at: g.at }; return; }
      if (!e.shiftKey) setSel([]);
      marquee.current = { s: p, e: p }; drag.current = { k: "marquee", s: p, e: p, add: e.shiftKey }; return;
    }
    if (tool === "node") {
      const n = nodeAt(sp);
      if (n) { setNodeSel(n.ref); drag.current = { k: "node", p0: p, base: doc, ref: n.ref, part: n.part }; return; }
      const hit = hitTest(cv.current!.getContext("2d")!, doc, p, 4 / view.zoom);
      setNodeSel(null); setSel(hit ? [hit] : []);
      return;
    }
    if (tool === "pen") {
      const q = snapP(p, [], e.altKey);
      if (pen.current.length >= 2 && dist(toScreen(view, q), toScreen(view, pen.current[0].p)) < 8) { finishPen(true); return; }
      pen.current = [...pen.current, { p: q }]; drag.current = { k: "pen" }; bump((n) => n + 1); return;
    }
    if (tool === "text") { setTextAt({ p: snapP(p, [], e.altKey), s: sp }); return; }
    const l = layerFor(); if (!l) { toast("Unlock a layer to draw on", "error"); return; }
    if (tool === "pencil") { drag.current = { k: "pencil", pts: [p], base: doc, id: uid() }; return; }
    drag.current = { k: "create", p0: snapP(p, [], e.altKey), base: doc, id: uid(), tool, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const sp = screen(e), p = world(e); setCursor(p);
    const dg = drag.current;
    if (!dg) {
      if (tool === "select" && sp[0] > RULER && sp[1] > RULER) { const h = hitTest(cv.current!.getContext("2d")!, doc, p, 4 / view.zoom); if (h !== hover) setHover(h); }
      else if (tool === "pen") req();
      return;
    }
    switch (dg.k) {
      case "pan": setView({ ...dg.v, x: dg.v.x + sp[0] - dg.s[0], y: dg.v.y + sp[1] - dg.s[1] }); return;
      case "guide": dg.at = dg.axis === "x" ? p[0] : p[1]; req(); return;
      case "marquee": dg.e = p; marquee.current = { s: dg.s, e: p }; req(); return;
      case "move": {
        let dx = p[0] - dg.p0[0], dy = p[1] - dg.p0[1];
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const b = A.selBox(dg.base, dg.ids);
        if (b && !e.altKey) { const r = snapBox({ ...b, x: b.x + dx, y: b.y + dy }, targets(dg.base, new Set(dg.ids), snapOpts), tol, snapOpts); dx += r.dx; dy += r.dy; snapL.current = r.lines; } else snapL.current = { x: null, y: null };
        S.setDraft(A.moveSel(dg.base, dg.ids, dx, dy)); return;
      }
      case "scale": {
        const [hx, hy] = HANDLES[dg.h], b = dg.b;
        const q = snapP(p, dg.ids, e.ctrlKey);
        const center = e.altKey;
        const ax = center ? b.x + b.w / 2 : b.x + b.w * (1 - hx), ay = center ? b.y + b.h / 2 : b.y + b.h * (1 - hy);
        const fx = b.x + b.w * hx, fy = b.y + b.h * hy;
        let sx = hx === 0.5 || Math.abs(fx - ax) < 1e-9 ? 1 : (q[0] - ax) / (fx - ax), sy = hy === 0.5 || Math.abs(fy - ay) < 1e-9 ? 1 : (q[1] - ay) / (fy - ay);
        if (e.shiftKey) { const s = Math.max(Math.abs(hx === 0.5 ? sy : sx), Math.abs(hy === 0.5 ? sx : sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
        if (Math.abs(sx) < 1e-4) sx = 1e-4 * Math.sign(sx || 1); if (Math.abs(sy) < 1e-4) sy = 1e-4 * Math.sign(sy || 1);
        S.setDraft(A.scaleSel(dg.base, dg.ids, sx, sy, [ax, ay])); return;
      }
      case "rotate": {
        let deg = ((Math.atan2(p[1] - dg.c[1], p[0] - dg.c[0]) - Math.atan2(dg.p0[1] - dg.c[1], dg.p0[0] - dg.c[0])) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        S.setDraft(A.rotateSel(dg.base, dg.ids, deg, dg.c)); return;
      }
      case "node": { const q = snapP(p, [], e.altKey); S.setDraft(A.moveNode(dg.base, dg.ref, dg.part, [q[0] - dg.p0[0], q[1] - dg.p0[1]])); return; }
      case "pen": { const l = pen.current[pen.current.length - 1]; if (l && dist(toScreen(view, p), toScreen(view, l.p)) > 3) { l.outH = p; l.inH = [2 * l.p[0] - p[0], 2 * l.p[1] - p[1]]; } req(); return; }
      case "pencil": { dg.pts.push(p); const l = layerFor()!; S.setDraft({ ...dg.base, objects: [...dg.base.objects, { id: dg.id, layer: l.id, kind: "path", m: [...I] as Mat, paths: [{ start: dg.pts[0], closed: false, segs: dg.pts.slice(1).map((q) => ({ k: "L" as const, p: q })) }] }] }); return; }
      case "create": {
        const q = snapP(p, [], e.altKey); dg.moved = dg.moved || dist(toScreen(view, q), toScreen(view, dg.p0)) > 3;
        const o = shapeFrom(dg.tool, dg.p0, q, e.shiftKey, dg.id, layerFor()!.id, opts);
        if (o) S.setDraft({ ...dg.base, objects: [...dg.base.objects, o] }); return;
      }
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const dg = drag.current; drag.current = null; snapL.current = { x: null, y: null };
    if (!dg) return;
    switch (dg.k) {
      case "guide": {
        const sp = screen(e), off = (dg.axis === "x" ? sp[0] : sp[1]) < RULER;
        if (dg.index == null) { if (!off) edit((d) => ({ ...d, guides: [...d.guides, { axis: dg.axis, at: Math.round(dg.at * 100) / 100 }] }), "Add guide"); }
        else edit((d) => ({ ...d, guides: off ? d.guides.filter((_, i) => i !== dg.index) : d.guides.map((g, i) => (i === dg.index ? { ...g, at: Math.round(dg.at * 100) / 100 } : g)) }), off ? "Remove guide" : "Move guide");
        req(); return;
      }
      case "marquee": {
        marquee.current = null;
        const x0 = Math.min(dg.s[0], dg.e[0]), x1 = Math.max(dg.s[0], dg.e[0]), y0 = Math.min(dg.s[1], dg.e[1]), y1 = Math.max(dg.s[1], dg.e[1]);
        if (x1 - x0 > 1e-6 || y1 - y0 > 1e-6) {
          const locked = new Set(doc.layers.filter((l) => l.locked || !l.visible).map((l) => l.id));
          const ids = doc.objects.filter((o) => { if (o.locked || o.hidden || locked.has(o.layer)) return false; const b = A.selBox(doc, [o.id]); return b && b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1; }).map((o) => o.id);
          setSel(dg.add ? [...new Set([...sel, ...ids])] : ids);
        }
        req(); return;
      }
      case "move": if (S.draft) S.commitDraft(dg.label); return;
      case "scale": if (S.draft) S.commitDraft("Scale"); return;
      case "rotate": if (S.draft) S.commitDraft("Rotate"); return;
      case "node": if (S.draft) S.commitDraft("Edit node"); return;
      case "pen": { const l = pen.current[pen.current.length - 1]; if (l?.outH && dist(toScreen(view, l.outH), toScreen(view, l.p)) < 3) { l.outH = undefined; l.inH = undefined; } req(); return; }
      case "pencil": {
        S.setDraft(null);
        const pts = simplify(dg.pts, 1.5 / view.zoom); if (pts.length < 2) return;
        const closed = pts.length > 2 && dist(toScreen(view, pts[0]), toScreen(view, pts[pts.length - 1])) < 10;
        const sp: SubPath = { start: pts[0], closed, segs: pts.slice(1).map((q) => ({ k: "L" as const, p: q })) };
        if (closed) sp.segs[sp.segs.length - 1] = { k: "L", p: [...pts[0]] as Vec };
        const o: PathObj = { id: dg.id, layer: layerFor()!.id, kind: "path", m: [...I] as Mat, paths: [sp] };
        edit((d) => ({ ...d, objects: [...d.objects, o] }), "Pencil"); setSel([o.id]); return;
      }
      case "create": {
        if (!dg.moved) { // click without drag: a 20 mm shape at the point
          const o = shapeFrom(dg.tool, dg.p0, [dg.p0[0] + 20, dg.p0[1] + (dg.tool === "line" ? 0 : 20)], false, dg.id, layerFor()!.id, opts, true);
          S.setDraft(null); if (o) { edit((d) => ({ ...d, objects: [...d.objects, o] }), `Add ${dg.tool}`); setSel([o.id]); }
        } else { S.commitDraft(`Draw ${dg.tool}`); setSel([dg.id]); }
        setToolS("select"); return;
      }
    }
  };
  const onDouble = (e: React.MouseEvent) => {
    const p = world(e);
    if (tool === "pen") { finishPen(false); return; }
    if (tool === "node") { const s = segmentAt(p); if (s) edit((d) => A.insertNode(d, s.obj, s.sp, s.seg, s.t), "Add node"); return; }
    if (tool === "select") {
      const hit = hitTest(cv.current!.getContext("2d")!, doc, p, 4 / view.zoom); const o = hit ? findObj(doc.objects, hit) : null;
      if (o?.kind === "path") { setSel([o.id]); setTool("node"); }
      else if (o?.kind === "text") { setSel([o.id]); document.querySelector<HTMLTextAreaElement>("[data-testid=prop-text]")?.focus(); }
    }
  };
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const r = cv.current!.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey || e.metaKey || mouseWheel) zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.0015)), sx, sy);
    else setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }));
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const c = cv.current; if (!c) return; c.addEventListener("wheel", onWheel, { passive: false }); return () => c.removeEventListener("wheel", onWheel); }, [onWheel]);

  /* ------------------------------------------------------------ commands */
  const has = sel.length > 0;
  const copy = (ids = sel) => { clipboard = structuredClone(A.selected(doc, ids)); if (clipboard.length) toast(`Copied ${clipboard.length}`, "info"); };
  // every command takes the ids it acts on (the context menu passes the right-clicked ones)
  const cmd = {
    undo: () => S.undo(), redo: () => S.redo(),
    copy, cut: (ids = sel) => { copy(ids); edit((d) => A.deleteSel(d, ids), "Cut"); setSel([]); },
    paste: () => { if (clipboard.length) editSel((d) => A.pasteObjs(d, clipboard), "Paste"); },
    duplicate: (ids = sel) => ids.length > 0 && editSel((d) => A.duplicateSel(d, ids), "Duplicate"),
    del: (ids = sel) => { if (tool === "node" && nodeSel) { edit((d) => A.deleteNode(d, nodeSel), "Delete node"); setNodeSel(null); } else if (ids.length) { edit((d) => A.deleteSel(d, ids), "Delete"); setSel([]); } },
    group: (ids = sel) => ids.length > 1 && editSel((d) => A.groupSel(d, ids), "Group"),
    ungroup: (ids = sel) => ids.length > 0 && editSel((d) => A.ungroupSel(d, ids), "Ungroup"),
    all: () => { const locked = new Set(doc.layers.filter((l) => l.locked || !l.visible).map((l) => l.id)); setSel(doc.objects.filter((o) => !o.locked && !o.hidden && !locked.has(o.layer)).map((o) => o.id)); },
    arrange: (h: "front" | "back" | "forward" | "backward", ids = sel) => ids.length > 0 && edit((d) => A.arrange(d, ids, h), "Arrange"),
    toPath: (ids = sel) => ids.length > 0 && edit((d) => A.convertToPaths(d, ids), "Convert to path"),
    breakApart: (ids = sel) => ids.length > 0 && editSel((d) => A.breakApart(d, ids), "Break apart"),
    nudge: (dx: number, dy: number) => has && edit((d) => A.moveSel(d, sel, dx, dy), "Nudge"),
  };
  const importFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      setBusy(`Reading ${f.name}…`);
      try {
        const r = await importFile(f, doc.layers.find((l) => l.op === "raster"));
        if (r.kind === "project") {
          if (window.confirm(`Replace this design with “${r.project.name}”? You can undo this.`)) { edit(() => r.project.doc, "Open .trotan file"); setSel([]); fitted.current = null; }
        } else if (r.kind === "vector") {
          if (!r.result.objects.length) throw new Error(`${f.name} has no shapes TROTAN can use${r.result.warnings.length ? ": " + r.result.warnings[0] : ""}`);
          const losses = r.result.warnings.filter((w) => /^Skipped|really a /.test(w));
          if (losses.length && !(await askReview(f.name, `${r.detection.label}${r.detection.version ? ` (${r.detection.version})` : ""}`, r.result.objects.length, r.result.warnings))) { toast(`Import of ${f.name} cancelled; the design is unchanged`, "info"); continue; }
          editSel((d) => A.placeImport(d, r.result.objects, r.result.layers), `Import ${f.name}`);
          toast(`Imported ${r.result.objects.length} object${r.result.objects.length === 1 ? "" : "s"} from ${f.name}${r.result.warnings.length ? ` — ${r.result.warnings.length} note(s), see Checks` : ""}`, r.result.warnings.length ? "info" : "ok");
          setWarnings(r.result.warnings.map((w) => `${f.name}: ${w}`));
        } else {
          editSel((d) => A.placeImport(d, [r.obj], [r.layer]), `Import ${f.name}`);
          setWarnings(r.warnings.map((w) => `${f.name}: ${w}`)); toast(`Placed ${f.name}`, "ok");
        }
      } catch (e) { toast(errText(e), "error"); }
      finally { setBusy(null); }
    }
  };
  const [warnings, setWarnings] = useState<string[]>([]);
  const doExport = (k: "svg" | "dxf" | "png" | "trotan") => { try { exportAs(doc, S.project?.name ?? "design", k); } catch (e) { toast(errText(e), "error"); } };
  const fileMenu = (x: number, y: number) => setMenu({ x, y, items: [
    { label: "Import…", key: "Ctrl+I", onClick: () => fileIn.current?.click(), disabled: readOnly ? "View only" : false },
    { sep: true, label: "" },
    { label: "Export SVG (mm)", onClick: () => doExport("svg") }, { label: "Export DXF (R12, mm)", onClick: () => doExport("dxf") },
    { label: "Export PNG (300 DPI)", onClick: () => doExport("png") }, { label: "Export TROTAN project (.trotan)", onClick: () => doExport("trotan") },
    { sep: true, label: "" },
    ...IMPORT_FORMATS.filter((f) => !f.ok).map((f) => ({ label: f.label.split(" — ")[0], disabled: f.label.split(" — ")[1] ?? "Not supported" })),
    { label: "Export PDF", disabled: "Not available yet — export SVG" },
  ] });

  /* ------------------------------------------------------------ keyboard */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable=true]") || document.querySelector(".t-modal-bg")) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.key === " ") { if (!space) setSpace(true); e.preventDefault(); return; }
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) cmd.redo(); else cmd.undo(); return; }
      if (mod && k === "y") { e.preventDefault(); cmd.redo(); return; }
      if (mod && k === "s") { e.preventDefault(); S.save("", false).then((v) => v && toast("Saved", "ok")); return; }
      if (mod && k === "c") { e.preventDefault(); cmd.copy(); return; }
      if (mod && k === "x") { e.preventDefault(); cmd.cut(); return; }
      if (mod && k === "v") { e.preventDefault(); cmd.paste(); return; }
      if (mod && k === "d") { e.preventDefault(); cmd.duplicate(); return; }
      if (mod && k === "a") { e.preventDefault(); cmd.all(); return; }
      if (mod && k === "g") { e.preventDefault(); if (e.shiftKey) cmd.ungroup(); else cmd.group(); return; }
      if (mod && k === "i") { e.preventDefault(); if (!readOnly) fileIn.current?.click(); return; }
      if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomAt(1.25); return; }
      if (mod && k === "-") { e.preventDefault(); zoomAt(0.8); return; }
      if (mod && k === "0") { e.preventDefault(); fit(); return; }
      if (mod && k === "1") { e.preventDefault(); zoomTo(96 / 25.4); return; }
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); cmd.del(); return; }
      if (e.key === "Escape") { if (pen.current.length) finishPen(false); else if (nodeSel) setNodeSel(null); else setSel([]); return; }
      if (e.key === "Enter" && pen.current.length) { finishPen(false); return; }
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      if (e.key.startsWith("Arrow")) { e.preventDefault(); cmd.nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0); return; }
      const tl = TOOLS.find((x) => x.key.toLowerCase() === k); if (tl && (!readOnly || tl.t === "select" || tl.t === "hand")) setTool(tl.t);
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") setSpace(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  const ctxMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = world(e); const hit = hitTest(cv.current!.getContext("2d")!, doc, p, 4 / view.zoom);
    let ids = sel; if (hit && !sel.includes(hit)) { ids = [hit]; setSel(ids); }
    const n = ids.length, ro = readOnly ? "View only" : false;
    const lockedCount = doc.objects.filter((o) => o.locked).length, hiddenCount = doc.objects.filter((o) => o.hidden).length;
    setMenu({ x: e.clientX, y: e.clientY, items: n ? [
      { label: "Cut", key: "Ctrl+X", onClick: () => cmd.cut(ids), disabled: ro }, { label: "Copy", key: "Ctrl+C", onClick: () => cmd.copy(ids) },
      { label: "Paste", key: "Ctrl+V", onClick: cmd.paste, disabled: ro || (!clipboard.length && "Clipboard is empty") },
      { label: "Duplicate", key: "Ctrl+D", onClick: () => cmd.duplicate(ids), disabled: ro }, { label: "Delete", key: "Del", onClick: () => cmd.del(ids), disabled: ro, danger: true },
      { sep: true, label: "" },
      { label: "Group", key: "Ctrl+G", onClick: () => cmd.group(ids), disabled: ro || (n < 2 && "Select 2 or more") },
      { label: "Ungroup", key: "Ctrl+Shift+G", onClick: () => cmd.ungroup(ids), disabled: ro || (!A.selected(doc, ids).some((o) => o.kind === "group") && "No group selected") },
      { label: "Convert to path", onClick: () => cmd.toPath(ids), disabled: ro }, { label: "Break apart", onClick: () => cmd.breakApart(ids), disabled: ro },
      { sep: true, label: "" },
      { label: "Bring to front", onClick: () => cmd.arrange("front", ids), disabled: ro }, { label: "Bring forward", onClick: () => cmd.arrange("forward", ids), disabled: ro },
      { label: "Send backward", onClick: () => cmd.arrange("backward", ids), disabled: ro }, { label: "Send to back", onClick: () => cmd.arrange("back", ids), disabled: ro },
      { sep: true, label: "" },
      ...doc.layers.map((l) => ({ label: `Move to layer: ${l.name}`, onClick: () => edit((d) => A.moveToLayer(d, ids, l.id), "Move to layer"), disabled: ro || (l.locked && "Layer is locked") })),
      { sep: true, label: "" },
      { label: "Lock", onClick: () => { edit((d) => ({ ...d, objects: d.objects.map((o) => (ids.includes(o.id) ? { ...o, locked: true } : o)) }), "Lock"); setSel([]); }, disabled: ro },
      { label: "Hide", onClick: () => { edit((d) => ({ ...d, objects: d.objects.map((o) => (ids.includes(o.id) ? { ...o, hidden: true } : o)) }), "Hide"); setSel([]); }, disabled: ro },
    ] : [
      { label: "Paste", key: "Ctrl+V", onClick: cmd.paste, disabled: ro || (!clipboard.length && "Clipboard is empty") },
      { label: "Select all", key: "Ctrl+A", onClick: cmd.all },
      { label: `Unlock all (${lockedCount})`, onClick: () => edit((d) => ({ ...d, objects: d.objects.map((o) => ({ ...o, locked: false })) }), "Unlock all"), disabled: ro || (!lockedCount && "Nothing locked") },
      { label: `Show all (${hiddenCount})`, onClick: () => edit((d) => ({ ...d, objects: d.objects.map((o) => ({ ...o, hidden: false })) }), "Show all"), disabled: ro || (!hiddenCount && "Nothing hidden") },
      { sep: true, label: "" },
      { label: "Zoom to page", key: "Ctrl+0", onClick: fit }, { label: "Actual size (96 DPI screen)", key: "Ctrl+1", onClick: () => zoomTo(96 / 25.4) },
      { label: "Clear guides", onClick: () => edit((d) => ({ ...d, guides: [] }), "Clear guides"), disabled: ro || (!doc.guides.length && "No guides") },
    ] });
  };

  const selB = A.selBox(doc, sel);
  const cursorCss = space || tool === "hand" ? (drag.current?.k === "pan" ? "grabbing" : "grab") : tool === "select" ? (() => { if (!cursor) return "default"; const h = handleAt(toScreen(view, cursor)); return h === "rot" ? "alias" : h != null ? CURSORS[h] : hover ? "move" : "default"; })() : tool === "text" ? "text" : tool === "node" ? "default" : "crosshair";
  const nodeObj = tool === "node" && sel.length === 1 ? findObj(doc.objects, sel[0]) : null;
  const saveLabel = useMemo(() => ({ saved: "All changes saved", dirty: "Unsaved changes…", saving: "Saving…", error: `Not saved: ${S.saveError ?? ""}`, conflict: "Someone else saved this project — reload to see their version" }[S.saveState]), [S.saveState, S.saveError]);

  return (
    <div className="t-editor" data-testid="editor">
      <div className="t-rail" role="toolbar" aria-label="Tools">
        {TOOLS.map((x) => {
          const off = readOnly && x.t !== "select" && x.t !== "hand";
          return <button key={x.t} type="button" className={`t-tool ${tool === x.t ? "on" : ""}`} title={off ? `${x.label} — view only` : `${x.label} (${x.key})`} aria-label={x.label} aria-pressed={tool === x.t} disabled={off} onClick={() => setTool(x.t)} data-testid={`tool-${x.t}`}>{x.icon}</button>;
        })}
        <div className="t-rail-sp" />
        <button type="button" className="t-tool" title="Import file (Ctrl+I)" aria-label="Import file" disabled={readOnly} onClick={() => fileIn.current?.click()} data-testid="import-btn"><Upload size={17} /></button>
      </div>
      <div className="t-stage">
        <div className="t-ctx">
          <button type="button" className="t-btn sm" onClick={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); fileMenu(r.left, r.bottom + 4); }} data-testid="file-menu">File</button>
          <span className="t-ctx-sep" />
          <button type="button" className="t-btn sm" onClick={cmd.undo} disabled={!S.canUndo || readOnly} title={`Undo ${S.lastLabel} (Ctrl+Z)`}>Undo</button>
          <button type="button" className="t-btn sm" onClick={cmd.redo} disabled={!S.canRedo || readOnly} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <span className="t-ctx-sep" />
          {tool === "polygon" && <ToolOpts><label>Sides <input type="number" min={3} max={64} value={opts.polySides} onChange={(e) => setOpts({ ...opts, polySides: Math.max(3, Math.min(64, +e.target.value || 3)) })} /></label><label>Star inner <input type="number" min={0} max={0.95} step={0.05} value={opts.star} onChange={(e) => setOpts({ ...opts, star: Math.max(0, Math.min(0.95, +e.target.value || 0)) })} /> (0 = polygon)</label></ToolOpts>}
          {tool === "text" && <ToolOpts><span>Click on the page to place text.</span><label>Size <input type="number" min={0.5} step={0.5} value={opts.textSize} onChange={(e) => setOpts({ ...opts, textSize: Math.max(0.5, +e.target.value || 10) })} /> mm</label></ToolOpts>}
          {tool === "pen" && <ToolOpts><span>Click for corners, drag for curves. Click the first point to close; Enter or double-click to finish.</span></ToolOpts>}
          {tool === "node" && <ToolOpts>{nodeObj && nodeObj.kind !== "path" ? <><span>Shapes and text must be paths to edit nodes.</span><button type="button" className="t-btn sm" onClick={() => cmd.toPath()} disabled={readOnly}>Convert to path</button></> : <>
            <span>Drag nodes or handles. Double-click a segment to add a node.</span>
            <button type="button" className="t-btn sm" disabled={!nodeSel || readOnly} onClick={() => { if (nodeSel) { edit((d) => A.deleteNode(d, nodeSel), "Delete node"); setNodeSel(null); } }}>Delete node</button>
            <button type="button" className="t-btn sm" disabled={!nodeSel || readOnly} title="Make the segment after the selected node a line or a curve" onClick={() => nodeSel && edit((d) => A.toggleSegment(d, nodeSel.obj, nodeSel.sp, nodeSel.node), "Line/curve")}>Line ↔ curve</button>
            <button type="button" className="t-btn sm" disabled={!nodeSel || readOnly} onClick={() => { if (nodeSel) { edit((d) => A.splitNode(d, nodeSel), "Split path"); setNodeSel(null); } }}>Split here</button>
            {nodeObj?.kind === "path" && nodeSel && <button type="button" className="t-btn sm" disabled={readOnly} onClick={() => { const s = (nodeObj as PathObj).paths[nodeSel.sp]; edit((d) => A.setClosed(d, nodeSel.obj, nodeSel.sp, !s?.closed), s?.closed ? "Open path" : "Close path"); }}>{(nodeObj as PathObj).paths[nodeSel.sp]?.closed ? "Open path" : "Close path"}</button>}
          </>}</ToolOpts>}
          <div className="t-grow" />
          <button type="button" className="t-btn sm" onClick={() => zoomAt(0.8)} title="Zoom out (Ctrl −)">−</button>
          <button type="button" className="t-btn sm t-zoom" onClick={fit} title="Fit page (Ctrl+0)">{Math.round((view.zoom * 25.4 / 96) * 100)}%</button>
          <button type="button" className="t-btn sm" onClick={() => zoomAt(1.25)} title="Zoom in (Ctrl +)">+</button>
        </div>
        <div className="t-canvas-wrap" ref={wrap}
          onDragOver={(e) => { if (!readOnly) e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (!readOnly && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); }}>
          <canvas ref={cv} style={{ width: size.W, height: size.H, cursor: cursorCss }} data-testid="canvas"
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble} onContextMenu={ctxMenu}
            onPointerLeave={() => { setCursor(null); setHover(null); }} />
          {textAt && <TextInput at={textAt.s} size={opts.textSize} onCancel={() => setTextAt(null)} onDone={async (text) => {
            const at = textAt.p; setTextAt(null); if (!text.trim()) return;
            const l = layerFor(); if (!l) return;
            try { setBusy("Loading font…"); const f = await loadFont(opts.font); const o: Obj = { id: uid(), layer: l.id, kind: "text", text, size: opts.textSize, font: opts.font, paths: textOutline(f, text, opts.textSize), m: [1, 0, 0, 1, at[0], at[1]] };
              edit((d) => ({ ...d, objects: [...d.objects, o] }), "Text"); setSel([o.id]); setToolS("select"); }
            catch (e) { toast(errText(e), "error"); } finally { setBusy(null); }
          }} />}
          {busy && <div className="t-busy">{busy}</div>}
          {!doc.objects.length && !S.draft && <div className="t-hint">Draw with the tools on the left, or drop an SVG, DXF, PNG, JPG or BMP here.</div>}
        </div>
        <div className="t-status" data-testid="status">
          <span>{cursor ? `X ${cursor[0].toFixed(2)}  Y ${cursor[1].toFixed(2)} mm` : "—"}</span>
          <span>{selB ? `${sel.length} selected · ${selB.w.toFixed(2)} × ${selB.h.toFixed(2)} mm` : `${doc.objects.length} object${doc.objects.length === 1 ? "" : "s"}`}</span>
          <span className="t-grow" />
          <label className="t-st-tog"><input type="checkbox" checked={opts.showGrid} onChange={(e) => setOpts({ ...opts, showGrid: e.target.checked })} />Grid</label>
          <label className="t-st-tog"><input type="checkbox" checked={opts.toGrid} onChange={(e) => setOpts({ ...opts, toGrid: e.target.checked })} />Snap grid</label>
          <label className="t-st-tog"><input type="checkbox" checked={opts.toObjects} onChange={(e) => setOpts({ ...opts, toObjects: e.target.checked })} />Snap objects</label>
          <label className="t-st-tog"><input type="checkbox" checked={opts.toGuides} onChange={(e) => setOpts({ ...opts, toGuides: e.target.checked })} />Snap guides</label>
          <label className="t-st-tog"><input type="checkbox" checked={opts.outline} onChange={(e) => setOpts({ ...opts, outline: e.target.checked })} />Outline</label>
          <span className={`t-save ${S.saveState}`} data-testid="save-state" title={saveLabel}>{saveLabel}</span>
        </div>
      </div>
      <aside className="t-right" style={{ width: split.width }}>
        {split.handle}
        <Panels readOnly={readOnly} edit={edit} editSel={editSel} activeLayer={activeLayer} setActiveLayer={setActiveLayer} grid={opts.grid} setGrid={(g) => setOpts({ ...opts, grid: g })} warnings={warnings} clearWarnings={() => setWarnings([])} />
      </aside>
      {review && <Modal title={`Import ${review.file}?`} onClose={() => { review.done(false); setReview(null); }}
        foot={<><button type="button" className="t-btn" data-testid="import-cancel" onClick={() => { review.done(false); setReview(null); }}>Cancel</button><button type="button" className="t-btn primary" data-testid="import-confirm" onClick={() => { review.done(true); setReview(null); }}>Import {review.count} object{review.count === 1 ? "" : "s"}</button></>}>
        <div data-testid="import-review"><p><b>{review.what}</b>: {review.count} object{review.count === 1 ? "" : "s"} can be imported as editable vectors.</p>
          <p>Not everything in the file can be brought in:</p><ul>{review.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>
      </Modal>}
      <input ref={fileIn} type="file" hidden multiple accept={ACCEPT} data-testid="file-input" onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ""; }} />
      {menu && <Menu at={menu} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ToolOpts({ children }: { children: ReactNode }) { return <div className="t-toolopts">{children}</div>; }
function TextInput({ at, size, onDone, onCancel }: { at: Vec; size: number; onDone: (t: string) => void; onCancel: () => void }) {
  const [t, setT] = useState("");
  return <input className="t-textin" autoFocus value={t} style={{ left: at[0], top: at[1] - 14 }} placeholder={`Type, then Enter (${size} mm)`} data-testid="text-input"
    onChange={(e) => setT(e.target.value)} onBlur={() => onDone(t)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") onDone(t); if (e.key === "Escape") onCancel(); }} />;
}
/** Shape from a drag. Shift = square/circle/45°. */
function shapeFrom(tool: Tool, a: Vec, b: Vec, constrain: boolean, id: string, layer: string, o: { polySides: number; star: number }, fromCorner = false): Obj | null {
  let w = b[0] - a[0], h = b[1] - a[1];
  if (tool === "line") {
    if (constrain) { const ang = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(w, h); w = Math.cos(ang) * L; h = Math.sin(ang) * L; }
    return { id, layer, kind: "path", m: [...I] as Mat, paths: [{ start: [...a] as Vec, closed: false, segs: [{ k: "L", p: [a[0] + w, a[1] + h] }] }] };
  }
  if (constrain) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
  const x = Math.min(a[0], a[0] + w), y = Math.min(a[1], a[1] + h), W = Math.abs(w), H = Math.abs(h);
  if (tool === "rect") return { id, layer, kind: "rect", w: Math.max(W, 0.01), h: Math.max(H, 0.01), r: 0, m: [1, 0, 0, 1, x, y] };
  if (tool === "ellipse") return { id, layer, kind: "ellipse", rx: Math.max(W / 2, 0.005), ry: Math.max(H / 2, 0.005), m: [1, 0, 0, 1, x + W / 2, y + H / 2] };
  if (tool === "polygon") {
    const r = fromCorner ? 10 : Math.max(0.01, Math.hypot(b[0] - a[0], b[1] - a[1]));
    const c: Vec = fromCorner ? [a[0] + 10, a[1] + 10] : a;
    return { id, layer, kind: "polygon", n: o.polySides, r, star: o.star, m: [1, 0, 0, 1, c[0], c[1]] };
  }
  return null;
}
function penPath(pts: PenPt[], close: boolean): SubPath {
  const segs: SubPath["segs"] = [];
  const seg = (a: PenPt, b: PenPt) => (a.outH || b.inH ? { k: "C" as const, c1: a.outH ?? a.p, c2: b.inH ?? b.p, p: [...b.p] as Vec } : { k: "L" as const, p: [...b.p] as Vec });
  for (let i = 1; i < pts.length; i++) segs.push(seg(pts[i - 1], pts[i]));
  if (close) segs.push(seg(pts[pts.length - 1], pts[0]));
  return { start: [...pts[0].p] as Vec, closed: close, segs };
}
const spData = (s: SubPath) => `M${s.start[0]} ${s.start[1]}` + s.segs.map((g) => (g.k === "L" ? `L${g.p[0]} ${g.p[1]}` : `C${g.c1![0]} ${g.c1![1]} ${g.c2![0]} ${g.c2![1]} ${g.p[0]} ${g.p[1]}`)).join("") + (s.closed ? "Z" : "");
