# Third-party software in NUCLUES

Versions are as installed on 2026-11-12. No third-party source has been copied into `src/`. Only `src/library` symbols and `src/pcb/footprints.ts` geometry are original NUCLUES work, generated from public package dimensions (IPC-7351 nominal and JEDEC outlines).

## Shipped with the application

| Component | Version | Licence | Use | Obligations |
|---|---|---|---|---|
| ngspice (inside eecircuit-engine) | 45 | BSD-3-Clause (modified BSD). Some historical ngspice sources carry other permissive notices; check the bundled build's notices before a commercial release. | SPICE solver | Keep the copyright notice and disclaimer in the distribution. |
| eecircuit-engine | 1.9.0 | MIT | ngspice compiled to WebAssembly, with a JS wrapper | Keep the MIT notice. |
| React, React DOM | 19.3.1 | MIT | UI | Keep the notice. |
| three.js | 0.187.0 | MIT | 3D board view | Keep the notice. |
| clipper-lib | 6.4.2 | Boost Software License 1.0 | Polygon offset and booleans for copper pours | Keep the licence text in source distributions. |
| Electron (desktop builds only) | 45.2.1 | MIT. It bundles Chromium (BSD-3 and others), Node.js (MIT) and FFmpeg (LGPL-2.1, as a shared library) | Desktop shell | Ship Electron's `LICENSES.chromium.html` and `LICENSE` with the Windows zip. Do not modify or statically relink the LGPL parts. |
| IBM Plex Sans / Mono (Google Fonts) | — | SIL Open Font License 1.1 | Interface type | Loaded from Google Fonts in the web build. |

## Build and test only (not distributed)

| Tool | Version | Licence | Use |
|---|---|---|---|
| TypeScript | 5.9.3 | Apache-2.0 | Compiler |
| Vite, @vitejs/plugin-react | 7.3.7 / 5.2.0 | MIT | Bundler |
| Vitest | 3.2.7 | MIT | Unit tests |
| Playwright + Chromium | preinstalled | Apache-2.0 / BSD | End-to-end tests |
| resedit | 3.1.0 | MIT | Stamps the Windows exe icon and version |
| native ngspice | 45 (Ubuntu) | BSD-3-Clause | Independent cross-check of the WASM solver |
| gerbonara | Python package | Apache-2.0 | Independent Gerber/Excellon reader in tests |
| gerbv | system package | GPL-2.0 | Renders every Gerber in tests. Run as a separate program, never linked or shipped. |

## Considered for later (not used yet)

| Component | Licence | For | Note |
|---|---|---|---|
| Open CASCADE (opencascade.js) | LGPL-2.1 with OCCT exception | STEP export of the board | Must stay a separately replaceable module. Shared decision with CADRA. |
| simavr | GPL-3.0 | AVR firmware simulation | GPL would apply to anything linked with it. It could run as a separate process. |
| Renode | MIT | Cortex-M firmware simulation | Runs as a separate process. |
| KiCad libraries | CC-BY-SA 4.0 with exception | Symbols, footprints, 3D models | The exception allows use in designs. Redistributing the library itself keeps CC-BY-SA. |
