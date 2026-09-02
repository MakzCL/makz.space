# MAKZ

The personal digital environment of Karol Kuklinski — design records, a
self-hosted broadcast, game servers and poster work, built as one application
rather than a set of pages.

Live at **[makz.space](https://makz.space)**.

---

## What this is

A persistent application shell with six sections loaded into a stage inside
it. Navigation is an edge index rather than a navbar; route changes run a
shutter curtain that names where you are going; a command console (`⌘K`) can
reach anything in the site. Accounts, profiles, preferences and saved records
run on Supabase with row level security.

| | |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4 with a token layer in `styles/tokens.css` |
| Motion | Motion (`motion/react`), five named behaviours in `motion/system.ts` |
| Data | Supabase (PostgreSQL + Auth), cookie sessions via `@supabase/ssr` |
| Video | HLS through `hls.js`, loaded only when the browser needs it |

---

## Running it

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm run fetch:fonts            # downloads Cabinet Grotesk, once
npm run dev                    # http://localhost:3000
```

Other scripts:

```bash
npm run build       # production build
npm start           # serve the production build
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
```

---

## Typeface

The interface is set in **Cabinet Grotesk** (Indian Type Foundry, free from
[Fontshare](https://www.fontshare.com/fonts/cabinet-grotesk)), self-hosted so
the site makes no third-party font request.

```bash
npm run fetch:fonts
```

writes `public/fonts/CabinetGrotesk-Variable.woff2`. **Commit that file** — it
is part of the build, not a local artefact. If your network blocks Fontshare,
download the variable `.woff2` by hand and save it to that exact path.

Until it is present the layout is carried by a metric-matched fallback
(`styles/fonts.css`), so nothing shifts when the real face arrives — but the
site is not finished until you have run this once.

Technical metadata is set in JetBrains Mono, loaded and subsetted through
`next/font`, so it needs no setup.

---

## Environment

Copy `.env.example` to `.env.local`. Every value is listed there with what it
is for; the short version:

| Variable | Required | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | for accounts | Project URL from Supabase → Project Settings → Data API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for accounts | The publishable *anon* key from Project Settings → API Keys |
| `NEXT_PUBLIC_SITE_URL` | in production | Absolute origin, e.g. `https://makz.space`. Used for canonical URLs and for the redirect target in confirmation and password-reset emails |

Both Supabase values are public by design: every table is protected by row
level security, so the anon key can only ever do what the signed-in account is
allowed to do. **The service role key is not used anywhere in this codebase
and must never be added to it** — Next.js ships client bundles, and a service
key in that environment bypasses every policy below.

Without Supabase configured the site runs completely: all six sections, the
broadcast, the servers, the frames viewer and the command console work. Only
the account layer switches off, and `/account` says so explicitly rather than
showing a form that cannot work.

---

## Database

Apply `supabase/migrations/0001_init.sql` to a fresh project — paste it into
the SQL editor, or:

```bash
supabase db push
```

It creates four tables, all with row level security enabled:

| Table | Contents | Who can read it |
| --- | --- | --- |
| `profiles` | handle, display name, bio, location, website, avatar, role, visibility | anyone, if the profile is public; always its owner |
| `preferences` | appearance, motion, activity visibility, email opt-in | its owner only |
| `saved_items` | records an account kept | its owner only |
| `activity` | account created, profile edits, keeps and releases | its owner, plus anyone if the profile is public *and* activity is switched on |

Also created:

- `handle_new_user()` — provisions a profile and preferences the moment an
  account is created, deriving a unique handle from sign-up metadata.
- `protect_profile_columns()` — stops an account from editing its own `id`,
  `role` or `created_at`, which RLS alone would allow.
- `username_available(citext)` — a security-definer function used by the
  sign-up and settings forms. It returns a boolean and nothing else, so it
  cannot be used to enumerate accounts.
- `touch_last_seen()` — cheap presence write.

### Supabase Auth settings

In the dashboard, under **Authentication → URL Configuration**:

- **Site URL**: your `NEXT_PUBLIC_SITE_URL`
- **Redirect URLs**: add `https://your-domain/auth/callback` (and
  `http://localhost:3000/auth/callback` for local work)

Under **Authentication → Providers → Email**, keep *Confirm email* on. The
sign-up flow expects it and tells the visitor to check their inbox.

---

## Deployment

The account layer uses cookies, server actions and a proxy (middleware), so
this needs a Node runtime — Vercel, or any host that runs `next start`. It is
not a static export.

Set the three environment variables in the host, apply the migration, and add
your production origin to the Supabase redirect list.

---

## How the code is organised

```
app/            routes, API handlers, metadata, error and loading states
components/
  shell/        the persistent frame: ledger, rail, dock, deck, curtain,
                cursor, command console, toasts, environment state
  ui/           the primitives: action, field, switch, avatar, split text
  media/        the image frame
features/       one folder per section, plus account, profile, settings, saved
lib/            site index, content, Supabase clients, status probes, utils
hooks/          motion, viewport, clipboard, focus and scroll behaviour
motion/         the motion system — every duration, curve and spring
styles/         design tokens and the typeface
supabase/       schema and policies
types/          shared types
```

Two rules keep it coherent:

1. **The index is one array.** `SECTIONS` in `lib/site.ts` drives the rail, the
   dock, the command console, the curtain and the sitemap. They cannot
   disagree, because there is nothing to disagree with.
2. **Nothing invents a value.** Colour, type, spacing, radius, duration,
   easing and springs all come from `styles/tokens.css` and
   `motion/system.ts`. If something needs a value that is not there, either
   the value is wrong or the system is missing a behaviour.

### The motion system

Five behaviours, not five hundred values:

| | |
| --- | --- |
| `fast` | a control acknowledging a press |
| `interface` | chrome rearranging itself |
| `reveal` | content arriving |
| `page` | a route replacing another |
| `cinematic` | media taking over |

Plus five springs (`snap`, `glide`, `heavy`, `magnetic`, `trail`) for anything
a pointer or finger is driving directly.

---

## Accessibility

- Every text tier is a measured solid value, not an opacity, and clears
  WCAG AA (4.5:1) against the lightest surface it is allowed to sit on — in
  both materials. Control boundaries use a separate `--color-edge` token that
  clears 3:1, because a hairline that is only decorative is not enough when it
  is also the affordance.
- `prefers-reduced-motion` is honoured at the CSS floor *and* read at runtime,
  so components keep their variant trees and simply stop moving. The route
  curtain and the custom cursor switch off entirely.
- Motion can also be reduced from the interface itself — the command console,
  the mobile index, or Settings → Appearance — and the choice follows the
  account across devices.
- Full keyboard traversal with a skip link, focus trapping in every overlay,
  focus returned on close, and a visible signal-coloured focus ring that is
  never removed.
- No information depends on animation alone.

---

## Live data

Two things on this site are real and probed server-side, cached briefly, and
proxied so the browser never hits a third origin directly:

- **Broadcast** — `stream.makz.space` (Owncast). One poller for the whole
  application; it stops entirely while the tab is hidden.
- **MakzMC** — `play.makz.space` through `mcsrvstat.us`. Only hosts declared
  in `lib/data/gaming.ts` can be probed, so the route is not an open proxy.

Both degrade to a designed offline state rather than an error.

---

© 2026 makz.space — Karol Kuklinski.
