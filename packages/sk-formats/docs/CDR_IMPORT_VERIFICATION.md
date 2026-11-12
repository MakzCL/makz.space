# CorelDRAW import: verification

`src/cdr.ts` reads CorelDRAW files into pages, layers, groups and shapes. TROTAN converts them to editable vectors (`factory/src/trotan/geom/cdr.ts`). This page records how the reader was checked and what the results are. Last run: 2026-11-12.

## Method
- **Reference reader:** libcdr 0.1.7 (`cdr2xhtml` from libcdr-tools), the CorelDRAW reader used by LibreOffice and Inkscape. Our reader is a TypeScript port of libcdr's parser (current source), so the reference is an independent build of the same rules.
- **Test files:** the LibreOffice CorelDRAW test corpus (`cdrfuzzer_seed_corpus.zip`, 84 real files saved by CorelDRAW 1 to X5, from https://dev-www.libreoffice.org/corpus/), plus our committed X5 fixture. The corpus is used for measurement only and is **not** committed to this repository, because its files have no single stated licence.
- **Comparison (`scripts/cdr-compare.ts`):** both outputs are walked in drawing order. A shape matches when its bounding box agrees within 0.05 pt (0.002 of its size for large shapes); reference arcs and curves are sampled, so ellipses are compared by their true extent. For matched shapes it then compares the solid fill colour (exact, or within 2/255 per channel) and the outline width (within 0.01 pt).
- **Decompression:** the run uses only the built-in decoder (`src/inflate.ts`), exactly as the browser does.

Reproduce:
```
curl -O https://dev-www.libreoffice.org/corpus/cdrfuzzer_seed_corpus.zip && unzip -d corpus cdrfuzzer_seed_corpus.zip
node --experimental-strip-types scripts/cdr-compare.ts corpus tests/fixtures/corel-x5-stored.cdr
```

## Results

| Version | Files | Reference shapes | Read | Matched | Solid fills equal | Outlines equal | Not imported (counted and shown to the user) |
|---|---|---|---|---|---|---|---|
| CorelDRAW 1–2 ("WL") | 4 | 120 | refused | — | — | — | Refused with the reason |
| CorelDRAW 3 | 1 | 21 | refused | — | — | — | Refused: an early test matched only 8 of 21 shapes, so the reader does not import it at all |
| CorelDRAW 5 | 1 | 21 | 21 | 21 | 1/1 | 19/19 | — |
| CorelDRAW 7 | 23 | 56 | 51 | 51 | 5/5 | 49/49 | 23 text objects, 5 bitmaps, 1 PowerClip |
| CorelDRAW 8 | 4 | 125 | 123 | 123 | 9/9 | 114/114 | 28 text objects, 2 bitmaps |
| CorelDRAW 9 | 5 | 137 | 137 | 137 | — | 136/136 | 235 text objects, 1 OLE object |
| CorelDRAW 11 | 1 | 3 | 3 | 3 | — | 3/3 | — |
| CorelDRAW 12 | 19 | 277 | 277 | 277 | 11/11 | 274/274 | 178 text objects; 15 gradient, pattern or special fills; 3 OLE objects |
| CorelDRAW X3 | 21 | 55 | 54 | 54 | 8/8 | 54/54 | 35 text objects, 2 special fills, 1 bitmap, 1 PowerClip |
| CorelDRAW X4 | 1 | 97 | 97 | 97 | 60/97 | 19/19 | 37 spot (palette) colours |
| CorelDRAW X5 | 5 | 18 | 18 | 18 | 12/12 | 18/18 | 4 gradient fills |
| **CorelDRAW 5 to X5** | **80** | **789** | **781** | **781 (100%)** | **106/106 ordinary colours** | **686/686** | |

- Every shape we read is one that libcdr draws, in the same place, at the same size. None are invented.
- The 8 reference shapes we do not read are **bitmaps** (libcdr draws a bitmap as an image clipped to a path). Our reader counts them as skipped bitmaps.
- The 37 fills that differ are **spot (palette) colours**, such as Pantone. Converting them needs the palette tables, which are licensed. They are imported on a grey layer, and the user is told how many there are.
- **CMYK** colours go through the same public-domain GenericCMYK profile that libcdr uses by default, through a 17⁴ lookup table (`src/cmyk-lut.ts`, within 2/255 of LittleCMS). Files with their own embedded CMYK profile are flagged, because that profile is not applied yet.

## Robustness
- 2 000 randomly damaged corpus files: no crash, no hang. Each one either read or failed with a clear error. The slowest took under 2 s.
- Shapes with impossible coordinates (NaN, infinite, or larger than 1 km) are dropped and counted.
- Unit tests (`tests/cdr.test.ts`) cover:
  - the X5 fixture against libcdr's numbers;
  - stored and deflated ZIP containers;
  - compressed sections, with padding after them;
  - block-length tables;
  - truncated files;
  - the shape limit;
  - every refusal.

## Bug found by this check
Browsers' `DecompressionStream` rejects bytes after the end of a compressed stream. When it does, it **discards output it had already decoded**. CorelDRAW pads its compressed sections, so a 158-object CorelDRAW 12 drawing came into TROTAN as 3 objects, with no error. The reader now uses its own DEFLATE decoder, which stops at the end of each stream. A regression test covers this case.

## Not yet verified
- **CorelDRAW 4, and X6 to 2024.** The same code reads them, including X6's separate data streams, but no real files from these versions have been tested. This is the most important gap. Real company files are needed (see `SK_FILE_INTEROPERABILITY.md`).
- Text, bitmaps, gradients, patterns, PowerClip contents, symbols, dashes and arrowheads are not imported yet. Each is counted and listed in TROTAN's review dialog before anything is added.
