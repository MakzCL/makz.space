# SEND for Windows — lightweight shell (Tauri)

Replaced the Electron shell (removed in 0.5.0; source on branch `backup/pre-desktop-050-20261106`). Same features, much smaller:

| | Electron (0.4.x) | Tauri (0.5.0+) |
|---|---|---|
| Browser engine | bundled Chromium (~120 MB installer) | Windows' own WebView2 (shared with Edge, kept up to date by Windows) |
| Background process | Node.js main process + Chromium helpers | one small Rust process + WebView2's processes |

What the shell adds to the hosted web app (`window.sendDesktop`, same API as before, see `src-tauri/src/init.js`):
custom title bar (CSS `-webkit-app-region`), global push-to-talk (low-level keyboard/mouse hooks, `src/ptt.rs`),
tray + close to tray, `syndo://invite/…` links, native toasts, Mica/Acrylic on Windows 11, launch on startup,
manual updates (`src/updater.rs`). Screen sharing uses WebView2's own picker (screens, windows, system audio).

## Standalone (0.8.0+)

The app no longer opens the website. SEND's interface is built into the app (`dist/app/`, made by
`scripts/bundle-web.mjs` before every `tauri build`) and served from `sendapp://localhost`
(`https://sendapp.localhost` on Windows) by `src-tauri/src/bundle.rs`:

- Calls to `/api/...` go through the app to the chosen server. The session cookie is kept by the app
  (`session.json` next to `config.json`), never by the page; switching servers forgets it.
- Pictures, files, emotes and music (`/api/media`, `/api/files/read`, `/api/emotes/img`, `/api/music/stream`) are
  redirected to the server's address so they stream straight from storage.
- The live connection (`/gateway`) connects to the server directly and signs in with the session token
  (`session_token` command). The server allows the app's addresses for it (`DESKTOP_APP_ORIGINS` in server config).
- SEND links (invites, messages) clicked in the app open inside it; links people copy use the server's address.
- Passkeys belong to the website's address, so they're added and used on the website.
- Interface changes reach desktop users with app updates (the in-app updater), not by reloading.

Tested in a browser with a stand-in for the relay: `e2e/desktop/relay.mjs` and `e2e/desktop/bundled.cjs`.

## Build (Windows)

    npm ci
    npx tauri build --bundles nsis
    node scripts/feed.mjs release     # → release/SEND-Setup-<version>.exe + latest.yml

CI does this on every push (`desktop-lite` job, artifact `send-windows-lite`).
The version is in `src-tauri/tauri.conf.json`.

## Updates and moving off Electron

The feed is the same `latest.yml` on the public R2 bucket, in electron-builder's format, so:
- Electron builds (0.4.x) see the new version, download the Tauri installer when the user presses the
  green button, and run it with `--updated /S --force-run`. `windows/hooks.nsh` removes the Electron copy
  first (its user data is kept) and starts SEND again afterwards. Users sign in again once (new browser profile).
- Tauri builds read the same feed, check the installer's sha512 and run it with `/S /R /UPDATE`.
