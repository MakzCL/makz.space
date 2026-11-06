# SEND for Windows — lightweight shell (Tauri)

Replaced the Electron shell (removed in 0.5.0; source on branch `backup/pre-desktop-050-20261106`). Same features, much smaller:

| | Electron (0.4.x) | Tauri (0.5.0+) |
|---|---|---|
| Browser engine | bundled Chromium (~120 MB installer) | Windows' own WebView2 (shared with Edge, kept up to date by Windows) |
| Background process | Node.js main process + Chromium helpers | one small Rust process + WebView2's processes |

What the shell adds to the hosted web app (`window.syndoDesktop`, same API as before, see `src-tauri/src/init.js`):
custom title bar (CSS `-webkit-app-region`), global push-to-talk (low-level keyboard/mouse hooks, `src/ptt.rs`),
tray + close to tray, `syndo://invite/…` links, native toasts, Mica/Acrylic on Windows 11, launch on startup,
manual updates (`src/updater.rs`). Screen sharing uses WebView2's own picker (screens, windows, system audio).

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
