import { useEffect, useState } from "react";
import { BRAND } from "@syndo/shared";
import { Wordmark } from "./ui.tsx";

/** The SEND signal folds into a wordmark, then repeats while the app connects. */
export function Splash({ label }: { label?: string }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * BRAND.loadingLines.length));
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % BRAND.loadingLines.length), 4000); return () => clearInterval(t); }, []);
  return <div className="splash send-startup" role="status" aria-live="polite" aria-busy="true">
    <div className="startup-orbit" aria-hidden="true"><i/><i/><i/><span className="startup-signal"><b/><b/><b/></span></div>
    <div className="startup-logo"><Wordmark className="splash-wordmark"/><span className="startup-sheen" aria-hidden="true"/></div>
    <div className="startup-progress" aria-hidden="true"><i/></div>
    <div className="splash-line">{label ?? BRAND.loadingLines[i]}</div>
  </div>;
}
