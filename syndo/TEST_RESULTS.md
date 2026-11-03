# Syndo — Test results

Only tests that were actually run are reported as passed. Date of runs: 2026-11-03.

## Environment

| Item | Value |
|---|---|
| OS | Linux 6.18 (cloud build container, x86_64, 16 vCPU, 15 GB RAM) |
| Node.js | 22.23.4 |
| PostgreSQL | 16.15 (Ubuntu 24.04 package), local |
| Browser (E2E) | Chromium bundled with Playwright (headless), Linux |
| Network | Loopback only (all clients on the same host) |
| Media server | **None** — LiveKit could not be run in this sandbox (the Go module could not be built: it relies on `replace` directives, and running externally downloaded binaries was not permitted). Docker daemon unavailable. |

## Automated suites

### Server integration — `cd syndo && npm test` → **37 / 37 passed**

Real Syndo server on a random port, fresh PostgreSQL schema, each test user is an independent client with its own cookie jar and WebSocket (as separate browsers would be).

| Suite | Tests | Result |
|---|---|---|
| Scenario 1 — accounts, friends, DMs, reconnect, history | 6 | pass |
| Scenario 2/17 — roles, private channels, no leaks via messages, search, files, reactions, pins or gateway; hierarchy; audit log | 5 | pass |
| Scenario 3 — edits, reactions, deletions, typing across clients and a second device | 1 | pass |
| Scenario 14 — blocking, timeouts, kicks, bans, unban | 2 | pass |
| Scenario 15 — session revocation closes socket; password reset revokes all; CSRF origin check | 3 | pass |
| MFA — TOTP, pending sessions, single-use recovery codes | 1 | pass |
| Invites — atomic max-use race, revocation, custom alias | 1 | pass |
| Voice admission — token grants follow SPEAK/VIDEO/CONNECT; voice state removed on access loss | 2 | pass |
| Account data — export and deletion | 1 | pass |
| Permission model unit tests | 5 | pass |
| Friends decline/cancel/remove; request & DM privacy | 3 | pass |
| Avatar upload content validation; mutuals + privacy | 1 | pass |
| Category sync; slow mode; malformed ids → 400; pins/saved/bulk delete; leave/transfer/delete | 5 | pass |
| Group conversations lifecycle | 1 | pass |

Bugs found by these tests and fixed: slow mode counted the automatic "joined" system message (new members were rate-limited on their first message); malformed ids returned HTTP 500 instead of 400.

### Browser end-to-end — `node e2e/smoke.cjs http://localhost:3900 <dir>` → **18 / 18 passed**

Two separate Chromium contexts (plus a third for the second-device check and a 390×844 mobile context) driving the production build served by the API.

register ×2 · friend request · live accept · DM with markdown both ways · history after reload · create server · invite link · join by invite · live server message · reaction sync · edit sync · private channel invisible to member · light theme applies · theme synced to a second login · skip link first in tab order · mobile layout without horizontal scroll · no uncaught page errors.

Bugs found and fixed: an infinite render loop from unstable store selectors (React #185); off-canvas sidebar peeking on mobile; Friends tabs overflowing on narrow screens.

Screenshots: `docs/screenshots/`.

### Backup / restore (scenario 19) → **passed**

`pg_dump -Fc` of the E2E database → `pg_restore` into a new database → identical row counts for users, guilds, channels, messages, relationships, invites, reactions, sessions → a server booted on the restored database and an existing user logged in (HTTP 200). Attachment files are on disk and must be backed up alongside (see OPERATIONS.md); file restore was not part of this run.

## Required scenarios — status

| # | Scenario | Result |
|---|---|---|
| 1 | Register, friend, DM, reconnect, recover history | **Passed** (server + browser) |
| 2 | Roles + private channels; no access to messages/search/files/subscriptions | **Passed** |
| 3 | Edits/reactions/deletions sync without duplicates | **Passed** |
| 4 | Friends complete voice and video calls | **Not run** — needs a deployed LiveKit |
| 5 | Multiple members in voice + screen share | **Not run** |
| 6 | Calls through forced TURN relay | **Not run** |
| 7 | Network interruption recovers or errors clearly | Gateway: **passed** (reconnect + backfill). Media: **not run** |
| 8 | Audio presets change effective encoder config | **Not run** |
| 9 | Stereo/music mode with suitable input/receivers | **Not run** |
| 10 | Measured 1080p60+ screen share | **Not run** |
| 11 | Source mode keeps native dimensions | **Not run** |
| 12 | Unsupported capture audio/quality explained | UI copy implemented; **not run** on Safari/Firefox |
| 13 | Viewers with different bandwidth get appropriate quality | **Not run** |
| 14 | Mute/block/timeout/ban/role changes enforced | **Passed** for messaging and admission; SFU-side enforcement **not run** |
| 15 | Session revocation and channel-access removal end access | **Passed** (HTTP, gateway, files, search, voice state) |
| 16 | Customization persists, no payment | **Passed** (theme sync); no payment code exists |
| 17 | Attachments, previews, search can't bypass permissions | **Passed** (previews not built yet) |
| 18 | Keyboard navigation and reduced motion | Partially: skip link tested; full keyboard audit **not run** |
| 19 | Backups restore | **Passed** (database) |
| 20 | Load test | **Not run** |

## Media test plan (to run on the first deployment)

Record for each run: client app/browser + version, OS, network (ISP/Wi-Fi/mobile, NAT type), settings used, diagnostics screenshot.

1. Two devices on different networks (home Wi-Fi + phone hotspot) join a DM call: audio both ways, camera both ways, diagnostics show path `srflx`/`host`.
2. Force relay: in Chromium `chrome://webrtc-internals` or by blocking UDP 50000–60000 on one client's firewall → path shows `relay via TURN/udp`, then block UDP entirely → `relay via TURN/tls`.
3. Music preset with a stereo test file (left/right tones) routed as microphone → receiver diagnostics show `channels 2`, fmtp `stereo=1`, measured 150–256 kbps on music; speech preset with silence shows DTX near 0 kbps.
4. Screen share 1080p60 motion and 1440p/2160p detail on a capable GPU → sender layers show requested size/fps or a `qualityLimitationReason`; Source mode on an ultrawide shows the native width/height.
5. Three viewers, one throttled to 1.5 Mbit/s with `tc` → throttled viewer receives the low layer, others stay on the high layer.
6. During a call: server-mute, remove CONNECT, ban, revoke session → media stops within ~2 s.
