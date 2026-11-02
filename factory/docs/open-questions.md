# Kimera — questions for Skalarki

Answers decide how the next phases are built. Until they come in, I use the
default shown in brackets. Every default can be changed later.

## Needed soon (blocks a connector or a go-live)

1. **Accounting:** QuickBooks Online, Xero, or neither for now?
   *(Default: no accounting connector; CSV exports only.)*
2. **Shopify webhook secret:** Shopify admin → Settings → Notifications → Webhooks → the "signed by" key.
   Kimera can't receive real Shopify orders until it's set.
3. **Shopify sync direction:** besides taking orders in, should Kimera
   - (a) push stock levels back to Shopify, and
   - (b) mark orders fulfilled in Shopify with the tracking number?
   *(Default: orders in only.)*
4. ~~**Publish phase 1?**~~ Answered: Phase 1, Phase 2 and the Access dashboard are live.

## Shapes the next phases

5. **Locations:** which stock locations exist? For example: the downstairs workshop, the upstairs store, a dispatch area, any outside sites.
   Do you need named bins or shelves inside them?
   *(Default: one warehouse "Skalarki", bins added later.)*
6. **Who may see costs, margins and stock value?** You can now set this yourself in
   Kimera → Settings → Access → "Costs & margins". It is enforced on the server.
   *(Default: Owner, Developer, Manager, Office. Hidden from Assistant, Support and Operator.)*
7. **Warehouse staff:** a new "Warehouse" role, or use Assistant?
   *(Default: use Assistant.)*
8. **VAT:**
   - Which rates do you use? For example 20% standard, and 0% for exports such as Avia Sim in the USA.
   - Are your prices entered before or after VAT?
   *(Default: 20% and 0%, prices before VAT.)*
9. **Batch or serial tracking:** which items need it? For example, a serial number on every finished trainer, or batches for electronics.
   Does anything have an expiry date?
   *(Default: serials on finished products only, no expiry.)*
10. **Barcodes:** do items already carry barcodes (supplier or EAN codes), or should Kimera print its own labels?
    Which label printer do you use?
    *(Default: Kimera generates Code-128 labels from the SKU.)*
11. **Outsourcing:** do you send work to outside companies (powder coating, PCB assembly, CNC, etc.)? Which ones?
12. **Other channels:** do you use or plan to use WooCommerce, BigCommerce, eBay or Amazon, a shipping tool (ShipStation, DHL, FedEx…), or HubSpot?
13. **Order priority:** is this order OK for who gets stock first?
    1. The rank you set by hand.
    2. The delivery date.
    3. The order date.
14. **Forecasting:**
    - How far back does the sales history go? Since you started on Shopify?
    - Do you want forecasts weekly or monthly?
15. **Recipes:** the boss's recipe spreadsheets (still waiting for them).
16. **Demo data:** remove the demo catalogue and orders before real use? If so, when?

## Added while building (2 Nov)

17. **Shopify VAT and currency:** are your Shopify prices entered with VAT included? Do you sell in more than one currency on Shopify (GBP, USD, EUR)?
    *(Default: Shopify order lines take the default VAT rate with prices before VAT, and the order keeps Shopify's currency.)*
18. **Sales prices:** should sales prices (order amounts, the price on a job card) also be hidden from some roles, or only costs and margins?
    *(Default: only costs and margins are hidden. Anyone who can open Sell, and operators on their job cards, still see sales prices.)*
19. **Who gets the Owner role?** Karol is now Developer (full access). Should the boss (Mirosław?) be made Owner?
    *(Default: Owner is left unassigned until you say.)*
20. **Assistants and stock costs:** assistants keep stock and enter costs when they book opening stock, but can no longer see average cost or stock value. Is that right?
    *(Default: yes, hidden. Tick "Costs & margins" for Assistant in Settings → Access to change it.)*
21. **Job priority P1–P5 vs queue order:** Kimera now has a queue order (the arrows in Sell and Make), and that decides who gets stock first. Should the P1–P5 priority on jobs also move the queue, or stay as a shop-floor urgency label only?
    *(Default: P1–P5 stays a label for the crew; the arrows decide stock.)*
22. **Transfers:** do you ever receive only part of a transfer (e.g. 8 of 10 arrive)?
    *(Default: a transfer is received in full; a short delivery is fixed with a stock count at the destination.)*
23. **Shipping more than the system shows:** if the system says 0 on the shelf but the goods are physically there, should someone be able to ship anyway?
    *(Default: no. Count the stock first, then ship. This prevents two people shipping the same last unit.)*
24. **Locations:** besides "Skalarki" (all current stock), which locations should I create? For example: Upstairs store, Downstairs workshop, Dispatch, any contractor holding your stock.
    *(Default: only "Skalarki" until you add more in Kimera → Settings → Locations.)*
25. **Labour in stock value:** should the cost of operations and labour be added to the value of finished products in stock (full manufacturing cost)? Or should stock be valued at material cost, with labour shown on each MO's cost?
    *(Default: stock is valued at material cost; each MO shows planned vs actual materials, operations and labour.)*
26. **Rates:** what does an hour cost at each station (e.g. CNC, powder coating, assembly), and what is your labour cost per person-hour? I need these for real MO costs and finish dates.
    *(Default: £0 until you enter them in Stations & routes and Settings → Company.)*
27. **Over-consumption:** when the crew uses more material than the recipe (scrap, mistakes), should Kimera ask for a reason, or just record it?
    *(Default: just record it; the MO shows planned vs actual.)*

