# SEND restore points

## 2026-11-12 — Go Live dialog (web only)

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | deployment `464f7ba6-9e88-4edd-988c-9f535a1f24cb` (commit `e828048`) |
| Backend, desktop feed | unchanged |

Web: deployment `02fa8049-f231-4472-8949-6899d069b5af` (commit `28ad2d0`, build id `xi17ah`).
Roll back: Pages → `syndo-app` → Deployments → `464f7ba6` → *Rollback to this deployment*.

## 2026-11-12 — motion, voice messages, centred + (web only)

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | deployment `3b0ff942` |
| Backend, desktop feed | unchanged (the server voice-note type fix is in the code but not deployed) |

Web: deployment `464f7ba6-9e88-4edd-988c-9f535a1f24cb` (commit `e828048`, build id `4r9210`).
Roll back: Pages → `syndo-app` → Deployments → `3b0ff942` → *Rollback to this deployment*.

## 2026-11-11 — desktop 0.6.4 (updater no longer freezes)

0.6.2 and 0.6.3 froze on the "Updating SEND" window: the update commands were synchronous, so the window was built
on the main thread, which deadlocks on Windows. 0.6.4 runs them off the main thread. The web app sends 0.6.2/0.6.3
users to the installer instead of their own updater.

| Layer | Restore point (before this release) |
|---|---|
| Desktop feed | `syndo-desktop/latest-0.6.3.yml` (feed at 0.6.3) and `latest-0.6.2.yml`; installers stay in the bucket |
| Download link (Worker `send-beta-api`) | version `c0d0f344-6365-4480-bfe5-575d716edcae` (link → 0.6.2) |
| Web (Pages `syndo-app`) | deployment `75efed08-62ed-49bc-8f49-833e9fa0cdc5` (commit `b46af53`) |

Released from commit `a529209` (CI run 43114670072, artifact digest `sha256:5b002106…`): `SEND-Setup-0.6.4.exe`,
1,728,171 bytes, sha512 verified on the public copy. One-hour bucket-limited token, revoked. Download link: Worker
deployment `19016c5c` (installer name only; `SOURCE_COMMIT` still `cf5ca73`). Web: deployment `3b0ff942`.

### Roll back
1. Feed: copy `latest-0.6.2.yml` over `latest.yml` in the `syndo-desktop` bucket (0.6.3 has the frozen updater too).
2. Download link: Workers → `send-beta-api` → Deployments → deploy version `c0d0f344` at 100%.
3. Web: Pages → `syndo-app` → Deployments → `75efed08` → *Rollback to this deployment*.

## 2026-11-11 — calls fit the window, update prompt, instant messages, desktop 0.6.3

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | deployment `f12b067e-5150-46cb-8965-290c6f990c85` (commit `cf5ca73`) |
| Desktop feed | `syndo-desktop/latest-0.6.2.yml` (backup of the feed that pointed at `SEND-Setup-0.6.2.exe`; that installer stays in the bucket) |
| Backend | unchanged (`SOURCE_COMMIT` `cf5ca73`) |

Web: deployment `75efed08-62ed-49bc-8f49-833e9fa0cdc5` (commit `b46af53`, build id `1vz6rdn`). From this build on,
every later web deploy shows open apps an update button/bar.

