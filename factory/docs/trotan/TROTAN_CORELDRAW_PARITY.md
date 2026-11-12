# TROTAN ↔ CorelDRAW Graphics Suite 2026: feature parity

## Sources
- coreldraw.com product page for CorelDRAW Graphics Suite 2026, read on 2026-11-12.
- Long-standing, documented CorelDRAW behaviour (tool names and dockers) for detail the product page does not state.
- Trotec's laser-software pages, used for the laser side.

We have no CorelDRAW licence and have not run CorelDRAW. No Corel code, icons, branding or file content are used. TROTAN uses its own names in the UI.

**From the 2026 product page:**
- generative AI "Text-to-vector";
- AI-assisted PowerTRACE and background removal;
- Contour, Envelope, Blend and Mesh Fill effects;
- multipage layout;
- variable fonts and fit-text-to-path;
- non-destructive effects;
- Object Styles and the Objects inspector;
- Pantone libraries;
- custom shortcuts and workspaces;
- DWG/DXF export (in CorelDRAW Web).

**Status values:** NOT STARTED, IN DEVELOPMENT, IMPLEMENTED, VERIFIED, NOT SUPPORTED. VERIFIED means an automated test in `REGRESSION_TESTS.md` covers it.

## Objects and drawing tools

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Pick tool: select, marquee, move, scale, rotate | Select tool with handles, marquee, move, resize | VERIFIED | e2e step 4–5, `actions.test.ts` |
| Rectangle (rounded corners) | Rectangle with corner radius | VERIFIED | `geom.test.ts` shapes |
| Ellipse / circle | Yes | VERIFIED | `geom.test.ts` shapes |
| Polygon / star | Polygon with star factor | IMPLEMENTED | — |
| Spiral, arc, pie | — | NOT STARTED | — |
| Freehand (Pencil) | Pencil with stroke simplification | VERIFIED | `actions.test.ts` snapping and stroke simplification |
| Pen / Bézier | Pen tool | IMPLEMENTED | — |
| B-Spline, Polyline, Smart Drawing, Artistic Media | Line tool only | NOT STARTED | — |
| Knife, Eraser, Crop, Virtual Segment Delete | Split and break-apart only | NOT STARTED | — |
| Dimension tools | — | NOT STARTED | — |
| Eyedropper / attribute copy | — | NOT STARTED | — |
| Symbols (reusable definitions) | SVG `<use>` is expanded on import; no native symbols | NOT STARTED | — |

## Node editing (Shape tool)

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Select, move, add (curve-preserving), delete nodes | Yes | VERIFIED | `actions.test.ts` nodes |
| Line ↔ curve, split, close/open | Yes | IMPLEMENTED | README checklist 4 |
| Smooth / symmetrical / cusp node types, handle editing | Handles editable; no node-type constraint | IN DEVELOPMENT | — |
| Join, combine, break apart, reverse direction | Join, break apart | VERIFIED | `geom.test.ts` join and split |
| Curve simplification / reduce nodes | On pencil strokes only | IN DEVELOPMENT | — |
| Snapping: grid, guides, nodes, centres, edges | Yes | VERIFIED | `actions.test.ts` snapping |
| Snapping: intersections, tangents | — | NOT STARTED | — |

## Transformations

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Exact X/Y/W/H/angle, arithmetic in fields | Yes, in mm | VERIFIED | e2e step 5, `actions.test.ts` |
| Rotate, mirror, skew about a pivot | Rotate and mirror; skew not exposed | IN DEVELOPMENT | `actions.test.ts` rotate/mirror |
| Align, distribute | Yes | VERIFIED | `actions.test.ts` |
| Group / ungroup, duplicate, arrange order | Yes | VERIFIED | `actions.test.ts` |
| Clone (linked copy), lock/hide | Lock and hide; no clones | IN DEVELOPMENT | — |
| Units: mm, cm, m, in, pt, px | One `UNITS` table | VERIFIED | `geom.test.ts` units |

## Shaping and booleans

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Weld, Intersect, Trim (subtract), Exclude | Union, intersect, subtract, exclude (Clipper) | VERIFIED | `geom.test.ts`, `actions.test.ts` (exact areas) |
| Offset / contour (inside, outside) | Offset and kerf compensation | VERIFIED | `geom.test.ts` offset |
| Create boundary, simplify | — | NOT STARTED | — |

