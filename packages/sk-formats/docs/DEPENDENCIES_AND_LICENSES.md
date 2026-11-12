# Dependencies and licences: file interoperability

## Runtime
`packages/sk-formats` has **no runtime dependencies**. It has its own DEFLATE/zlib decoder (`src/inflate.ts`). Detection may also use the platform's (`DecompressionStream` in browsers, `zlib` in Node).

| File | Licence | Origin |
|---|---|---|
| `src/cdr.ts` | **MPL-2.0** | TypeScript port of parts of libcdr (CDRParser, CommonParser, CDRContentCollector, CDRCollector, CDRTypes), © the libcdr contributors. MPL-2.0 is file-level: this file, and changes to it, must stay MPL-2.0 with source available. The rest of the application is not affected. The file header states this. |
| `src/cmyk-lut.ts` | Public domain (CC0) | Table computed with LittleCMS from the GenericCMYK profile by Graeme Gill (Argyll CMS), which is public domain. It is the profile shipped by Scribus and embedded in libcdr. |
| everything else in `packages/sk-formats` | Same as the application | Our own code. |

TROTAN's existing dependencies are unchanged: React, opentype.js (MIT), clipper-lib (Boost), the Poppins fonts (SIL OFL) and Supabase JS (MIT).

## Test-only

| Item | Licence | Use |
|---|---|---|
| libcdr-tools 0.1.7 (`cdr2xhtml`, `cmx2xhtml`) | MPL-2.0 | Independent reference reader for CorelDRAW files. Run as a separate program; not shipped. |
| LibreOffice test files `fdo65220-2.cdr`, `EDB-35217-1.cdr`, `fdo63782-1.cmx` | MPL-2.0 (LibreOffice source tree) | Detection fixtures (`tests/fixtures`), redistributed under MPL-2.0 with their origin recorded. |
| ImageMagick | ImageMagick licence | Wrote the image fixtures. |
| LibreOffice CDR corpus (`cdrfuzzer_seed_corpus.zip`) | Mixed / unstated | Measurement only (`scripts/cdr-compare.ts`); downloaded on demand, **not** committed or shipped. |
| Pillow + LittleCMS | HPND / MIT | Generated `cmyk-lut.ts` once. Not used at run time. |
| ezdxf | MIT | Wrote the R2018 DXF fixture; validates CADRA output. |

## Under evaluation (not used)
See the research table in `SK_FILE_INTEROPERABILITY.md`.

| Library | Licence | Note |
|---|---|---|
| libcdr | MPL-2.0 | **In use** as the source of the port in `src/cdr.ts` (see above). Its spot-colour palette tables are not ported, because they encode licensed palettes such as Pantone. |
| pdf.js | Apache-2.0 | Suitable. |
| Ghostscript, MuPDF | AGPL | Not suitable for a closed application. |
| LibreDWG | GPL-3.0 | Would require the application to be GPL. |
| ODA Drawings SDK, Autodesk RealDWG | Commercial | A company purchase decision. |
| Open CASCADE | LGPL-2.1 with exception | Usable as a separately replaceable module. |
| HarfBuzz (MIT), FreeType (FTL or GPL-2.0), LittleCMS (MIT) | Permissive | Candidates for typography and colour management (WASM builds). |
| Pantone libraries | Commercial | Only with a licence. |
