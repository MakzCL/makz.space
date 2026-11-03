import { ArrowRightLeft, ClipboardList, FileText, ChevronDown, ChevronUp, Download, Factory, PackageCheck, Plus, Search, ShoppingCart, Trash2, Truck, Undo2 } from "lucide-react";
import { useAvailability } from "./availability";
import { LocationSelect } from "../components/LocationSelect";
import { useMemo, useState } from "react";
import { Badge, Btn, Empty, Field, HoldButton, Segmented, Sheet } from "../components/ui";
import { opKey } from "../lib/actions";
import { cleanNumber, download, toCsv } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import type { DeliveryState, Order } from "../lib/types";
import { ItemPicker, fmtQty, money } from "../screens/Inventory";
import { jobCode } from "../screens/parts";
import { useKimera } from "./actions";
import { Channel, PageHead, Pill, SubTabs, fullDate, shortDate } from "./kit";
import { CustomerPicker, CustomersView } from "./Customers";
import { PriceListsView, priceFor } from "./PriceLists";
import { analyse, orderTotals, type OrderInfo } from "./status";
import { printPackingSlip, printPickList } from "../lib/printdoc";

type Kind = "order" | "quote" | "customers" | "prices";
type OrderKind = "order" | "quote";

export function Sell({ openId, onOpen, kind, setKind, creating, setCreating }: {
  openId: string | null; onOpen: (id: string | null) => void; kind: Kind; setKind: (k: Kind) => void; creating: OrderKind | null; setCreating: (k: OrderKind | null) => void;
}) {
  const { db, me } = useStore();
  const [done, setDone] = useState(false);
  const [q, setQ] = useState("");
  const av = useAvailability();
  const info = useMemo(() => analyse(db, av), [db, av]);
  const rows = [...info.values()]
    .filter((x) => x.order.kind === kind)
    .filter((x) => (done ? x.order.status !== "open" : x.order.status === "open"))
    .filter((x) => !q || `${x.order.order_number} ${x.order.customer} ${x.order.company} ${x.order.email} ${x.lines.map((l) => `${l.line.sku} ${l.line.name}`).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => done ? (b.order.ordered_at ?? b.order.created_at).localeCompare(a.order.ordered_at ?? a.order.created_at) : (a.rank ?? 0) - (b.rank ?? 0) || b.order.created_at.localeCompare(a.order.created_at));
  const openCount = (kk: OrderKind) => db.orders.filter((o) => o.kind === kk && o.status === "open").length;
  const editable = can.admin(me.role);
  const total = rows.reduce((x, r) => x + (r.amount ?? 0), 0);

  const k = useKimera();
  return (
    <div className="k-page">
      <PageHead title={t("Sell")}
        tabs={<SubTabs value={kind} onChange={setKind} tabs={[{ value: "quote", label: t("Quotes"), count: openCount("quote") }, { value: "order", label: t("Sales orders"), count: openCount("order") }, { value: "customers", label: t("Customers") }, { value: "prices", label: t("Price lists") }]} />}
        actions={editable && kind !== "customers" && kind !== "prices" && <Btn tone="primary" small icon={<Plus size={16} />} onClick={() => setCreating(kind)}>{kind === "quote" ? t("Quote") : t("Sales order")}</Btn>} />
      {kind === "prices" ? <PriceListsView /> : kind === "customers" ? <CustomersView onOrder={(id) => { const o = db.orders.find((x) => x.id === id); if (o) setKind(o.kind); onOpen(id); }} /> : <>
      <div className="toolbar">
        <Segmented size="s" value={done ? "done" : "open"} onChange={(v) => setDone(v === "done")} options={[{ value: "open", label: t("Open") }, { value: "done", label: t("Done") }]} />
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search order, customer, SKU…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <small className="muted">{t("{n} orders", { n: rows.length })} · <b>{money(total)}</b></small>
        <Btn tone="soft" icon={<Download size={17} />} onClick={() => download(`${kind}s-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
          ["Rank", "Created", "Order", "Customer", "Amount", "Deadline", "Sales items", "Ingredients", "Production", "Delivery", "Channel"],
          rows.map((r) => [r.rank ?? "", (r.order.ordered_at ?? r.order.created_at).slice(0, 10), r.order.order_number, r.order.customer, r.amount ?? "", r.order.delivery_deadline ?? "",
            r.sales.label, r.ingredients.label, r.production.label, r.delivery.label, r.order.source])))}>{t("Export")}</Btn>
      </div>
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl k-tbl">
            <thead><tr>
              {!done && kind === "order" && <th className="num">{t("Rank")}</th>}
              <th>{t("Created")}</th><th>{kind === "quote" ? t("Quote #") : t("Order #")}</th><th>{t("Customer")}</th><th className="num">{t("Amount")}</th>
              {kind === "order" && <th>{t("Deadline")}</th>}
              <th>{t("Sales items")}</th>
              {kind === "order" && <><th>{t("Ingredients")}</th><th>{t("Production")}</th><th>{t("Delivery")}</th></>}
              <th />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.order.id} onClick={() => onOpen(r.order.id)} className={r.order.status === "cancelled" ? "dim" : ""}>
                  {!done && kind === "order" && <td className="num muted nowrap">{editable && !q ? (() => {
                    const i = rows.indexOf(r);
                    return <span className="k-rank">
                      <button type="button" className="icon-btn subtle" disabled={i === 0} aria-label={t("Move up")} title={t("Higher priority")}
                        onClick={(e) => { e.stopPropagation(); k.setRank("order", r.order.id, rows[i - 1]!.order.id); }}><ChevronUp size={14} /></button>
                      {r.rank}
                      <button type="button" className="icon-btn subtle" disabled={i === rows.length - 1} aria-label={t("Move down")} title={t("Lower priority")}
                        onClick={(e) => { e.stopPropagation(); k.setRank("order", r.order.id, rows[i + 2]?.order.id ?? null); }}><ChevronDown size={14} /></button>
                    </span>;
                  })() : r.rank}</td>}
                  <td className="muted nowrap">{shortDate(r.order.ordered_at ?? r.order.created_at)}</td>
                  <td><span className="code">{r.order.order_number}</span></td>
                  <td><b>{r.order.customer || "—"}</b>{r.order.company && <small className="muted"> · {r.order.company}</small>}</td>
                  <td className="num">{money(r.amount)}</td>
                  {kind === "order" && <td className={`nowrap ${r.late ? "red-t" : "muted"}`}>{shortDate(r.order.delivery_deadline) || "—"}</td>}
                  <td><Pill cell={r.sales} /></td>
                  {kind === "order" && <>
                    <td><Pill cell={r.ingredients} /></td>
                    <td><Pill cell={r.production} onClick={r.production.action === "make" && editable ? () => onOpen(r.order.id) : undefined} /></td>
                    <td><Pill cell={r.order.status === "cancelled" ? { label: "Cancelled", tone: "none" } : r.delivery} /></td>
                  </>}
                  <td><Channel source={r.order.source} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<ShoppingCart size={28} />} title={done ? t("Nothing done yet") : kind === "quote" ? t("No open quotes") : t("No open sales orders")}
          hint={kind === "order" && !done ? t("Shopify orders land here automatically.") : undefined} />}
      </>}
      <NewOrderSheet kind={creating} onClose={() => setCreating(null)} onMade={(o) => { setCreating(null); onOpen(o.id); }} />
      <OrderSheet info={openId ? info.get(openId) ?? null : null} onClose={() => onOpen(null)} />
    </div>
  );
}