## Effects, fills and outlines

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Uniform fill / outline colour per object | Colour comes from the layer; no per-object paint | NOT STARTED | — |
| Fountain (gradient), pattern, texture, mesh fills | — | NOT STARTED | — |
| Outline width, styles, variable width, artistic brushes | — | NOT STARTED | — |
| Contour, Blend, Envelope, Distort, Extrude, Perspective | — | NOT STARTED | — |
| Drop / inner shadow, transparency | — | NOT STARTED | — |
| PowerClip (place inside container) | — | NOT STARTED | — |

## Typography

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Artistic text, kept live and converted to cuttable outlines | Live text object (string kept, re-outlined) with 3 bundled fonts (Poppins, SIL OFL) | IMPLEMENTED | — |
| Paragraph text, frames, linked frames, wrap | — | NOT STARTED | — |
| Font selection from system or uploaded fonts, missing-font warnings | — | NOT STARTED | — |
| Kerning, tracking, leading, OpenType features, variable fonts | — | NOT STARTED | Needs a shaping engine; candidate: HarfBuzz compiled to WASM |
| Text on path, text in shape | — | NOT STARTED | — |
| Convert text to curves | Text is already outlines; explicit convert not exposed | IN DEVELOPMENT | — |

## Colour

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| RGB colours per layer | Yes | IMPLEMENTED | — |
| CMYK, spot colours, palettes, ICC profiles, soft proof | — | NOT STARTED | Candidate: LittleCMS compiled to WASM |
| Colour → laser process mapping | One operation per layer (explicit, never inferred) | VERIFIED | e2e steps 9–10 |
| Pantone libraries | — | NOT SUPPORTED unless licensed | — |

## Bitmaps

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Place PNG, JPEG, BMP, GIF, WebP | Yes (content-detected) | VERIFIED (PNG, GIF, WebP) | `raster.e2e.mjs`, `import.e2e.mjs` |
| Brightness, contrast, gamma, invert, threshold | Yes, for engraving | VERIFIED | `raster.test.ts`, `raster.e2e.mjs` |
| Dithering (Floyd–Steinberg, JJN, Stucki, Atkinson, Sierra, Bayer), greyscale power | Yes | VERIFIED | `raster.test.ts` |
| Crop, levels, curves, blur, sharpen, masks | — | NOT STARTED | — |
| Bitmap → vector tracing (PowerTRACE-class) | — | NOT STARTED | — |

## Documents and files

| Feature | TROTAN today | Status | Tests |
|---|---|---|---|
| Multiple pages, page sizes, master layers | One page per project | NOT STARTED | — |
| Rulers, grid, guides | Yes | IMPLEMENTED | — |
| Object manager (layers and objects panel) | Layers panel with operations; objects listed | IMPLEMENTED | — |
| Save, autosave, revisions, recovery copy | Yes | VERIFIED | e2e step 7 |
| Import by content detection, with a review of losses | New in this cycle | VERIFIED | `import.e2e.mjs`, `packages/sk-formats` tests |
| Open CorelDRAW CDR/CDT | Shapes, groups, layers, transforms, solid fills and outlines import as editable vectors (CorelDRAW 5–X5 verified against libcdr: 781/781 shapes). Text, bitmaps, gradients and spot colours are counted and listed, not imported. CMX is recognised only. | PARTIAL (VERIFIED for what is imported) | `packages/sk-formats/docs/CDR_IMPORT_VERIFICATION.md`, `tests/cdr.test.ts`, `import.e2e.mjs` |
| PDF / AI / EPS import | Recognised; import not built | NOT STARTED | — |
| SVG / SVGZ / DXF import and export | Yes | VERIFIED | `geom.test.ts`, `import.e2e.mjs` |
| PDF export | — | NOT STARTED | — |
| Variable data, serial numbers, barcodes, QR | — | NOT STARTED | — |

## Summary
TROTAN already covers the core of a laser-oriented vector editor:
- primitives, node editing, transforms, booleans, offsets;
- engraving raster processing;
- a production workflow that CorelDRAW does not have.

The biggest gaps against CorelDRAW are:
1. per-object fills and outlines, and the effects built on them;
2. typography;
3. pages;
4. tracing;
5. CorelDRAW text, bitmaps and fills on import. Geometry import is done for CorelDRAW 5–X5; X6–2024 need real files to verify.

The next milestones address these in that dependency order; see `REGRESSION_TESTS.md` and the CHANGELOG.
