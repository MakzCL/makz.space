import { Factory, FileText, PackageCheck, Plus, Search, Send, ShoppingCart, Trash2, Truck, Undo2, Users } from "lucide-react";
import { useToast } from "../components/Toast";
import { printPurchaseOrder } from "../lib/printdoc";
import { LocationSelect } from "../components/LocationSelect";
import { useMemo, useRef, useState } from "react";
import { Badge, Btn, Chip, Empty, Field, Sheet } from "../components/ui";
import { opKey, useActions } from "../lib/actions";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { dayLabel } from "../lib/time";
import type { PoLine, PoStatus, PurchaseOrder, Supplier } from "../lib/types";
import { ItemPicker, fmtQty, money, stockLevels } from "./Inventory";

const PO_STATUS: Record<PoStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "muted" }, ordered: { label: "Ordered", tone: "blue" }, partial: { label: "Part received", tone: "moon" },
  received: { label: "Received", tone: "ok" }, cancelled: { label: "Cancelled", tone: "muted" },
};

/* ----------------------------------------------------------- purchasing -- */
export function PurchasingView() {
  const { db, me } = useStore();
  const a = useActions();
  const [open, setOpen] = useState<PurchaseOrder | null>(null);
  const [show, setShow] = useState<"open" | "all">("open");
  const lv = useMemo(() => stockLevels(db), [db]);
  const sup = new Map(db.suppliers.map((s) => [s.id, s]));
  const editable = can.editStock(me.role);
  const pos = db.purchase_orders
    .filter((p) => show === "all" || !["received", "cancelled"].includes(p.status))
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  // Reorder suggestions: (in stock − committed + expected) at or below the reorder point.
  const suggest = db.stock_items.filter((s) => !s.archived && s.min_quantity > 0)
    .map((s) => ({ s, avail: s.quantity - (lv.committed.get(s.id) ?? 0) + (lv.expected.get(s.id) ?? 0) }))
    .filter((r) => r.avail <= r.s.min_quantity)
    .sort((x, y) => (sup.get(x.s.supplier_id ?? "")?.name ?? "~").localeCompare(sup.get(y.s.supplier_id ?? "")?.name ?? "~"));
  const groups = new Map<string, typeof suggest>();
  for (const r of suggest) { const k = r.s.supplier_id ?? ""; groups.set(k, [...(groups.get(k) ?? []), r]); }

  const createFor = async (supplierId: string | null, items: typeof suggest) => {
    const po = await a.savePo({ supplier_id: supplierId }, items.map((r) => ({
      item_id: r.s.id, quantity: Math.max(1, Math.ceil(r.s.min_quantity * 2 - r.avail)), unit_cost: r.s.avg_cost ?? 0,
    })));
    if (po) setOpen(po);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="chips grow">
          <Chip on={show === "open"} onClick={() => setShow("open")}>{t("Open")}</Chip>
          <Chip on={show === "all"} onClick={() => setShow("all")}>{t("All")}</Chip>
        </div>
        {editable && <Btn tone="primary" icon={<Plus size={18} />} onClick={async () => { const po = await a.savePo({}); if (po) setOpen(po); }}>{t("New purchase order")}</Btn>}
      </div>
      {pos.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t("PO")}</th><th>{t("Supplier")}</th><th>{t("Status")}</th><th>{t("Expected")}</th><th className="num">{t("Lines")}</th><th className="num">{t("Received")}</th><th className="num">{t("Total")}</th></tr></thead>
            <tbody>
              {pos.map((p) => {
                const ls = db.po_lines.filter((l) => l.po_id === p.id);
                const total = ls.some((l) => l.unit_cost === null) ? null : ls.reduce((x, l) => x + l.quantity * (l.unit_cost ?? 0), 0);
                const q = ls.reduce((x, l) => x + l.quantity, 0), r = ls.reduce((x, l) => x + Math.min(l.received, l.quantity), 0);
                const late = p.expected_date && ["ordered", "partial"].includes(p.status) && new Date(p.expected_date + "T23:59") < new Date();
                return (
                  <tr key={p.id} onClick={() => setOpen(p)}>
                    <td><span className="code">{p.number}</span></td>
                    <td><b>{sup.get(p.supplier_id ?? "")?.name ?? "—"}</b>{p.kind === "outsourced" && <> <Badge tone="moon">{t("Outsourced")}</Badge></>}</td>
                    <td><Badge tone={PO_STATUS[p.status].tone}>{t(PO_STATUS[p.status].label)}</Badge></td>
                    <td className={late ? "red-t" : "muted"}>{p.expected_date ? dayLabel(p.expected_date) : ""}</td>
                    <td className="num muted">{ls.length}</td>
                    <td className="num muted">{q ? `${Math.round((r / q) * 100)}%` : ""}</td>
                    <td className="num">{money(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<ShoppingCart size={26} />} title={t("No open purchase orders")} />}

      {editable && suggest.length > 0 && (
        <div className="card">
          <div className="row between"><b>{t("Reorder suggestions")}</b><small className="muted">{t("Available + on order is at or below the reorder point")}</small></div>
          {[...groups.entries()].map(([sid, items]) => (
            <div key={sid} className="stack">
              <div className="row between"><span className="row gap-s"><Truck size={16} /><b>{sup.get(sid)?.name ?? t("No supplier set")}</b></span>
                <Btn small tone="soft" icon={<Plus size={15} />} onClick={() => createFor(sid || null, items)}>{t("Create PO")}</Btn></div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>SKU</th><th>{t("Item")}</th><th className="num">{t("Available + on order")}</th><th className="num">{t("Reorder at")}</th></tr></thead>
                  <tbody>{items.map((r) => (
                    <tr key={r.s.id} className="static"><td><span className="code">{r.s.sku}</span></td><td>{r.s.name}</td>
                      <td className="num red-t">{fmtQty(r.avail)} <small>{r.s.unit}</small></td><td className="num muted">{fmtQty(r.s.min_quantity)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      <PoSheet po={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function PoSheet({ po, onClose }: { po: PurchaseOrder | null; onClose: () => void }) {
  const { db, me, person } = useStore();
  const a = useActions();
  const p = po ? db.purchase_orders.find((x) => x.id === po.id) ?? po : null;
  const lines = p ? db.po_lines.filter((l) => l.po_id === p.id).sort((x, y) => x.created_at.localeCompare(y.created_at)) : [];
  const byId = new Map(db.stock_items.map((s) => [s.id, s]));
  const editable = can.editStock(me.role);
  const draft = p?.status === "draft";
  const receiving = p?.status === "ordered" || p?.status === "partial";
  const [item, setItem] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [cost, setCost] = useState("");
  const [pk, setPk] = useState(0);
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [lotIn, setLotIn] = useState<Record<string, { code: string; expiry: string }>>({});
  const [busy, setBusy] = useState("");
  // One idempotency key per line until that receipt succeeds: a double click or retry books once.
  const keys = useRef(new Map<string, string>());
  const keyOf = (id: string) => { let k = keys.current.get(id); if (!k) { k = opKey(); keys.current.set(id, k); } return k; };
  if (!p) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const base = db.company_settings[0]?.base_currency ?? "GBP";
  const cur = p.currency ?? base;
  const foreign = cur !== base;
  const fmtCost = (n: number | null) => n === null ? "—" : foreign ? `${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${cur}` : money(n);
  const hidden = lines.some((l) => l.unit_cost === null);
  const total = hidden ? null : lines.reduce((x, l) => x + l.quantity * (l.unit_cost ?? 0), 0);
  const book = async (l: (typeof lines)[number], v: number) => {
    const left = l.quantity - l.received;
    let over = false;
    if (v > left) {
      if (!window.confirm(t("That is {n} more than ordered. Receive it anyway?", { n: fmtQty(v - left) }))) return;
      over = true;
    }
    setBusy(l.id);
    const li = lotIn[l.id];
    if (await a.receive(l, v, keyOf(l.id), over, li?.code.trim() || null, li?.expiry || null)) { keys.current.delete(l.id); setRecv((r) => { const n = { ...r }; delete n[l.id]; return n; }); setLotIn((r) => { const n = { ...r }; delete n[l.id]; return n; }); }
    setBusy("");
  };
  const receiveAll = async () => { setBusy("all"); for (const l of lines) if (l.quantity > l.received && await a.receive(l, l.quantity - l.received, keyOf(l.id))) keys.current.delete(l.id); setBusy(""); };
  const reverse = async (l: (typeof lines)[number]) => {
    const v = Number(cleanNumber(window.prompt(t("Take how many back out? (received {n})", { n: fmtQty(l.received) }), String(l.received)) ?? ""));
    if (!(v > 0)) return;
    setBusy(l.id); await a.reverseReceipt(l, v); setBusy("");
  };
  return (
    <Sheet open={!!po} onClose={onClose} tall title={<span className="row gap-s"><span className="code">{p.number}</span><Badge tone={PO_STATUS[p.status].tone}>{t(PO_STATUS[p.status].label)}</Badge></span>}>
      <div className="stack">
        <div className="row end"><Btn small tone="ghost" icon={<FileText size={15} />} onClick={() => printPurchaseOrder(db, p.id, !hidden)}>{t("Print / PDF")}</Btn></div>
        <div className="row gap">
          <Field label={t("Supplier")}>
            <select value={p.supplier_id ?? ""} disabled={!editable || !draft} onChange={(e) => { const sup = db.suppliers.find((s) => s.id === e.target.value); const c = sup?.currency && sup.currency !== base ? sup.currency : null; a.savePo({ id: p.id, supplier_id: e.target.value || null, ...(c !== p.currency ? { currency: c, fx_rate: 1 } : {}) }); }}>
              <option value="">—</option>{[...db.suppliers].sort((x, y) => x.name.localeCompare(y.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={t("Type")}>
            <select value={p.kind} disabled={!editable || lines.some((l) => l.received > 0) || ["received", "cancelled"].includes(p.status)}
              onChange={(e) => { const k = e.target.value as PurchaseOrder["kind"]; const loc = db.locations.find((l) => l.kind === "partner" && !l.archived && l.supplier_id === p.supplier_id);
                a.savePo({ id: p.id, kind: k, ...(k === "outsourced" && !p.partner_location_id && loc ? { partner_location_id: loc.id } : {}), ...(k === "standard" ? { partner_location_id: null } : {}) }); }}>
              <option value="standard">{t("Buy goods")}</option><option value="outsourced">{t("Outsourced work")}</option>
            </select>
          </Field>
        </div>
        {p.kind === "outsourced" && (
          <div className="row gap">
            <Field label={t("Contractor location (holds your materials)")}>
              <select value={p.partner_location_id ?? ""} disabled={!editable || lines.some((l) => l.received > 0)} onChange={(e) => a.savePo({ id: p.id, partner_location_id: e.target.value || null })}>
                <option value="">—</option>
                {db.locations.filter((l) => l.kind === "partner" && !l.archived).sort((x, y) => Number(y.supplier_id === p.supplier_id) - Number(x.supplier_id === p.supplier_id) || x.name.localeCompare(y.name))
                  .map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </div>
        )}
        <div className="row gap">
          <Field label={t("Expected delivery")}><input type="date" value={p.expected_date ?? ""} disabled={!editable} onChange={(e) => a.savePo({ id: p.id, expected_date: e.target.value || null })} /></Field>
          <LocationSelect value={p.location_id} disabled={!editable || lines.some((l) => l.received > 0)} label={t("Receive into")} onChange={(v) => a.savePo({ id: p.id, location_id: v })} />
        </div>
        <div className="row gap">
          <Field label={t("Currency")}>
            <input value={cur} maxLength={3} disabled={!editable || !draft} key={`cur-${cur}`}
              onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (/^[A-Z]{3}$/.test(v) && v !== cur) a.savePo({ id: p.id, currency: v === base ? null : v, fx_rate: 1 }); }} />
          </Field>
          {foreign && <Field label={t("1 {c} = ? {b}", { c: cur, b: base })}>
            <input inputMode="decimal" defaultValue={p.fx_rate} key={`fx-${p.fx_rate}`} disabled={!editable || !draft}
              onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v > 0 && v !== p.fx_rate) a.savePo({ id: p.id, fx_rate: v }); }} />
          </Field>}
        </div>
        {foreign && <p className="fine">{t("Prices are in {c}. Received goods are costed in {b} at this rate (fixed once ordered).", { c: cur, b: base })}</p>}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>SKU</th><th>{t("Item")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Unit cost")}</th><th className="num">{t("Total")}</th>
              {!draft && <th className="num">{t("Received")}</th>}{receiving && editable && <th className="num">{t("Receive now")}</th>}{draft && editable && <th />}</tr></thead>
            <tbody>
              {lines.map((l) => {
                const it = byId.get(l.item_id);
                const left = Math.max(0, l.quantity - l.received);
                return (
                  <tr key={l.id} className="static">
                    <td><span className="code">{it?.sku}</span></td><td>{it?.name}</td>
                    <td className="num">{draft && editable ? <input className="cell-input" inputMode="decimal" defaultValue={l.quantity} onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v > 0 && v !== l.quantity) a.savePo({ id: p.id }, [{ id: l.id, quantity: v }]); }} /> : fmtQty(l.quantity)} <small>{it?.unit}</small></td>
                    <td className="num">{draft && editable ? <input className="cell-input" inputMode="decimal" defaultValue={l.unit_cost ?? ""} onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v >= 0 && v !== l.unit_cost) a.savePo({ id: p.id }, [{ id: l.id, unit_cost: v }]); }} /> : fmtCost(l.unit_cost)}</td>
                    <td className="num">{fmtCost(l.unit_cost === null ? null : l.quantity * l.unit_cost)}</td>
                    {!draft && <td className={`num ${left ? "" : "ok-t"}`}>{fmtQty(l.received)}
                      {editable && l.received > 0 && p.status !== "cancelled" && <button type="button" className="icon-btn subtle" disabled={!!busy} title={t("Reverse receipt")} aria-label={t("Reverse receipt")} onClick={() => reverse(l)}><Undo2 size={14} /></button>}</td>}
                    {receiving && editable && <td className="num">{left > 0 ? (<>
                      <span className="row gap-s end">
                        <input className="cell-input" inputMode="decimal" value={recv[l.id] ?? String(left)} onChange={(e) => setRecv({ ...recv, [l.id]: e.target.value })} />
                        <Btn small tone="soft" busy={busy === l.id} disabled={!!busy} onClick={() => { const v = Number(cleanNumber(recv[l.id] ?? String(left))); if (v > 0) book(l, v); }}>{t("Book in")}</Btn>
                      </span>
                      {it && it.tracking !== "none" && (
                        <span className="row gap-s end k-lotin">
                          <input className="cell-input" placeholder={it.tracking === "serial" ? t("Serial prefix") : t("Batch")} title={t("Leave empty to use the PO number")} value={lotIn[l.id]?.code ?? ""}
                            onChange={(e) => setLotIn({ ...lotIn, [l.id]: { code: e.target.value, expiry: lotIn[l.id]?.expiry ?? "" } })} />
                        </span>)}</>) : <PackageCheck size={17} className="ok-t" />}</td>}
                    {draft && editable && <td><button type="button" className="icon-btn subtle" onClick={() => a.removePoLine(l.id)} aria-label={t("Remove")}><Trash2 size={15} /></button></td>}
                  </tr>
                );
              })}
              {!lines.length && <tr className="static"><td colSpan={7} className="muted">{t("No lines yet")}</td></tr>}
            </tbody>
            {lines.length > 0 && <tfoot><tr><td colSpan={4}>{t("Total")}</td><td className="num"><b>{fmtCost(total)}</b>{foreign && total !== null && <><br /><small className="muted">≈ {money(total * p.fx_rate)}</small></>}</td>{!draft && <td />}{receiving && editable && <td />}{draft && editable && <td />}</tr></tfoot>}
          </table>
        </div>
        {p.kind === "outsourced" && <OutsourcedMaterials po={p} lines={lines} editable={editable} />}
        {draft && editable && (
          <div className="row gap">
            <div className="grow" key={pk}><ItemPicker value={item} onChange={(id) => { setItem(id); const it = db.stock_items.find((s) => s.id === id); if (it) { const ref = db.item_suppliers.find((r) => r.item_id === it.id && r.supplier_id === p.supplier_id); setCost(String(ref?.unit_cost ?? (foreign ? "" : it.avg_cost || ""))); } }} placeholder={t("Add item — type SKU or name…")} /></div>
            <input className="qty-input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t("Quantity")} />
            <input className="qty-input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={foreign ? cur : "£"} aria-label={t("Unit cost")} />
            <Btn tone="primary" icon={<Plus size={17} />} disabled={!item || !(Number(cleanNumber(qty)) > 0)} onClick={async () => {
              await a.savePo({ id: p.id }, [{ item_id: item!, quantity: Number(cleanNumber(qty)), unit_cost: Number(cleanNumber(cost) || 0) }]);
              setItem(null); setQty("1"); setCost(""); setPk((x) => x + 1);
            }}>{t("Add")}</Btn>
          </div>
        )}
        <Field label={t("Notes")}><textarea rows={2} defaultValue={p.notes} disabled={!editable} onBlur={(e) => e.target.value !== p.notes && a.savePo({ id: p.id, notes: e.target.value })} /></Field>
        {editable && (
          <div className="row gap">
            {draft && <Btn tone="primary" wide disabled={!lines.length || !p.supplier_id || (p.kind === "outsourced" && !p.partner_location_id)} icon={<ShoppingCart size={17} />} onClick={() => a.savePo({ id: p.id, status: "ordered", ordered_at: new Date().toISOString() })}>{t("Mark as ordered")}</Btn>}
            {receiving && <Btn tone="primary" wide icon={<PackageCheck size={17} />} busy={busy === "all"} disabled={!!busy} onClick={receiveAll}>{t("Receive everything")}</Btn>}
            {(draft || p.status === "ordered") && <Btn tone="ghost" onClick={() => a.savePo({ id: p.id, status: "cancelled" })}>{t("Cancel PO")}</Btn>}
          </div>
        )}
        {draft && !p.supplier_id && lines.length > 0 && <p className="hint">{t("Pick a supplier to place the order.")}</p>}
        {draft && p.kind === "outsourced" && !p.partner_location_id && <p className="hint">{t("Pick the contractor location — add one under Settings → Locations (type: Partner / contractor).")}</p>}
        <p className="fine">{t("Created")} {dayLabel(p.created_at)}{p.created_by ? ` · ${person(p.created_by)?.full_name ?? ""}` : ""}{p.ordered_at ? ` · ${t("ordered")} ${dayLabel(p.ordered_at)}` : ""}{p.received_at ? ` · ${t("received")} ${dayLabel(p.received_at)}` : ""}</p>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------- outsourced manufacturing -- */
/** OUT-02..05: the materials a contractor uses, what they hold of ours, and sending them more. */
function OutsourcedMaterials({ po, lines, editable }: { po: PurchaseOrder; lines: PoLine[]; editable: boolean }) {
  const { db, backend: B, refresh } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState<Record<string, { item: string | null; qty: string; k: number }>>({});
  const byId = new Map(db.stock_items.map((s) => [s.id, s]));
  const partner = db.locations.find((l) => l.id === po.partner_location_id);
  const at = (item: string) => db.stock_levels.find((s) => s.item_id === item && s.location_id === po.partner_location_id)?.quantity ?? 0;
  const trs = db.stock_transfers.filter((x) => x.to_location === po.partner_location_id && ["draft", "in_transit"].includes(x.status));
  const onWay = (item: string) => db.transfer_lines.filter((l) => l.item_id === item && trs.some((x) => x.id === l.transfer_id && x.status === "in_transit")).reduce((n, l) => n + l.quantity, 0);
  const err = (e: unknown) => toast(e instanceof Error ? t(e.message) : t("Something went wrong"), "error");
  const run = async (fn: () => Promise<unknown>, ...tables: Parameters<typeof refresh>[0][]) => {
    setBusy(true);
    try { await fn(); await Promise.all(["po_materials" as const, ...tables].map((x) => refresh(x))); } catch (e) { err(e); }
    setBusy(false);
  };
  const send = () => run(async () => {
    const id = await B.rpc<string>("send_po_materials", { p_po: po.id });
    if (!id) return;
    await Promise.all([refresh("stock_transfers"), refresh("transfer_lines")]);
    toast(t("Transfer drafted — dispatch it under Stock → Transfers"), "ok");
  });
  const need = new Map<string, number>();
  for (const l of lines) for (const m of db.po_materials.filter((x) => x.po_line_id === l.id)) need.set(m.item_id, (need.get(m.item_id) ?? 0) + m.quantity_per * Math.max(0, l.quantity - l.received));
  const short = [...need.entries()].some(([item, n]) => n > at(item) + onWay(item) + 0.0001);
  return (
    <div className="card stack">
      <div className="row between"><span className="row gap-s"><Factory size={16} /><b>{t("Materials the contractor uses")}</b></span>
        {partner && <small className="muted">{t("Held at {loc}", { loc: partner.name })}</small>}</div>
      {lines.map((l) => {
        const it = byId.get(l.item_id);
        const mats = db.po_materials.filter((m) => m.po_line_id === l.id);
        const fixed = l.received > 0 || !editable;
        const mat = mats.every((m) => byId.get(m.item_id)?.avg_cost != null) ? mats.reduce((n, m) => n + m.quantity_per * (byId.get(m.item_id)?.avg_cost ?? 0), 0) : null;
        const ad = add[l.id] ?? { item: null, qty: "1", k: 0 };
        return (
          <div key={l.id} className="stack">
            <small className="muted">{t("For")} <span className="code">{it?.sku}</span> {it?.name} × {fmtQty(l.quantity)}
              {mat !== null && l.unit_cost !== null && <> · {t("cost per piece ≈ {fee} fee + {mat} materials", { fee: money(l.unit_cost * po.fx_rate), mat: money(mat) })}</>}</small>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>SKU</th><th>{t("Material")}</th><th className="num">{t("Per piece")}</th><th className="num">{t("Still needed")}</th><th className="num">{t("At contractor")}</th><th className="num">{t("Used")}</th>{!fixed && <th />}</tr></thead>
                <tbody>
                  {mats.map((m) => { const mi = byId.get(m.item_id); const n = m.quantity_per * Math.max(0, l.quantity - l.received); const has = at(m.item_id);
                    return (
                      <tr key={m.id} className="static">
                        <td><span className="code">{mi?.sku}</span></td><td>{mi?.name}</td>
                        <td className="num">{fixed ? fmtQty(m.quantity_per) : <input className="cell-input" inputMode="decimal" defaultValue={m.quantity_per} key={m.quantity_per}
                          onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v >= 0 && v !== m.quantity_per) run(() => B.update("po_materials", m.id, { quantity_per: v })); }} />} <small>{mi?.unit}</small></td>
                        <td className="num">{fmtQty(n)}</td>
                        <td className={`num ${has + onWay(m.item_id) + 0.0001 < (need.get(m.item_id) ?? 0) ? "red-t" : "ok-t"}`}>{fmtQty(has)}{onWay(m.item_id) > 0 && <small className="muted"> +{fmtQty(onWay(m.item_id))} {t("on the way")}</small>}</td>
                        <td className="num muted">{fmtQty(m.consumed)}</td>
                        {!fixed && <td><button type="button" className="icon-btn subtle" disabled={busy} onClick={() => run(() => B.remove("po_materials", m.id))} aria-label={t("Remove")}><Trash2 size={15} /></button></td>}
                      </tr>);
                  })}
                  {!mats.length && <tr className="static"><td colSpan={7} className="muted">{t("No materials — this item has no recipe. Add what the contractor uses below, or leave empty if they supply everything.")}</td></tr>}
                </tbody>
              </table>
            </div>
            {!fixed && (
              <div className="row gap">
                <div className="grow" key={ad.k}><ItemPicker value={ad.item} filter={(s) => s.kind !== "service" && s.id !== l.item_id} onChange={(id) => setAdd({ ...add, [l.id]: { ...ad, item: id } })} placeholder={t("Add material — type SKU or name…")} /></div>
                <input className="qty-input" inputMode="decimal" value={ad.qty} onChange={(e) => setAdd({ ...add, [l.id]: { ...ad, qty: e.target.value } })} aria-label={t("Per piece")} />
                <Btn tone="soft" icon={<Plus size={16} />} disabled={busy || !ad.item || !(Number(cleanNumber(ad.qty)) > 0) || mats.some((m) => m.item_id === ad.item)}
                  onClick={() => run(async () => { await B.insert("po_materials", { po_line_id: l.id, item_id: ad.item!, quantity_per: Number(cleanNumber(ad.qty)) }); setAdd({ ...add, [l.id]: { item: null, qty: "1", k: ad.k + 1 } }); })}>{t("Add")}</Btn>
              </div>
            )}
          </div>
        );
      })}
      {trs.length > 0 && <small className="muted">{t("Transfers to the contractor")}: {trs.map((x) => `${x.number} (${t(x.status === "draft" ? "Draft" : "In transit")})`).join(", ")}</small>}
      {editable && po.partner_location_id && !["draft", "received", "cancelled"].includes(po.status) && (
        <div className="row gap">
          <Btn tone={short ? "primary" : "soft"} icon={<Send size={16} />} busy={busy} disabled={busy || !short} onClick={send}>{t("Send materials to contractor")}</Btn>
          <small className="muted">{short ? t("Creates a transfer of what they still need from your default location.") : t("The contractor has (or is getting) everything this order needs.")}</small>
        </div>
      )}
      <p className="fine">{t("When finished goods are booked in, these materials are used up at the contractor's location, and each piece is costed at the contractor's fee plus the materials.")}</p>
    </div>
  );
}

/* ------------------------------------------------------------ suppliers -- */
export function SuppliersView() {
  const { db, me } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Supplier | "new" | null>(null);
  const list = db.suppliers.filter((s) => !q || `${s.name} ${s.email}`.toLowerCase().includes(q.toLowerCase())).sort((x, y) => x.name.localeCompare(y.name));
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search suppliers…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {can.editStock(me.role) && <Btn tone="primary" icon={<Plus size={18} />} onClick={() => setOpen("new")}>{t("New supplier")}</Btn>}
      </div>
      {list.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t("Name")}</th><th>{t("Email")}</th><th>{t("Phone")}</th><th className="num">{t("Items")}</th><th className="num">{t("Open POs")}</th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id} onClick={() => setOpen(s)}>
                <td><b>{s.name}</b></td><td className="muted">{s.email}</td><td className="muted">{s.phone}</td>
                <td className="num muted">{db.stock_items.filter((i) => i.supplier_id === s.id && !i.archived).length}</td>
                <td className="num muted">{db.purchase_orders.filter((p) => p.supplier_id === s.id && ["draft", "ordered", "partial"].includes(p.status)).length || ""}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <Empty icon={<Users size={26} />} title={t("No suppliers yet")} hint={t("They are added automatically when you import items with a supplier column.")} />}
      <SupplierSheet s={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function SupplierSheet({ s, onClose }: { s: Supplier | "new" | null; onClose: () => void }) {
  const { me } = useStore();
  const a = useActions();
  const editable = can.editStock(me.role);
  const [f, setF] = useState<Partial<Supplier>>({});
  const [key, setKey] = useState<string | null>(null);
  const k = s === "new" ? "new" : s?.id ?? null;
  if (k !== key) { setKey(k); setF(s === "new" ? { name: "", email: "", phone: "", address: "", currency: "GBP", notes: "" } : s ? { ...s } : {}); }
  return (
    <Sheet open={!!s} onClose={onClose} title={s === "new" ? t("New supplier") : f.name}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); const id = await a.saveSupplier(f); if (id) onClose(); }}>
        <Field label={t("Name")}><input required value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!editable} /></Field>
        <div className="row gap">
          <Field label={t("Email")}><input type="email" value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} disabled={!editable} /></Field>
          <Field label={t("Phone")}><input value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={!editable} /></Field>
        </div>
        <Field label={t("Address")}><textarea rows={2} value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} disabled={!editable} /></Field>
        <Field label={t("Notes")}><textarea rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={!editable} /></Field>
        {editable && <Btn type="submit" tone="primary" wide>{t("Save")}</Btn>}
      </form>
    </Sheet>
  );
}