function NewOrderSheet({ kind, onClose, onMade }: { kind: OrderKind | null; onClose: () => void; onMade: (o: Order) => void }) {
  const k = useKimera();
  const blank = { customer: "", company: "", email: "", phone: "", ship_to: "", delivery_deadline: "", customer_id: null as string | null };
  const { db } = useStore();
  const [f, setF] = useState(blank);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={!!kind} onClose={onClose} title={kind === "quote" ? t("New quote") : t("New sales order")}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        const miss = (db.company_settings[0]?.order_fields ?? []).find((x) => x.required && !custom[x.key]?.trim());
        if (miss) { window.alert(t("Fill in {f}", { f: miss.label })); return; }
        const o = await k.createOrder(kind!, { ...f, delivery_deadline: f.delivery_deadline || null, custom });
        setBusy(false);
        if (o) { setF(blank); onMade(o); }
      }}>
        <div className="row gap">
          <Field label={t("Customer")}><CustomerPicker value={f.customer}
            onPick={(c) => setF({ ...f, customer: c.name, company: c.company, email: c.email, phone: c.phone, ship_to: c.address, customer_id: c.id })}
            onText={(v) => setF({ ...f, customer: v, customer_id: null })} /></Field>
          <Field label={t("Company")}><input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
        </div>
        <div className="row gap">
          <Field label={t("Email")}><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t("Phone")}><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label={t("Ship to")}><textarea rows={2} value={f.ship_to} onChange={(e) => setF({ ...f, ship_to: e.target.value })} /></Field>
        <Field label={t("Delivery deadline")}><input type="date" value={f.delivery_deadline} onChange={(e) => setF({ ...f, delivery_deadline: e.target.value })} /></Field>
        <CustomInputs values={custom} onChange={setCustom} />
        <Btn type="submit" tone="primary" wide busy={busy}>{t("Create and add items")}</Btn>
      </form>
    </Sheet>
  );
}

