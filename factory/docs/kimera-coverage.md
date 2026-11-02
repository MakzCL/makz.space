# KIMERA — feature coverage matrix (Katana reference)

Audit date: 2026-11-02 · baseline commit `34f9539` (live app = `843bb16`)
Method: read `supabase/schema.sql` (2,237 lines, every table/function/policy/trigger),
`src/kimera/*`, `src/screens/{Inventory,Purchasing,Production,Jobs}.tsx`,
`src/lib/{store,types,roles,csv}.ts*`, `supabase/functions/*`; ran the schema test
suite (local Postgres 16, 188 checks — **ALL PASSED**), `tsc -b` (clean) and
`vite build` (ok); queried the live database (438 items, 448 recipe lines, 19 demo
orders / 23 lines, 3 jobs, 0 POs, 0 suppliers, 414 movements, 0 negative stock).

Status key: **Complete** = core workflow works end to end with persistent data ·
**Partial** = real but incomplete · **Missing** · **Broken** = exists but gives wrong
results · **Unverified** = cannot be established from here.
Action key: **Reuse / Extend / Repair / Implement**.

## Existing building blocks (reuse — do not duplicate)

| Block | Where | Notes |
| --- | --- | --- |
| Item catalogue | `stock_items` (sku unique, kind material/product/part, category, unit, sale_price, avg_cost, supplier_id, supplier_code, lead_days, min_quantity, make_min/make_batch, archived) | Variants = one row per SKU (Shopify variant SKUs) |
| Stock ledger | `move_stock()` — the only writer of `quantity`/`avg_cost` (guarded by `guard_stock_qty` trigger); rows in `stock_movements` (delta, after, reason, ref, note, unit_cost, user_id, job_id) | Row lock `FOR UPDATE` per item → no lost updates |
| Recipes | `bom_lines` (product_id → material_id, qty numeric(14,4)) | Single level; sub-assemblies are items with their own recipe |
| Manufacturing | `jobs` (= MOs: code, sku, quantity, priority 1-5, status, route of `stations`, stage, due_date, order_id/order_line_id), `book_job_stock` trigger, `create_mo`, `complete_mo`, `reopen_mo`, `replenish` | Exact reversal on reopen via job_id-linked movements |
| Shop floor | Factory app Jobs/Home: work_sessions, participants (live team time), job_steps (per-station completion) | Mobile PWA |
| Sales | `orders` (kind quote/order, status, delivery state, deadline, source) + `order_lines`; `set_delivery`, `convert_quote` | Client-side status engine `src/kimera/status.ts` |
| Purchasing | `purchase_orders` + `po_lines`, `receive_po_line()` (partial, moving average cost) | |
| Integration | Edge function `shopify-webhook` (HMAC) → `ingest_shopify_order()` (idempotent on Shopify ids) | Secret not set → awaiting setup |
| Auth / roles | Supabase Auth, `profiles.role` boss/manager/office/assistant/support/operator, `is_admin()`, `is_stock_keeper()`, `is_lead()`, RLS on every table | Join links with PIN |
| Import/export | `lib/csv.ts`, `ImportSheet` (column mapping) → `import_items`, `import_bom`; CSV exports of items, history, orders | |

## Defects found by the audit (fix before building on top)

| # | Defect | Effect | Fix (phase 1) |
| --- | --- | --- | --- |
| D1 | `stock_movements.item_id … on delete cascade` | Deleting an item silently erases its posted ledger history | Restrict delete when movements exist; archive instead |
| D2 | Outgoing movements (consume, ship, adjust −) store no `unit_cost`; production output is posted without cost | Product `avg_cost` never reflects build cost; historic valuation/COGS cannot be rebuilt from the ledger | Every movement records the cost it moved at; output costed from the MO's consumed materials |
| D3 | Make-to-order MOs consume materials but never post the product; shipping skips MO lines | MTO products have no cost, no ledger trail from production to customer (blocks INV-13, REP-01 margin) | MTO output goes to stock, shipping takes it out per line |
| D4 | `receive_po_line` accepts draft POs, any over-receipt, and a repeated click receives twice | Phantom stock; double receipts | Must be ordered; idempotency key; over-receipt needs explicit flag |
| D5 | PO cost in supplier currency is averaged into base-currency cost without conversion | Wrong valuation for non-GBP suppliers | PO currency + exchange rate, cost converted to base |
| D6 | `jobs.quantity` is `int`; `create_mo` does `ceil()` | 0.5 m cable MO silently becomes 1 | numeric(14,3) |
| D7 | `adjust_stock` not idempotent; no generic audit trail of who changed orders/POs/recipes/prices | Duplicate adjustments; no accountability | Idempotency keys; `audit_log` + triggers |
| D8 | Allocation runs only in the browser; MO ingredient check is not priority-ranked (every MO sees the same "available") | Double promising; two users can promise the same stock | Server-side reservations (phase 3) |
| D9 | `avg_cost`, `sale_price`, values readable by every signed-in user via the API (`select using (true)`) | Operators can read costs/margins | Column privileges + cost view (phase 2) |