Desktop 0.6.3 from CI run 43111248299 (artifact digest `sha256:48b44a4b…`): `SEND-Setup-0.6.3.exe`, 1,729,339 bytes,
sha512 `iViQizMSEywYOuuTa7OMu25Xq5PDpCigHIBQNu6atLlM8p3mYBK+mD3KaTswfCCK3mH2Ff85Xr9XJe5/AaDjMA==` (public copy verified).
Uploaded with a one-hour token limited to `syndo-desktop`, revoked right after. Download link: Worker
`send-beta-api` redeployed (deployment `93da95e2`, only the installer name changed; `SOURCE_COMMIT` kept at `cf5ca73`,
so the server container didn't restart). Before it: version `c0d0f344-6365-4480-bfe5-575d716edcae`.

### Roll back
1. Feed: copy `latest-0.6.2.yml` over `latest.yml` in the `syndo-desktop` bucket.
2. Download link: Workers → `send-beta-api` → Deployments → deploy version `c0d0f344` at 100%.
3. Web: Pages → `syndo-app` → Deployments → `f12b067e` → *Rollback to this deployment*.

## 2026-11-11 — GIPHY GIF search; backend catches up with the rename

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | version `8130bff5-5f0c-4550-97e3-f02947a1e481` (deployment `7aa0f264`), `SOURCE_COMMIT` `baee2d8` |
| Web (Pages `syndo-app`) | deployment `ad315ff1-89a7-40c6-9845-e00dbe14cba8` (commit `e58139d`) |
| Source | commit `54c8c5b`; database unchanged |

Backend: full script upload (with the container declaration, existing secrets kept), `SOURCE_COMMIT`
→ `cf5ca73`, new `SEND_GIF_PROVIDER=giphy` and secret `SEND_GIF_KEY`. This also brings the server half of the
Syndo → SEND rename (SEND_ settings with SYNDO_ fallback, `send_session` cookie, `send_names`). Healthy ~30 s
after upload. Web: deployment `f12b067e-5150-46cb-8965-290c6f990c85` (commit `cf5ca73`).

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → deploy version `8130bff5` at 100%.
   (`send_session` cookies issued meanwhile are not read by that version; those people sign in again.)
2. Web: Pages → `syndo-app` → Deployments → `ad315ff1` → *Rollback to this deployment*.

## 2026-11-11 — Discord-style call tiles

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | deployment `82421f5b-62d5-4ed7-a7c9-94815eb458b5` (commit `3bed9fc`) |
| Backend | unchanged |

Released as deployment `ad315ff1-89a7-40c6-9845-e00dbe14cba8` (commit `e58139d`, started with *Retry deployment*).

### Roll back
1. Web: Pages → `syndo-app` → Deployments → `82421f5b` → *Rollback to this deployment*.

## 2026-11-11 — rename, camera + screen together, no echo in screen shares, voice status, noise suppression

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | deployment `b96e6d11-ebef-46ba-a7af-03eb7177efe2` (commit `3e93951`) |
| Backend (Worker `send-beta-api`) | unchanged — the rename's server side (SEND_ names, `send_session`, `send_names`) arrives with the next backend deploy; the web app works with the current backend |
| Source | commit `3e93951`; database unchanged |

Released as deployment `82421f5b-62d5-4ed7-a7c9-94815eb458b5` (commit `3bed9fc`). Git-triggered builds for
`syndo-app` stay "queued" since this morning; each release so far was started with *Retry deployment*.

### Roll back
1. Web: Pages → `syndo-app` → Deployments → `b96e6d11` → *Rollback to this deployment*.

## 2026-11-11 — AI noise suppression (RNNoise)

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | unchanged |
| Web (Pages `syndo-app`) | deployment `b96e6d11-ebef-46ba-a7af-03eb7177efe2` |
| Source | branch `backup/pre-noise-20261111`; database unchanged |

Noise suppression is now a choice: AI (RNNoise via `@sapphi-red/web-noise-suppressor`, MIT, runs in an AudioWorklet on the device), Standard (the browser's) or None. AI is the default; people who had turned suppression off keep None. Settings → Voice & video, the mic arrow menu in a call, and a quick button next to Disconnect. All three call paths (Cloudflare SFU, mesh, LiveKit) send the cleaned microphone; any failure falls back to the raw microphone. Code and model (~150 KB) load only when used. Web only. `voice/denoise.ts` is where a licensed Krisp SDK would slot in.

## 2026-11-11 — desktop 0.6.2 (update and connect windows match the Glass look)

| Layer | Restore point (before this release) |
|---|---|
| Desktop feed | `syndo-desktop/latest-0.6.1.yml` (backup of the feed that pointed at `SEND-Setup-0.6.1.exe`; that installer stays in the bucket) |
| Backend (Worker `send-beta-api`) | version `1757ed9b-1362-48d5-aa36-a0fb6b9eb9c1` (download link → 0.6.1) |
| Source | branch `backup/pre-desktop-062-20261111`; database unchanged |

Released from commit `27567b2` (CI run 43075692364). `SEND-Setup-0.6.2.exe`, 1,727,238 bytes, sha512 `zIYGSmlTrI5+o8DrlW7sDm6NRLi+vCZuzMOaQlnew0kL8juMuCzpuUpHOVds3aEoDvWrPXzOutg89Cyebsf1XQ==` (public copy verified). The "Updating SEND" window and the connect window use the Glass colours and the new logo animation; no behaviour changes.

### Roll back
1. Feed: copy `latest-0.6.1.yml` over `latest.yml` in the `syndo-desktop` bucket.
2. Download link: Workers → `send-beta-api` → Deployments → deploy `1757ed9b` at 100%.

## 2026-11-11 — themed start-up screen

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | unchanged (`SOURCE_COMMIT` `baee2d8`) |
| Web (Pages `syndo-app`) | deployment `291eac2e-b28e-4153-a1e7-6217ee3eaa45` |
| Source | branch `backup/pre-splash-20261111`; database unchanged |

The start-up screen uses the last session's theme (colours, glass, wallpaper) or the default Glass look on a first visit, with a new logo animation. Fixes the start-up snapshot being overwritten by the defaults before preferences loaded. Web only. Released at `3e93951` (Pages deployment `b96e6d11-ebef-46ba-a7af-03eb7177efe2`).

## 2026-11-11 — phone drawer, reply attachment hint

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | version `5b680e1c-71f4-41b6-b0f7-784b2c4fb499`, `SOURCE_COMMIT` `697f3ff` |
| Web (Pages `syndo-app`) | deployment `2440ea03-8e9b-452a-9a4f-d74fafd362b0` |
| Source | branch `backup/pre-drawer-20261111`; database unchanged |

Phone drawer: search bar, invite and events buttons under the server name, rounded icons and panel. Reply previews of attachment-only messages say "Click to see attachment" (the backend now sends the original's attachment count with `reply_to`).

Released at `baee2d8` (Worker `SOURCE_COMMIT` → `baee2d8`, Pages deployment `291eac2e-b28e-4153-a1e7-6217ee3eaa45`). This release also carries the other session's work pushed in between: reply preview with avatar and connector, shorter hover toolbar, voice-message player (`c648bd4`, `405ba1c`). Checked live: reply to an attachment-only message returns `attachments: 1`; big uploads, signed reads and ranges still pass.

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → deploy `5b680e1c` at 100%.
2. Web: Pages → `syndo-app` → Deployments → `2440ea03` → Rollback to this deployment.

## 2026-11-11 — polish pass (Discord-like phone layout, text details, changelog entry)

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | deployment `2975a97d-a008-4f41-a35e-05590f89a3dc` (commit `47f2382`) |
| Backend | unchanged (Worker version `5b680e1c-71f4-41b6-b0f7-784b2c4fb499`) |
| Source | branch `backup/pre-polish-20261111`; database unchanged |

Released: Pages deployment `2440ea03-8e9b-452a-9a4f-d74fafd362b0` (commit `e3f1c21`).

Web only. Phones: back arrow with mention badge, online count under the channel name (tap for members), search + menu only, edge-to-edge chat, one-pill message box, round jump-to-present button. Everywhere: heading sizes, numbered lists, inline "(edited)", shorter date lines, shorter mutual-server list, a second "What's new" entry.

### Roll back
Pages → `syndo-app` → Deployments → `2975a97d` → Rollback to this deployment.

## 2026-11-10 — desktop 0.6.1 (window buttons, push-to-talk and in-app updates work again)

| Layer | Restore point (before this release) |
|---|---|
| Desktop feed | `syndo-desktop/latest-0.6.0.yml` (backup of the feed that pointed at `SEND-Setup-0.6.0.exe`; that installer stays in the bucket) |
| Backend (Worker `send-beta-api`) | version `39bbf579-4b3b-4486-8598-e933772c4919` (download link → 0.6.0) |
| Source | branch `backup/pre-desktop-061-20261110` (at `47f2382`); database unchanged |

0.6.1 is the Tauri build from CI run 42902628130 (commit `47f2382`, 1.7 MB): the shell's commands are granted to the hosted app. Apps on 0.5.0/0.6.0 can't use their update button (it was refused too), so those users install 0.6.1 once from the download link.

Released: feed `latest.yml` → `SEND-Setup-0.6.1.exe` (sha512 checked on the public copy before the feed switched); Worker version `5b680e1c-71f4-41b6-b0f7-784b2c4fb499` sends `/api/downloads/windows` to 0.6.1 (same code and backend otherwise). Uploaded with a one-hour R2 token limited to this bucket, deleted right after.

### Roll back
1. Feed: copy `latest-0.6.0.yml` over `latest.yml` (`text/yaml`, `cache-control: no-cache`). Apps already on 0.6.1 stay on it.
2. Download link: Workers → `send-beta-api` → Deployments → deploy `39bbf579` at 100%.

## 2026-11-10 — menu placement fixes; desktop 0.6.1 built (window buttons)

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | the emotes deployment (commit `697f3ff`); before that `6157394f-5eb8-4578-987e-3580b92e4ad5` |
| Backend | unchanged (Worker version `39bbf579-4b3b-4486-8598-e933772c4919`, `SOURCE_COMMIT` `697f3ff`) |
| Source | branch `backup/pre-menu-fixes-20261110` |

Web: the server menu and the activity menu are placed on screen next to their button (portal + fixed position) instead of inside a parent that clipped or offset them. Desktop 0.6.1 (not published until asked): the shell's own commands are declared in `build.rs` and granted to the hosted app in `capabilities/send-remote.json` (and to runtime-chosen servers in `allow_origin`). Tauri refuses unlisted commands from remote pages, so in 0.5.0–0.6.0 the window buttons, push-to-talk, in-app updates and desktop settings were all refused.

### Roll back
Web: Pages → `syndo-app` → Deployments → roll back to the emotes deployment.

## 2026-11-10 — 7TV and BTTV emotes

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | version `30168c15-2803-4e0f-9cd2-34a03c51d726`, `SOURCE_COMMIT` `d1c3bcb` |
| Web (Pages `syndo-app`) | deployment `6157394f-5eb8-4578-987e-3580b92e4ad5` |
| Database | migrations up to `007`; this release adds `008_third_party_emotes.sql` (one column with a default — the old backend ignores it) |
| Source | branch `backup/pre-emotes-20261110` |

Global 7TV and BTTV sets everywhere; a server can turn them off or link a channel's set (7TV profile or set link, or a Twitch user ID) under Server settings → 7TV and BTTV. Typed as `:name:` or picked from the message box's emoji menu; messages store `<7tv:name:id>` / `<bttv:name:id>`. Images are fetched once by the backend, cached in R2 under `emotes/`, and served from `/api/emotes/img/…`.

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → deploy `30168c15` at 100%.
2. Web: Pages → `syndo-app` → Deployments → `6157394f` → Rollback to this deployment.
3. Database: nothing needed (the column is unused by the old code).

## 2026-11-10 — desktop 0.6.0 (game detection: "Playing …" on your profile)

| Layer | Restore point (before this release) |
|---|---|
| Desktop feed | `syndo-desktop/latest-0.5.0.yml` (backup of the feed that pointed at `SEND-Setup-0.5.0.exe`; that installer stays in the bucket) |
| Backend (Worker `send-beta-api`) | version `c2d5b728-2d6a-46aa-a0b7-2f6038d1ac6d` (download link → 0.5.0) |
| Source | branch `backup/pre-desktop-060-20261110` (at `6d472bb`); database unchanged |

0.6.0 is the Tauri build from CI run 42898982168 (commit `6d472bb`, 1.7 MB). It adds game detection (known games from the process list, shown as "Playing …", opt-out in settings).

Released: feed `latest.yml` → `SEND-Setup-0.6.0.exe` (sha512 checked on the public copy before the feed switched); Worker version `30168c15-2803-4e0f-9cd2-34a03c51d726` sends `/api/downloads/windows` to 0.6.0 (same code and backend otherwise). Uploaded with a one-hour R2 token limited to this bucket, deleted right after.

### Roll back
1. Feed: copy `latest-0.5.0.yml` over `latest.yml` (`text/yaml`, `cache-control: no-cache`). Apps already on 0.6.0 stay on it.
2. Download link: Workers → `send-beta-api` → Deployments → deploy `c2d5b728` at 100%.

## 2026-11-10 — big files read straight from R2; abandoned uploads cleaned up

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | version `99d6d618-06ad-4069-9b86-565cfaa1b63d`, `SOURCE_COMMIT` `9276db8` |
| Web | unchanged |
| Storage | R2 `syndo-beta-uploads` lifecycle had only the default 7-day multipart abort rule |
| Source | branch `backup/pre-direct-reads-20261110`; database unchanged |

Files of 8 MB or more: after the permission check the backend redirects to `/api/files/read` (signed for one key and its response headers, 1 hour); the Worker serves it from R2 with ranges. Big uploads now create their attachment row when the ticket is issued (empty filename = unfinished, can't be attached), so the nightly cleanup of unattached files also removes abandoned big uploads. New R2 lifecycle rule: unfinished multipart uploads under `att/` are aborted after 1 day.

Released: Worker version `c2d5b728-2d6a-46aa-a0b7-2f6038d1ac6d` (`SOURCE_COMMIT` `d1c3bcb`) and the lifecycle rule. Checked on production with a throwaway account (deleted afterwards): 40 MB upload in two pieces, download redirected to the signed R2 link, a range request returned 206, a tampered link 404, a small file still served directly, and an unfinished upload couldn't be attached. A sweep of `att/` in R2 found only files that belong to existing attachments.

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → deploy `99d6d618` at 100%.
2. Lifecycle (optional): R2 → `syndo-beta-uploads` → Settings → Object lifecycle rules → delete "Abort unfinished attachment uploads after 1 day".

## 2026-11-10 — big uploads go straight to storage in pieces (up to 500 MB)

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | version `fc79e6d2-5146-4c81-b30a-747f23899755`, `SOURCE_COMMIT` `d967a3b` |
| Web (Pages `syndo-app`) | deployment `ebf2a5e9-fb4b-4cb3-be36-eb0361f4d405` |
| Source | branch `backup/pre-large-uploads-20261110`; database unchanged |

Files over 20 MB: the backend signs a ticket (storage key + exact size + 6 h expiry, HMAC with the existing storage token); the browser sends 32 MB pieces to `/api/uploads/large/*`, which the Worker writes into R2 as a multipart upload; the backend then checks the stored size and the file type and attaches it. Small files use the old single upload.

Released: Worker version `99d6d618-06ad-4069-9b86-565cfaa1b63d` (`SOURCE_COMMIT` `9276db8`), Pages deployment `6157394f-5eb8-4578-987e-3580b92e4ad5`. Checked on production with a throwaway account (deleted afterwards): a 40 MB file went up in two pieces, attached, and downloaded back intact.

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → deploy `fc79e6d2` at 100%.
2. Web: Pages → `syndo-app` → Deployments → `ebf2a5e9` → Rollback to this deployment.

## 2026-11-10 — call screen: grouped controls, device menus, "…" menu, chat beside the call

| Layer | Restore point (before this release) |
|---|---|
| Web (Pages `syndo-app`) | deployment `4d241b0b-98dd-4746-996e-d7921926b533` |
| Backend | unchanged (Worker version `fc79e6d2`, `SOURCE_COMMIT` `d967a3b`) |
| Source | branch `backup/pre-call-ui-20261110`; database unchanged |

### Roll back
Pages → `syndo-app` → Deployments → `4d241b0b` → Rollback to this deployment.

## 2026-11-10 — major update (threads, forums, stages, events, AutoMod, bots, boosts, passkeys, push, 11 languages)

| Layer | Restore point (before this release) |
|---|---|
| Backend (Worker `send-beta-api`) | version `57def25c-567a-4d33-aa65-3275f2a93d11`, `SOURCE_COMMIT` `77745ff` |
| Web (Pages `syndo-app`) | deployment `11a8467b-a7e6-4892-8ba0-293960b631e0` |
| Source | branch `backup/pre-major-update-20261110` (at `b430649`) |
| Database | migrations up to `006_channel_emoji.sql`; this release adds `007_major_update.sql` (only new tables and columns with defaults — the old backend runs fine on the new schema) |

Accounts `makz` and `makztest` were marked `staff` (free boost grants and codes).

Released: database migration `007_major_update.sql` (25 new tables, grants checked); Worker version `fc79e6d2-5146-4c81-b30a-747f23899755` with `SOURCE_COMMIT` `d967a3b` (it also passes optional secrets — push keys, `SEND_SECRET`, Stripe, GIFs, connections — to the backend once they exist); Pages deployment `4d241b0b-98dd-4746-996e-d7921926b533`. Push keys and `SEND_SECRET` aren't set yet: push is hidden until they are, and link-preview image URLs change when the backend restarts.

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → deploy `57def25c` at 100% (its `SOURCE_COMMIT` brings the container back to `77745ff`).
2. Web: Pages → `syndo-app` → Deployments → `11a8467b` → Rollback to this deployment.
3. Source: reset `claude/charming-meitner-a8exoe` to `backup/pre-major-update-20261110`.
4. Database: no action needed — leave 007 in place. To remove it anyway, drop the 25 tables it creates and the added columns (see the migration file), then delete its row from `schema_migrations`.

## 2026-11-06 — desktop 0.5.0 (lightweight Tauri shell replaces Electron)

| Layer | Restore point (before this release) |
|---|---|
| Desktop feed | `syndo-desktop/latest-0.4.4.yml` (backup of the feed that pointed at the Electron `SEND-Setup-0.4.4.exe`; that installer stays in the bucket) |
| Backend (Worker `send-beta-api`) | version `88f5c036-89e2-4c32-b701-21ebe85c7282`, `SOURCE_COMMIT` `77745ff` |
| Web (Pages `syndo-app`) | deployment `11a8467b-a7e6-4892-8ba0-293960b631e0` (unchanged by this release) |
| Source | branch `backup/pre-desktop-050-20261106` (at `a4c6acb`); database unchanged |

0.5.0 is the Tauri build from `syndo/desktop-tauri` (CI run 42292101169, 1.7 MB). Electron 0.4.x apps update to it from the same feed; its installer removes the Electron copy (user data kept) and starts SEND again. Users sign in once more.

Released: feed `latest.yml` → `SEND-Setup-0.5.0.exe` (sha512 checked on the public copy); Worker version `57def25c-567a-4d33-aa65-3275f2a93d11` sends `/api/downloads/windows` to 0.5.0 (same code otherwise). Uploaded with a one-hour R2 token limited to this bucket, deleted right after.

### Roll back
1. Feed: copy `latest-0.4.4.yml` over `latest.yml` (`text/yaml`, `cache-control: no-cache`). Apps already on 0.5.0 stay on it; to move them back, they reinstall from `SEND-Setup-0.4.4.exe` (a future Electron build would need a version above 0.5.0 to be offered).
2. Download link: Workers → `send-beta-api` → Deployments → deploy `88f5c036` at 100%.

## 2026-11-06 — desktop 0.4.4 (call names, screen-share audio, direct calls)

| Layer | Restore point (before this release) |
|---|---|
| Desktop feed | `syndo-desktop/latest-0.4.3.yml` (backup of the feed that pointed at `SEND-Setup-0.4.3.exe`; the 0.4.3 installer stays in the bucket) |
| Backend (Worker `send-beta-api`) | version `675d3e7c-6698-4f71-b408-b90725a2087d`, `SOURCE_COMMIT` `77745ff` |
| Web (Pages `syndo-app`) | deployment `11a8467b-a7e6-4892-8ba0-293960b631e0` (unchanged by this release) |
| Source | branch `backup/pre-desktop-044-20261106` (at `77745ff`); database unchanged |

Released: feed `latest.yml` → `SEND-Setup-0.4.4.exe` (CI run 42176696005, commit `7f7d630`, sha512 checked on the public copy); Worker version `88f5c036-89e2-4c32-b701-21ebe85c7282` sends `/api/downloads/windows` to 0.4.4 (same code otherwise). Uploaded with a one-hour R2 token limited to this bucket, deleted right after.

### Roll back
1. Feed: copy `latest-0.4.3.yml` over `latest.yml` (`text/yaml`, `cache-control: no-cache`). Apps already on 0.4.4 stay on it.
2. Download link: Workers → `send-beta-api` → Deployments → deploy `675d3e7c` at 100%.

## 2026-11-06 — names/pictures in calls, screen-share audio

| Layer | Restore point (before) |
|---|---|
| Source | branch `backup/pre-call-names-20261106` |
| Backend (Worker `send-beta-api`) | version `d9d4573d-8d6d-42aa-bb5a-eb1ff412c9cc`, `SOURCE_COMMIT` `f00c5a8` |
| Web (Pages `syndo-app`) | deployment `64c591fc-dbc6-4437-99ce-9744568a245e` |
| Database | unchanged |

Roll back: backend → deploy `d9d4573d` at 100% (the backend object resets itself onto it); web → rollback to `64c591fc`.

## 2026-11-06 — direct (peer-to-peer) calls, like SK Factory

| Layer | Restore point (before) |
|---|---|
| Source | branch `backup/pre-direct-calls-20261106` |
| Backend (Worker `send-beta-api`) | version `e16f5e16-d581-4de0-a473-1e9d79b50c22`, `SOURCE_COMMIT` `5b5fad5` |
| Web (Pages `syndo-app`) | deployment `ee3160bb-a035-4c40-8263-5ee30587b3ce` |
| Database | unchanged |

Calls now connect people directly (WebRTC mesh, signalled over the gateway `call_signal` op, Cloudflare TURN relay when needed). The Cloudflare SFU path is still there: setting `SEND_VOICE_MODE=sfu` on the backend switches back without a web change.
Roll back: backend → deploy `e16f5e16` at 100% (then call any `/api/…` route); web → rollback to `ee3160bb`.
Backend object renamed `syndo-beta-weur-v3` → `syndo-beta-weur-v4`: a Durable Object with a live container kept running the old code after deploys (so new commits never took effect). The Worker now also restarts the container whenever the pinned commit differs. Rolling back to `e16f5e16` uses the v3 object again.
Then renamed again to `syndo-beta-weur-v5` with a self-reset: the Worker sends the current commit (`x-send-commit`) and an object running an older deploy calls `ctx.abort()`, restarting on the new code/settings/secrets (apps reconnect in seconds). From now on a normal deploy is enough.
TURN: a dedicated Cloudflare TURN key `send-beta-calls` (uid `46fb7785…`) was created and saved as the `TURN_KEY_ID` / `TURN_KEY_TOKEN` Worker secrets (the previous ones didn't work).

## 2026-11-06 — call audio fix, DM call view, phone call cards, themed message box (web only)

Website only (no backend or database change). Source backup: branch `backup/pre-call-audio-20261106`.
Roll back: Pages → `syndo-app` → Deployments → `40dfdde7-88a7-47d0-844d-11fa413a9c4f` → *Rollback to this deployment*.

## 2026-11-06 — attach sheet, in-app camera, message box like Discord (web only)

Website only (no backend or database change). Source backup: branch `backup/pre-attach-sheet-20261106`.
Roll back: Pages → `syndo-app` → Deployments → `72d4ff17-0d57-4dee-b093-73d3ec4421d1` → *Rollback to this deployment*.

## 2026-11-05 — "System" settings, white scrollbars, phone banners, iPhone install (web only)

Website only (no backend or database change). Source backup: branch `backup/pre-system-ios-20261105`.
Roll back: Pages → `syndo-app` → Deployments → `d2fb1a90-bd25-44cf-81ea-6eaba6fdf052` → *Rollback to this deployment*.

## 2026-11-05 — channel emoji icons

| Layer | Restore point (before) |
|---|---|
| Source | branch `backup/pre-channel-emoji-20261105` |
| Backend (Worker `send-beta-api`) | version `e04307b4-0c5c-41bb-a340-d344874caf80`, `SOURCE_COMMIT` `dcbfdef` |
| Web (Pages `syndo-app`) | deployment `6f7293a7-be14-40f8-8271-95705dde99c6` |
| Database | migration `006_channel_emoji.sql` (additive: column `channels.icon_emoji`). To remove: `alter table send.channels drop column icon_emoji; delete from send.schema_migrations where name = '006_channel_emoji.sql';` |

Roll back: backend → deploy `e04307b4` at 100% (then call any `/api/…` route); web → rollback to `6f7293a7`.

## 2026-11-05 — category banner sizing (web only)

Web-only (CSS): category banners match the channel-row width, 28 px tall, "+" over the banner. Backend and database unchanged.
Roll back: Pages → `syndo-app` → Deployments → `47490bc7-8001-4bdb-bb96-bc9df518bc69` → *Rollback to this deployment*.

## 2026-11-05 — stickers, NEW messages line, category banner sizes

| Layer | Restore point (before) |
|---|---|
| Source | branch `backup/pre-stickers-20261105` → `ed64fa5` |
| Backend (Worker `send-beta-api`) | version `c7b3bca7-9828-4210-8e5a-59a6f8b81c76`, `SOURCE_COMMIT` `ed64fa5` |
| Web (Pages `syndo-app`) | deployment `e93b6b19-c203-46fb-a3c3-e5502117c63c` |
| Database (Supabase `syndo-beta`) | migration `005_stickers.sql` applied (additive: table `guild_stickers`, column `messages.sticker_id`). Older code ignores both. To remove: `alter table syndo.messages drop column sticker_id; drop table send.guild_stickers; delete from send.schema_migrations where name = '005_stickers.sql';` |

### Roll back
1. Backend: Workers → `send-beta-api` → Deployments → `c7b3bca7` at 100%, then call any `/api/…` route.
2. Web: Pages → `syndo-app` → Deployments → `e93b6b19` → *Rollback to this deployment*.

## 2026-11-05 — expressions live (emoji, soundboard, category banners) + plain DMs

| Layer | Restore point (before) |
|---|---|
| Source | branch `backup/pre-expressions-plain-dms-20261105` |
| Backend (Worker `send-beta-api`) | version `52515a3a-4d09-4040-8da1-22f202aff1b8`, `SOURCE_COMMIT` `e4c68d7` |
| Web (Pages `syndo-app`) | deployment `157f2b15-eb4a-483b-b58d-c6bfcd31e48c` |
| Database (Supabase `syndo-beta`) | migration `004_expressions.sql` applied (additive: tables `guild_emojis`, `guild_sounds`, column `channels.banner_key`). Older code ignores them, so a backend rollback needs no database change. To remove them: `drop table send.guild_emojis, send.guild_sounds; alter table send.channels drop column banner_key; delete from send.schema_migrations where name = '004_expressions.sql';` |

DMs: the server no longer requires end-to-end encryption (`SEND_REQUIRE_DM_E2EE` = "0"); clients send DMs as normal messages. Older encrypted messages decrypt where a device still has its key, otherwise show "Older encrypted message". Re-enable the old mode by setting it back to "1" (and rolling back the web app).

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
