import { ChevronLeft, ChevronRight, Download, ExternalLink, X, ChevronRight as Sub, Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useLayer, type LayerOptions } from "../layers.ts";

/* =============================================================== Popover == */
/** A transient surface anchored to a toggle: outside press and Escape close it; pressing the toggle again closes it. */
export function Popover({ onClose, anchor, className = "", children, role = "menu", label, opts, onClick, style }: {
  onClose: () => void; anchor?: () => Element | null | undefined; className?: string; children: ReactNode; role?: string; label?: string; opts?: LayerOptions;
  onClick?: React.MouseEventHandler<HTMLDivElement>; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { anchor, ...opts });
  // Menus get arrow-key navigation between their items; focus moves into the popover when opened from the keyboard.
  useEffect(() => { if (role === "menu" && document.activeElement && anchor?.()?.contains(document.activeElement) && (document.activeElement as HTMLElement).matches(":focus-visible")) ref.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus(); }, []); // eslint-disable-line
  const key = (e: React.KeyboardEvent) => {
    if (role !== "menu" || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>("[role^=menuitem]:not([disabled])")]; if (!items.length) return;
    e.preventDefault(); const i = items.indexOf(document.activeElement as HTMLElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[n]!.focus();
  };
  return <div ref={ref} className={className} role={role} aria-label={label} data-layer onClick={onClick} onKeyDown={key} style={style}>{children}</div>;
}

/* ========================================================== Media viewer == */
export interface MediaItem { url: string; filename: string; content_type: string; width?: number | null; height?: number | null; original?: string }
const useViewer = create<{ items: MediaItem[]; index: number; open: boolean }>(() => ({ items: [], index: 0, open: false }));
export const openMediaViewer = (items: MediaItem[], index = 0) => { if (items.length) useViewer.setState({ items, index: Math.max(0, Math.min(index, items.length - 1)), open: true }); };
export const closeMediaViewer = () => useViewer.setState({ open: false, items: [] });

export function MediaViewerHost() {
  const open = useViewer((s) => s.open);
  return open ? <MediaViewer /> : null;
}

function MediaViewer() {
  const { items, index } = useViewer();
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(false);
  const item = items[index];
  useLayer(ref, closeMediaViewer, { outside: false });
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => setZoom(false), [index]);
  // Navigation (from the router) always closes the viewer; its object URLs belong to the conversation.
  useEffect(() => { const close = () => closeMediaViewer(); window.addEventListener("popstate", close); return () => window.removeEventListener("popstate", close); }, []);
  if (!item) return null;
  const go = (d: number) => useViewer.setState({ index: (index + d + items.length) % items.length });
  const key = (e: React.KeyboardEvent) => {
    if (items.length > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); go(e.key === "ArrowLeft" ? -1 : 1); }
    if (e.key === "Home" && items.length > 1) { e.preventDefault(); useViewer.setState({ index: 0 }); }
    if (e.key === "End" && items.length > 1) { e.preventDefault(); useViewer.setState({ index: items.length - 1 }); }
  };
  // Pressing the backdrop/stage closes; pressing the media or any control does not. Require press and release
  // on the backdrop so dragging out of the image (e.g. selecting the caption) doesn't close it.
  const down = useRef<EventTarget | null>(null);
  const isBackdrop = (t: EventTarget) => t instanceof HTMLElement && t.hasAttribute("data-viewer-backdrop");
  const video = item.content_type.startsWith("video/");
  return createPortal(
    <div ref={ref} className="viewer" role="dialog" aria-modal="true" aria-label={`Media viewer: ${item.filename}`} tabIndex={-1} onKeyDown={key} data-layer
      onPointerDown={(e) => { down.current = e.target; }} onClick={(e) => { if (isBackdrop(e.target) && down.current === e.target) closeMediaViewer(); }}>
      <header className="viewer-bar">
        <span className="viewer-name ellipsis" title={item.filename}>{item.filename}</span>
        {items.length > 1 && <span className="viewer-count muted">{index + 1} / {items.length}</span>}
        <span className="grow" />
        <a className="icon-btn" href={item.url} download={item.filename} aria-label="Download" title="Download"><Download size={20} /></a>
        {item.original !== undefined || !item.url.startsWith("blob:") ? <a className="icon-btn" href={item.original ?? item.url} target="_blank" rel="noreferrer" aria-label="Open in browser" title="Open in browser"><ExternalLink size={20} /></a> : null}
        <button className="icon-btn" onClick={closeMediaViewer} aria-label="Close" title="Close (Esc)"><X size={22} /></button>
      </header>
      <div className={`viewer-stage ${zoom ? "zoomed" : ""}`} data-viewer-backdrop>
        {items.length > 1 && <button className="viewer-nav prev" onClick={() => go(-1)} aria-label="Previous"><ChevronLeft size={28} /></button>}
        {video
          ? <video key={item.url} className="viewer-media" src={item.url} controls autoPlay />
          : <img key={item.url} className="viewer-media" src={item.url} alt={item.filename} draggable={false} onDoubleClick={() => setZoom((z) => !z)}
            style={item.width && item.height ? { aspectRatio: `${item.width}/${item.height}` } : undefined} />}
        {items.length > 1 && <button className="viewer-nav next" onClick={() => go(1)} aria-label="Next"><ChevronRight size={28} /></button>}
      </div>
      {items.length > 1 && items.length <= 40 && (
        <nav className="viewer-strip" aria-label="Media in this message">
          {items.map((it, i) => <button key={it.url + i} className={i === index ? "active" : ""} aria-current={i === index} aria-label={`${i + 1}: ${it.filename}`} onClick={() => useViewer.setState({ index: i })}>
            {it.content_type.startsWith("video/") ? <span className="viewer-thumb-video">▶</span> : <img src={it.url} alt="" loading="lazy" />}
          </button>)}
        </nav>
      )}
    </div>, document.body);
}

