# Import / export tests

## `npm test` in `packages/sk-formats`
53 tests, all passing (2026-11-12): 38 for detection, 11 for the CorelDRAW reader (`tests/cdr.test.ts`) and 4 for the DEFLATE decoder (`tests/inflate.test.ts`, checked against Node's zlib). Fixture origins are listed in `tests/fixtures/README.md`; synthetic header-only files are marked there.

| Fixture | Expected | Result |
|---|---|---|
| Real CorelDRAW X5 file (stored and deflate variants) | `cdr`, "CDR 15 (CorelDRAW X5)", version read from inside the ZIP | pass |
| The same file with no decompressor available | still `cdr`; version read because the stream is stored. The deflated copy gives no version and a note | pass |
| Corrupt `.cdr` (not a CDR stream) | `unknown`, never called CDR | pass |
| Real CMX | `cmx`, "CMX 1 (32-bit)" | pass |
| PNG, JPEG, GIF, BMP, TIFF, WebP (real) | each identified; GIF/TIFF/WebP variants reported | pass |
| PNG renamed `.cdr` | `png` with `extensionMismatch` | pass |
| PDF 1.7; PDF-based AI 1.6; PostScript AI; EPSF 3.0 | `pdf`, `ai`, `ai`, `eps` with versions | pass |
| SVG 1.1; SVGZ | `svg` "1.1"; `svgz` | pass |
| DXF R12 (CADRA); DXF R2018 (ezdxf) | `dxf` with "AutoCAD 2018 (AC1032)" for the R2018 file | pass |
| DWG header AC1032 (synthetic) | `dwg` "AutoCAD 2018 (AC1032)" | pass |
| STEP AP214, IGES, ASCII STL, binary STL (1 triangle), 3MF, XLSX | each identified | pass |
| OLE header named `.sldprt` (synthetic) | `ole-cad`, payload marked proprietary | pass |
| HPGL, CSV, TROTAN / NUCLEUS / CADRA project JSON | each identified | pass |
| Random bytes; random bytes named `.dsn` | `unknown`; `proteus-legacy` by name only (`basis: extension`) | pass |
| Routing | SVG → TROTAN; DXF → CADRA (TROTAN also reads it); CDR → TROTAN (partial import); CMX recognised with no reader yet; unknown → nowhere | pass |
| Evidence | every adapter above "unsupported" lists its tests, or declares itself untested | pass |

## CorelDRAW reader against libcdr
On 80 real CorelDRAW 5–X5 files, 781 of 781 shapes match libcdr in position and size. All 106 ordinary solid fills and all 686 outlines match too. Method and per-version table: `CDR_IMPORT_VERIFICATION.md`.

## TROTAN in the browser: `factory/tests/trotan/import.e2e.mjs`
9 / 9 steps pass, including:
- importing the real X5 file at 184.63 × 179.20 mm;
- refusing a CorelDRAW 3 file.

See `factory/docs/trotan/REGRESSION_TESTS.md`.

## Still missing (needed before claiming more)
- Real CorelDRAW files from X6 to 2024 (and CorelDRAW 4). See `SK_FILE_INTEROPERABILITY.md`.
- Real DWG, Illustrator, PSD and SolidWorks/Inventor files. The current ones are header-only and test detection, not import.
- Comparison metrics for text and bitmaps, once those are imported.
