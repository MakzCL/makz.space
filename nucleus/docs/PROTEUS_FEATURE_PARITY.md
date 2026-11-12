# NUCLUES — Proteus feature parity

This matrix tracks NUCLUES against Labcenter Proteus Design Suite 9.2, within the NUCLUES scope. That scope is EDA only: mechanical CAD lives in CADRA (see `../../cadra/docs/CADRA_SPEC.md`).

**Sources.** The reference behaviour comes from Labcenter's public pages, downloaded on 2026-11-12:
- whatsnew/9.2, schematic, pcb-layout, router, highspeed, simulation, instruments, microprocessors, proteus9, pcb, tutorials.

It also uses KiCad conventions where the pages say nothing. Behaviour that the pages do not describe is marked *(not stated)*. We have no Proteus licence and have not run Proteus. No proprietary code, assets, file formats or libraries are used.

**Status values**

| Status | Meaning |
|---|---|
| NOT STARTED | Nothing built yet. |
| IN DEVELOPMENT | Partly built. The row says exactly which operations work. |
| IMPLEMENTED | Built, but not covered by an automated test. |
| VERIFIED | An automated test checks it against known values or an independent tool. |
| BLOCKED | Cannot proceed, for the reason given. |
| NOT SUPPORTED | Out of scope or not permitted. |

A button or dialog existing does not count.

**Test IDs**
- `U-<file>` is a vitest file in `tests/`: `U-CORE`, `U-SIM`, `U-EX` (examples), `U-PCB`, `U-3D` (model3d), `U-TMR` (timer-regulator), `U-DRCIDX`.
- `E-<suite>-<step>` is a browser end-to-end step in `tests/e2e/`: `BETA`, `EX` (examples), `PCB`, `3D` (board3d), `DESK` (Electron).
- `P-BENCH` is the benchmark in `tests/perf/bench.perf.ts`.

## 1. Workspace and project

| Feature | Reference behaviour | NUCLUES implementation | Status | Tests |
|---|---|---|---|---|
| Project create / save / open | `.pdsprj` project holding schematic, PCB, BOM and notes in one file *(format not public)* | `.nuclues` versioned JSON with SHA-256 over canonical JSON. A schema version refuses newer files. Older `.nucleus` files still open. | VERIFIED | U-CORE (round-trip, tamper, newer schema); E-BETA-10/11; E-PCB-9 |
| Autosave / recovery | Autosave and backup copies *(details not stated)* | Recovery copy in browser storage after every change. | IMPLEMENTED | — |
| Undo / redo | Unlimited | 300-step snapshot history of the whole project model, covering schematic and PCB. | IMPLEMENTED | Used in E-PCB-6 (move + undo) |
| Document tabs | Schematic, PCB Layout, 3D Visualiser, BOM, Design Explorer, Project Notes as tabs | Tabs: Schematic, PCB Layout, Analysis, BOM. 3D opens as a view over the PCB tab. | IN DEVELOPMENT (no Design Explorer, Project Notes or 3D tab) | E-EX, E-PCB |
| Dockable panels | Docked browsers and panels | Left browser and right inspector (resizable, hideable). Bottom dock: simulation log, instruments, rule check, netlist. | IN DEVELOPMENT (panels resize but do not detach; layout not saved as named layouts) | Visual |
| Themes | — | Light, Granat (default dark navy), Dark. | VERIFIED | E-EX-3 |
| Customisable shortcuts | Configurable keyboard map | Shortcut registry with remap and conflict detection, stored per machine. | IMPLEMENTED | — |
| Multiple projects open | One project per window *(not stated)* | One project per window. | IN DEVELOPMENT | — |
| Windows desktop build | Windows installer | Portable Windows x64 zip (Electron 45); SK Suite bundles it offline. | IN DEVELOPMENT (no installer, file associations or code signing; not run on real Windows) | E-DESK (Linux, packaged resources) |

## 2. Schematic capture

