// Generic plot used by the oscilloscope and the analysis graphs. Draws exactly the solver's samples.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatEng } from "../../core/units";
export interface Series { name: string; color: string; x: number[]; y: number[] }
export interface PlotProps { series: Series[]; xUnit: string; yUnit: string; logX?: boolean; xRange?: [number, number]; yRange?: [number, number]; divisions?: [number, number]; dark: boolean; testid?: string; onCursor?: (a: number | null, b: number | null) => void; height?: number }
export function Plot(p: PlotProps) {
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [W, setW] = useState(600); const H = p.height ?? 260;
  const [cur, setCur] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  useLayoutEffect(() => { const el = wrap.current!; const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  const xs = p.series.flatMap((s) => s.x), ys = p.series.flatMap((s) => s.y).filter(Number.isFinite);
  let [x0, x1] = zoom ?? p.xRange ?? [Math.min(...xs), Math.max(...xs)];
  if (!Number.isFinite(x0) || x0 === x1) { x0 = 0; x1 = 1; }
  let [y0, y1] = p.yRange ?? (ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1]);
  if (!p.yRange) { const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.08; y0 -= pad; y1 += pad; }
  const L = 64, R = 12, T = 10, B = 26;
  const fx = (x: number) => L + ((p.logX ? Math.log10(x) - Math.log10(x0) : x - x0) / (p.logX ? Math.log10(x1) - Math.log10(x0) : x1 - x0)) * (W - L - R);
  const ix = (px: number) => { const k = (px - L) / (W - L - R); return p.logX ? 10 ** (Math.log10(x0) + k * (Math.log10(x1) - Math.log10(x0))) : x0 + k * (x1 - x0); };
  const fy = (y: number) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  useEffect(() => { p.onCursor?.(cur.a, cur.b); }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = cv.current!; const dpr = devicePixelRatio || 1; c.width = W * dpr; c.height = H * dpr; const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fg = p.dark ? "#c9ced8" : "#222831", gr = p.dark ? "#262c36" : "#dde0e5", bg = p.dark ? "#0d1015" : "#ffffff";
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = gr; ctx.lineWidth = 1; ctx.font = "10px 'IBM Plex Mono', ui-monospace, monospace"; ctx.fillStyle = fg;
    const [nx, ny] = p.divisions ?? [10, 8];
    for (let i = 0; i <= nx; i++) { const x = p.logX ? null : L + (i / nx) * (W - L - R); if (x === null) break; ctx.beginPath(); ctx.moveTo(x + 0.5, T); ctx.lineTo(x + 0.5, H - B); ctx.stroke(); if (i % 2 === 0) { ctx.textAlign = "center"; ctx.fillText(formatEng(x0 + (i / nx) * (x1 - x0), p.xUnit, 3), x, H - 8); } }
    if (p.logX) for (let d = Math.floor(Math.log10(x0)); d <= Math.ceil(Math.log10(x1)); d++) for (const m of [1, 2, 5]) { const v = m * 10 ** d; if (v < x0 || v > x1) continue; const x = fx(v); ctx.strokeStyle = m === 1 ? (p.dark ? "#3a414d" : "#c4c8cf") : gr; ctx.beginPath(); ctx.moveTo(x + 0.5, T); ctx.lineTo(x + 0.5, H - B); ctx.stroke(); if (m === 1) { ctx.textAlign = "center"; ctx.fillText(formatEng(v, p.xUnit, 3), x, H - 8); } }
    for (let i = 0; i <= ny; i++) { const y = T + (i / ny) * (H - T - B); ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(L, y + 0.5); ctx.lineTo(W - R, y + 0.5); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(formatEng(y1 - (i / ny) * (y1 - y0), p.yUnit, 3), L - 4, y + 3); }
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, W - L - R, H - T - B); ctx.clip();
    for (const s of p.series) { ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.beginPath(); let started = false; for (let i = 0; i < s.x.length; i++) { if (!Number.isFinite(s.y[i])) { started = false; continue; } const X = fx(s.x[i]), Y = fy(s.y[i]); if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y); } ctx.stroke(); }
    ctx.restore();
    for (const [k, v] of [["A", cur.a], ["B", cur.b]] as const) if (v !== null) { const X = fx(v); ctx.strokeStyle = k === "A" ? "#ffb02e" : "#3aa0ff"; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X + 0.5, T); ctx.lineTo(X + 0.5, H - B); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = "left"; ctx.fillText(k, X + 3, T + 10); }
    ctx.strokeStyle = fg; ctx.strokeRect(L + 0.5, T + 0.5, W - L - R, H - T - B);
  });
  const at = (e: React.MouseEvent) => { const r = cv.current!.getBoundingClientRect(); return ix(e.clientX - r.left); };
  return (
    <div className="n-plot" ref={wrap} data-testid={p.testid}>
      <canvas ref={cv} style={{ width: W, height: H }} onClick={(e) => setCur((c) => ({ ...c, a: at(e) }))} onContextMenu={(e) => { e.preventDefault(); setCur((c) => ({ ...c, b: at(e) })); }}
        onWheel={(e) => { const m = at(e as unknown as React.MouseEvent); const k = e.deltaY > 0 ? 1.25 : 0.8; const a = m - (m - x0) * k, b = m + (x1 - m) * k; setZoom([Math.max(p.xRange?.[0] ?? Math.min(...xs), a), Math.min(p.xRange?.[1] ?? Math.max(...xs), b)]); }}
        onDoubleClick={() => { setZoom(null); setCur({ a: null, b: null }); }} title="Click: cursor A · right-click: cursor B · wheel: zoom · double-click: reset" />
      <div className="n-plot-leg">{p.series.map((s) => { const val = (x: number | null) => { if (x === null) return ""; let i = s.x.findIndex((v) => v >= x); if (i < 0) i = s.x.length - 1; return formatEng(s.y[i], p.yUnit, 4); };
        return <span key={s.name} style={{ color: s.color }}>■ {s.name}{cur.a !== null ? `  A: ${val(cur.a)}` : ""}{cur.b !== null ? `  B: ${val(cur.b)}` : ""}</span>; })}
        {cur.a !== null && cur.b !== null && <span>Δ{p.xUnit === "s" ? "t" : "x"} = {formatEng(Math.abs(cur.b - cur.a), p.xUnit, 4)}{p.xUnit === "s" && cur.b !== cur.a ? `  (1/Δt = ${formatEng(1 / Math.abs(cur.b - cur.a), "Hz", 4)})` : ""}</span>}</div>
    </div>
  );
}
export function toCsv(xName: string, series: Series[]): string {
  if (!series.length) return ""; const x = series[0].x;
  return [[xName, ...series.map((s) => s.name)].join(","), ...x.map((v, i) => [v, ...series.map((s) => s.y[i])].join(","))].join("\n");
}
export const COLORS = ["#ffcf3a", "#38d39f", "#4ea3ff", "#ff6fae", "#c38bff", "#ff8c42"];
