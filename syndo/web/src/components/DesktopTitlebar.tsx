import { useState } from "react";
import { ArrowLeft, ArrowRight, Download, LoaderCircle, Minus, Square, Copy, X } from "lucide-react";
import { applyDesktopUpdate, desktop, useDesktopUpdate, type DesktopUpdate } from "../desktop.ts";
import { Wordmark } from "./ui.tsx";
export function DesktopTitlebar() {
  const [maximized, setMaximized] = useState(false);
  const update = useDesktopUpdate();
  if (!desktop?.capabilities.customTitlebar || !desktop.windowControl) return null;
  const d = desktop;
  const control = async (action: "minimize" | "maximize" | "close") => { const result = await d.windowControl!(action); if (result) setMaximized(result.maximized); };
  return <header className="desktop-titlebar" onDoubleClick={e => { if (!(e.target as HTMLElement).closest("button")) control("maximize"); }}>
    <nav aria-label="Navigation history"><button aria-label="Go back" onClick={() => history.back()}><ArrowLeft size={14}/></button><button aria-label="Go forward" onClick={() => history.forward()}><ArrowRight size={14}/></button></nav>
    <span className="desktop-title"><Wordmark/></span>
    <div className="desktop-window-controls"><UpdateButton u={update} /><button aria-label="Minimise SEND" onClick={() => control("minimize")}><Minus size={13}/></button><button aria-label={maximized ? "Restore SEND" : "Maximise SEND"} onClick={() => control("maximize")}>{maximized ? <Copy size={11}/> : <Square size={11}/>}</button><button className="window-close" aria-label="Close SEND" onClick={() => control("close")}><X size={15}/></button></div>
  </header>;
}

/** Green download icon, shown only while an update is waiting. Nothing installs until it is pressed. */
function UpdateButton({ u }: { u: DesktopUpdate | null }) {
  if (!u || !desktop) return null;
  const canDownload = !!desktop.downloadUpdate;
  const show = u.state === "ready" || u.state === "downloading" || (canDownload && (u.state === "available" || (u.state === "error" && !!u.version)));
  if (!show) return null;
  const v = u.version ? ` ${u.version}` : "";
  if (u.state === "downloading") {
    const label = `Downloading update${v}… ${u.percent ?? 0}%`;
    return <button className="desktop-update busy" aria-label={label} title={label} disabled><LoaderCircle size={15} className="spin" /></button>;
  }
  const label = u.state === "ready" ? `Update${v} ready — restart to install` : u.state === "error" ? `Update${v} failed — click to try again` : `Update${v} available — click to download and install`;
  return <button className="desktop-update" aria-label={label} title={label} onClick={() => applyDesktopUpdate(u)}><Download size={15} strokeWidth={2.4} /></button>;
}