| Feature | Reference behaviour | NUCLUES implementation | Status | Tests |
|---|---|---|---|---|
| Device picking | Pick Devices (P): keyword search over a 50 000+ part library | Search by name, part number, description or category. Symbol preview, pin table, model note, footprints. **24 built-in devices.** | VERIFIED (library small) | E-BETA-4 |
| Placement, rotate, mirror | Click to place; rotate/mirror while placing | Same (R, X while placing; repeat placement). | VERIFIED | E-BETA-4 |
| Annotation | Automatic and global re-annotation | Lowest free number per prefix; annotate / re-annotate; duplicates renumbered. | VERIFIED | U-CORE |
| Wiring | Follow-me wire placement; terminals touching pin ends connect | Orthogonal wires snapping to pins and wires. T-joins connect; plain crossings do not. Junction dots are derived from the model. | VERIFIED | U-CORE; E-BETA-6 |
| Moving wired parts | Wires follow | Wire ends on moved pins follow, with orthogonal elbows. The netlist is unchanged after move or rotate. | VERIFIED | U-CORE |
| Net labels, power, ground | Same-name terminals join | Same-name nets join project-wide; GND is SPICE node 0. | VERIFIED | U-CORE |
| Buses / bus entries | Supported | — | NOT STARTED | — |
| Multi-sheet / hierarchy | Hierarchical sheets, sub-circuits | Model has sheets; only one sheet is editable in the UI. | IN DEVELOPMENT | — |
| Assembly variants | Fitted / alternative part per variant | — | NOT STARTED | — |
| Project clips | Save a schematic + layout section for reuse | — | NOT STARTED | — |
| Properties inspector | Edit Component dialog | Reference, value (validated, engineering notation), footprint, manufacturer/MPN, switch/pot state, pins and nets. | VERIFIED | E-BETA-5 |
| ERC | ERC report with locations | 13 rules. Each finding is linked to its object and location; rules can be ignored. | VERIFIED | U-CORE; E-BETA-7 |
| Netlist | Netlist compiler | Deterministic netlist and SPICE deck export. | VERIFIED | U-CORE |
| Design Explorer | Components and nets cross-probed on schematic and PCB | Nets panel in the browser; no cross-probing. | NOT STARTED | — |
| Bill of materials | Separate WYSIWYG BOM window; Excel or PDF output | BOM tab, grouped and filterable; CSV; simulation-only sources excluded. | VERIFIED (CSV only) | E-BETA-12 |
| Managed / versioned libraries | Librarian-approved, version-controlled libraries | Version field per device; no managed mode. | NOT STARTED | — |
| Symbol / footprint editors | Library part creation; AI-assisted parts (9.2 beta) | — | NOT STARTED | — |

## 3. Simulation (ngspice 45, WASM, in a worker)

| Feature | Reference behaviour | NUCLUES implementation | Status | Tests |
|---|---|---|---|---|
| DC operating point | Yes | ngspice `.op` | VERIFIED | U-SIM, U-EX (divider 2.5 V, matches native ngspice); E-EX-2 |
| Transient | Yes | ngspice `.tran` | VERIFIED | U-EX (RC 63.2 % at τ); U-TMR (555 frequency measured from the waveform) |
| AC sweep | Yes (Advanced Simulation) | ngspice `.ac`, magnitude and phase | VERIFIED | U-EX (−3 dB at 1/(2πRC)) |
| DC sweep | Yes | ngspice `.dc` | IMPLEMENTED | — |
| Noise, Fourier, distortion, parameter sweep, conformance | Advanced Simulation Option | — | NOT STARTED | — |
| Digital / mixed-mode | Mixed-mode SPICE with digital models | — | NOT STARTED | Needs XSPICE digital models |
| Interactive simulation | Real-time with live controls | Switch/pot change re-solves the operating point. | VERIFIED (operating point only) | U-SIM |
| 555 timer | Library model | NE555 behavioural model: comparators, latch, discharge. Load current is drawn from VCC. | VERIFIED | U-TMR: 6.8 kHz within 3 % of 1.44/((RA+2RB)C); levels 1/3 and 2/3 VCC; frequency halves when C doubles. Native ngspice cross-check 6 819 Hz vs 6 857 Hz formula |
| Voltage regulator | Library model | LM7805 behavioural model: 5 V, 2 V dropout, 5 mA quiescent; load current drawn from IN. | VERIFIED | U-TMR (5.00 V into 100 Ω; input current = load + 5 mA; 4 V out at 6 V in) |

