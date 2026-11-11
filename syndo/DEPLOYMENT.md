# SEND — Deployment

SEND is fully self-hostable. Nothing here requires a paid third-party service; the only optional external services are an SMTP provider for email, Klipy for GIF search and Stripe for paid boosts.

## Local development

Requirements: Node 22+, PostgreSQL 14+.

```bash
cd syndo
npm install
```

```bash
createuser -s syndo; createdb -O syndo syndo   # or use any Postgres URL
```

```bash
set -a; . ./.env.example; set +a   # or export the variables yourself
npm run dev:server                  # API + gateway on :3900, applies migrations
```

```bash
npm run dev:web                     # Vite on :5173, proxies /api and /gateway
```

Emails (verification, reset) appear at `http://localhost:5173/api/dev/mail` while `SEND_DEV_MAIL=1`.

Voice/video locally: run a LiveKit dev server (`livekit-server --dev`, key `devkey` / secret `secret`) — install it from LiveKit's releases or Docker image `livekit/livekit-server`.

Tests:

```bash
createdb -O syndo syndo_test
```

```bash
npm test
```

```bash
npm run build && npm start -w @send/server   # serves web/dist on :3900
```

```bash
node e2e/smoke.cjs http://localhost:3900 ./shots   # needs Playwright + Chromium
```

## Production (single host, Docker Compose)

Reference layout in `deploy/`: PostgreSQL, the SEND image (API + built web client), LiveKit with embedded TURN, Caddy for automatic TLS. **This compose file has not been run in the build environment (no Docker daemon there); validate it on your host.**

1. A Linux VM with a public IPv4 address. Starting point: 4 vCPU / 8 GB RAM; size with the worksheet in OPERATIONS.md.
2. DNS: `chat.example.com`, `media.example.com`, `turn.example.com` → the VM.
3. Firewall (inbound):

   | Port | Proto | Purpose |
   |---|---|---|
   | 80, 443 | TCP | Web, API, gateway, LiveKit signalling (via Caddy) |
   | 7881 | TCP | WebRTC over TCP (fallback when UDP blocked) |
   | 50000–60000 | UDP | WebRTC media |
   | 3478 | UDP | TURN |
   | 5349 | TCP | TURN over TLS (strict corporate networks) |

4. Configure:

```bash
cd syndo/deploy && cp .env.example .env && nano .env
```

   Set `turn.domain`, and the TURN certificate paths in `livekit.yaml` (Caddy obtains certificates for the web domains; for TURN/TLS provide a certificate for `turn.example.com`, e.g. a separate Caddy site block or certbot).
5. Start:

```bash
docker compose up -d --build
```

6. Check `https://chat.example.com/api/instance` → `"media_enabled": true`. Register the first account; create a server.

### Environment reference (API)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | local | PostgreSQL connection |
| `SEND_PUBLIC_URL` | `http://localhost:5173` | Public origin (emails, Origin check) |
| `SEND_EXTRA_ORIGINS` | — | Extra allowed origins, comma-separated |
| `SEND_COOKIE_SECURE` | off | Set `1` behind HTTPS |
| `SEND_TRUST_PROXY` | off | Set `1` behind Caddy/nginx so client IPs are correct |
| `SEND_STORAGE_DIR` | `syndo/data/storage` | Uploaded files |
| `SMTP_URL`, `SEND_MAIL_FROM` | — | Outgoing email. Without SMTP, mails are only recorded in `mail_outbox` |
| `SEND_REQUIRE_VERIFIED_EMAIL` | off | Require verified email to post/join |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | — | Media server; without them calls are disabled and the UI says so |
| `SEND_MAX_UPLOAD_MB` | 100 | Upload limit for everyone |
| `SEND_MAX_MESSAGE_LENGTH` | 4000 | Message length for everyone |
| `SEND_MAX_GUILDS_PER_USER` / `SEND_MAX_MEMBERS_PER_GUILD` / `SEND_MAX_GROUP_DM` | 200 / 25000 / 10 | Membership limits |
| `SEND_MAX_VOICE_KBPS` | 510 | Highest selectable Opus bitrate |
| `SEND_MAX_STREAM_HEIGHT` / `_FPS` / `_KBPS` | 2160 / 60 / 20000 | Screen-share caps |
| `SEND_RATE_LIMIT`, `SEND_AUTH_RATE_LIMIT` | 600 / 10 per min | Request limits |
| `SEND_JOBS` | on | Set `0` on all but one node |
| `SEND_DEV_MAIL` | off | **Never in production** — exposes the outbox |

All limits apply identically to every account and are published at `/api/instance` and in Settings → About.

### Updating

```bash
git pull && cd syndo/deploy && docker compose up -d --build
```

Migrations in `server/migrations/` run automatically at start, each in a transaction. Restart the API after rebuilding the web client (static routes are registered at start).

## Hosted web app & desktop app

The interface can also be hosted on Cloudflare Pages (with a same-origin proxy to your API) and shipped as a Windows app that self-updates from Cloudflare R2. See DESKTOP.md.

## Costs

| Item | Required? | Cost driver |
|---|---|---|
| VM(s) | Yes | CPU for the SFU (mostly packet forwarding, not transcoding) and bandwidth |
| Bandwidth | Yes | Dominant cost for voice/video — see the worksheet in OPERATIONS.md |
| Block storage / object storage | Yes | Attachments and backups |
| SMTP provider | Optional | Per-email pricing; any SMTP works |
| Domain + certificates | Yes / free | Let's Encrypt via Caddy |
| GIF search (Klipy) | Optional, built | Free API key — see SETUP-GIFS-AND-PAYMENTS.md |
| Payments (Stripe) | Optional, built | Stripe fees on paid boosts — see SETUP-GIFS-AND-PAYMENTS.md |

No universal price is given — derive it from your expected usage with the worksheet.

## Names from before the rename

The app was called Syndo before it became SEND. The code now uses SEND names everywhere, and still
accepts the old ones so nothing already in use breaks:

- Settings and secrets: `SYNDO_…` environment variables, Worker secrets, the Pages `SYNDO_API_ORIGIN`
  and the GitHub `SYNDO_…` repository variables are read when the `SEND_…` name isn't set.
- Sign-in: the `syndo_session` cookie and the `x-syndo-client` header are still accepted.
- Themes: saved `syndo-*` theme ids and `"schema": "syndo.theme"` files are read as their `send-*` /
  `send.theme` versions. Until the backend runs a release from after the rename (it reports
  `send_names` in READY), the web app sends theme ids in the old form.
- Browser settings under `syndo.` keys are copied to `send.` keys once; the old keys stay so a rollback
  keeps them. Desktop apps up to 0.6.x (`window.syndoDesktop`) and `syndo://` invite links keep working.

Left under the old name on purpose, because renaming them would move or break live things: the
`syndo/` folder (Cloudflare Pages and CI build from it), the `syndo.makz.space` domain, the Cloudflare
names (`syndo-app`, `syndo-desktop`, `syndo-beta-uploads`, the `syndo-beta-weur-v5` container), the
Supabase project and its `syndo` schema and roles, the local Postgres user and databases, the Android and
desktop app identifiers (`space.makz.syndo…`, changing them would install a separate app), the
workflow file names and the already-applied database migrations.
