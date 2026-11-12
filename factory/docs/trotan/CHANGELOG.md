# TROTAN changelog

## 2026-11-12: TROTAN 2.0, cycle 2 — CorelDRAW import
- **CorelDRAW files open as editable vectors.** This covers CDR/CDT from CorelDRAW 4 onward, including the ZIP files of X4 and later and the compressed files of versions 8–12.
- **What is imported:**
  - page size, layers and groups;
  - rectangles (including rounded corners), ellipses, arcs and pies, curves, polygons and stars, with rotation, skew and mirroring;
  - outline colour and width, including named styles;
  - solid fills, with CMYK converted the way CorelDRAW-compatible readers do.
- **Layers:** outline colours become layers, exactly as for SVG (Line #rrggbb → cut; Fill #rrggbb → raster).
- **Verified:** on 80 real files from CorelDRAW 5 to X5, every imported shape (781 of 781) matches libcdr, LibreOffice's CorelDRAW reader, in position and size. All ordinary colours and outline widths match too. See `packages/sk-formats/docs/CDR_IMPORT_VERIFICATION.md`.
- **Not imported yet:** text, bitmaps, gradient/pattern fills, spot colours (Pantone etc.), PowerClip contents. The review dialog lists each with its count before anything is added. CorelDRAW 1–3 files are refused with the reason.
- **Bug fixed before release:** browsers' decompressor silently dropped data after CorelDRAW's padding, so a 158-object drawing came in as 3 objects. The SDK now has its own decompressor; a regression test covers it.
- **Licence note:** the CorelDRAW reader is a port of libcdr and is MPL-2.0. That covers one file (`packages/sk-formats/src/cdr.ts`), loaded only when a CorelDRAW file is opened.

## 2026-11-12: TROTAN 2.0, cycle 1
- **Imports are identified by content** (SK Suite file-format SDK, `packages/sk-formats`), never by the file name. A renamed PNG is read as PNG.
- **Recognised but unsupported files** get a precise message with the detected format and version, and nothing is imported. This covers CorelDRAW CDR/CDT/CMX, PDF, Illustrator, EPS, DWG, TIFF, PSD and HPGL.
- **New formats:** SVGZ (compressed SVG), GIF and WebP.
- **Import review:** when an import has to skip content (text, linked images, unsupported CAD entities), a dialog lists exactly what will be lost before anything is added. Cancel leaves the design unchanged.
- **Documentation:** TROTAN_ARCHITECTURE (baseline audit), TROTAN_CORELDRAW_PARITY, TROTAN_LASER_FEATURES, REGRESSION_TESTS.
- **Tests:** new `tests/trotan/import.e2e.mjs` (8 steps). All existing suites still pass (35 unit, 17-step workflow, raster).
- **Bug fix:** TROTAN's runs list sorted by a column that does not exist, so every load failed (from the earlier blank-page investigation; already published).
