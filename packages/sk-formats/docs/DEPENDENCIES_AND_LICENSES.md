# Dependencies and licences: file interoperability

## Runtime
`packages/sk-formats` has **no runtime dependencies**. Decompression uses the platform (`DecompressionStream` in browsers, `zlib` in Node).

TROTAN's existing dependencies are unchanged: React, opentype.js (MIT), clipper-lib (Boost), the Poppins fonts (SIL OFL) and Supabase JS (MIT).

## Test-only

| Item | Licence | Use |
|---|---|---|
| libcdr-tools 0.1.7 (`cdr2xhtml`, `cmx2xhtml`) | MPL-2.0 | Independent reference reader for CorelDRAW files. Run as a separate program; not shipped. |
| LibreOffice test files `fdo65220-2.cdr`, `EDB-35217-1.cdr`, `fdo63782-1.cmx` | MPL-2.0 (LibreOffice source tree) | Detection fixtures (`tests/fixtures`), redistributed under MPL-2.0 with their origin recorded. |
| ImageMagick | ImageMagick licence | Wrote the image fixtures. |
| ezdxf | MIT | Wrote the R2018 DXF fixture; validates CADRA output. |

## Under evaluation (not used)
See the research table in `SK_FILE_INTEROPERABILITY.md`.

| Library | Licence | Note |
|---|---|---|
| libcdr | MPL-2.0 | Usable in a proprietary application. Files containing MPL code (ported or compiled) must stay MPL and their source must be available. |
| pdf.js | Apache-2.0 | Suitable. |
| Ghostscript, MuPDF | AGPL | Not suitable for a closed application. |
| LibreDWG | GPL-3.0 | Would require the application to be GPL. |
| ODA Drawings SDK, Autodesk RealDWG | Commercial | A company purchase decision. |
| Open CASCADE | LGPL-2.1 with exception | Usable as a separately replaceable module. |
| HarfBuzz (MIT), FreeType (FTL or GPL-2.0), LittleCMS (MIT) | Permissive | Candidates for typography and colour management (WASM builds). |
| Pantone libraries | Commercial | Only with a licence. |
