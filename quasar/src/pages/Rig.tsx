import { motion } from "motion/react";
import { BatteryMedium, RefreshCw, Sun, AlertTriangle } from "lucide-react";
import { useRef, useState } from "react";
import { useFrame, useStore } from "../app/store";
import { Preview } from "../components/Preview";
import { DeviceArt } from "../components/DeviceArt";
import { Slider } from "../components/controls";
import { kindName } from "../components/icons";

export function Rig() {
  const { snap, setSnap, api, profile, go, updateProfile, toast, library } = useStore();
  const [bright, setBright] = useState(profile.brightness);
  const [scanning, setScanning] = useState(false);
  const leds = useRef<HTMLElement>(null);
  const fps = useRef<HTMLElement>(null);
  const ms = useRef<HTMLElement>(null);
  const wps = useRef<HTMLElement>(null);
  useFrame((f) => {
    if (leds.current) leds.current.textContent = String(f.stats.leds);
    if (fps.current) fps.current.textContent = f.stats.fps.toFixed(0);
    if (ms.current) ms.current.textContent = f.stats.frame_ms.toFixed(2);
    if (wps.current) wps.current.textContent = f.stats.writes_per_sec.toFixed(0);
  });
  const layer = profile.scene.layers.find((l) => l.enabled);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Your setup</div>
          <h1>Rig</h1>
        </div>
        <div className="spacer" />
        <button
          className="btn"
          onClick={async () => {
            setScanning(true);
            setSnap(await api.rescan());
            setScanning(false);
            toast("Devices rescanned");
          }}
        >
          <motion.span animate={{ rotate: scanning ? 360 : 0 }} transition={{ repeat: scanning ? Infinity : 0, duration: 0.8, ease: "linear" }} style={{ display: "inline-flex" }}>
            <RefreshCw size={15} />
          </motion.span>
          Rescan
        </button>
      </div>

      <div className="hero">
        <div className="card stage" onClick={() => go({ page: "studio" })} style={{ cursor: "pointer" }}>
          <Preview />
          <div className="glass" />
          <div className="hud">
            <div style={{ flex: 1 }}>
              <div className="eyebrow" style={{ color: "rgba(255,255,255,.6)" }}>Now playing</div>
              <h2>{layer ? profile.scene.layers.filter((l) => l.enabled).map((l) => library.find((e) => e.id === l.effect)?.name ?? l.effect).join(" + ") : "Lights off"}</h2>
            </div>
            <div className="kv">LEDs<b ref={leds}>0</b></div>
            <div className="kv">Devices<b>{snap.devices.length}</b></div>
          </div>
        </div>

        <div className="col">
          <div className="card pad">
            <div className="eyebrow">Profile</div>
            <div className="profile-strip">
              {snap.profiles.map((p) => (
                <button
                  key={p.id}
                  className={`pchip${p.id === snap.active_profile ? " on" : ""}`}
                  style={{ ["--pc" as string]: p.accent }}
                  onClick={async () => {
                    setSnap(await api.activateProfile(p.id));
                    setBright(p.brightness);
                  }}
                >
                  <i /> {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="card pad">
            <div className="label" style={{ marginBottom: 10 }}>
              <span className="row" style={{ gap: 6 }}><Sun size={14} /> Brightness</span>
              <b>{Math.round(bright * 100)}%</b>
            </div>
            <Slider
              value={bright}
              onChange={(v) => {
                setBright(v);
                api.setBrightness(v);
              }}
              onCommit={(v) => updateProfile((p) => ({ ...p, brightness: v }))}
            />
          </div>
          <div className="card" style={{ padding: 4 }}>
            <div className="stat-row">
              <div><b ref={fps}>0</b><span>fps</span></div>
              <div><b ref={ms}>0</b><span>ms</span></div>
              <div><b ref={wps}>0</b><span>writes / s</span></div>
              <div><b>{snap.backends.filter((b) => !b.error).length}</b><span>backends</span></div>
            </div>
          </div>
          {snap.backends.filter((b) => b.error).map((b) => (
            <div key={b.id} className="card pad row" style={{ gap: 10, padding: 14 }}>
              <AlertTriangle size={16} color="var(--amber)" />
              <div style={{ fontSize: 12.5 }}>
                <b>{b.name}</b> <span className="muted">is not reachable.</span>{" "}
                <a href="#" onClick={(e) => (e.preventDefault(), go({ page: "integrations" }))} style={{ color: "var(--cyan)" }}>Set up</a>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="page-head" style={{ marginTop: 30, marginBottom: 14 }}>
        <h1 style={{ fontSize: 17 }}>Devices</h1>
        <span className="muted" style={{ fontSize: 13 }}>{snap.devices.length} connected across {new Set(snap.devices.map((d) => d.info.vendor)).size} brands</span>
      </div>
      <div className="devgrid">
        {snap.devices.map((d, i) => (
          <motion.button
            key={d.info.id}
            className="card devcard"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * i, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={() => go({ page: "device", id: d.info.id })}
          >
            <div className="art">
              <DeviceArt device={d.info} />
            </div>
            <div>
              <div className="name">{d.info.name}</div>
              <div className="meta">
                <span>{d.info.vendor}</span>·<span>{kindName[d.info.kind]}</span>
                <span style={{ flex: 1 }} />
                {d.status.battery != null && (
                  <span className="battery" style={{ color: d.status.battery < 20 ? "var(--red)" : "var(--muted)" }}>
                    <BatteryMedium size={14} /> {d.status.battery}%
                  </span>
                )}
                {d.info.virtual_device ? <span className="badge demo">Demo</span> : d.error ? <span className="badge err">Error</span> : <span className="badge live">Live</span>}
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

