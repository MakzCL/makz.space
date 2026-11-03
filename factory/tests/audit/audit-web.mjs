// Audit SK Factory, Kortana and TROTAN against the mocked backend (no real data). Every screen at 1440 and 390 px:
// static checks at both widths, and every control clicked at 1440.
// Run: npm run build ; npx vite preview --port 4173   then   node tests/audit/audit-web.mjs <outDir> [app]
import { createRequire } from "node:module"; import { randomUUID } from "node:crypto"; import fs from "node:fs";
import { context, seed, OWNER, OPERATOR } from "../trotan/mock.mjs";
import { crawlScreen, report } from "./crawl.mjs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const BASE = process.env.APP_URL ?? "http://localhost:4173"; const OUT = process.argv[2] ?? "."; const ONLY = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const now = () => new Date().toISOString(); const day = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

function richSeed() {
  const D = seed(); const id = () => randomUUID();
  const sup = { id: id(), name: "Bolt Supply Ltd", currency: "GBP", email: "orders@bolt.test", phone: "01234 567890", notes: "", created_at: now() };
  const items = [
    { sku: "WID-100", name: "Display widget, anodised aluminium, 120 mm", kind: "product", unit: "pcs", quantity: 42, min_quantity: 10, sale_price: 24.5 },
    { sku: "PNL-A4", name: "Acrylic panel A4 clear 3 mm", kind: "product", unit: "pcs", quantity: 3, min_quantity: 8, sale_price: 12 },
    { sku: "SCR-M3", name: "Screw M3×8 stainless", kind: "material", unit: "pcs", quantity: 1800, min_quantity: 500, sale_price: null },
    { sku: "ACR-3MM", name: "Acrylic sheet 3 mm 600×400", kind: "material", unit: "sheet", quantity: 0, min_quantity: 5, sale_price: null },
  ].map((x) => ({ id: id(), category: "", location: "A1", archived: false, tracking: "none", avg_cost: 1.2, created_at: now(), ...x }));
  D.stock_items.push(...items); D.suppliers = [sup];
  const cust = { id: id(), name: "Acme Displays", company: "Acme Displays Ltd", email: "buy@acme.test", phone: "", address: "1 High St, Leeds", tax_rate_id: null, notes: "", archived: false, price_list_id: null, created_at: now() };
  D.customers = [cust, { ...cust, id: id(), name: "Walk-in customer", company: "", email: "" }];
  const o1 = { id: id(), order_number: "SO-0101", kind: "order", status: "open", delivery: "not_shipped", production: "not_started", customer: cust.name, company: cust.company, email: cust.email, customer_id: cust.id, source: "manual", currency: "GBP", prices_include_tax: false, total_price: null, custom: {}, ordered_at: now(), delivery_deadline: day(5), created_at: now() };
  const q1 = { ...o1, id: id(), order_number: "QU-0007", kind: "quote", ordered_at: null };
  D.orders = [o1, q1]; D.order_lines = [{ id: id(), order_id: o1.id, item_id: items[0].id, sku: items[0].sku, name: items[0].name, quantity: 6, unit_price: 24.5, sort: 0, shipped: 0, created_at: now() }, { id: id(), order_id: q1.id, item_id: items[1].id, sku: items[1].sku, name: items[1].name, quantity: 20, unit_price: 12, sort: 0, shipped: 0, created_at: now() }];
  const po = { id: id(), number: "PO-0042", supplier_id: sup.id, status: "ordered", kind: "standard", fx_rate: 1, currency: null, expected_date: day(3), notes: "", created_at: now(), ordered_at: now() };
  D.purchase_orders = [po]; D.po_lines = [{ id: id(), po_id: po.id, item_id: items[2].id, quantity: 1000, received: 400, unit_cost: 0.04, purchase_unit: "box", units_per_purchase: 100, created_at: now() }];
  D.item_suppliers = [{ id: id(), item_id: items[2].id, supplier_id: sup.id, supplier_sku: "B-M3-8", unit_cost: 0.04, lead_days: 4, preferred: true, purchase_unit: "box", units_per_purchase: 100, created_at: now() }];
  D.price_lists = []; D.price_list_items = []; D.po_costs = []; D.company_settings = [{ id: id(), name: "Skalarki Electronics Ltd", order_fields: [], currency: "GBP", created_at: now() }];
  D.locations = [{ id: id(), name: "Main warehouse", kind: "warehouse", is_default: true, archived: false, created_at: now() }];
  D.jobs.push({ id: id(), code: "MO-0043", title: "Acrylic panels for Acme", customer: "Acme", status: "in_progress", priority: 1, assignees: [OPERATOR], route: [], stage: 0, quantity: 20, due_date: day(2), created_at: now() });
  D.tax_rates = [{ id: id(), name: "VAT 20%", rate: 0.2, is_default: true, archived: false, created_at: now() }];
  D.sessions = [{ id: id(), user: OWNER, created_at: now(), last_active: now(), user_agent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0", ip: "10.0.0.5", current: true }];
  return D;
}
const nav = async (p, labels) => { for (const l of labels) { const loc = typeof l === "function" ? l(p) : p.getByRole("button", { name: new RegExp(`^${l}(\\s*\\d+)?$`) }).or(p.getByText(l, { exact: true })).filter({ visible: true }).first(); await loc.click({ timeout: 8000 }); await p.waitForTimeout(350); } };
const SCREENS = {
  factory: { url: "/", screens: [["Home", []], ["Jobs", ["Jobs"]], ["Chat", ["Chat"]], ["Team", ["Team"]], ["Insights", ["Insights"]], ["Requests", ["Requests"]],
    ["Profile", [(p) => p.locator(".me-btn")]], ["Profile › Awards", [(p) => p.locator(".me-btn"), (p) => p.locator("[aria-label=Awards]").last()]], ["Profile › Settings", [(p) => p.locator(".me-btn"), (p) => p.locator("[aria-label=Settings]").last()]]] },
  kortana: { url: "/kimera", screens: [["Sell › Sales orders", []], ["Sell › Quotes", ["Quotes"]], ["Sell › Customers", ["Customers"]], ["Sell › Price lists", ["Price lists"]],
    ["Make", ["Make"]], ["Buy", ["Buy"]], ["Stock", ["Stock"]], ["Items", ["Items"]], ["Plan", ["Plan"]], ["Tickets", ["Tickets"]], ["Insights", ["Insights"]],
    ["Settings › Company", ["Settings"]], ["Settings › Devices", ["Settings", "Devices"]], ["Settings › TROTAN", ["Settings", "TROTAN"]], ["Settings › Access", ["Settings", "Access"]]] },
  trotan: { url: "/trotan", screens: [["Manage", []], ["Design", [(p) => p.getByTestId("ws-design")]], ["Prepare", [(p) => p.getByTestId("ws-prepare")]], ["Produce", [(p) => p.getByTestId("ws-produce")]], ["Administration", [(p) => p.getByTestId("ws-admin")]], ["Account", [(p) => p.getByTestId("account")]]] },
};
const b = await chromium.launch(); const all = [];
const jobs = [];
for (const [app, def] of Object.entries(SCREENS)) { if (ONLY && ONLY !== app) continue; for (const [screen, steps] of def.screens) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) jobs.push({ app, screen, steps, url: def.url, viewport }); }
const worker = async () => { for (let j; (j = jobs.shift()); ) {
  const t0 = Date.now();
  const issues = await crawlScreen({ browser: b, app: j.app, screen: j.screen, viewport: j.viewport, maxControls: j.viewport.width < 500 ? 0 : 80,
    newPage: async (vp) => { const { page } = await context(b, richSeed(), { w: vp.width, h: vp.height }); return page; },
    open: async (p) => { await p.goto(BASE + j.url); await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(600); await nav(p, j.steps); } }).catch((e) => [{ app: j.app, screen: j.screen, viewport: j.viewport.width, kind: "screen-failed", detail: String(e.message).split("\n")[0] }]);
  all.push(...issues); console.log(`${j.app} › ${j.screen} @${j.viewport.width}: ${issues.length} findings (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
} };
await Promise.all([worker(), worker(), worker(), worker()]);
await b.close();
const rows = report(all, `${OUT}/audit-web${ONLY ? "-" + ONLY : ""}`);
console.log(`\n${rows.length} distinct findings → ${OUT}/audit-web${ONLY ? "-" + ONLY : ""}.md`);
