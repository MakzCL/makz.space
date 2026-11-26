# Turning on GIF search and paid Boosts

Both features are already built into SEND. They stay switched off until their keys are saved as
**secrets on the backend Worker** (`send-beta-api`). Keys never go into the web app or this repository.

Where secrets go: Cloudflare dashboard → Workers & Pages → `send-beta-api` → Settings →
Variables and Secrets → Add → type **Secret**.

The backend reads secrets when its container starts. After saving them, the backend needs a restart:
the next backend deploy does it, or it happens on its own after an hour with no traffic.

---

## GIF search (GIPHY or Klipy)

Google shut down the public Tenor API on 30 June 2026. SEND supports **GIPHY** and **Klipy**.

**GIPHY** (in use): add the secrets `SEND_GIF_PROVIDER` = `giphy` and `SEND_GIF_KEY` = your GIPHY API key.
A GIPHY beta key allows about 100 calls an hour for the whole server, so SEND caches results and shares
them between everyone (trending for 30 minutes, each search for 6 hours) and stops at 90 calls an hour
(`SEND_GIF_HOURLY_LIMIT` changes that). Near the limit, people get older cached results, or a "try again in
a few minutes" note for a brand-new search. For heavier use, apply for a production key in GIPHY's
developer dashboard. The picker shows "Powered by GIPHY", as GIPHY's terms ask.

**Klipy** (alternative, free key from <https://partner.klipy.com>): `SEND_GIF_PROVIDER` = `klipy` and
`SEND_GIF_KEY` = the Klipy key.

Restart the backend after saving (see above).

**Check:** in any channel, open the GIF button in the message box. Trending GIFs should load, and
searching should work. GIFs people already sent keep showing either way.

---

## Paid Server Boosts (Stripe)

How it works in SEND: a member buys a monthly subscription. Each unit bought gives **2 boosts** they can
put on servers. Free boosts from codes keep working without Stripe.

Decide first: **the monthly price of one unit**, and whether to start in Stripe **test mode**
(recommended: nothing is charged, and you can switch to live keys later).

1. **Product and price.** Stripe Dashboard → Product catalogue → Add product, for example "SEND Boosts".
   Give it a **recurring, monthly** price. Copy the price ID (`price_…`). It becomes `STRIPE_PRICE_ID`.
2. **API key.** Developers → API keys. Copy the secret key (`sk_test_…` in test mode). It becomes
   `STRIPE_SECRET_KEY`. A restricted key works too if it has: Checkout Sessions (write),
   Subscriptions (read), Customer portal (write) and Coupons (write, used by discount codes).
3. **Webhook.** Developers → Webhooks → Add endpoint:
   - URL: `https://syndo.makz.space/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

   Copy the signing secret (`whsec_…`). It becomes `STRIPE_WEBHOOK_SECRET`.
4. **Customer portal.** Settings → Billing → Customer portal → turn it on. The "Manage subscription"
   button in SEND opens it.
5. Save `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` as Worker secrets, then
   restart the backend.

**Check (test mode):** Settings → Server Boosts → buy one unit. Pay with the test card
`4242 4242 4242 4242`, any future expiry date and any CVC. You should come back to SEND with 2 boosts
to give out. "Manage subscription" should open Stripe's portal, and cancelling there should end the
boosts at the end of the period.

**Going live:** repeat steps 1–3 in live mode (live price, `sk_live_…` key, new webhook with its own
signing secret) and replace the three secrets.

---

## Old secret names

Secrets saved before the app was renamed from Syndo (`SYNDO_GIF_KEY`, `SYNDO_SECRET`, …) still work.
New ones should use the `SEND_` names above.
