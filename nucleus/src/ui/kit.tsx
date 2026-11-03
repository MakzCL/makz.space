// Small, dense controls for NUCLEUS.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function Modal({ title, children, onClose, foot, wide }: { title: string; children: ReactNode; onClose: () => void; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return createPortal(<div className="n-modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}><div className={`n-modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}><header><b>{title}</b><button type="button" className="n-x" onClick={onClose} aria-label="Close">×</button></header><div className="n-modal-b">{children}</div>{foot && <footer>{foot}</footer>}</div></div>, document.body);
}
export interface MenuItem { label: string; key?: string; onClick?: () => void; disabled?: boolean | string; sep?: boolean; checked?: boolean }
export function Menu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null); const [pos, setPos] = useState(at);
  useLayoutEffect(() => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ x: Math.min(at.x, innerWidth - r.width - 4), y: Math.min(at.y, innerHeight - r.height - 4) }); }, [at]);
  useEffect(() => { const d = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); }; const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("pointerdown", d, true); window.addEventListener("keydown", k); return () => { window.removeEventListener("pointerdown", d, true); window.removeEventListener("keydown", k); }; }, [onClose]);
  return createPortal(<div className="n-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">{items.map((it, i) => it.sep ? <div key={i} className="n-menu-sep" /> : (
    <button key={i} type="button" role="menuitem" className="n-menu-i" disabled={!!it.disabled} title={typeof it.disabled === "string" ? it.disabled : undefined} onClick={() => { onClose(); it.onClick?.(); }}>
      <span className="n-menu-c">{it.checked ? "✓" : ""}</span><span className="n-menu-l">{it.label}</span><kbd>{typeof it.disabled === "string" ? it.disabled : it.key ?? ""}</kbd></button>))}</div>, document.body);
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="n-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
/** Text field that commits on Enter/blur (Escape reverts). */
export function Edit({ value, onCommit, placeholder, invalid, testid, first, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; invalid?: (v: string) => string | null; testid?: string; first?: boolean; mono?: boolean }) {
  const [t, setT] = useState(value); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setT(value); setErr(null); }, [value]);
  const commit = () => { if (t === value) return; const e = invalid?.(t) ?? null; setErr(e); if (!e) onCommit(t); };
  return <><input className={`n-in ${err ? "bad" : ""} ${mono ? "mono" : ""}`} value={t} placeholder={placeholder} data-testid={testid} data-inspector-first={first ? "" : undefined} onChange={(e) => setT(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setT(value); setErr(null); (e.target as HTMLInputElement).blur(); } }} />{err && <small className="n-err">{err}</small>}</>;
}
export function Split({ side, size, setSize, min = 160, max = 640 }: { side: "left" | "right" | "bottom"; size: number; setSize: (n: number) => void; min?: number; max?: number }) {
  return <div className={`n-split ${side}`} role="separator" title="Drag to resize · double-click to hide"
    onDoubleClick={() => setSize(0)}
    onPointerDown={(e) => { const s0 = side === "bottom" ? e.clientY : e.clientX, w0 = size; (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const mv = (ev: PointerEvent) => { const d = (side === "bottom" ? ev.clientY : ev.clientX) - s0; setSize(Math.max(min, Math.min(max, w0 + (side === "left" ? d : -d)))); };
      const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); }} />;
}
