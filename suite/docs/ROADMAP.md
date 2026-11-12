# SK Suite — launcher and shared infrastructure

SK Suite is the desktop home for the SK applications. It launches each application in its own window, installs and updates them, and holds the shared sign-in for the web apps. It contains **no engineering editing**: NUCLUES (EDA) and CADRA (mechanical CAD) are independent applications that SK Suite bundles and launches.

## Rules
- Each application keeps its own identity, version, release cycle and file format.
- NUCLUES and CADRA work fully offline. They never depend on an SK Suite service to edit, save, simulate or export. If an SK Suite service is unavailable, local work is unaffected.
- One application failing or updating does not affect the others: each runs in its own window.

## Status (version 0.3.0)

| Capability | Status | Tests |
|---|---|---|
| Hub listing the apps (SK Factory, Kortana, TROTAN, NUCLUES, CADRA) | VERIFIED | `tests/e2e.mjs` |
| Web apps open their live site in their own window; persistent sign-in session | VERIFIED | `tests/e2e.mjs` |
| NUCLUES and CADRA bundled and served offline from `app://<id>/` | VERIFIED | `tests/e2e.mjs` (opens both with no network; draws in CADRA; runs NUCLUES examples) |
| One-click updates: SHA-256-checked manifest, staged install, restart, rollback if the new version fails its health check | VERIFIED | `tests/update.e2e.mjs`; the live feed was checked file by file on 2026-11-10 |
| Palette shared across apps; sign out of this computer | VERIFIED | `tests/e2e.mjs` |
| Per-application versions shown and updated independently | IN DEVELOPMENT | Today the bundled apps update as part of the suite feed |
| Windows installer, file associations (`.nuclues` → NUCLUES, `.cadra` → CADRA), code signing | NOT STARTED | Portable zip only |
| Shared accounts and permissions for NUCLUES/CADRA | NOT STARTED | Not needed for offline engineering work |
| Licensing infrastructure | NOT STARTED | — |

## Next
1. Per-application update channels, so NUCLUES and CADRA can release without a suite release.
2. A Windows installer with file associations.
3. Crash reporting and recovery, with the user's consent.
