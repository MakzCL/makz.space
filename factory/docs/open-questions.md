# Kortana — questions for Skalarki

Answers decide how the next phases are built. Until they come in, I use the
default shown in brackets. Every default can be changed later.

## Needed soon (blocks a connector or a go-live)

1. **Accounting:** QuickBooks Online, Xero, or neither for now?
   *(Default: no accounting connector; CSV exports only.)*
2. **Shopify webhook secret:** Shopify admin → Settings → Notifications → Webhooks → the "signed by" key.
   Kortana can't receive real Shopify orders until it's set.
3. **Shopify sync direction:** besides taking orders in, should Kortana
   - (a) push stock levels back to Shopify, and
   - (b) mark orders fulfilled in Shopify with the tracking number?
   *(Default: orders in only.)*
4. ~~**Publish phase 1?**~~ Answered: Phases 1–4 (including outsourcing, 4d), the Developer role and the Access dashboard are live.

## Shapes the next phases

5. **Locations:** which stock locations exist? For example: the downstairs workshop, the upstairs store, a dispatch area, any outside sites.
   Do you need named bins or shelves inside them?
   *(Default: one warehouse "Skalarki", bins added later.)*
6. **Who may see costs, margins and stock value?** You can now set this yourself in
   Kortana → Settings → Access → "Costs & margins". It is enforced on the server.
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
10. **Barcodes:** do items already carry barcodes (supplier or EAN codes), or should Kortana print its own labels?
    Which label printer do you use?
    *(Default: Kortana generates Code-128 labels from the SKU.)*
11. **Outsourcing:** do you send work to outside companies (powder coating, PCB assembly, CNC, etc.)? Which ones?
    Kortana now supports this (Buy → PO type "Outsourced work"). For each company I need its name and whether it holds any of your stock now, so I can set up its contractor location.
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
21. **Job priority P1–P5 vs queue order:** Kortana now has a queue order (the arrows in Sell and Make), and that decides who gets stock first. Should the P1–P5 priority on jobs also move the queue, or stay as a shop-floor urgency label only?
    *(Default: P1–P5 stays a label for the crew; the arrows decide stock.)*
22. **Transfers:** do you ever receive only part of a transfer (e.g. 8 of 10 arrive)?
    *(Default: a transfer is received in full; a short delivery is fixed with a stock count at the destination.)*
23. **Shipping more than the system shows:** if the system says 0 on the shelf but the goods are physically there, should someone be able to ship anyway?
    *(Default: no. Count the stock first, then ship. This prevents two people shipping the same last unit.)*
24. **Locations:** besides "Skalarki" (all current stock), which locations should I create? For example: Upstairs store, Downstairs workshop, Dispatch, any contractor holding your stock.
    *(Default: only "Skalarki" until you add more in Kortana → Settings → Locations.)*
25. **Labour in stock value:** should the cost of operations and labour be added to the value of finished products in stock (full manufacturing cost)? Or should stock be valued at material cost, with labour shown on each MO's cost?
    *(Default: stock is valued at material cost; each MO shows planned vs actual materials, operations and labour.)*
26. **Rates:** what does an hour cost at each station (e.g. CNC, powder coating, assembly), and what is your labour cost per person-hour? I need these for real MO costs and finish dates.
    *(Default: £0 until you enter them in Stations & routes and Settings → Company.)*
27. **Over-consumption:** when the crew uses more material than the recipe (scrap, mistakes), should Kortana ask for a reason, or just record it?
    *(Default: just record it; the MO shows planned vs actual.)*
28. **Serial number format:** finished pieces currently get the MO code plus a number (e.g. MO-1043-001), and received pieces get the batch/PO code plus a number. Do you have your own serial format (e.g. SK-A32X-2026-0001), or do you print serial plates?
    *(Default: MO/PO code + running number.)*
29. **Expired stock:** should Kortana refuse to use or ship expired batches, or only warn?
    *(Default: warn only; the first-to-expire batch is used first.)*

## Added 2 Nov (outsourcing + warehouse)

