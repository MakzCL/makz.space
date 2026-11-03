import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BRAND, type User } from "@syndo/shared";
import { displayName, useStore } from "../store.ts";

let markSeq = 0;
/** The Syndo mark: a sharp hexagon cut into an S by two point-symmetric channels. Uses currentColor unless a fill is given. */
export function Mark({ size = 40, animate = false, title = BRAND.name, fill = "currentColor" }: { size?: number; animate?: boolean; title?: string; fill?: string }) {
  const [id] = useState(() => `sm${++markSeq}`);
  return (
    <svg className={`mark ${animate ? "mark-anim" : ""}`} width={size} height={size} viewBox="0 0 128 128" role="img" aria-label={title}>
      <defs>
        <mask id={id}>
          <rect x="-20" y="-20" width="168" height="168" fill="#fff" />
          <polygon className="m-cut1" points="42,55 48.93,43 140,43 140,55" fill="#000" />
          <polygon className="m-cut2" points="86,73 79.07,85 -12,85 -12,73" fill="#000" />
        </mask>
      </defs>
      <polygon className="m-hex" points="64,6 114.23,35 114.23,93 64,122 13.77,93 13.77,35" fill={fill} mask={`url(#${id})`} />
    </svg>
  );
}

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do not disturb", invisible: "Invisible", offline: "Offline" };
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? "Offline";

export function StatusDot({ status, size = 12 }: { status: string; size?: number }) {
  return <i className={`sdot s-${status}`} style={{ width: size, height: size }} role="img" aria-label={statusLabel(status)} />;
}

const initials = (u: User | null | undefined) => displayName(u).slice(0, 2).toUpperCase();
const hue = (id: string) => [BRAND.colors.blue, BRAND.colors.coral, BRAND.colors.yellowDeep, "#2FBF71", "#9B6BFF", "#E5484D"][Number(BigInt(id || "0") % 6n)];

export function Avatar({ user, size = 40, status, src, decoration }: { user: User | null | undefined; size?: number; status?: string | null; src?: string | null; decoration?: string | null }) {
  const presence = useStore((s) => (user ? (user.id === s.me?.id ? (s.me.status === "invisible" ? "invisible" : s.me.status) : s.presences[user.id] ?? "offline") : "offline"));
  const animated = useStore((s) => (s.me?.settings as any)?.appearance?.showAnimatedAvatars !== false);
  const url = src ?? user?.avatar ?? null;
  const deco = decoration ?? user?.profile_theme?.decoration ?? null;
  return (
    <span className={`avatar ${deco ? `deco deco-${deco}` : ""}`} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" width={size} height={size} loading="lazy" className={animated ? "" : "freeze"} />
        : <span className="avatar-fallback" style={{ background: hue(user?.id ?? "0"), fontSize: size * 0.38 }} aria-hidden>{initials(user)}</span>}
      {status !== undefined && status !== null && <StatusDot status={status || presence} size={Math.max(10, size * 0.3)} />}
    </span>
  );
}

export function Modal({ title, onClose, children, wide, footer, label }: { title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
    (el.querySelector<HTMLElement>("[autofocus]") ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab") {
        const f = focusables(); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1]!.focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0]!.focus(); }
      }
    };
    el.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)}>
        {title && <header className="modal-h"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>}
        <div className="modal-b">{children}</div>
        {footer && <footer className="modal-f">{footer}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-l">{label}</span>
      {children}
      {hint && !error && <span className="field-h">{hint}</span>}
      {error && <span className="field-e" role="alert">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`toggle-row ${disabled ? "disabled" : ""}`}>
      <span><span className="toggle-l">{label}</span>{hint && <span className="field-h">{hint}</span>}</span>
      <input type="checkbox" role="switch" className="toggle" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Toasts() {
  const notice = useStore((s) => s.notice);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {notice.map((n) => <div key={n.id} className={`toast t-${n.kind}`}>{n.text}</div>)}
    </div>
  );
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (same) return `Today at ${t}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${t}`;
  return `${d.toLocaleDateString()} ${t}`;
}
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
