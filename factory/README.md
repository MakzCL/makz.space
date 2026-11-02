# Skalarki Factory

Operator, office and management app for **Skalarki Electronics Ltd**: shifts,
breaks, prioritised production jobs, **team jobs with live invites**, issues,
stock, absences and a noticeboard. Installable on phones (PWA), works on
tablets and desktop.

Live (once deployed): **https://skalarki-factory.pages.dev**

## Gateways (roles)

| Role | Tabs | Can |
| --- | --- | --- |
| **Boss** | Home · Jobs · Team · Insights · Requests | Everything, change roles, see person-hours & team work |
| **Manager** | Home · Jobs · Team · Requests · Issues | Create/assign jobs, approve absences, triage issues, post news |
| **Office** | Home · Team · Requests · Stock · Time | Timesheets (correct + CSV), absences, stock, news |
| **Assistant** | Home · Jobs · Time · Issues · Stock | Run jobs, keep stock |
| **Operator** | Home · Jobs · Time · Issues · Stock | Clock in/out, breaks, run jobs, invite helpers, report issues |

## Look & language

Night-blue surfaces, the logo red and white; flat illustrated scenes for every
screen (factory, line, clock tower, lighthouse, warehouse, town, peaks) that
follow the time of day, folder tabs cut into the illustrations, a 12-hour dial
for the shift, a big round clock-in button, a player-style card for the live
job and award tiles in the profile.

**English / Polski** — slider in Profile → Settings and on the sign-in screen.
All text lives in `src/lib/pl.ts` (English is the key); dates follow the language.

## Invite links (invite-only)

Nobody gets in on their own. The **boss** makes invite links from
**Team → Invite new starters**: pick the role, how long it works and how many
people can use it (default: one person — make one unique link per person).
Every link uses the same team **PIN `101010`**, which is passed on in person.
The boss gets a QR code and link to share.

New starters open the link, enter the PIN on a keypad, and create their
account — they are active straight away with that role. Anyone who signs up
*without* a link waits on an approval screen until an admin approves them
(Team / Requests) or they enter a link + PIN. Ten wrong PINs lock a link.
All of this is enforced in the database (`create_join_link`,
`check_join_pin`, `redeem_join_link`, restrictive RLS for pending accounts).

**First boss:** run this in the Supabase SQL editor and open the link it prints:

```sql
insert into public.join_links (code, pin, role, expires_at, max_uses)
values (upper(substr(md5(random()::text), 1, 8)), public.join_pin(), 'boss', now() + interval '7 days', 1)
returning 'https://factory.makz.space/?join=' || code as link;
```

## Team jobs — how the boss sees "2 people did this"

1. Operator taps a job → **Start job** (auto clocks in if needed).
2. **Invite a helper** → picks coworkers (sorted by who is free on shift).
3. Helper gets a live invite card + buzz → **Join job**.
4. Every person's time is recorded separately. Each job shows
   **job time** (clock on the job) vs **person-hours** (all hands combined),
   crew size, who contributed what, and a timeline of every run.
5. Boss **Insights** ranks jobs by effort and shows the share of hours worked in teams.

## Quality-of-life

Hold-to-confirm clock-out/complete (no accidental taps) · live shift ring with
8h target, overtime & projected finish · break timer · presence ("on the floor")
· one-job-at-a-time auto switching · block a job straight from an issue ·
stock −/+ steppers & low-stock alerts · absence requests with allowance
tracking · CSV timesheet export · shift corrections for admins · haptics &
optional sounds · 3 themes · text size S/M/L · reduce-motion · start-screen
choice · offline banner + offline app shell · keyboard 1–5 tab shortcuts.

## Run it

```bash
cd factory
npm install
npm run dev          # http://localhost:5173
npm run build        # → dist/
```

### Backend (Supabase)

The app needs a Supabase project — there is no demo mode.

1. SQL Editor → paste and run `supabase/schema.sql` (safe to re-run).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time (see
   `.env.example`). On Cloudflare Pages they are project environment variables.
3. Create the first boss link (above).

Permissions are enforced in the database with row-level security, not just the
UI. `supabase/tests/schema.test.sql` checks them against a real Postgres.

## Deploy to Cloudflare Pages (free `*.pages.dev` domain)

**Live setup:** Pages project `skalarki-factory` is connected to this repo
(root `factory`, `npm ci && npm run build`, output `dist`); every push to
`main` deploys to https://factory.makz.space and https://skalarki-factory.pages.dev.

**Option A — dashboard (no tokens):** Cloudflare → Workers & Pages → Create →
Pages → Connect to Git → this repo. Root directory `factory`, build command
`npm run build`, output `dist`. Project name `skalarki-factory`.

**Option B — GitHub Actions (already set up):** add repo secrets
`CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers"; Pages:Edit) and
`CLOUDFLARE_ACCOUNT_ID`. Every push touching `factory/` deploys; `main` is
production, other branches get preview URLs.

**Option C — local:** `npm run build && npx wrangler pages deploy dist --project-name=skalarki-factory`.

To use your own domain (e.g. `factory.makz.space`): Pages project → Custom domains.
