// ADMINISTRATION: role access, machines (capabilities), materials (linked to KORTANA stock), laser
// settings with versioning and approval, material test cards, audit log and diagnostics.
import { URLS } from "../../../../packages/sk-channel/channel";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../components/Toast";
import { ROLE_META, ROLE_ORDER } from "../../lib/roles";
import { useStore } from "../../lib/store";
import { OP_LABEL, OP_TYPES, newDoc, uid, type Doc, type Layer, type Mat, type Obj, type OpType } from "../geom/core";
import { ADAPTERS, NO_INTERFACE } from "../geom/adapters";
import { UNITS, checkParams, type MachineCaps, type OpParams } from "../geom/laser";
import { loadFont, textOutline } from "../geom/text";
import { IMPORT_FORMATS } from "../editor/io";
import { SECTIONS, errText, useT, type MachineRow, type MaterialRow, type ProfileRow, type ProfileStatus, type Section } from "../data";
import { useSession } from "../session";
import { Btn, Check, Empty, Modal, Num, Pill, Sel, Text } from "../ui";

type Tab = "access" | "machines" | "materials" | "settings" | "tests" | "audit" | "diagnostics";
const SECTION_LABEL: Record<Section, string> = { manage: "Manage", design: "Design", prepare: "Prepare", produce: "Produce", admin: "Administration", approve: "Approve settings" };
const LASER_OPS = OP_TYPES.filter((o) => o !== "none") as Exclude<OpType, "none">[];

export function Admin({ go }: { go: (w: "design" | "prepare") => void }) {
  const T = useT();
  const admin = T.can("admin"), approve = T.can("approve");
  const tabs: { v: Tab; label: string; ok: boolean }[] = [
    { v: "settings", label: "Laser settings", ok: admin || approve }, { v: "tests", label: "Material tests", ok: approve },
    { v: "machines", label: "Machines", ok: admin }, { v: "materials", label: "Materials", ok: admin }, { v: "access", label: "Access", ok: admin || T.can("manage") },
    { v: "audit", label: "Audit log", ok: admin }, { v: "diagnostics", label: "Diagnostics", ok: true },
  ];
  const allowed = tabs.filter((t) => t.ok);
  const [tab, setTab] = useState<Tab>(allowed[0]?.v ?? "diagnostics");
  return (
    <div className="t-page" data-testid="admin">
      <div className="t-head"><div><h1>Administration</h1><p className="t-note">Machines, materials and laser settings. Only approved settings are used in production.</p></div>
        <div className="t-seg">{allowed.map((t) => <button key={t.v} type="button" className={tab === t.v ? "on" : ""} onClick={() => setTab(t.v)} data-testid={`admin-${t.v}`}>{t.label}</button>)}</div></div>
      {tab === "access" && <Access />}{tab === "machines" && <Machines />}{tab === "materials" && <Materials />}
      {tab === "settings" && <Settings />}{tab === "tests" && <Tests go={go} />}{tab === "audit" && <Audit />}{tab === "diagnostics" && <Diagnostics />}
    </div>
  );
}

function useSave() {
  const T = useT(); const toast = useToast();
  return async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string, k?: Parameters<typeof T.refresh>[0]) => {
    try { const { error } = await fn(); if (error) throw new Error(error.message); await T.refresh(k); toast(ok, "ok"); return true; } catch (e) { toast(errText(e), "error"); return false; }
  };
}

function Access() {
  const T = useT(); const { db } = useStore();
  const roles = ROLE_ORDER.filter((r) => r !== "boss" && r !== "developer");
  return (
    <div className="t-table-wrap">
      <p className="t-note">Access to TROTAN is managed in <b>Kortana → Settings → TROTAN</b> by the Owner, a Developer or a Manager — per role, with exceptions for individual people. Owner and Developer always have everything.</p>
      <a className="t-btn primary" href={`${URLS.kortana}/#settings`} target="_blank" rel="noreferrer">Open Kortana settings</a>
      <h4>Current access by role</h4>
      <table className="t-table"><thead><tr><th>Role</th>{SECTIONS.map((s) => <th key={s}>{SECTION_LABEL[s]}</th>)}</tr></thead>
        <tbody>{roles.map((r) => { const secs = T.access.find((a) => a.role === r)?.sections ?? []; return <tr key={r}><td>{ROLE_META[r].label} <small className="t-muted">· {db.profiles.filter((p) => p.role === r && p.active).length}</small></td>{SECTIONS.map((s) => <td key={s}>{secs.includes(s) ? "✓" : ""}</td>)}</tr>; })}</tbody></table>
    </div>
  );
}

