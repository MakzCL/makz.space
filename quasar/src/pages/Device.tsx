import { motion } from "motion/react";
import { BatteryMedium, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../app/store";
import { DeviceArt } from "../components/DeviceArt";
import { Row, Seg, Slider, Swatch, Tabs } from "../components/controls";
import { BindingEditor, describe } from "../components/BindingEditor";
import { kindName } from "../components/icons";
import type { Binding, DeviceSettings, DeviceView } from "../lib/types";

type Tab = "performance" | "buttons" | "lighting" | "info";

export function DevicePage({ device }: { device: DeviceView }) {
  const { api, setSnap, snap } = useStore();
  const caps = device.info.caps;
  const tabs = useMemo(() => {
    const t: [Tab, string][] = [];
    if (caps.dpi || caps.polling_rates.length) t.push(["performance", "Performance"]);
    if (caps.remappable.length) t.push(["buttons", device.info.kind === "keyboard" ? "Keys" : "Buttons"]);
    t.push(["lighting", "Lighting"], ["info", "Info"]);
    return t;
  }, [caps, device.info.kind]);
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  const [s, setS] = useState<DeviceSettings>(device.settings);
  useEffect(() => setS(device.settings), [device.settings]);

  const commit = (next: DeviceSettings) => {
    setS(next);
    api.setDeviceSettings(device.info.id, next);
    setSnap({
      ...snap,
      devices: snap.devices.map((d) => (d.info.id === device.info.id ? { ...d, settings: next } : d)),
      profiles: snap.profiles.map((p) => (p.id === snap.active_profile ? { ...p, devices: { ...p.devices, [device.info.id]: next } } : p)),
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{device.info.vendor} · {kindName[device.info.kind]}</div>
          <h1>{device.info.name}</h1>
        </div>
        <div className="spacer" />
        {device.status.battery != null && (
          <span className="badge" style={{ height: 28, fontSize: 12 }}>
            <BatteryMedium size={14} /> {device.status.battery}%{device.status.charging ? " · charging" : ""}
          </span>
        )}
        {device.info.virtual_device ? <span className="badge demo">Demo device</span> : <span className="badge live">Connected via {device.info.backend}</span>}
      </div>

      <div className="card devhero" style={{ display: "block", marginBottom: 20 }}>
        <div className="art">
          <DeviceArt device={device.info} padding={36} />
        </div>
      </div>

      <Tabs value={tab} tabs={tabs} onChange={setTab} />

      {tab === "performance" && <Performance device={device} s={s} commit={commit} setS={setS} />}
      {tab === "buttons" && <Buttons device={device} s={s} commit={commit} />}
      {tab === "lighting" && <Lighting device={device} s={s} commit={commit} setS={setS} />}
      {tab === "info" && (
        <div className="card pad" style={{ maxWidth: 720 }}>
          <Row label="Vendor"><span className="mono">{device.info.vendor}</span></Row>
          <Row label="Backend" hint="Which driver talks to this device"><span className="mono">{device.info.backend}</span></Row>
          <Row label="Firmware"><span className="mono">{device.info.firmware ?? "—"}</span></Row>
          <Row label="Serial"><span className="mono">{device.info.serial ?? "—"}</span></Row>
          <Row label="LEDs"><span className="mono">{device.info.layout.leds.length}</span></Row>
          <Row label="Onboard profiles"><span className="mono">{caps.onboard_profiles || "—"}</span></Row>
          <Row label="Device id"><span className="mono dim" style={{ fontSize: 11 }}>{device.info.id}</span></Row>
          {device.error && <Row label="Last error"><span className="mono" style={{ color: "var(--red)", fontSize: 12 }}>{device.error}</span></Row>}
        </div>
      )}
    </div>
  );
}

type P = { device: DeviceView; s: DeviceSettings; commit: (s: DeviceSettings) => void; setS?: (s: DeviceSettings) => void };

function Performance({ device, s, commit, setS }: P) {
  const dpi = device.info.caps.dpi;
  const stage = s.dpi_stages[s.active_stage];
  return (
    <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
      {dpi && stage && (
        <div className="card pad">
          <div className="row" style={{ alignItems: "flex-end", marginBottom: 18 }}>
            <div style={{ flex: 1 }}>
              <div className="eyebrow">Sensitivity · stage {s.active_stage + 1}</div>
              <motion.div key={stage.dpi} className="dpi-big" initial={{ opacity: 0.5, y: 4 }} animate={{ opacity: 1, y: 0 }} style={{ color: stage.color, textShadow: `0 0 40px ${stage.color}66` }}>
                {stage.dpi.toLocaleString()}
                <span style={{ fontSize: 16, color: "var(--muted)", marginLeft: 8 }}>DPI</span>
              </motion.div>
            </div>
            <Swatch value={stage.color} onChange={(c) => commit({ ...s, dpi_stages: s.dpi_stages.map((x, i) => (i === s.active_stage ? { ...x, color: c } : x)) })} />
          </div>
          <Slider
            value={stage.dpi}
            min={dpi.min}
            max={dpi.max}
            step={dpi.step}
            onChange={(v) => setS!({ ...s, dpi_stages: s.dpi_stages.map((x, i) => (i === s.active_stage ? { ...x, dpi: v } : x)) })}
            onCommit={(v) => commit({ ...s, dpi_stages: s.dpi_stages.map((x, i) => (i === s.active_stage ? { ...x, dpi: v } : x)) })}
          />
          <div className="row mono dim" style={{ justifyContent: "space-between", fontSize: 11, marginTop: 6 }}>
            <span>{dpi.min}</span>
            <span>{dpi.max.toLocaleString()}</span>
          </div>
          <div className="sep" />
          <div className="label" style={{ marginBottom: 10 }}>DPI stages <span className="dim">click to activate</span></div>
          <div className="stages">
            {s.dpi_stages.map((st, i) => (
              <button key={i} className={`stage-tile${i === s.active_stage ? " on" : ""}`} style={{ ["--sc" as string]: st.color }} onClick={() => commit({ ...s, active_stage: i })}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="n">0{i + 1}</span>
                  {s.dpi_stages.length > 1 && (
                    <Trash2
                      size={12}
                      className="dim"
                      onClick={(e) => {
                        e.stopPropagation();
                        const stages = s.dpi_stages.filter((_, j) => j !== i);
                        commit({ ...s, dpi_stages: stages, active_stage: Math.min(s.active_stage, stages.length - 1) });
                      }}
                    />
                  )}
                </div>
                <b>{st.dpi}</b>
                <div className="bar" />
              </button>
            ))}
            {s.dpi_stages.length < dpi.max_stages && (
              <button className="stage-tile stage-add" onClick={() => commit({ ...s, dpi_stages: [...s.dpi_stages, { dpi: Math.min(dpi.max, (s.dpi_stages.at(-1)?.dpi ?? 800) * 2), dpi_y: null, color: "#ffffff" }] })}>
                <Plus size={18} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="card pad">
        {device.info.caps.polling_rates.length > 0 && (
          <div className="field" style={{ marginBottom: 22 }}>
            <label>Polling rate</label>
            <Seg value={s.polling_rate ?? 1000} options={device.info.caps.polling_rates.map((r) => [r, r >= 1000 ? `${r / 1000}k` : `${r}`])} onChange={(v) => commit({ ...s, polling_rate: v })} />
            <span className="dim" style={{ fontSize: 12 }}>Reports per second. {(s.polling_rate ?? 1000) >= 4000 ? "High rates cost CPU; use them for competitive play." : "1000 Hz is right for most people."}</span>
          </div>
        )}
        {device.info.caps.lift_off && (
          <div className="field">
            <label>Lift-off distance <b className="mono">{(s.lift_off_mm ?? 1).toFixed(1)} mm</b></label>
            <Seg value={s.lift_off_mm ?? 1} options={[[1, "1 mm"], [2, "2 mm"], [3, "3 mm"]]} onChange={(v) => commit({ ...s, lift_off_mm: v })} />
          </div>
        )}
      </div>
    </div>
  );
}

function Buttons({ device, s, commit }: P) {
  const { snap } = useStore();
  const [layer, setLayer] = useState<"bindings" | "overdrive">("bindings");
  const [sel, setSel] = useState<string | null>(null);
  const L = device.info.layout;
  const isKb = device.info.kind === "keyboard";
  const map = s[layer];
  const set = (k: string, b: Binding) => {
    const next = { ...map };
    if (b.type === "default") delete next[k];
    else next[k] = b;
    commit({ ...s, [layer]: next });
  };
  const px = Math.min(3.1, 1080 / L.width);
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr 320px", alignItems: "start" }}>
      <div className="card pad">
        <div className="row" style={{ marginBottom: 14 }}>
          <Seg value={layer} options={[["bindings", "Standard"], ["overdrive", "Overdrive layer"]]} onChange={setLayer} />
          <span className="dim" style={{ fontSize: 12 }}>{layer === "overdrive" ? "Active while a key bound to Overdrive is held." : `${Object.keys(map).length} remapped`}</span>
        </div>
        {isKb ? (
          <div className="keymap">
            <div className="keys" style={{ width: L.width * px, height: L.height * px }}>
              {L.leds.filter((l) => l.label).map((l) => (
                <button
                  key={l.label}
                  className={`key${sel === l.label ? " sel" : ""}${map[l.label!] ? " bound" : ""}`}
                  style={{ left: (l.x - (l.w ?? 17) / 2) * px, top: (l.y - (l.h ?? 17) / 2) * px, width: (l.w ?? 17) * px, height: (l.h ?? 17) * px }}
                  title={map[l.label!] ? describe(map[l.label!], snap.macros) : l.label}
                  onClick={() => setSel(l.label!)}
                >
                  {l.label!.replace(/^Num(?=.)/, "")}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mbtn-list">
            {device.info.caps.remappable.map((b) => (
              <button key={b} className={`mbtn${sel === b ? " sel" : ""}`} onClick={() => setSel(b)}>
                <span style={{ fontWeight: 600 }}>{b}</span>
                <small>{map[b] ? describe(map[b], snap.macros) : <span className="dim">Default</span>}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="card pad" style={{ position: "sticky", top: 0 }}>
        {sel ? <BindingEditor target={sel} value={map[sel]} onChange={(b) => set(sel, b)} /> : <div className="empty">Pick a {isKb ? "key" : "button"} to change what it does.</div>}
      </div>
    </div>
  );
}

function Lighting({ device, s, commit, setS }: P) {
  const mode = s.lighting.mode;
  return (
    <div className="card pad" style={{ maxWidth: 760 }}>
      <div className="field" style={{ marginBottom: 18 }}>
        <label>Source</label>
        <Seg
          value={mode}
          options={[["engine", "Lighting Studio"], ["static", "Static colour"], ...(device.info.caps.hardware_modes.length ? [["hardware", "Onboard effect"] as ["hardware", string]] : []), ["off", "Off"]]}
          onChange={(m) =>
            commit({ ...s, lighting: m === "static" ? { mode: "static", color: "#7c5cff" } : m === "hardware" ? { mode: "hardware", effect: device.info.caps.hardware_modes[0] } : { mode: m } as DeviceSettings["lighting"] })
          }
        />
        <span className="dim" style={{ fontSize: 12 }}>
          {mode === "engine" && "This device shows its part of the shared canvas, so effects flow across your whole setup."}
          {mode === "static" && "One colour, ignoring the Studio."}
          {mode === "hardware" && "The device runs its own built-in effect; QUASAR stops streaming to it."}
          {mode === "off" && "LEDs off for this device in this profile."}
        </span>
      </div>
      {s.lighting.mode === "static" && (
        <Row label="Colour">
          <span className="mono dim">{s.lighting.color.toUpperCase()}</span>
          <Swatch value={s.lighting.color} onChange={(c) => commit({ ...s, lighting: { mode: "static", color: c } })} />
        </Row>
      )}
      {s.lighting.mode === "hardware" && (
        <Row label="Effect">
          <select className="select" value={s.lighting.effect} onChange={(e) => commit({ ...s, lighting: { mode: "hardware", effect: e.target.value } })}>
            {device.info.caps.hardware_modes.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Row>
      )}
      <div className="field" style={{ marginTop: 16 }}>
        <label>Device brightness <b>{Math.round(s.brightness * 100)}%</b></label>
        <Slider value={s.brightness} onChange={(v) => setS!({ ...s, brightness: v })} onCommit={(v) => commit({ ...s, brightness: v })} />
      </div>
      {device.info.caps.fan_control && (
        <div className="field" style={{ marginTop: 22 }}>
          <label>Fan speed <b>{s.fan_duty == null ? "Auto" : `${s.fan_duty}%`}</b></label>
          <Seg value={s.fan_duty == null ? "auto" : "manual"} options={[["auto", "Automatic"], ["manual", "Fixed"]]} onChange={(m) => commit({ ...s, fan_duty: m === "auto" ? null : 50 })} />
          {s.fan_duty != null && <Slider value={s.fan_duty} min={20} max={100} step={1} onChange={(v) => setS!({ ...s, fan_duty: v })} onCommit={(v) => commit({ ...s, fan_duty: v })} />}
        </div>
      )}
    </div>
  );
}
