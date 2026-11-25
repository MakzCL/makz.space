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
  service: ["Windows service", "live"],
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
/** Install or remove the QuasarOpenRGB Windows service. */
export function OpenRgbService({ st }: { st: OpenRgbStatus | null }) {
  const { api, toast, snap } = useStore();
  const [busy, setBusy] = useState(false);
  if (!st || snap.platform !== "windows") return null;
  const run = async (f: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await f();
      toast(ok);
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
    }
  };
  return st.service ? (
    <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: 12.5 }}>
        Running as the Windows service <b className="mono">QuasarOpenRGB</b> ({st.service}): it starts with Windows, before you log in, and can reach RAM lighting.
      </span>
      <button className="btn sm" disabled={busy} onClick={() => run(api.openrgbServiceRemove, "Service removed")}>
        {busy ? "Waiting for Windows…" : "Remove service"}
      </button>
    </div>
  ) : (
    <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <span className="muted" style={{ fontSize: 12.5, flex: 1, minWidth: 240 }}>
        <b>Run OpenRGB as a Windows service.</b> It starts automatically with Windows and has the access RAM and some motherboard lighting need, with no administrator prompt each time. Windows asks to confirm once; QUASAR downloads the official OpenRGB {st.version} and checks it before installing.
      </span>
      <button className="btn sm primary" disabled={busy} onClick={() => run(api.openrgbServiceInstall, "OpenRGB service installed")}>
        {busy ? "Waiting for Windows…" : "Install service"}
      </button>
    </div>
  );
}

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
        {(st.phase === "running" || st.phase === "external" || st.phase === "service") && (
          <button className="btn sm" title="OpenRGB's own window, attached to the same server, to check a device directly" onClick={() => api.openrgbOpenGui().catch((e) => toast(String(e)))}>
            Open OpenRGB window
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
