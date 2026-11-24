import { Reorder } from "motion/react";
import { Eye, EyeOff, GripVertical, Plus, RotateCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../app/store";
import { Preview } from "../components/Preview";
import { DeviceArt } from "../components/DeviceArt";
import { EffectThumb } from "../components/EffectThumb";
import { ParamControls } from "../components/ParamControls";
import { Seg, Slider } from "../components/controls";
import type { Blend, LayerSpec, ParamValue, Placement, Scene } from "../lib/types";

const ASPECT = 192 / 120;
const BLENDS: [Blend, string][] = [["normal", "Normal"], ["screen", "Screen"], ["add", "Add"], ["multiply", "Multiply"], ["lighten", "Lighten"], ["mask", "Mask"]];

export function defaults(lib: ReturnType<typeof useStore>["library"], effect: string) {
  return Object.fromEntries(lib.find((e) => e.id === effect)?.params.map((p) => [p.key, p.default]) ?? []);
}

export function Studio() {
  const { profile, updateProfile, library, api, snap, setSnap } = useStore();
  const [scene, setScene] = useState<Scene>(profile.scene);
  const [sel, setSel] = useState<string | null>(profile.scene.layers.at(-1)?.id ?? null);
  const [picker, setPicker] = useState(false);
  const [selDev, setSelDev] = useState<string | null>(null);
  const saveT = useRef<number>(0);
  useEffect(() => setScene(profile.scene), [profile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // live: push to engine every change, persist the profile debounced
  const apply = (next: Scene) => {
    setScene(next);
    api.setScene(next);
    clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => updateProfile((p) => ({ ...p, scene: next })), 400);
  };
  const layer = scene.layers.find((l) => l.id === sel);
  const info = layer && library.find((e) => e.id === layer.effect);
  const patch = (id: string, f: (l: LayerSpec) => LayerSpec) => apply({ layers: scene.layers.map((l) => (l.id === id ? f(l) : l)) });

  const add = (effect: string) => {
    const id = `l${Date.now().toString(36)}`;
    const blend: Blend = scene.layers.length ? "screen" : "normal";
    apply({ layers: [...scene.layers, { id, effect, params: defaults(library, effect), blend, opacity: 1, enabled: true }] });
    setSel(id);
    setPicker(false);
  };

  // stacking: the list shows top layer first
  const shown = [...scene.layers].reverse();

  return (
    <div className="page" style={{ maxWidth: "none", paddingBottom: 20 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">{profile.name}</div>
          <h1>Lighting Studio</h1>
          <p>Layer effects on one canvas. Drag your devices to where they sit on the desk; the light follows.</p>
        </div>
      </div>
      <div className="studio">
        <div className="card">
          <div className="panel-head">
            <h3>Layers</h3>
            <button className="btn sm primary" onClick={() => setPicker((p) => !p)}>
              {picker ? <X size={14} /> : <Plus size={14} />} {picker ? "Close" : "Add"}
            </button>
          </div>
          <div className="panel-body" style={{ padding: 8 }}>
            {picker ? (
              <div className="col" style={{ gap: 4 }}>
                {library.map((e) => (
                  <button key={e.id} className="layer" style={{ border: 0, background: "none", textAlign: "left", color: "inherit" }} onClick={() => add(e.id)}>
                    <EffectThumb effect={e.id} params={defaults(library, e.id)} w={48} h={30} />
                    <div className="nm">
                      <b>{e.name}</b>
                      <span>{e.category}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <Reorder.Group axis="y" values={shown} onReorder={(v) => apply({ layers: [...v].reverse() })} style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {shown.map((l) => {
                  const e = library.find((x) => x.id === l.effect);
                  return (
                    <Reorder.Item key={l.id} value={l} className={`layer${sel === l.id ? " sel" : ""}${l.enabled ? "" : " off"}`} onClick={() => setSel(l.id)}>
                      <GripVertical size={14} className="dim" style={{ cursor: "grab", flex: "none" }} />
                      <EffectThumb effect={l.effect} params={l.params} w={48} h={30} />
                      <div className="nm">
                        <b>{e?.name ?? l.effect}</b>
                        <span>{l.blend} · {Math.round(l.opacity * 100)}%</span>
                      </div>
                      <button className="btn sm icon ghost" onClick={(ev) => (ev.stopPropagation(), patch(l.id, (x) => ({ ...x, enabled: !x.enabled })))} aria-label="Toggle layer">
                        {l.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                    </Reorder.Item>
                  );
                })}
                {!shown.length && <div className="empty">No layers. Add an effect to light things up.</div>}
              </Reorder.Group>
            )}
          </div>
        </div>

        <div className="card">
          <Desk
            onPress={(u, v) => api.pressAt(u, v)}
            sel={selDev}
            setSel={setSelDev}
            onPlace={(id, p, commit) => {
              api.setPlacement(id, p);
              if (commit) setSnap({ ...snap, devices: snap.devices.map((d) => (d.info.id === id ? { ...d, placement: p } : d)) });
            }}
          />
        </div>

        <div className="card">
          <div className="panel-head">
            <h3>{info ? info.name : "Properties"}</h3>
            {layer && (
              <button
                className="btn sm icon ghost danger"
                aria-label="Delete layer"
                onClick={() => {
                  apply({ layers: scene.layers.filter((l) => l.id !== layer.id) });
                  setSel(scene.layers.find((l) => l.id !== layer.id)?.id ?? null);
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <div className="panel-body">
            {layer && info ? (
              <>
                <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>{info.description}</p>
                <div className="field" style={{ marginBottom: 14 }}>
                  <label>Blend</label>
                  <select className="select" value={layer.blend} onChange={(e) => patch(layer.id, (l) => ({ ...l, blend: e.target.value as Blend }))}>
                    {BLENDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 18 }}>
                  <div className="label">Opacity <b>{Math.round(layer.opacity * 100)}%</b></div>
                  <Slider value={layer.opacity} onChange={(v) => patch(layer.id, (l) => ({ ...l, opacity: v }))} />
                </div>
                <div className="sep" />
                <ParamControls specs={info.params} values={layer.params} onChange={(k: string, v: ParamValue) => patch(layer.id, (l) => ({ ...l, params: { ...l.params, [k]: v } }))} />
              </>
            ) : (
              <div className="empty">Select a layer.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Desk({ onPress, onPlace, sel, setSel }: { onPress: (u: number, v: number) => void; onPlace: (id: string, p: Placement, commit: boolean) => void; sel: string | null; setSel: (id: string | null) => void }) {
  const { snap } = useStore();
  const box = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 375 });
  const [local, setLocal] = useState<Record<string, Placement>>({});
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const w = Math.min(width, height * ASPECT);
      setSize({ w, h: w / ASPECT });
    });
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);
  const place = (id: string) => local[id] ?? snap.devices.find((d) => d.info.id === id)!.placement;
  const update = (id: string, p: Placement, commit = false) => {
    setLocal((l) => ({ ...l, [id]: p }));
    onPlace(id, p, commit);
  };
  const selDev = sel ? snap.devices.find((d) => d.info.id === sel) : null;

  return (
    <>
      <div ref={wrap} style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", margin: 14 }}>
        <div ref={box} className="desk" style={{ width: size.w, height: size.h, margin: 0, flex: "none" }} onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
          <Preview onPress={onPress} />
          <div className="gridlines" />
          {snap.devices.map((d) => {
            const p = place(d.info.id);
            if (!p.visible) return null;
            const w = ((d.info.layout.width * p.scale) / 1000) * size.w;
            const h = ((d.info.layout.height * p.scale) / (1000 / ASPECT)) * size.h;
            return (
              <div
                key={d.info.id}
                className={`dev${sel === d.info.id ? " sel" : ""}`}
                style={{ left: p.x * size.w - w / 2, top: p.y * size.h - h / 2, width: w, height: h, transform: `rotate(${p.rotation}deg)` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel(d.info.id);
                  const el = e.currentTarget;
                  el.setPointerCapture(e.pointerId);
                  el.classList.add("dragging");
                  const start = { x: e.clientX, y: e.clientY, p };
                  let cur = p;
                  const move = (ev: PointerEvent) => {
                    cur = { ...start.p, x: Math.min(Math.max(start.p.x + (ev.clientX - start.x) / size.w, 0), 1), y: Math.min(Math.max(start.p.y + (ev.clientY - start.y) / size.h, 0), 1) };
                    update(d.info.id, cur);
                  };
                  const up = () => {
                    el.classList.remove("dragging");
                    el.removeEventListener("pointermove", move);
                    el.removeEventListener("pointerup", up);
                    update(d.info.id, cur, true);
                  };
                  el.addEventListener("pointermove", move);
                  el.addEventListener("pointerup", up);
                }}
                onWheel={(e) => {
                  const q = place(d.info.id);
                  if (e.shiftKey) update(d.info.id, { ...q, rotation: (q.rotation + Math.sign(e.deltaY) * 15 + 360) % 360 }, true);
                  else update(d.info.id, { ...q, scale: Math.min(Math.max(q.scale * (e.deltaY < 0 ? 1.06 : 0.94), 0.2), 4) }, true);
                }}
              >
                <DeviceArt device={d.info} padding={0} desk />
                <div className="outline" />
                <div className="tag">{d.info.name}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="desk-foot">
        {selDev ? (
          <>
            <b style={{ color: "var(--text)" }}>{selDev.info.name}</b>
            <span style={{ width: 120 }}>
              <Slider value={place(selDev.info.id).scale} min={0.2} max={4} step={0.05} onChange={(v) => update(selDev.info.id, { ...place(selDev.info.id), scale: v })} onCommit={(v) => update(selDev.info.id, { ...place(selDev.info.id), scale: v }, true)} />
            </span>
            <button className="btn sm" onClick={() => { const q = place(selDev.info.id); update(selDev.info.id, { ...q, rotation: (q.rotation + 90) % 360 }, true); }}>
              <RotateCw size={13} /> 90°
            </button>
            <Seg value={place(selDev.info.id).visible ? "on" : "off"} options={[["on", "On canvas"], ["off", "Hidden"]]} onChange={(v) => update(selDev.info.id, { ...place(selDev.info.id), visible: v === "on" }, true)} />
          </>
        ) : (
          <span>Drag devices to place them · scroll to resize · shift+scroll to rotate · click the canvas to send a ripple</span>
        )}
      </div>
    </>
  );
}
