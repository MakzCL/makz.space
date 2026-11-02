import { Bell, Camera, Check, Mic, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { enablePush, isIos, isStandalone, pushEnabled, pushSupported } from "../lib/comms";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import { Btn, Sheet } from "./ui";

const KEY = "skf-perms-v1";
type S = "ok" | "no" | "todo";

async function mediaState(name: "camera" | "microphone"): Promise<S> {
  try {
    const r = await navigator.permissions.query({ name: name as PermissionName });
    return r.state === "granted" ? "ok" : r.state === "denied" ? "no" : "todo";
  } catch { return "todo"; }
}

/** First run on a device: one tap to allow notifications, camera and microphone. */
export function PermissionsPrompt() {
  const { backend, me, ready } = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<{ push: S; cam: S; mic: S }>({ push: "todo", cam: "todo", mic: "todo" });

  const check = async () => {
    const push: S = (await pushEnabled().catch(() => false)) ? "ok" : pushSupported() && Notification.permission === "denied" ? "no" : "todo";
    const next = { push, cam: await mediaState("camera"), mic: await mediaState("microphone") };
    setSt(next);
    return next;
  };

  useEffect(() => {
    if (!ready) return;
    let done = false;
    try { done = localStorage.getItem(KEY) === "done"; } catch { /* ignore */ }
    check().then((s) => { if (!done && (s.push !== "ok" || s.cam !== "ok" || s.mic !== "ok")) setTimeout(() => setOpen(true), 1200); });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { try { localStorage.setItem(KEY, "done"); } catch { /* ignore */ } setOpen(false); };
  const allow = async () => {
    setBusy(true);
    // Camera + microphone first (one browser prompt), then notifications.
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach((tr) => tr.stop()); }
    catch { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((tr) => tr.stop()); } catch { /* refused */ } }
    if (pushSupported()) { try { await enablePush(backend, me.id); } catch { /* refused or iOS not installed */ } }
    const s = await check();
    setBusy(false);
    if (s.push === "ok" && s.mic === "ok") close();
  };

  const iosInstall = isIos() && !isStandalone();
  return (
    <Sheet open={open} onClose={close} title={t("Set up this device")}>
      <div className="stack">
        <p className="muted">{t("Allow these once so you get jobs, messages and calls straight away.")}</p>
        <Row ic={<Bell size={20} />} s={st.push} title={t("Notifications")} sub={iosInstall ? t("On iPhone: add the app to your Home Screen first (Share → Add to Home Screen)") : t("Jobs given to you, messages, calls, meetings")} />
        <Row ic={<Mic size={20} />} s={st.mic} title={t("Microphone")} sub={t("Voice and video calls")} />
        <Row ic={<Camera size={20} />} s={st.cam} title={t("Camera")} sub={t("Video calls and photos in chat")} />
        {(st.push === "no" || st.mic === "no" || st.cam === "no") && <p className="hint">{t("Something is blocked: open your browser's site settings for this app and set it to Allow.")}</p>}
        <Btn tone="primary" wide busy={busy} onClick={allow}>{t("Allow")}</Btn>
        <Btn tone="ghost" wide onClick={close}>{t("Not now")}</Btn>
      </div>
    </Sheet>
  );
}

function Row({ ic, s, title, sub }: { ic: ReactNode; s: S; title: string; sub: string }) {
  return (
    <div className={`perm-row ${s}`}>
      <span className="perm-ic">{ic}</span>
      <span className="grow"><b>{title}</b><small>{sub}</small></span>
      <span className="perm-st">{s === "ok" ? <Check size={18} /> : s === "no" ? <X size={18} /> : null}</span>
    </div>
  );
}
