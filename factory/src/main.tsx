import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalHandlers } from "./lib/errors";
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
const Root = lazy(() => kimera ? import("./kimera/KimeraApp").then((m) => ({ default: m.KimeraApp })) : import("./App").then((m) => ({ default: m.App })));
createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary place="app" full><Suspense fallback={null}><Root /></Suspense></ErrorBoundary></StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// If no splash runs (e.g. reopened in the same session), clear the static launch frame once the app has drawn.
setTimeout(() => document.getElementById("boot")?.remove(), 1500);
