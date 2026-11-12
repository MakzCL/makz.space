# TROTAN regression tests

Run all of these after every integration. Every result below was measured on 2026-11-12 after the content-detection change, using the mocked backend (no real data).

| Suite | Command | Result |
|---|---|---|
| Geometry, actions, raster (unit) | `npm run test:trotan` | 35 / 35 pass |
| Production workflow (17 steps: sign in → project → SVG import → draw/edit → exact size → save/reopen → materials → nesting → validate → queue with KORTANA reservation → virtual run → record → history → real-machine bed file and job sheet) | `npm run build && npx vite preview --port 4173 &` then `node tests/trotan/e2e.mjs` | 17 / 17 pass |
| Raster engraving image | `node tests/trotan/raster.e2e.mjs <gradient.png>` | pass |
| Import by content, including CorelDRAW | `node tests/trotan/import.e2e.mjs` | 9 / 9 pass |
| SK Suite format SDK (detection, routing, adapter evidence, CorelDRAW reader, DEFLATE decoder) | `cd packages/sk-formats && npm test` | 53 / 53 pass |
| CorelDRAW reader against libcdr on 80 real files | `node --experimental-strip-types packages/sk-formats/scripts/cdr-compare.ts <corpus>` | 781 / 781 shapes match |

## What `import.e2e.mjs` checks
1. An SVGZ file imports at true size.
2. GIF and WebP images are placed.
3. A PNG renamed `.cdr` is read as a PNG.
4. A real CorelDRAW X5 file is imported. It gives 5 rectangles at 184.63 × 179.20 mm, matching libcdr, with their black outlines on a cut layer.
5. A CorelDRAW 3 file is refused with the reason, and the design is unchanged.
6. Random bytes named `.cdr` are refused.
7. An SVG containing text shows the review dialog listing the skipped text. Cancel leaves the design unchanged.
8. Import from the same dialog adds the shapes.
9. No page errors.