## 4. Instruments

| Feature | Reference behaviour | NUCLUES implementation | Status | Tests |
|---|---|---|---|---|
| System scope | 4 channels, X-Y; 20 V/div to 2 mV/div; 200 ms/div to 0.5 µs/div; AC/DC coupling; auto and one-shot trigger; cursors; live probing | 4 channels, V/div, time/div, edge trigger, hold, cursors, CSV, from transient results. | IN DEVELOPMENT (no X-Y, AC coupling, live probing or one-shot) | Visual (E-EX-5) |
| System meter (new in 9.2) | Live probes A and B, A−B differential mode, during simulation | Multimeter: DC V, AC V rms (transient), DC A, with + and − probe nets. | IN DEVELOPMENT (not live during a running transient) | E-EX-2 (vs native ngspice) |
| Voltmeter / ammeter / wattmeter | Inline, real-time RMS; wattmeter: real/reactive/apparent power | — (multimeter covers V and A) | NOT STARTED | — |
| Graphs | Graph-based analysis | Transient / AC (dB and phase) / DC sweep; A/B cursors with deltas; zoom; CSV and PNG. | IMPLEMENTED | E-EX-5/6/8 |
| Logic analyser | 24 channels, 40 000-sample buffer, edge and bus triggers | — | NOT STARTED | Needs digital simulation |
| Signal / pattern generator | Sine, square, triangle, sawtooth, 0–12 MHz, AM/FM; 8-bit pattern generator | Sources: VSINE, VPULSE (placed parts). | IN DEVELOPMENT | U-EX |
| Counter/timer, virtual terminal, SPI/I²C/CAN analysers | Yes | — | NOT STARTED | — |

## 5. Microcontroller simulation (VSM-equivalent)

| Feature | Reference behaviour | NUCLUES implementation | Status | Tests |
|---|---|---|---|---|
| MCU co-simulation | 750+ variants: ARM7, Cortex-M0/M3/M4, PIC10–PIC24/dsPIC33, AVR, 8051, MSP430, Arduino boards, MicroPython (Pico, ESP32) | — | NOT STARTED | No MCU is claimed as supported. Candidate engines: simavr (GPL-3.0) for AVR, Renode (MIT) or QEMU (GPL-2.0) for Cortex-M; licensing to be decided before any is bundled |
| Firmware debug | Breakpoints (source and schematic hardware breakpoints), single step, watch window, GDB remote for Cortex-M (9.2) | — | NOT STARTED | — |

## 6. PCB layout

