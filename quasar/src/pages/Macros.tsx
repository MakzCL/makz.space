import { ArrowDown, ArrowUp, Clock, Copy, Play, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../app/store";
import { Seg } from "../components/controls";
import type { Macro, Step } from "../lib/types";

export function Macros() {
  const { snap, setSnap, api, toast } = useStore();
  const [sel, setSel] = useState<string | null>(snap.macros[0]?.id ?? null);
  const [rec, setRec] = useState(false);
  const m = snap.macros.find((x) => x.id === sel) ?? null;

  const save = async (next: Macro) => setSnap({ ...snap, macros: await api.saveMacro(next) });
  const create = async () => {
    const n: Macro = { id: `m-${Date.now().toString(36)}`, name: "New macro", steps: [], repeat: { mode: "once" } };
    await save(n);
    setSel(n.id);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Automation</div>
          <h1>Macros</h1>
          <p>Record or build sequences, then bind them to any key or mouse button.</p>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={create}><Plus size={15} /> New macro</button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "280px 1fr", alignItems: "start" }}>
        <div className="card" style={{ padding: 8 }}>
          {snap.macros.map((x) => (
            <button key={x.id} className={`layer${sel === x.id ? " sel" : ""}`} style={{ width: "100%", background: "none", color: "inherit", textAlign: "left" }} onClick={() => setSel(x.id)}>
              <div className="nm">
                <b>{x.name}</b>
                <span>{x.steps.length} steps · {x.steps.reduce((a, s) => a + (s.type === "delay" ? s.ms : 0), 0)} ms</span>
              </div>
            </button>
          ))}
          {!snap.macros.length && <div className="empty">No macros yet.</div>}
        </div>
        {m ? (
          <Editor
            key={m.id}
            m={m}
            rec={rec}
            onSave={save}
            onRecord={async () => {
              if (!rec) {
                await api.startRecording();
                setRec(true);
                toast(api.desktop ? "Recording — type anywhere" : "Recording — type on this page");
              } else {
                const steps = await api.stopRecording();
                setRec(false);
                await save({ ...m, steps: [...m.steps, ...steps] });
                toast(`Recorded ${steps.length} steps`);
              }
            }}
            onPlay={async () => {
              await api.playMacro(m.id);
              toast(api.desktop ? `Playing “${m.name}”` : "Playback needs the desktop app");
            }}
            onDelete={async () => {
              setSnap({ ...snap, macros: await api.deleteMacro(m.id) });
              setSel(null);
            }}
          />
        ) : (
          <div className="card empty">Select or create a macro.</div>
        )}
      </div>
    </div>
  );
}

function Editor({ m, rec, onSave, onRecord, onPlay, onDelete }: { m: Macro; rec: boolean; onSave: (m: Macro) => void; onRecord: () => void; onPlay: () => void; onDelete: () => void }) {
  const [name, setName] = useState(m.name);
  useEffect(() => setName(m.name), [m.name]);
  const steps = m.steps;
  const setSteps = (s: Step[]) => onSave({ ...m, steps: s });
  const move = (i: number, d: number) => {
    const s = [...steps];
    [s[i], s[i + d]] = [s[i + d], s[i]];
    setSteps(s);
  };
  return (
    <div className="card pad">
      <div className="row" style={{ marginBottom: 16 }}>
        <input className="input" style={{ flex: 1, fontWeight: 600, fontSize: 16 }} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== m.name && onSave({ ...m, name })} />
        <button className={`btn${rec ? " rec" : ""}`} onClick={onRecord}>{rec ? <><span className="blink" /> Stop</> : <>● Record</>}</button>
        <button className="btn" onClick={onPlay}><Play size={14} /> Play</button>
        <button className="btn icon danger" onClick={onDelete} aria-label="Delete macro"><Trash2 size={15} /></button>
      </div>
      <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <span className="label">Repeat</span>
        <Seg
          value={m.repeat.mode}
          options={[["once", "Once"], ["times", "N times"], ["while-held", "While held"], ["toggle", "Toggle"]]}
          onChange={(mode) => onSave({ ...m, repeat: mode === "times" ? { mode, n: 3 } : ({ mode } as Macro["repeat"]) })}
        />
        {m.repeat.mode === "times" && <input className="input mono" style={{ width: 80 }} type="number" min={1} max={100} value={m.repeat.n} onChange={(e) => onSave({ ...m, repeat: { mode: "times", n: +e.target.value } })} />}
      </div>
      <div className="timeline">
        {steps.map((s, i) => (
          <div className="step" key={i}>
            <div className={`ic ${s.type === "delay" ? "delay" : s.type === "text" ? "text" : s.type.endsWith("down") ? "down" : "up"}`}>
              {s.type === "delay" ? <Clock size={13} /> : s.type === "text" ? <Type size={13} /> : s.type.endsWith("down") ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
            </div>
            <div className="grow">
              {s.type === "delay" ? (
                <span className="row" style={{ gap: 6 }}>
                  Wait <input className="input mono" style={{ width: 90, height: 28 }} type="number" min={0} value={s.ms} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { type: "delay", ms: +e.target.value } : x)))} /> ms
                </span>
              ) : s.type === "text" ? (
                <input className="input" style={{ height: 28, width: "100%" }} value={s.text} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { type: "text", text: e.target.value } : x)))} />
              ) : (
                <span>
                  <span className="dim">{s.type.startsWith("key") ? "Key" : "Mouse"} {s.type.endsWith("down") ? "down" : "up"}</span>{" "}
                  <b className="mono">{"key" in s ? s.key : s.button}</b>
                </span>
              )}
            </div>
            <button className="btn sm icon ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={13} /></button>
            <button className="btn sm icon ghost" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={13} /></button>
            <button className="btn sm icon ghost" onClick={() => setSteps([...steps.slice(0, i + 1), structuredClone(s), ...steps.slice(i + 1)])} aria-label="Duplicate"><Copy size={13} /></button>
            <button className="btn sm icon ghost danger" onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={13} /></button>
          </div>
        ))}
        {!steps.length && <div className="empty">Empty. Record, or add steps below.</div>}
      </div>
      <div className="row" style={{ marginTop: 14, flexWrap: "wrap", gap: 8 }}>
        <button className="btn sm" onClick={() => setSteps([...steps, { type: "key-down", key: "A" }, { type: "key-up", key: "A" }])}><Plus size={13} /> Key press</button>
        <button className="btn sm" onClick={() => setSteps([...steps, { type: "mouse-down", button: "Left" }, { type: "delay", ms: 30 }, { type: "mouse-up", button: "Left" }])}><Plus size={13} /> Click</button>
        <button className="btn sm" onClick={() => setSteps([...steps, { type: "delay", ms: 50 }])}><Plus size={13} /> Delay</button>
        <button className="btn sm" onClick={() => setSteps([...steps, { type: "text", text: "" }])}><Plus size={13} /> Text</button>
      </div>
    </div>
  );
}
