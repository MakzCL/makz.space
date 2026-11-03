// Kortana: price lists → customer pricing on sales-order lines (with a quantity break), purchase units and additional costs on a PO.
// Mocked backend (tests/trotan/mock.mjs). Run: npm run build ; npx vite preview --port 4173   then   node tests/katana.e2e.mjs [shotsDir]
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import { randomUUID } from "node:crypto";
import { context, seed } from "./trotan/mock.mjs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const BASE = process.env.APP_URL ?? "http://localhost:4173"; const SHOTS = process.argv[2];
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`); const now = () => new Date().toISOString();
const D = seed();
const wid = { id: randomUUID(), sku: "WID-1", name: "Widget", kind: "product", category: "", location: "", unit: "pcs", quantity: 50, min_quantity: 0, sale_price: 20, archived: false, tracking: "none", created_at: now() };
const scr = { id: randomUUID(), sku: "SCR-M3", name: "Screw M3", kind: "material", category: "", location: "", unit: "pcs", quantity: 0, min_quantity: 0, sale_price: null, archived: false, tracking: "none", created_at: now() };
const sup = { id: randomUUID(), name: "Bolt Supply", currency: "GBP", email: "", phone: "", notes: "", created_at: now() };
D.stock_items.push(wid, scr); D.suppliers = [sup]; D.customers = [{ id: randomUUID(), name: "Trade Buyer", company: "", email: "", phone: "", address: "", tax_rate_id: null, notes: "", archived: false, price_list_id: null, created_at: now() }];
D.item_suppliers = [{ id: randomUUID(), item_id: scr.id, supplier_id: sup.id, supplier_sku: "B-M3", unit_cost: 0.05, lead_days: 3, preferred: true, purchase_unit: "box", units_per_purchase: 100, created_at: now() }];
D.orders = []; D.order_lines = []; D.purchase_orders = []; D.po_lines = []; D.po_costs = []; D.price_lists = []; D.price_list_items = []; D.company_settings = [{ id: randomUUID(), order_fields: [], created_at: now() }];
D.kimera_access = [];
const b = await chromium.launch();
try {
  const { page: p, errors } = await context(b, D);
  p.on("dialog", (d) => d.accept().catch(() => {}));
  await p.goto(`${BASE}/kimera`); await p.getByText("Sell", { exact: true }).first().click();
  await p.getByText("Price lists", { exact: true }).first().click(); await p.getByTestId("price-lists").waitFor();
  await p.getByTestId("pl-name").fill("Trade"); await p.getByRole("button", { name: "Add", exact: true }).first().click();
  await p.waitForFunction(() => document.querySelector("[data-testid=price-lists] .card")); 
  const pick = async (scope, text) => { const inp = scope.locator("input[list]").last(); await inp.fill(text); };
  await pick(p.getByTestId("price-lists"), "WID-1 — Widget"); await p.getByTestId("pl-price").fill("15"); await p.getByRole("button", { name: "Add price" }).click();
  await p.getByText("No prices yet").waitFor({ state: "detached" });
  await pick(p.getByTestId("price-lists"), "WID-1 — Widget"); await p.getByTestId("pl-qty").fill("10"); await p.getByTestId("pl-price").fill("12.5"); await p.getByRole("button", { name: "Add price" }).click();
  await p.waitForFunction(() => document.querySelectorAll("[data-testid=price-lists] tbody tr").length === 2);
  assert.deepEqual(D.price_list_items.map((x) => [x.min_qty, x.price]).sort(), [[1, 15], [10, 12.5]]);
  step("price list Trade: Widget £15, from 10 pcs £12.50");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/kortana-price-list.png` });
  // customer gets the list
  await p.getByText("Customers", { exact: true }).first().click(); await p.getByText("Trade Buyer").first().click();
  await p.getByTestId("customer-price-list").selectOption({ label: "Trade" }); await p.getByRole("button", { name: /^Save/ }).first().click();
  await p.waitForFunction(() => true); await new Promise((r) => setTimeout(r, 600));
  assert.equal(D.customers[0].price_list_id, D.price_lists[0].id); step("customer Trade Buyer uses the Trade price list");
  await p.keyboard.press("Escape");
  // a sales order line takes the list price, then the quantity break
  await p.getByText("Sales orders", { exact: true }).first().click(); await p.getByRole("button", { name: "Sales order" }).click();
  await p.locator("input[list^=cust-]").fill("Trade Buyer"); await p.getByRole("button", { name: "Create and add items" }).click();
  const orderPanel = p.locator(".sheet, [role=dialog]").last(); await p.waitForFunction(() => document.querySelectorAll("input[list^=items-]").length > 0);
  await p.locator("input[list^=items-]").last().fill("WID-1 — Widget");
  const priceIn = p.getByRole("textbox", { name: "Price" }).last(); await assert.doesNotReject(async () => { await p.waitForFunction(() => [...document.querySelectorAll("input[aria-label=Price]")].some((i) => i.value === "15")); });
  step("adding Widget for Trade Buyer suggests £15 from the price list (sale price is £20)");
  await p.getByRole("textbox", { name: "Quantity" }).last().fill("10"); await p.waitForFunction(() => [...document.querySelectorAll("input[aria-label=Price]")].some((i) => i.value === "12.5"));
  await p.getByRole("button", { name: "Add", exact: true }).last().click(); await p.waitForFunction(() => true); await new Promise((r) => setTimeout(r, 600));
  assert.equal(D.order_lines.at(-1).unit_price, 12.5); assert.equal(D.order_lines.at(-1).quantity, 10);
  step("10 pcs take the quantity-break price £12.50; the line is saved at £12.50");
  void orderPanel; void priceIn; await p.keyboard.press("Escape");
  // purchase order in boxes of 100, then freight
  await p.getByText("Buy", { exact: true }).first().click(); await p.getByText("Purchase orders", { exact: true }).first().click();
  await p.getByRole("button", { name: "New purchase order" }).click(); await p.waitForFunction(() => document.querySelectorAll("select").length > 0);
  const po = D.purchase_orders.at(-1); assert.ok(po);
  await p.locator("select").filter({ has: p.locator("option", { hasText: "Bolt Supply" }) }).first().selectOption({ label: "Bolt Supply" });
  await new Promise((r) => setTimeout(r, 500)); assert.equal(D.purchase_orders.at(-1).supplier_id, sup.id);
  await p.locator("input[list^=items-]").last().fill("SCR-M3 — Screw M3");
  await p.getByText("in box (100)").waitFor(); await p.waitForFunction(() => [...document.querySelectorAll("input[aria-label='Unit cost']")].some((i) => i.value === "5")); // £0.05/pc supplier price shown per box
  await p.getByRole("textbox", { name: "Quantity" }).last().fill("2"); await p.getByRole("button", { name: "Add", exact: true }).last().click();
  await p.waitForFunction(() => true); await new Promise((r) => setTimeout(r, 600));
  const line = D.po_lines.at(-1); assert.equal(line.quantity, 200); assert.equal(line.unit_cost, 0.05); assert.equal(line.purchase_unit, "box"); assert.equal(line.units_per_purchase, 100);
  await p.getByText("= 2 box").waitFor();
  step("2 boxes of 100 at £5 a box → 200 pcs at £0.05 each; the PO shows “= 2 box”");
  await p.getByTestId("po-cost-label").fill("Freight"); await p.getByTestId("po-cost-amount").fill("4"); await p.getByRole("button", { name: "Add cost" }).click();
  await p.getByTestId("po-costs").getByText("£0.07").first().waitFor();
  assert.equal(D.po_costs.length, 1); assert.equal(D.po_costs[0].amount, 4);
  step("£4 freight added: each screw now costs £0.05 + £0.02 = £0.07 when received");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/kortana-po-costs.png` });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("\nKortana price lists e2e: passed");
} finally { await b.close(); }