/* ========================================================== Context menus == */
export type MenuItem =
  | { kind?: "item"; id?: string; label: string; icon?: ReactNode; hint?: string; danger?: boolean; disabled?: boolean; onSelect?: () => void; submenu?: MenuItem[]; checked?: boolean }
  | { kind: "separator" }
  | { kind: "custom"; render: (close: () => void) => ReactNode };
const useMenu = create<{ items: MenuItem[] | null; x: number; y: number; keyboard: boolean }>(() => ({ items: null, x: 0, y: 0, keyboard: false }));
export const closeContextMenu = () => useMenu.setState({ items: null });

/** Open a context menu at the pointer (or below the focused element for keyboard opens). */
export function openContextMenu(e: { clientX?: number; clientY?: number; preventDefault?: () => void; currentTarget?: EventTarget | null; type?: string }, items: MenuItem[]) {
  e.preventDefault?.();
  const visible = items.filter((i) => i.kind !== "separator" || true);
  if (!visible.some((i) => i.kind !== "separator")) return;
  const keyboard = !e.clientX && !e.clientY;
  let x = e.clientX ?? 0, y = e.clientY ?? 0;
  if (keyboard && e.currentTarget instanceof Element) { const r = e.currentTarget.getBoundingClientRect(); x = r.left + 16; y = r.top + Math.min(r.height, 32); }
  useMenu.setState({ items: tidy(items), x, y, keyboard });
}
/** Drop leading/trailing/duplicate separators left over from permission-filtered items. */
function tidy(items: MenuItem[]) {
  const out: MenuItem[] = [];
  for (const i of items) { if (i.kind === "separator" && (!out.length || out[out.length - 1]!.kind === "separator")) continue; out.push(i); }
  while (out.length && out[out.length - 1]!.kind === "separator") out.pop();
  return out;
}

export function ContextMenuHost() {
  const { items, x, y, keyboard } = useMenu();
  if (!items) return null;
  return createPortal(<MenuSurface key={`${x},${y}`} items={items} at={{ x, y }} focusFirst={keyboard} onClose={closeContextMenu} />, document.body);
}

