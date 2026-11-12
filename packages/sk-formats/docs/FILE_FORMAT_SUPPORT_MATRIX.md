# File format support matrix

Generated from `src/adapters.ts` by `node --experimental-strip-types scripts/matrix.ts`. Do not edit by hand.

Each level is a claim backed by the tests listed in its row. "Unsupported" rows are formats SK Suite **recognises** by content (with their version), so the user gets a precise answer instead of a guess.

| App | Format | Detected as | Read | Write | Versions verified | Limits | Evidence |
|---|---|---|---|---|---|---|---|
| TROTAN | SVG / SVGZ | svg, svgz | Verified round-trip (defined features and versions) | Verified round-trip (defined features and versions) | SVG 1.1 / 2 geometry | Each skipped element type is counted in the import notes Not kept: text elements (skipped and reported; convert to outlines first); linked images (skipped and reported); clip paths, masks, patterns, gradients, filters, markers (not applied) | factory/tests/trotan/geom.test.ts: SVG import keeps real size…; SVG export → import round trip<br>factory/tests/trotan/e2e.mjs step 3<br>factory/tests/trotan/import.e2e.mjs (SVGZ; review of skipped text) |
| TROTAN | DXF (ASCII) | dxf | Verified round-trip (defined features and versions) | Verified round-trip (defined features and versions) | R12–2018 ASCII | Binary DXF is not read Not kept: TEXT/MTEXT; DIMENSION; HATCH; SOLID; POINT (all skipped and reported) | factory/tests/trotan/geom.test.ts: DXF import: units, bulges, circles…; export → import round trip |
| TROTAN | Raster images | png, jpeg, bmp, gif, webp | Partial editable import | Unsupported | PNG, GIF, WebP (tested) | JPEG and BMP use the browser's decoder and are not covered by an automated test yet Not kept: embedded DPI; colour profiles; animation (first GIF frame only) | factory/tests/trotan/raster.e2e.mjs (PNG)<br>factory/tests/trotan/import.e2e.mjs (GIF, WebP, renamed PNG) |
| TROTAN | TROTAN project | trotan-project | Verified round-trip (defined features and versions) | Verified round-trip (defined features and versions) | format trotan v1 | — | factory/tests/trotan/geom.test.ts: project file: versioned, validated<br>factory/tests/trotan/e2e.mjs step 7 |
| TROTAN | CorelDRAW CDR / CDT | cdr, cdt | Unsupported | Unsupported | — | Recognised with its version. Geometry import is the next milestone (see docs/SK_FILE_INTEROPERABILITY.md). | — |
| TROTAN | Corel CMX | cmx | Unsupported | Unsupported | — | Recognised. Import planned with CDR. | — |
| TROTAN | PDF / PDF-based Illustrator | pdf, ai | Unsupported | Unsupported | — | Recognised with its version. Vector import planned (needs a PDF content-stream interpreter). | — |
| TROTAN | EPS / PostScript Illustrator | eps | Unsupported | Unsupported | — | Recognised. Needs a PostScript interpreter; not planned in-browser. | — |
| TROTAN | TIFF | tiff | Unsupported | Unsupported | — | Recognised. Browsers cannot decode TIFF; needs a TIFF decoder. | — |
| TROTAN | Photoshop PSD | psd | Unsupported | Unsupported | — | Recognised. Layered PSD import is an advanced, later feature. | — |
| TROTAN | HPGL / PLT | hpgl | Unsupported | Unsupported | — | Recognised by content. Import planned (simple pen-plot commands). | — |
| TROTAN | DWG | dwg | Unsupported | Unsupported | — | Recognised with its release. Needs a licensed DWG library (ODA or RealDWG). | — |
| CADRA | DXF (ASCII) | dxf | Verified round-trip (defined features and versions) | Verified round-trip (defined features and versions) | writes R12 (AC1009); reads R12–R2018 ASCII | Binary DXF is not read Not kept: splines; bulges in LWPOLYLINE (drawn straight, reported); angular/ordinate dimensions; 3D entities | cadra/tests/dxf.test.ts<br>cadra/tests/blocks.test.ts<br>cadra/tests/tools/check_dxf.py (ezdxf, 0 errors)<br>cadra/tests/e2e/draft.mjs |
| CADRA | CADRA drawing | cadra-drawing | Verified round-trip (defined features and versions) | Verified round-trip (defined features and versions) | format cadra v1 | — | cadra/tests/dxf.test.ts: native format |
| CADRA | DWG | dwg | Unsupported | Unsupported | — | Needs a licensed DWG SDK (ODA Drawings SDK or Autodesk RealDWG). A DXF parser is not DWG support. | — |
| CADRA | STEP / IGES | step, iges | Unsupported | Unsupported | — | Needs a B-rep kernel (Open CASCADE). Planned with CADRA solid modelling. | — |
| CADRA | STL / 3MF | stl, stl-binary, 3mf | Unsupported | Unsupported | — | Planned with the CADRA 3D viewport. | — |
| CADRA | SolidWorks / Inventor / Fusion | ole-cad, f3d | Unsupported | Unsupported | — | Proprietary parametric formats. Even with a licensed reader, the feature tree would not be reconstructed — only solid bodies. | — |
| NUCLEUS | NUCLEUS project | nucleus-project | Verified round-trip (defined features and versions) | Verified round-trip (defined features and versions) | schema 1 | — | nucleus/tests/core.test.ts (round-trip, tamper)<br>nucleus/tests/e2e/pcb.mjs step 9 |
| NUCLEUS | Proteus DSN / LYT / PDSPRJ | proteus-legacy, proteus-project | Unsupported | Unsupported | — | Undocumented proprietary formats with no authorised parser. Migration path: export a netlist or Gerber from Proteus. Gerber is manufacturing artwork, not an editable project. | — |
| KORTANA | CSV (stock import, report exports) | csv | Partial editable import | Partial editable import | — | Implemented in Inventory import and report exports; not covered by an automated test yet Not kept: schema validation report; duplicate detection report | — |
| KORTANA | Excel XLSX | xlsx | Unsupported | Unsupported | — | Recognised. Needs an XLSX reader. | — |