30. **Contractor costs:** besides the contractor's fee, should shipping to and from the contractor be added to the cost of the finished piece?
    *(Default: no. The cost is the contractor's fee plus the materials; shipping goes on the PO as a separate line if you want it counted.)*
31. **Where materials for contractors come from:** always the main "Skalarki" location, or a different one (e.g. the downstairs workshop)?
    *(Default: the default location. It can be changed on each transfer before it is dispatched.)*
32. **Scanning hardware (warehouse phase):** will staff scan with phone cameras, USB/Bluetooth barcode scanners, or both?
    *(Default: both. Phone camera in the app, and scanners that type into the search box.)*
33. **Picking orders:** who picks and packs customer orders: one dispatch person, or whoever is free? Should pick lists be grouped by location/bin (walk order) or by order?
    *(Default: anyone with stock rights; one pick list per order, sorted by bin.)*
34. **Shop-floor time:** keep booking time per job as now, or should operators start and stop each operation (cutting, coating, assembly…) on a tablet at each station?
    *(Default: per job as now, plus optional per-operation start/stop for stations that have a tablet.)*
35. **Who may remove staff:** Owner/Developer can remove anyone (except themselves, and never the last Owner/Developer). Manager and Office can remove anyone except Owner/Developer. Assistants can remove Operators and Support only. Is that right, or should Assistants be able to remove other roles too?
    *(Default: as described. Removing someone keeps all their history, and they can be restored from Team → Removed staff.)*
36. ~~**Web address for Kortana**~~ Answered: Kortana is at kortana.makz.space; kimera.makz.space forwards there.
37. **What should Kortana talk to first?** The API and webhooks are ready (Settings → Integrations). For example: a Slack/Teams message when an order ships or stock runs low, your website showing live stock, or Zapier/Make connecting other tools.
    *(Default: nothing is connected until you add a key or webhook.)*
38. **Forecast settings:** the automatic forecast uses the last 12 weeks of shipments. Is 12 weeks right for your business, or is it seasonal (e.g. busy before Christmas) so a longer history would be better?
    *(Default: 12 weeks; override any week or month by hand in Plan → Forecast.)*
39. **Details for printed documents:** which company address (and VAT / company number, if wanted) should appear on purchase orders, packing slips and pick lists? Enter it in Kortana → Settings → Company, or send it and it will be added.
    *(Default: company name only, until an address is entered.)*
40. **Custom order fields:** which extra fields do you want on every sales order (e.g. customer PO number, aircraft type, installation date, installer)? Which of them must be filled in?
    *(Default: none. Add them yourself in Settings → Company → Custom order fields.)*
41. **Sub-assembly orders:** when a manufacturing order needs a part you make yourself (e.g. a pedestal box) and there are not enough, should Kortana create the linked order for that part automatically, or only when someone presses "Create sub-assembly orders"?
    *(Default: only when pressed. Switch on automatic in Settings → Company.)*

## Added 3 Nov (TROTAN laser app)

42. **Which laser machines do you have?** For each one: maker and model, bed size, laser type and power (e.g. CO₂ 60 W), and the software you run it with today. Each is added as "No validated interface": TROTAN prepares the job, gives a bed file (SVG/DXF) and a printed job sheet with the settings per colour, and records the result. The machine itself is always run with its own software.
    *(Default: only the virtual laser (simulation) is set up.)*
43. **Who may approve laser settings?** Approving power and speed for a material is a safety decision. Which roles (or which people) should have "Approve laser settings"? Set it in Kortana → Settings → TROTAN.
    *(Default: Owner, Developer and Manager only. TROTAN is closed to all other roles until you give access.)*
44. **Materials and stock:** which sheet materials do you cut (type, thickness, sheet size), and are they already items in Kortana? TROTAN reserves the sheets when a job is queued and takes them out of stock only when the run is recorded as finished.
    *(Default: seven common materials without stock links. Link each one to a Kortana item in TROTAN → Administration → Materials.)*
45. **Prohibited materials:** PVC/vinyl is blocked on the virtual laser. Which other materials must never go on your machines (for example polycarbonate, ABS, coated or unknown plastics)?
    *(Default: PVC/vinyl only, until you add more.)*
46. ~~**Web address for TROTAN**~~ Answered: TROTAN is at trotan.makz.space (also factory.makz.space/trotan).
47. **File formats:** TROTAN imports SVG, DXF, PNG, JPG and BMP, and exports SVG, DXF, PNG and its own .trotan file. PDF, AI, EPS and CorelDRAW files are not supported yet. Which formats do your customers send most often?
    *(Default: no PDF/AI import. Ask senders for SVG or DXF.)*
