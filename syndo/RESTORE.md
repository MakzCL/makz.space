# SEND restore points

## 2026-11-05 — before instant voice join/leave

| Layer | Restore point |
|---|---|
| Source | branch `backup/pre-voice-instant-20261105` → commit `d8355f4` (last commit before the voice change) |
| Backend (Worker `send-beta-api`) | `SOURCE_COMMIT` `44e11d9cad56c1e132d9d5f61c006c32881e6c7e` (what was pinned before this update). Also note the Worker version shown under Workers → `send-beta-api` → Deployments before deploying. |
| Web (Pages `syndo-app`) | the production deployment listed first under Pages → `syndo-app` → Deployments before this update |
| Database | no schema change in this update — nothing to restore; the 2026-11-04 schema copy `syndo_backup_20261104` still exists |

The update: commit `d42a8cc` (voice: instant name tag on join/leave, faster connect). Server tests passed in CI against real PostgreSQL (run 42045959617).

### How to roll back

1. **Backend**: set `SOURCE_COMMIT` in `syndo/cloudflare/wrangler.jsonc` back to `44e11d9cad56c1e132d9d5f61c006c32881e6c7e` and `npx wrangler deploy` from `syndo/cloudflare` (or redeploy the previous Worker version at 100% in the dashboard).
2. **Web**: Pages → `syndo-app` → Deployments → the previous production deployment → *Rollback to this deployment*.

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
