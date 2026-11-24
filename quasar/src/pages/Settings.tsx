import { useState } from "react";
import { useStore } from "../app/store";
import { Row, Seg, Toggle } from "../components/controls";
import { Mark } from "../components/Mark";
import type { Settings } from "../lib/types";

export function SettingsPage() {
  const { snap, setSnap, api, toast } = useStore();
  const [s, setS] = useState<Settings>(snap.settings);
  const set = async (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    setSnap(await api.setSettings(next));
  };
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">QUASAR</div>
          <h1>Settings</h1>
        </div>
      </div>
      <div className="card pad" style={{ marginBottom: 16 }}>
        <h3>Performance</h3>
        <Row label="Lighting frame rate" hint="How often the canvas renders and devices update. 60 is smooth; 30 halves the CPU and USB traffic.">
          <Seg value={s.fps} options={[[30, "30"], [60, "60"], [90, "90"], [120, "120"]]} onChange={(v) => set({ fps: v })} />
        </Row>
        <Row label="Demo rig" hint="Show the simulated devices next to your real ones.">
          <Toggle on={s.demo_rig} onChange={(v) => set({ demo_rig: v })} />
        </Row>
        <Row label="Switch profiles automatically" hint="When a linked app is running.">
          <Toggle on={s.auto_switch} onChange={(v) => set({ auto_switch: v })} />
        </Row>
      </div>
      <div className="card pad" style={{ marginBottom: 16 }}>
        <h3>Startup</h3>
        <Row label="Launch at login" hint="Lights come on before you open anything.">
          <Toggle
            on={s.launch_at_login}
            onChange={async (v) => {
              try {
                await api.setAutostart(v);
                setS({ ...s, launch_at_login: v });
              } catch (e) {
                toast(String(e));
              }
            }}
          />
        </Row>
        <Row label="Start in the tray" hint="Open silently; the lighting runs without the window.">
          <Toggle on={s.start_minimized} onChange={(v) => set({ start_minimized: v })} />
        </Row>
      </div>
      <div className="card pad row" style={{ gap: 18 }}>
        <Mark size={64} />
        <div style={{ flex: 1 }}>
          <img src="./wordmark.svg" alt="QUASAR" style={{ height: 14 }} />
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            Version {snap.version} · {snap.platform} · Engine in Rust, built on Tauri. Device protocols build on the work of OpenRGB, OpenRazer, Solaar and libratbag.
          </div>
        </div>
        <a className="btn" href="https://quasar.makz.space" target="_blank" rel="noreferrer">Website</a>
      </div>
    </div>
  );
}
