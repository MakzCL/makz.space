import { CheckCircle2, ClipboardCheck, ClipboardList, PackageCheck, PackageOpen, Play, Plus, Send, Truck } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Chip, Empty, Field, Sheet } from "../components/ui";
import { opKey, useActions } from "../lib/actions";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { dayLabel } from "../lib/time";
import type { DB, Role, TableName, WhTask } from "../lib/types";
import { ItemPicker, fmtQty } from "../screens/Inventory";
import { placeList } from "../components/LocationSelect";
import { ScanButton } from "../components/Scanner";
import { hitItem, resolveCode } from "../lib/scan";

/** Last scan result shown under the Scan button. */
function ScanMsg({ m }: { m: { text: string; ok: boolean } | null }) {
  return m ? <small className={m.ok ? "ok-t" : "red-t"} role="status">{m.text}</small> : null;
}
type Msg = { text: string; ok: boolean } | null;

/* Phase 5a — warehouse tasks (WH-01/02/03/07/09). Office assigns; the assignee works the task on a phone. */

const KIND: Record<WhTask["kind"], { label: string; icon: ReactNode }> = {
  receive: { label: "Receive", icon: <PackageOpen size={16} /> },
  pick: { label: "Pick & pack", icon: <ClipboardList size={16} /> },
  ship: { label: "Ship", icon: <Send size={16} /> },
  transfer: { label: "Transfer", icon: <Truck size={16} /> },
  count: { label: "Stock count", icon: <ClipboardCheck size={16} /> },
};
const STATUS: Record<WhTask["status"], { label: string; tone: string }> = {
  open: { label: "To do", tone: "blue" }, in_progress: { label: "In progress", tone: "moon" }, done: { label: "Done", tone: "ok" }, cancelled: { label: "Cancelled", tone: "muted" },
};
const WAREHOUSE_ROLES: Role[] = ["developer", "boss", "manager", "office", "assistant"];

/** Document number a task is about (PO-…, #1043, TR-…). */
export function taskDoc(db: DB, w: WhTask) {
  if (w.kind === "receive") return db.purchase_orders.find((p) => p.id === w.source_id)?.number ?? "—";
  if (w.kind === "pick" || w.kind === "ship") return db.orders.find((o) => o.id === w.source_id)?.order_number ?? "—";
  if (w.kind === "transfer") return db.stock_transfers.find((x) => x.id === w.source_id)?.number ?? "—";
  return w.items.length ? t("{n} items", { n: w.items.length }) : t("Everything here");
}

function useTaskRun() {
  const { backend: B, refresh } = useStore();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const run = async (what: string, fn: () => Promise<unknown>, tables: TableName[]) => {
    setBusy(what); setErr("");
    try { await fn(); await Promise.all(["wh_tasks" as TableName, ...tables].map((x) => refresh(x))); return true; }
    catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); return false; }
    finally { setBusy(""); }
  };
  return { B, busy, err, run };
}