function MenuSurface({ items, at, onClose, focusFirst, parentItem, level = 0 }: {
  items: MenuItem[]; at: { x: number; y: number; flipFrom?: number }; onClose: () => void; focusFirst?: boolean; parentItem?: HTMLElement | null; level?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y, ready: false });
  const [sub, setSub] = useState<{ index: number; el: HTMLElement; keyboard: boolean } | null>(null);
  const openTimer = useRef<number>(0), closeTimer = useRef<number>(0);
  // Submenus are their own layers: Escape/ArrowLeft close just the submenu. Root menus close on outside press and window blur.
  useLayer(ref, () => (level ? onClose() : closeContextMenu()), { blur: true, anchor: () => parentItem });
  useLayoutEffect(() => {
    const el = ref.current!; const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, m = 8;
    let left = at.x, top = at.y;
    if (left + w > vw - m) left = at.flipFrom !== undefined ? Math.max(m, at.flipFrom - w) : Math.max(m, vw - w - m);
    if (top + h > vh - m) top = Math.max(m, level ? vh - h - m : at.y - h);
    if (top < m) top = m;
    setPos({ left, top, ready: true });
  }, [at.x, at.y]); // eslint-disable-line
  useEffect(() => {
    const el = ref.current!;
    (focusFirst ? el.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true]),[role=menuitemcheckbox]:not([aria-disabled=true])") ?? el : el).focus({ preventScroll: true });
    return () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current); };
  }, []); // eslint-disable-line
  const focusables = () => [...ref.current!.querySelectorAll<HTMLElement>(":scope > [role=menuitem]:not([aria-disabled=true]), :scope > [role=menuitemcheckbox]:not([aria-disabled=true]), :scope > .ctx-custom input:not(:disabled), :scope > .ctx-custom button:not(:disabled)")];
  const run = (it: Extract<MenuItem, { label: string }>) => { if (it.disabled) return; if (it.submenu) return; closeContextMenu(); it.onSelect?.(); };
  const typeahead = useRef({ s: "", t: 0 });
  const key = (e: React.KeyboardEvent) => {
    if (e.target !== ref.current && !(e.target as HTMLElement).matches("[role^=menuitem]")) return; // custom rows handle their own keys
    const f = focusables(); const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); f[(i + (e.key === "ArrowDown" ? 1 : -1) + f.length) % f.length]?.focus(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); (e.key === "Home" ? f[0] : f[f.length - 1])?.focus(); }
    else if (e.key === "ArrowRight") { const el = document.activeElement as HTMLElement; const idx = Number(el?.dataset.index); if (items[idx] && "submenu" in items[idx]! && (items[idx] as any).submenu) { e.preventDefault(); e.stopPropagation(); setSub({ index: idx, el, keyboard: true }); } }
    else if (e.key === "ArrowLeft" && level) { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === "Tab") { e.preventDefault(); closeContextMenu(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now(); typeahead.current = { s: (now - typeahead.current.t < 600 ? typeahead.current.s : "") + e.key.toLowerCase(), t: now };
      f.find((x) => x.textContent?.trim().toLowerCase().startsWith(typeahead.current.s))?.focus();
    }
  };
  const subItem = sub ? items[sub.index] : null;
  // A menu made only of emoji (e.g. "Add reaction") reads better as a grid of big targets.
  const emojiOnly = items.length > 3 && items.every((i) => i.kind !== "separator" && i.kind !== "custom" && /^\p{Extended_Pictographic}[\p{Extended_Pictographic}\u200d\ufe0f\p{Emoji_Modifier}]*$/u.test((i as any).label));
  return (
    <>
      <div ref={ref} className={`ctx-menu ${emojiOnly ? "ctx-emoji-grid" : ""}`} role="menu" tabIndex={-1} data-layer onKeyDown={key} onContextMenu={(e) => e.preventDefault()}
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}>
        {items.map((it, idx) => {
          if (it.kind === "separator") return <div key={idx} className="ctx-sep" role="separator" />;
          if (it.kind === "custom") return <div key={idx} className="ctx-custom">{it.render(closeContextMenu)}</div>;
          const hasSub = !!it.submenu?.length;
          const isOpen = sub?.index === idx;
          return (
            <div key={idx} data-index={idx} role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"} aria-checked={it.checked} tabIndex={-1}
              aria-disabled={it.disabled || undefined} aria-haspopup={hasSub || undefined} aria-expanded={hasSub ? isOpen : undefined}
              className={`ctx-item ${it.danger ? "danger" : ""} ${isOpen ? "open" : ""}`}
              onPointerEnter={(e) => {
                const el = e.currentTarget; el.focus({ preventScroll: true }); clearTimeout(closeTimer.current); clearTimeout(openTimer.current);
                if (hasSub && !it.disabled) openTimer.current = window.setTimeout(() => setSub({ index: idx, el, keyboard: false }), 120);
                else if (sub) closeTimer.current = window.setTimeout(() => setSub(null), 250); // grace period to travel into the open submenu
              }}
              onClick={(e) => { if (hasSub && !it.disabled) { setSub({ index: idx, el: e.currentTarget, keyboard: false }); return; } run(it); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (hasSub) setSub({ index: idx, el: e.currentTarget, keyboard: true }); else run(it); } }}>
              {it.checked !== undefined ? <span className={`ctx-check ${it.checked ? "on" : ""}`}>{it.checked && <Check size={12} />}</span> : null}
              <span className="ctx-label">{it.label}</span>
              {it.hint && <span className="ctx-hint">{it.hint}</span>}
              {it.icon && <span className="ctx-icon" aria-hidden>{it.icon}</span>}
              {hasSub && <Sub size={14} className="ctx-sub" aria-hidden />}
            </div>
          );
        })}
      </div>
      {sub && subItem && "submenu" in subItem && subItem.submenu && (() => {
        const r = sub.el.getBoundingClientRect();
        return <div onPointerEnter={() => clearTimeout(closeTimer.current)}>
          <MenuSurface items={subItem.submenu} at={{ x: r.right + 2, y: r.top - 6, flipFrom: r.left - 2 }} level={level + 1} parentItem={sub.el} focusFirst={sub.keyboard}
            onClose={() => { setSub(null); sub.el.focus({ preventScroll: true }); }} />
        </div>;
      })()}
    </>
  );
}