const DELIVERY: { value: DeliveryState; label: string }[] = [
  { value: "not_shipped", label: "Not shipped" }, { value: "packed", label: "Packed" }, { value: "shipped", label: "Shipped" }, { value: "delivered", label: "Delivered" },
];

export function OrderSheet({ info, onClose }: { info: OrderInfo | null; onClose: () => void }) {
  const { db, me } = useStore();
  const k = useKimera();
  const editable = can.admin(me.role);
  const [item, setItem] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [pickKey, setPickKey] = useState(0);
  const o = info?.order;
  const field = (key: keyof Order, label: string, type = "text") => (
    <Field label={label}>
      <input type={type} defaultValue={(o?.[key] as string | null) ?? ""} disabled={!editable} key={`${o?.id}-${key}-${String(o?.[key])}`}
        onBlur={(e) => { const v = e.target.value; if (o && v !== ((o[key] as string | null) ?? "")) k.updateOrder(o.id, { [key]: type === "date" ? v || null : v } as Partial<Order>); }} />
    </Field>
  );
  const picked = db.stock_items.find((s) => s.id === item);
  return (
    <Sheet open={!!info} onClose={onClose} tall title={o && (
      <span className="row gap-s"><span className="code">{o.order_number}</span>{o.customer}<Channel source={o.source} />
        {o.status !== "open" && <Badge tone={o.status === "done" ? "ok" : "muted"}>{o.status === "done" ? t("Done") : t("Cancelled")}</Badge>}</span>)}>
      {info && o && (
        <div className="stack">
          {o.kind === "order" && o.status !== "cancelled" && <div className="row end gap-s">
            <Btn small tone="ghost" icon={<ClipboardList size={15} />} onClick={() => printPickList(db, o.id)}>{t("Pick list")}</Btn>
            <Btn small tone="ghost" icon={<FileText size={15} />} onClick={() => printPackingSlip(db, o.id)}>{t("Packing slip")}</Btn>
          </div>}
          <div className="tri">
            <div className="hl"><small>{t("Amount")}</small><b>{money(info.amount)}</b><em>{o.currency}</em></div>
            <div><small>{o.kind === "quote" ? t("Created") : t("Ordered")}</small><b>{fullDate(o.ordered_at ?? o.created_at)}</b><em>{o.source === "shopify" ? "Shopify" : "Kortana"}</em></div>
            <div><small>{t("Deadline")}</small><b className={info.late ? "red-t" : ""}>{fullDate(o.delivery_deadline)}</b><em>{info.late ? t("Late") : ""}</em></div>
          </div>
          {o.kind === "order" && (
            <div className="k-cells">
              <span><small>{t("Sales items")}</small><Pill cell={info.sales} /></span>
              <span><small>{t("Ingredients")}</small><Pill cell={info.ingredients} /></span>
              <span><small>{t("Production")}</small><Pill cell={info.production} /></span>
              <span><small>{t("Delivery")}</small><Pill cell={info.delivery} /></span>
            </div>
          )}

          <small className="label">{t("Items")}</small>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>SKU</th><th>{t("Item")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Price")}</th><th className="num">{t("VAT")}</th><th className="num">{t("Total")}</th><th>{t("Availability")}</th>{o.kind === "order" && <th>{t("Manufacturing")}</th>}{editable && <th />}</tr></thead>
              <tbody>
                {info.lines.map(({ line, mo, sales, item: it }) => (
                  <tr key={line.id} className="static">
                    <td><span className="code">{line.sku || it?.sku || "—"}</span></td>
                    <td>{line.name || it?.name}</td>
                    <td className="num">{editable && !mo && o.status === "open"
                      ? <input className="cell-input" inputMode="decimal" defaultValue={line.quantity} key={line.quantity} onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v > 0 && v !== line.quantity) k.updateLine(line.id, { quantity: v }); }} />
                      : fmtQty(line.quantity)}</td>
                    <td className="num">{editable && o.status === "open"
                      ? <input className="cell-input" inputMode="decimal" defaultValue={line.unit_price ?? ""} key={String(line.unit_price)} onBlur={(e) => { const v = cleanNumber(e.target.value); const n = v === "" ? null : Number(v); if (n !== line.unit_price) k.updateLine(line.id, { unit_price: n }); }} />
                      : money(line.unit_price)}</td>
                    <td className="num">{editable && o.status === "open" && !o.total_price
                      ? <select className="cell-input" value={line.tax_rate ?? ""} aria-label={t("VAT")} onChange={(e) => k.updateLine(line.id, { tax_rate: e.target.value === "" ? null : Number(e.target.value) })}>
                          <option value="">{t("None")}</option>
                          {rateOptions(db.tax_rates, line.tax_rate).map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
                        </select>
                      : line.tax_rate === null ? "—" : `${Math.round(line.tax_rate * 10000) / 100}%`}</td>
                    <td className="num">{money(line.unit_price === null ? null : line.unit_price * line.quantity)}</td>
                    <td><Pill cell={sales} />{sales.why && sales.tone !== "ok" && <small className="muted k-why">{sales.why}</small>}</td>
                    {o.kind === "order" && <td>{mo
                      ? <span className="row gap-s"><span className="code">{jobCode(mo)}</span><small className="muted">{mo.status === "done" ? t("Done") : db.stations.find((s) => s.id === mo.station_id)?.name ?? ""}</small></span>
                      : editable && o.status === "open" && o.delivery === "not_shipped" && it?.kind !== "kit" && it?.kind !== "service" ? <Btn small tone={sales.action === "make" ? "primary" : "soft"} icon={<Factory size={14} />} onClick={() => k.makeLine(line.id)}>{t("Make")}</Btn> : <span className="muted">—</span>}</td>}
                    {editable && <td>{!mo && o.status === "open" && o.delivery === "not_shipped" && <button type="button" className="icon-btn subtle" aria-label={t("Remove")} onClick={() => k.removeLine(line.id)}><Trash2 size={15} /></button>}</td>}
                  </tr>
                ))}
                {!info.lines.length && <tr className="static"><td colSpan={9} className="muted">{t("No items yet")}</td></tr>}
              </tbody>
              {info.lines.length > 0 && !o.total_price && (() => {
                const tot = orderTotals(o, info.lines.map((x) => x.line));
                return (
                  <tfoot>
                    <tr><td colSpan={5}>{t("Net")}</td><td className="num">{money(tot.net)}</td><td colSpan={3} /></tr>
                    <tr><td colSpan={5}>{t("VAT")}</td><td className="num">{money(tot.tax)}</td><td colSpan={3} /></tr>
                    <tr><td colSpan={5}><b>{t("Total")}</b>{o.prices_include_tax && <small className="muted"> · {t("Prices include VAT")}</small>}</td><td className="num"><b>{money(tot.gross)}</b></td><td colSpan={3} /></tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
          {editable && o.status === "open" && !o.total_price && info.lines.length > 0 && (
            <label className="row gap-s fine k-check"><input type="checkbox" checked={o.prices_include_tax}
              onChange={(e) => k.updateOrder(o.id, { prices_include_tax: e.target.checked })} />{t("Prices include VAT")}</label>
          )}
          {editable && o.status === "open" && o.delivery === "not_shipped" && (
            <div className="row gap wrap">
              <div className="grow" key={pickKey}><ItemPicker value={item} onChange={(id) => { setItem(id); if (id) { const pr = priceFor(db, o.customer_id, id, Number(cleanNumber(qty)) || 1); setPrice(pr == null ? "" : String(pr)); } }} filter={(s) => s.kind !== "material"} placeholder={t("Add product — type SKU or name…")} /></div>
              <input className="qty-input" inputMode="decimal" value={qty} onChange={(e) => { setQty(e.target.value); if (item) { const pr = priceFor(db, o.customer_id, item, Number(cleanNumber(e.target.value)) || 1); if (pr != null) setPrice(String(pr)); } }} aria-label={t("Quantity")} />
              <input className="qty-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="£" aria-label={t("Price")} />
              <Btn tone="primary" icon={<Plus size={17} />} disabled={!picked || !(Number(cleanNumber(qty)) > 0)} onClick={async () => {
                await k.addLine({ order_id: o.id, item_id: picked!.id, sku: picked!.sku, name: picked!.name, quantity: Number(cleanNumber(qty)),
                  unit_price: cleanNumber(price) ? Number(cleanNumber(price)) : priceFor(db, o.customer_id, picked!.id, Number(cleanNumber(qty))), sort: info.lines.length });
                setItem(null); setQty("1"); setPrice(""); setPickKey((x) => x + 1);
              }}>{t("Add")}</Btn>
            </div>
          )}

          {o.kind === "order" && o.status !== "cancelled" && (
            <div className="card flat stack">
              <small className="label"><Truck size={13} /> {t("Delivery")}</small>
              <div className="seg-full"><Segmented value={o.delivery} onChange={(v) => editable && k.setDelivery(o.id, v)} options={DELIVERY.map((d) => ({ value: d.value, label: t(d.label) }))} /></div>
              {o.delivery === "partially_shipped" && <p className="hint">{t("Partly shipped — the rest is still to go.")}</p>}
              <p className="fine">{t("Stock leaves when a line ships. Made-to-order items go on stock when their manufacturing order is done and leave when their line ships. Services never touch stock.")}</p>
              {editable && <Fulfilment info={info} />}
              <div className="row gap">
                <LocationSelect value={o.location_id} disabled={!editable || o.stock_out} label={t("Ships from")} onChange={(v) => k.updateOrder(o.id, { location_id: v })} />
                {field("tracking", t("Tracking number"))}
                {field("shipping_method", t("Shipping method"))}
              </div>
            </div>
          )}

          <small className="label">{t("Customer")}</small>
          <div className="row gap">{field("customer", t("Name"))}{field("company", t("Company"))}</div>
          <div className="row gap">{field("email", t("Email"), "email")}{field("phone", t("Phone"))}</div>
          {field("ship_to", t("Ship to"))}
          <div className="row gap">{field("delivery_deadline", t("Delivery deadline"), "date")}</div>
          {field("note", t("Notes"))}
          <CustomFields order={o} editable={editable} onSave={(custom) => k.updateOrder(o.id, { custom })} />

          {editable && (
            <div className="stack">
              {o.kind === "quote" && <Btn tone="primary" wide icon={<ArrowRightLeft size={17} />} onClick={() => k.convertQuote(o.id)}>{t("Turn into sales order")}</Btn>}
              {o.kind === "order" && o.status === "open" && o.delivery === "not_shipped" && <HoldButton onConfirm={() => k.updateOrder(o.id, { status: "cancelled" })}>{t("Hold to cancel order")}</HoldButton>}
              {o.kind === "order" && o.status === "cancelled" && <Btn tone="soft" wide onClick={() => k.updateOrder(o.id, { status: "open" })}>{t("Re-open order")}</Btn>}
              {(o.kind === "quote" || (o.source === "manual" && !info.lines.some((l) => l.mo) && o.delivery === "not_shipped")) &&
                <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={async () => { await k.deleteOrder(o.id); onClose(); }}>{t("Hold to delete")}</HoldButton>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Ship part of an order, undo a shipment, or book a customer return — line by line. */
function Fulfilment({ info }: { info: OrderInfo }) {
  const k = useKimera();
  const o = info.order;
  const [ship, setShip] = useState<Record<string, string>>({});
  const [ret, setRet] = useState<Record<string, string>>({});
  const [scrap, setScrap] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"" | "ship" | "return" | "undo">("");
  const [key, setKey] = useState(opKey);
  const lines = info.lines.map((x) => x.line);
  const toShip = lines.filter((l) => l.quantity > l.shipped);
  const out = lines.filter((l) => l.shipped - l.returned > 0);
  if (!lines.length) return null;
  const num = (v: string | undefined, d: number) => { const n = Number(cleanNumber(v ?? String(d))); return Number.isFinite(n) ? n : 0; };
  const go = async (what: "ship" | "return" | "undo", fn: () => Promise<unknown>) => {
    setBusy(what); const r = await fn(); setBusy("");
    if (r !== null) { setKey(opKey()); setShip({}); setRet({}); setScrap({}); setReason(""); }
  };
  const shipList = toShip.map((l) => ({ line: l.id, qty: num(ship[l.id], l.quantity - l.shipped) })).filter((x) => x.qty > 0);
  const retList = out.map((l) => ({ line: l.id, qty: num(ret[l.id], 0), restock: !scrap[l.id] })).filter((x) => x.qty > 0);
  return (
    <div className="stack">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Item")}</th><th className="num">{t("Ordered")}</th><th className="num">{t("Shipped")}</th><th className="num">{t("Returned")}</th>
            {o.status === "open" && toShip.length > 0 && <th className="num">{t("Ship now")}</th>}{out.length > 0 && <th className="num">{t("Return")}</th>}</tr></thead>
          <tbody>
            {lines.map((l) => {
              const left = l.quantity - l.shipped, back = l.shipped - l.returned;
              return (
                <tr key={l.id} className="static">
                  <td>{l.name || l.sku}</td>
                  <td className="num">{fmtQty(l.quantity)}</td>
                  <td className={`num ${left ? "" : "ok-t"}`}>{fmtQty(l.shipped)}</td>
                  <td className="num">{l.returned ? fmtQty(l.returned) : "—"}</td>
                  {o.status === "open" && toShip.length > 0 && <td className="num">{left > 0
                    ? <input className="cell-input" inputMode="decimal" aria-label={t("Ship now")} value={ship[l.id] ?? String(left)} onChange={(e) => setShip({ ...ship, [l.id]: e.target.value })} />
                    : <PackageCheck size={16} className="ok-t" />}</td>}
                  {out.length > 0 && <td className="num">{back > 0 ? (
                    <span className="row gap-s end">
                      <input className="cell-input" inputMode="decimal" aria-label={t("Return")} placeholder="0" value={ret[l.id] ?? ""} onChange={(e) => setRet({ ...ret, [l.id]: e.target.value })} />
                      <label className="row gap-s fine" title={t("Not resaleable: recorded as returned without going back on stock")}>
                        <input type="checkbox" checked={!!scrap[l.id]} onChange={(e) => setScrap({ ...scrap, [l.id]: e.target.checked })} />{t("Scrap")}</label>
                    </span>) : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row gap wrap">
        {o.status === "open" && toShip.length > 0 && <Btn tone="primary" icon={<Truck size={16} />} busy={busy === "ship"} disabled={!shipList.length || !!busy}
          onClick={() => go("ship", () => k.shipLines(o.id, shipList, key))}>{t("Ship selected")}</Btn>}
        {out.length > 0 && <Btn tone="soft" icon={<Undo2 size={16} />} busy={busy === "return"} disabled={!retList.length || !!busy}
          onClick={() => go("return", () => k.returnLines(o.id, retList, reason, key))}>{t("Book return")}</Btn>}
        {out.length > 0 && !lines.some((l) => l.returned > 0) && <Btn tone="ghost" busy={busy === "undo"} disabled={!!busy}
          onClick={() => go("undo", () => k.unshipLines(o.id, null, key))}>{t("Undo shipment")}</Btn>}
      </div>
      {out.length > 0 && <Field label={t("Return reason")}><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. damaged in transit")} /></Field>}
    </div>
  );
}

/** Active tax rates for a line's picker, plus the line's own (possibly old) rate so it stays visible. */
function rateOptions(rates: { rate: number; name: string; archived: boolean }[], cur: number | null) {
  const out = rates.filter((r) => !r.archived).map((r) => ({ v: String(r.rate), label: `${Math.round(r.rate * 10000) / 100}%` }));
  if (cur !== null && !out.some((x) => Number(x.v) === cur)) out.push({ v: String(cur), label: `${Math.round(cur * 10000) / 100}%` });
  const seen = new Set<string>();
  return out.filter((x) => { const k = String(Number(x.v)); if (seen.has(k)) return false; seen.add(k); return true; });
}

type FieldDef = NonNullable<ReturnType<typeof useStore>["db"]["company_settings"][number]>["order_fields"][number];

/** SALES-09: the company's own order fields (Settings → Company). */
function CustomInputs({ values, onChange, disabled, onBlur }: { values: Record<string, string>; onChange: (v: Record<string, string>) => void; disabled?: boolean; onBlur?: (v: Record<string, string>) => void }) {
  const { db } = useStore();
  const defs: FieldDef[] = db.company_settings[0]?.order_fields ?? [];
  if (!defs.length) return null;
  return (
    <div className="row gap wrap">
      {defs.map((d) => {
        const set = (v: string) => { const n = { ...values, [d.key]: v }; onChange(n); return n; };
        return (
          <Field key={d.key} label={`${d.label}${d.required ? " *" : ""}`}>
            {d.type === "select"
              ? <select value={values[d.key] ?? ""} disabled={disabled} onChange={(e) => { const n = set(e.target.value); onBlur?.(n); }}><option value="">—</option>{(d.options ?? []).map((x) => <option key={x}>{x}</option>)}</select>
              : <input type={d.type === "number" ? "text" : d.type} inputMode={d.type === "number" ? "decimal" : undefined} value={values[d.key] ?? ""} disabled={disabled}
                  onChange={(e) => set(e.target.value)} onBlur={() => onBlur?.(values)} />}
          </Field>
        );
      })}
    </div>
  );
}

function CustomFields({ order, editable, onSave }: { order: Order; editable: boolean; onSave: (v: Record<string, string>) => void }) {
  const [v, setV] = useState<Record<string, string>>(order.custom ?? {});
  const [key, setKey] = useState(order.id);
  if (key !== order.id) { setKey(order.id); setV(order.custom ?? {}); }
  return <CustomInputs values={v} onChange={setV} disabled={!editable} onBlur={(n) => { if (JSON.stringify(n) !== JSON.stringify(order.custom ?? {})) onSave(n); }} />;
}
