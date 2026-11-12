# TROTAN architecture and baseline (2026-11-12)

TROTAN is one application with two integrated sides: **design** (vector editing) and **laser production**. It is not a separate CorelDRAW clone. CADRA and NUCLEUS stay separate applications. This document is the Phase 0 audit for TROTAN 2.0.

## Baseline audit

| Item | Finding |
|---|---|
| Location | `factory/src/trotan/`, about 4 500 lines of TypeScript and React. It is served by the SK Factory build at `/trotan` and `trotan.makz.space`. |
| Frontend | React 19, Vite. The canvas is HTML Canvas 2D (`editor/render.ts`). |
| Backend | Supabase (PostgreSQL with row-level security; `trotan_*` tables and functions). Server-side safety rules are in `README.md` → Safety rules. |
| Geometry engine | `geom/core.ts`: exact lines and cubic Béziers in **millimetres**, affine matrices, typed objects (path, rect, ellipse, polygon/star, text, image, group). Booleans and offsets use Clipper (0.1 µm scale). |
| Document format | `Doc { format: "trotan", version: 1, units: "mm", width, height, layers, objects, guides }`, stored in `trotan_projects` with named revisions. The `.trotan` file is versioned and refuses files from a newer format (`geom/project.ts`). |
| Layers | Each layer carries the laser operation (`cut / kiss / score / vengrave / mark / raster / none`) and optional parameters. Colour is per layer. Objects can override the operation. |
| Laser engine | `geom/laser.ts` (validation, toolpath, kerf, common line, nesting, estimates), `geom/raster.ts` (dithering), `prod/*` (prepare, produce, machine export), `geom/adapters.ts` (machine adapter API; virtual laser only). |
| Import / export | Before this cycle the importer was chosen **by file extension**: SVG and DXF in a worker; PNG, JPG and BMP; `.trotan`. Export: SVG and DXF (mm), PNG at 300 DPI, `.trotan`. |
| Tests (baseline) | `npm run test:trotan`: 35/35 pass. `tests/trotan/e2e.mjs`: 17/17 pass. `tests/trotan/raster.e2e.mjs`: pass. |

### Features that must stay unchanged
- Laser production: the 15-step workflow, approved-settings safety rules, queue, KORTANA reservations, the virtual laser, machine bed files and job sheets.
- Precision: geometry in mm with exact Béziers.
- The `.trotan` format and revisions: existing projects must open unchanged.

### Rollback
- Every change is committed to the `nucleus` branch first.
- Before each publish, the live version is kept on a `backup/pre-…` branch and the database is copied to a `backup_…` schema.
- Regression suites are listed in `REGRESSION_TESTS.md`.

## How the design side grows without breaking the laser side
The design workspace and the laser workspaces already share **one `Doc`**: PREPARE reads the same objects DESIGN edits, with nothing exported or imported between them. TROTAN 2.0 keeps that rule:

1. **Same object model, extended.** New design properties live on the existing objects:
   - fill and outline paint;
   - live text attributes;
   - effects as parameters (contour, blend, envelope, PowerClip-style containers);
   - pages.

   The laser side keeps reading geometry through `paths(obj)`, so an edited letter changes the cut path immediately.
2. **Appearance is not process.** The laser operation stays on layers and objects (`op`), never inferred from appearance:
   - a drop shadow or gradient never becomes a cut;
   - colour-to-process mapping (for example red → cut) is an explicit, editable table, applied only when asked.
3. **Effects become manufacturable geometry only when needed.** Effects stay parametric in the document. PREPARE expands them to explicit paths for the toolpath, and tells the user when an effect has no cuttable meaning.
4. **Document v2 with migration.** Pages, paints and text attributes need `version: 2`. v1 files are migrated on open (one page, layer colours as outline paint). v2 files are refused by older builds with a clear message, as today.

## External files: SK Suite file-format SDK
TROTAN now detects files with the shared SDK in `packages/sk-formats`. See that package's `docs/SK_FILE_INTEROPERABILITY.md`.
- `editor/io.ts` calls `detect()` on the file's bytes and picks the importer from the detected format, never from the name.
- Recognised but unsupported formats (CDR, CMX, PDF, AI, EPS, DWG, TIFF, PSD, HPGL) get a precise message with the detected version. Nothing is imported.
- Imports that skip content show a review dialog before anything is added (`import.e2e.mjs`).