| Feature | Reference behaviour | NUCLUES implementation | Status | Tests |
|---|---|---|---|---|
| Footprints | IPC-7351 footprint libraries; 15 M parts via import | 27 footprints generated from package dimensions. Pad names match symbol pins. | VERIFIED | U-PCB (every device's pins have pads; 0805 pitch 1.825 mm; DIP row 7.62 mm) |
| Netlist transfer | Forward annotation | Update from schematic: adds, removes, renames, changes footprints; reports parts without footprints. | VERIFIED | U-PCB; E-PCB-2 |
| Placement | Move, rotate, flip, lock | Drag with grid snap, rotate 90°, flip to bottom (mirrored), lock. | VERIFIED (move + undo) | E-PCB-6 |
| Ratsnest | Yes | Minimum spanning tree between the copper islands of each net. | VERIFIED | U-PCB |
| Layers / stackup | Stackup Wizard, multilayer, plane layers, split planes | Two copper layers (F.Cu, B.Cu), mask, paste, silkscreen, edge cuts. | IN DEVELOPMENT (2 layers only, no stackup editor) | U-PCB |
| Manual routing | Push-and-shove and follow-me modes, switched with a key; route command centre | Click-to-route with 45° posture, layer change with a via (V), snap to pads, net check. | IN DEVELOPMENT (follow-me only; no push-and-shove or curved routing) | E-PCB-5 |
| Autorouter | Shape-based, multi-pass cost-based conflict reduction; automatic, batch (script) and interactive modes | Own two-layer A* grid router with vias. Rip-up and retry: failed connections are routed first on the next attempt; best attempt kept. | IN DEVELOPMENT (grid-based; no negotiated congestion costs, scripting or interactive mode) | U-PCB (complete + DRC clean; retry stops when no order can help); E-PCB-3 |
| Vias | Through, blind, buried; micro-vias with 1+n+1 HDI (9.2) | Through vias | IN DEVELOPMENT (through only) | U-PCB |
| Measure and Move (9.2) | Measure Mode snapping to pad, trace and courtyard edges; total/H/V readout; move to a typed distance | Cursor coordinate readout only. | NOT STARTED | — |
| Object grouping (9.2) | Persistent groups that move/rotate/mirror/copy together | — | NOT STARTED | — |
| Copper pours | Planes with nesting, islands, stitching, via fences | Per net and layer; clearance, edge keep-out, sliver removal, island removal, thermal reliefs or solid. | VERIFIED | U-PCB (Gerber regions read by gerbonara); E-PCB-7 |
| DRC | Live DRC; multi-layer rule rooms; room via-style override and "Exclude Foreign" (9.2) | Shorts, clearance (measured vs limit), unrouted, track width, drill, annular ring, board edge, outside board, courtyard overlap, dangling track, missing footprint. Spatial index makes it about 15× faster on 10 000 objects, with identical findings. | VERIFIED (no rule rooms, net classes or live DRC) | U-PCB; U-DRCIDX (grid = brute force); P-BENCH |
| High-speed: differential pairs, length matching, serpentines | Dedicated diff-pair mode with automatic phase matching; match groups; length reports | — | NOT STARTED | — |
| Testpoints, templates, multi-board | Yes | — | NOT STARTED | — |
| 3D visualiser | Fly-by navigation; bare-board view; height checker; STEP/IGES import and export | Board slab with holes, mask, copper, silkscreen, generic package bodies; iso/top/bottom/front cameras; orbit, pan, zoom; component and silkscreen toggles. | IN DEVELOPMENT (no STEP, height check or vendor models) | U-3D; E-3D-1..7 |

## 7. Manufacturing outputs

| Feature | Reference behaviour | NUCLUES implementation | Status | Tests |
|---|---|---|---|---|
| Gerber | Gerber X2; offset holes preserved (9.2) | RS-274X with X2 attributes: copper ×2, mask ×2, paste ×2 (SMD), silkscreen, outline. | VERIFIED | U-PCB (gerbonara counts equal the board; gerbv renders every file) |
| Excellon drill | Plated / non-plated | Plated holes, metric. | VERIFIED (no NPTH or slots) | U-PCB |
| Pick and place | User-defined column order and labels (9.2) | Fixed CSV: ref, value, package, X/Y, rotation, side. | VERIFIED (fixed columns) | U-PCB |
| Output Job Manager (9.2) | Reusable `.poprof` profiles of Gerber/P&P/BOM/3D/PDF/SVG/DXF tasks; field-code folder naming; pre-production check | One-click manufacturing zip. | NOT STARTED (profiles) | E-PCB-8 (zip) |
| PDF / SVG / DXF / STEP / ODB++ / IPC-2581 | Yes *(ODB++/IPC-2581 not stated on these pages)* | — | NOT STARTED | — |

## 8. Out of scope or not permitted

| Feature | Status | Reason |
|---|---|---|
| Proteus file import (`.pdsprj`, libraries) | NOT SUPPORTED | Proprietary format; no authorised specification. |
| Proteus part library | NOT SUPPORTED | Proprietary data. Libraries are built from public package standards and imported open libraries. |
| Mechanical CAD (sketcher, parametric solids, assemblies) | NOT SUPPORTED in NUCLUES | Belongs to CADRA. NUCLUES may export STEP for CADRA in future. |
| EDAi / ProPilot AI | NOT STARTED | An optional assistant may follow. It must never change geometry or connectivity silently. |
