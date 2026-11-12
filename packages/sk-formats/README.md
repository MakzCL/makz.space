# @sk/formats: SK Suite file-format SDK

Shared by TROTAN, CADRA, NUCLEUS and Kortana:
- content-based detection of file formats and versions;
- the importer/exporter registry and import reports;
- a CorelDRAW reader.

It has no runtime dependencies.

```
npm test                                                   # 53 tests: detection, CorelDRAW reader, DEFLATE decoder
node --experimental-strip-types scripts/matrix.ts          # regenerate docs/FILE_FORMAT_SUPPORT_MATRIX.md
node --experimental-strip-types scripts/cdr-compare.ts DIR # compare the CorelDRAW reader with libcdr's cdr2xhtml
```

`src/cdr.ts` (CorelDRAW reader) is a port of libcdr and is **MPL-2.0**. Every other file is ordinary project code. Import it directly (`src/cdr.ts`), not from `index.ts`, so that it loads only when needed.

Docs:
- `docs/SK_FILE_INTEROPERABILITY.md`: architecture and research.
- `docs/FILE_FORMAT_SUPPORT_MATRIX.md`
- `docs/CDR_IMPORT_VERIFICATION.md`
- `docs/IMPORT_EXPORT_TESTS.md`
- `docs/DEPENDENCIES_AND_LICENSES.md`
