# SK Suite (desktop)

One desktop home for **SK Factory**, **Kortana**, **TROTAN** and **NUCLEUS**. The browser versions stay exactly as they are; this is an extra way to run them.

- The hub lists every app. Each app opens in its own window, which remembers its size and position. Clicking an open app switches to its window instead of opening a second copy.
- SK Factory, Kortana and TROTAN load their live sites, so they are always the current version. They share one persistent, secure session, so you stay signed in after a restart.
- Camera, microphone, notifications and screen sharing (for calls) are allowed only for the suite's own sites.
- Links between apps open the right app's window. Other links open in your normal browser.
- NUCLEUS is bundled inside the suite and works with no internet connection.
- Colours: Light / Granat / Dark, the same palettes as the apps.

## Windows

Download `SK-Suite-<version>-win-x64.zip`, unzip it and run `SK Suite.exe`. The build is portable and not code-signed, so SmartScreen may warn the first time (More info → Run anyway).

To build it yourself in PowerShell, type each line separately:

```powershell
git clone https://github.com/MakzCL/makz.space
cd makz.space\nucleus
npm install
cd ..\suite
npm install
npm start
npm run package:win
```

`npm start` runs the suite from source. `npm run package:win` writes `release\SK-Suite-<version>-win-x64.zip`.

## Tests

`npm test` launches the real desktop app. It checks the hub, the palettes, NUCLEUS offline with all five simulation examples, a live web app in its own window, single-window switching, and the saved state after a restart. On Linux without a display, prefix it with `xvfb-run -a`.
