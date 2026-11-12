import { StrictMode, lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalHandlers } from "./lib/errors";
import { t } from "./lib/i18n";
import { apply } from "./lib/prefs";
import "./styles.css";

apply();
installGlobalHandlers();
/** Kortana (inventory) runs from kortana.makz.space, or /kimera on any host. */
const kimera = /^(kortana|kimera)\./.test(location.hostname) || location.pathname.startsWith("/kimera");
if (kimera) {
  document.title = "Kortana";
  document.documentElement.classList.add("is-kimera");
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/kimera.webmanifest");
  document.querySelector('link[rel="icon"]')?.setAttribute("href", "/kimera.svg");
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", "/kimera-apple-touch.png");
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", "Kortana");
}
/** TROTAN (laser design & production) runs from trotan.makz.space, or /trotan on any host. */
const trotan = !kimera && (/^trotan\./.test(location.hostname) || location.pathname.startsWith("/trotan"));
if (trotan) {
  document.title = "TROTAN";
  document.documentElement.classList.add("is-trotan");
  document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/trotan.webmanifest");
  document.querySelector('link[rel="icon"]')?.setAttribute("href", "/trotan.svg");
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", "/trotan-apple-touch.png");
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", "TROTAN");
  const f = document.createElement("link"); f.rel = "stylesheet"; f.href = "https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800&display=swap"; document.head.appendChild(f);
}
/** A part of the app failed to download (usually a deploy replaced it while this page was open): reload once to pick up
 * the current version. If it fails again within a minute, let the error screen explain instead of looping. */
function reloadOnce(e: unknown): never {
  const k = "skf-chunk-reload", last = Number(sessionStorage.getItem(k) ?? 0);
  if (Date.now() - last > 60_000) { sessionStorage.setItem(k, String(Date.now())); location.reload(); }
  throw e;
}
window.addEventListener("vite:preloadError", (ev) => { ev.preventDefault(); reloadOnce((ev as Event & { payload?: unknown }).payload); });
const Root = lazy(() => (trotan ? import("./trotan/TrotanApp").then((m) => ({ default: m.TrotanApp })) : kimera ? import("./kimera/KimeraApp").then((m) => ({ default: m.KimeraApp })) : import("./App").then((m) => ({ default: m.App }))).catch(reloadOnce));
/** Shown while the app downloads: never a blank page. After 15 s it offers a reload. */
function Loading() {
  const [slow, setSlow] = useState(false); const [show, setShow] = useState(false);
  useEffect(() => { const a = setTimeout(() => setShow(true), 1200), b = setTimeout(() => setSlow(true), 15000); return () => { clearTimeout(a); clearTimeout(b); }; }, []);
  if (!show) return null;
  const name = kimera ? "Kortana" : trotan ? "TROTAN" : "Skalarki Factory";
  return <div className="app-loading" role="status" aria-live="polite"><div className="app-loading-bar" /><p>{t("Loading")} {name}…</p>
    {slow && <><p className="app-loading-hint">{t("This is taking longer than usual. Check the internet connection, then reload.")}</p><button type="button" onClick={() => location.reload()}>{t("Reload")}</button></>}</div>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary place="app" full><Suspense fallback={<Loading />}><Root /></Suspense></ErrorBoundary></StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// If no splash runs (e.g. reopened in the same session), clear the static launch frame once the app has drawn.
setTimeout(() => document.getElementById("boot")?.remove(), 1500);
