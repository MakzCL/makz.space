/**
 * Kimera status engine: works out, for every open sales order, whether its
 * items are in stock, whether ingredients are there for its manufacturing
 * orders, how production is going and where delivery stands.
 * Stock is allocated to orders by rank (oldest first), like a real MRP.
 */
import type { DB, Job, Order, OrderLine, StockItem } from "../lib/types";
import { stockLevels } from "../screens/Inventory";
import { lineCell, moCell, type Avail } from "./availability";

export type Tone = "ok" | "warn" | "bad" | "info" | "none";
/** why = plain-language reason (shown on hover), from the server allocation. */
export interface Cell { label: string; tone: Tone; date?: string | null; action?: "make"; why?: string }

export interface LineInfo { line: OrderLine; item: StockItem | null; mo: Job | null; sales: Cell; ingredients: Cell }
export interface OrderInfo {
  order: Order;
  rank: number | null;
  lines: LineInfo[];
  amount: number | null;
  sales: Cell; ingredients: Cell; production: Cell; delivery: Cell;
  late: boolean;
}

const S = (label: string, tone: Tone, date?: string | null, action?: "make"): Cell => ({ label, tone, date, action });
const today = () => new Date().toISOString().slice(0, 10);

export function analyse(db: DB, av?: Avail | null) {
  const skuName = new Map(db.stock_items.map((s) => [s.id, s.sku]));
  const lv = stockLevels(db);
  const items = new Map(db.stock_items.map((s) => [s.id, s]));
  const bySku = new Map<string, StockItem>();
  for (const s of db.stock_items) if (!s.archived && (!bySku.has(s.sku) || bySku.get(s.sku)!.kind === "material")) bySku.set(s.sku, s);
  const moByLine = new Map<string, Job>();
  for (const j of db.jobs) if (j.order_line_id) moByLine.set(j.order_line_id, j);
  const linesBy = new Map<string, OrderLine[]>();
  for (const l of db.order_lines) linesBy.set(l.order_id, [...(linesBy.get(l.order_id) ?? []), l]);
  for (const v of linesBy.values()) v.sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
  // Earliest open PO date per item.
  const poDate = new Map<string, string | null>();
  const openPo = new Map(db.purchase_orders.filter((p) => p.status === "ordered" || p.status === "partial").map((p) => [p.id, p]));
  for (const l of db.po_lines) {
    const po = openPo.get(l.po_id); if (!po || l.received >= l.quantity) continue;
    const cur = poDate.get(l.item_id);
    if (cur === undefined || (po.expected_date && (!cur || po.expected_date < cur))) poDate.set(l.item_id, po.expected_date);
  }
  const bom = new Map<string, { material_id: string; quantity: number }[]>();
  for (const b of db.bom_lines) bom.set(b.product_id, [...(bom.get(b.product_id) ?? []), b]);
  const stations = new Map(db.stations.map((s) => [s.id, s.name]));

  const itemOf = (l: OrderLine) => (l.item_id ? items.get(l.item_id) : undefined) ?? (l.sku ? bySku.get(l.sku) : undefined) ?? null;

  // Free finished stock, handed out to orders in rank order.
  const free = new Map<string, number>();
  for (const s of db.stock_items) free.set(s.id, s.quantity - (lv.committed.get(s.id) ?? 0));
  const freeExp = new Map(lv.expected);

  // Queue order = the server's priority rank (Sell → arrows), oldest first by default.
  const rk = (o: Order) => o.rank ?? Date.parse(o.ordered_at ?? o.created_at) / 1000;
  const orders = [...db.orders].sort((a, b) => rk(a) - rk(b) || a.created_at.localeCompare(b.created_at));
  const out = new Map<string, OrderInfo>();
  let rank = 0;
  for (const o of orders) {
    const open = o.kind === "order" && o.status === "open";
    const lines: LineInfo[] = (linesBy.get(o.id) ?? []).map((line) => {
      const item = itemOf(line);
      const mo = moByLine.get(line.id) ?? null;
      let sales: Cell, ingredients: Cell;
      if (mo) {
        sales = mo.status === "done" ? S("Made", "ok") : S("Expected", "warn", mo.due_date);
        ingredients = av?.mos[mo.id] ? moCell(av.mos[mo.id]!, skuName) : ingredientCell(mo, item, bom, items, lv, poDate);
        if (mo.stock_booked && av?.lines[line.id] && line.shipped < line.quantity) sales = { ...S("Made", "ok"), why: av.lines[line.id]!.why };
      } else {
        ingredients = S("Not applicable", "none");
        if (o.kind === "quote") sales = item ? (free.get(item.id) ?? 0) >= line.quantity ? S("In stock", "ok") : S("Not available", "bad") : S("Not tracked", "none");
        else if (line.shipped >= line.quantity) sales = S("Sent", "ok");
        else if (o.delivery === "packed") sales = S("Picked", "ok");
        else if (!item) sales = S("Not tracked", "none");
        else if (item.kind === "service") sales = S("Service", "none");
        else if (av && open && av.lines[line.id]) sales = lineCell(av.lines[line.id]!, item.kind !== "material");
        else {
          const need = line.quantity - line.shipped;
          const f = free.get(item.id) ?? 0;
          if (open && f >= need) { free.set(item.id, f - need); sales = S("In stock", "ok"); }
          else {
            const short = need - Math.max(0, f);
            if (open) free.set(item.id, Math.max(0, f) - Math.min(need, Math.max(0, f)));
            const e = freeExp.get(item.id) ?? 0;
            if (e >= short) { freeExp.set(item.id, e - short); sales = S("Expected", "warn", poDate.get(item.id) ?? null); }
            else sales = S("Not available", "bad", null, item.kind !== "material" ? "make" : undefined);
          }
        }
      }
      return { line, item, mo, sales, ingredients };
    });

    const amount = o.total_price ?? (lines.length ? orderTotals(o, lines.map((l) => l.line)).gross : null);
    const worst = (cells: Cell[], fallback: Cell) => {
      if (!cells.length) return fallback;
      const bad = cells.find((c) => c.tone === "bad"); if (bad) return bad;
      const warn = cells.filter((c) => c.tone === "warn");
      if (warn.length) return { ...warn[0]!, date: warn.map((c) => c.date).filter(Boolean).sort().pop() ?? null };
      return cells.find((c) => c.tone === "ok") ?? cells[0]!;
    };
    const sales = worst(lines.map((l) => l.sales), S("No items", "none"));
    const mos = lines.map((l) => l.mo).filter(Boolean) as Job[];
    const ingredients = mos.length ? worst(lines.filter((l) => l.mo).map((l) => l.ingredients), S("Not applicable", "none")) : S("Not applicable", "none");
    let production: Cell;
    if (!mos.length) production = lines.some((l) => l.sales.action === "make") ? S("Make", "bad", null, "make") : S("Not applicable", "none");
    else if (mos.every((j) => j.status === "done")) production = S("Done", "ok");
    else if (mos.some((j) => j.status === "blocked")) production = S("Blocked", "bad");
    else if (mos.some((j) => j.status !== "open" || j.stage > 0)) {
      const j = mos.find((x) => x.status !== "done")!;
      production = S(stations.get(j.station_id ?? "") ?? "In progress", "info");
    } else production = S("Not started", "warn");
    const delivery = S(
      { not_shipped: "Not shipped", packed: "Packed", partially_shipped: "Partly shipped", shipped: "Shipped", delivered: "Delivered" }[o.delivery],
      o.delivery === "delivered" || o.delivery === "shipped" ? "ok" : o.delivery === "packed" || o.delivery === "partially_shipped" ? "info" : "none",
    );
    const late = open && !!o.delivery_deadline && o.delivery_deadline < today() && o.delivery !== "delivered";
    out.set(o.id, { order: o, rank: open ? ++rank : null, lines, amount, sales, ingredients, production, delivery, late });
  }
  return out;
}

