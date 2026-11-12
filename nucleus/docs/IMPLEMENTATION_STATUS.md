# NUCLUES implementation status

Phases follow the NUCLUES master specification. Mechanical CAD (old Phase 8) moved to CADRA; see `../../cadra/docs/CADRA_SPEC.md`. "Done" means the phase's acceptance test passes, as recorded in `TEST_REPORT.md`.

| Phase | Acceptance test | State |
|---|---|---|
| 0 Audit | Architecture summary, gap analysis, dependency plan | **Done.** See `ARCHITECTURE.md`, `PROTEUS_FEATURE_PARITY.md` and `THIRD_PARTY_LICENSES.md`. |
| 1 Desktop foundation | Create, save, close, reopen and edit a project | **Done**, in a browser and in Electron (E-BETA-10/11, E-DESK). Panels resize but do not detach. |
| 2 Schematic editor | Draw, ERC-validate, save and reopen a circuit | **Done** for single-sheet designs. Missing: buses, hierarchy UI and variants. |
| 3 SPICE simulation | Correct results that follow value changes | **Done** for analogue OP/TRAN/AC/DC. Test B (555) passes. Missing: noise, Fourier, parameter sweep and digital. |
| 4 PCB editor | Schematic becomes an electrically connected PCB | **Done** for 2 layers. Missing: multilayer stackup, push-and-shove and net classes. |
| 5 Manufacturing | Files open in independent tools with expected content | **Done**: Gerber (copper, mask, paste, silk, outline), Excellon, pick and place and BOM CSV, all read by gerbonara and gerbv. Missing: output job profiles, PDF/SVG/DXF, NPTH. |
| 6 3D PCB viewer | 3D view matches the saved PCB | **Partial.** Board, holes, copper, mask, silkscreen and generic bodies are tested (U-3D, E-3D). Missing: STEP and vendor models. |
| 7 Advanced PCB | Push-and-shove, differential pairs, length matching, HDI | **Started.** Autorouter rip-up and retry only. |
| 8 *(moved to CADRA)* | — | — |
| 9 Embedded simulation | Real firmware runs against a simulated circuit | Not started. No MCU is claimed. |
| 10 Professional release | Installed and used on Windows | **Partial.** Portable Windows zip exists; not yet run on real Windows. No installer, associations or code signing. |

## Your test scenarios

| Test | State |
|---|---|
| A — LED circuit | **Pass**: connectivity, ngspice current and voltage, editing, save/reopen, ERC (E-BETA 1–12, U-EX). |
| B — 555 timer | **Pass**: oscillates; frequency within 3 % of the formula; 1/3–2/3 VCC swing; frequency halves when C doubles (U-TMR, E-EX-8). |
| C — PCB production | **Partial.** The LED board passes footprint mapping, ratsnest, manual and auto routing, DRC, a copper zone, the 3D view, Gerber, drill, BOM and pick and place (E-PCB, E-3D). Not yet done with a microcontroller, because there is no MCU part yet. |
| D — Four-layer PCB | Not possible yet: 2 layers only. |
| E — Mechanical enclosure | Moved to CADRA. |
| F — Persistence | **Pass** for schematic and PCB (E-BETA-11, E-PCB-9). |

## Next priorities (in dependency order)
1. **Incremental connectivity and ERC.** These are about 1 s per edit at 2 000 parts; see `PERFORMANCE.md`.
2. **Layer stackup with inner layers.** This is the base for Test D, planes, blind/buried vias and HDI.
3. **Net classes and per-class rules in DRC and the router.**
4. **Library expansion** (regulators, logic, MCUs as non-simulated parts first), with a symbol/footprint editor and pin-to-pad validation.
5. **Buses and hierarchical sheets.**
