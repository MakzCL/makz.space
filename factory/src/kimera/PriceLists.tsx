// Price lists (Katana-style customer pricing): a list holds item prices with optional quantity breaks; a customer's
// list sets the default price of their sales-order lines. Server-side twin: public.price_for().
import { Plus, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Btn, Empty, Field } from "../components/ui";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import type { DB } from "../lib/types";
import { ItemPicker, money } from "../screens/Inventory";

/** Same rule as public.price_for: largest quantity break not above the quantity on the customer's (active) list, else the sale price. */
export function priceFor(db: DB, customerId: string | null | undefined, itemId: string, qty = 1): number | null {
  const c = customerId ? db.customers.find((x) => x.id === customerId) : null;
  const list = c?.price_list_id ? db.price_lists.find((l) => l.id === c.price_list_id && !l.archived) : null;
  if (list) {
    const hit = db.price_list_items.filter((p) => p.price_list_id === list.id && p.item_id === itemId && p.min_qty <= Math.max(qty, 0.001)).sort((a, b) => b.min_qty - a.min_qty)[0];
    if (hit) return hit.price;
  }
  return db.stock_items.find((s) => s.id === itemId)?.sale_price ?? null;
}

export function PriceListsView() {
  const { db, me, backend: B, refresh } = useStore();
  const editable = can.admin(me.role);
  const [sel, setSel] = useState<string | null>(null); const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await Promise.all([refresh("price_lists"), refresh("price_list_items"), refresh("customers")]); return true; } catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); return false; } };
  const lists = [...db.price_lists].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  const cur = lists.find((l) => l.id === sel) ?? lists.find((l) => !l.archived) ?? null;
  return (
    <div className="stack" data-testid="price-lists">
      <div className="row gap wrap">
        {lists.map((l) => <button type="button" key={l.id} className={`chip ${cur?.id === l.id ? "on" : ""}`} onClick={() => setSel(l.id)}>{l.name}{l.archived && <Badge>{t("Archived")}</Badge>}<small className="muted"> · {db.customers.filter((c) => c.price_list_id === l.id).length}</small></button>)}
        {editable && <span className="row gap-s"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("New price list, e.g. Trade")} aria-label={t("Price list name")} data-testid="pl-name" />
          <Btn tone="soft" small icon={<Plus size={15} />} disabled={!name.trim()} onClick={async () => { const r = await run(async () => { const x = await B.insert("price_lists", { name: name.trim() }); setSel(x.id); }); if (r) setName(""); }}>{t("Add")}</Btn></span>}
      </div>
      {err && <p className="err">{err}</p>}
      {!cur ? <Empty icon={<Tags size={28} />} title={t("No price lists yet")} hint={t("Give trade customers or distributors their own prices: make a list, add items, then choose the list on the customer.")} /> : <PriceListEditor id={cur.id} editable={editable} run={run} />}
    </div>
  );
}

function PriceListEditor({ id, editable, run }: { id: string; editable: boolean; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const { db, backend: B } = useStore();
  const list = db.price_lists.find((l) => l.id === id)!; const byId = new Map(db.stock_items.map((s) => [s.id, s]));
  const rows = db.price_list_items.filter((p) => p.price_list_id === id).sort((a, b) => (byId.get(a.item_id)?.sku ?? "").localeCompare(byId.get(b.item_id)?.sku ?? "") || a.min_qty - b.min_qty);
  const [item, setItem] = useState<string | null>(null); const [qty, setQty] = useState("1"); const [price, setPrice] = useState(""); const [k, setK] = useState(0);
  const customers = db.customers.filter((c) => c.price_list_id === id);
  return (
    <div className="card stack">
      <div className="row between wrap"><b>{list.name}</b><span className="row gap-s">
        <small className="muted">{list.currency}</small>
        {editable && <Btn small tone="ghost" onClick={() => run(() => B.update("price_lists", id, { archived: !list.archived }))}>{list.archived ? t("Restore") : t("Archive")}</Btn>}
      </span></div>
      <small className="muted">{customers.length ? t("Used by {n}", { n: customers.map((c) => c.name).join(", ") }) : t("No customers use this list yet: choose it on a customer.")}</small>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>SKU</th><th>{t("Item")}</th><th className="num">{t("From qty")}</th><th className="num">{t("Price")}</th><th className="num">{t("Sale price")}</th><th /></tr></thead>
        <tbody>{rows.map((r) => { const it = byId.get(r.item_id); return (
          <tr key={r.id} className="static"><td><span className="code">{it?.sku}</span></td><td>{it?.name}</td><td className="num">{r.min_qty}</td>
            <td className="num">{editable ? <input className="cell-input" inputMode="decimal" defaultValue={r.price} key={`${r.id}-${r.price}`} onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v >= 0 && e.target.value !== "" && v !== r.price) run(() => B.update("price_list_items", r.id, { price: v })); }} /> : money(r.price)}</td>
            <td className="num muted">{money(it?.sale_price ?? null)}</td>
            <td>{editable && <button type="button" className="icon-btn subtle" aria-label={t("Remove")} onClick={() => run(() => B.remove("price_list_items", r.id))}><Trash2 size={14} /></button>}</td></tr>); })}
          {!rows.length && <tr className="static"><td colSpan={6} className="muted">{t("No prices yet")}</td></tr>}</tbody>
      </table></div>
      {editable && <div className="row gap wrap">
        <div className="grow" key={k}><ItemPicker value={item} onChange={(v) => { setItem(v); const s = db.stock_items.find((x) => x.id === v); if (s?.sale_price != null) setPrice(String(s.sale_price)); }} filter={(s) => s.kind !== "material"} /></div>
        <Field label={t("From qty")}><input className="qty-input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="pl-qty" /></Field>
        <Field label={t("Price")}><input className="qty-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="pl-price" /></Field>
        <Btn tone="primary" small icon={<Plus size={15} />} disabled={!item || !(Number(cleanNumber(qty)) > 0) || price === "" || !(Number(cleanNumber(price)) >= 0)}
          onClick={async () => { const ok = await run(() => B.insert("price_list_items", { price_list_id: id, item_id: item!, min_qty: Number(cleanNumber(qty)), price: Number(cleanNumber(price)) })); if (ok) { setItem(null); setQty("1"); setPrice(""); setK((x) => x + 1); } }}>{t("Add price")}</Btn>
      </div>}
    </div>
  );
}