const DEFAULT_CAPS: MachineCaps = { bedW: 600, bedH: 400, laserType: "co2", maxPowerW: 60, maxSpeed: 1000, maxRasterSpeed: 1000, accel: 10000, travelSpeed: 800, ops: ["cut", "score", "vengrave", "raster", "mark"], freq: null, dpi: [254, 333, 500], focus: { min: -5, max: 5 }, airAssist: true, maxPasses: 20 };
function Machines() {
  const T = useT(); const [edit, setEdit] = useState<MachineRow | "new" | null>(null);
  return (
    <div>
      <div className="t-row"><Btn tone="primary" onClick={() => setEdit("new")} testid="add-machine">Add machine</Btn></div>
      <p className="t-note">“Virtual laser” machines run in simulation. Real machines are added with “No validated interface”: TROTAN prepares and exports their jobs but never controls them.</p>
      <div className="t-cards">{T.machines.map((m) => {
        const info = ADAPTERS[m.adapter]?.info(m.caps) ?? NO_INTERFACE(m.manufacturer, m.model);
        return <div key={m.id} className="t-card"><b>{m.name}</b><small>{m.manufacturer} {m.model} · {info.name}</small><small>{m.caps.bedW} × {m.caps.bedH} mm · {m.caps.laserType.toUpperCase()} {m.caps.maxPowerW} W · {m.caps.ops.map((o) => OP_LABEL[o]).join(", ")}</small>
          <div className="t-row"><Pill tone={m.active ? "ok" : ""}>{m.active ? "active" : "off"}</Pill><Pill>{m.status}</Pill>{m.prohibited.length > 0 && <Pill tone="err">{m.prohibited.length} prohibited</Pill>}<Btn small onClick={() => setEdit(m)}>Edit</Btn></div></div>;
      })}</div>
      {edit && <MachineForm m={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
function MachineForm({ m, onClose }: { m: MachineRow | null; onClose: () => void }) {
  const T = useT(); const save = useSave();
  const [f, setF] = useState({ name: m?.name ?? "", adapter: m?.adapter ?? "virtual", manufacturer: m?.manufacturer ?? "", model: m?.model ?? "", notes: m?.notes ?? "", active: m?.active ?? true, prohibited: m?.prohibited ?? [] as string[] });
  const [c, setC] = useState<MachineCaps>({ ...DEFAULT_CAPS, ...(m?.caps ?? {}) });
  const [dpi, setDpi] = useState(c.dpi.join(", "));
  const submit = async () => {
    const caps = { ...c, dpi: dpi.split(",").map((x) => Math.round(Number(x.trim()))).filter((x) => x > 0) };
    const row = { ...f, caps };
    if (await save(() => (m ? T.sb.from("trotan_machines").update(row).eq("id", m.id) : T.sb.from("trotan_machines").insert(row)), m ? "Machine saved" : "Machine added", "machines")) onClose();
  };
  const num = (k: keyof MachineCaps, label: string, unit?: string) => <Num label={label} unit={unit} value={c[k] as number} min={0} onCommit={(v) => setC({ ...c, [k]: v })} />;
  return (
    <Modal wide title={m ? `Edit ${m.name}` : "Add machine"} onClose={onClose} foot={<><Btn onClick={onClose}>Cancel</Btn><Btn tone="primary" disabled={!f.name.trim()} onClick={submit} testid="machine-save">Save</Btn></>}>
      <div className="t-grid2">
        <Text label="Name" value={f.name} onCommit={(v) => setF({ ...f, name: v })} testid="machine-name" />
        <Sel label="Interface" value={f.adapter} onChange={(v) => setF({ ...f, adapter: v })} options={[{ value: "virtual", label: "Virtual laser (simulation)" }, { value: "none", label: "No validated interface (prepare & export only)" }]} />
        <Text label="Manufacturer" value={f.manufacturer} onCommit={(v) => setF({ ...f, manufacturer: v })} /><Text label="Model" value={f.model} onCommit={(v) => setF({ ...f, model: v })} />
      </div>
      <h4>Capabilities (from the machine's documentation)</h4>
      <div className="t-grid3">
        {num("bedW", "Bed width", "mm")}{num("bedH", "Bed height", "mm")}
        <Sel label="Laser" value={c.laserType} onChange={(v) => setC({ ...c, laserType: v })} options={[{ value: "co2", label: "CO₂" }, { value: "fiber", label: "Fibre" }, { value: "diode", label: "Diode" }]} />
        {num("maxPowerW", "Max power", "W")}{num("maxSpeed", "Max vector speed", UNITS.speed)}{num("maxRasterSpeed", "Max raster speed", UNITS.speed)}
        {num("accel", "Acceleration", "mm/s²")}{num("travelSpeed", "Travel speed", UNITS.speed)}{num("maxPasses", "Max passes")}
        <Num label="Focus min" unit="mm" value={c.focus.min} onCommit={(v) => setC({ ...c, focus: { ...c.focus, min: v } })} /><Num label="Focus max" unit="mm" value={c.focus.max} onCommit={(v) => setC({ ...c, focus: { ...c.focus, max: v } })} />
        <Text label="Raster DPI options" value={dpi} onCommit={setDpi} />
      </div>
      <div className="t-row">
        <Check on={c.airAssist} onChange={(v) => setC({ ...c, airAssist: v })} label="Air assist" />
        <Check on={!!c.freq} onChange={(v) => setC({ ...c, freq: v ? { min: 1000, max: 60000 } : null })} label="Adjustable frequency" />
        {c.freq && <><Num label="Freq min" unit="Hz" value={c.freq.min} onCommit={(v) => setC({ ...c, freq: { ...c.freq!, min: v } })} /><Num label="Freq max" unit="Hz" value={c.freq.max} onCommit={(v) => setC({ ...c, freq: { ...c.freq!, max: v } })} /></>}
      </div>
      <h4>Supported operations</h4>
      <div className="t-row">{LASER_OPS.map((o) => <Check key={o} on={c.ops.includes(o)} onChange={(v) => setC({ ...c, ops: v ? [...c.ops, o] : c.ops.filter((x) => x !== o) })} label={OP_LABEL[o]} />)}</div>
      <h4>Prohibited materials on this machine</h4>
      <div className="t-row t-wrap">{T.materials.map((mt) => <Check key={mt.id} on={f.prohibited.includes(mt.id)} onChange={(v) => setF({ ...f, prohibited: v ? [...f.prohibited, mt.id] : f.prohibited.filter((x) => x !== mt.id) })} label={mt.name} />)}</div>
      <div className="t-row"><Check on={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" /></div>
      <Text label="Notes" value={f.notes} onCommit={(v) => setF({ ...f, notes: v })} multiline />
    </Modal>
  );
}

function Materials() {
  const T = useT(); const [edit, setEdit] = useState<MaterialRow | "new" | null>(null);
  return (
    <div>
      <div className="t-row"><Btn tone="primary" onClick={() => setEdit("new")} testid="add-material">Add material</Btn></div>
      <div className="t-table-wrap"><table className="t-table"><thead><tr><th>Material</th><th>Category</th><th>Thickness</th><th>Sheet</th><th>KORTANA</th><th /></tr></thead>
        <tbody>{T.materials.map((m) => <tr key={m.id} className={m.archived ? "t-muted" : ""}><td>{m.name}</td><td>{m.category}</td><td>{m.thickness_mm ?? "—"}</td><td>{m.sheet_w && m.sheet_h ? `${m.sheet_w} × ${m.sheet_h}` : "—"}</td><td>{m.stock_item_id ? "linked" : "—"}</td><td><Btn small onClick={() => setEdit(m)}>Edit</Btn></td></tr>)}</tbody></table></div>
      {edit && <MaterialForm m={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
function MaterialForm({ m, onClose }: { m: MaterialRow | null; onClose: () => void }) {
  const T = useT(); const save = useSave(); const { db } = useStore();
  const [f, setF] = useState({ name: m?.name ?? "", category: m?.category ?? "Other", supplier: m?.supplier ?? "", thickness_mm: m?.thickness_mm ?? null as number | null, sheet_w: m?.sheet_w ?? null as number | null, sheet_h: m?.sheet_h ?? null as number | null, stock_item_id: m?.stock_item_id ?? "", notes: m?.notes ?? "", archived: m?.archived ?? false });
  const items = db.stock_items.filter((s) => !s.archived && (s.kind === "material" || s.id === f.stock_item_id));
  const submit = async () => { const row = { ...f, stock_item_id: f.stock_item_id || null }; if (await save(() => (m ? T.sb.from("trotan_materials").update(row).eq("id", m.id) : T.sb.from("trotan_materials").insert(row)), "Material saved", "materials")) onClose(); };
  return (
    <Modal title={m ? `Edit ${m.name}` : "Add material"} onClose={onClose} foot={<><Btn onClick={onClose}>Cancel</Btn><Btn tone="primary" disabled={!f.name.trim()} onClick={submit} testid="material-save">Save</Btn></>}>
      <Text label="Name" value={f.name} onCommit={(v) => setF({ ...f, name: v })} testid="material-name" />
      <div className="t-grid2"><Text label="Category" value={f.category} onCommit={(v) => setF({ ...f, category: v })} /><Text label="Supplier" value={f.supplier} onCommit={(v) => setF({ ...f, supplier: v })} /></div>
      <div className="t-grid3"><Num label="Thickness" unit="mm" value={f.thickness_mm} min={0.001} onCommit={(v) => setF({ ...f, thickness_mm: v })} /><Num label="Sheet width" unit="mm" value={f.sheet_w} min={1} onCommit={(v) => setF({ ...f, sheet_w: v })} testid="material-w" /><Num label="Sheet height" unit="mm" value={f.sheet_h} min={1} onCommit={(v) => setF({ ...f, sheet_h: v })} testid="material-h" /></div>
      <Sel label="KORTANA stock item (one sheet = one unit)" value={f.stock_item_id} onChange={(v) => setF({ ...f, stock_item_id: v })} options={[{ value: "", label: "Not linked" }, ...items.map((s) => ({ value: s.id, label: `${s.sku} — ${s.name} (${s.quantity} ${s.unit})` }))]} />
      <Text label="Notes (hazards, handling)" value={f.notes} onCommit={(v) => setF({ ...f, notes: v })} multiline />
      <Check on={f.archived} onChange={(v) => setF({ ...f, archived: v })} label="Archived" />
      <p className="t-note">To prohibit a material, tick it under the machine's “Prohibited materials”.</p>
    </Modal>
  );
}

const STATUS_TONE: Record<ProfileStatus, "" | "ok" | "warn" | "err"> = { untested: "", testing: "warn", approved: "ok", retired: "" };
function Settings() {
  const T = useT(); const toast = useToast(); const { db } = useStore();
  const [mat, setMat] = useState(T.materials[0]?.id ?? ""); const [mac, setMac] = useState(T.machines[0]?.id ?? "");
  const [form, setForm] = useState<{ op: Exclude<OpType, "none">; params: OpParams; notes: string } | null>(null);
  const approve = T.can("approve"), admin = T.can("admin");
  const list = T.profiles.filter((p) => p.material_id === mat && p.machine_id === mac).sort((a, b) => a.operation.localeCompare(b.operation) || b.version - a.version);
  const machine = T.machines.find((m) => m.id === mac);
  const status = async (p: ProfileRow, s: ProfileStatus) => { try { await T.rpc("trotan_set_profile_status", { p_id: p.id, p_status: s }); await T.refresh("profiles"); toast(s === "approved" ? `Approved v${p.version}` : `Marked ${s}`, "ok"); } catch (e) { toast(errText(e), "error"); } };
  const create = async () => {
    if (!form || !machine) return;
    const errs = checkParams(form.op, form.params, machine.caps); if (errs.length) { toast(errs[0].msg, "error"); return; }
    const version = Math.max(0, ...T.profiles.filter((p) => p.material_id === mat && p.machine_id === mac && p.operation === form.op).map((p) => p.version)) + 1;
    try { const { error } = await T.sb.from("trotan_profiles").insert({ material_id: mat, machine_id: mac, operation: form.op, version, params: form.params, notes: form.notes }); if (error) throw new Error(error.message); await T.refresh("profiles"); toast(`Saved v${version} as untested`, "ok"); setForm(null); } catch (e) { toast(errText(e), "error"); }
  };
  return (
    <div data-testid="settings">
      <div className="t-row">
        <Sel label="Material" value={mat} onChange={setMat} options={T.materials.map((m) => ({ value: m.id, label: m.name }))} testid="settings-material" />
        <Sel label="Machine" value={mac} onChange={setMac} options={T.machines.map((m) => ({ value: m.id, label: m.name }))} />
        <Btn tone="primary" disabled={!(admin || approve) || !mat || !mac} onClick={() => setForm({ op: "cut", params: { power: NaN, speed: NaN, freq: null, passes: 1, focus: 0, dpi: machine?.caps.dpi[0] ?? 0, air: false, direction: "down", order: 0 }, notes: "" })} testid="new-settings">New settings</Btn>
      </div>
      {machine?.prohibited.includes(mat) && <p className="t-note err">This material is prohibited on {machine.name}. Settings can be recorded but jobs will be refused.</p>}
      <p className="t-note">Settings start as <b>untested</b>. Run a material test, then an authorised operator approves one version per operation. Approved settings are locked; change them by saving a new version. TROTAN does not supply power or speed values.</p>
      {!list.length && <Empty title="No settings for this material on this machine" hint="Create settings from a material test result." />}
      <div className="t-table-wrap"><table className="t-table"><thead><tr><th>Operation</th><th>Version</th><th>Power</th><th>Speed</th><th>Passes</th><th>Focus</th><th>Freq / DPI</th><th>Air</th><th>Status</th><th /></tr></thead>
        <tbody>{list.map((p) => <tr key={p.id} data-testid="profile-row"><td>{OP_LABEL[p.operation]}</td><td>v{p.version}</td><td>{p.params.power} {UNITS.power}</td><td>{p.params.speed} {UNITS.speed}</td><td>{p.params.passes}</td><td>{p.params.focus ?? 0} mm</td>
          <td>{p.params.freq ? `${p.params.freq} Hz` : ""}{p.operation === "raster" ? ` ${p.params.dpi} DPI` : ""}</td><td>{p.params.air ? "on" : "off"}</td>
          <td><Pill tone={STATUS_TONE[p.status]}>{p.status}</Pill>{p.approved_by && <small> {db.profiles.find((x) => x.id === p.approved_by)?.full_name ?? ""} {p.approved_at ? new Date(p.approved_at).toLocaleDateString("en-GB") : ""}</small>}</td>
          <td><div className="t-row">
            {p.status === "untested" && <Btn small disabled={!approve} onClick={() => status(p, "testing")}>Testing</Btn>}
            {p.status !== "approved" && p.status !== "retired" && <Btn small tone="primary" disabled={!approve} title={approve ? "Approve for production" : "Only an authorised operator can approve"} onClick={() => status(p, "approved")} testid="approve-profile">Approve</Btn>}
            {p.status !== "retired" && <Btn small disabled={!approve} onClick={() => status(p, "retired")}>Retire</Btn>}
            <Btn small disabled={!(admin || approve)} onClick={() => setForm({ op: p.operation, params: { ...p.params }, notes: `From v${p.version}` })}>New version</Btn>
          </div></td></tr>)}</tbody></table></div>
      {form && machine && <Modal title="New laser settings" onClose={() => setForm(null)} foot={<><Btn onClick={() => setForm(null)}>Cancel</Btn><Btn tone="primary" onClick={create} testid="settings-save">Save as untested</Btn></>}>
        <Sel label="Operation" value={form.op} onChange={(v) => setForm({ ...form, op: v })} options={LASER_OPS.filter((o) => machine.caps.ops.includes(o)).map((o) => ({ value: o, label: OP_LABEL[o] }))} />
        <ParamFields op={form.op} p={form.params} caps={machine.caps} onChange={(params) => setForm({ ...form, params })} />
        <Text label="Notes (test reference, observations)" value={form.notes} onCommit={(v) => setForm({ ...form, notes: v })} multiline />
        {checkParams(form.op, form.params, machine.caps).map((e, i) => <p key={i} className="t-note err">{e.msg}</p>)}
      </Modal>}
    </div>
  );
}
function ParamFields({ op, p, caps, onChange }: { op: OpType; p: OpParams; caps: MachineCaps; onChange: (p: OpParams) => void }) {
  return (
    <div className="t-grid2">
      <Num label="Power" unit={UNITS.power} value={p.power} min={0} max={100} onCommit={(v) => onChange({ ...p, power: v })} testid="param-power" />
      <Num label="Speed" unit={UNITS.speed} value={p.speed} min={0} max={op === "raster" ? caps.maxRasterSpeed : caps.maxSpeed} onCommit={(v) => onChange({ ...p, speed: v })} testid="param-speed" />
      <Num label="Passes" value={p.passes} min={1} max={caps.maxPasses} step={1} digits={0} onCommit={(v) => onChange({ ...p, passes: Math.round(v) })} />
      <Num label="Focus offset" unit="mm" value={p.focus} min={caps.focus.min} max={caps.focus.max} onCommit={(v) => onChange({ ...p, focus: v })} />
      {caps.freq && <Num label="Frequency" unit="Hz" value={p.freq} min={caps.freq.min} max={caps.freq.max} onCommit={(v) => onChange({ ...p, freq: v })} />}
      {op === "raster" && <Sel label="Resolution" value={String(p.dpi)} onChange={(v) => onChange({ ...p, dpi: Number(v) })} options={caps.dpi.map((d) => ({ value: String(d), label: `${d} DPI` }))} />}
      {caps.airAssist && <Check on={p.air} onChange={(v) => onChange({ ...p, air: v })} label="Air assist" />}
    </div>
  );
}

/** Builds a power × speed test card: one square per combination, each on its own layer carrying its settings. */
export async function testCard(o: { op: Exclude<OpType, "none">; powers: number[]; speeds: number[]; cell: number; gap: number; title: string }): Promise<Doc> {
  const font = await loadFont("Poppins");
  const lab = 3, left = 18, top = 12;
  const W = left + o.powers.length * (o.cell + o.gap) + 4, H = top + o.speeds.length * (o.cell + o.gap) + 10;
  const d = newDoc(Math.ceil(W), Math.ceil(H)); const layers: Layer[] = [{ id: "L-labels", name: "Labels (not lasered)", color: "#8e8e93", visible: true, locked: false, op: "none" }]; const objs: Obj[] = [];
  const text = (t: string, x: number, y: number, s = lab): Obj => ({ id: uid(), layer: "L-labels", kind: "text", text: t, size: s, font: "Poppins", paths: textOutline(font, t, s), m: [1, 0, 0, 1, x, y] });
  objs.push(text(o.title, 2, 1, 3.5), text(`Power ${UNITS.power} →`, left, top - 5), text(`Speed ${UNITS.speed} ↓`, 1, top - 5));
  o.speeds.forEach((s, r) => {
    objs.push(text(String(s), 1, top + r * (o.cell + o.gap) + o.cell / 2 - lab / 2));
    o.powers.forEach((p, c) => {
      const id = `L-t${r}-${c}`; const hue = Math.round((c / Math.max(1, o.powers.length)) * 300);
      layers.push({ id, name: `P${p} S${s}`, color: hslHex(hue, 70, 50 + (r % 2) * 8), visible: true, locked: false, op: o.op, params: { power: p, speed: s } });
      objs.push({ id: uid(), layer: id, kind: "rect", w: o.cell, h: o.cell, r: 0, m: [1, 0, 0, 1, left + c * (o.cell + o.gap), top + r * (o.cell + o.gap)] as Mat });
      if (r === 0) objs.push(text(String(p), left + c * (o.cell + o.gap), top - 1.5 - lab, lab));
    });
  });
  return { ...d, layers, objects: objs, guides: [] };
}
function hslHex(h: number, s: number, l: number) { s /= 100; l /= 100; const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, "0"); return `#${f(0)}${f(8)}${f(4)}`; }
const steps = (a: number, b: number, n: number) => (n <= 1 ? [a] : Array.from({ length: n }, (_, i) => Math.round((a + ((b - a) * i) / (n - 1)) * 100) / 100));

function Tests({ go }: { go: (w: "design" | "prepare") => void }) {
  const T = useT(); const S = useSession(); const toast = useToast();
  const [f, setF] = useState({ mat: T.materials[0]?.id ?? "", mac: T.machines[0]?.id ?? "", op: "cut" as Exclude<OpType, "none">, p0: 20, p1: 80, pn: 4, s0: 5, s1: 40, sn: 4, cell: 10, gap: 3 });
  const [tests, setTests] = useState<{ id: string; material_id: string; machine_id: string; operation: string; matrix: { powers: number[]; speeds: number[] }; project_id: string | null; result: string; created_at: string }[]>([]);
  const [pick, setPick] = useState<{ testId: string; power: number; speed: number } | null>(null);
  const load = () => { T.sb.from("trotan_tests").select("*").order("created_at", { ascending: false }).limit(100).then(({ data, error }) => { if (error) toast(error.message, "error"); else setTests((data ?? []) as typeof tests); }); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mat = T.materials.find((m) => m.id === f.mat), mac = T.machines.find((m) => m.id === f.mac);
  const make = async () => {
    if (!mat || !mac) return;
    if (mac.prohibited.includes(mat.id)) { toast(`${mat.name} is prohibited on ${mac.name}`, "error"); return; }
    const powers = steps(f.p0, f.p1, f.pn), speeds = steps(f.s0, f.s1, f.sn);
    if (powers.some((p) => p < 0 || p > 100) || speeds.some((s) => s <= 0 || s > (f.op === "raster" ? mac.caps.maxRasterSpeed : mac.caps.maxSpeed))) { toast("Power must be 0–100 % and speed within the machine's limits", "error"); return; }
    try {
      const doc = await testCard({ op: f.op, powers, speeds, cell: f.cell, gap: f.gap, title: `${mat.name} · ${OP_LABEL[f.op]} · ${mac.name}` });
      const { data, error } = await T.sb.from("trotan_projects").insert({ name: `Test card — ${mat.name} — ${OP_LABEL[f.op]}`, customer: "Internal", tags: ["material-test"], doc }).select("id").single();
      if (error) throw new Error(error.message);
      const pid = (data as { id: string }).id;
      const ins = await T.sb.from("trotan_tests").insert({ material_id: mat.id, machine_id: mac.id, operation: f.op, matrix: { powers, speeds, cell: f.cell }, project_id: pid }); if (ins.error) throw new Error(ins.error.message);
      await T.refresh("projects"); await S.open(pid);
      S.setPrep((p) => ({ ...p, machineId: mac.id, materialId: mat.id, test: true }));
      toast("Test card created — set the base settings in PREPARE (power and speed come from each square)", "ok"); go("prepare");
    } catch (e) { toast(errText(e), "error"); }
  };
  return (
    <div data-testid="tests">
      <p className="t-note">A test card burns a grid of squares, each with its own power and speed, so an authorised operator can judge the result on the real material. Test jobs may use unapproved settings and can only be queued by an approver.</p>
      <div className="t-grid3">
        <Sel label="Material" value={f.mat} onChange={(v) => setF({ ...f, mat: v })} options={T.materials.map((m) => ({ value: m.id, label: m.name }))} />
        <Sel label="Machine" value={f.mac} onChange={(v) => setF({ ...f, mac: v })} options={T.machines.map((m) => ({ value: m.id, label: m.name }))} />
        <Sel label="Operation" value={f.op} onChange={(v) => setF({ ...f, op: v })} options={LASER_OPS.filter((o) => mac?.caps.ops.includes(o)).map((o) => ({ value: o, label: OP_LABEL[o] }))} />
        <Num label="Power from" unit="%" value={f.p0} min={0} max={100} onCommit={(v) => setF({ ...f, p0: v })} /><Num label="Power to" unit="%" value={f.p1} min={0} max={100} onCommit={(v) => setF({ ...f, p1: v })} /><Num label="Power steps" value={f.pn} min={1} max={12} step={1} digits={0} onCommit={(v) => setF({ ...f, pn: Math.round(v) })} />
        <Num label="Speed from" unit="mm/s" value={f.s0} min={0.1} onCommit={(v) => setF({ ...f, s0: v })} /><Num label="Speed to" unit="mm/s" value={f.s1} min={0.1} onCommit={(v) => setF({ ...f, s1: v })} /><Num label="Speed steps" value={f.sn} min={1} max={12} step={1} digits={0} onCommit={(v) => setF({ ...f, sn: Math.round(v) })} />
        <Num label="Square" unit="mm" value={f.cell} min={2} max={50} onCommit={(v) => setF({ ...f, cell: v })} /><Num label="Gap" unit="mm" value={f.gap} min={0.5} max={20} onCommit={(v) => setF({ ...f, gap: v })} />
      </div>
      <Btn tone="primary" disabled={!mat || !mac} onClick={make} testid="make-test">Create test card</Btn>
      <h4>Tests</h4>
      {!tests.length && <p className="t-note">No tests yet.</p>}
      {tests.map((t) => <div key={t.id} className="t-card">
        <b>{T.materials.find((m) => m.id === t.material_id)?.name} · {OP_LABEL[t.operation as OpType]} · {T.machines.find((m) => m.id === t.machine_id)?.name}</b>
        <small>{new Date(t.created_at).toLocaleString("en-GB")} · power {t.matrix.powers.join("/")} % · speed {t.matrix.speeds.join("/")} mm/s</small>
        <Text label="Result / observations" value={t.result} multiline onCommit={async (v) => { const { error } = await T.sb.from("trotan_tests").update({ result: v }).eq("id", t.id); if (error) toast(error.message, "error"); else load(); }} />
        <div className="t-row"><Btn small onClick={() => setPick({ testId: t.id, power: t.matrix.powers[0], speed: t.matrix.speeds[0] })}>Save best square as settings…</Btn>{t.project_id && <Btn small onClick={async () => { await S.open(t.project_id!); go("design"); }}>Open card</Btn>}</div>
      </div>)}
      {pick && (() => { const t = tests.find((x) => x.id === pick.testId)!; return (
        <Modal title="Save the best square as settings" onClose={() => setPick(null)} foot={<><Btn onClick={() => setPick(null)}>Cancel</Btn><Btn tone="primary" onClick={async () => {
          const job = T.jobs.find((j) => j.test && j.project_id === t.project_id && j.status === "done"); const base = job?.ops[t.operation as OpType];
          if (!base) { toast("Run the test card to completion first — its base settings come from the finished test job", "error"); return; }
          const version = Math.max(0, ...T.profiles.filter((p) => p.material_id === t.material_id && p.machine_id === t.machine_id && p.operation === t.operation).map((p) => p.version)) + 1;
          const { error } = await T.sb.from("trotan_profiles").insert({ material_id: t.material_id, machine_id: t.machine_id, operation: t.operation, version, params: { ...base, power: pick.power, speed: pick.speed }, status: "untested", notes: `From test card ${job.number}` });
          if (error) toast(error.message, "error"); else { await T.refresh("profiles"); toast(`Saved v${version} — approve it under Laser settings`, "ok"); setPick(null); }
        }}>Save as untested</Btn></>}>
          <div className="t-grid2"><Sel label="Power" value={String(pick.power)} onChange={(v) => setPick({ ...pick, power: Number(v) })} options={t.matrix.powers.map((p) => ({ value: String(p), label: `${p} %` }))} /><Sel label="Speed" value={String(pick.speed)} onChange={(v) => setPick({ ...pick, speed: Number(v) })} options={t.matrix.speeds.map((s) => ({ value: String(s), label: `${s} mm/s` }))} /></div>
          <p className="t-note">Other values (passes, focus, air…) are taken from the finished test job.</p>
        </Modal>); })()}
    </div>
  );
}

function Audit() {
  const T = useT(); const { db } = useStore();
  const [rows, setRows] = useState<{ id: number; at: string; user_id: string | null; table_name: string; row_id: string | null; action: string; changes: Record<string, unknown> }[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { T.sb.from("audit_log").select("*").like("table_name", "trotan_%").order("at", { ascending: false }).limit(300).then(({ data, error }) => { if (error) setErr(error.message); else setRows((data ?? []) as NonNullable<typeof rows>); }); }, [T.sb]);
  if (err) return <p className="t-note err">{err}</p>;
  return (
    <div className="t-table-wrap"><table className="t-table"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr></thead>
      <tbody>{rows?.map((r) => <tr key={r.id}><td>{new Date(r.at).toLocaleString("en-GB")}</td><td>{db.profiles.find((p) => p.id === r.user_id)?.full_name ?? "system"}</td><td>{r.action} {r.table_name.replace("trotan_", "")}</td><td className="t-mono">{JSON.stringify(r.changes).slice(0, 220)}</td></tr>)}</tbody></table>
      {rows && !rows.length && <p className="t-note">No changes recorded yet.</p>}</div>
  );
}

function Diagnostics() {
  const T = useT();
  const feats = useMemo(() => [
    ["Web Workers (file import off the main thread)", typeof Worker !== "undefined"], ["Canvas 2D", !!document.createElement("canvas").getContext("2d")],
    ["Path hit-testing", typeof Path2D !== "undefined"], ["Local recovery copy", (() => { try { localStorage.setItem("trotan-t", "1"); localStorage.removeItem("trotan-t"); return true; } catch { return false; } })()],
    ["Secure random ids", typeof crypto?.randomUUID === "function"],
  ] as [string, boolean][], []);
  return (
    <div className="t-diag">
      <section><h4>Browser</h4>{feats.map(([n, ok]) => <p key={n} className={`t-note ${ok ? "" : "err"}`}>{ok ? "✓" : "✕"} {n}</p>)}</section>
      <section><h4>File formats</h4><table className="t-table"><tbody>{IMPORT_FORMATS.map((f) => <tr key={f.ext}><td>{f.ext}</td><td>{f.ok ? <Pill tone="ok">import</Pill> : <Pill>not supported</Pill>}</td><td>{f.label}</td></tr>)}
        <tr><td>Export</td><td><Pill tone="ok">export</Pill></td><td>SVG (mm), DXF R12 (mm), PNG 300 DPI, .trotan project</td></tr></tbody></table></section>
      <section><h4>Machine interfaces</h4>
        <p className="t-note">Virtual laser — simulation only, no hardware.</p>
        <p className="t-note">Real machines — no validated interface. TROTAN does not send jobs to hardware, does not reproduce any manufacturer's protocol and never bypasses interlocks.</p></section>
      <section><h4>Data</h4><p className="t-note">{T.projects.length} projects · {T.jobs.length} jobs · {T.machines.length} machines · {T.materials.length} materials · {T.profiles.length} settings</p>{T.error && <p className="t-note err">{T.error}</p>}</section>
    </div>
  );
}
