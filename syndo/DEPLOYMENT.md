# Syndo — Deployment

Syndo is fully self-hostable. Nothing here requires a paid third-party service; the only optional external services are an SMTP provider for email and (later) a GIF provider.

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

Emails (verification, reset) appear at `http://localhost:5173/api/dev/mail` while `SYNDO_DEV_MAIL=1`.

Voice/video locally: run a LiveKit dev server (`livekit-server --dev`, key `devkey` / secret `secret`) — install it from LiveKit's releases or Docker image `livekit/livekit-server`.

Tests:

```bash
createdb -O syndo syndo_test
```

```bash
npm test
```

```bash
npm run build && npm start -w @syndo/server   # serves web/dist on :3900
```

```bash
node e2e/smoke.cjs http://localhost:3900 ./shots   # needs Playwright + Chromium
```

## Production (single host, Docker Compose)

Reference layout in `deploy/`: PostgreSQL, the Syndo image (API + built web client), LiveKit with embedded TURN, Caddy for automatic TLS. **This compose file has not been run in the build environment (no Docker daemon there); validate it on your host.**

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
| `SYNDO_PUBLIC_URL` | `http://localhost:5173` | Public origin (emails, Origin check) |
| `SYNDO_EXTRA_ORIGINS` | — | Extra allowed origins, comma-separated |
| `SYNDO_COOKIE_SECURE` | off | Set `1` behind HTTPS |
| `SYNDO_TRUST_PROXY` | off | Set `1` behind Caddy/nginx so client IPs are correct |
| `SYNDO_STORAGE_DIR` | `syndo/data/storage` | Uploaded files |
| `SMTP_URL`, `SYNDO_MAIL_FROM` | — | Outgoing email. Without SMTP, mails are only recorded in `mail_outbox` |
| `SYNDO_REQUIRE_VERIFIED_EMAIL` | off | Require verified email to post/join |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | — | Media server; without them calls are disabled and the UI says so |
| `SYNDO_MAX_UPLOAD_MB` | 100 | Upload limit for everyone |
| `SYNDO_MAX_MESSAGE_LENGTH` | 4000 | Message length for everyone |
| `SYNDO_MAX_GUILDS_PER_USER` / `SYNDO_MAX_MEMBERS_PER_GUILD` / `SYNDO_MAX_GROUP_DM` | 200 / 25000 / 10 | Membership limits |
| `SYNDO_MAX_VOICE_KBPS` | 510 | Highest selectable Opus bitrate |
| `SYNDO_MAX_STREAM_HEIGHT` / `_FPS` / `_KBPS` | 2160 / 60 / 20000 | Screen-share caps |
| `SYNDO_RATE_LIMIT`, `SYNDO_AUTH_RATE_LIMIT` | 600 / 10 per min | Request limits |
| `SYNDO_JOBS` | on | Set `0` on all but one node |
| `SYNDO_DEV_MAIL` | off | **Never in production** — exposes the outbox |

All limits apply identically to every account and are published at `/api/instance` and in Settings → About.

### Updating

```bash
git pull && cd syndo/deploy && docker compose up -d --build
```

Migrations in `server/migrations/` run automatically at start, each in a transaction. Restart the API after rebuilding the web client (static routes are registered at start).

## Costs

| Item | Required? | Cost driver |
|---|---|---|
| VM(s) | Yes | CPU for the SFU (mostly packet forwarding, not transcoding) and bandwidth |
| Bandwidth | Yes | Dominant cost for voice/video — see the worksheet in OPERATIONS.md |
| Block storage / object storage | Yes | Attachments and backups |
| SMTP provider | Optional | Per-email pricing; any SMTP works |
| Domain + certificates | Yes / free | Let's Encrypt via Caddy |
| GIF provider | Optional, not built | Provider's API terms |

No universal price is given — derive it from your expected usage with the worksheet.
