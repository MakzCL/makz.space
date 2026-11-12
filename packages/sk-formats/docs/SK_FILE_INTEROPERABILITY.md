# SK Suite file interoperability

`packages/sk-formats` is the shared contract between SK Suite applications and foreign files. It has no runtime dependencies. Applications keep their own document models (TROTAN vectors, CADRA drawings, NUCLEUS schematics and boards); only these are shared:
- detection;
- the adapter contract;
- the import report.

## Modules

| Module | What it does |
|---|---|
| `detect.ts` | Identifies a file by **content**: magic bytes, RIFF form types, the ZIP central directory, PDF/PostScript headers, DXF `$ACADVER`, DWG `AC10xx`, STEP `FILE_SCHEMA`, binary-STL size check. It reads the **version** where the file records one. It flags a wrong extension and returns `unknown` rather than guessing. It never executes or renders content. |
| `zip.ts` | Defensive ZIP reader for container formats (modern CorelDRAW, XLSX, 3MF), with entry-count and size limits. Decompression is passed in: the browser's `DecompressionStream`, or Node's `zlib`. |
| `registry.ts` | The adapter contract: formats, read/write **support level**, versions verified, what is preserved, what is lost, limitations, and the tests behind the claim. `routeFor()` decides which application opens a file. |
| `adapters.ts` | Every adapter the applications have today, including "unsupported" ones for formats we recognise but cannot yet read. |
| `cdr.ts` | CorelDRAW reader (CorelDRAW 4 and later; verified 5 to X5). It is a TypeScript port of libcdr's parser, so this one file is **MPL-2.0**. It is not exported from `index.ts`, so applications load it only when a CorelDRAW file is opened. Results: `CDR_IMPORT_VERIFICATION.md`. |
| `inflate.ts` | DEFLATE/zlib decoder. Browser decoders drop output when a compressed stream is followed by padding, which CorelDRAW writes. |
| `cmyk-lut.ts` | CMYK → sRGB table from the public-domain GenericCMYK profile (the one libcdr uses by default). |

**Support levels** come from the specification and are listed in the generated matrix:
- unsupported;
- preview only;
- partial editable import;
- verified editable import;
- verified import and export;
- verified round-trip (for defined features and versions).

"100% compatible" is never used.

## Who uses it

| Application | Use |
|---|---|
| TROTAN | `editor/io.ts` detects every imported file. Supported formats go to their importer: SVG, DXF, images and CorelDRAW (`geom/cdr.ts` maps shapes to layers by outline colour, as SVG does). Recognised but unsupported formats get a precise message ("…is a PDF document (PDF 1.7) file…"). Imports that skip content show a review before committing. |
| SK Suite launcher | Planned. `routeFor()` gives the application per file, for file associations. |
| CADRA, NUCLEUS, Kortana | Declared in the registry. They switch to `detect()` when their next importer lands. |

## Security
- Files are untrusted. Detection reads at most a few MB of headers.
- ZIP entry counts and decompressed sizes are capped (zip bomb protection).
- Paths inside archives are never used as file paths.
- No scripts, macros, PostScript or PDF content are executed.
- Importing never starts a laser job. TROTAN's queue re-validates everything on the server.

## Technology research (2026-11-12)

| Format | Option | Findings | Decision |
|---|---|---|---|
| **CorelDRAW CDR / CDT** | **libcdr** (MPL-2.0, Document Liberation Project; used by LibreOffice and Inkscape) | Reads RIFF CDR v3+, "WL" CDR 2, and ZIP-wrapped files (`content/riffData.cdr`, or `content/root.dat` in newer files). The parser is about 4 100 lines of C++ and needs librevenge, lcms2, ICU, zlib and Boost. | **Done (2026-11-12):** `src/cdr.ts`, a TypeScript port of the core object set, MPL-2.0. On 80 real CorelDRAW 5–X5 files, 781/781 shapes match libcdr (`CDR_IMPORT_VERIFICATION.md`). **Next:** text, bitmaps, gradients; verification of X6–2024 needs real files. |
| CMX | libcdr CMX parser | Same library, different record layout. Our real CMX fixture reads as 116 paths. | Next after CDR. |
| PDF / AI (PDF-based) | pdf.js (Apache-2.0) operator lists; MuPDF (AGPL, unsuitable) | pdf.js can parse content streams into path operators in the browser. Text becomes outlines unless fonts can be mapped. | After CDR. |
| EPS / PostScript AI | Ghostscript (AGPL) | Executing PostScript is unsafe in-browser and the licence does not fit. | Not planned. Users save as PDF or SVG. |
| DWG | Open Design Alliance Drawings SDK (commercial membership); Autodesk RealDWG (commercial licence); LibreDWG (GPL-3.0) | A DXF parser is not DWG support. Commercial SDKs are the only reliable route. LibreDWG's GPL would bind the application. | Needs a licence decision by the company. Until then, DWG is recognised (with its release) and users save as DXF. |
| STEP / IGES | Open CASCADE (LGPL-2.1 with exception) through opencascade.js | Proper B-rep: topology, units, assemblies. | With CADRA's solid modelling. |
| Proteus DSN / LYT / PDSPRJ | None public | Undocumented proprietary formats with no authorised parser. Gerber is manufacturing output, not a project. | Not supported. Migration via exported netlists. |
| XLSX | SheetJS CE (Apache-2.0) | Mature reader. | When Kortana imports are extended. |

## What we need from the company
- **Real CorelDRAW files from the versions actually in use**, ideally the same simple drawing saved from each version, plus typical production files. The public corpus stops at X5 (2010). CorelDRAW X6 to 2024 are read by the same code, but they cannot be verified without your files.
- A decision on DWG (ODA membership or RealDWG), if DWG files must open directly.
