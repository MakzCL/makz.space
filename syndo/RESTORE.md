# SEND restore points

## 2026-11-05 — stickers, NEW messages line, category banner sizes

| Layer | Restore point (before) |
|---|---|
| Source | branch `backup/pre-stickers-20261105` → `ed64fa5` |
| Backend (Worker `send-beta-api`) | version `c7b3bca7-9828-4210-8e5a-59a6f8b81c76`, `SOURCE_COMMIT` `ed64fa5` |
| Web (Pages `syndo-app`) | deployment `e93b6b19-c203-46fb-a3c3-e5502117c63c` |
| Database (Supabase `syndo-beta`) | migration `005_stickers.sql` applied (additive: table `guild_stickers`, column `messages.sticker_id`). Older code ignores both. To remove: `alter table syndo.messages drop column sticker_id; drop table syndo.guild_stickers; delete from syndo.schema_migrations where name = '005_stickers.sql';` |

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → `c7b3bca7` at 100%, then call any `/api/…` route.
2. Web: Pages → `syndo-app` → Deployments → `e93b6b19` → *Rollback to this deployment*.

## 2026-11-05 — expressions live (emoji, soundboard, category banners) + plain DMs

| Layer | Restore point (before) |
|---|---|
| Source | branch `backup/pre-expressions-plain-dms-20261105` |
| Backend (Worker `send-beta-api`) | version `52515a3a-4d09-4040-8da1-22f202aff1b8`, `SOURCE_COMMIT` `e4c68d7` |
| Web (Pages `syndo-app`) | deployment `157f2b15-eb4a-483b-b58d-c6bfcd31e48c` |
| Database (Supabase `syndo-beta`) | migration `004_expressions.sql` applied (additive: tables `guild_emojis`, `guild_sounds`, column `channels.banner_key`). Older code ignores them, so a backend rollback needs no database change. To remove them: `drop table syndo.guild_emojis, syndo.guild_sounds; alter table syndo.channels drop column banner_key; delete from syndo.schema_migrations where name = '004_expressions.sql';` |

DMs: the server no longer requires end-to-end encryption (`SYNDO_REQUIRE_DM_E2EE` = "0"); clients send DMs as normal messages. Older encrypted messages decrypt where a device still has its key, otherwise show "Older encrypted message". Re-enable the old mode by setting it back to "1" (and rolling back the web app).

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → `52515a3a` at 100%, then call any `/api/…` route.
2. Web: Pages → `syndo-app` → Deployments → `157f2b15` → *Rollback to this deployment*.

## 2026-11-05 — desktop 0.4.3 (minimum window 940×560)

| Layer | Restore point (before this release) |
|---|---|
| Desktop feed | `syndo-desktop/latest-0.4.2.yml` (backup of the feed that pointed at `SEND-Setup-0.4.2.exe`; the 0.4.2 installer is still in the bucket) |
| Backend (Worker `send-beta-api`) | version `b672b19c-6a0d-4c35-9d70-eafdc2fd3f07`, `SOURCE_COMMIT` `e4c68d7` (unchanged by this release) |
| Web (Pages `syndo-app`) | deployment `157f2b15-eb4a-483b-b58d-c6bfcd31e48c` (unchanged by this release) |
| Source | branch `claude/charming-meitner-a8exoe` at `645e42c`; database unchanged |

Released: feed `latest.yml` → `SEND-Setup-0.4.3.exe` (CI run 42105536340, sha512 checked on the public copy); Worker version `52515a3a-4d09-4040-8da1-22f202aff1b8` sends `/api/downloads/windows` to 0.4.3 (same code otherwise, no container restart). Uploaded with a one-hour R2 token limited to this bucket, deleted right after.

### Roll back
1. Feed: copy `latest-0.4.2.yml` over `latest.yml` (`text/yaml`, `cache-control: no-cache`). Apps already on 0.4.3 stay on it.
2. Download link: Workers → `send-beta-api` → Deployments → deploy `b672b19c` at 100%.

## 2026-11-05 — desktop 0.4.2 (SEND updater window, one-click installer)

Feed `latest.yml` → `SEND-Setup-0.4.2.exe` (CI run 42069023171, commit `a800c30`, sha512 checked on the public copy). Previous feed saved as `latest-0.4.1.yml`. Worker version `f731760b-d71b-4f79-aecf-4a02a204c016` links `/api/downloads/windows` to 0.4.2.
Roll back the feed: copy `latest-0.4.1.yml` over `latest.yml` (`text/yaml`, `no-cache`).

## 2026-11-05 — desktop 0.4.1 (manual updates, green title-bar button)