/* ================================================================ Tooltips == */
/**
 * Replaces native `title` tooltips app-wide with themed ones. Shows after a short delay on hover or on
 * keyboard focus; hides on pointer exit, press, scroll, Escape, window blur or when the element goes away.
 * `data-tip-side="right"` places it beside the element (server rail). The original title is kept as
 * `data-tip` and copied to aria-label when the element has no other accessible name.
 */
export function initTooltips() {
  let tip: HTMLDivElement | null = null, current: HTMLElement | null = null, timer = 0, watch = 0;
  const hide = () => { clearTimeout(timer); clearInterval(watch); current = null; tip?.remove(); tip = null; };
  const adopt = (el: HTMLElement) => {
    const t = el.getAttribute("title");
    if (t) { el.dataset.tip = t; el.removeAttribute("title"); if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t); }
    return el.dataset.tip;
  };
  const show = (el: HTMLElement, delay: number) => {
    const text = adopt(el); if (!text) return;
    if (current === el) return;
    hide(); current = el;
    timer = window.setTimeout(() => {
      if (current !== el || !el.isConnected) return;
      tip = document.createElement("div"); tip.className = "tooltip"; tip.setAttribute("role", "tooltip"); tip.textContent = text;
      const side = el.dataset.tipSide ?? (el.closest(".rail") && !document.documentElement.matches("[data-nav=horizontal]") ? "right" : "top");
      tip.dataset.side = side; document.body.appendChild(tip);
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, m = 6;
      let left = side === "right" ? r.right + 10 : r.left + r.width / 2 - w / 2, top = side === "right" ? r.top + r.height / 2 - h / 2 : r.top - h - 8;
      if (side !== "right" && top < m) { top = r.bottom + 8; tip.dataset.side = "bottom"; }
      left = Math.max(m, Math.min(window.innerWidth - w - m, left)); top = Math.max(m, Math.min(window.innerHeight - h - m, top));
      tip.style.left = `${left}px`; tip.style.top = `${top}px`;
      watch = window.setInterval(() => { if (!el.isConnected) hide(); }, 250);
    }, delay);
  };
  document.addEventListener("pointerover", (e) => {
    if ((e as PointerEvent).pointerType === "touch") return;
    const el = (e.target as Element).closest?.<HTMLElement>("[title],[data-tip]");
    if (el && !el.matches("input,textarea,select,option,iframe")) show(el, el.closest(".rail") ? 50 : 450);
    else if (current && !current.contains(e.target as Node)) hide();
  }, true);
  document.addEventListener("pointerout", (e) => { if (current && !current.contains((e as PointerEvent).relatedTarget as Node)) hide(); }, true);
  document.addEventListener("focusin", (e) => { const el = (e.target as Element).closest?.<HTMLElement>("[title],[data-tip]"); if (el && el.matches(":focus-visible")) show(el, 300); });
  document.addEventListener("focusout", hide);
  for (const ev of ["pointerdown", "scroll", "wheel"]) document.addEventListener(ev, hide, { capture: true, passive: true });
  document.addEventListener("keydown", hide, true);
  window.addEventListener("blur", hide);
}

