# SEND restore points

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
