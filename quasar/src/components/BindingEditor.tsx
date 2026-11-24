import { useStore } from "../app/store";
import type { Binding } from "../lib/types";

const TYPES: [Binding["type"], string][] = [
  ["default", "Default"],
  ["disabled", "Disabled"],
  ["key", "Keyboard key"],
  ["mouse", "Mouse button"],
  ["macro", "Macro"],
  ["dpi-up", "DPI up"],
  ["dpi-down", "DPI down"],
  ["dpi-cycle", "DPI cycle"],
  ["dpi-clutch", "DPI clutch (hold)"],
  ["profile-next", "Next profile"],
  ["media", "Media"],
  ["text", "Type text"],
  ["launch", "Launch program"],
  ["overdrive", "Overdrive (hold for 2nd layer)"],
];

export function describe(b: Binding | undefined, macros: { id: string; name: string }[]): string {
  if (!b || b.type === "default") return "Default";
  switch (b.type) {
    case "key": return [...b.modifiers, b.key].join(" + ");
    case "mouse": return `${b.button} click`;
    case "macro": return `Macro · ${macros.find((m) => m.id === b.id)?.name ?? "?"}`;
    case "dpi-clutch": return `Clutch ${b.dpi} DPI`;
    case "media": return b.action.replace("-", " ");
    case "text": return `“${b.text}”`;
    case "launch": return b.path.split(/[\\/]/).pop() || "Launch";
    default: return TYPES.find(([t]) => t === b.type)?.[1] ?? b.type;
  }
}

function blank(type: Binding["type"], macros: { id: string }[]): Binding {
  switch (type) {
    case "key": return { type, key: "F13", modifiers: [] };
    case "mouse": return { type, button: "Middle" };
    case "macro": return { type, id: macros[0]?.id ?? "" };
    case "dpi-clutch": return { type, dpi: 400 };
    case "media": return { type, action: "play-pause" };
    case "text": return { type, text: "" };
    case "launch": return { type, path: "" };
    default: return { type } as Binding;
  }
}

export function BindingEditor({ target, value, onChange }: { target: string; value: Binding | undefined; onChange: (b: Binding) => void }) {
  const { snap } = useStore();
  const b = value ?? { type: "default" };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div>
        <div className="eyebrow">Binding for</div>
        <div style={{ font: "600 20px var(--display)" }}>{target}</div>
      </div>
      <div className="field">
        <label>Action</label>
        <select className="select" value={b.type} onChange={(e) => onChange(blank(e.target.value as Binding["type"], snap.macros))}>
          {TYPES.map(([t, l]) => (
            <option key={t} value={t}>{l}</option>
          ))}
        </select>
      </div>
      {b.type === "key" && (
        <>
          <div className="field">
            <label>Key — click and press it</label>
            <input
              className="input"
              value={b.key}
              readOnly
              onKeyDown={(e) => {
                e.preventDefault();
                const names: Record<string, string> = { " ": "Space", Escape: "Esc", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Control: "Ctrl", Meta: "Win" };
                const k = names[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
                if (["Ctrl", "Shift", "Alt", "Win"].includes(k)) return;
                const mods = [e.ctrlKey && "Ctrl", e.shiftKey && "Shift", e.altKey && "Alt", e.metaKey && "Win"].filter(Boolean) as string[];
                onChange({ type: "key", key: k, modifiers: mods });
              }}
            />
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {["Ctrl", "Shift", "Alt", "Win"].map((m) => (
              <button key={m} className={`btn sm${b.modifiers.includes(m) ? " primary" : ""}`} onClick={() => onChange({ ...b, modifiers: b.modifiers.includes(m) ? b.modifiers.filter((x) => x !== m) : [...b.modifiers, m] })}>
                {m}
              </button>
            ))}
          </div>
        </>
      )}
      {b.type === "mouse" && (
        <select className="select" value={b.button} onChange={(e) => onChange({ ...b, button: e.target.value })}>
          {["Left", "Right", "Middle", "Back", "Forward"].map((x) => <option key={x}>{x}</option>)}
        </select>
      )}
      {b.type === "macro" && (
        <select className="select" value={b.id} onChange={(e) => onChange({ ...b, id: e.target.value })}>
          {snap.macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      )}
      {b.type === "dpi-clutch" && (
        <div className="field">
          <label>DPI while held</label>
          <input className="input mono" type="number" min={100} step={50} value={b.dpi} onChange={(e) => onChange({ ...b, dpi: +e.target.value })} />
        </div>
      )}
      {b.type === "media" && (
        <select className="select" value={b.action} onChange={(e) => onChange({ ...b, action: e.target.value })}>
          {[["play-pause", "Play / pause"], ["next", "Next track"], ["previous", "Previous track"], ["volume-up", "Volume up"], ["volume-down", "Volume down"], ["mute", "Mute"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      {b.type === "text" && <textarea className="input" rows={3} value={b.text} placeholder="Text to type" onChange={(e) => onChange({ ...b, text: e.target.value })} />}
      {b.type === "launch" && <input className="input" value={b.path} placeholder="C:\\Program Files\\App\\app.exe" onChange={(e) => onChange({ ...b, path: e.target.value })} />}
      <p className="dim" style={{ fontSize: 12, margin: 0 }}>
        Bindings work system-wide through QUASAR's input hook on Windows and macOS. Hardware-stored bindings are not written to the device yet.
      </p>
    </div>
  );
}
