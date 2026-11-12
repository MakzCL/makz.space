import { useEffect, useRef, useState } from "react";
import { AppWindow, Globe, Monitor, Settings2, Video, Webcam } from "lucide-react";
import { STREAM_FPS, STREAM_HEIGHTS } from "@send/shared";
import { Modal } from "./ui.tsx";
import { startScreenShare, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { captureCapabilities, type ShareSource } from "../voice/settings.ts";
import { useStore } from "../store.ts";
import { nativeCapture, type NativeSource } from "../voice/nativeCapture.ts";

type Tab = "window" | "monitor" | "device";
const TABS: { id: Tab; label: string; icon: typeof Monitor }[] = [{ id: "window", label: "Applications", icon: AppWindow }, { id: "monitor", label: "Entire Screen", icon: Monitor }, { id: "device", label: "Devices", icon: Video }];

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
  const [more, setMore] = useState(false);
  // Desktop app: SEND's own picker — real windows and screens with live thumbnails, no system picker.
  const nat = nativeCapture();
  const [natList, setNatList] = useState<NativeSource[] | null>(null);
  const [natPick, setNatPick] = useState<string | null>(null);
  useEffect(() => {
    if (!nat) return;
    let alive = true, busy = false;
    const load = () => { if (busy) return; busy = true; nat.sources(360).then((l) => { if (alive) setNatList(l); }, () => { if (alive) setNatList((x) => x ?? []); }).finally(() => { busy = false; }); };
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const natOf = (k: "window" | "screen") => (natList ?? []).filter((x) => x.kind === k);
  const natChosen = (k: "window" | "screen") => { const l = natOf(k); return l.find((x) => x.id === natPick) ?? (k === "screen" ? l.find((x) => x.primary) : undefined) ?? l[0] ?? null; };

  const list = () => navigator.mediaDevices.enumerateDevices().then((d) => {
    const v = d.filter((x) => x.kind === "videoinput" && x.deviceId);
    setDevices(v); setDeviceId((cur) => (cur && v.some((x) => x.deviceId === cur) ? cur : v[0]?.deviceId ?? null));
  }, () => setDevices([]));
  useEffect(() => { if (tab === "device" && !devices) list(); }, [tab]);

  const maxH = limits?.max_stream_height ?? 2160, maxFps = limits?.max_stream_fps ?? 60;
  const heights = STREAM_HEIGHTS.filter((h) => h <= maxH && h >= 720);
  const set = (p: Partial<typeof st>) => updateVoiceSettings({ stream: { ...st, ...p } });
  const [surface, setSurface] = useState<"window" | "browser">("window");
  const natSel = nat && tab !== "device" ? natChosen(tab === "window" ? "window" : "screen") : null;
  const source: ShareSource | null = tab === "device" ? (deviceId ? { kind: "device", deviceId } : null)
    : nat ? (natSel ? { kind: "native", id: natSel.id } : null)
    : tab === "window" ? { kind: surface } : { kind: "monitor" };
  const go = (src = source) => { if (!src) return; onClose(); startScreenShare(src); };
  const label = (d: MediaDeviceInfo, i: number) => d.label || `Capture device ${i + 1}`;

  return (
    <Modal onClose={onClose} label="Screen share" className="share-modal">
      <div className="share-dlg">
        <div className="share-tabs" role="tablist" aria-label="What to share">
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}><t.icon size={16} aria-hidden />{t.label}</button>)}
        </div>
        <div className="share-grid" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
          {nat && tab !== "device" && natList === null && <p className="muted share-note">Looking for {tab === "window" ? "windows" : "screens"}…</p>}
          {nat && tab !== "device" && natList !== null && natOf(tab === "window" ? "window" : "screen").length === 0 && <p className="muted share-note">{tab === "window" ? "No windows to share. Open the app you want to show, then come back." : "No screens found."}</p>}
          {nat && tab !== "device" && natOf(tab === "window" ? "window" : "screen").map((x) => (
            <button key={x.id} className={`share-card ${natSel?.id === x.id ? "on" : ""}`} aria-pressed={natSel?.id === x.id} title={x.app ? `${x.name}: ${x.app}` : x.name}
              onClick={() => setNatPick(x.id)} onDoubleClick={() => go({ kind: "native", id: x.id })}>
              <span className="share-thumb native">{x.thumb ? <img src={x.thumb} alt="" draggable={false} /> : <span className="share-thumb-icon">{x.kind === "screen" ? <Monitor size={40} /> : <AppWindow size={40} />}</span>}</span>
              <span className="share-name">{x.name}</span>
            </button>
          ))}
          {!nat && tab === "window" && <>
            <button className={`share-card ${surface === "window" ? "on" : ""}`} aria-pressed={surface === "window"} onClick={() => setSurface("window")} onDoubleClick={() => go({ kind: "window" })}>
              <span className="share-thumb"><span className="share-thumb-icon"><AppWindow size={40} /></span></span>
              <span className="share-name">Choose a window</span>
            </button>
            {!caps.desktopApp && <button className={`share-card ${surface === "browser" ? "on" : ""}`} aria-pressed={surface === "browser"} onClick={() => setSurface("browser")} onDoubleClick={() => go({ kind: "browser" })}>
              <span className="share-thumb"><span className="share-thumb-icon"><Globe size={40} /></span></span>
              <span className="share-name">Browser tab</span>
            </button>}
          </>}
          {!nat && tab === "monitor" && <button className="share-card on" onClick={() => go()} aria-label="Choose a screen">
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
        {nat && tab !== "device" && natSel && <p className="muted small share-note">
          {tab === "window" ? `Only ${natSel.app || "this app"}'s sound is shared.` : "Your computer's sound is shared, without SEND's own."} SEND's own window is left out.
        </p>}
        {!nat && tab !== "device" && <p className="muted small share-note">
          {tab === "window" ? (surface === "browser" ? "Your browser's picker opens with your tabs. A tab shares its own sound only, so the call never echoes." : "Your system's picker opens with your open windows.") : "Your system's picker opens with your screens."} SEND's own window is left out.
        </p>}

        {more && <div className="share-quality">
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
          {st.audio && tab !== "device" && !nat && !caps.tabAudio && <p className="muted small">This browser can't share sound from a screen.</p>}
        </div>}

        <div className="share-bar">
          <div className="share-sum">
            <strong>{st.contentHint === "motion" ? "Gaming" : "Work & detail"}</strong>
            <span className="muted small">{st.contentHint === "motion" ? "Smoother video" : "Text readability"} · {st.height === "source" ? "Source" : `${st.height}p`} · {st.fps}fps{st.audio ? " · Sound" : ""}</span>
          </div>
          <div className="seg share-sdhd" role="radiogroup" aria-label="Quality">
            <button role="radio" aria-checked={st.height === 720} aria-selected={st.height === 720} onClick={() => set({ height: 720 })}>SD</button>
            <button role="radio" aria-checked={st.height === 1080} aria-selected={st.height === 1080} onClick={() => set({ height: 1080 })}>HD</button>
          </div>
          <button className={`icon-btn share-gear ${more ? "on" : ""}`} aria-expanded={more} aria-label="Stream settings" title="Stream settings" onClick={() => setMore(!more)}><Settings2 size={18} /></button>
          <button className="btn primary" onClick={() => go()} disabled={!source}>Go Live</button>
        </div>
      </div>
    </Modal>
  );
}
