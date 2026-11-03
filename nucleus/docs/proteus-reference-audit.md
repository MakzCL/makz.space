# Proteus reference audit

**Status of this audit:** written without direct access to the reference material. `www.labcenter.com` is blocked by this development environment's network policy, so none of the pages listed in the directive could be fetched, including the 212-page tutorial PDF. No Proteus installation was available either.

Everything below therefore comes from general, long-standing knowledge of how Proteus works (ISIS schematic capture, ARES PCB layout, VSM simulation). Each item is marked:

- **[known]** — long-standing behaviour, stable over many versions.
- **[unverified 9.2]** — believed current, but not checked against 9.2 documentation or a demo installation.

Before any item is treated as a parity target, re-check it once labcenter.com is allowed (environment settings → network).

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

## What NUCLEUS uses from this audit
NUCLEUS takes only the familiar *workflow*:
- pick devices with P
- the object selector on the left
- the transport at the bottom
- F6/F7/F8 zoom and G for the grid

All code, symbols, icons and file formats are original.
