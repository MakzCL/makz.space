// Right-hand panels of the editor: properties (exact size/position), layers, geometry checks, history.
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Eye, EyeOff, FlipHorizontal2, FlipVertical2, Lock, RotateCcw, RotateCw, Trash2, Unlock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../components/Toast";
import { OP_LABEL, OP_TYPES, decompose, findObj, localPaths, objBox, opOf, worldPaths, type Doc, type Layer, type Obj, type OpType } from "../geom/core";
import { duplicateSegments, openContours, selfIntersections } from "../geom/ops";
import { FONTS, loadFont, textOutline } from "../geom/text";
import { errText, useT } from "../data";
import { useSession } from "../session";
import { Btn, Check, Modal, Num, Sel, Text } from "../ui";
import * as A from "./actions";

type Tab = "props" | "layers" | "checks" | "history";
interface Props {
  readOnly: boolean; edit: (fn: (d: Doc) => Doc, label: string) => void; editSel: (fn: (d: Doc) => { doc: Doc; ids?: string[]; id?: string | null }, label: string) => void;
  activeLayer: string; setActiveLayer: (id: string) => void; grid: number; setGrid: (g: number) => void; warnings: string[]; clearWarnings: () => void;
}
export function Panels(p: Props) {
  const [tab, setTab] = useState<Tab>("props");
  useEffect(() => { if (p.warnings.length) setTab("checks"); }, [p.warnings]);
  return (
    <div className="t-panels">
      <div className="t-tabs" role="tablist">
        {(["props", "layers", "checks", "history"] as Tab[]).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} data-testid={`panel-${t}`}>{{ props: "Properties", layers: "Layers", checks: "Checks", history: "History" }[t]}</button>)}
      </div>
      <div className="t-panel-b">
        {tab === "props" && <PropsPanel {...p} />}
        {tab === "layers" && <LayersPanel {...p} />}
        {tab === "checks" && <ChecksPanel {...p} />}
        {tab === "history" && <HistoryPanel readOnly={p.readOnly} />}
      </div>
    </div>
  );
}

