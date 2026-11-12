# TROTAN changelog

## 2026-11-12: TROTAN 2.0, cycle 1
- **Imports are identified by content** (SK Suite file-format SDK, `packages/sk-formats`), never by the file name. A renamed PNG is read as PNG.
- **Recognised but unsupported files** get a precise message with the detected format and version, and nothing is imported. This covers CorelDRAW CDR/CDT/CMX, PDF, Illustrator, EPS, DWG, TIFF, PSD and HPGL.
- **New formats:** SVGZ (compressed SVG), GIF and WebP.
- **Import review:** when an import has to skip content (text, linked images, unsupported CAD entities), a dialog lists exactly what will be lost before anything is added. Cancel leaves the design unchanged.
- **Documentation:** TROTAN_ARCHITECTURE (baseline audit), TROTAN_CORELDRAW_PARITY, TROTAN_LASER_FEATURES, REGRESSION_TESTS.
- **Tests:** new `tests/trotan/import.e2e.mjs` (8 steps). All existing suites still pass (35 unit, 17-step workflow, raster).
- **Bug fix:** TROTAN's runs list sorted by a column that does not exist, so every load failed (from the earlier blank-page investigation; already published).
