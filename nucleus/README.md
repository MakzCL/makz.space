# NUCLEUS

Electronics design, simulation and PCB engineering suite. **Milestone 1:** schematic capture, ERC and SPICE simulation (ngspice, compiled to WebAssembly) with instruments and graphs. PCB layout is the next milestone and is not built yet.

## Run it on Windows (PowerShell)

Needs Git and Node.js 22 or newer. Type each line separately. PowerShell 5 does not accept `&&` or a trailing `&`.

```powershell
git clone -b nucleus https://github.com/MakzCL/makz.space
cd makz.space\nucleus
npm install
npm run dev
```

Open http://localhost:5173. To run it as a desktop window instead:

```powershell
npm run desktop
```

To build the portable Windows package (`release\NUCLEUS-0.1.0-win-x64.zip`, run `NUCLEUS.exe` from the unzipped folder; not code-signed, so SmartScreen may ask for confirmation):

```powershell
npm run package:win
```

## Tests

```powershell
npm test                          # unit, simulation and example tests (23)
npm run build
npm run preview                   # leave running; open a second PowerShell window for the next lines
node tests/e2e/beta.mjs           # first-beta acceptance steps 1–12 in Chromium
node tests/e2e/examples.mjs       # every built-in example through the real UI
node tests/e2e/desktop.mjs        # the same in the desktop (Electron) app
```

The e2e scripts need Playwright with Chromium (`npm i -g playwright`, then `npx playwright install chromium`). The beta test also cross-checks against a native `ngspice` on the PATH.

Simulation runs locally; no internet connection is needed. Documentation is in `docs/`; the status of every feature is in `docs/PROTEUS_FEATURE_PARITY.md`, progress by phase in `docs/IMPLEMENTATION_STATUS.md`.
