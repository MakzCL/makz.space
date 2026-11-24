import { AudioLines, Crosshair, Keyboard, MonitorUp, Network, Usb, Copy, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "../app/store";
import { Toggle } from "../components/controls";
import type { Settings } from "../lib/types";

function Block({ icon, title, status, children }: { icon: ReactNode; title: string; status: ReactNode; children: ReactNode }) {
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", background: "rgba(124,92,255,.14)", color: "var(--violet)" }}>{icon}</div>
        <h3 style={{ flex: 1, margin: 0 }}>{title}</h3>
        {status}
      </div>
      {children}
    </div>
  );
}

export function Integrations() {
  const { snap, setSnap, api, toast } = useStore();
  const [cfg, setCfg] = useState("");
  const [s, setS] = useState<Settings>(snap.settings);
  useEffect(() => void api.cs2Config().then(setCfg), [api, snap.settings.gsi_port]);
  const set = async (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    setSnap(await api.setSettings(next));
  };
  const backend = (id: string) => snap.backends.find((b) => b.id === id);
  const st = (id: string, on: boolean) => {
    const b = backend(id);
    if (!on) return <span className="badge">Off</span>;
    if (!api.desktop) return <span className="badge demo">Desktop app</span>;
    if (!b) return <span className="badge">Off</span>;
    return b.error ? <span className="badge warn">Not reachable</span> : <span className="badge live">{b.devices} devices</span>;
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Bring everything in</div>
          <h1>Integrations</h1>
          <p>Device sources, and the things your lighting can react to.</p>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Block icon={<Network size={19} />} title="OpenRGB" status={st("openrgb", s.openrgb_enabled)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Hundreds of devices from most brands — motherboards, RAM, GPUs, coolers, keyboards, mice, strips. Run OpenRGB with its SDK server on, and QUASAR drives every LED it knows.
          </p>
          <div className="row">
            <input className="input mono" style={{ flex: 1 }} value={s.openrgb_host} onChange={(e) => setS({ ...s, openrgb_host: e.target.value })} onBlur={() => set({})} />
            <input className="input mono" style={{ width: 90 }} type="number" value={s.openrgb_port} onChange={(e) => setS({ ...s, openrgb_port: +e.target.value })} onBlur={() => set({})} />
            <Toggle on={s.openrgb_enabled} onChange={(v) => set({ openrgb_enabled: v })} />
          </div>
          {backend("openrgb")?.error && <p className="mono" style={{ color: "var(--amber)", fontSize: 11.5, marginBottom: 0 }}>{backend("openrgb")!.error}</p>}
        </Block>

        <Block icon={<Usb size={19} />} title="Native drivers" status={st("hid", s.hid_enabled)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Direct USB control for what lighting tools can't do: DPI, polling rate and battery on supported Razer and Logitech (HID++) mice and keyboards.
          </p>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="dim" style={{ fontSize: 12 }}>Close the vendor's own app if a device does not respond.</span>
            <Toggle on={s.hid_enabled} onChange={(v) => set({ hid_enabled: v })} />
          </div>
        </Block>

        <Block icon={<Crosshair size={19} />} title="Counter-Strike 2" status={s.gsi_enabled ? <span className="badge live">Listening :{s.gsi_port}</span> : <span className="badge">Off</span>}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Health, damage flashes, flashbangs, fire and the bomb timer, through Valve's Game State Integration. Use the <b>Game Pulse</b> effect, or link <span className="mono">cs2.exe</span> to a profile.
          </p>
          <pre className="mono" style={{ fontSize: 11, background: "rgba(0,0,0,.35)", padding: 12, borderRadius: 10, maxHeight: 130, overflow: "auto", margin: "0 0 12px", userSelect: "text" }}>{cfg}</pre>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button
              className="btn sm primary"
              onClick={async () => {
                try {
                  toast(`Installed: ${await api.installCs2()}`);
                } catch (e) {
                  toast(String(e));
                }
              }}
            >
              <Zap size={13} /> Install into CS2
            </button>
            <button className="btn sm" onClick={() => navigator.clipboard.writeText(cfg).then(() => toast("Copied"))}><Copy size={13} /> Copy</button>
            {api.demoHit && <button className="btn sm" onClick={() => api.demoHit!()}>Simulate a hit</button>}
            <span style={{ flex: 1 }} />
            <Toggle on={s.gsi_enabled} onChange={(v) => set({ gsi_enabled: v })} />
          </div>
        </Block>

        <Block icon={<AudioLines size={19} />} title="Audio visualizer" status={s.audio_enabled ? <span className="badge live">On</span> : <span className="badge">Off</span>}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Listens to what your PC plays (WASAPI loopback on Windows) and splits it into 16 bands with beat detection. Only runs while an Audio Visualizer layer is on.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}><Toggle on={s.audio_enabled} onChange={(v) => set({ audio_enabled: v })} /></div>
        </Block>

        <Block icon={<MonitorUp size={19} />} title="Screen ambience" status={s.screen_enabled ? <span className="badge live">On</span> : <span className="badge">Off</span>}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Samples your primary monitor 15 times a second and spreads its colours over the desk. Only captures while a Screen Ambience layer is on; nothing leaves your PC.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}><Toggle on={s.screen_enabled} onChange={(v) => set({ screen_enabled: v })} /></div>
        </Block>

        <Block icon={<Keyboard size={19} />} title="Keystroke effects" status={s.keys_enabled ? <span className="badge live">On</span> : <span className="badge">Off</span>}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Key presses drive reactive effects like Keystroke Ripple, from the exact key you pressed. Key names are used for lighting only and are never stored.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}><Toggle on={s.keys_enabled} onChange={(v) => set({ keys_enabled: v })} /></div>
        </Block>
      </div>
    </div>
  );
}
