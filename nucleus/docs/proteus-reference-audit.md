# Proteus reference audit

**Status of this audit (updated 2026-11-12):** these Labcenter pages were downloaded and read on 2026-11-12:
- whatsnew/9.2, schematic, pcb-layout, router, highspeed, simulation, instruments, microprocessors, proteus9, pcb, tutorials.

The feature-by-feature result is in `PROTEUS_FEATURE_PARITY.md`. Items below marked **[unverified 9.2]** were written before those pages could be reached. Where they disagree with the parity matrix, the matrix wins.

Notes from the 9.2 pages:
- **New in 9.2:** Measure and Move, the Output Job Manager (`.poprof` profiles), HDI micro-vias (1+n+1 stackup), persistent object groups, DRC room via-style override and "Exclude Foreign", offset holes and slots in padstacks, configurable pick-and-place columns.
- **Also new in 9.2:** AI library parts (ProPilot, beta), the System Meter, BLE and RFID models, and GDB remote for Cortex-M.
- **Autorouter:** shape-based with multi-pass cost-based conflict reduction; automatic, batch (SPECCTRA-like script) and interactive modes.
- **Instruments:** system scope 4 channels with X-Y, 20 V/div to 2 mV/div, 200 ms/div to 0.5 µs/div; logic analyser 24 channels with a 40 000-sample buffer; SPI/I²C/CAN analysers; signal generator 0–12 MHz; virtual terminal 300–57 600 baud; counter/timer; voltmeters, ammeters and a wattmeter.
- **MCU families listed:** ARM7, Cortex-M0/M0+/M3/M4, Arduino boards, PIC10–PIC24, dsPIC33, 8051, AVR, MSP430, Piccolo, MicroPython (Pico, ESP32).

## Application layout
- **[known]** One application window with document tabs: Schematic Capture, PCB Layout, 3D Visualiser, Bill of Materials, Design Explorer, Source Code (VSM Studio) and Visual Designer.
- **[known]** Left side: a mode/tool toolbar, an overview window, and the object selector, which lists the devices picked for this design. Pressing **P** opens "Pick Devices": keyword search, category filter, symbol and footprint preview, and whether a simulation model exists.
- **[known]** Bottom left: simulation transport (play, step, pause, stop). The status bar shows coordinates, the current mode, and messages.
- **[known]** Editing modes include component, junction dot, wire label, text script, bus, sub-circuit, terminals (power, ground, input, output, bidirectional, default), device pins, graphs, generators, voltage/current probes, virtual instruments and 2D graphics.

## Schematic
- **[known]** Wiring is point-to-point between pins, with automatic routing of the wire path ("wire autorouter") and automatic junction dots at T-connections.
- **[known]** Terminals with the same name are connected. Power and ground terminals join global nets.
- **[known]** Parts are referenced automatically (annotator). Property editing is done by double-clicking or through Edit Component.
- **[known]** Hierarchical sub-circuits are supported. The ERC report is listed in a text window.

## Simulation (VSM)
- **[known]** Mixed-mode SPICE-based simulation with interactive (real-time) simulation of switches, potentiometers, LEDs and displays.
- **[known]** Microcontroller co-simulation: firmware (HEX/ELF/COFF) runs on models of MCUs, mainly PIC, AVR, ARM, 8051 and others.
- **[known]** Graph-based analyses: analogue, digital, mixed, frequency, noise, distortion, Fourier, DC sweep, AC sweep, transfer and conformance.
- **[known]** Virtual instruments: oscilloscope, logic analyser, counter/timer, virtual terminal, SPI/I²C debuggers, signal generator, pattern generator, DC/AC voltmeters and ammeters, and a wattmeter.

## PCB (ARES)
- **[known]** Netlist transfer from the schematic, with ratsnest and force vectors.
- **[known]** Board edge layer, multilayer stackups, design rules and net classes, live DRC, power planes/zones and a shape-based autorouter.
- **[unverified 9.2]** Push-and-shove and follow-me interactive routing modes, differential pairs, and length matching.
- **[unverified 9.2]** **Measure & Move**, which measures between edges and repositions an object by typing a distance.
- **[unverified 9.2]** Persistent groups.
- **[known]** Outputs: Gerber X2/RS-274X, Excellon, ODB++, pick and place, BOM, and STEP/IGES/3D export.

## Shortcuts (as remembered; verify before using them as a compatibility preset)
- F6/F7 zoom in/out, F8 zoom to all, F5 centre at cursor (in older versions), G toggles the grid, and M toggles metric/imperial (ARES).
- PCB routing: Shift+P push/follow mode, Shift+N neck-down, Escape cancels.

## What NUCLUES uses from this audit
NUCLUES takes only the familiar *workflow*:
- pick devices with P
- the object selector on the left
- the transport at the bottom
- F6/F7/F8 zoom and G for the grid

All code, symbols, icons and file formats are original.
