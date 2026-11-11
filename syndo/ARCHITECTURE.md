# SEND — Architecture

## Starting point (audit)

This repository (`makz.space`) already held two unrelated applications: the personal site at the root (Next.js + Supabase) and `factory/` (Vite + React + Supabase, an internal factory-operations app with 1:1/group chat and **mesh** WebRTC calls). Neither has the tenancy, permission model or media architecture a public community platform needs:

- Their accounts are single-tenant (a personal site; an invite-only workforce with fixed job roles). SEND needs open registration, servers with per-channel role overwrites and bans.
- The factory call system is full-mesh peer-to-peer over Supabase Realtime signalling. Mesh does not scale to group video or high-quality screen sharing (each sender encodes once *per viewer*), so the brief explicitly requires an SFU.

So SEND is a **new, separate app in `syndo/`**, following the repo's existing conventions (a self-contained app folder, TypeScript, React, PostgreSQL with permission tests against a real database). What was reused from the factory app is *knowledge*, not code: its ICE/TURN handling notes and call-UX lessons (explicit camera-off state, ring timeouts, deterministic reconnect) informed `voice/session.ts` and `routes/voice.ts`. No authentication, messaging, permission or calling system is duplicated *within* SEND.

## Components

```
browser / desktop / mobile client (web/, React + livekit-client)
        │  HTTPS  (REST /api/*, cookie or bearer auth)
        │  WSS    (/gateway — real-time events)
        ▼
SEND API (server/, Node 22 + Fastify + ws)            LiveKit SFU (self-hosted, Apache-2.0)
  • auth, sessions, MFA                                  • WebRTC media: Opus, VP8/VP9/AV1/H.264
  • permissions (shared/src/permissions.ts)              • simulcast / SVC, congestion control
  • messages, files, search, invites, moderation  ──JWT──▶ • embedded TURN (UDP/TCP/TLS)
  • gateway fan-out, presence, voice state         ◀─API── • participant removal / permission updates
  • background maintenance
        │
        ▼
PostgreSQL 16 (durable state + full-text search)       Object storage (local disk driver; S3-compatible planned)
```

