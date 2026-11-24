import { Minus, Square, X, Download } from "lucide-react";
import { useStore, useFrame } from "../app/store";
import { useRef } from "react";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function TitleBar() {
  const { api, profile } = useStore();
  const fps = useRef<HTMLElement>(null);
  const ms = useRef<HTMLElement>(null);
  useFrame((f) => {
    if (fps.current) fps.current.textContent = f.stats.fps.toFixed(0);
    if (ms.current) ms.current.textContent = f.stats.frame_ms.toFixed(2);
  });
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <img className="m" src="./mark.svg" alt="" />
        <img className="w" src="./wordmark.svg" alt="QUASAR" />
      </div>
      <div className="drag" data-tauri-drag-region />
      <span className="chip">
        <b style={{ color: profile.accent }}>●</b> {profile.name}
      </span>
      <span className="chip">
        <b ref={fps}>60</b> fps · <b ref={ms}>0.00</b> ms
      </span>
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
        <div className="row" style={{ paddingRight: 10, gap: 8 }}>
          <span className="badge demo">Live demo</span>
          <a className="btn sm primary" href="../#download" target="_top">
            <Download size={14} /> Get the app
          </a>
        </div>
      )}
    </header>
  );
}
