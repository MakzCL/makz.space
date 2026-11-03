# NUCLEUS architecture

## Stack (decided after measuring what is needed now)

| Concern | Choice | Why |
|---|---|---|
| UI | TypeScript + React 19, Canvas 2D | Fast enough for schematics; the same code runs in the browser and in a desktop shell |
| Engineering core | TypeScript modules with no React or DOM dependency | Pure functions, testable in Node, deterministic. Hot paths can later move to Rust/WASM (Rust 1.97 is available in the dev environment) |
| Simulation | **ngspice 45** (BSD-3) compiled to WebAssembly, via `eecircuit-engine` 1.9 (MIT) | A real, established SPICE engine that runs locally and offline, with nothing to install. Native ngspice is used in tests as an independent cross-check |
| Workers | The engine runs in a Web Worker | Keeps the UI responsive; a stuck run is ended by terminating the worker |
| Storage | `.nucleus` JSON files plus a recovery copy in browser storage | Human-diffable and portable; SHA-256 detects damage |
| Desktop | **To decide in the packaging milestone**: Tauri (small, Rust) vs Electron (bundled Chromium, consistent WASM/canvas behaviour) | Windows packaging has to be tested on the actual target before choosing |
| 3D (later) | Three.js, built from the PCB model | — |

## Modules (`src/`)

| Folder | Role |
|---|---|
| `core/` | Units and engineering notation, model types, project factory, geometry (symbol transforms, pin positions). Schematic coordinates are integer thou (0.0254 mm), so grid snapping is exact. |
| `library/` | Device definitions: original symbols, pins with electrical types, explicit SPICE definitions, footprints, library version. |
| `connectivity/` | Geometry → nets with a union-find. Deterministic auto-naming; junction derivation; dangling ends; name conflicts. |
| `schematic/` | Pure editing operations: place, annotate, wire, move with rubber-banding, rotate, mirror, duplicate, delete, properties. |
| `erc/` | Electrical rule check. Every finding carries the object, the net, the sheet location and a suggestion. |
| `simulation/` | `netlist.ts` (project → SPICE deck, refuses rather than substitutes); `engine.ts` (WASM ngspice with a timeout and an ASCII guard); `results.ts` (vectors → nets and branches). |
| `storage/` | File envelope, canonical JSON, checksum, migrations, structural validation. |
| `ui/` | React shell, schematic canvas, panels, instruments, plots, shortcut registry, store (undo/redo, documents, selection). |
| `pcb/` (next) | Integer-nanometre board model, footprints, routing, DRC, Gerber/Excellon writers. |

## Data flow

1. Every user action goes through `store.change(fn)`, where `fn` is a pure `Project → Project` function.
2. That gives undo/redo and recovery.
3. Connectivity is recomputed from the model and never stored, so it can't go stale.
4. A simulation run builds the deck from the same connectivity. The result records the project revision and the time it was solved; the UI flags results as stale once the design changes.

## Precision rules
- Schematic geometry uses integers (thou). Pins sit on a 100 th grid, so equality is exact.
- PCB geometry will use integer nanometres (JavaScript numbers are exact up to 2^53 nm ≈ 9000 km).
- Electrical values go through `parseValue`/`toSpice`. SPICE's `M` means milli, so megohms are always written as `meg`.

## Known engine constraints (found while testing)
- The WASM ngspice build **stalls on non-ASCII input**. Decks are transliterated to ASCII, and the engine refuses non-ASCII decks outright. Runs also have a timeout.
- Floating nodes make ngspice fail with a "singular matrix" error. This is reported, not hidden: NUCLEUS does not add shunt resistors on its own.

## Automation hook
`window.__nucleus` (read-only) exposes screen coordinates of model points and pin positions, for the end-to-end tests. It cannot change the design.
