// Machine workbed view (bed coordinates, mm): bed, material sheet and margin, every placed copy of the
// design, and optionally the ordered toolpath with travel moves and a simulated laser head.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { leaves, localPaths, mul, pathData, transformPaths, type Doc, type Mat, type OpType, type Vec } from "../geom/core";
import { placementBox, type Placement, type Toolpath } from "../geom/laser";
import { imageFor, hexA } from "../editor/render";

const OP_COLOR: Record<OpType, string> = { cut: "#ff453a", kiss: "#ff9f0a", score: "#30d158", vengrave: "#64d2ff", mark: "#bf5af2", raster: "#2f6bff", none: "#8e8e93" };
export interface WorkbedProps {
  doc: Doc | null; placements: Placement[]; bed: { w: number; h: number }; sheet: { w: number; h: number } | null; margin: number;
  toolpath?: Toolpath | null; showTravel?: boolean; head?: Vec | null; laserOn?: boolean; doneItems?: number;
  highlight?: Set<string>; selected?: string | null; onSelect?: (id: string | null) => void; onMove?: (id: string, dx: number, dy: number, commit: boolean) => void;
  dark: boolean; testid?: string;
}
export function Workbed(p: WorkbedProps) {
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ W: 600, H: 400 });
  const [view, setView] = useState<{ zoom: number; x: number; y: number } | null>(null);
  const drag = useRef<{ k: "pan"; s: Vec; v: { zoom: number; x: number; y: number } } | { k: "move"; id: string; s: Vec } | null>(null);
  useLayoutEffect(() => { const el = wrap.current!; const ro = new ResizeObserver(() => setSize({ W: el.clientWidth, H: el.clientHeight })); ro.observe(el); setSize({ W: el.clientWidth, H: el.clientHeight }); return () => ro.disconnect(); }, []);
  const fit = useCallback(() => { const pad = 24, z = Math.min((size.W - pad * 2) / p.bed.w, (size.H - pad * 2) / p.bed.h); setView({ zoom: z, x: (size.W - p.bed.w * z) / 2, y: (size.H - p.bed.h * z) / 2 }); }, [size, p.bed.w, p.bed.h]);
  useEffect(() => { fit(); }, [fit]);
  // design geometry grouped by colour, built once per document
  const art = useMemo(() => {
    if (!p.doc) return { paths: [], images: [] };
    const layers = new Map(p.doc.layers.map((l) => [l.id, l]));
    const by = new Map<string, { color: string; d: string[]; fill: boolean }>(); const images: { src: string; m: Mat; w: number; h: number }[] = [];
    for (const { o, m, top } of leaves(p.doc.objects)) {
      if (o.hidden || top.hidden) continue;
      const l = layers.get(top.kind === "group" ? o.layer : top.layer) ?? layers.get(o.layer); if (!l) continue;
      const op = o.op ?? top.op ?? l.op; if (op === "none") continue;
      if (o.kind === "image") { images.push({ src: o.src, m, w: o.w, h: o.h }); continue; }
      const k = `${l.color}|${op === "raster"}`; if (!by.has(k)) by.set(k, { color: l.color, d: [], fill: op === "raster" });
      by.get(k)!.d.push(pathData(transformPaths(localPaths(o), m)));
    }
    return { paths: [...by.values()].map((g) => ({ color: g.color, fill: g.fill, path: new Path2D(g.d.join(" ")) })), images };
  }, [p.doc]);
  const [, bump] = useState(0);
  useEffect(() => {
    const c = cv.current; if (!c || !view) return;
    const dpr = window.devicePixelRatio || 1, { W, H } = size;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext("2d")!; ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = p.dark ? "#0a0c10" : "#e6e8ee"; ctx.fillRect(0, 0, c.width, c.height);
    const base: Mat = [view.zoom * dpr, 0, 0, view.zoom * dpr, view.x * dpr, view.y * dpr];
    const set = (m: Mat) => ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    set(base); const px = 1 / view.zoom;
    // bed + grid
    ctx.fillStyle = p.dark ? "#161a22" : "#fafbfc"; ctx.fillRect(0, 0, p.bed.w, p.bed.h);
    ctx.lineWidth = px; ctx.strokeStyle = p.dark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)"; ctx.beginPath();
    for (let x = 50; x < p.bed.w; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, p.bed.h); } for (let y = 50; y < p.bed.h; y += 50) { ctx.moveTo(0, y); ctx.lineTo(p.bed.w, y); } ctx.stroke();
    ctx.strokeStyle = p.dark ? "#3a4252" : "#b9bfcc"; ctx.lineWidth = 2 * px; ctx.strokeRect(0, 0, p.bed.w, p.bed.h);
    ctx.fillStyle = p.dark ? "#7d8396" : "#5b6170"; ctx.font = `${11 * px}px 'Cabinet Grotesk', Poppins, sans-serif`; ctx.fillText(`Bed ${p.bed.w} × ${p.bed.h} mm · origin top-left`, 4 * px, -6 * px);
    if (p.sheet) {
      ctx.fillStyle = p.dark ? "rgba(214,170,110,.16)" : "rgba(196,150,90,.22)"; ctx.fillRect(0, 0, p.sheet.w, p.sheet.h);
      ctx.strokeStyle = p.dark ? "#c9a46a" : "#a7834c"; ctx.lineWidth = 1.5 * px; ctx.strokeRect(0, 0, p.sheet.w, p.sheet.h);
      if (p.margin > 0) { ctx.setLineDash([4 * px, 4 * px]); ctx.lineWidth = px; ctx.strokeRect(p.margin, p.margin, p.sheet.w - 2 * p.margin, p.sheet.h - 2 * p.margin); ctx.setLineDash([]); }
    }
    // copies
    const faded = !!p.toolpath;
    for (const pl of p.placements) {
      set(mul(base, pl.m));
      for (const im of art.images) { const el = imageFor(im.src, () => bump((n) => n + 1)); if (el.complete && el.naturalWidth) { ctx.save(); const mm = mul(mul(base, pl.m), im.m); set(mm); ctx.globalAlpha = faded ? 0.35 : 0.85; ctx.drawImage(el, 0, 0, im.w, im.h); ctx.restore(); set(mul(base, pl.m)); } }
      for (const g of art.paths) {
        if (g.fill) { ctx.fillStyle = hexA(g.color, faded ? 0.12 : 0.3); ctx.fill(g.path, "evenodd"); }
        ctx.strokeStyle = faded ? hexA(g.color, 0.35) : g.color; ctx.lineWidth = px; ctx.stroke(g.path);
      }
      set(base);
      const b = p.doc ? placementBox(p.doc, pl) : null;
      if (b && (p.selected === pl.id || p.highlight?.has(pl.id))) { ctx.strokeStyle = p.highlight?.has(pl.id) ? "#ff453a" : "#3aa0ff"; ctx.lineWidth = 1.5 * px; ctx.setLineDash([5 * px, 3 * px]); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.setLineDash([]); }
    }
    // toolpath
    if (p.toolpath) {
      set(base);
      const done = p.doneItems ?? -1;
      if (p.showTravel !== false) { ctx.strokeStyle = p.dark ? "rgba(255,255,255,.28)" : "rgba(0,0,0,.3)"; ctx.lineWidth = px; ctx.setLineDash([3 * px, 3 * px]); ctx.beginPath(); for (const t of p.toolpath.travel) { ctx.moveTo(t.from[0], t.from[1]); ctx.lineTo(t.to[0], t.to[1]); } ctx.stroke(); ctx.setLineDash([]); }
      p.toolpath.items.forEach((it, i) => {
        const on = done < 0 || i < done; ctx.globalAlpha = on ? 1 : 0.35;
        if ("box" in it) { ctx.fillStyle = hexA(OP_COLOR.raster, 0.22); ctx.fillRect(it.box.x, it.box.y, it.box.w, it.box.h); ctx.strokeStyle = OP_COLOR.raster; ctx.lineWidth = px; ctx.strokeRect(it.box.x, it.box.y, it.box.w, it.box.h); }
        else { ctx.strokeStyle = OP_COLOR[it.op]; ctx.lineWidth = 1.4 * px; ctx.beginPath(); it.pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); if (it.closed) ctx.closePath(); ctx.stroke(); }
        ctx.globalAlpha = 1;
      });
    }
    if (p.head) {
      set(base); const [hx, hy] = p.head;
      if (p.laserOn) { const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 9 * px); g.addColorStop(0, "rgba(255,80,40,.9)"); g.addColorStop(1, "rgba(255,80,40,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 9 * px, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = p.dark ? "#fff" : "#111"; ctx.lineWidth = 1.2 * px; ctx.beginPath(); ctx.arc(hx, hy, 4 * px, 0, Math.PI * 2); ctx.moveTo(hx - 7 * px, hy); ctx.lineTo(hx + 7 * px, hy); ctx.moveTo(hx, hy - 7 * px); ctx.lineTo(hx, hy + 7 * px); ctx.stroke();
    }
  });
  const toBed = (e: { clientX: number; clientY: number }): Vec => { const r = cv.current!.getBoundingClientRect(); const v = view!; return [(e.clientX - r.left - v.x) / v.zoom, (e.clientY - r.top - v.y) / v.zoom]; };
  const hit = (q: Vec) => { if (!p.doc) return null; for (let i = p.placements.length - 1; i >= 0; i--) { const b = placementBox(p.doc, p.placements[i]); if (b && q[0] >= b.x && q[0] <= b.x + b.w && q[1] >= b.y && q[1] <= b.y + b.h) return p.placements[i].id; } return null; };
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const w = (e: WheelEvent) => { e.preventDefault(); const r = c.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top; setView((v) => { if (!v) return v; const z = Math.max(0.05, Math.min(200, v.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))); return { zoom: z, x: sx - ((sx - v.x) * z) / v.zoom, y: sy - ((sy - v.y) * z) / v.zoom }; }); };
    c.addEventListener("wheel", w, { passive: false }); return () => c.removeEventListener("wheel", w);
  }, []);
  return (
    <div className="t-bed" ref={wrap} data-testid={p.testid}>
      <canvas ref={cv} style={{ width: size.W, height: size.H }}
        onDoubleClick={fit}
        onPointerDown={(e) => {
          if (!view) return; (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const q = toBed(e), h = p.onMove ? hit(q) : null;
          if (h && e.button === 0) { p.onSelect?.(h); drag.current = { k: "move", id: h, s: q }; } else { if (e.button === 0) p.onSelect?.(null); drag.current = { k: "pan", s: [e.clientX, e.clientY], v: view }; }
        }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; if (d.k === "pan") setView({ ...d.v, x: d.v.x + e.clientX - d.s[0], y: d.v.y + e.clientY - d.s[1] }); else { const q = toBed(e); p.onMove?.(d.id, q[0] - d.s[0], q[1] - d.s[1], false); } }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d?.k === "move") { const q = toBed(e); p.onMove?.(d.id, q[0] - d.s[0], q[1] - d.s[1], true); } }} />
      <button type="button" className="t-btn sm t-bed-fit" onClick={fit} title="Fit the bed (double-click)">Fit</button>
    </div>
  );
}
export { OP_COLOR };
