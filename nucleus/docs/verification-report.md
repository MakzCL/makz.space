# Verification report — milestone 1 (phases 1–3)

Date: 2026-11-03. Environment: Linux, Node 22, Chromium (Playwright), ngspice 45 (WASM) and native ngspice (Ubuntu package), gerbv and gerbonara installed for later Gerber validation.

## Automated tests: `npm test` (vitest), 16/16 passing

| Test | Expected | Result |
|---|---|---|
| Units: 4k7, 2.2u, 1meg, 4R7; rejects "10kk" | Exact values / null | Pass |
| SPICE value writing | 1e6 → `1meg` (not `M`, which is milli) | Pass |
| Divider netlist text | Exact, deterministic | Pass |
| Crossing wires vs T junction | 2 nets vs 1 net plus a dot | Pass |
| Pin on a wire interior; same-name labels | Connected | Pass |
| Move and rotate a wired part | Netlist unchanged, wires orthogonal | Pass |
| ERC: open pin, duplicate reference, bad value; op-amp inputs; outputs fighting | Each detected, with location | Pass |
| File round-trip; tamper detection; newer-schema refusal | Equal; error; error | Pass |
| 10 k / 10 k divider at 5 V | 2.5 V; native ngspice agrees to 1e-6 | Pass |
| RC 1 kΩ / 1 µF step | 63.2 % at 1 ms, 99.3 % at 5 ms | Pass |
| RC 1 kΩ / 100 nF AC | −3.01 dB at 1.59 kHz | Pass |
| Red LED + 330 Ω at 5 V | 9.5–10.2 mA, Vf 1.6–1.9 V | Pass |
| Refusals: no ground; invalid value | Not simulated, clear messages | Pass |
| Potentiometer at 25 %; switch open/closed | 7.5 V wiper; 0 A / 5 mA | Pass |

## End-to-end: `tests/e2e/beta.mjs` (Chromium, real mouse and keyboard on the canvas)

| Step | Outcome |
|---|---|
| 1 Launch | Pass |
| 2 New project | Pass |
| 3 Schematic editor open | Pass |
| 4 Search and place 2 resistors, a red LED and a DC source | Pass |
| 5 Edit values (an invalid entry is refused and never reaches the model) | Pass |
| 6 Wire pin to pin, plus a ground terminal | Pass |
| 7 ERC finds the open LED cathode → finding selects D1 → wired → ERC clean | Pass |
| 8 DC simulation | Pass (about 1 s including engine load) |
| 9 Multimeter on the LED anode | **1.7364 V**; native ngspice on the exported deck **1.7364 V** |
| 10 Save | Pass (2986-byte `.nucleus`, SHA-256) |
| 11 Close and reopen in a fresh browser context | Identical netlist, parts, positions and values |
| 12 Valid footprints assigned (shown in the BOM) | Pass |
| 13–21 PCB transfer, outline, placement, routing, DRC, BOM, Gerber/drill, independent viewer | **Not possible yet**: PCB layout is not built |

## Known limitations at this milestone
- Single editable sheet; no buses.
- No PCB, manufacturing outputs, 3D, firmware or digital simulation.
- Web build only (no Windows executable has been built or verified).
- labcenter.com could not be reached, so reference behaviour is unverified for 9.2.

## Update — palettes, examples, desktop and Windows build (2026-11-03)

| Check | Result |
|---|---|
| `npm test` (core, simulation, examples) | 23 / 23 pass |
| `tests/e2e/beta.mjs` (first-beta steps 1–12, Chromium) | pass; multimeter 1.7364 V = native ngspice 1.7364 V |
| `tests/e2e/examples.mjs` (local preview) | 7 / 7 pass |
| `tests/e2e/examples.mjs` against https://nucleus-eda.pages.dev | 7 / 7 pass |
| `tests/e2e/desktop.mjs` (Electron 45.2.1, Linux, from source) | 8 / 8 pass |
| `tests/e2e/desktop.mjs` on the packaged `resources/app` of the Windows zip | 8 / 8 pass |
| Windows zip | `unzip -t` clean; `NUCLEUS.exe` is PE32+ x86-64 GUI; Electron runtime sha256 matches the official SHASUMS256.txt |
| `NUCLEUS.exe` started on real Windows | **not verified** (no Windows machine available to the build) |

Built-in examples are checked against hand calculations: divider 2.5 V, LED ≈ 10 mA, RC 63.2 % at τ, RC −3 dB at 1/(2πRC), potentiometer 7.5 V at 25 %.
