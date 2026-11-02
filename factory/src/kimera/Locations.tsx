import { ArrowRight, Plus, Search, Trash2, Truck } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Btn, Empty, Field, HoldButton, Sheet } from "../components/ui";
import { opKey } from "../lib/actions";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import type { Location, StockTransfer } from "../lib/types";
import { ItemPicker, fmtQty } from "../screens/Inventory";
import { shortDate } from "./kit";

const KIND_LABEL: Record<Location["kind"], string> = { warehouse: "Warehouse", production: "Production site", partner: "Partner / contractor", transit: "In transit", wip: "Production floor" };

export { LocationSelect, placeList } from "../components/LocationSelect";
import { placeList } from "../components/LocationSelect";

/** Settings → Locations (INV-05). */
export function LocationsSettings() {
  const { db, backend: B, refresh } = useStore();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Location["kind"]>("warehouse");
  const [err, setErr] = useState("");
  const save = async (fn: () => Promise<unknown>) => {
    setErr("");
    try { await fn(); await refresh("locations"); return true; } catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); return false; }
  };
  const locs = db.locations.filter((l) => l.kind !== "transit" && l.kind !== "wip").sort((a, b) => Number(a.archived) - Number(b.archived) || Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  const qtyAt = (id: string) => db.stock_levels.filter((s) => s.location_id === id && s.quantity !== 0).length;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <p className="muted">{t("Warehouses, production sites and partner locations (e.g. a contractor holding your stock). Every stock movement records where it happened; the company total is the sum of all locations.")}</p>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Name")}</th><th>{t("Type")}</th><th className="num">{t("Items with stock")}</th><th /></tr></thead>
          <tbody>
            {locs.map((l) => (
              <tr key={l.id} className={`static ${l.archived ? "dim" : ""}`}>
                <td><input className="cell-input wide" defaultValue={l.name} key={l.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.name && save(() => B.update("locations", l.id, { name: e.target.value.trim() }))} />
                  {l.is_default && <Badge tone="ok">{t("Default")}</Badge>}</td>
                <td><select value={l.kind} onChange={(e) => save(() => B.update("locations", l.id, { kind: e.target.value as Location["kind"] }))}>
                  {(["warehouse", "production", "partner"] as const).map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}</select></td>
                <td className="num">{qtyAt(l.id) || "—"}</td>
                <td>{!l.is_default && <Btn small tone="ghost" disabled={!l.archived && qtyAt(l.id) > 0} title={qtyAt(l.id) ? t("Move or count its stock to zero first") : undefined}
                  onClick={() => save(() => B.update("locations", l.id, { archived: !l.archived }))}>{l.archived ? t("Restore") : t("Archive")}</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row gap">
        <Field label={t("New location")}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Upstairs store")} /></Field>
        <Field label={t("Type")}><select value={kind} onChange={(e) => setKind(e.target.value as Location["kind"])}>
          {(["warehouse", "production", "partner"] as const).map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}</select></Field>
        <Btn tone="primary" icon={<Plus size={16} />} disabled={!name.trim()} onClick={async () => { if (await save(() => B.insert("locations", { name: name.trim(), kind }))) setName(""); }}>{t("Add")}</Btn>
      </div>
      {err && <p className="hint red-t">{err}</p>}
    </div>
  );
}

const TR_STATUS: Record<StockTransfer["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "muted" }, in_transit: { label: "In transit", tone: "blue" }, received: { label: "Received", tone: "ok" }, cancelled: { label: "Cancelled", tone: "muted" },
};

/** Stock → Transfers (INV-06): move stock between locations with dispatch and receipt. */
export function TransfersView() {
  const { db, me, backend: B, refresh } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = can.editStock(me.role);
  const places = placeList(db.locations);
  const names = new Map(db.locations.map((l) => [l.id, l.name]));
  const rows = [...db.stock_transfers]
    .filter((x) => !q || `${x.number} ${names.get(x.from_location)} ${names.get(x.to_location)} ${x.notes}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(a.status === "received" || a.status === "cancelled") - Number(b.status === "received" || b.status === "cancelled") || b.created_at.localeCompare(a.created_at));
  const create = async () => {
    const def = places.find((l) => l.is_default) ?? places[0];
    const other = places.find((l) => l.id !== def?.id);
    if (!def || !other) return;
    setBusy(true);
    try { const r = await B.insert("stock_transfers", { from_location: def.id, to_location: other.id }); await refresh("stock_transfers"); setOpen(r.id); }
    catch (e) { alert(e instanceof Error ? t(e.message) : String(e)); }
    setBusy(false);
  };
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search transfer, location…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {editable && <Btn tone="primary" small icon={<Plus size={16} />} busy={busy} disabled={places.length < 2} title={places.length < 2 ? t("Add a second location in Settings → Locations first") : undefined} onClick={create}>{t("Transfer")}</Btn>}
      </div>
      {places.length < 2 && <p className="hint">{t("Transfers need at least two locations — add them in Settings → Locations.")}</p>}
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl k-tbl">
            <thead><tr><th>{t("Transfer")}</th><th>{t("From")}</th><th /><th>{t("To")}</th><th className="num">{t("Lines")}</th><th>{t("Status")}</th><th>{t("Created")}</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.id} onClick={() => setOpen(x.id)}>
                <td><span className="code">{x.number}</span></td><td>{names.get(x.from_location)}</td><td><ArrowRight size={14} /></td><td>{names.get(x.to_location)}</td>
                <td className="num">{db.transfer_lines.filter((l) => l.transfer_id === x.id).length}</td>
                <td><Badge tone={TR_STATUS[x.status].tone}>{t(TR_STATUS[x.status].label)}</Badge></td>
                <td className="muted">{shortDate(x.created_at)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<Truck size={28} />} title={t("No transfers yet")} hint={t("Move stock between your locations: dispatch, then receive. It counts as in transit in between.")} />}
      <TransferSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function TransferSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { db, me, backend: B, refresh } = useStore();
  const tr = id ? db.stock_transfers.find((x) => x.id === id) ?? null : null;
  const lines = tr ? db.transfer_lines.filter((l) => l.transfer_id === tr.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];
  const items = useMemo(() => new Map(db.stock_items.map((s) => [s.id, s])), [db.stock_items]);
  const [item, setItem] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [pk, setPk] = useState(0);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const key = useRef(opKey());
  const editable = can.editStock(me.role);
  const draft = tr?.status === "draft";
  const places = placeList(db.locations);
  const levelAt = (itemId: string, loc: string) => db.stock_levels.find((s) => s.item_id === itemId && s.location_id === loc)?.quantity ?? 0;
  const run = async (what: string, fn: () => Promise<unknown>, tables: Parameters<typeof refresh>[0][]) => {
    setBusy(what); setErr("");
    try { await fn(); await Promise.all(tables.map((x) => refresh(x))); key.current = opKey(); } catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); }
    setBusy("");
  };
  const post = (action: "dispatch" | "receive" | "cancel") => run(action, () => B.rpc("post_transfer", { p_id: tr!.id, p_action: action, p_key: key.current }),
    ["stock_transfers", "stock_levels", "stock_items", "stock_movements"]);
  return (
    <Sheet open={!!tr} onClose={onClose} tall title={tr && <span className="row gap-s"><span className="code">{tr.number}</span><Badge tone={TR_STATUS[tr.status].tone}>{t(TR_STATUS[tr.status].label)}</Badge></span>}>
      {tr && (
        <div className="stack">
          <div className="row gap">
            <Field label={t("From")}><select value={tr.from_location} disabled={!editable || !draft} onChange={(e) => run("loc", () => B.update("stock_transfers", tr.id, { from_location: e.target.value }), ["stock_transfers"])}>
              {places.map((l) => <option key={l.id} value={l.id} disabled={l.id === tr.to_location}>{l.name}</option>)}</select></Field>
            <Field label={t("To")}><select value={tr.to_location} disabled={!editable || !draft} onChange={(e) => run("loc", () => B.update("stock_transfers", tr.id, { to_location: e.target.value }), ["stock_transfers"])}>
              {places.map((l) => <option key={l.id} value={l.id} disabled={l.id === tr.from_location}>{l.name}</option>)}</select></Field>
            <Field label={t("Expected")}><input type="date" value={tr.expected_date ?? ""} disabled={!editable || tr.status === "received" || tr.status === "cancelled"} onChange={(e) => run("date", () => B.update("stock_transfers", tr.id, { expected_date: e.target.value || null }), ["stock_transfers"])} /></Field>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>SKU</th><th>{t("Item")}</th><th className="num">{t("Quantity")}</th>{draft && <th className="num">{t("At source")}</th>}{draft && editable && <th />}</tr></thead>
              <tbody>
                {lines.map((l) => {
                  const it = items.get(l.item_id); const have = levelAt(l.item_id, tr.from_location);
                  return (
                    <tr key={l.id} className="static">
                      <td><span className="code">{it?.sku}</span></td><td>{it?.name}</td>
                      <td className="num">{draft && editable ? <input className="cell-input" inputMode="decimal" defaultValue={l.quantity} onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v > 0 && v !== l.quantity) run("q", () => B.update("transfer_lines", l.id, { quantity: v }), ["transfer_lines"]); }} /> : fmtQty(l.quantity)} <small>{it?.unit}</small></td>
                      {draft && <td className={`num ${have < l.quantity ? "red-t" : "muted"}`}>{fmtQty(have)}</td>}
                      {draft && editable && <td><button type="button" className="icon-btn subtle" aria-label={t("Remove")} onClick={() => run("rm", () => B.remove("transfer_lines", l.id), ["transfer_lines"])}><Trash2 size={15} /></button></td>}
                    </tr>
                  );
                })}
                {!lines.length && <tr className="static"><td colSpan={5} className="muted">{t("No lines yet")}</td></tr>}
              </tbody>
            </table>
          </div>
          {draft && editable && (
            <div className="row gap">
              <div className="grow" key={pk}><ItemPicker value={item} onChange={setItem} filter={(s) => s.kind !== "service"} placeholder={t("Add item — type SKU, name or scan…")} /></div>
              <input className="qty-input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t("Quantity")} />
              <Btn tone="primary" icon={<Plus size={17} />} disabled={!item || !(Number(cleanNumber(qty)) > 0)} onClick={async () => {
                await run("add", () => B.insert("transfer_lines", { transfer_id: tr.id, item_id: item!, quantity: Number(cleanNumber(qty)) }), ["transfer_lines"]);
                setItem(null); setQty("1"); setPk((x) => x + 1);
              }}>{t("Add")}</Btn>
            </div>
          )}
          <Field label={t("Notes")}><textarea rows={2} defaultValue={tr.notes} disabled={!editable} onBlur={(e) => e.target.value !== tr.notes && run("n", () => B.update("stock_transfers", tr.id, { notes: e.target.value }), ["stock_transfers"])} /></Field>
          {err && <p className="hint red-t">{err}</p>}
          {editable && (
            <div className="row gap wrap">
              {draft && <Btn tone="primary" wide icon={<Truck size={17} />} busy={busy === "dispatch"} disabled={!lines.length || !!busy} onClick={() => post("dispatch")}>{t("Dispatch")}</Btn>}
              {tr.status === "in_transit" && <Btn tone="primary" wide busy={busy === "receive"} disabled={!!busy} onClick={() => post("receive")}>{t("Receive at {loc}", { loc: db.locations.find((l) => l.id === tr.to_location)?.name ?? "" })}</Btn>}
              {(draft || tr.status === "in_transit") && <HoldButton onConfirm={() => post("cancel")}>{tr.status === "in_transit" ? t("Hold to cancel — stock goes back") : t("Hold to cancel")}</HoldButton>}
            </div>
          )}
          <p className="fine">{t("Dispatch takes the stock out of the source; it shows as In transit until received. The company total never changes.")}
            {tr.dispatched_at && ` · ${t("dispatched")} ${shortDate(tr.dispatched_at)}`}{tr.received_at && ` · ${t("received")} ${shortDate(tr.received_at)}`}</p>
        </div>
      )}
    </Sheet>
  );
}
