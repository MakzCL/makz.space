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
| TROTAN | `editor/io.ts` detects every imported file. Supported formats go to their importer. Recognised but unsupported formats get a precise message ("…is a CorelDRAW drawing (CDR 15 (CorelDRAW X5)) file…"). Imports that skip content show a review before committing. |
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
| **CorelDRAW CDR / CDT** | **libcdr 0.1.9** (MPL-2.0, Document Liberation Project; used by LibreOffice and Inkscape) | Reads RIFF CDR v3+, "WL" CDR 2, and ZIP-wrapped files (`content/riffData.cdr`, or `content/root.dat` in newer files). The version is one character in the RIFF form type; our detection uses the same rule. Its NEWS still lists fixes for CDR 14 files. Coverage of 2017–2026 files must be measured on real files, not assumed. The parser is about 4 100 lines of C++ and needs librevenge, lcms2, ICU, zlib and Boost. | **Next milestone:** a TypeScript CDR reader for the core object set (pages, layers, groups, curves, rectangles, ellipses, transforms, solid fills and outlines, embedded bitmaps). It is checked object-by-object against libcdr's output (`cdr2xhtml`), which is installed in the dev environment as the reference. If any of our code is ported from libcdr, that file stays under MPL-2.0. **Alternative:** compile libcdr to WebAssembly (broader coverage, heavy build). |
| CMX | libcdr CMX parser | Same library. Our real CMX fixture reads as 116 paths. | With CDR. |
| PDF / AI (PDF-based) | pdf.js (Apache-2.0) operator lists; MuPDF (AGPL, unsuitable) | pdf.js can parse content streams into path operators in the browser. Text becomes outlines unless fonts can be mapped. | After CDR. |
| EPS / PostScript AI | Ghostscript (AGPL) | Executing PostScript is unsafe in-browser and the licence does not fit. | Not planned. Users save as PDF or SVG. |
| DWG | Open Design Alliance Drawings SDK (commercial membership); Autodesk RealDWG (commercial licence); LibreDWG (GPL-3.0) | A DXF parser is not DWG support. Commercial SDKs are the only reliable route. LibreDWG's GPL would bind the application. | Needs a licence decision by the company. Until then, DWG is recognised (with its release) and users save as DXF. |
| STEP / IGES | Open CASCADE (LGPL-2.1 with exception) through opencascade.js | Proper B-rep: topology, units, assemblies. | With CADRA's solid modelling. |
| Proteus DSN / LYT / PDSPRJ | None public | Undocumented proprietary formats with no authorised parser. Gerber is manufacturing output, not a project. | Not supported. Migration via exported netlists. |
| XLSX | SheetJS CE (Apache-2.0) | Mature reader. | When Kortana imports are extended. |

## What we need from the company
- **Real CorelDRAW files from the versions actually in use** (ideally the same simple drawing saved from each version, plus typical production files). We have only one readable CDR (X5) and one CMX from LibreOffice's public corpus, so we cannot verify 2017–2026 behaviour without your files.
- A decision on DWG (ODA membership or RealDWG), if DWG files must open directly.
