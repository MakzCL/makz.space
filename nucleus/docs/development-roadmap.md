# Development roadmap

| Phase | Content | State |
|---|---|---|
| 1 Foundation | Repository structure, shell, tabs, panels, persistence, tests | **Done** (web build; desktop packaging pending) |
| 2 Schematic | Picking, placement, wiring, connectivity, properties, undo, save/load, ERC | **Done** (single sheet; buses and hierarchy pending) |
| 3 Simulation | ngspice; OP/TRAN/AC/DC sweep, log, probes, multimeter, oscilloscope, graphs | **Done** for analogue; digital and mixed-mode pending |
| 4 PCB | Integer-nm model, footprints (IPC-7351 naming), netlist transfer with staging area, outline, 2 layers, placement, manual routing, vias, DRC | **Next** |
| 5 Manufacturing | Zones, Gerber RS-274X/X2, Excellon, BOM/PDF, validation against gerbv and gerbonara (both installed for tests) | After 4 |
| 6 Professional | Better routing, rooms, 3D (Three.js), library editors and versioning, groups, multi-sheet, advanced analyses | — |
| 7 Embedded | Editor, toolchains (avr-gcc etc.), MCU models only where actually implemented | — |
| 8 High end | Push-and-shove, differential pairs, length tuning, autorouting, HDI, IoT Builder, Visual Designer, assistant | — |

**Next session:** start Phase 4 with the board model, the footprint library for the 20 footprint names already used by the devices, and netlist transfer.
