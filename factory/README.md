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

### Demo mode vs cloud mode

* **No env vars → demo mode.** A seeded factory lives in the browser. Pick any
  gateway on the login screen. Open a second tab as someone else to try team
  invites live.
* **Cloud mode (real, multi-device, realtime):**
  1. Create a free project at supabase.com.
  2. SQL Editor → paste and run `supabase/schema.sql`.
  3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`;
     in GitHub add them as `FACTORY_SUPABASE_URL` / `FACTORY_SUPABASE_ANON_KEY` secrets).
  4. The **first** account to sign up becomes **Boss**, everyone else starts as
     Operator and the boss assigns roles on the Team screen.

Permissions are enforced in the database with row-level security, not just the
UI. `supabase/tests/schema.test.sql` checks them against a real Postgres.

## Deploy to Cloudflare Pages (free `*.pages.dev` domain)

**Option A — dashboard (no tokens):** Cloudflare → Workers & Pages → Create →
Pages → Connect to Git → this repo. Root directory `factory`, build command
`npm run build`, output `dist`. Project name `skalarki-factory`.

**Option B — GitHub Actions (already set up):** add repo secrets
`CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers"; Pages:Edit) and
`CLOUDFLARE_ACCOUNT_ID`. Every push touching `factory/` deploys; `main` is
production, other branches get preview URLs.

**Option C — local:** `npm run build && npx wrangler pages deploy dist --project-name=skalarki-factory`.

To use your own domain (e.g. `factory.makz.space`): Pages project → Custom domains.
