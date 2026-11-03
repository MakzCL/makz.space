import { initCallSounds } from "./voice/sounds.ts";
import { DesktopTitlebar } from "./components/DesktopTitlebar.tsx";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BRAND } from "@syndo/shared";
import { boot } from "./actions.ts";
import { Forgot, Login, Register, Reset, Verify } from "./components/Auth.tsx";
import { InvitePage } from "./components/Dialogs.tsx";
import { Shell } from "./components/Shell.tsx";
import { Splash } from "./components/Splash.tsx";
import { QuickSwitcher } from "./components/QuickSwitcher.tsx";
import { Toasts } from "./components/ui.tsx";
import { initNotifications } from "./notify.ts";
import { initDesktop } from "./desktop.ts";
import { navigate, useRoute } from "./router.ts";
import { useStore } from "./store.ts";
import { restoreSnapshot } from "./appearance/engine.ts";
import { RecoveryBanner } from "./appearance/Recovery.tsx";
import { Studio } from "./appearance/Studio.tsx";
import { reapply, useAppearance } from "./appearance/store.ts";
import { previewMode } from "./preview-mode.ts";
import "./styles.css";

// Paint with the last-used look immediately (no flash), unless recovering. The default theme otherwise.
if (!useAppearance.getState().safeMode) restoreSnapshot();
reapply();
document.title = BRAND.name;
if (previewMode) document.documentElement.dataset.preview = "true";

function App() {
  const route = useRoute();
  const conn = useStore((s) => s.conn);
  const limits = useStore((s) => s.limits);
  const [switcher, setSwitcher] = useState(false);
  const [studio, setStudio] = useState<null | { section?: any; target?: any }>(null);
  useEffect(() => {
    const open = (e: Event) => setStudio((e as CustomEvent).detail ?? {});
    window.addEventListener("syndo:studio", open);
    return () => window.removeEventListener("syndo:studio", open);
  }, []);
  useEffect(() => { (window as any).__syndoLimits = limits; }, [limits]);
  useEffect(() => { if (conn === "ready" && !previewMode) import("./crypto/dm.ts").then(m => m.ensureIdentity()).catch(() => {}); }, [conn]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && conn === "ready") { e.preventDefault(); setSwitcher((v) => !v); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [conn]);
  useEffect(() => {
    const publicRoute = ["login", "register", "forgot", "reset", "verify", "invite"].includes(route.name);
    if (conn === "signed_out" && !publicRoute) navigate(`/login${route.name === "channels" ? `?next=${encodeURIComponent(location.pathname)}` : ""}`, true);
    if ((conn === "ready" || conn === "connecting") && (route.name === "login" || route.name === "register" || route.name === "home")) navigate("/channels/@me", true);
  }, [conn, route.name]);

  let page;
  if (route.name === "invite") page = <InvitePage />;
  else if (route.name === "verify") page = <Verify />;
  else if (route.name === "reset") page = <Reset />;
  else if (route.name === "forgot") page = <Forgot />;
  else if (conn === "booting") page = <Splash />;
  else if (conn === "signed_out") page = route.name === "register" ? <Register /> : <Login />;
  else if (conn === "connecting") page = <Splash />;
  else page = <Shell />;
  return <><DesktopTitlebar />{previewMode && <div className="preview-banner" role="status"><span><strong>Local preview</strong> · Sample data · Messages stay on this device</span>{location.hostname !== "appassets.androidplatform.net" && <button onClick={() => { sessionStorage.removeItem("syndo.preview"); location.href = "/?live=1"; }}>Exit</button>}</div>}{page}{switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}{studio && conn === "ready" && <Studio initial={studio.section} initialTarget={studio.target} onClose={() => setStudio(null)} />}<Toasts /><RecoveryBanner /></>;
}

initNotifications();
initCallSounds();
initDesktop();
boot();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
