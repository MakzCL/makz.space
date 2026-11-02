import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { buzz } from "../lib/prefs";
import { Spinner } from "./Loader";

export const spring = { type: "spring" as const, stiffness: 380, damping: 32 };

/** Bottom sheet: drag down to dismiss, tap backdrop to close. */
export function Sheet({ open, onClose, title, children, tall }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; tall?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.classList.add("locked");
    return () => { window.removeEventListener("keydown", k); document.body.classList.remove("locked"); };
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="sheet-backdrop" onClick={onClose} />
          <motion.div
            className={`sheet ${tall ? "tall" : ""}`} role="dialog" aria-modal
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
          >
            <SheetHandle />
            <div className="sheet-head">
              <h3>{title}</h3>
              <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="sheet-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Dragging the handle drags the sheet (body stays scrollable). */
function SheetHandle() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const sheet = el.parentElement as HTMLElement;
    let y0 = 0, dy = 0, active = false;
    const down = (e: PointerEvent) => { active = true; y0 = e.clientY; dy = 0; el.setPointerCapture(e.pointerId); sheet.style.transition = "none"; };
    const move = (e: PointerEvent) => { if (!active) return; dy = Math.max(0, e.clientY - y0); sheet.style.translate = `0 ${dy}px`; };
    const up = () => {
      if (!active) return; active = false;
      sheet.style.transition = "translate .25s cubic-bezier(.2,.8,.2,1)";
      if (dy > 110) { (sheet.closest(".sheet-wrap")?.querySelector(".sheet-backdrop") as HTMLElement | null)?.click(); }
      else sheet.style.translate = "0 0";
    };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
  }, []);
  return <div ref={ref} className="sheet-handle"><i /></div>;
}

export function Btn({ children, onClick, tone = "ghost", busy, disabled, icon, wide, small, type = "button" }: {
  children?: ReactNode; onClick?: () => unknown | Promise<unknown>; tone?: "primary" | "ghost" | "danger" | "ok" | "soft";
  busy?: boolean; disabled?: boolean; icon?: ReactNode; wide?: boolean; small?: boolean; type?: "button" | "submit";
}) {
  const [loading, setLoading] = useState(false);
  const isBusy = busy || loading;
  return (
    <motion.button
      type={type} className={`btn ${tone} ${wide ? "wide" : ""} ${small ? "small" : ""}`} disabled={disabled || isBusy}
      whileTap={{ scale: 0.96 }} transition={spring}
      onClick={async () => {
        if (!onClick) return;
        buzz(8);
        const r = onClick();
        if (r instanceof Promise) { setLoading(true); try { await r; } catch { /* toasted */ } finally { setLoading(false); } }
      }}
    >
      {isBusy ? <Spinner /> : icon}
      {children && <span>{children}</span>}
    </motion.button>
  );
}

/** Press and hold to confirm — prevents accidental clock-outs. */
export function HoldButton({ children, onConfirm, icon, ms = 900, tone = "ghost" }: {
  children: ReactNode; onConfirm: () => unknown; icon?: ReactNode; ms?: number; tone?: "ghost" | "danger" | "primary";
}) {
  const p = useMotionValue(0);
  const width = useTransform(p, (v) => `${v * 100}%`);
  const ctl = useRef<ReturnType<typeof animate> | null>(null);
  const [hint, setHint] = useState(false);
  const start = () => {
    buzz(6);
    ctl.current = animate(p, 1, { duration: ms / 1000 * (1 - p.get()), ease: "linear", onComplete: () => { buzz([10, 30, 20]); onConfirm(); p.set(0); } });
  };
  const stop = () => {
    if (p.get() > 0 && p.get() < 0.3) { setHint(true); setTimeout(() => setHint(false), 1400); }
    ctl.current?.stop(); animate(p, 0, { duration: 0.25 });
  };
  return (
    <button className={`btn hold ${tone}`} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) start(); }} onKeyUp={stop}
      onContextMenu={(e) => e.preventDefault()}>
      <motion.i className="hold-fill" style={{ width }} />
      {icon}<span>{hint ? "Hold to confirm" : children}</span>
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = "m" }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "s" | "m";
}) {
  const id = useId();
  return (
    <div className={`seg ${size}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? "on" : ""}
          onClick={() => { buzz(6); onChange(o.value); }}>
          {value === o.value && <motion.i layoutId={`seg-${id}`} className="seg-pill" transition={spring} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Chip({ on, children, onClick, color }: { on?: boolean; children: ReactNode; onClick?: () => void; color?: string }) {
  return (
    <motion.button whileTap={{ scale: 0.94 }} className={`chip ${on ? "on" : ""}`} onClick={() => { buzz(5); onClick?.(); }}
      style={color ? { ["--c" as string]: color } : undefined}>{children}</motion.button>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Empty({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children?: ReactNode }) {
  return (
    <motion.div className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <motion.div className="empty-icon" animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>{icon}</motion.div>
      <b>{title}</b>{hint && <p>{hint}</p>}{children}
    </motion.div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? "on" : ""}`} onClick={() => { buzz(8); onChange(!on); }}>
      <motion.i layout transition={spring} />
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

/** Number that rolls to its new value. */
export function Count({ value, format = (v: number) => String(Math.round(v)) }: { value: number; format?: (v: number) => string }) {
  const mv = useMotionValue(value);
  const [txt, setTxt] = useState(format(value));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.8, ease: [0.2, 0.8, 0.2, 1], onUpdate: (v) => setTxt(format(v)) });
    return () => c.stop();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{txt}</>;
}

export function Ring({ value, size = 120, stroke = 10, color = "var(--brand)", children, track = "var(--line)" }: {
  value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; track?: string;
}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ rotate: -90, transformOrigin: "50% 50%" }} />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

export function Section({ title, action, children, sub }: { title: ReactNode; action?: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{action}</div>
      {children}
    </section>
  );
}

/** Staggered list entrance. */
export const list = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
export const item = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 380, damping: 30 } },
};
