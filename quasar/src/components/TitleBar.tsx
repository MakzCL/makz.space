import { motion } from "motion/react";
import { Download, Minus, Settings2, Square, X } from "lucide-react";
import { useRef } from "react";
import { useFrame, useStore, type Route } from "../app/store";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

const NAV: [Route["page"], string][] = [
  ["rig", "Rig"],
  ["studio", "Studio"],
  ["library", "Effects"],
  ["macros", "Macros"],
  ["profiles", "Profiles"],
  ["integrations", "Links"],
];

/** Top bar: brand, the six sections as numbered tabs, telemetry, window controls. */
export function TitleBar() {
  const { api, profile, route, go } = useStore();
  const fps = useRef<HTMLElement>(null);
  const ms = useRef<HTMLElement>(null);
  useFrame((f) => {
    if (fps.current) fps.current.textContent = f.stats.fps.toFixed(0);
    if (ms.current) ms.current.textContent = f.stats.frame_ms.toFixed(2);
  });
  const active = route.page === "device" ? "rig" : route.page;
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <img className="m" src="./mark.svg" alt="" />
        <img className="w" src="./wordmark.svg" alt="QUASAR" />
      </div>
      <nav className="navs">
        {NAV.map(([p, label], i) => (
          <button key={p} className={`tnav${active === p ? " on" : ""}`} onClick={() => go({ page: p } as Route)}>
            <span className="idx">0{i + 1}</span>
            <span className="lbl">{label}</span>
            {active === p && <motion.span layoutId="tnav-bar" className="bar" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          </button>
        ))}
      </nav>
      <div className="right" data-tauri-drag-region>
        <span className="chip">
          <b style={{ color: profile.accent }}>■</b> {profile.name}
        </span>
        <span className="chip">
          <b ref={fps}>60</b>fps <b ref={ms}>0.00</b>ms
        </span>
        <button className={`iconbtn${route.page === "settings" ? " on" : ""}`} aria-label="Settings" onClick={() => go({ page: "settings" })}>
          <Settings2 size={16} />
        </button>
        {api.desktop ? (
          <div className="winctl">
            <button aria-label="Minimise" onClick={async () => (await win()).minimize()}>
              <Minus size={15} />
            </button>
            <button aria-label="Maximise" onClick={async () => (await win()).toggleMaximize()}>
              <Square size={12} />
            </button>
            <button className="close" aria-label="Close to tray" onClick={async () => (await win()).close()}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="row" style={{ paddingRight: 14, gap: 8 }}>
            <span className="badge demo">Demo</span>
            <a className="btn sm primary" href="../#download" target="_top">
              <Download size={14} /> Get the app
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