function ingredientCell(mo: Job, item: StockItem | null, bom: Map<string, { material_id: string; quantity: number }[]>, items: Map<string, StockItem>,
  lv: ReturnType<typeof stockLevels>, poDate: Map<string, string | null>): Cell {
  if (mo.stock_booked || mo.status === "done") return S("Processed", "ok");
  const prod = item ?? null;
  const lines = prod ? bom.get(prod.id) ?? [] : [];
  if (!lines.length) return S("No recipe", "none");
  let tone: Tone = "ok"; let date: string | null = null;
  for (const b of lines) {
    const m = items.get(b.material_id); if (!m) continue;
    const avail = m.quantity - (lv.committed.get(m.id) ?? 0);
    if (avail >= 0) continue;
    if (avail + (lv.expected.get(m.id) ?? 0) >= 0) { if (tone === "ok") tone = "warn"; const d = poDate.get(m.id); if (d && (!date || d > date)) date = d; }
    else tone = "bad";
  }
  return tone === "ok" ? S("In stock", "ok") : tone === "warn" ? S("Expected", "warn", date) : S("Not available", "bad");
}

/** Materials a manufacturing order needs, with what is free now. */
export function moIngredients(db: DB, mo: Job) {
  const lv = stockLevels(db);
  const prod = db.stock_items.find((s) => s.sku === mo.sku && s.kind !== "material") ?? db.stock_items.find((s) => s.sku === mo.sku);
  if (!prod) return [];
  return db.bom_lines.filter((b) => b.product_id === prod.id).map((b) => {
    const m = db.stock_items.find((s) => s.id === b.material_id);
    const need = b.quantity * (mo.quantity ?? 1);
    const avail = m ? m.quantity - (lv.committed.get(m.id) ?? 0) : 0;
    return { m, need, inStock: m?.quantity ?? 0, avail, expected: m ? lv.expected.get(m.id) ?? 0 : 0 };
  });
}

const pennies = (n: number) => Math.round(n * 100) / 100;
/**
 * Net / VAT / gross of an order from its lines. Each line keeps the rate it was sold
 * at; VAT is rounded per line. prices_include_tax = the entered prices are gross.
 */
export function orderTotals(o: Pick<Order, "prices_include_tax">, lines: Pick<OrderLine, "quantity" | "unit_price" | "tax_rate">[]) {
  let net = 0, tax = 0;
  for (const l of lines) {
    const amt = l.quantity * (l.unit_price ?? 0), r = l.tax_rate ?? 0;
    const n = o.prices_include_tax ? pennies(amt / (1 + r)) : pennies(amt);
    const g = o.prices_include_tax ? pennies(amt) : pennies(amt * (1 + r));
    net += n; tax += g - n;
  }
  return { net: pennies(net), tax: pennies(tax), gross: pennies(net + tax) };
}