| Concern | Choice | Why |
|---|---|---|
| Relational storage | PostgreSQL 16 | Durable, transactional, row counts and FTS in one place; already the repo's database |
| API | Fastify 5 on Node 22, TypeScript via `tsx` | Mature, fast, schema-friendly; same language as client so the permission code is shared |
| Real-time | `ws` WebSocket gateway in the API process | Simple, authenticated; dispatch is filtered per recipient through the same permission code as HTTP |
| Media | **LiveKit** (SFU) | Self-hostable, maintained, real SFU with simulcast/SVC, Opus stereo/DTX/RED, AV1/VP9/H.264, built-in TURN, server API to kick/restrict participants. Evaluated against mediasoup (lower-level library, we'd build signalling/TURN/ops ourselves) and Janus (plugin-based, older ecosystem); LiveKit gives the most verified functionality per line of our code. |
| TURN | LiveKit embedded TURN (UDP 3478, TLS 5349, ICE/TCP 7881) | Relays for strict NAT/firewalls; coturn remains an option |
| Files | Storage driver (`server/src/storage.ts`): local disk now | S3/MinIO driver needed for multi-node; tracked |
| Search | PostgreSQL `tsvector` + `ILIKE` fallback, restricted to channels the user may read | Permission-correct by construction; swap for Meilisearch/OpenSearch at large scale |
| Jobs | In-process maintenance loop + durable `jobs` table (SKIP LOCKED) | Cleanup of orphan uploads, sessions, tokens, statuses |
| Email | Nodemailer over operator SMTP; every mail recorded in `mail_outbox` | Works with any provider; dev/test read the outbox |

## Identity & branding

`shared/src/brand.ts` is the single source of the product's name, tagline, colours, surfaces, fonts, asset paths and loading lines. The web client turns it into CSS tokens at runtime (`web/src/theme.ts`), the Vite plugin generates `<title>`, meta tags and `manifest.webmanifest` from it, and the server uses it for email subjects/footers and `/api/instance`. Logo and icons are original SVGs in `web/public/brand/` (PNGs rendered from them).

The mark is three voices — warm yellow, calm blue, soft coral — around one shared white centre, the blue one carrying a speech tail. Blue and yellow are the colours long associated with Down syndrome awareness; the three voices quietly echo the third copy of chromosome 21. Publicly, it reads as friends in conversation.

## Data model (migration `001_core.sql`)

`users`, `sessions` (hashed tokens, device info, revocation), `email_tokens`, `mfa_recovery_codes`, `relationships` (one row per direction: friend/blocked/incoming/outgoing), `guilds`, `roles` (`@everyone` shares the guild id), `members`, `member_roles`, `bans`, `channels` (all types, incl. DMs), `channel_recipients`, `dm_pairs` (one DM per pair), `permission_overwrites`, `messages` (soft delete, nonce uniqueness, generated `tsvector`), `attachments` (pending until attached to a message), `reactions`, `read_states`, `saved_messages`, `invites`, `audit_log`, `jobs`, `mail_outbox`.

IDs are 64-bit time-ordered integers (`server/src/ids.ts`), serialised as strings. Ordering and cursor pagination use the id.

## Permissions

`shared/src/permissions.ts` defines a 41-flag bitfield and the resolution algorithm (owner → base roles → ADMINISTRATOR → @everyone overwrite → combined role overwrites → member overwrite → no VIEW means nothing → timeout leaves view/history). The **server** (`server/src/perms.ts`) is authoritative and is called by:

- every HTTP handler (`requireChannel`, `requireGuild`);
- gateway fan-out (`viewers()` — a message event is only sent to users who could fetch it);
- attachment downloads (checked per request; there are no public attachment URLs);
- search (candidate channels filtered first, then queried);
- media tokens (grants derived from CONNECT/SPEAK/VIDEO; server mute removes the microphone source).

Invisible resources return 404, never 403, so their existence isn't revealed. After any change that can alter visibility (roles, overwrites, member roles, timeouts) the server re-sends each online member their view of the guild (`GUILD_SYNC`) and re-checks everyone in voice: anyone who lost CONNECT is dropped from the gateway voice state and removed from the SFU room; anyone who lost SPEAK/VIDEO has publishing rights reduced.

## Real-time gateway

`/gateway` WebSocket. Auth by session cookie on upgrade, or an `identify` frame with a bearer token. Server sends `hello`, then `READY` (user, guilds with only visible channels and computed permissions, DMs, relationships, read states, presences, visible voice states, instance limits). Events: `MESSAGE_*`, `MESSAGE_REACTION_*`, `TYPING_START`, `MESSAGE_ACK`, `MENTION`, `GUILD_*`, `GUILD_MEMBER_*`, `CHANNEL_*`, `RELATIONSHIP_*`, `PRESENCE_UPDATE`, `USER_UPDATE`, `USER_SETTINGS_UPDATE`, `VOICE_STATE_UPDATE`, `CALL_*`, `SESSION_REVOKED`. Client ops: `heartbeat`, `status`, `voice_state`.

**Reconnect recovery:** the client reconnects with jittered exponential backoff, receives a fresh READY, then fetches `?after=<newest known id>` for every loaded channel. Messages are keyed by id and sends carry a client `nonce` (unique per author+channel in the database), so retries and replays never duplicate.

**Scaling limit (honest):** the hub is in-process. One API node handles all WebSockets. Horizontal scaling needs a pub/sub bus (Redis or Postgres `LISTEN/NOTIFY`) between nodes — tracked in OPERATIONS.md.

## Media

The API never carries audio/video. `POST /api/voice/token` returns a 10-minute LiveKit JWT whose grants reflect the caller's permissions in that channel. The client (`web/src/voice/session.ts`) publishes:

- **Microphone**: Opus, 48 kHz capture, user-chosen max bitrate (32–510 kbps, capped by the operator), stereo via `forceStereo` + 2-channel capture, DTX, RED, and individually toggled echo cancellation / noise suppression / auto-gain. Bitrate changes are applied live with `RTCRtpSender.setParameters`; SDP-level changes (stereo, DTX, RED, processing) re-publish the track.
- **Camera**: simulcast VP8, 360–1080p.
- **Screen**: AV1 → VP9 → H.264 preference with a backup codec, `maintain-resolution` for text or `maintain-framerate` for motion, a lower simulcast layer for constrained viewers, and **Source** mode (no resize constraint → captured surface's native size).
- **Diagnostics** (`voice/diagnostics.ts`): negotiated codec/clock rate/channels and Opus fmtp, measured send kbps, loss, jitter, RTT, per-layer resolution/fps/kbps and quality-limitation reason, inbound quality per participant, and the ICE path (host / srflx / relay over UDP/TCP/TLS).

## Encryption model

| Path | Protection |
|---|---|
| Browser ↔ API/gateway | TLS (terminated by Caddy in the reference deployment) |
| Browser ↔ SFU | DTLS-SRTP (mandatory in WebRTC); signalling over WSS |
| TURN relay | Relayed packets are still DTLS-SRTP; TURN/TLS on 5349 additionally hides the transport |
| Database, files at rest | Not encrypted by SEND. Use encrypted volumes/disks and encrypted backups |
| Passwords | scrypt (N=32768, r=8, p=1) with per-user salt |
| Session tokens, email tokens, recovery codes | Only SHA-256 hashes stored |

**Calls are not end-to-end encrypted.** The SFU decrypts SRTP to route media, so whoever operates the media server could technically access it. Messages are readable by the server operator. E2EE for calls (LiveKit's insertable-streams E2EE, supported in Chromium/Safari, with a key-distribution design) is tracked as a separate item and must not be advertised until built and tested across supported clients.

## Security controls

Origin check + SameSite=Lax httpOnly cookies against CSRF; per-route and global rate limits; Zod validation on every body; uploads sniffed by content (claimed MIME ignored), SVG never rendered, downloads sent with `nosniff`, `sandbox` CSP and `attachment` disposition for non-media; profile media restricted to strict key patterns; message markdown rendered to React elements only (no HTML strings); themes are whitelisted colour tokens only; masked links confirm their destination; no account enumeration via login, reset or friend requests; blocked users aren't told they're blocked.

## Appearance system

`shared/src/theme.ts` defines the theme schema, validator, layered resolution and the scoped custom-CSS parser; `shared/src/presets.ts` the 12 built-in themes. The server stores personal appearance per scope in `appearance_prefs` (private, revisioned), presets in `theme_presets`, wallpapers in `appearance_assets` (owner-only, served via `/api/appearance/assets/:id`), shared conversation themes in `conversation_themes` + votes, and server profiles as columns on `members`. The client (`web/src/appearance/`) resolves the hierarchy for the current server/channel, writes CSS variables per region (background-layer alpha only), renders wallpapers in a dedicated layer, and caches a snapshot so the next start paints without a flash. Details: THEMES.md.

## Distribution

- Web app: static build on Cloudflare Pages with Pages Functions proxying `/api/*` and `/gateway` to the API origin (`web/functions`, `web/edge/proxy.ts`).
- Desktop: `desktop-tauri/` lightweight Tauri (Rust + system WebView2) shell loading the hosted web app, manual updates from the `latest.yml` feed on Cloudflare R2. CI: `.github/workflows/syndo.yml` (`desktop-lite` job). Details: DESKTOP.md.

## Code map

```
syndo/
  shared/src/   brand.ts (identity), permissions.ts, types.ts (wire types), media.ts (quality presets)
  server/src/   app.ts, index.ts, auth.ts, gateway.ts, perms.ts, ready.ts, media.ts, storage.ts, mail.ts, jobs.ts
                routes/ users, dms, guilds (roles/members/channels/invites/audit), messages (+search, files), voice
  server/migrations/   SQL migrations (applied on boot)
  server/test/  integration tests (real Postgres, HTTP + WebSocket clients)
  web/src/      main.tsx, store.ts, gateway.ts, actions.ts, markdown.tsx, theme.ts, notify.ts
                components/ Shell, ChannelView, Friends, Dialogs, UserSettings, ServerSettings, VoiceStage, …
                voice/ session.ts, settings.ts, diagnostics.ts
  web/src/appearance/  engine, store, Studio, backgrounds, effects, profile editor, recovery
  desktop-tauri/ Tauri shell (Rust: window, tray, push-to-talk, updater; init.js bridge; local connect/updater pages)
  e2e/          browser tests (smoke.cjs, appearance.cjs)
  deploy/       docker-compose, Caddyfile, livekit.yaml
```