| What | Where |
|---|---|
| Feed | `syndo-desktop/latest.yml` → `SEND-Setup-0.4.1.exe` (+ `.blockmap`), from CI run 42060472562, commit `fd1002b`; sha512 checked against the public copy |
| Previous feed | `syndo-desktop/latest-0.4.0.yml` (backup copy) — `SEND-Setup-0.4.0.exe` is still in the bucket |
| Download link | Worker version `19ac59e6-630d-49dd-ad52-b24d3a974c5c` sends `/api/downloads/windows` to 0.4.1 |

Roll back the feed: copy `latest-0.4.0.yml` over `latest.yml` (content-type `text/yaml`, `cache-control: no-cache`). Apps that already installed 0.4.1 stay on it.
Uploaded with a one-hour R2 token limited to this bucket, deleted right after.

## 2026-11-05 — before instant voice join/leave

| Layer | Restore point |
|---|---|
| Source | branch `backup/pre-voice-instant-20261105` → commit `d8355f4` (last commit before the voice change) |
| Backend (Worker `send-beta-api`) | version `9d3cea92-a17f-42ea-ae3c-5df2abf71f68`, `SOURCE_COMMIT` `71ab841b5413d0e1a0bf8d867addf123d53577fe` |
| Web (Pages `syndo-app`) | deployment `de04c4d4-04ad-4be2-a85c-9fccd7d816cd` (direct upload, commit `975a7ad`) |
| Database | no schema change in this update; nothing to restore (the 2026-11-04 copy `syndo_backup_20261104` still exists) |

Deployed 2026-11-05: backend version `728a39d9-1bf8-4007-9e4b-8ae49a08a249` (same Worker code, `SOURCE_COMMIT` `d42a8cc`), web deployment `f84a7e76-3d15-4def-abdc-8fe3aadf5e87` (Git build of `a21f1bf`). Server tests passed in CI against real PostgreSQL (run 42045959617).
The web update also ships the two commits that were pushed but not yet live: `a62cefd` (participant/stream actions) and `d8355f4` (quiet DM encryption).

Note: Git-triggered Pages builds can sit at "queued" indefinitely. Retrying the newest one (Deployments → … → *Retry deployment*, or `POST …/deployments/<id>/retry`) starts it.

### How to roll back

1. **Backend**: Workers → `send-beta-api` → Deployments → deploy version `9d3cea92` at 100%, then call any `/api/…` route once (the container restarts on the old source within ~60 s).
2. **Web**: Pages → `syndo-app` → Deployments → `de04c4d4` → *Rollback to this deployment*.

### 2026-11-05 (later) — faster backend cold start

1. Backend version `528ea7b3-a2ad-494f-851f-79c0639dc081`: the container extracts only `syndo/server` + `syndo/shared` and installs only their production packages. Restart ~25 s (was ~60–70 s).
2. Backend version `d98de0c9-d037-4ad3-8b59-6f02ea01847c` (and later, same code): **runtime cache**. After a fresh install the container saves the unpacked server + `node_modules` (~12 MB) to the private uploads bucket as `_runtime/<SOURCE_COMMIT>.tgz`; later cold starts for that commit download and unpack it instead of GitHub + npm. Any cache problem falls back to the normal install. Measured: cached cold start **8.2 s**, fresh install 25–29 s. Live Worker pins `SOURCE_COMMIT` `d5dbd85`. Old `_runtime/*.tgz` objects can be deleted at any time (they are only a speed-up).

Roll back: deploy version `728a39d9-1bf8-4007-9e4b-8ae49a08a249` at 100% (voice update, original startup), then call any `/api/…` route.

## 2026-11-04 — before Discord-parity work

| Layer | Restore point |
|---|---|
| Source | branch `backup/send-restore-20261104` → commit `19cf9a9` |
| Backend (Worker `send-beta-api`) | version `3d7456ee-0503-4f22-a715-7f6b92022245`, `SOURCE_COMMIT` `44e11d9cad56c1e132d9d5f61c006c32881e6c7e` |
| Web (Pages `syndo-app`) | deployment `af23079d-010a-47e7-8511-e40d4ebdc5c2` (commit `44e11d9`) |
| Database (Supabase `syndo-beta`) | schema `syndo_backup_20261104` — a full copy of every `syndo` table (30 tables; 24 users, 35 messages) |
| Uploads (R2 `syndo-beta-uploads`) | not copied; no code path deletes objects, so existing files are untouched |

### How to roll back

1. **Web**: Cloudflare dashboard → Pages → `syndo-app` → Deployments → `af23079d` → *Rollback to this deployment*.
2. **Backend**: Workers → `send-beta-api` → Deployments → deploy version `3d7456ee` at 100%.
   The container restarts on the next request (10–60 s of "starting").
3. **Database** (only if data was damaged): restore a table, e.g.
   `begin; truncate syndo.messages; insert into syndo.messages select * from syndo_backup_20261104.messages; commit;`
   Do this table by table, and only for tables a later migration changed. New migrations are additive,
   so a backend rollback normally needs no database restore.