## A. Items and master data

| ID | Status | Evidence | Works / missing | Action | Depends · acceptance |
| --- | --- | --- | --- | --- | --- |
| CAT-01 | **Complete** (P1) | kinds material/product/part/**service**; `move_stock` refuses services; Items → Products tab | Services sell without stock; tested | — | ✔ test "services never move stock" |
| CAT-02 | Partial | sku unique, category, search box + category filter (`Inventory.tsx` 124-125) | No variant grouping (parent product + option values) | Extend: `product_id` group + options jsonb | Variants listed under one product; each keeps own SKU/recipe |
| CAT-03 | Partial | sale_price, avg_cost, stock value column; PO unit_cost | Margin not shown per item/order; costs visible to all roles (D9); no default purchase price | Extend | Margin = price − cost shown only to cost-permitted roles |
| CAT-04 | Partial | `suppliers` with open-PO count; customers = free text on `orders` | No customer records or history | Implement `customers`, link orders, backfill from text | Customer sheet lists all their orders |
| CAT-05 | Partial | one `supplier_code` per item | No multiple supplier refs, no barcode | Extend: `item_suppliers`, `barcode` column | Scan barcode finds item |
| CAT-06 | Partial | `bom_lines` per SKU row (= variant level) | No yield/waste, no versions | Reuse; extend later | — |
| CAT-07 | Partial | `lead_days` per item; `currency` text on supplier/order | No tax rates, no base currency setting | Implement `settings` + `tax_rates` | Order totals with tax |
| CAT-08 | Partial | `ImportSheet` CSV with column mapping → `import_items` / `import_bom`; exports items/history/orders | Row-level validation report & dry-run preview not shown; no customer/supplier/PO import | Extend: dry-run mode returning per-row errors | Bad rows listed before commit; nothing written on dry run |

## B. Inventory and traceability

| ID | Status | Evidence | Works / missing | Action | Depends · acceptance |
| --- | --- | --- | --- | --- | --- |
| INV-01 | Partial | `stock_items.quantity` live (realtime store) | Single location only; `location` is free text | Extend: `locations` + per-location balances under the same ledger | Sum of location balances = item total |
| INV-02 | Partial | `stockLevels()` (client): committed = BOM of open MOs, expected = open PO lines | SO demand not reserved; definitions undocumented; client-only | Repair → server view `item_availability` | Definitions below; same numbers in UI and API |
| INV-03 | Partial | receive (+reversal), consume, produce (MTS **and MTO**), ship per line (+undo), **return**, adjust, count | Transfers missing (phase 3) | Extend | Each source posts via `move_stock` |
| INV-04 | Partial | `ref`, `job_id` + **`source_type`/`source_id`** (po_line, order_line, job, return, adjustment) | History UI does not yet link through to the document | Extend UI | Click movement → document |
| INV-05 | Missing | — | — | Implement `locations` (warehouse / production / partner) | — |
| INV-06 | Missing | — | — | Implement transfers (dispatch → in transit → received) | Scenario 6 |
| INV-07 | Missing | text `location` only | — | Implement bins under locations | — |
| INV-08 | Partial | `adjust_stock`, `count_stock` with note | No stocktake session / discrepancy review | Extend: stocktake documents | Counted vs expected diff posted on approval |
| INV-09 | Partial | `min_quantity` (reorder point), `make_min/make_batch` auto MTS MOs | No auto PO; no safety-stock vs reorder distinction | Extend (planning) | — |
| INV-10 | Missing | — | — | Implement `lots` + lot on movements | Scenario 7 |
| INV-11 | Missing | — | — | Implement serials | — |
| INV-12 | Missing | — | — | Expiry on lots | — |
| INV-13 | Missing | job_id links consumption to MO only | No lot genealogy, MTO break (D3) | Implement after INV-10 | Scenario 7 |
| INV-14 | Missing | — | — | Implement barcode field + scanner input | — |
| INV-15 | Partial | moving average; **every movement stores its unit cost**; output costed from consumption; FX converted; value = Σ delta × unit_cost (tested) | No valuation report by date yet | Extend (reports) | ✔ scenario 12 |

**INV-02 definitions (to implement):** *On hand* = Σ posted ledger deltas. *Committed* =
open reservations (SO lines not yet shipped + MO ingredients not yet consumed).
*Expected* = open PO lines outstanding + open MOs' output + transfers in transit to the
location. *Available* = on hand − committed. *Projected(t)* = on hand + expected due ≤ t − committed due ≤ t.

## C. Smart allocation

| ID | Status | Evidence | Works / missing | Action |
| --- | --- | --- | --- | --- |
| ALLOC-01 | Partial | `status.ts analyse()` allocates finished stock to open SOs by date | Client-only, materials not ranked (D8) | Repair → server allocation |
| ALLOC-02 | Missing | rank = `ordered_at` only | No reorder | Implement `rank` + drag/move |
| ALLOC-03 | Partial | In stock / Expected / Not available / Made / Processed cells | No explanation of why | Extend with reason text |
| ALLOC-04 | Missing | — | — | MO rank follows SO rank for MTO |
| ALLOC-05 | Partial | MO priority 1-5 editable | Not used by allocation | Extend |
| ALLOC-06 | Broken | no reservations; all MOs see same available | Double promising possible | Repair (scenario 13) |
| ALLOC-07 | Partial | Sell "Not available", Plan "To buy", MO ingredients | No shared shortage list | Extend |

**Allocation policy (deterministic, to implement in phase 3):** one queue per item per
location. Demand = open SO lines (not shipped), MO ingredient lines (not consumed),
transfer lines (not dispatched), outsourced-PO supplied materials (not sent). Sort key:
(1) explicit `rank` (lower first; MTO MO inherits its SO's rank), (2) required date,
(3) created_at, (4) id. Supply consumed in order: on hand at that location, then
expected supply by expected date. Picked/reserved quantities are fixed and leave the
pool before ranking. Recalculated on every change, in one transaction under an
advisory lock per item, so concurrent requests serialise.

## D. Sales

| ID | Status | Evidence | Works / missing | Action |
| --- | --- | --- | --- | --- |
| SALES-01 | Partial | manual SO/quotes (Sell); Shopify ingest | Shopify secret not set → live channel **Unverified / awaiting setup** | Reuse |
| SALES-02 | Partial | customer text, deadline, lines, prices, status | No location, no tax | Extend |
| SALES-03 | Partial | client readiness cells | Not based on reservations | Repair (with ALLOC) |
| SALES-04 | Missing | — | — | Implement rank |
| SALES-05 | **Complete** (P1) | `order_lines.shipped`, `ship_lines()`, `unship_lines()`, state `partially_shipped`, Kimera order sheet → Fulfilment panel | — | ✔ scenario 8 |
| SALES-06 | **Complete** (P1, core) | `return_lines()`, `order_returns`, restock at shipped cost or scrap (no stock), Fulfilment panel | No RMA approval step / refund link | ✔ scenario 8 |
| SALES-07 | Missing | — | — | Implement kits (BOM exploded at ship) |
| SALES-08 | **Complete** (P1) | service items + free-text lines ship without stock | — | ✔ |
| SALES-09 | Missing | — | — | `custom` jsonb + settings schema |
| SALES-10 | Partial | `create_mo` from line; Shopify MOs per line; **MTO output costed, on stock, reserved for its line, leaves on ship** | Priority sync (ALLOC-04) | — |
| SALES-11 | Partial | Shopify orders in only | No inventory push | Extend later |
| SALES-12 | Missing | manual tracking field | No sync to channel | Implement with connector |

## E. Purchasing

| ID | Status | Evidence | Works / missing | Action |
| --- | --- | --- | --- | --- |
| BUY-01 | Partial | PO + supplier | No receiving location | Extend |
| BUY-02 | Partial | expected_date, lead_days, statuses, late flag | — | Reuse |
| BUY-03 | **Complete** (P1) | partial receive, outstanding, draft blocked, over-receipt needs confirmation, idempotent key, `reverse_po_receipt()` | — | ✔ scenario 1 |
| BUY-04 | Partial | updates stock & avg cost | No batch/serial | Extend after INV-10 |
| BUY-05 | Partial (P1 repaired) | PO `currency` + `fx_rate` (manual, fixed when ordered), cost converted to base | No automatic rate feed | ✔ test "EUR receipt converted" |
| BUY-06 | Partial | Plan "To buy" | Not date-phased | Extend |
| BUY-07 | Partial | draft PO from Plan | — | Reuse |
| BUY-08 | Partial | PO list / supplier counts | No insights | Extend (reports) |
| BUY-09 | Missing | — | — | Implement (OUT) |

## F. Manufacturing

| ID | Status | Evidence | Works / missing | Action |
| --- | --- | --- | --- | --- |
| MFG-01 | Partial | MTS/MTO MOs; MTO output now posted; **fractional quantities** | Allocation (phase 3) | — |
| MFG-02 | Partial | sub-assembly = own recipe + own MO; Plan "Sub-assemblies to build" (tested pedestal→frame→screws) | No automatic linked sub-MOs | Extend |
| MFG-03 | Partial | priority + due sort in Make | No queue ranking | Extend |
| MFG-04 | Partial | `moIngredients()` | Not ranked (D8) | Repair |
| MFG-05 | Partial | open/in_progress/paused/blocked/done + route stage | — | Reuse |
| MFG-06 | Partial | stations + station_members auto-assign | No resource capacity | Extend |
| MFG-07 | Partial | sequential station route | No simultaneous steps | Extend |
| MFG-08 | Missing | estimate_minutes only | — | Implement operation costs |
| MFG-09 | Missing | — | — | Implement |
| MFG-10 | Missing | — | — | Implement picking (reservation → picked) |
| MFG-11 | Partial | backflush recipe × qty on done | No actual qty override | Extend |
| MFG-12 | Missing | — | — | Implement |
| MFG-13 | Missing | — | — | Implement |
| MFG-14 | Partial | material cost per MO from its consume movements (tested 7.35) | Operation/labour costs (phase 4) | — |
| MFG-15 | Partial | work_sessions / participants person-time per job | Not costed | Extend |
| MFG-16 | Partial | Factory app Jobs (phone) | — | Reuse |
| MFG-17 | Partial | tasks, stage progress, time | No consumption/output entry | Extend |
| MFG-18 | Missing | — | — | Implement |

## G. Outsourced manufacturing — OUT-01 … OUT-06: **Missing** (no partner locations,
no outsourced POs). Depends on INV-05/06. Implement as PO kind `outsourced` +
partner location + supplied-materials transfer.

## H. Warehouse

| ID | Status | Notes |
| --- | --- | --- |
| WH-01 | Partial | Factory app Stock tab works on phones (adjust/count/receive) — no task-based workspace |
| WH-02 / WH-03 | Missing | no warehouse tasks |
| WH-04 / WH-05 | Missing | no barcode |
| WH-06 | Missing | no bins |
| WH-07 | Partial | partial receive yes, partial fulfilment no |
| WH-08 | Missing | |
| WH-09 | Partial | realtime store (`lib/supa.ts subscribe`) refreshes all screens |
| WH-10 | Missing | |

## I. Planning — PLAN-01..05, 07, 08: **Missing**; PLAN-06: **Partial** (Plan "To make /
To buy" quantities, no timing). Forecast method to implement: weekly buckets, simple
moving average of the last N weeks of shipped quantities (N shown), manual overrides
stored separately and always shown as "manual". No forecast without ≥ 8 weeks history
unless manual.

## J. Reporting

| ID | Status | Notes |
| --- | --- | --- |
| REP-01 | Partial | Insights tiles (sales value); no profit (D2/D3) |
| REP-02 | Partial | Inventory list with value; History |
| REP-03 | Missing | |
| REP-04 | Missing | |
| REP-05 | Partial | History filterable by reason |
| REP-06 | Partial | Factory Insights person-hours |
| REP-07 | Partial | sorting/filter on lists; little drill-through |
| REP-08 | Partial | CSV exports |
| REP-09 | Unverified | nothing reconciles today; scenario 12 will |

## K. Integrations

| ID | Status | Notes |
| --- | --- | --- |
| INT-01 | Partial | Edge function + SQL ingest pattern; no connector registry / event log |
| INT-02 | Partial | Shopify orders/create+paid, custom (native code), HMAC, idempotent; **awaiting SHOPIFY_WEBHOOK_SECRET**; WooCommerce/BigCommerce missing |
| INT-03 / 04 / 05 | Missing | |
| INT-06 | Partial | Supabase REST/RPC with user JWT + RLS = internal API; no API keys |
| INT-07 / 08 / 09 / 10 | Missing | |

## L. Administration

| ID | Status | Notes |
| --- | --- | --- |
| ADMIN-01 | Complete | join links + PIN + role, activate/deactivate, role changes guarded (`guard_profile_update`), tested |
| ADMIN-02 | Partial | 6 roles; no dedicated warehouse operator |
| ADMIN-03 | **Complete** (P2B) | server-side cost hiding + Costs & margins permission |
| ADMIN-04 | Partial | writes gated by role in RLS + RPC checks; delete guards on posted stock; **audit_log** (admins read) — no per-area permissions yet |
| ADMIN-05 | Missing | |
| ADMIN-06 | Missing | |
| ADMIN-07 | Partial | CSV only; no PDFs/labels |
| ADMIN-08 | Partial | CSV import with mapping; no dry-run report |

## Acceptance scenarios — current state

| # | Scenario | Today |
| --- | --- | --- |
| 1 | Partial PO receive | ✔ **passes** (60/100, outstanding 40, on hand 60, replay no-op) |
| 2 | Competing SOs + priority | Not possible (no rank, no reservations) |
| 3 | MTO with missing component | ✔ receive → build SUB → build MTO unit → ship (costs 7.15 / 7.35 asserted); shortage *explanation* waits for phase 3 |
| 4 | Sub-assembly no double count | ✔ passes (screws 100 → 92 → 90, never double) |
| 5 | Pick, partial complete, reconcile | Not possible |
| 6 | Transfer | Not possible |
| 7 | Lot trace | Not possible |
| 8 | Partial ship + return | ✔ passes (ship 3/5, return 1 restock + 1 scrap → on hand +1) |
| 9 | Replayed event | ✔ Shopify ingest, receive, ship, adjust keys replayed → one movement |
| 10 | Restricted action UI + API | ✔ API: operator denied ship/return/receive/reverse/audit/settings; UI hides the same actions for non-office roles |
| 11 | Forecast update | Not possible |
| 12 | Valuation reconciliation | ✔ passes for every test item (|qty×avg − Σ delta×cost| < 0.01) |
| 13 | Concurrent allocation | ✔ `tests/concurrency.sh`: 20 parallel −1 on 20 → 0 with 20 movements; 10 parallel same-key receipts → 1. *Reservation* races wait for phase 3 |

## Phased plan (adjusted to what exists)

1. **Foundations (repair)** — D1–D7: ledger keeps history, every movement costed,
   MTO output posted, idempotent receive/adjust, PO currency, fractional MO qty,
   audit log, per-line shipped quantity (→ SALES-05). Tests: scenarios 1, 3, 4, 9, 12.
2. **Master data & permissions** — customers (CAT-04), service items (CAT-01/SALES-08),
   barcodes + supplier refs (CAT-05/INV-14), settings: base currency, tax rates
   (CAT-07/ADMIN-06), cost-hiding (ADMIN-03), import dry-run (CAT-08/ADMIN-08).
3. **Locations & allocation** — locations, bins, per-location balances, transfers
   (INV-05/06/07, scenario 6), server reservations + rank (ALLOC-*, SALES-03/04,
   scenarios 2 and 13), returns (SALES-06, scenario 8).
4. **Manufacturing depth** — picking, partial completion, unused materials, operation
   costs, cost roll-up (MFG-08..14, scenario 5), lots/serials/expiry + genealogy
   (INV-10..13, scenario 7), outsourcing (OUT-*).
5. **Warehouse & shop floor** — task lists, scanning (WH-*, MFG-17/18).
6. **Planning, reporting, integrations, AI** — projections + forecast (PLAN-*,
   scenario 11), reports (REP-*), API keys + outbound webhooks (INT-06/07/08),
   accounting connector after you choose QuickBooks or Xero.

Progress is recorded below as phases land.

## Rules: cancel, reverse, reopen, delete (phase 1, enforced in the database)

| Action | Stock effect | Cost effect | Allowed when |
| --- | --- | --- | --- |
| Reverse PO receipt | − qty at the receipt's base cost (`receive`, note "Receipt reversed") | average unwound exactly | qty ≤ received, PO not cancelled |
| Cancel PO | none — received goods stay; outstanding stops counting as expected | none | any time (receipts remain in the ledger) |
| Delete PO / PO line | — | — | **only if nothing received** |
| Reopen MO | output taken back, materials returned, each at the cost it was booked at | product average unwound | MO done |
| Delete MO | — | — | **only if no stock booked** (reopen first) |
| Undo shipment | + qty at the cost it left at | none | not returned; per line or whole order |
| Return | restock: + qty at shipped cost; scrap: none (recorded on the line) | none | qty ≤ shipped − returned |
| Cancel SO | none | none | **only if nothing is still with the customer** |
| Delete SO / SO line | — | — | **only if nothing shipped** |
| Delete item | — | — | **only if it has no movements** (archive instead) |

Retries: `adjust_stock`, `receive_po_line`, `reverse_po_receipt`, `ship_lines`,
`unship_lines`, `return_lines` take an idempotency key (`op_keys`); the UI sends one
key per intent and disables the button while it runs.

## Progress log

- 2026-11-02 — audit complete (this document).
- 2026-11-02 — **Phase 1 (foundations) done locally — not yet published.**
  - Reused: `move_stock` ledger, `book_job_stock`, `receive_po_line`, `set_delivery`, order sheet, PO sheet.
  - Repaired: D1 history kept (restrict + friendly guard), D2 costed movements, D3 MTO output,
    D4 receiving rules + keys, D5 currency, D6 fractional MOs, D7 keys + audit log.
  - New: `company_settings` (base currency), service items, `ship_lines`/`unship_lines`/`return_lines`,
    `order_returns`, `reverse_po_receipt`, `audit_log`, delete/cancel guards, Fulfilment panel,
    PO currency + rate, reverse-receipt button.
  - Tests: `schema.test.sql` 235 checks ALL PASSED (was 188; 2 expectations changed on purpose:
    MTO output now goes on stock until shipped); `tests/concurrency.sh` PASSED; `tsc` clean;
    `vite build` ok; browser smoke (mocked API): order sheet + PO sheet render with no errors,
    double-click sends one request.
  - Still open from the audit: everything not marked ✔ above.

- 2026-11-02 — **Phase 1 published** (DB migration `kimera_phase1_ledger_foundations`, Pages deploy `615d3338` of `b049ee9`).
  Restore point: schema `backup_20261102_phase1` (38 tables) + branch `backup/pre-phase1-2026-11-02` (= `843bb16`).
- 2026-11-02 — **Phase 2 part A done locally (`7f4f899`) — not yet published.**
  - CAT-04 → **Complete**: `customers`, auto-link on every order insert (e-mail, else name+company), backfill, Sell → Customers with order history, customer picker on new orders.
  - CAT-07 / SALES-02 → Partial→ mostly complete: `tax_rates`, per-line `tax_rate` snapshot, customer default rate, net/VAT/total, prices-include-VAT. (Shopify orders: tax not yet read from the payload.)
  - CAT-05 → **Complete** (core): unique `barcode`, scannable in pickers, `item_suppliers` (code, price, lead time, preferred), PO line default price.
  - CAT-08 / ADMIN-08 → **Complete** (core): `check_import()` dry run with per-row problems/changes; only clean rows imported.
  - ADMIN-06 → Partial: Kimera → Settings (base currency + lock, default lead time, tax rates). Locations/workflows wait for phase 3.
  - ADMIN-04 → Partial: activity log viewer (`recent_activity()`, office only).
  - Tests: 259 schema checks ALL PASSED; tsc clean; build ok; browser smoke of Customers, customer sheet, order VAT, Settings (company/tax/activity), item sheet — no errors.
  - Remaining in phase 2: ADMIN-03 (hide costs/prices from operators at the API), INV-04 drill-through, Shopify tax/currency mapping.

- 2026-11-02 — **Phase 2 part A + Developer role published** (migrations `developer_role_enum`, `kimera_phase2_master_data_developer_role`; deploy `32285036` of `1cad042`). Restore point: `backup_20261102_phase2` + branch `backup/pre-phase2-2026-11-02`. Karol Kuklinski → Developer (same full access as Owner).
- 2026-11-02 — **Kimera section access published** (ADMIN-02/04): Settings → Access, owner-only `set_kimera_access()`, `kimera_access` per role; nav, deep links and Create menu follow it; Kimera gate now uses it (support can open Kimera). Defaults: manager/office all; assistant/support all but Insights & Settings; operator none. Migration `kimera_section_access`, deploy of `6158a10`. Restore point: `backup_20261102_access` + branch `backup/pre-access-2026-11-02`. Note: this hides sections in the app; protecting cost/price *data* at the API is ADMIN-03 (next).

- 2026-11-02 — **Phase 2 part B done locally — not yet published.**
  - ADMIN-03 → **Complete** (core): cost columns (`stock_items.avg_cost`, `stock_movements.unit_cost`, `po_lines.unit_cost`, `item_suppliers.unit_cost`) are not readable through the API (column privileges, `apply_cost_privileges()`); `my_costs()` releases them only to roles with the new **Costs & margins** permission (Settings → Access), PO/supplier prices also to roles with Buy. UI hides cost columns, stock value, Insights stock value; import check masks cost changes.
  - INV-04 → **Complete**: every stock movement's reference opens its purchase order, sales order or manufacturing order in Kimera (`lib/doclink.tsx`), using `source_type/source_id`, falling back to the reference text for older rows.
  - Questions list kept in `docs/open-questions.md` + `docs/open-questions.pdf` (regenerate: `node docs/tools/md2pdf.cjs docs/open-questions.md docs/open-questions.pdf`).
  - Tests: 280 schema checks ALL PASSED; concurrency PASSED; tsc clean; build ok; browser: Developer sees Avg cost/Value, Support does not; movement links open the source document.
  - Still open in phase 2: Shopify VAT/currency mapping (waits for question 17). Sales-price hiding waits for question 18.

- 2026-11-02 — **ADMIN-03 published** (app deploy `efcfffa` first, then migration `kimera_costs_hidden_admin03`). Restore point: `backup_20261102_costs` + branch `backup/pre-costs-2026-11-02`.
- 2026-11-02 — **Phase 3 (3a + 3b) done locally — not yet published.**
  - INV-01 → **Complete**: stock per item per location (`stock_levels`), stock list location filter, item sheet "By location".
  - INV-05 → **Complete** (core): `locations` (warehouse / production / partner), Settings → Locations. INV-07 → Partial: bin per item per location (`set_bin`), no bin master list yet.
  - INV-06 → **Complete**: `stock_transfers` + lines, dispatch → In transit → receive / cancel (idempotent, locked once posted), Stock → Transfers. ✔ scenario 6.
  - POs receive into a location, sales orders ship from one, MOs are made at one (pickers on each sheet); adjust / count at a location.
  - ALLOC-01/02/03/05/06/07, SALES-03/04, MFG-04 → **Complete** (core): `availability()` server allocation (policy at the top of the phase 3b section in schema.sql), `set_rank()` + arrows in Sell and Make, status + reason on every line/MO. ALLOC-04 → Complete: MTO MOs use their order's rank. ✔ scenario 2.
  - No over-shipping: shipping/dispatch can't overdraw a location; concurrent last-unit shipments → exactly one. ✔ scenario 13.
  - Tests: 313 schema checks ALL PASSED; concurrency (incl. last-unit race) PASSED; tsc clean; build ok; browser smoke of Transfers, transfer sheet, Sell with ranks + server statuses — no errors.

## Next steps (continuation plan)

1. **Publish phase 1** when you say so: backup schema `backup_<date>_phase1`, branch
   `backup/pre-phase1-<date>` at the live commit, apply the new schema section as one
   migration, deploy Pages.
2. **Phase 2:** customers table + backfill from order text (CAT-04), barcode + supplier refs
   (CAT-05), tax rates & order tax (CAT-07/SALES-02), hide costs/margins from operators at
   the API (ADMIN-03, D9), import dry-run with per-row errors (CAT-08/ADMIN-08), audit log
   viewer in Kimera Settings, movement drill-through (INV-04).
3. **Phase 3:** locations/bins/transfers + server reservations by rank (scenarios 2, 6, 13b).
