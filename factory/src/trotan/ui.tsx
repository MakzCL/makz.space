// TROTAN UI primitives: dense desktop controls (numeric fields with units, menus, modal, split panes).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { evalNum } from "./evalNum";
export { evalNum };

export function Btn({ children, onClick, tone = "", disabled, title, icon, type = "button", small, testid }: {
  children?: ReactNode; onClick?: () => void; tone?: "" | "primary" | "danger" | "ghost"; disabled?: boolean; title?: string; icon?: ReactNode; type?: "button" | "submit"; small?: boolean; testid?: string;
}) {
  return <button type={type} className={`t-btn ${tone} ${small ? "sm" : ""} ${children ? "" : "icon"}`} onClick={onClick} disabled={disabled} title={title} aria-label={!children ? title : undefined} data-testid={testid}>{icon}{children}</button>;
}
/** Numeric input with unit; commits on Enter/blur, accepts simple arithmetic (e.g. 120/3, 25.4*2). */
export function Num({ value, onCommit, unit, min, max, step = 1, digits = 2, disabled, label, width, testid }: {
  value: number | null | undefined; onCommit: (v: number) => void; unit?: string; min?: number; max?: number; step?: number; digits?: number; disabled?: boolean; label?: string; width?: number; testid?: string;
}) {
  const fmt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : String(Math.round(v * 10 ** digits) / 10 ** digits));
  const [text, setText] = useState(fmt(value)); const [bad, setBad] = useState(false); const focused = useRef(false);
  useEffect(() => { if (!focused.current) { setText(fmt(value)); setBad(false); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const t = text.trim().replace(",", ".");
    if (t === fmt(value)) { setBad(false); return; }
    const v = evalNum(t);
    if (v == null || (min != null && v < min) || (max != null && v > max)) { setBad(true); return; }
    setBad(false); setText(fmt(v)); onCommit(v);
  };
  return (
    <label className={`t-num ${bad ? "bad" : ""} ${disabled ? "dis" : ""}`} style={width ? { width } : undefined} title={bad ? `Enter a number${min != null ? ` ≥ ${min}` : ""}${max != null ? ` and ≤ ${max}` : ""}` : undefined}>
      {label && <span className="t-num-l">{label}</span>}
      <input value={text} disabled={disabled} inputMode="decimal" data-testid={testid} aria-label={label}
        onFocus={(e) => { focused.current = true; e.target.select(); }}
        onBlur={() => { focused.current = false; commit(); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") { setText(fmt(value)); setBad(false); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const v = (evalNum(text) ?? value ?? 0) + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1); const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)); setText(fmt(c)); onCommit(c); }
          e.stopPropagation();
        }} />
      {unit && <span className="t-num-u">{unit}</span>}
    </label>
  );
}
export function Sel<T extends string>({ value, onChange, options, disabled, label, testid }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[]; disabled?: boolean; label?: string; testid?: string }) {
  return (
    <label className="t-sel">{label && <span className="t-num-l">{label}</span>}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} data-testid={testid} aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </label>
  );
}
export function Check({ on, onChange, label, disabled, testid }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; testid?: string }) {
  return <label className={`t-check ${disabled ? "dis" : ""}`}><input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} /><span>{label}</span></label>;
}
export function Text({ value, onCommit, placeholder, label, multiline, testid }: { value: string; onCommit: (v: string) => void; placeholder?: string; label?: string; multiline?: boolean; testid?: string }) {
  const [t, setT] = useState(value); useEffect(() => setT(value), [value]);
  const p = { value: t, placeholder, "aria-label": label ?? placeholder, "data-testid": testid, onChange: (e: { target: { value: string } }) => setT(e.target.value), onBlur: () => { if (t !== value) onCommit(t); }, onKeyDown: (e: React.KeyboardEvent) => { e.stopPropagation(); if (e.key === "Enter" && !multiline) (e.target as HTMLElement).blur(); } };
  return <label className="t-text">{label && <span className="t-num-l">{label}</span>}{multiline ? <textarea rows={3} {...p} /> : <input {...p} />}</label>;
}

export interface MenuItem { label: string; onClick?: () => void; disabled?: boolean | string; key?: string; danger?: boolean; sep?: boolean; checked?: boolean }
/** Context/dropdown menu rendered at a screen point; closes on outside click, Escape or choosing. */
export function Menu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null); const [pos, setPos] = useState(at);
  useLayoutEffect(() => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ x: Math.min(at.x, innerWidth - r.width - 6), y: Math.min(at.y, innerHeight - r.height - 6) }); }, [at]);
  useEffect(() => {
    const d = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", d, true); window.addEventListener("keydown", k);
    return () => { window.removeEventListener("pointerdown", d, true); window.removeEventListener("keydown", k); };
  }, [onClose]);
  return createPortal(
    <div className="t-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it.sep ? <div key={i} className="t-menu-sep" /> : (
        <button key={i} type="button" role="menuitem" className={`t-menu-i ${it.danger ? "danger" : ""}`} disabled={!!it.disabled} title={typeof it.disabled === "string" ? it.disabled : undefined}
          onClick={() => { onClose(); it.onClick?.(); }}>
          <span className="t-menu-c">{it.checked ? "✓" : ""}</span><span>{it.label}</span>{typeof it.disabled === "string" ? <em>{it.disabled}</em> : it.key && <kbd>{it.key}</kbd>}
        </button>
      ))}
    </div>, document.body);
}
export function Modal({ title, children, onClose, wide, foot }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; foot?: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return createPortal(
    <div className="t-modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`t-modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <header><h3>{title}</h3><button type="button" className="t-x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="t-modal-b">{children}</div>
        {foot && <footer>{foot}</footer>}
      </div>
    </div>, document.body);
}
/** Draggable divider; remembers its size per key in this browser. */
export function useSplit(key: string, initial: number, min: number, max: number, side: "left" | "right" = "right") {
  const [w, setW] = useState(() => { try { const v = Number(localStorage.getItem(`trotan-split-${key}`)); return v >= min && v <= max ? v : initial; } catch { return initial; } });
  const handle = (
    <div className="t-split" role="separator" aria-orientation="vertical" title="Drag to resize"
      onPointerDown={(e) => {
        const x0 = e.clientX, w0 = w; (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const mv = (ev: PointerEvent) => { const nw = Math.max(min, Math.min(max, w0 + (side === "right" ? x0 - ev.clientX : ev.clientX - x0))); setW(nw); };
        const up = (ev: PointerEvent) => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); const nw = Math.max(min, Math.min(max, w0 + (side === "right" ? x0 - ev.clientX : ev.clientX - x0))); try { localStorage.setItem(`trotan-split-${key}`, String(nw)); } catch { /* ignore */ } };
        window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
      }} />
  );
  return { width: w, handle };
}
export function Pill({ tone = "", children, title }: { tone?: "" | "ok" | "warn" | "err" | "info"; children: ReactNode; title?: string }) { return <span className={`t-pill ${tone}`} title={title}>{children}</span>; }
export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) { return <div className="t-empty"><b>{title}</b>{hint && <p>{hint}</p>}{children}</div>; }
