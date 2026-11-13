import { hasLayers } from "./layers.ts";

/**
 * Phone behaviour shared by the web app and the Android shell:
 * - long-press opens the same menus as right-click (rendered as bottom sheets on phones),
 * - horizontal swipes move between the channel list and the conversation (Discord-style),
 * - `window.__sendBack()` lets the Android back button close the topmost thing first,
 * - `html[data-app="android"]` marks the native shell so its own controls can be shown.
 */
export const phoneQuery = typeof window !== "undefined" ? window.matchMedia("(max-width: 760px)") : null;
export const isPhone = () => !!phoneQuery?.matches;
export const setNav = (open?: boolean) => window.dispatchEvent(new CustomEvent("send:nav", { detail: { open } }));
export const inAndroidApp = typeof navigator !== "undefined" && /SENDAndroid\//.test(navigator.userAgent);
export const inIosApp = typeof navigator !== "undefined" && /SENDiOS\//.test(navigator.userAgent);

let installed = false;
export function initMobile() {
  if (installed || typeof window === "undefined") return; installed = true;
  if (inAndroidApp) document.documentElement.dataset.app = "android";
  if (inIosApp) document.documentElement.dataset.app = "ios";

  /* ---------------- long-press → contextmenu (one consistent gesture for every menu) */
  let timer = 0, start: { x: number; y: number; t: Element } | null = null, fired = false;
  const cancel = () => { clearTimeout(timer); timer = 0; start = null; };
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { cancel(); return; }
    const t = e.target as Element, touch = e.touches[0]!;
    if (t.closest("input,textarea,[contenteditable=true],.crop-stage,.viewer-stage,video,audio,input[type=range]")) return;
    fired = false; start = { x: touch.clientX, y: touch.clientY, t };
    timer = window.setTimeout(() => {
      if (!start) return;
      fired = true;
      navigator.vibrate?.(8);
      start.t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y, button: 2 }));
      start = null;
    }, 450);
  }, { passive: true });
  document.addEventListener("touchmove", (e) => { if (!start) return; const t = e.touches[0]!; if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel(); }, { passive: true });
  document.addEventListener("touchend", (e) => { if (fired) { e.preventDefault(); fired = false; } cancel(); }, { passive: false });
  document.addEventListener("touchcancel", cancel, { passive: true });
  // The browser's own long-press menu would otherwise appear on top of ours (or select text).
  // On touch-only devices the browser's own long-press "contextmenu" is replaced by ours above (fired a little earlier).
  document.addEventListener("contextmenu", (e) => { if (e.isTrusted && isTouchContext()) { e.preventDefault(); e.stopPropagation(); } }, true);

  /* ---------------- swipe between channel list and conversation */
  let sw: { x: number; y: number; t: number; ok: boolean } | null = null;
  document.addEventListener("touchstart", (e) => {
    if (!isPhone() || e.touches.length !== 1 || hasLayers()) { sw = null; return; }
    const t = e.target as Element, touch = e.touches[0]!;
    // Never steal horizontal gestures from things that scroll sideways or need drags.
    const ok = !t.closest(".tabs,.settings-nav,.settings-scroll-nav,.ctx-emoji-row,.viewer,.crop-stage,pre,code,input,textarea,.send-range,[data-no-swipe],.studio,.modal");
    sw = { x: touch.clientX, y: touch.clientY, t: Date.now(), ok };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!sw?.ok) return; const touch = e.changedTouches[0]!; const dx = touch.clientX - sw.x, dy = touch.clientY - sw.y, dt = Date.now() - sw.t; sw = null;
    if (dt > 700 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const open = document.querySelector(".shell")?.classList.contains("nav-open");
    if (dx > 0 && !open) setNav(true); else if (dx < 0 && open && location.pathname.split("/").filter(Boolean).length >= 3) setNav(false);
  }, { passive: true });

  /* ---------------- hardware/gesture back (called by the Android shell) */
  (window as any).__sendBack = () => {
    if (hasLayers()) { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); return true; }
    const panelClose = [...document.querySelectorAll<HTMLElement>(".m-you [data-panel-close], .m-info > .m-info-top [data-panel-close], .side-panel [data-panel-close]")].find((b) => b.offsetParent !== null) ?? null;
    if (isPhone() && panelClose && panelClose.offsetParent !== null) { panelClose.click(); return true; }
    const shell = document.querySelector(".shell");
    if (isPhone() && shell && !shell.classList.contains("nav-open")) { setNav(true); return true; }
    return false;
  };
}
const isTouchContext = () => window.matchMedia("(hover: none) and (pointer: coarse)").matches;

/** React hook: true on phone-sized screens, updating when the window crosses the breakpoint. */
import { useSyncExternalStore } from "react";
export const usePhone = () => useSyncExternalStore((cb) => { phoneQuery?.addEventListener("change", cb); return () => phoneQuery?.removeEventListener("change", cb); }, isPhone, () => false);
