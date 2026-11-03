# Syndo for Windows & the hosted web app (Cloudflare)

## How updates work

| Part | Hosted on | How users get updates |
|---|---|---|
| Web app (the interface) | Cloudflare Pages, project `syndo-app` | Every deploy is live immediately — in browsers **and** in the desktop app, because the desktop window loads the hosted web app |
| Desktop shell (`Syndo-Setup-x.y.z.exe`) | Cloudflare R2 bucket (public) | The app checks the feed at start-up and every 4 hours, downloads in the background, then offers **Restart to update** (Settings → Desktop app, or the tray menu). Updates also install on quit |
| API server + LiveKit | Your VM (see DEPLOYMENT.md) | `docker compose up -d --build` |

## One-time setup

1. **Server** — deploy the API (DEPLOYMENT.md). Note its public origin, e.g. `https://api.example.com`. Add the web app origin to `SYNDO_PUBLIC_URL` (and `SYNDO_EXTRA_ORIGINS` for previews).
2. **Cloudflare Pages** — the `Syndo` workflow creates the `syndo-app` project on the first push (it uses the repo's existing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets). In the Pages project → Settings → Variables, add `SYNDO_API_ORIGIN = https://api.example.com`. Optionally attach a custom domain such as `syndo.makz.space`.
   Pages Functions in `web/functions` forward `/api/*` and `/gateway` (WebSocket) to that origin, so cookies and CSRF checks behave as on one host. Verified locally with `wrangler pages dev` (messaging E2E 18/18, including the WebSocket gateway).
3. **R2 update bucket** — create a bucket (e.g. `syndo-desktop`), enable public access (r2.dev URL or a custom domain such as `updates.syndo.makz.space`). The API token needs *R2 Edit* in addition to Pages.
4. **Repository variables** (Settings → Secrets and variables → Actions → Variables):

   | Variable | Example | Purpose |
   |---|---|---|
   | `SYNDO_APP_URL` | `https://syndo.makz.space` | Server the installer opens by default (users can change it) |
   | `SYNDO_UPDATE_URL` | `https://updates.syndo.makz.space` | Public URL of the R2 bucket (baked into the app's update feed) |
   | `SYNDO_R2_BUCKET` | `syndo-desktop` | Bucket CI uploads to |

   Optional secrets for code signing (removes the SmartScreen warning): `SYNDO_CSC_LINK` (base64 .pfx) and `SYNDO_CSC_KEY_PASSWORD`.

## Releasing a desktop version

```bash
git tag syndo-desktop-v0.2.1
```

```bash
git push origin syndo-desktop-v0.2.1
```

CI (windows-latest) sets the version from the tag, builds the NSIS installer, attaches it as a workflow artifact, and uploads the installer, blockmap and `latest.yml` to R2 (`latest.yml` last). Installed apps pick it up automatically. Every push touching `syndo/` also builds an installer artifact (without publishing) so builds are always checked.

## What the desktop app adds

- Global push-to-talk (works while Syndo is in the background); keyboard keys or mouse buttons 4/5.
- Screen sharing picker with whole-system audio on Windows (WASAPI loopback). Single-app audio isn't supported.
- Tray icon, close-to-tray, native Windows notifications, taskbar flash on mentions.
- `syndo://invite/CODE` links.
- Windows 11 (22H2+) Mica/Acrylic window material — the only way to see *through* the window to the desktop. In-app panel transparency works everywhere.
- Security: context isolation and sandbox, no Node in the page, navigation locked to the configured server, permissions only for that origin, external links open in the browser, http allowed only for localhost.

## Honest status

- The desktop code compiles and the installer is built by CI; it has **not** been run on a Windows machine from this environment (the sandbox can't download or run Electron). Global PTT, loopback audio and Mica need a real Windows test.
- Unsigned builds trigger Windows SmartScreen until a code-signing certificate is added.
- macOS/Linux packaging isn't set up (the code runs there for development).