function PropsPanel({ readOnly, edit, editSel, grid, setGrid }: Props) {
  const S = useSession(); const toast = useToast();
  const { doc, sel } = S;
  const [keep, setKeep] = useState(true); const [off, setOff] = useState(2);
  const b = A.selBox(doc, sel);
  const one = sel.length === 1 ? findObj(doc.objects, sel[0]) : null;
  const ro = readOnly;
  if (!b) return (
    <div className="t-props">
      <h4>Document</h4>
      <div className="t-grid2">
        <Num label="Width" unit="mm" value={doc.width} min={1} max={5000} disabled={ro} onCommit={(v) => edit((d) => ({ ...d, width: v }), "Page width")} testid="doc-w" />
        <Num label="Height" unit="mm" value={doc.height} min={1} max={5000} disabled={ro} onCommit={(v) => edit((d) => ({ ...d, height: v }), "Page height")} testid="doc-h" />
      </div>
      <p className="t-note">The page is the design area. The machine bed and material sheet are set in PREPARE.</p>
      <Num label="Grid" unit="mm" value={grid} min={0.1} max={500} onCommit={setGrid} />
      <h4>Units</h4><p className="t-note">All sizes are millimetres. Fields accept arithmetic, e.g. <code>25.4*3</code> or <code>300/4</code>.</p>
      <h4>Shortcuts</h4>
      <dl className="t-keys">
        <dt>V A P B L R E Y T H</dt><dd>Tools</dd><dt>Ctrl Z / Ctrl Shift Z</dt><dd>Undo / redo</dd><dt>Ctrl C X V D</dt><dd>Copy, cut, paste, duplicate</dd>
        <dt>Ctrl G / Ctrl Shift G</dt><dd>Group / ungroup</dd><dt>Arrows</dt><dd>Nudge 1 mm (Shift 10, Alt 0.1)</dd><dt>Shift drag</dt><dd>Keep ratio / 45° / 15° steps</dd>
        <dt>Alt drag</dt><dd>Duplicate; scale from centre; no snapping</dd><dt>Space drag</dt><dd>Pan</dd><dt>Ctrl 0 / Ctrl 1</dt><dd>Fit page / actual size</dd><dt>Ctrl S</dt><dd>Save now</dd>
      </dl>
    </div>
  );
  const rot = one ? Math.round(decompose(one.m).rot * 100) / 100 : 0;
  const run = (fn: () => void) => { try { fn(); } catch (e) { toast(errText(e), "error"); } };
  const setText = async (o: Extract<Obj, { kind: "text" }>, patch: Partial<{ text: string; size: number; font: string }>) => {
    try { const n = { ...o, ...patch }; const f = await loadFont(n.font); const paths = textOutline(f, n.text, n.size); edit((d) => ({ ...d, objects: d.objects.map((x) => (x.id === o.id ? { ...n, paths } : x)) }), "Edit text"); }
    catch (e) { toast(errText(e), "error"); }
  };
  const objs = A.selected(doc, sel);
  const layerOf = objs.every((o) => o.layer === objs[0]?.layer) ? objs[0]?.layer : "";
  const opOverride = objs.every((o) => (o.op ?? "") === (objs[0]?.op ?? "")) ? objs[0]?.op ?? "" : "mixed";
  return (
    <div className="t-props">
      <h4>{sel.length === 1 ? (one?.name || kindName(one)) : `${sel.length} objects`}</h4>
      <div className="t-grid2">
        <Num label="X" unit="mm" value={b.x} disabled={ro} onCommit={(v) => edit((d) => A.setSelBox(d, sel, { x: v }, false), "Position")} testid="prop-x" />
        <Num label="Y" unit="mm" value={b.y} disabled={ro} onCommit={(v) => edit((d) => A.setSelBox(d, sel, { y: v }, false), "Position")} testid="prop-y" />
        <Num label="W" unit="mm" value={b.w} min={0.001} disabled={ro || b.w < 1e-9} onCommit={(v) => edit((d) => A.setSelBox(d, sel, { w: v }, keep), "Width")} testid="prop-w" />
        <Num label="H" unit="mm" value={b.h} min={0.001} disabled={ro || b.h < 1e-9} onCommit={(v) => edit((d) => A.setSelBox(d, sel, { h: v }, keep), "Height")} testid="prop-h" />
      </div>
      <div className="t-row">
        <Check on={keep} onChange={setKeep} label="Keep proportions" />
        {one && <Num label="Angle" unit="°" value={rot} width={120} disabled={ro} onCommit={(v) => edit((d) => A.rotateSel(d, sel, v - rot), "Rotate")} testid="prop-rot" />}
      </div>
      <div className="t-iconrow" aria-label="Transform">
        <Btn small title="Rotate 90° left" icon={<RotateCcw size={15} />} disabled={ro} onClick={() => edit((d) => A.rotateSel(d, sel, -90), "Rotate")} />
        <Btn small title="Rotate 90° right" icon={<RotateCw size={15} />} disabled={ro} onClick={() => edit((d) => A.rotateSel(d, sel, 90), "Rotate")} />
        <Btn small title="Mirror horizontally" icon={<FlipHorizontal2 size={15} />} disabled={ro} onClick={() => edit((d) => A.mirrorSel(d, sel, "h"), "Mirror")} />
        <Btn small title="Mirror vertically" icon={<FlipVertical2 size={15} />} disabled={ro} onClick={() => edit((d) => A.mirrorSel(d, sel, "v"), "Mirror")} />
      </div>
      <h4>{sel.length === 1 ? "Align to page" : "Align"}</h4>
      <div className="t-iconrow">
        <Btn small title="Align left" icon={<AlignStartVertical size={15} />} disabled={ro} onClick={() => edit((d) => A.alignSel(d, sel, "left"), "Align")} />
        <Btn small title="Centre horizontally" icon={<AlignCenterVertical size={15} />} disabled={ro} onClick={() => edit((d) => A.alignSel(d, sel, "hcenter"), "Align")} />
        <Btn small title="Align right" icon={<AlignEndVertical size={15} />} disabled={ro} onClick={() => edit((d) => A.alignSel(d, sel, "right"), "Align")} />
        <Btn small title="Align top" icon={<AlignStartHorizontal size={15} />} disabled={ro} onClick={() => edit((d) => A.alignSel(d, sel, "top"), "Align")} />
        <Btn small title="Centre vertically" icon={<AlignCenterHorizontal size={15} />} disabled={ro} onClick={() => edit((d) => A.alignSel(d, sel, "vcenter"), "Align")} />
        <Btn small title="Align bottom" icon={<AlignEndHorizontal size={15} />} disabled={ro} onClick={() => edit((d) => A.alignSel(d, sel, "bottom"), "Align")} />
      </div>
      {sel.length > 2 && <div className="t-row"><Btn small disabled={ro} onClick={() => edit((d) => A.distributeSel(d, sel, "h"), "Distribute")}>Distribute ↔</Btn><Btn small disabled={ro} onClick={() => edit((d) => A.distributeSel(d, sel, "v"), "Distribute")}>Distribute ↕</Btn></div>}
      <h4>Laser</h4>
      <Sel label="Layer" value={layerOf ?? ""} disabled={ro} onChange={(v) => v && edit((d) => A.moveToLayer(d, sel, v), "Move to layer")} testid="prop-layer"
        options={[...(layerOf ? [] : [{ value: "", label: "Mixed layers" }]), ...doc.layers.map((l) => ({ value: l.id, label: `${l.name} — ${OP_LABEL[l.op]}`, disabled: l.locked }))]} />
      <Sel label="Operation" value={opOverride as string} disabled={ro} testid="prop-op"
        onChange={(v) => v !== "mixed" && edit((d) => ({ ...d, objects: d.objects.map((o) => (sel.includes(o.id) ? { ...o, op: (v || undefined) as OpType | undefined } : o)) }), "Operation")}
        options={[...(opOverride === "mixed" ? [{ value: "mixed", label: "Mixed" }] : []), { value: "", label: "From layer" }, ...OP_TYPES.map((t) => ({ value: t, label: OP_LABEL[t] }))]} />
      {one?.kind === "rect" && <Num label="Corner radius" unit="mm" value={one.r} min={0} disabled={ro} onCommit={(v) => edit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === one.id && o.kind === "rect" ? { ...o, r: v } : o)) }), "Corner radius")} />}
      {one?.kind === "polygon" && <div className="t-grid2">
        <Num label="Sides" value={one.n} min={3} max={64} step={1} digits={0} disabled={ro} onCommit={(v) => edit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === one.id && o.kind === "polygon" ? { ...o, n: Math.round(v) } : o)) }), "Sides")} />
        <Num label="Star" value={one.star} min={0} max={0.95} step={0.05} disabled={ro} onCommit={(v) => edit((d) => ({ ...d, objects: d.objects.map((o) => (o.id === one.id && o.kind === "polygon" ? { ...o, star: v } : o)) }), "Star")} />
      </div>}
      {one?.kind === "text" && <>
        <Text label="Text" value={one.text} multiline onCommit={(v) => v.trim() && setText(one, { text: v })} testid="prop-text" />
        <div className="t-grid2">
          <Num label="Size" unit="mm" value={one.size} min={0.5} disabled={ro} onCommit={(v) => setText(one, { size: v })} />
          <Sel label="Font" value={one.font} disabled={ro} onChange={(v) => setText(one, { font: v })} options={Object.keys(FONTS).map((f) => ({ value: f, label: f }))} />
        </div>
        <p className="t-note">Text is stored with its outline, so it cuts exactly as shown on any computer.</p>
      </>}
      {one?.kind === "image" && (() => { const k = decompose(one.m).sx; const dpi = one.pxW / ((one.w * k) / 25.4); return <p className="t-note">{one.pxW} × {one.pxH} px at <b>{Math.round(dpi)} DPI</b> effective. {dpi < 150 ? "Low resolution — engraving may look soft." : ""}</p>; })()}
      <h4>Shape</h4>
      <div className="t-btnwrap">
        <Btn small disabled={ro || sel.length < 2} onClick={() => run(() => p_edit(editSel, (d) => A.booleanSel(d, sel, "union"), "Union"))} title="Weld shapes">Union</Btn>
        <Btn small disabled={ro || sel.length < 2} onClick={() => run(() => p_edit(editSel, (d) => A.booleanSel(d, sel, "subtract"), "Subtract"))} title="First selected (bottom) minus the rest">Subtract</Btn>
        <Btn small disabled={ro || sel.length < 2} onClick={() => run(() => p_edit(editSel, (d) => A.booleanSel(d, sel, "intersect"), "Intersect"))}>Intersect</Btn>
        <Btn small disabled={ro || sel.length < 2} onClick={() => run(() => p_edit(editSel, (d) => A.booleanSel(d, sel, "exclude"), "Exclude"))}>Exclude</Btn>
        <Btn small disabled={ro} onClick={() => editSel((d) => A.joinSel(d, sel), "Join")} title="Join open ends within 0.05 mm">Join</Btn>
        <Btn small disabled={ro} onClick={() => editSel((d) => A.breakApart(d, sel), "Break apart")}>Break apart</Btn>
        <Btn small disabled={ro} onClick={() => edit((d) => A.convertToPaths(d, sel), "Convert to path")}>To path</Btn>
        {sel.length > 1 && <Btn small disabled={ro} onClick={() => editSel((d) => A.groupSel(d, sel), "Group")}>Group</Btn>}
        {objs.some((o) => o.kind === "group") && <Btn small disabled={ro} onClick={() => editSel((d) => A.ungroupSel(d, sel), "Ungroup")}>Ungroup</Btn>}
      </div>
      <div className="t-row">
        <Num label="Offset" unit="mm" value={off} onCommit={setOff} width={140} />
        <Btn small disabled={ro || !off} onClick={() => editSel((d) => A.offsetSel(d, sel, off), "Offset")} title="Adds a new outline; negative values go inwards">Add offset</Btn>
      </div>
    </div>
  );
}
const p_edit = (editSel: Props["editSel"], fn: (d: Doc) => { doc: Doc; id: string }, label: string) => editSel(fn, label);
const kindName = (o: Obj | null) => (o ? { path: "Path", rect: "Rectangle", ellipse: "Ellipse", polygon: "Polygon", text: "Text", image: "Image", group: "Group" }[o.kind] : "");

