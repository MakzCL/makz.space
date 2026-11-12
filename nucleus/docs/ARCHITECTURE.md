# NUCLUES architecture

NUCLUES is the electronic design application of SK Suite: schematic capture, simulation, PCB layout and manufacturing. It is one of three separate workstreams:

| Workstream | Folder | Scope |
|---|---|---|
| SK Suite | `suite/` | Launcher, installation, one-click updates, shared session; no engineering editing. |
| NUCLUES | `nucleus/` | EDA: schematic, SPICE, instruments, PCB, DRC, 3D board view, manufacturing outputs. |
| CADRA | `cadra/` | Mechanical CAD: drafting, and later parametric solids and assemblies. |

The applications have their own code, native file formats, tests, versions and release artifacts. NUCLUES runs without SK Suite: in a browser, at nucleus-eda.pages.dev, or as its own Electron window. The planned way for NUCLUES and CADRA to exchange data is through files: NUCLUES exports STEP and CADRA imports it. Neither application links the other's code.

Internal identifiers keep the original lowercase `nucleus` spelling, so existing projects and settings keep working:
- the folder and package name;
- the file envelope `format: "nucleus-project"`;
- storage keys;
- the site name `nucleus-eda`.

The product name users see is **NUCLUES**.

## Stack decision

The specification suggests Qt 6/C++ or Tauri/Rust. NUCLUES keeps its existing stack, because it works, is tested, and meets the requirements below. The specification also says to preserve working code.

| Concern | Choice | Why | Revisit when |
|---|---|---|---|
| UI | TypeScript + React 19, Canvas 2D | The same code runs in the browser and the desktop shell. Schematic and PCB canvases redraw from the model in milliseconds at current sizes. | Frame time on 10 000-object boards is measured as too slow. WebGL 2D is the next step, not a rewrite. |
| Engineering core | TypeScript modules with no React or DOM imports | Pure `Project → Project` functions, testable in Node and deterministic. | A hot path needs native speed. It would then move to Rust compiled to WebAssembly behind the same interface. |
| SPICE | **ngspice 45** (BSD-3) in WebAssembly, through `eecircuit-engine` 1.9 (MIT), in a Web Worker | Established solver, runs offline with nothing to install. Native ngspice cross-checks it in tests. | Mixed-mode digital needs XSPICE code models; check the WASM build includes them. |
| Board geometry | Integer nanometres in JS numbers (exact to 2^53 nm); clipper-lib (Boost licence) for pours | Exact equality, no drift with zoom. | — |
| 3D | three.js (MIT), loaded only when the 3D view opens | Real-time board view from `pcb/model3d.ts`. | STEP export needs a B-rep kernel: Open CASCADE (LGPL-2.1 with exception) through opencascade.js. This decision is shared with CADRA. |
| Desktop | Electron 45 (Chromium + Node) | Consistent WebAssembly and canvas behaviour. Already packaged as a portable Windows x64 zip and bundled in SK Suite. | An installer, file associations and code signing are Phase 10. |
| Storage | `.nuclues` JSON, SHA-256 over canonical JSON, schema version and migrations; recovery copy in browser storage | Human-readable, diffable, damage is detected. | Multi-file project folders, if projects outgrow one file. |

### Not chosen, and why
- **Qt/C++ rewrite:** it would discard a tested schematic, simulation and PCB stack for no measured gain.
- **Our own SPICE solver:** ngspice exists and is licensed for this use.
- **Our own solid kernel:** Open CASCADE exists. It is needed for STEP and for CADRA, not for NUCLUES editing.

## Modules (`src/`)

| Folder | Role |
|---|---|
| `core/` | Units and engineering notation, model types, project factory, symbol geometry. Schematic coordinates are integer thou. |
| `library/` | Device definitions: original symbols, pin electrical types, explicit SPICE definitions (element or subcircuit, never guessed), footprint list, model notes, library version. |
| `connectivity/` | Geometry → nets with union-find. Deterministic naming, junction derivation, dangling ends, label conflicts. Connectivity is computed from the model, never stored. |
| `schematic/` | Pure editing operations: place, annotate, wire, move with rubber-banding, rotate, mirror, duplicate, delete, properties. |
| `erc/` | Electrical rules. Each finding carries the object, net, sheet location and a suggestion. |
| `simulation/` | `netlist.ts` (project → SPICE deck; refuses rather than substitutes), `engine.ts` (WASM ngspice with timeout and ASCII guard), `results.ts`. |
| `pcb/` | `board.ts` (board model, pads, items, copper groups, ratsnest, schematic sync, `BoxGrid` spatial index), `footprints.ts`, `route.ts` (A* router with rip-up and retry), `drc.ts`, `zones.ts`, `gerber.ts`, `model3d.ts`. |
| `storage/` | File envelope, canonical JSON, checksum, migrations, validation. |
| `examples/` | Built-in example projects. Each one is verified by a test against a hand calculation. |
| `ui/` | React shell, canvases, panels, instruments, plots, 3D view, shortcut registry, store (undo/redo, documents, selection). |

## Data flow
1. Every edit is `store.change(fn)`, where `fn` is a pure `Project → Project` function. This gives undo/redo and recovery.
2. Connectivity, ERC, the SPICE deck, pads, the ratsnest and DRC are all derived from the model.
3. A simulation result records the project revision and the time it was solved. The UI flags results as stale after any edit.
4. PCB edits go through the same store, so undo and saving cover the board.

## Precision rules
- Schematic geometry is integer thou. Pins sit on a 100-thou grid, so equality checks are exact.
- PCB geometry is integer nanometres.
- Electrical values pass through `parseValue`/`toSpice`. SPICE `M` means milli, so megohms are written `meg`.

## Engine constraints (found while testing)
- WASM ngspice stalls on non-ASCII input. Decks are transliterated to ASCII, and non-ASCII decks are refused. Runs have a timeout.
- Floating nodes cause a singular-matrix error. It is reported as such; no hidden shunt resistors are added.
- Behavioural (B-source) supplies must draw their load current from the device's supply pin. Otherwise the supply current is wrong. This was found and fixed in the LM7805 and NE555 models; see `TEST_REPORT.md`.

## Automation hook
`window.__nucleus` (read-only) exposes screen coordinates of model points and pins for the end-to-end tests. It cannot change the design.
