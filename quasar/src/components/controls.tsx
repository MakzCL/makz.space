import { motion } from "motion/react";
import { useRef, useState, type ReactNode } from "react";

export function Slider({ value, min = 0, max = 1, step = 0.01, onChange, onCommit }: {
  value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    const t = Math.min(Math.max((x - r.left) / r.width, 0), 1);
    const v = Math.round((min + t * (max - min)) / step) * step;
    return Math.min(Math.max(+v.toFixed(6), min), max);
  };
  let last = value;
  return (
    <div
      ref={ref}
      className={`slider${drag ? " drag" : ""}`}
      role="slider"
      tabIndex={0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setDrag(true);
        onChange((last = at(e.clientX)));
      }}
      onPointerMove={(e) => drag && onChange((last = at(e.clientX)))}
      onPointerUp={() => {
        setDrag(false);
        onCommit?.(last);
      }}
      onKeyDown={(e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
        if (d) {
          const v = Math.min(Math.max(value + d, min), max);
          onChange(v);
          onCommit?.(v);
          e.preventDefault();
        }
      }}
    >
      <div className="track">
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="knob" style={{ left: `${pct}%` }} />
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button className={`toggle${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

let segN = 0;
export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  const [id] = useState(() => `seg${segN++}`);
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={String(v)} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {v === value && <motion.span layoutId={id} className="bg" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          {label}
        </button>
      ))}
    </div>
  );
}

export function Swatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="swatch" style={{ background: value }}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map(([v, l]) => (
        <button key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
          {v === value && <motion.span layoutId="tab-ul" className="ul" />}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <div>
        <div style={{ fontWeight: 550 }}>{label}</div>
        {hint && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{hint}</div>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}