function LayersPanel({ readOnly, edit, activeLayer, setActiveLayer }: Props) {
  const S = useSession(); const toast = useToast(); const { doc } = S;
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const o of doc.objects) m.set(o.layer, (m.get(o.layer) ?? 0) + 1); return m; }, [doc.objects]);
  const up = (id: string, patch: Partial<Layer>, label = "Layer") => edit((d) => A.updateLayer(d, id, patch), label);
  return (
    <div className="t-layers">
      <p className="t-note">Each layer has a colour and a laser operation. New shapes go on the active layer. Power and speed come from approved material profiles in PREPARE.</p>
      {doc.layers.map((l) => (
        <div key={l.id} className={`t-layer ${activeLayer === l.id ? "on" : ""}`} onClick={() => setActiveLayer(l.id)} data-testid="layer-row">
          <input type="color" value={l.color} disabled={readOnly} onChange={(e) => up(l.id, { color: e.target.value }, "Layer colour")} onClick={(e) => e.stopPropagation()} aria-label={`${l.name} colour`} />
          <div className="t-layer-m">
            <Text value={l.name} onCommit={(v) => v.trim() && up(l.id, { name: v.trim() }, "Rename layer")} label="Layer name" />
            <Sel value={l.op} disabled={readOnly} onChange={(v) => up(l.id, { op: v }, "Layer operation")} options={OP_TYPES.map((t) => ({ value: t, label: OP_LABEL[t] }))} label="Operation" />
          </div>
          <span className="t-layer-n" title="Objects on this layer">{counts.get(l.id) ?? 0}</span>
          <div className="t-layer-b" onClick={(e) => e.stopPropagation()}>
            <Btn small title={l.visible ? "Hide layer" : "Show layer"} icon={l.visible ? <Eye size={14} /> : <EyeOff size={14} />} onClick={() => up(l.id, { visible: !l.visible }, "Layer visibility")} disabled={readOnly} />
            <Btn small title={l.locked ? "Unlock layer" : "Lock layer"} icon={l.locked ? <Lock size={14} /> : <Unlock size={14} />} onClick={() => up(l.id, { locked: !l.locked }, "Layer lock")} disabled={readOnly} />
            <Btn small title="Select objects on this layer" onClick={() => S.setSel(doc.objects.filter((o) => o.layer === l.id && !o.locked && !o.hidden).map((o) => o.id))}>Select</Btn>
            <Btn small title="Delete layer" icon={<Trash2 size={14} />} disabled={readOnly} onClick={() => { try { edit((d) => A.removeLayer(d, l.id), "Delete layer"); } catch (e) { toast(errText(e), "error"); } }} />
          </div>
        </div>
      ))}
      <Btn small disabled={readOnly} onClick={() => { const r = A.addLayer(S.doc); edit(() => r.doc, "Add layer"); setActiveLayer(r.id); }} testid="add-layer">Add layer</Btn>
    </div>
  );
}