/* ============================================================== Confirmations == */
type Ask = { kind: "confirm" | "text"; title: string; body?: string; confirmLabel?: string; danger?: boolean; label?: string; initial?: string; placeholder?: string; mustEqual?: string; optional?: boolean; password?: boolean; resolve: (v: any) => void };
const useAsk = create<{ queue: Ask[] }>(() => ({ queue: [] }));
const enqueue = (a: Omit<Ask, "resolve">) => new Promise<any>((resolve) => useAsk.setState((s) => ({ queue: [...s.queue, { ...a, resolve }] })));
const firstLine = (s: string) => { const i = s.indexOf("\n"); return i < 0 ? { title: s, body: undefined } : { title: s.slice(0, i), body: s.slice(i + 1).trim() }; };
const guessDanger = (s: string) => /delete|remove|block|kick|ban|leave|discard|reset|transfer|revoke/i.test(s);
/** Themed replacement for window.confirm. A string's first line is the title, the rest the explanation. */
export function askConfirm(q: string | { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  const o = typeof q === "string" ? { ...firstLine(q), danger: guessDanger(q) } : q;
  return enqueue({ kind: "confirm", ...o });
}
/** Themed replacement for window.prompt. Resolves null on cancel. */
export function askText(o: { title: string; body?: string; label?: string; initial?: string; placeholder?: string; confirmLabel?: string; danger?: boolean; mustEqual?: string; optional?: boolean; password?: boolean }): Promise<string | null> {
  return enqueue({ kind: "text", ...o });
}

export function AskHost() {
  const a = useAsk((s) => s.queue[0]);
  return a ? <AskDialog key={a.title + (a.initial ?? "")} a={a} /> : null;
}
function AskDialog({ a }: { a: Ask }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(a.initial ?? "");
  const done = (v: any) => { useAsk.setState((s) => ({ queue: s.queue.slice(1) })); a.resolve(v); };
  const cancel = () => done(a.kind === "confirm" ? false : null);
  useLayer(ref, cancel, { outside: false });
  const ok = a.kind === "confirm" || (a.mustEqual !== undefined ? text === a.mustEqual : a.optional || text.trim().length > 0);
  const submit = () => { if (ok) done(a.kind === "confirm" ? true : text); };
  useEffect(() => { ref.current?.querySelector<HTMLElement>(a.kind === "text" ? "input" : a.danger ? ".ask-cancel" : ".ask-ok")?.focus(); }, []); // eslint-disable-line
  const down = useRef<EventTarget | null>(null);
  return createPortal(
    <div className="modal-back ask-back" onPointerDown={(e) => { down.current = e.target; }} onClick={(e) => { if (e.target === e.currentTarget && down.current === e.currentTarget) cancel(); }}>
      <div ref={ref} className="modal ask" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby={a.body ? "ask-body" : undefined} data-layer
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (a.kind === "text" || (e.target as HTMLElement).matches?.(".ask-ok"))) { e.preventDefault(); submit(); } }}>
        <div className="modal-b">
          <h2 id="ask-title">{a.title}</h2>
          {a.body && <p id="ask-body" className="muted pre-line">{a.body}</p>}
          {a.kind === "text" && <label className="field"><span className="field-l">{a.label ?? (a.mustEqual !== undefined ? `Type "${a.mustEqual}" to confirm` : a.title)}</span>
            <input value={text} type={a.password ? "password" : "text"} autoComplete={a.password ? "current-password" : "off"} placeholder={a.placeholder} onChange={(e) => setText(e.target.value)} /></label>}
        </div>
        <footer className="modal-f">
          <button className="btn ask-cancel" onClick={cancel}>Cancel</button>
          <button className={`btn ${a.danger ? "danger" : "primary"} ask-ok`} disabled={!ok} onClick={submit}>{a.confirmLabel ?? (a.kind === "text" ? "Save" : a.danger ? "Confirm" : "OK")}</button>
        </footer>
      </div>
    </div>, document.body);
}

/** A plain element registered as a dismissible layer (for surfaces that manage their own markup). */
export function LayerBox({ onDismiss, anchor, opts, ...rest }: React.HTMLAttributes<HTMLDivElement> & { onDismiss: () => void; anchor?: () => Element | null | undefined; opts?: LayerOptions }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onDismiss, { anchor, ...opts });
  return <div ref={ref} data-layer {...rest} />;
}
