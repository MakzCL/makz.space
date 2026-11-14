import { useEffect, useState } from "react";
import { BRAND } from "@send/shared";
import { BRAND_ART } from "../brand-art.ts";
import { Backdrop } from "../appearance/Backdrop.tsx";
import { activeBackground, snapshot } from "../appearance/engine.ts";
import { useAppearance } from "../appearance/store.ts";

/**
 * Start-up screen. It wears the look from the last session (colours, glass and wallpaper are restored before
 * preferences load) or the default theme on a first visit. The mark pops in on a glass tile, its outline draws,
 * it fills, then it idles with a soft bounce and a light running round the outline while the app connects.
 */
export function Splash({ label }: { label?: string }) {
  const [i, setI] = useState(() => Math.floor(Math.random() * BRAND.loadingLines.length));
  useEffect(() => { const t = setInterval(() => setI(x => (x + 1) % BRAND.loadingLines.length), 4000); return () => clearInterval(t); }, []);
  const loaded = useAppearance((s) => s.loaded), safe = useAppearance((s) => s.safeMode);
  const themeBg = useAppearance((s) => activeBackground(s.resolved.theme));
  const bg = safe ? null : !loaded && snapshot.restored && snapshot.bg !== undefined ? snapshot.bg : themeBg;
  const art = BRAND_ART.mark;
  return <div className="splash send-startup" role="status" aria-live="polite" aria-busy="true">
    {bg && <Backdrop bg={bg} />}
    <div className="startup-tile" aria-hidden="true">
      <svg className="startup-mark" viewBox={`0 0 ${art.width} ${art.height}`}>
        <g transform={art.transform}>
          <path className="s-fill" d={art.path} />
          <path className="s-line" pathLength={1} d={art.path} />
          <path className="s-run" pathLength={1} d={art.path} />
        </g>
      </svg>
    </div>
    <div className="splash-line">{label ?? BRAND.loadingLines[i]}</div>
  </div>;
}
