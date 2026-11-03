# UI interaction specification (implemented behaviour)

## Window
- **Header:** NUCLEUS mark, menus (File, Edit, View, Place, Design, Simulation, PCB, Library, Manufacturing, Tools, Window, Help), project name, revision, file name, save state, undo/redo/save buttons.
- **Document tabs:** Schematic, Analysis (graph), Bill of Materials, PCB placeholder. Tabs can be switched, closed, reordered by dragging, and opened with "+".
- **Transport (top right):** analysis selector, ▶ run (F5), ■ stop (Shift+F5, which terminates the worker), ⟲ clear results, and engine state with solve time.
- **Left:** tool strip (Selection, Component, Wire, Net label, Power, Ground, Probe), then the object browser (Devices with preview, Parts, Nets, Project tree). The browser can be resized and hidden.
- **Right:** inspector, which can be resized and hidden.
- **Bottom dock:** Simulation (settings and log), Instruments (multimeter and oscilloscope), Rule check, Netlist. It can be resized and hidden.
- **Status bar:** mode, snapped coordinates (mm or thou), grid, zoom, part and net counts, interactive flag, ERC counter (clicking it opens the findings), messages.
- Dark and light interfaces are available independently of the sheet colour (light paper by default; the dark sheet is optional).

## Schematic canvas
- **Navigation:**
  - wheel zooms at the cursor
  - middle-drag or Alt+drag pans
  - F6/F7 zoom in/out, F8 zoom to fit
  - G toggles the grid
- **Select:** click, Shift/Ctrl-click to add, marquee (fully enclosed objects), Escape clears. Hover highlights the object.
- **Move:** drag; the selection snaps to the grid, and wire ends attached to moved pins follow with an orthogonal elbow.
- **Place:** P opens the picker; Enter or double-click picks the device, R rotates and X mirrors the ghost, a click places it (repeatedly), Escape finishes.
- **Wire:** W starts a wire.
  - Click corners; clicking a pin or wire ends it.
  - Space flips the bend; Enter or double-click finishes; Escape cancels.
  - The cursor snaps to pins within about 8 px.
- **Labels:** L for a net label (asks for a name); Power asks for a name (default VCC); Ground places immediately.
- **Probe:** shows the solved voltage next to it.
- **Context menu:** on objects it offers rotate, mirror, duplicate, delete and properties; on empty space, zoom commands.
- Selecting a wire highlights its whole net.
- **ERC markers:** circled ✕ marks at the findings; clicking a finding centres the view on it and selects the object.
- **Interactive mode (Simulation menu):** clicking a switch toggles it and re-solves the operating point; moving the potentiometer slider re-solves on release.

## Shortcuts
- Shortcuts come from one registry (`ui/shortcuts.ts`) and are scoped (global or schematic). Help → Keyboard shortcuts lets you remap them, warns about conflicts and restores defaults.
- Defaults follow familiar EDA conventions; they still need to be checked against Proteus 9.2 (see the audit).

## Rules for controls
- No control pretends to work. Anything not built yet is disabled with the reason ("planned", "not built yet", "needs PCB layout").