export function WarehouseTasksView() {
  const { db, me, person } = useStore();
  const admin = can.admin(me.role);
  const [show, setShow] = useState<"mine" | "open" | "done">(admin ? "open" : "mine");
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const loc = new Map(db.locations.map((l) => [l.id, l.name]));
  const tasks = db.wh_tasks
    .filter((w) => show === "done" ? ["done", "cancelled"].includes(w.status) : ["open", "in_progress"].includes(w.status))
    .filter((w) => show !== "mine" || w.assigned_to === me.id)
    .sort((a, b) => show === "done" ? (b.done_at ?? b.created_at).localeCompare(a.done_at ?? a.created_at)
      : (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.created_at.localeCompare(b.created_at));
  const mine = db.wh_tasks.filter((w) => w.assigned_to === me.id && ["open", "in_progress"].includes(w.status)).length;
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="chips grow">
          <Chip on={show === "mine"} onClick={() => setShow("mine")}>{t("My tasks")}{mine ? ` · ${mine}` : ""}</Chip>
          <Chip on={show === "open"} onClick={() => setShow("open")}>{t("All open")}</Chip>
          <Chip on={show === "done"} onClick={() => setShow("done")}>{t("Finished")}</Chip>
        </div>
        {admin && <Btn tone="primary" icon={<Plus size={17} />} onClick={() => setCreate(true)}>{t("New task")}</Btn>}
      </div>
      {tasks.length ? (
        <div className="stack">
          {tasks.map((w) => {
            const who = person(w.assigned_to);
            const late = w.due_date && ["open", "in_progress"].includes(w.status) && new Date(w.due_date + "T23:59") < new Date();
            return (
              <button type="button" key={w.id} className="card person wh-task" onClick={() => setOpen(w.id)}>
                <span className="wh-ico">{KIND[w.kind].icon}</span>
                <div className="grow">
                  <b>{t(KIND[w.kind].label)} · <span className="code">{taskDoc(db, w)}</span></b>
                  <small className="muted">{w.number} · {loc.get(w.location_id ?? "") ?? ""}{w.due_date ? <> · <span className={late ? "red-t" : ""}>{t("due {d}", { d: dayLabel(w.due_date) })}</span></> : null}{w.note ? ` · ${w.note}` : ""}</small>
                </div>
                {who ? <Avatar p={who} size={28} /> : <small className="muted">{t("Unassigned")}</small>}
                <Badge tone={STATUS[w.status].tone}>{t(STATUS[w.status].label)}</Badge>
              </button>
            );
          })}
        </div>
      ) : <Empty icon={<ClipboardCheck size={26} />} title={show === "mine" ? t("Nothing assigned to you") : t("No warehouse tasks")} hint={admin ? t("Create one for receiving, picking, shipping, a transfer or a stock count.") : undefined} />}
      <TaskSheet id={open} onClose={() => setOpen(null)} />
      <NewTaskSheet open={create} onClose={(id) => { setCreate(false); if (id) setOpen(id); }} />
    </div>
  );
}

