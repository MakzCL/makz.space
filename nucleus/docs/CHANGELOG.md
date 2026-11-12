# NUCLEUS changelog

## 2026-11-12
- **Library.**
  - NE555 timer (behavioural; DIP-8 or SOIC-8).
  - LM7805 regulator (behavioural; new TO-220-3 footprint and 3D body).
  - Both models draw their load current from the supply pin.
- **Example.** "555 timer oscillator (astable)", verified by Test B.
- **Devices panel.** It now lists the devices used in the open project as well as the ones picked earlier.
- **DRC.** `BoxGrid` spatial index: dense 10 000-object board in 0.70 s instead of 10.3 s, with identical findings (tested against brute force).
- **Benchmark.** `tests/perf` measures 100, 500 and 2 000 parts; see `PERFORMANCE.md`.
- **Docs.**
  - New: `PROTEUS_FEATURE_PARITY.md`, built from Labcenter's 9.2 pages.
  - New: `IMPLEMENTATION_STATUS.md`, `PERFORMANCE.md`, `THIRD_PARTY_LICENSES.md`, this changelog.
  - Rewritten: `ARCHITECTURE.md`.

## 2026-11-10
- Autorouter rip-up and retry.
- Solder-paste Gerber layers.

## 2026-11-09
- 3D board view.
- Rename of the PCB toolbar's 3D command.

## 2026-11-03 to 2026-11-08
- Schematic editor, ERC, ngspice simulation and instruments.
- PCB editor: footprints, placement, routing, autorouter, DRC and pours.
- Gerber/Excellon/pick-and-place output.
- Portable Windows build; SK Suite bundling.
