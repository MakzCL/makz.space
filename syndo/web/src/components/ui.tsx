import { useLayer } from "../layers.ts";
import { ArrowLeft } from "lucide-react";
import { CollectionArt } from "../appearance/CollectionArt.tsx";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BRAND_ART } from "../brand-art.ts";
import { BRAND, type User } from "@send/shared";
import { displayName, useStore } from "../store.ts";
import { timeFormat } from "../appearance/engine.ts";
import { decorClasses, decorVars, useCosmetics } from "../appearance/effects.tsx";

/** SEND artwork outlined from Dimitri Regular. */
export function Mark({ size = 40, animate = false, title = BRAND.name, fill = "currentColor" }: { size?: number; animate?: boolean; title?: string; fill?: string }) {
  const art = BRAND_ART.mark;
  return <svg className={`mark ${animate ? "mark-anim" : ""}`} width={size} height={size} viewBox={`0 0 ${art.width} ${art.height}`} role="img" aria-label={title}><g transform={art.transform} fill={fill}><path d={art.path} /></g></svg>;
}

export function Wordmark({ className = "" }: { className?: string }) {
  const art = BRAND_ART.wordmark;
  return <svg className={`send-wordmark ${className}`} viewBox={`0 0 ${art.width} ${art.height}`} role="img" aria-label={BRAND.name}><g transform={art.transform} fill="currentColor"><path d={art.path} /></g></svg>;
}

const STATUS_LABEL: Record<string, string> = { online: "Online", idle: "Idle", dnd: "Do not disturb", invisible: "Invisible", offline: "Offline" };
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? "Offline";

export function StatusDot({ status, size = 12 }: { status: string; size?: number }) {
  return <i className={`sdot s-${status}`} style={{ width: size, height: size }} role="img" aria-label={statusLabel(status)} />;
}

const initials = (u: User | null | undefined) => displayName(u).slice(0, 2).toUpperCase();
const hue = (id: string) => [BRAND.colors.blue, BRAND.colors.coral, BRAND.colors.yellowDeep, "#2FBF71", "#9B6BFF", "#E5484D"][Number(BigInt(id || "0") % 6n)];

export function Avatar({ user, size = 40, status, src, serverTheme, plain }: { user: User | null | undefined; size?: number; status?: string | null; src?: string | null; decoration?: string | null; serverTheme?: unknown; plain?: boolean }) {
  const presence = useStore((s) => (user ? (user.id === s.me?.id ? (s.me.status === "invisible" ? "invisible" : s.me.status) : s.presences[user.id] ?? "offline") : "offline"));
  const { theme, animate } = useCosmetics(plain ? null : user, serverTheme);
  const url = src ?? user?.avatar ?? null;
  return (
    <span className={`avatar ${decorClasses(theme, animate)}`} style={{ width: size, height: size, ...decorVars(theme) }}>
      {url ? <img src={url} alt="" width={size} height={size} loading="lazy" decoding="async" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
        : <span className="avatar-fallback" style={{ background: hue(user?.id ?? "0"), fontSize: size * 0.38 }} aria-hidden>{initials(user)}</span>}
      {theme?.collection && <CollectionArt id={theme.collection} animate={animate} />}
      {status !== undefined && status !== null && <StatusDot status={status || presence} size={Math.max(10, size * 0.3)} />}
    </span>
  );
}

export function Modal({ title, onClose, children, wide, footer, label, className }: { title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode; label?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Escape (topmost layer only) closes; focus returns to the opener; presses outside can't reach what's underneath.
  useLayer(ref, onClose, { outside: false });
  useEffect(() => {
    const el = ref.current!;
    const focusables = () => [...el.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled") && !x.closest("[hidden]"));
    (el.querySelector<HTMLElement>("[autofocus]") ?? focusables()[0])?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const f = focusables(); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1]!.focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0]!.focus(); }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);
  // Close only when both press and release land on the backdrop (dragging a text selection out of a field must not close it).
  const down = useRef<EventTarget | null>(null);
  // Portalled to <body>: a dialog opened from inside another (e.g. the crop editor in Settings) must not be clipped or
  // positioned by its parent's backdrop-filter, which would make it a containing block for fixed elements.
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => { down.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && down.current === e.currentTarget) onClose(); }}>
      <div ref={ref} data-region="overlay" data-layer className={`modal ${wide ? "wide" : ""} ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)}>
        {title && <header className="modal-h"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button></header>}
        <div className="modal-b">{children}</div>
        {footer && <footer className="modal-f">{footer}</footer>}
      </div>
    </div>, document.body);
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
  if (timeFormat === "relative") {
    const m = Math.round((now.getTime() - d.getTime()) / 60000);
    if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return d.toLocaleDateString();
  }
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: timeFormat === "12h" });
  const same = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same) return `Today at ${t}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${t}`;
  return `${d.toLocaleDateString()} ${t}`;
}
export const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: timeFormat === "12h" });
export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);

/** Opens the channel list on phones; hidden on wider screens. Sits inside each screen's header (never floats over it). */
export function MobileNavButton() {
  // Back arrow with the number of mentions waiting elsewhere, like Discord's phone app.
  const mentions = useStore((s) => { let n = 0; for (const id in s.readStates) n += s.readStates[id]!.mention_count || 0; return n; });
  return <button className="m-nav-btn" aria-label="Open channels and servers" onClick={() => window.dispatchEvent(new CustomEvent("send:nav", { detail: { open: true } }))}><ArrowLeft size={24} />{mentions > 0 && <span className="m-nav-badge">{mentions > 99 ? "99+" : mentions}</span>}</button>;
}
