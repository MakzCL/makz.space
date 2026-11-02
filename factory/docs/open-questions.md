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
4. **Publish phase 1?** Say "publish". I'll take the backup and restore point first.

## Shapes the next phases

5. **Locations:** which stock locations exist? For example: the downstairs workshop, the upstairs store, a dispatch area, any outside sites.
   Do you need named bins or shelves inside them?
   *(Default: one warehouse "Skalarki", bins added later.)*
6. **Who may see costs, margins and stock value?**
   *(Default: Owner, Manager, Office. Hidden from Assistant, Support and Operator.)*
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
