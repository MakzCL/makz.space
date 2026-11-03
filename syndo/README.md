# Syndo

**Talk together. Belong together.** A free, self-hostable place for friends and communities to chat, call, and share their screens — every feature for everyone, with no subscriptions, boosts or paid cosmetics.

Syndo is an independent platform with its own accounts, servers and media infrastructure. It does not connect to or interoperate with other chat services.

| Document | What's in it |
|---|---|
| [FEATURE_MATRIX.md](FEATURE_MATRIX.md) | Every tracked feature with status, evidence and acceptance test |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data model, permissions, gateway, media, encryption model |
| [PLATFORM_CAPABILITIES.md](PLATFORM_CAPABILITIES.md) | What each browser/OS can capture and send |
| [TEST_RESULTS.md](TEST_RESULTS.md) | What was tested, how, and what hasn't been |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Local dev, production compose, configuration, costs |
| [OPERATIONS.md](OPERATIONS.md) | Backups/restore, maintenance, scaling limits, capacity worksheet |
| [THEMES.md](THEMES.md) | Syndo Studio, where every control lives, theme schema, custom CSS rules |
| [DESKTOP.md](DESKTOP.md) | Windows app, Cloudflare Pages web app, R2 auto-updates, releasing |

Branding lives in one place: `shared/src/brand.ts` (name, colours, fonts, assets, loading lines). Logo and icons: `web/public/brand/`.

Quick start: see [DEPLOYMENT.md](DEPLOYMENT.md#local-development).

## Messaging tools

- **Saved messages**: open the private inbox from Home's sidebar, or search for it with Ctrl/Cmd+K. Search by text, sender, channel or attachment name; jump back to the message or remove the save. It refreshes on edits, removals and permission changes. The existing API returns at most 200 recent saves; inbox search filters that window.
- **Mentions**: type `@` in a conversation to suggest members and permitted roles. Arrow keys choose, Enter/Tab insert, Escape dismisses, and Shift+Enter keeps a new line. Server member search also finds people beyond the first loaded member page. Mass mentions appear only when you have permission.
- **Mute**: use the bell in a conversation header to silence its message notifications. The preference syncs to your other sessions. Reading and sending remain available; incoming calls retain their existing notification behaviour.

Run `npm run test:web` for the messaging interface interaction tests (React + JSDOM, without media devices). `npm test` remains the server integration suite requiring PostgreSQL. Neither command verifies real call media or browser layout.
