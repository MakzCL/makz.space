/**
 * "A new version of SEND is ready." Every Cloudflare deploy of the web app is an update: the app checks
 * /version.json every few minutes and when you come back to it, and offers to reload into the new build
 * (green button in the desktop app's title bar, a bar at the top everywhere else). Nothing reloads on its
 * own, so a call or a half-written message is never cut off — except when an old build can't load a part
 * of itself any more, which only a reload fixes.
 */
import { useSyncExternalStore } from "react";
import { previewMode } from "./preview-mode.ts";

const current = document.querySelector<HTMLMetaElement>('meta[name="send-build"]')?.content ?? "dev";
let available = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { if (available !== v) { available = v; subs.forEach((f) => f()); } };

let last = 0, checking = false;
export async function checkForWebUpdate(force = false) {
  if (current === "dev" || previewMode || checking || (!force && Date.now() - last < 60_000)) return available;
  checking = true; last = Date.now();
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) { const j = await r.json(); if (j?.build && j.build !== current) set(true); }
  } catch { /* offline: try again later */ } finally { checking = false; }
  return available;
}

export function initWebUpdates() {
  if (current === "dev" || previewMode) return;
  setInterval(() => void checkForWebUpdate(), 5 * 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkForWebUpdate(); });
  window.addEventListener("focus", () => void checkForWebUpdate());
  window.addEventListener("online", () => void checkForWebUpdate(true));
  // A part of the old build was removed by the deploy: reload into the new one (at most once a minute).
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    try { const at = Number(sessionStorage.getItem("send.reload-at") ?? 0); if (Date.now() - at < 60_000) { set(true); return; } sessionStorage.setItem("send.reload-at", String(Date.now())); } catch { /* */ }
    location.reload();
  });
  setTimeout(() => void checkForWebUpdate(true), 30_000);
}

export const applyWebUpdate = () => location.reload();
export const useWebUpdate = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => available);
