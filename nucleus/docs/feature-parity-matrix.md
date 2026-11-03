# Feature parity matrix

**Status key**
- **Verified** — verified complete by automated tests with known values or an independent tool.
- **Implemented** — implemented but not yet verified.
- **Partial** — partially implemented.
- **Planned** — not started.
- **Unsupported** — will not be done.

The reference behaviour is unverified for Proteus 9.2 (see `proteus-reference-audit.md`).

| Feature | Reference behaviour | NUCLEUS implementation | Status | Test method | Known limitations |
|---|---|---|---|---|---|
| Project create/save/open | .pdsprj project | `.nucleus` JSON, versioned schema, SHA-256 over canonical JSON, migration hook, schema-version refusal | Verified | `core.test.ts` round-trip and tamper tests; e2e steps 10–11 (fresh browser) | No multi-file projects yet; File System Access API or download fallback |
| Autosave / recovery | Autosave and backups | Recovery copy in browser storage after every change | Implemented | Manual | Browser storage only; the file is the record |
| Undo/redo | Unlimited | 300-step snapshot history | Implemented | Used in e2e | — |
| Device picking | P → Pick Devices | Search by name/part number/description/category, symbol preview, pin table, model and footprints | Verified | e2e step 4 | 23 built-in devices; no user libraries yet |
| Component placement | Click to place, rotate/mirror while placing | Same (R / X during placement, repeat placement) | Verified | e2e step 4 | — |
| Annotation | Automatic | Lowest free number per prefix; annotate / re-annotate; duplicates renumbered | Verified | `core.test.ts` | — |
| Wiring | Pin-to-pin, auto junctions | Orthogonal wires snapping to pins and wires; T-joins connect; crossings do not; junction dots derived | Verified | `core.test.ts` (crossing vs T, pin on wire); e2e step 6 | No wire autorouter; no segment dragging yet (move parts and the wire ends follow) |
| Moving wired parts | Wires follow | Wire ends on moved pins follow, with orthogonal elbows | Verified | `core.test.ts` (netlist unchanged after move/rotate) | — |
| Net labels, power, ground terminals | Same-name join | Same-name nets join project-wide; GND = SPICE node 0 | Verified | `core.test.ts` | Hierarchical ports not yet |
| Buses / bus entries | Supported | — | Planned | — | — |
| Multi-sheet / hierarchy | Supported | Model has sheets; only one sheet is editable in the UI | Partial | — | Sheet add/navigation UI to do |
| Properties inspector | Edit Component | Reference, value (validated, engineering notation), footprint list, manufacturer/MPN, switch/pot state; pins and nets | Verified | e2e step 5 (invalid value refused) | — |
| ERC | ERC report | 13 rules, each finding linked to the object and location, with ignore per rule | Verified | `core.test.ts`; e2e step 7 | Pin type data only as good as the library |
| Netlist | Netlist compiler | Deterministic netlist; SPICE deck export | Verified | `core.test.ts` exact text | — |
| DC operating point | Yes | ngspice 45 (WASM) | Verified | 2.5 V divider agrees with native ngspice; e2e step 9 multimeter = native ngspice | — |
| Transient | Yes | ngspice | Verified | RC reaches 63.2 % at τ | — |
| AC sweep | Yes | ngspice, magnitude/phase | Verified | RC low-pass −3 dB at fc | — |
| DC sweep | Yes | ngspice `.dc` | Implemented | Manual | — |
| Noise, Fourier, distortion, conformance | Yes | — | Planned | — | — |
| Digital / mixed-mode | Yes | — | Planned | — | Needs digital models (XSPICE in ngspice) |
| Interactive simulation | Real-time | Switch/pot change → re-solve the operating point (mode "Interactive") | Verified (solver side) | `sim.test.ts` switch and pot | Not real-time transient |
| Voltage probe | Yes | Shows the solved node voltage on the sheet | Implemented | Visual | — |
| Multimeter | DC/AC V, A | DC V, AC V rms (transient), DC A (sources from the solver; resistors via Ohm's law on solved voltages) | Verified (DC V) | e2e step 9 vs native ngspice | No current probes in wires yet |
| Oscilloscope | 4 channels | 4 channels, V/div, time/div, edge trigger, hold, cursors, CSV | Implemented | Visual (RC demo) | No AC coupling yet |
| Graphs | Many types | Transient / AC (dB + phase) / DC sweep, cursors A/B with deltas, zoom, CSV/PNG | Implemented | Visual | — |
| Logic analyser, counter, terminal, SPI/I²C, pattern gen, wattmeter | Yes | — | Planned | — | Need digital simulation first |
| BOM | Yes | Grouped, filterable, CSV; simulation-only sources excluded | Verified | e2e step 12 | PDF/XLSX planned |
| PCB layout and everything after it (routing, DRC, zones, 3D, Gerber, drill, pick and place) | ARES | — | Planned (next milestone) | — | e2e steps 13–21 cannot run yet |
| Symbol / footprint editors, library versioning | Yes | Library has a version field per device | Planned | — | — |
| Firmware / MCU co-simulation | VSM | — | Planned | — | No MCU is claimed as supported |
| Visual Designer, IoT Builder, AI assistant | Yes | — | Planned | — | Later phases |
| Desktop installer | Windows installer | Web build only | Planned | — | Electron/Tauri packaging milestone |
| Proteus file import | — | — | Unsupported | — | Proprietary format, not authorised |
