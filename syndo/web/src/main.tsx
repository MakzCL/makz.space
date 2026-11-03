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
import { navigate, useRoute } from "./router.ts";
import { useStore } from "./store.ts";
import { DEFAULT_APPEARANCE, applyAppearance, validateAppearance } from "./theme.ts";
import "./styles.css";

applyAppearance(DEFAULT_APPEARANCE);
document.title = BRAND.name;

function App() {
  const route = useRoute();
  const conn = useStore((s) => s.conn);
  const appearance = useStore((s) => (s.me?.settings as any)?.appearance);
  const limits = useStore((s) => s.limits);
  const [switcher, setSwitcher] = useState(false);
  useEffect(() => { applyAppearance(validateAppearance(appearance ?? DEFAULT_APPEARANCE)); }, [appearance]);
  useEffect(() => { (window as any).__syndoLimits = limits; }, [limits]);
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
  return <>{page}{switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}<Toasts /></>;
}

initNotifications();
boot();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