interface CheckItem { level: "error" | "warning" | "info"; msg: string; ids: string[] }
function ChecksPanel({ warnings, clearWarnings }: Props) {
  const S = useSession(); const { doc } = S;
  const [run, setRun] = useState(0);
  const size = useMemo(() => doc.objects.reduce((n, o) => n + (o.kind === "group" ? 50 : localPaths(o).reduce((k, s) => k + s.segs.length, 0)), 0), [doc.objects]);
  const auto = size < 6000;
  const items = useMemo<CheckItem[] | null>(() => {
    if (!auto && !run) return null;
    const out: CheckItem[] = [];
    const geo: { id: string; paths: ReturnType<typeof worldPaths> }[] = [];
    for (const o of doc.objects) {
      if (o.hidden || o.kind === "image") continue;
      const op = opOf(doc, o); if (op === "none") continue;
      const ps = worldPaths(o); geo.push({ id: o.id, paths: ps });
      if (op === "cut" || op === "kiss") for (const g of openContours(o.id, ps)) out.push({ level: "warning", msg: `${op === "cut" ? "Cut" : "Kiss cut"}: ${g.detail}`, ids: g.ids });
      for (const g of selfIntersections(o.id, ps)) out.push({ level: "warning", msg: `Self-intersection: ${g.detail}`, ids: g.ids });
      const b = objBox(o);
      if (b && Math.max(b.w, b.h) < 0.2) out.push({ level: "warning", msg: `Very small shape (${b.w.toFixed(2)} × ${b.h.toFixed(2)} mm)`, ids: [o.id] });
      if (b && (b.x < -1e-6 || b.y < -1e-6 || b.x + b.w > doc.width + 1e-6 || b.y + b.h > doc.height + 1e-6)) out.push({ level: "info", msg: "Outside the page", ids: [o.id] });
    }
    for (const g of duplicateSegments(geo)) out.push({ level: "warning", msg: g.detail, ids: g.ids });
    const hidden = doc.layers.filter((l) => !l.visible && doc.objects.some((o) => o.layer === l.id));
    for (const l of hidden) out.push({ level: "info", msg: `Layer “${l.name}” is hidden — hidden layers are still included in jobs unless set to “No output”.`, ids: [] });
    return out;
  }, [doc, auto, run]);
  return (
    <div className="t-checks" data-testid="checks">
      {warnings.length > 0 && <div className="t-check-imp"><div className="t-row"><b>Import notes</b><Btn small onClick={clearWarnings}>Dismiss</Btn></div>{warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
      {!auto && <div className="t-row"><span className="t-note">Large design — checks run on request.</span><Btn small onClick={() => setRun((n) => n + 1)}>Run checks</Btn></div>}
      {items && !items.length && <p className="t-ok">No geometry problems found.</p>}
      {items?.map((c, i) => <button key={i} type="button" className={`t-issue ${c.level}`} onClick={() => c.ids.length && S.setSel(c.ids.filter((id) => doc.objects.some((o) => o.id === id)))}>{c.msg}</button>)}
      <p className="t-note">Machine, material and sheet checks run in PREPARE.</p>
    </div>
  );
}

function HistoryPanel({ readOnly }: { readOnly: boolean }) {
  const S = useSession(); const T = useT(); const toast = useToast();
  const [list, setList] = useState<{ version: number; note: string; created_by: string | null; created_at: string }[] | null>(null);
  const [note, setNote] = useState(""); const [ask, setAsk] = useState(false);
  const id = S.project?.id;
  const load = () => { if (id) T.revisions(id).then(setList).catch((e) => toast(errText(e), "error")); };
  useEffect(load, [id, S.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!id) return null;
  return (
    <div className="t-history">
      <div className="t-row"><span className="t-note">Autosaves every few seconds. Save a named revision to keep a version you can return to; jobs always point at a revision.</span></div>
      <Btn small tone="primary" disabled={readOnly} onClick={() => setAsk(true)} testid="save-revision">Save revision…</Btn>
      {list?.map((r) => (
        <div key={r.version} className="t-rev">
          <b>v{r.version}</b><span>{r.note || "—"}</span><small>{new Date(r.created_at).toLocaleString("en-GB")}</small>
          <Btn small disabled={readOnly} onClick={async () => { try { const d = await T.revisionDoc(id, r.version); S.replaceDoc(d, `Restore v${r.version}`); toast(`Restored v${r.version} — Undo to go back`, "ok"); } catch (e) { toast(errText(e), "error"); } }}>Restore</Btn>
        </div>
      ))}
      {list && !list.length && <p className="t-note">No revisions yet.</p>}
      {ask && <Modal title="Save revision" onClose={() => setAsk(false)} foot={<><Btn onClick={() => setAsk(false)}>Cancel</Btn><Btn tone="primary" testid="save-revision-ok" onClick={async () => { setAsk(false); const v = await S.save(note.trim(), true); if (v) { toast(`Saved revision v${v}`, "ok"); setNote(""); load(); } else toast(S.saveError ?? "Not saved", "error"); }}>Save</Btn></>}>
        <Text label="What changed?" value={note} onCommit={setNote} placeholder="e.g. Enlarged holes to 4.2 mm" testid="revision-note" />
      </Modal>}
    </div>
  );
}
