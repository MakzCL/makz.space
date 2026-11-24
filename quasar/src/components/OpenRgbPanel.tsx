import { Download, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../app/store";
import type { OpenRgbStatus } from "../lib/types";

const LABEL: Record<OpenRgbStatus["phase"], [string, string]> = {
  unknown: ["Checking", ""],
  "not-installed": ["Not installed", "warn"],
  downloading: ["Downloading", "demo"],
  installing: ["Installing", "demo"],
  starting: ["Starting · detecting devices", "demo"],
  running: ["Running", "live"],
  external: ["Using your OpenRGB", "live"],
  stopped: ["Stopped", ""],
  error: ["Error", "err"],
  unsupported: ["Install it yourself", ""],
};

export function useOpenRgb() {
  const { api, refresh } = useStore();
  const [st, setSt] = useState<OpenRgbStatus | null>(null);
  useEffect(() => {
    api.openrgbStatus().then(setSt);
    const a = api.on<OpenRgbStatus>("openrgb", setSt);
    const b = api.on("devices-changed", () => refresh());
    return () => {
      a();
      b();
    };
  }, [api, refresh]);
  return st;
}

export function OpenRgbBadge({ st }: { st: OpenRgbStatus | null }) {
  if (!st) return null;
  const [t, cls] = LABEL[st.phase];
  return <span className={`badge ${cls}`}>{t}</span>;
}

/** Install / start / stop the bundled OpenRGB server. */
export function OpenRgbActions({ st }: { st: OpenRgbStatus | null }) {
  const { api, toast } = useStore();
  if (!st) return null;
  const busy = ["downloading", "installing", "starting"].includes(st.phase);
  return (
    <div className="col" style={{ gap: 10 }}>
      {busy && (
        <div className="progress">
          <div style={{ width: `${st.phase === "downloading" ? st.progress * 100 : 100}%` }} className={st.phase === "downloading" ? "" : "indet"} />
        </div>
      )}
      {st.message && <div className="mono" style={{ fontSize: 11.5, color: st.phase === "error" ? "var(--red)" : "var(--muted)" }}>{st.message}</div>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        {st.phase === "not-installed" && (
          <button className="btn sm primary" onClick={() => api.openrgbInstall().catch((e) => toast(String(e)))}>
            <Download size={13} /> Install OpenRGB {st.version} ({st.size_mb} MB)
          </button>
        )}
        {(st.phase === "stopped" || st.phase === "error") && st.path && (
          <button className="btn sm primary" onClick={() => api.openrgbStart().catch((e) => toast(String(e)))}>
            <Play size={13} /> Start
          </button>
        )}
        {st.phase === "error" && !st.path && (
          <button className="btn sm" onClick={() => api.openrgbInstall()}>
            <Download size={13} /> Try again
          </button>
        )}
        {st.phase === "running" && (
          <button className="btn sm" onClick={() => api.openrgbStop()}>
            <Square size={12} /> Stop
          </button>
        )}
        {st.phase === "unsupported" && (
          <a className="btn sm" href="https://openrgb.org/releases.html" target="_blank" rel="noreferrer">openrgb.org</a>
        )}
      </div>
    </div>
  );
}
