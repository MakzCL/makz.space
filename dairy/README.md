# Dairy Herd

A mobile-first, installable web app for one dairy farm on one phone: breeding
(insemination first), pregnancy checks, calving, bulls, milk from milking to
payment, milk quality, herd health and withdrawals. Records are saved on the
phone the moment you tap Save, so it works in the barn with no signal.

No build step and no dependencies: plain HTML, CSS and JavaScript modules,
IndexedDB for records, a service worker for offline use.

## Start it

```bash
cd dairy
node serve.mjs
```

Open http://localhost:8080. The first screen asks for the farm name, time zone
and currency, and offers sample data (marked **Sample**; remove it from
More → Backup & restore).

## Put it on the phone

Offline mode and installing need **HTTPS** (or `localhost`). Upload the
contents of this `dairy/` folder (everything except `tests/`) to any static
HTTPS host — Cloudflare Pages, Netlify, GitHub Pages, or a folder on an
existing website. Then on the phone:

- **Android (Chrome):** open the address → ⋮ menu → *Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*.

Open it once with signal. After that it starts and saves with no signal.

## Back up

Records live only on that phone. Use **More → Backup & restore → Download
full backup** at least weekly and keep the file elsewhere (email, cloud drive).
**Restore** on a new phone replaces everything with the file. Today shows a
reminder when the last backup is more than 14 days old. CSV exports for
spreadsheets are under **More → Reports**.

## How it counts

- **Days since insemination** use calendar days in the farm's time zone.
- **Cows inseminated** counts each cow once per period (default last 30 days).
- **Awaiting pregnancy result**: active females whose latest attempt (AI,
  natural service or bull exposure) has no pregnant/open result yet.
  Inconclusive stays on the list. Check due = vet schedule (Settings) or a
  per-cow reminder.
- **Bull exposure** never invents a service date; calving is shown as a range.
- **Milk produced**: each day's official total comes from one source —
  session totals, a daily herd total, or the sum of cow yields — shown and
  changeable per day. Other entries are reference only. Withheld, discarded and
  on-farm milk are recorded separately.
- **Sold** comes only from collections (a collection is the sale). Statements
  add bonuses/deductions and the buyer's amount; payments count by payment date.
- **Withhold milk** stays on while any treatment's withdrawal is running or a
  required end time is missing.

## Tests

```bash
node --test tests/logic.test.mjs        # herd logic, time zones, totals
node serve.mjs & node tests/e2e.mjs     # release scenarios in Chromium (needs Playwright)
```
