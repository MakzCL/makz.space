import { useState } from "react";
import { ArrowLeft, ArrowRight, Minus, Square, Copy, X } from "lucide-react";
import { desktop } from "../desktop.ts";
import { Wordmark } from "./ui.tsx";
export function DesktopTitlebar() {
  const [maximized, setMaximized] = useState(false);
  if (!desktop?.capabilities.customTitlebar || !desktop.windowControl) return null;
  const d = desktop;
  const control = async (action: "minimize" | "maximize" | "close") => { const result = await d.windowControl!(action); if (result) setMaximized(result.maximized); };
  return <header className="desktop-titlebar" onDoubleClick={e => { if (!(e.target as HTMLElement).closest("button")) control("maximize"); }}>
    <nav aria-label="Navigation history"><button aria-label="Go back" onClick={() => history.back()}><ArrowLeft size={14}/></button><button aria-label="Go forward" onClick={() => history.forward()}><ArrowRight size={14}/></button></nav>
    <span className="desktop-title"><Wordmark/></span>
    <div className="desktop-window-controls"><button aria-label="Minimise SEND" onClick={() => control("minimize")}><Minus size={13}/></button><button aria-label={maximized ? "Restore SEND" : "Maximise SEND"} onClick={() => control("maximize")}>{maximized ? <Copy size={11}/> : <Square size={11}/>}</button><button className="window-close" aria-label="Close SEND" onClick={() => control("close")}><X size={15}/></button></div>
  </header>;
}
