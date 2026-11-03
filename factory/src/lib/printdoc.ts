// Printable documents (ADMIN-06): purchase order, pick list, packing slip, MO traveller.
// One plain A4 layout, opened in a new window and sent to the printer (or "Save as PDF").
import { SCANNING, code128Svg } from "./scan";
import { t } from "./i18n";
import type { DB } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const nl = (s: string) => esc(s).replace(/\n/g, "<br>");

export interface Doc {
  /** e.g. "Purchase order" */
  title: string;
  number: string;
  meta: [string, string][];
  /** Address-style blocks: supplier, ship to… */
  parties?: { label: string; text: string }[];
  columns: { label: string; num?: boolean; check?: boolean }[];
  rows: (string | number)[][];
  totals?: [string, string][];
  note?: string;
  /** Lines for signatures: "Picked by", "Checked by"… */
  sign?: string[];
}

export function company(db: DB) {
  const c = db.company_settings[0];
  return { name: c?.company_name || "Skalarki Electronics Ltd", address: c?.company_address || "" };
}

export function printDoc(db: DB, d: Doc) {
  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) return false;
  const co = company(db);
  let bars = "";
  if (SCANNING) try { bars = code128Svg(d.number, { module: 1.6, height: 40 }); } catch { /* not encodable */ }
  const head = d.columns.map((c) => `<th class="${c.num ? "n" : ""}${c.check ? " c" : ""}">${esc(c.label)}</th>`).join("");
  const body = d.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${d.columns[i]?.num ? "n" : ""}${d.columns[i]?.check ? " c" : ""}">${d.columns[i]?.check ? "☐" : esc(v)}</td>`).join("")}</tr>`).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)} ${esc(d.number)}</title><style>
    @page{size:A4;margin:14mm} *{box-sizing:border-box} body{margin:0;font:10pt/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
    .co b{font-size:13pt}.co div{color:#444;font-size:9pt}
    h1{margin:0;font-size:17pt;letter-spacing:-.01em;text-align:right}.num{font:600 11pt ui-monospace,monospace;text-align:right}.bars{text-align:right}.bars svg{height:34px}
    .meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 18px;margin-bottom:14px}
    .meta small,.party small{display:block;color:#666;font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em}
    .parties{display:flex;gap:24px;margin-bottom:16px}.party{flex:1;border:1px solid #ccc;border-radius:6px;padding:8px 10px;min-height:60px}
    table{width:100%;border-collapse:collapse}th{text-align:left;font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#555;border-bottom:1.5px solid #111;padding:5px 6px}
    td{border-bottom:1px solid #ddd;padding:6px;vertical-align:top}.n{text-align:right;white-space:nowrap}.c{text-align:center;width:42px;font-size:13pt}
    .tot{margin-left:auto;margin-top:10px;width:260px}.tot div{display:flex;justify-content:space-between;padding:3px 6px}.tot div:last-child{font-weight:700;border-top:1.5px solid #111}
    .note{margin-top:16px;padding:8px 10px;background:#f4f4f4;border-radius:6px;white-space:pre-wrap}
    .sign{display:flex;gap:24px;margin-top:36px}.sign div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:8pt;color:#555}
    footer{margin-top:24px;font-size:7.5pt;color:#888;text-align:center}
    @media screen{body{background:#e9e9e9;padding:20px}main{background:#fff;max-width:210mm;margin:0 auto;padding:14mm;box-shadow:0 2px 12px rgba(0,0,0,.15)}}
  </style></head><body><main>
    <header><div class="co"><b>${esc(co.name)}</b><div>${nl(co.address)}</div></div>
      <div><h1>${esc(d.title)}</h1><div class="num">${esc(d.number)}</div><div class="bars">${bars}</div></div></header>
    <div class="meta">${d.meta.filter(([, v]) => v).map(([k, v]) => `<div><small>${esc(k)}</small>${esc(v)}</div>`).join("")}</div>
    ${d.parties?.length ? `<div class="parties">${d.parties.map((p) => `<div class="party"><small>${esc(p.label)}</small>${nl(p.text)}</div>`).join("")}</div>` : ""}
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${d.totals?.length ? `<div class="tot">${d.totals.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : ""}
    ${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}
    ${d.sign?.length ? `<div class="sign">${d.sign.map((s) => `<div>${esc(s)}</div>`).join("")}</div>` : ""}
    <footer>${esc(t("Printed {d} · Kortana", { d: new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) }))}</footer>
  </main><script>setTimeout(()=>print(),350)<\/script></body></html>`);
  w.document.close();
  return true;
}

const q = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-GB", { maximumFractionDigits: 3 });
const day = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const binOf = (db: DB, item: string, loc: string | null) => {
  const l = loc ?? db.locations.find((x) => x.is_default)?.id;
  return db.stock_levels.find((s) => s.item_id === item && s.location_id === l)?.bin || db.stock_items.find((s) => s.id === item)?.location || "";
};

/** Kit lines expand to their components (what actually goes in the box). */
function physicalLines(db: DB, orderId: string) {
  const out: { sku: string; name: string; qty: number; item: string | null; kit?: string }[] = [];
  for (const l of db.order_lines.filter((x) => x.order_id === orderId).sort((a, b) => a.sort - b.sort)) {
    const it = l.item_id ? db.stock_items.find((s) => s.id === l.item_id) : undefined;
    if (it?.kind === "service") continue;
    const left = l.quantity - l.shipped;
    if (it?.kind === "kit") {
      for (const b of db.bom_lines.filter((x) => x.product_id === it.id)) {
        const m = db.stock_items.find((s) => s.id === b.material_id);
        out.push({ sku: m?.sku ?? "", name: m?.name ?? "", qty: b.quantity * left, item: b.material_id, kit: `${l.sku} × ${q(left)}` });
      }
    } else out.push({ sku: l.sku, name: l.name, qty: left, item: l.item_id });
  }
  return out;
}

export function printPickList(db: DB, orderId: string) {
  const o = db.orders.find((x) => x.id === orderId)!;
  const lines = physicalLines(db, orderId).filter((l) => l.qty > 0)
    .map((l) => ({ ...l, bin: l.item ? binOf(db, l.item, o.location_id) : "" })).sort((a, b) => a.bin.localeCompare(b.bin) || a.sku.localeCompare(b.sku));
  return printDoc(db, {
    title: t("Pick list"), number: o.order_number,
    meta: [[t("Customer"), o.customer], [t("Deadline"), day(o.delivery_deadline)], [t("Ships from"), db.locations.find((l) => l.id === o.location_id)?.name ?? db.locations.find((l) => l.is_default)?.name ?? ""], [t("Shipping method"), o.shipping_method]],
    columns: [{ label: t("Bin") }, { label: "SKU" }, { label: t("Item") }, { label: t("Qty"), num: true }, { label: "✓", check: true }],
    rows: lines.map((l) => [l.bin, l.sku, l.kit ? `${l.name}  (${l.kit})` : l.name, q(l.qty), ""]),
    note: o.note, sign: [t("Picked by"), t("Checked by")],
  });
}

export function printPackingSlip(db: DB, orderId: string) {
  const o = db.orders.find((x) => x.id === orderId)!;
  const lines = db.order_lines.filter((x) => x.order_id === orderId).sort((a, b) => a.sort - b.sort)
    .filter((l) => db.stock_items.find((s) => s.id === l.item_id)?.kind !== "service");
  const fields = (db.company_settings[0]?.order_fields ?? []).filter((f) => o.custom?.[f.key]);
  return printDoc(db, {
    title: t("Packing slip"), number: o.order_number,
    meta: [[t("Ordered"), day(o.ordered_at ?? o.created_at)], [t("Shipping method"), o.shipping_method], [t("Tracking number"), o.tracking ?? ""], ...fields.map((f) => [f.label, f.type === "date" ? day(o.custom[f.key]) : o.custom[f.key]] as [string, string])],
    parties: [{ label: t("Ship to"), text: [o.customer, o.company, o.ship_to].filter(Boolean).join("\n") }, { label: t("Contact"), text: [o.email, o.phone].filter(Boolean).join("\n") }],
    columns: [{ label: "SKU" }, { label: t("Item") }, { label: t("Ordered"), num: true }, { label: t("In this parcel"), num: true }],
    rows: lines.map((l) => [l.sku, l.name, q(l.quantity), q(l.shipped - l.returned || l.quantity)]),
    note: o.note,
  });
}

export function printPurchaseOrder(db: DB, poId: string, showCost: boolean) {
  const po = db.purchase_orders.find((x) => x.id === poId)!;
  const sup = db.suppliers.find((s) => s.id === po.supplier_id);
  const lines = db.po_lines.filter((l) => l.po_id === po.id);
  const cur = po.currency ?? db.company_settings[0]?.base_currency ?? "GBP";
  const fm = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = lines.reduce((s, l) => s + (l.unit_cost ?? 0) * l.quantity, 0);
  const deliver = db.locations.find((l) => l.id === (po.kind === "outsourced" ? po.partner_location_id : po.location_id)) ?? db.locations.find((l) => l.is_default);
  const co = company(db);
  const ref = (item: string) => db.item_suppliers.find((s) => s.item_id === item && s.supplier_id === po.supplier_id)?.supplier_sku || db.stock_items.find((s) => s.id === item)?.supplier_code || "";
  return printDoc(db, {
    title: po.kind === "outsourced" ? t("Subcontract order") : t("Purchase order"), number: po.number,
    meta: [[t("Order date"), day(po.ordered_at ?? po.created_at)], [t("Expected"), day(po.expected_date)], [t("Currency"), cur]],
    parties: [{ label: t("Supplier"), text: [sup?.name, sup?.email, sup?.phone].filter(Boolean).join("\n") }, { label: t("Deliver to"), text: [co.name, deliver?.name, deliver && "address" in deliver ? String((deliver as { address?: string }).address ?? "") : co.address].filter(Boolean).join("\n") }],
    columns: [{ label: "SKU" }, { label: t("Supplier's code") }, { label: t("Item") }, { label: t("Qty"), num: true }, ...(showCost ? [{ label: t("Unit price"), num: true }, { label: t("Total"), num: true }] : [])],
    // in the supplier's purchase unit when one is set (2 box, not 200 pcs), with the price per that unit
    rows: lines.map((l) => { const it = db.stock_items.find((s) => s.id === l.item_id); const pu = l.purchase_unit && l.units_per_purchase !== 1 ? l : null;
      return [it?.sku ?? "", ref(l.item_id), it?.name ?? "", pu ? `${q(l.quantity / pu.units_per_purchase)} ${pu.purchase_unit} (${q(l.quantity)} ${it?.unit ?? ""})` : `${q(l.quantity)} ${it?.unit ?? ""}`,
        ...(showCost ? [fm((l.unit_cost ?? 0) * (pu?.units_per_purchase ?? 1)), fm((l.unit_cost ?? 0) * l.quantity)] : [])]; }),
    totals: showCost ? (() => { const extra = db.po_costs.filter((c) => c.po_id === po.id); return extra.length
      ? [[t("Goods"), `${fm(total)} ${cur}`], ...extra.map((c) => [c.label, `${fm(c.amount)} ${cur}`] as [string, string]), [t("Total"), `${fm(total + extra.reduce((a, c) => a + c.amount, 0))} ${cur}`]] as [string, string][]
      : [[t("Total"), `${fm(total)} ${cur}`]] as [string, string][]; })() : undefined,
    note: po.notes,
  });
}

export function printTraveller(db: DB, jobId: string, schedule?: { finish?: string } | null) {
  const j = db.jobs.find((x) => x.id === jobId)!;
  const prod = db.stock_items.find((s) => s.sku === j.sku);
  const qty = j.quantity ?? 1;
  const mats = prod ? db.bom_lines.filter((b) => b.product_id === prod.id).map((b) => ({ b, m: db.stock_items.find((s) => s.id === b.material_id) })) : [];
  const ops = prod ? db.product_operations.filter((o) => o.product_id === prod.id).sort((a, b) => a.sort - b.sort) : [];
  const parent = j.parent_id ? db.jobs.find((x) => x.id === j.parent_id) : undefined;
  return printDoc(db, {
    title: t("Production traveller"), number: j.code,
    meta: [[t("Product"), `${j.sku ?? ""} ${j.title}`], [t("Quantity"), q(qty)], [t("Due"), day(j.due_date)], [t("Planned finish"), day(schedule?.finish)], [t("Customer"), j.customer], [t("For"), parent?.code ?? ""]],
    columns: [{ label: t("Material") }, { label: t("Bin") }, { label: t("Needed"), num: true }, { label: "✓", check: true }],
    rows: mats.map(({ b, m }) => [`${m?.sku ?? ""} ${m?.name ?? ""}`, binOf(db, b.material_id, j.location_id), `${q(b.quantity * qty)} ${m?.unit ?? ""}`, ""]),
    note: [ops.length ? `${t("Operations")}:\n${ops.map((o, i) => `${i + 1}. ${o.name}${o.step ? ` [${t("group")} ${o.step}]` : ""} — ${db.stations.find((s) => s.id === o.station_id)?.name ?? ""} · ${q(o.setup_minutes + o.unit_minutes * qty)} min`).join("\n")}` : "", j.description].filter(Boolean).join("\n\n"),
    sign: [t("Built by"), t("Checked by"), t("Date")],
  });
}