function NewTaskSheet({ open, onClose }: { open: boolean; onClose: (id?: string) => void }) {
  const { db } = useStore();
  const { B, busy, err, run } = useTaskRun();
  const [kind, setKind] = useState<WhTask["kind"]>("receive");
  const [src, setSrc] = useState("");
  const [who, setWho] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [loc, setLoc] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [pk, setPk] = useState(0);
  const busyTask = (k: WhTask["kind"], id: string) => db.wh_tasks.some((w) => w.kind === k && w.source_id === id && ["open", "in_progress"].includes(w.status));
  const docs: { id: string; label: string }[] =
    kind === "receive" ? db.purchase_orders.filter((p) => ["ordered", "partial"].includes(p.status)).map((p) => ({ id: p.id, label: `${p.number} · ${db.suppliers.find((s) => s.id === p.supplier_id)?.name ?? ""}` }))
    : kind === "pick" || kind === "ship" ? db.orders.filter((o) => o.kind === "order" && o.status === "open" && !["shipped", "delivered"].includes(o.delivery)).map((o) => ({ id: o.id, label: `${o.order_number} · ${o.company || o.customer}` }))
    : kind === "transfer" ? db.stock_transfers.filter((x) => ["draft", "in_transit"].includes(x.status)).map((x) => ({ id: x.id, label: x.number }))
    : [];
  const staff = db.profiles.filter((p) => p.active && !p.removed_at && WAREHOUSE_ROLES.includes(p.role)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const items_ = new Map(db.stock_items.map((s) => [s.id, s]));
  const reset = () => { setSrc(""); setWho(""); setDue(""); setNote(""); setLoc(""); setItems([]); };
  const save = async () => {
    let id = "";
    const ok = await run("save", async () => {
      const r = await B.insert("wh_tasks", { kind, source_id: kind === "count" ? null : src, assigned_to: who || null, due_date: due || null, note: note.trim(),
        ...(kind === "count" ? { items, location_id: loc || null } : {}) });
      id = r.id;
    }, []);
    if (ok) { reset(); onClose(id); }
  };
  return (
    <Sheet open={open} onClose={() => onClose()} title={t("New warehouse task")}>
      <div className="stack">
        <div className="chips">{(Object.keys(KIND) as WhTask["kind"][]).map((k) => <Chip key={k} on={kind === k} onClick={() => { setKind(k); setSrc(""); }}>{t(KIND[k].label)}</Chip>)}</div>
        {kind !== "count" ? (
          <Field label={kind === "receive" ? t("Purchase order") : kind === "transfer" ? t("Transfer") : t("Sales order")}>
            <select value={src} onChange={(e) => setSrc(e.target.value)}>
              <option value="">—</option>
              {docs.map((d) => <option key={d.id} value={d.id} disabled={busyTask(kind, d.id)}>{d.label}{busyTask(kind, d.id) ? ` (${t("already assigned")})` : ""}</option>)}
            </select>
          </Field>
        ) : (
          <>
            <Field label={t("Location")}>
              <select value={loc} onChange={(e) => setLoc(e.target.value)}>
                {placeList(db.locations).map((l) => <option key={l.id} value={l.is_default ? "" : l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label={t("Items to count")} hint={t("Leave empty to count everything at this location.")}>
              <div className="stack">
                {items.length > 0 && <div className="chips">{items.map((i) => <Chip key={i} on onClick={() => setItems(items.filter((x) => x !== i))}>{items_.get(i)?.sku} ✕</Chip>)}</div>}
                <div key={pk}><ItemPicker value={null} filter={(s) => s.kind !== "service" && !items.includes(s.id)} onChange={(id) => { if (id) { setItems([...items, id]); setPk((x) => x + 1); } }} placeholder={t("Add item — type SKU or name…")} /></div>
              </div>
            </Field>
          </>
        )}
        <div className="row gap">
          <Field label={t("Assign to")}>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">{t("Unassigned")}</option>
              {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <Field label={t("Due")}><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label={t("Note")}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. DPD collects at 3")} /></Field>
        {err && <p className="hint red-t">{err}</p>}
        <Btn tone="primary" wide busy={busy === "save"} disabled={!!busy || (kind !== "count" && !src)} onClick={save}>{t("Create task")}</Btn>
      </div>
    </Sheet>
  );
}

function TaskSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { db, me, person } = useStore();
  const { B, busy, err, run } = useTaskRun();
  const w = id ? db.wh_tasks.find((x) => x.id === id) ?? null : null;
  const admin = can.admin(me.role);
  if (!w) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const live = ["open", "in_progress"].includes(w.status);
  const mine = w.assigned_to === me.id;
  const canWork = live && (mine || admin);
  const step = (action: "start" | "done" | "reopen") => run(action, () => B.rpc("wh_task_step", { p_id: w.id, p_action: action }), ["orders"]);
  const staff = db.profiles.filter((p) => p.active && !p.removed_at && WAREHOUSE_ROLES.includes(p.role)).sort((a, b) => a.full_name.localeCompare(b.full_name));
  return (
    <Sheet open={!!w} onClose={onClose} tall title={<span className="row gap-s">{KIND[w.kind].icon}<span>{t(KIND[w.kind].label)}</span><span className="code">{taskDoc(db, w)}</span><Badge tone={STATUS[w.status].tone}>{t(STATUS[w.status].label)}</Badge></span>}>
      <div className="stack">
        <div className="row gap wrap">
          {admin && live ? (
            <Field label={t("Assigned to")}>
              <select value={w.assigned_to ?? ""} onChange={(e) => run("assign", () => B.update("wh_tasks", w.id, { assigned_to: e.target.value || null }), [])}>
                <option value="">{t("Unassigned")}</option>
                {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          ) : <small className="muted">{t("Assigned to")}: <b>{person(w.assigned_to)?.full_name ?? t("Unassigned")}</b></small>}
          {w.due_date && <small className="muted">{t("due {d}", { d: dayLabel(w.due_date) })}</small>}
        </div>
        {w.note && <p className="card flat">{w.note}</p>}
        {w.kind === "receive" && <ReceiveWork w={w} canWork={canWork} />}
        {(w.kind === "pick" || w.kind === "ship") && <OrderWork w={w} canWork={canWork} onDone={() => step("done")} />}
        {w.kind === "transfer" && <TransferWork w={w} canWork={canWork} />}
        {w.kind === "count" && <CountWork w={w} canWork={canWork} />}
        {err && <p className="hint red-t">{err}</p>}
        <div className="row gap">
          {canWork && w.status === "open" && <Btn tone="soft" icon={<Play size={16} />} busy={busy === "start"} disabled={!!busy} onClick={() => step("start")}>{t("Start")}</Btn>}
          {canWork && w.kind !== "pick" && <Btn tone="primary" wide icon={<CheckCircle2 size={17} />} busy={busy === "done"} disabled={!!busy} onClick={() => step("done")}>{t("Mark done")}</Btn>}
          {admin && live && <Btn tone="ghost" disabled={!!busy} onClick={() => run("cancel", () => B.update("wh_tasks", w.id, { status: "cancelled" }), [])}>{t("Cancel task")}</Btn>}
          {admin && !live && <Btn tone="ghost" disabled={!!busy} onClick={() => step("reopen")}>{t("Reopen")}</Btn>}
        </div>
        <p className="fine">{w.number} · {t("Created")} {dayLabel(w.created_at)}{w.created_by ? ` · ${person(w.created_by)?.full_name ?? ""}` : ""}{w.done_at ? ` · ${t(w.status === "done" ? "done" : "cancelled")} ${dayLabel(w.done_at)}${w.done_by ? ` · ${person(w.done_by)?.full_name ?? ""}` : ""}` : ""}</p>
      </div>
    </Sheet>
  );
}

/** Bin and quantity of an item at the task's location. */
function useAt(locationId: string | null) {
  const { db } = useStore();
  return (item: string) => db.stock_levels.find((s) => s.item_id === item && s.location_id === locationId) ?? { quantity: 0, bin: "" };
}

function ReceiveWork({ w, canWork }: { w: WhTask; canWork: boolean }) {
  const { db } = useStore();
  const a = useActions();
  const at = useAt(w.location_id);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [hot, setHot] = useState("");
  const keys = useRef(new Map<string, string>());
  const lines = db.po_lines.filter((l) => l.po_id === w.source_id).sort((x, y) => x.created_at.localeCompare(y.created_at));
  const items = new Map(db.stock_items.map((s) => [s.id, s]));
  const scanned = useRef<Record<string, number>>({});
  const onScan = (code: string) => {
    const it = hitItem(resolveCode(db, code));
    const l = it && (lines.find((x) => x.item_id === it.id && x.quantity > x.received) ?? lines.find((x) => x.item_id === it.id));
    if (!l) { setMsg({ text: t("{c} is not on this delivery", { c: code }), ok: false }); return false; }
    const n = (scanned.current[l.id] ?? 0) + 1; scanned.current[l.id] = n;
    setQty((q) => ({ ...q, [l.id]: String(n) })); setHot(l.id);
    setMsg({ text: t("{sku}: {n} scanned", { sku: it!.sku, n }), ok: true });
    return true;
  };
  return (
    <div className="stack">
      {canWork && lines.some((l) => l.quantity > l.received) && <div className="row gap wrap"><ScanButton onCode={onScan} title={t("Scan what arrived")} hint={t("Each scan adds one to that line. Book it in when you're done.")} /><ScanMsg m={msg} /></div>}
      {lines.map((l) => {
        const it = items.get(l.item_id); const left = Math.max(0, l.quantity - l.received); const bin = at(l.item_id).bin;
        return (
          <div key={l.id} className={`card flat wh-line ${hot === l.id ? "hot" : ""}`}>
            <div className="grow"><b><span className="code">{it?.sku}</span> {it?.name}</b>
              <small className="muted">{t("{r} of {q} received", { r: fmtQty(l.received), q: fmtQty(l.quantity) })}{bin ? ` · ${t("bin")} ${bin}` : ""}</small></div>
            {left > 0 && canWork ? (
              <span className="row gap-s">
                <input className="qty-input" inputMode="decimal" value={qty[l.id] ?? String(left)} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={t("Quantity")} />
                <Btn small tone="primary" busy={busy === l.id} disabled={!!busy} onClick={async () => {
                  const v = Number(cleanNumber(qty[l.id] ?? String(left))); if (!(v > 0)) return;
                  let k = keys.current.get(l.id); if (!k) { k = opKey(); keys.current.set(l.id, k); }
                  setBusy(l.id); if (await a.receive(l, v, k, v > left)) { keys.current.delete(l.id); delete scanned.current[l.id]; setQty((q) => { const n = { ...q }; delete n[l.id]; return n; }); } setBusy("");
                }}>{t("Book in")}</Btn>
              </span>
            ) : left === 0 ? <PackageCheck size={18} className="ok-t" /> : null}
          </div>
        );
      })}
    </div>
  );
}

function OrderWork({ w, canWork, onDone }: { w: WhTask; canWork: boolean; onDone: () => Promise<unknown> }) {
  const { db } = useStore();
  const { B, busy, err, run } = useTaskRun();
  const at = useAt(w.location_id);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const key = useRef(opKey());
  const items = new Map(db.stock_items.map((s) => [s.id, s]));
  const lines = db.order_lines.filter((l) => l.order_id === w.source_id && l.quantity > l.shipped && items.get(l.item_id ?? "")?.kind !== "service")
    .sort((x, y) => (at(x.item_id ?? "").bin || "~").localeCompare(at(y.item_id ?? "").bin || "~") || x.sort - y.sort);
  const o = db.orders.find((x) => x.id === w.source_id);
  const all = lines.length > 0 && lines.every((l) => ticked[l.id]);
  const [got, setGot] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [bin, setBin] = useState("");
  const onScan = (code: string) => {
    const h = resolveCode(db, code);
    if (h.kind === "bin") { setBin(h.bin); setMsg({ text: t("Bin {b}", { b: h.bin }), ok: true }); return true; }
    const it = hitItem(h);
    const l = it && (lines.find((x) => x.item_id === it.id && (got[x.id] ?? 0) < x.quantity - x.shipped) ?? lines.find((x) => x.item_id === it.id));
    if (!l) { setMsg({ text: t("{c} is not on this order", { c: code }), ok: false }); return false; }
    const left = l.quantity - l.shipped, n = (got[l.id] ?? 0) + 1;
    if (n > left) { setMsg({ text: t("{sku}: only {n} needed", { sku: it!.sku, n: fmtQty(left) }), ok: false }); return false; }
    setGot((g) => ({ ...g, [l.id]: n }));
    if (w.kind === "ship") setQty((q) => ({ ...q, [l.id]: String(n) }));
    if (n >= left) setTicked((x) => ({ ...x, [l.id]: true }));
    setMsg({ text: `${it!.sku}: ${fmtQty(n)} / ${fmtQty(left)}`, ok: true });
    return true;
  };
  const ship = () => {
    const ls = lines.map((l) => ({ line: l.id, qty: Number(cleanNumber(qty[l.id] ?? String(l.quantity - l.shipped))) })).filter((x) => x.qty > 0);
    return run("ship", () => B.rpc("ship_lines", { p_order: w.source_id, p_lines: ls, p_key: key.current }), ["orders", "order_lines", "stock_items", "stock_levels", "stock_movements"])
      .then((ok) => { if (ok) key.current = opKey(); });
  };
  return (
    <div className="stack">
      {o && <small className="muted">{o.company || o.customer}{o.ship_to ? ` · ${o.ship_to}` : ""}{o.shipping_method ? ` · ${o.shipping_method}` : ""}</small>}
      {w.kind === "pick" && <small className="muted">{t("Sorted by bin. Tick each line as you take it off the shelf — or scan each piece.")}</small>}
      {canWork && lines.length > 0 && <div className="row gap wrap"><ScanButton onCode={onScan} title={w.kind === "pick" ? t("Scan as you pick") : t("Scan what goes in the box")} hint={t("Scan a bin label to jump to it, then each piece.")} /><ScanMsg m={msg} /></div>}
      {lines.map((l) => {
        const it = items.get(l.item_id ?? ""); const left = l.quantity - l.shipped; const here = at(l.item_id ?? "");
        return (
          <label key={l.id} className={`card flat wh-line ${ticked[l.id] ? "done" : ""} ${bin && here.bin === bin && !ticked[l.id] ? "hot" : ""}`}>
            {w.kind === "pick" && <input type="checkbox" disabled={!canWork} checked={!!ticked[l.id]} onChange={(e) => setTicked({ ...ticked, [l.id]: e.target.checked })} />}
            <div className="grow"><b><span className="code">{it?.sku ?? l.sku}</span> {it?.name ?? l.name}</b>
              <small className={here.quantity < left ? "red-t" : "muted"}>{here.bin ? `${t("bin")} ${here.bin} · ` : ""}{t("{n} on the shelf", { n: fmtQty(here.quantity) })}</small></div>
            {w.kind === "ship" && canWork
              ? <input className="qty-input" inputMode="decimal" value={qty[l.id] ?? String(left)} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={t("Quantity")} />
              : <b className="num">{got[l.id] ? `${fmtQty(got[l.id])} / ` : "× "}{fmtQty(left)}</b>}
          </label>
        );
      })}
      {!lines.length && <p className="muted">{t("Nothing left to send on this order.")}</p>}
      {err && <p className="hint red-t">{err}</p>}
      {canWork && w.kind === "pick" && <Btn tone="primary" wide icon={<PackageCheck size={17} />} disabled={!all || !!busy} onClick={onDone}>{t("Picked & packed")}</Btn>}
      {canWork && w.kind === "ship" && lines.length > 0 && <Btn tone="primary" wide icon={<Send size={17} />} busy={busy === "ship"} disabled={!!busy} onClick={ship}>{t("Ship these quantities")}</Btn>}
    </div>
  );
}

function TransferWork({ w, canWork }: { w: WhTask; canWork: boolean }) {
  const { db } = useStore();
  const { B, busy, err, run } = useTaskRun();
  const key = useRef(opKey());
  const tr = db.stock_transfers.find((x) => x.id === w.source_id);
  const items = new Map(db.stock_items.map((s) => [s.id, s]));
  const name = (id: string) => db.locations.find((l) => l.id === id)?.name ?? "";
  const bin = (item: string, loc: string) => db.stock_levels.find((s) => s.item_id === item && s.location_id === loc)?.bin ?? "";
  const [got, setGot] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<Msg>(null);
  if (!tr) return null;
  const trLines = db.transfer_lines.filter((l) => l.transfer_id === tr.id);
  const onScan = (code: string) => {
    const it = hitItem(resolveCode(db, code));
    const l = it && (trLines.find((x) => x.item_id === it.id && (got[x.id] ?? 0) < x.quantity) ?? trLines.find((x) => x.item_id === it.id));
    if (!l) { setMsg({ text: t("{c} is not on this transfer", { c: code }), ok: false }); return false; }
    const n = (got[l.id] ?? 0) + 1;
    if (n > l.quantity) { setMsg({ text: t("{sku}: only {n} needed", { sku: it!.sku, n: fmtQty(l.quantity) }), ok: false }); return false; }
    setGot((g) => ({ ...g, [l.id]: n })); setMsg({ text: `${it!.sku}: ${fmtQty(n)} / ${fmtQty(l.quantity)}`, ok: true });
    return true;
  };
  const post = (action: "dispatch" | "receive") => run(action, () => B.rpc("post_transfer", { p_id: tr.id, p_action: action, p_key: key.current }),
    ["stock_transfers", "stock_levels", "stock_items", "stock_movements"]).then((ok) => { if (ok) key.current = opKey(); });
  return (
    <div className="stack">
      <small className="muted">{name(tr.from_location)} → {name(tr.to_location)}</small>
      {canWork && ["draft", "in_transit"].includes(tr.status) && <div className="row gap wrap"><ScanButton onCode={onScan} title={t("Scan to check the goods")} /><ScanMsg m={msg} /></div>}
      {trLines.map((l) => {
        const it = items.get(l.item_id); const b = bin(l.item_id, tr.status === "draft" ? tr.from_location : tr.to_location); const n = got[l.id] ?? 0;
        return <div key={l.id} className={`card flat wh-line ${n >= l.quantity ? "done" : ""}`}><div className="grow"><b><span className="code">{it?.sku}</span> {it?.name}</b>{b && <small className="muted">{t("bin")} {b}</small>}</div><b className="num">{n ? `${fmtQty(n)} / ` : "× "}{fmtQty(l.quantity)}</b></div>;
      })}
      {err && <p className="hint red-t">{err}</p>}
      {canWork && tr.status === "draft" && <Btn tone="primary" wide icon={<Truck size={17} />} busy={busy === "dispatch"} disabled={!!busy} onClick={() => post("dispatch")}>{t("Dispatch")}</Btn>}
      {canWork && tr.status === "in_transit" && <Btn tone="primary" wide icon={<PackageCheck size={17} />} busy={busy === "receive"} disabled={!!busy} onClick={() => post("receive")}>{t("Received at {loc}", { loc: name(tr.to_location) })}</Btn>}
    </div>
  );
}

function CountWork({ w, canWork }: { w: WhTask; canWork: boolean }) {
  const { db } = useStore();
  const a = useActions();
  const [val, setVal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const levels = db.stock_levels.filter((s) => s.location_id === w.location_id);
  const ids = [...new Set([...(w.items.length ? w.items : levels.filter((s) => s.quantity !== 0).map((s) => s.item_id)), ...extra])];
  const onScan = (code: string) => {
    const it = hitItem(resolveCode(db, code));
    if (!it || it.kind === "service") { setMsg({ text: t("{c} is not a stock item", { c: code }), ok: false }); return false; }
    if (!ids.includes(it.id)) setExtra((x) => [...x, it.id]);
    setSaved((x) => ({ ...x, [it.id]: false }));
    let n = 0; setVal((v) => { n = Number(cleanNumber(v[it.id] ?? "0")) + 1; return { ...v, [it.id]: String(n) }; });
    setMsg({ text: t("{sku} +1", { sku: it.sku }), ok: true });
    return true;
  };
  const items = new Map(db.stock_items.map((s) => [s.id, s]));
  const rows = ids.map((id) => ({ it: items.get(id), lv: levels.find((s) => s.item_id === id) })).filter((r) => r.it)
    .sort((x, y) => (x.lv?.bin || "~").localeCompare(y.lv?.bin || "~") || x.it!.sku.localeCompare(y.it!.sku));
  const def = db.locations.find((l) => l.id === w.location_id)?.is_default;
  return (
    <div className="stack">
      <small className="muted">{t("Count what is physically there. Saving books the difference as a stock count.")}</small>
      {canWork && <div className="row gap wrap"><ScanButton onCode={onScan} title={t("Scan to count")} hint={t("Each scan adds one. Items not on the list are added.")} /><ScanMsg m={msg} /></div>}
      {rows.map(({ it, lv }) => (
        <div key={it!.id} className={`card flat wh-line ${saved[it!.id] ? "done" : ""}`}>
          <div className="grow"><b><span className="code">{it!.sku}</span> {it!.name}</b>
            <small className="muted">{lv?.bin ? `${t("bin")} ${lv.bin} · ` : ""}{t("system says {n}", { n: fmtQty(lv?.quantity ?? 0) })}</small></div>
          {canWork && (
            <span className="row gap-s">
              <input className="qty-input" inputMode="decimal" placeholder={t("Counted")} value={val[it!.id] ?? ""} onChange={(e) => setVal({ ...val, [it!.id]: e.target.value })} aria-label={t("Counted")} />
              <Btn small tone="soft" busy={busy === it!.id} disabled={!!busy || val[it!.id] === undefined || val[it!.id] === ""} onClick={async () => {
                setBusy(it!.id);
                const ok = await a.countStock(it!, Number(cleanNumber(val[it!.id])), `${w.number}`, def ? null : w.location_id);
                if (ok) setSaved({ ...saved, [it!.id]: true });
                setBusy("");
              }}>{t("Save")}</Btn>
            </span>
          )}
        </div>
      ))}
      {!rows.length && <p className="muted">{t("Nothing in stock at this location.")}</p>}
    </div>
  );
}
