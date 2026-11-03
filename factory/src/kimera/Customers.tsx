import { Plus, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Btn, Empty, Field, Sheet } from "../components/ui";
import { download, toCsv } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import type { Customer, DB, Order } from "../lib/types";
import { money } from "../screens/Inventory";
import { useKimera } from "./actions";
import { Pill, shortDate } from "./kit";
import { orderTotals } from "./status";

/** Customers with their order history (CAT-04). Orders link here automatically. */
export function CustomersView({ onOrder }: { onOrder: (id: string) => void }) {
  const { db, me } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Customer | "new" | null>(null);
  const editable = can.admin(me.role);
  const stats = useMemo(() => customerStats(db), [db]);
  const rows = db.customers
    .filter((c) => !c.archived)
    .filter((c) => !q || `${c.name} ${c.company} ${c.email} ${c.phone}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (stats.get(b.id)?.last ?? "").localeCompare(stats.get(a.id)?.last ?? "") || a.name.localeCompare(b.name));
  return (
    <>
      <div className="toolbar">
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search name, company, e-mail…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <small className="muted">{t("{n} customers", { n: rows.length })}</small>
        <Btn tone="soft" onClick={() => download(`customers-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
          ["Name", "Company", "Email", "Phone", "Address", "Orders", "Sales", "Last order"],
          rows.map((c) => { const s = stats.get(c.id); return [c.name, c.company, c.email, c.phone, c.address, s?.orders ?? 0, (s?.sales ?? 0).toFixed(2), s?.last?.slice(0, 10) ?? ""]; })))}>{t("Export")}</Btn>
        {editable && <Btn tone="primary" small icon={<Plus size={16} />} onClick={() => setOpen("new")}>{t("Customer")}</Btn>}
      </div>
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl k-tbl">
            <thead><tr><th>{t("Customer")}</th><th>{t("E-mail")}</th><th className="num">{t("Orders")}</th><th className="num">{t("Open")}</th><th className="num">{t("Sales")}</th><th>{t("Last order")}</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const s = stats.get(c.id);
                return (
                  <tr key={c.id} onClick={() => setOpen(c)}>
                    <td><b>{c.name}</b>{c.company && <small className="muted"> · {c.company}</small>}</td>
                    <td className="muted">{c.email || "—"}</td>
                    <td className="num">{s?.orders ?? 0}</td>
                    <td className="num">{s?.open || ""}</td>
                    <td className="num">{money(s?.sales ?? 0)}</td>
                    <td className="muted nowrap">{shortDate(s?.last) || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<Users size={28} />} title={q ? t("No customers match") : t("No customers yet")} hint={t("Customers are added automatically from every new order.")} />}
      <CustomerSheet customer={open} onClose={() => setOpen(null)} onOrder={(id) => { setOpen(null); onOrder(id); }} />
    </>
  );
}

export function customerStats(db: DB) {
  const lines = new Map<string, DB["order_lines"]>();
  for (const l of db.order_lines) lines.set(l.order_id, [...(lines.get(l.order_id) ?? []), l]);
  const out = new Map<string, { orders: number; open: number; sales: number; last: string | null }>();
  for (const o of db.orders) {
    if (!o.customer_id || o.kind !== "order" || o.status === "cancelled") continue;
    const s = out.get(o.customer_id) ?? { orders: 0, open: 0, sales: 0, last: null };
    s.orders += 1;
    if (o.status === "open") s.open += 1;
    s.sales += o.total_price ?? orderTotals(o, lines.get(o.id) ?? []).gross;
    const d = o.ordered_at ?? o.created_at;
    if (!s.last || d > s.last) s.last = d;
    out.set(o.customer_id, s);
  }
  return out;
}

