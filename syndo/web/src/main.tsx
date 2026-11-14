import "./legacy.ts"; // must stay first: maps names from before the rename (desktop bridge, saved settings)
import { DesktopPrompt } from "./components/DesktopPrompt.tsx";
import { initCallSounds } from "./voice/sounds.ts";
import { initSoundboard } from "./expressions.ts";
import { DesktopTitlebar } from "./components/DesktopTitlebar.tsx";
import { InAppNotices } from "./components/InAppNotices.tsx";
import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BRAND } from "@send/shared";
import { boot } from "./actions.ts";
import { Forgot, Login, Register, Reset, Verify } from "./components/Auth.tsx";
import { InvitePage } from "./components/Dialogs.tsx";
const FxLab = lazy(() => import("./appearance/FxLab.tsx"));
import { Shell } from "./components/Shell.tsx";
import { Splash } from "./components/Splash.tsx";
import { QuickSwitcher } from "./components/QuickSwitcher.tsx";
import { Toasts } from "./components/ui.tsx";
import { initShortcuts } from "./shortcuts.ts";
import { initMobile } from "./mobile.ts";
import { registerDefaultShortcuts } from "./shortcutActions.ts";
import { ShortcutHelp } from "./components/Keybinds.tsx";
import { AskHost, ContextMenuHost, MediaViewerHost, initTooltips } from "./components/overlay.tsx";
import { ModalHost } from "./features/modals.tsx";
import { WhatsNewHost } from "./features/WhatsNew.tsx";
import { QrApprove, useStreamerMode } from "./features/AccountExtras.tsx";
import { initLive } from "./features/live.tsx";
import { initI18n } from "./features/i18n.tsx";
import { initNotifications } from "./notify.ts";
import { initDesktop } from "./desktop.ts";
import { initWebUpdates } from "./webUpdate.ts";
import { WebUpdateBar } from "./components/WebUpdateBar.tsx";
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
  useStreamerMode();
  useEffect(() => { initI18n(); }, []);
  const ready = useStore((s) => s.conn === "ready");
  useEffect(() => { if (ready) initLive(); }, [ready]);
  const route = useRoute();
  const conn = useStore((s) => s.conn);
  const limits = useStore((s) => s.limits);
  const [switcher, setSwitcher] = useState(false);
  const [help, setHelp] = useState(false);
  const [studio, setStudio] = useState<null | { section?: any; target?: any }>(null);
  useEffect(() => {
    const open = (e: Event) => setStudio((e as CustomEvent).detail ?? {});
    window.addEventListener("send:studio", open);
    return () => window.removeEventListener("send:studio", open);
  }, []);
  useEffect(() => { (window as any).__sendLimits = limits; }, [limits]);
  useEffect(() => {
    // Ctrl/⌘+K and Ctrl/⌘+/ come from the shortcut registry (configurable in Settings → Keybinds).
    const qs = () => { if (conn === "ready") setSwitcher((v) => !v); }, help = () => { if (conn === "ready") setHelp((v) => !v); };
    window.addEventListener("send:quickswitcher", qs); window.addEventListener("send:shortcut-help", help);
    return () => { window.removeEventListener("send:quickswitcher", qs); window.removeEventListener("send:shortcut-help", help); };
  }, [conn]);
  useEffect(() => {
    const publicRoute = ["login", "register", "forgot", "reset", "verify", "invite", "fx"].includes(route.name);
    if (conn === "signed_out" && !publicRoute) navigate(`/login${route.name === "channels" || route.name === "qr" ? `?next=${encodeURIComponent(location.pathname)}` : ""}`, true);
    if ((conn === "ready" || conn === "connecting") && (route.name === "login" || route.name === "register" || route.name === "home")) navigate("/channels/@me", true);
  }, [conn, route.name]);

  let page;
  if (route.name === "fx") page = <Suspense fallback={null}><FxLab /></Suspense>;
  else if (route.name === "invite") page = <InvitePage />;
  else if (route.name === "verify") page = <Verify />;
  else if (route.name === "reset") page = <Reset />;
  else if (route.name === "forgot") page = <Forgot />;
  else if (conn === "booting") page = <Splash />;
  else if (conn === "signed_out") page = route.name === "register" ? <Register /> : <Login />;
  else if (conn === "connecting") page = <Splash />;
  else if (route.name === "qr") page = <main className="auth"><section className="auth-card"><QrApprove id={route.params.id!} /><button className="link" onClick={() => navigate("/channels/@me")}>Back to SEND</button></section></main>;
  else page = <Shell />;
  if (route.name === "fx") return page;
  return <><DesktopTitlebar /><WebUpdateBar /><DesktopPrompt />{previewMode && <div className="preview-banner" role="status"><span><strong>Local preview</strong> · Sample data · Messages stay on this device</span>{location.hostname !== "appassets.androidplatform.net" && <button onClick={() => { sessionStorage.removeItem("send.preview"); location.href = "/?live=1"; }}>Exit</button>}</div>}{page}{switcher && <QuickSwitcher onClose={() => setSwitcher(false)} />}{help && conn === "ready" && <ShortcutHelp onClose={() => setHelp(false)} />}{studio && conn === "ready" && <Studio initial={studio.section} initialTarget={studio.target} onClose={() => setStudio(null)} />}<MediaViewerHost /><ContextMenuHost /><AskHost /><ModalHost />{conn === "ready" && route.name !== "qr" && <WhatsNewHost />}<Toasts /><InAppNotices /><RecoveryBanner /></>;
}

initTooltips();
initMobile();
initShortcuts();
registerDefaultShortcuts();
initNotifications();
// Remember who invited this visitor until they sign up.
try { const r = new URLSearchParams(location.search).get("ref"); if (r && /^[\w.]{2,40}$/.test(r)) localStorage.setItem("send.ref", r); } catch { /* storage blocked */ }
import("./features/Sponsor.tsx").then((m) => m.initSponsorReturn());
initCallSounds();
initSoundboard();
initDesktop();
initWebUpdates();
boot();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
