# SEND for Windows & the hosted web app (Cloudflare)

## How updates work

| Part | Hosted on | How users get updates |
|---|---|---|
| Web app (the interface) | Cloudflare Pages, project `syndo-app` | Every deploy is live immediately, in browsers **and** in the desktop app (its window loads the hosted web app) |
| Desktop shell (`SEND-Setup-x.y.z.exe`) | Cloudflare R2 bucket `syndo-desktop` (public at https://pub-77db39df34ad414fb86b513f573fd57e.r2.dev) | The app reads `latest.yml` at start-up and every 4 hours. Nothing downloads on its own: a green icon appears in the title bar; pressing it (or the tray menu) downloads the installer, checks its sha512 and installs silently, then SEND reopens |
| API | Cloudflare Worker `send-beta-api` + container | See RESTORE.md for the deploy procedure |

## The desktop app (`desktop-tauri/`)

Tauri 2 shell (Rust) on the system WebView2 — no bundled Chromium, 1.7 MB installer. Since 0.5.0 it replaces the
Electron shell (0.4.x, removed from the repo; source kept on branch `backup/pre-desktop-050-20261106`).
Details and build steps: `desktop-tauri/README.md`.

- Global push-to-talk while SEND is in the background (keyboard keys, mouse buttons 4/5).
- Screen sharing through WebView2's picker, with "share system audio" on Windows.
- Tray icon, close to tray, native Windows toasts, taskbar flash on mentions, launch on startup.
- `syndo://invite/CODE` links; Windows 11 (22H2+) Mica/Acrylic.
- Security: no Node or file access in the page, only the shell's own commands, callable only from the configured server's origin; navigation locked to that origin; camera/mic/notifications granted only to it; external links open in the browser; http only for localhost.

## Releasing a desktop version

1. Bump `version` in `desktop-tauri/src-tauri/tauri.conf.json` (and `package.json`), push. CI (`desktop-lite` job, windows-latest) builds `SEND-Setup-<version>.exe` + `latest.yml` as the `send-windows-lite` artifact.
2. Backup branch + RESTORE.md entry.
3. Upload to the `syndo-desktop` bucket with a one-hour token limited to that bucket: back up the current `latest.yml` as `latest-<old>.yml`, upload the installer, check the public copy's sha512, upload `latest.yml` last (`text/yaml`, `cache-control: no-cache`), delete the token.
4. Point the Worker's `/api/downloads/windows` link at the new installer.

## Honest status

- Installed and updated (0.4.4 → 0.5.0) on a real Windows PC.
- Unsigned builds trigger Windows SmartScreen until a code-signing certificate is added.
- macOS/Linux packaging isn't set up.