function CustomerSheet({ customer, onClose, onOrder }: { customer: Customer | "new" | null; onClose: () => void; onOrder: (id: string) => void }) {
  const { db, me } = useStore();
  const k = useKimera();
  const editable = can.admin(me.role);
  const isNew = customer === "new";
  const c = customer && !isNew ? db.customers.find((x) => x.id === customer.id) ?? customer : null;
  const [f, setF] = useState<Partial<Customer>>({});
  const [busy, setBusy] = useState(false);
  const val = (key: keyof Customer) => (f[key] ?? c?.[key] ?? "") as string;
  const orders: Order[] = c ? db.orders.filter((o) => o.customer_id === c.id).sort((a, b) => (b.ordered_at ?? b.created_at).localeCompare(a.ordered_at ?? a.created_at)) : [];
  const close = () => { setF({}); onClose(); };
  const input = (key: keyof Customer, label: string, type = "text") => (
    <Field label={label}><input type={type} value={val(key)} disabled={!editable} onChange={(e) => setF({ ...f, [key]: e.target.value })} required={key === "name"} /></Field>
  );
  const rates = db.tax_rates.filter((r) => !r.archived);
  return (
    <Sheet open={!!customer} onClose={close} tall title={isNew ? t("New customer") : c?.name}>
      {customer && (
        <form className="stack" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          const r = await k.saveCustomer(isNew ? { name: "", ...f } : { id: c!.id, ...f });
          setBusy(false);
          if (r) { setF({}); if (isNew) close(); }
        }}>
          <div className="row gap">{input("name", t("Name"))}{input("company", t("Company"))}</div>
          <div className="row gap">{input("email", t("E-mail"), "email")}{input("phone", t("Phone"))}</div>
          <Field label={t("Ship to")}><textarea rows={2} value={val("address")} disabled={!editable} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label={t("Tax on their orders")}>
            <select value={(f.tax_rate_id !== undefined ? f.tax_rate_id : c?.tax_rate_id) ?? ""} disabled={!editable} onChange={(e) => setF({ ...f, tax_rate_id: e.target.value || null })}>
              <option value="">{t("Company default")}</option>
              {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label={t("Price list")}>
            <select value={(f.price_list_id !== undefined ? f.price_list_id : c?.price_list_id) ?? ""} disabled={!editable} onChange={(e) => setF({ ...f, price_list_id: e.target.value || null })} data-testid="customer-price-list">
              <option value="">{t("Standard prices")}</option>
              {db.price_lists.filter((l) => !l.archived || l.id === c?.price_list_id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label={t("Notes")}><textarea rows={2} value={val("notes")} disabled={!editable} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          {editable && (isNew || Object.keys(f).length > 0) && <Btn type="submit" tone="primary" wide busy={busy}>{isNew ? t("Add customer") : t("Save changes")}</Btn>}
          {!isNew && (
            <>
              <small className="label">{t("Order history")}</small>
              {orders.length ? (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th>{t("Date")}</th><th>{t("Order #")}</th><th className="num">{t("Amount")}</th><th>{t("Status")}</th></tr></thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} onClick={() => onOrder(o.id)}>
                          <td className="muted nowrap">{shortDate(o.ordered_at ?? o.created_at)}</td>
                          <td><span className="code">{o.order_number}</span>{o.kind === "quote" && <Badge tone="muted">{t("Quote")}</Badge>}</td>
                          <td className="num">{money(o.total_price ?? orderTotals(o, db.order_lines.filter((l) => l.order_id === o.id)).gross)}</td>
                          <td><Pill cell={o.status === "cancelled" ? { label: "Cancelled", tone: "none" } : o.status === "done" ? { label: "Done", tone: "ok" } : { label: "Open", tone: "info" }} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="muted">{t("No orders yet")}</p>}
            </>
          )}
        </form>
      )}
    </Sheet>
  );
}

/** Type-ahead over existing customers; picking one returns it. */
export function CustomerPicker({ value, onPick, onText }: { value: string; onPick: (c: Customer) => void; onText: (v: string) => void }) {
  const { db } = useStore();
  const [id] = useState(() => `cust-${Math.random().toString(36).slice(2)}`);
  const label = (c: Customer) => `${c.name}${c.company ? ` · ${c.company}` : ""}${c.email ? ` <${c.email}>` : ""}`;
  const list = db.customers.filter((c) => !c.archived);
  return (
    <>
      <input required autoFocus list={id} value={value} placeholder={t("Name — or pick an existing customer")}
        onChange={(e) => { const v = e.target.value; const hit = list.find((c) => label(c) === v); if (hit) onPick(hit); else onText(v); }} />
      <datalist id={id}>{list.slice(0, 1000).map((c) => <option key={c.id} value={label(c)} />)}</datalist>
    </>
  );
}
