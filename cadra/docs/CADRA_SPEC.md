# CADRA — mechanical CAD specification

CADRA is the standalone mechanical CAD application of SK Suite. It holds every mechanical-CAD requirement that was removed from the NUCLEUS specification:
- sketcher and constraints;
- parametric solids and feature history;
- assemblies;
- PCB/enclosure integration;
- STEP/IGES/DXF/STL exchange;
- Test E (enclosure).

**Out of scope for CADRA:** schematic capture, SPICE simulation and PCB routing. Those belong to NUCLEUS.

CADRA has its own code (`cadra/`), native format (`.cadra`), tests, versions and release artifacts. It runs on its own: in a browser at cadra.makz.space, or offline inside SK Suite.

## Exchange with NUCLEUS (planned, file-based)
1. NUCLEUS exports the board assembly as STEP: outline, thickness, holes, component bodies.
2. CADRA imports it as a fixed body.
3. In CADRA, the user designs the enclosure and checks mounting points and clearances.
4. When the board outline changes in NUCLEUS, re-importing updates the linked body. Changes that cannot be applied automatically appear as explicit warnings.

There is no shared code or in-process link between the two applications.

## Requirements and status

| Area | Requirement | Status | Tests |
|---|---|---|---|
| **2D drafting** | Lines, polylines, rectangles, circles, arcs, polygons, text, hatches, layers, object snaps, ortho, grid, coordinate entry (absolute, relative, polar) | VERIFIED | `tests/core.test.ts`, `tests/e2e/draft.mjs` |
| | Modify: move, copy, rotate, scale, mirror, offset, trim, extend, fillet (radius), chamfer, rectangular and polar arrays, explode, erase | VERIFIED | `tests/modify2.test.ts`, e2e |
| | Dimensions: linear, aligned, radius, diameter, angular | VERIFIED | `tests/modify2.test.ts`, e2e |
| | Blocks: define, insert (scale, rotation), nested, explode | VERIFIED | `tests/blocks.test.ts`, e2e |
| | Splines, ellipses, construction geometry, stretch | NOT STARTED | — |
| **Sketch constraints** | Coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, concentric, symmetric, distance, angle, radius, diameter, fixed. The solver reports fully, under- or over-constrained, or inconsistent. | NOT STARTED | Candidate: planegcs (FreeCAD's GCS, LGPL-2.1) compiled to WASM, or our own Newton–Raphson solver with DOF analysis |
| **Parametric solids** | Extrude, revolve, pocket, cut, booleans, fillet, chamfer, shell, hole, pattern, mirror, loft, sweep, on a real B-rep kernel | NOT STARTED | Candidate kernel: Open CASCADE through opencascade.js (LGPL-2.1 with exception). A licensing review is needed before it is bundled. |
| **Feature history** | Editable feature tree; editing an early parameter recomputes downstream features or reports a clear failure | NOT STARTED | Depends on the kernel |
| **Assemblies** | Parts, transforms, hierarchy, placement constraints, clearance measurement, interference check | NOT STARTED | — |
| **Technical drawings** | Views from solids, dimensions, title blocks, PDF | NOT STARTED | 2D drafting is the base |
| **File exchange** | DXF read/write | VERIFIED | `tests/dxf.test.ts`, `tests/blocks.test.ts`. ezdxf reads the output with 0 errors. |
| | SVG export | VERIFIED | `tests/dxf.test.ts` |
| | STEP, IGES, STL | NOT STARTED | Depends on the kernel |
| | DWG | NOT SUPPORTED for now | No authorised open specification. Would need a licensed library. |
| **Mechanical simulation** | Analysis (stress, thermal), planned separately | NOT STARTED | — |
| **Test E** | Parameterised enclosure, mounting posts, connector cutouts, linked PCB; change dimensions, recompute, collision check | NOT STARTED | Needs solids, assemblies and STEP import |

## Phases
1. **2D drafting** — done: command line, snaps, layers, modify, dimensions, blocks, DXF, SVG.
2. **Sketcher with constraints:**
   - geometric constraint solver with DOF reporting;
   - sketch entities on planes;
   - tests against known constrained configurations.
3. **B-rep kernel integration:**
   - kernel and licence decision;
   - extrude, revolve and booleans on sketches;
   - STEP and STL export, validated by an independent reader.
4. **Feature tree:** parametric recompute and failure reporting.
5. **Assemblies:** placement, interference and clearance.
6. **NUCLEUS board import and Test E.**
7. **Drawings:** views, dimensions, PDF.

## Architecture (current)
- **Stack:** TypeScript and React. Canvas 2D for drafting.
- **Core:** pure engine modules (`src/core/geom.ts`, `cad.ts`, `dxf.ts`) with no DOM imports, driven by scripted input in tests.
- **Phase 3:** brings a WebGL viewport and the kernel as a separately loaded WebAssembly module.
