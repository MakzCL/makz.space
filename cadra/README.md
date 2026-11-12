# CADRA

CADRA is an open 2D CAD drafting app. You draw from a command line, as in classic desktop drafting programs.
It covers the same everyday drafting workflow as CADCraft, the open-source AutoCAD-style 2D CAD.
It was written from scratch from CADCraft's public feature descriptions. No code, icons or branding were copied.
CADRA runs in the browser and inside SK Suite, where it works fully offline.

```
npm install
npm run dev        # http://localhost:5173
npm test           # geometry, command engine and DXF tests (vitest)
npm run build && npm run preview   # http://localhost:4290
node tests/e2e/draft.mjs tests/out # browser end-to-end (needs the preview running)
node tests/audit.mjs tests/out     # click-every-control UI audit
```

## Using it

You can type a command name or alias and press Enter, or you can pick a tool in the ribbon. Enter or Space on an empty line repeats the last command.

When a command asks for a point, you can enter it in several ways:

- `x,y`: an absolute point.
- `@dx,dy`: relative to the last point.
- `@dist<angle`: polar, relative to the last point.
- A bare number: a distance along the cursor direction ("direct distance").
- A click. Object snaps apply, and ORTHO applies when it is on.

### Keys

| Key | Action |
|---|---|
| F3 | Object snap on or off |
| F7 | Grid on or off |
| F8 | Ortho on or off |
| F9 | Snap to grid on or off |
| Esc | Cancel the command, or clear the selection |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+A | Select all |
| Del | Erase the selection |

### Mouse

| Action | Effect |
|---|---|
| Wheel | Zoom about the cursor |
| Middle-drag, right-drag or Shift-drag | Pan |
| Drag left to right | Window selection (objects fully inside) |
| Drag right to left | Crossing selection (objects touching the box) |

### Commands

| Group | Commands (aliases) |
|---|---|
| Draw | LINE (L), PLINE (PL), CIRCLE (C, with the 2P and Diameter options), ARC (A, 3 points), RECTANG (REC), POLYGON (POL), TEXT (T/DT), HATCH (H) |
| Modify | MOVE (M), COPY (CO/CP, multiple), ROTATE (RO), SCALE (SC), MIRROR (MI, keep or erase the source), OFFSET (O), TRIM (TR), EXTEND (EX), FILLET (F, Radius option; 0 makes a sharp corner), CHAMFER (CHA, two distances), ARRAYRECT (AR), ARRAYPOLAR (PA), EXPLODE (X), ERASE (E) |
| Annotate | DIMLINEAR (DLI, picks horizontal or vertical automatically), DIMALIGNED (DAL), DIMRADIUS (DRA), DIMDIAMETER (DDI), DIMANGULAR (DAN), DIST (DI) |
| Blocks | BLOCK (B), INSERT (I); EXPLODE breaks a block reference into its objects |
| Other | LAYER (LA), UNDO (U), REDO, ZOOM (Z, extents), HELP, NEW, OPEN, SAVE, DXFOUT, SVGOUT |

### Object snaps

The available snaps are endpoint, midpoint, center, quadrant, intersection, perpendicular and nearest. Each one can be switched on or off in the side panel.

### Layers and properties

- **Layers** can be made current, hidden, locked, recoloured and deleted (only when empty). You cannot select or edit objects on a locked or hidden layer.
- **The Properties panel** shows what is selected. You can change the layer and colour (or set them back to ByLayer). It also shows measurements: length, angle, area, circumference and arc length. You can edit text contents and circle radius directly.

## Files

| Format | Read | Write | Notes |
|---|---|---|---|
| `.cadra` (JSON) | yes | yes | Lossless native format. |
| DXF (ASCII) | yes | yes (R12 / AC1009) | Blocks are written as BLOCK definitions with INSERT references, and read back. Read: LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE, TEXT, MTEXT, HATCH (polyline boundaries), and DIMENSION (linear, aligned, radius, diameter). Anything else is listed as "not imported" when the file opens. Written dimensions become lines and text, and hatches become closed polylines. |
| SVG | | yes | Visible layers, at real size in mm or inches. |

The tests check DXF output with [ezdxf](https://ezdxf.mozman.de/), an independent reader: `tests/tools/check_dxf.py` must report 0 errors. CADRA also reads an R2018 file written by ezdxf, which is checked in `tests/dxf.test.ts`.

Each drawing is autosaved in the browser after every change, so a reload brings it back.

The full mechanical-CAD roadmap (sketch constraints, parametric solids, assemblies, STEP, the NUCLEUS board link) is in `docs/CADRA_SPEC.md`.

## Parity with CADCraft (honest status)

| Area | CADRA |
|---|---|
| Command line, coordinate entry, aliases, repeat last command | ✅ |
| Object snaps, ortho, grid snap | ✅ (no polar tracking yet) |
| Draw: line, polyline, circle, 3-point arc, rectangle, polygon, text, hatch | ✅ (no ellipse, spline or multiline text editor yet) |
| Modify: move, copy, rotate, scale, mirror, offset, trim, extend, fillet (any radius), chamfer, rectangular and polar array, explode, erase | ✅ (no stretch or path array yet; fillet and chamfer work on lines) |
| Dimensions: linear, aligned, radius, diameter, angular | ✅ (no ordinate dimensions or dimension styles yet) |
| Layers: current, visibility, lock, colour | ✅ (no linetypes or lineweights yet) |
| Blocks: BLOCK, INSERT (scale, rotation), nested blocks, EXPLODE | ✅ (no block attributes or block editor yet) |
| DXF in and out | ✅ (R12 out; common entities in) |
| DWG | ❌ not supported |
| Paper space, layouts, plotting to PDF | ❌ not yet (SVG export only) |
| Scripting / CLI / MCP automation | ❌ not yet (the command engine is a plain TypeScript class that tests drive with scripted input, so it is ready for this) |
