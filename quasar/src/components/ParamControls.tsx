import type { ParamSpec, ParamValue } from "../lib/types";
import { Seg, Slider, Swatch, Toggle } from "./controls";

export function ParamControls({ specs, values, onChange }: { specs: ParamSpec[]; values: Record<string, ParamValue>; onChange: (k: string, v: ParamValue) => void }) {
  return (
    <div className="col" style={{ gap: 18 }}>
      {specs.map((s) => {
        const v = values[s.key] ?? s.default;
        switch (s.kind) {
          case "number":
            return (
              <div className="field" key={s.key}>
                <div className="label">
                  {s.label}
                  <b>{s.max - s.min >= 20 ? Math.round(v as number) : (v as number).toFixed(2)}</b>
                </div>
                <Slider value={v as number} min={s.min} max={s.max} step={s.step} onChange={(x) => onChange(s.key, x)} />
              </div>
            );
          case "color":
            return (
              <div className="row" key={s.key} style={{ justifyContent: "space-between" }}>
                <span className="label">{s.label}</span>
                <div className="row" style={{ gap: 8 }}>
                  <span className="mono dim" style={{ fontSize: 11 }}>{String(v).toUpperCase()}</span>
                  <Swatch value={v as string} onChange={(x) => onChange(s.key, x)} />
                </div>
              </div>
            );
          case "bool":
            return (
              <div className="row" key={s.key} style={{ justifyContent: "space-between" }}>
                <span className="label">{s.label}</span>
                <Toggle on={v as boolean} onChange={(x) => onChange(s.key, x)} />
              </div>
            );
          case "choice":
            return s.options.length <= 3 ? (
              <div className="field" key={s.key}>
                <span className="label">{s.label}</span>
                <Seg value={v as string} options={s.options.map(([k, l]) => [k, l])} onChange={(x) => onChange(s.key, x)} />
              </div>
            ) : (
              <div className="field" key={s.key}>
                <span className="label">{s.label}</span>
                <select className="select" value={v as string} onChange={(e) => onChange(s.key, e.target.value)}>
                  {s.options.map(([k, l]) => (
                    <option key={k} value={k}>{l}</option>
                  ))}
                </select>
              </div>
            );
        }
      })}
    </div>
  );
}
