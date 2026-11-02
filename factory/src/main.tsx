import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installGlobalHandlers } from "./lib/errors";
import { apply } from "./lib/prefs";
import "./styles.css";

apply();
installGlobalHandlers();
createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary place="app" full><App /></ErrorBoundary></StrictMode>);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
