import { useEffect, useRef, useState } from "react";
import { AppWindow, Globe, Monitor, Webcam } from "lucide-react";
import { STREAM_FPS, STREAM_HEIGHTS } from "@send/shared";
import { Modal } from "./ui.tsx";
import { startScreenShare, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { captureCapabilities, type ShareSource } from "../voice/settings.ts";
import { useStore } from "../store.ts";

type Tab = "window" | "monitor" | "device";
const TABS: { id: Tab; label: string }[] = [{ id: "window", label: "Applications" }, { id: "monitor", label: "Entire Screen" }, { id: "device", label: "Devices" }];

/** Live preview of one capture device, released when the card unmounts. */
function DevicePreview({ deviceId, onReady }: { deviceId: string; onReady: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null, dead = false;
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, height: { ideal: 180 } }, audio: false })
      .then((s) => { if (dead) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; if (ref.current) ref.current.srcObject = s; onReady(); })
      .catch(() => setFailed(true));
    return () => { dead = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [deviceId]);
  return failed ? <span className="share-thumb-icon"><Webcam size={34} /></span> : <video ref={ref} autoPlay muted playsInline />;
}

/** Discord-style "Go Live" dialog: pick what to share and the stream quality, then start. */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const st = useVoice((s) => s.settings.stream);
  const limits = useStore((x) => x.limits);
  const caps = captureCapabilities();
  const [tab, setTab] = useState<Tab>("window");
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);

  const list = () => navigator.mediaDevices.enumerateDevices().then((d) => {
    const v = d.filter((x) => x.kind === "videoinput" && x.deviceId);
    setDevices(v); setDeviceId((cur) => (cur && v.some((x) => x.deviceId === cur) ? cur : v[0]?.deviceId ?? null));
  }, () => setDevices([]));
  useEffect(() => { if (tab === "device" && !devices) list(); }, [tab]);

  const maxH = limits?.max_stream_height ?? 2160, maxFps = limits?.max_stream_fps ?? 60;
  const heights = STREAM_HEIGHTS.filter((h) => h <= maxH && h >= 720);
  const set = (p: Partial<typeof st>) => updateVoiceSettings({ stream: { ...st, ...p } });
  const [surface, setSurface] = useState<"window" | "browser">("window");
  const source: ShareSource | null = tab === "device" ? (deviceId ? { kind: "device", deviceId } : null) : tab === "window" ? { kind: surface } : { kind: "monitor" };
  const go = (src = source) => { if (!src) return; onClose(); startScreenShare(src); };
  const label = (d: MediaDeviceInfo, i: number) => d.label || `Capture device ${i + 1}`;

  return (
    <Modal title="Screen Share" onClose={onClose} wide label="Screen share"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => go()} disabled={!source}>Go Live</button></>}>
      <div className="share-dlg">
        <div className="share-tabs" role="tablist" aria-label="What to share">
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}
        </div>
        <div className="share-grid" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
          {tab === "window" && <>
            <button className={`share-card ${surface === "window" ? "on" : ""}`} aria-pressed={surface === "window"} onClick={() => setSurface("window")} onDoubleClick={() => go({ kind: "window" })}>
              <span className="share-thumb"><span className="share-thumb-icon"><AppWindow size={40} /></span></span>
              <span className="share-name">Choose a window</span>
            </button>
            {!caps.desktopApp && <button className={`share-card ${surface === "browser" ? "on" : ""}`} aria-pressed={surface === "browser"} onClick={() => setSurface("browser")} onDoubleClick={() => go({ kind: "browser" })}>
              <span className="share-thumb"><span className="share-thumb-icon"><Globe size={40} /></span></span>
              <span className="share-name">Browser tab</span>
            </button>}
          </>}
          {tab === "monitor" && <button className="share-card on" onClick={() => go()} aria-label="Choose a screen">
            <span className="share-thumb"><span className="share-thumb-icon"><Monitor size={40} /></span></span>
            <span className="share-name">Choose a screen</span>
          </button>}
          {tab === "device" && devices === null && <p className="muted share-note">Looking for devices…</p>}
          {tab === "device" && devices?.length === 0 && <p className="muted share-note">No cameras or capture cards found. Plug one in, then reopen this dialog.</p>}
          {tab === "device" && devices?.map((d, i) => (
            <button key={d.deviceId} className={`share-card ${deviceId === d.deviceId ? "on" : ""}`} aria-pressed={deviceId === d.deviceId}
              onClick={() => setDeviceId(d.deviceId)} onDoubleClick={() => go()}>
              <span className="share-thumb"><DevicePreview deviceId={d.deviceId} onReady={() => { if (!d.label) list(); }} /></span>
              <span className="share-name">{label(d, i)}</span>
            </button>
          ))}
        </div>
        {tab !== "device" && <p className="muted small share-note">
          {tab === "window" ? (surface === "browser" ? "Your browser's picker opens with your tabs. A tab shares its own sound only, so the call never echoes." : "Your system's picker opens with your open windows.") : "Your system's picker opens with your screens."} SEND's own window is left out.
        </p>}

        <div className="share-quality">
          <div className="share-q-row">
            <span className="share-q-l">Resolution</span>
            <div className="seg" role="radiogroup" aria-label="Resolution">
              {heights.map((h) => <button key={h} role="radio" aria-checked={st.height === h} aria-selected={st.height === h} onClick={() => set({ height: h })}>{h}p</button>)}
              <button role="radio" aria-checked={st.height === "source"} aria-selected={st.height === "source"} onClick={() => set({ height: "source" })}>Source</button>
            </div>
          </div>
          <div className="share-q-row">
            <span className="share-q-l">Frame rate</span>
            <div className="seg" role="radiogroup" aria-label="Frame rate">
              {STREAM_FPS.filter((f) => f <= maxFps).map((f) => <button key={f} role="radio" aria-checked={st.fps === f} aria-selected={st.fps === f} onClick={() => set({ fps: f as any })}>{f} FPS</button>)}
            </div>
          </div>
          <div className="share-q-row">
            <span className="share-q-l">Optimise for</span>
            <div className="seg" role="radiogroup" aria-label="Optimise for">
              <button role="radio" aria-checked={st.contentHint === "detail"} aria-selected={st.contentHint === "detail"} onClick={() => set({ contentHint: "detail" })}>Text readability</button>
              <button role="radio" aria-checked={st.contentHint === "motion"} aria-selected={st.contentHint === "motion"} onClick={() => set({ contentHint: "motion" })}>Smoother video</button>
            </div>
          </div>
          <label className="share-q-row share-audio">
            <span className="share-q-l">Share audio</span>
            <input type="checkbox" checked={st.audio} onChange={(e) => set({ audio: e.target.checked })} />
          </label>
          {st.audio && tab !== "device" && !caps.tabAudio && <p className="muted small">This browser can't share sound from a screen.</p>}
        </div>
      </div>
    </Modal>
  );
}
