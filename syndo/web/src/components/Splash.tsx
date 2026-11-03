import { useEffect, useState } from "react";
import { BRAND } from "@syndo/shared";
import { Mark, Wordmark } from "./ui.tsx";

/** Loading screen: the three voices gather into one conversation. Static under reduced motion. */
export function Splash({ label }: { label?: string }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * BRAND.loadingLines.length));
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % BRAND.loadingLines.length), 2600); return () => clearInterval(t); }, []);
  return (
    <div className="splash" role="status" aria-live="polite" aria-busy="true">
      <Mark size={96} animate />
      <Wordmark className="splash-wordmark" />
      <div className="splash-line">{label ?? BRAND.loadingLines[i]}</div>
    </div>
  );
}
