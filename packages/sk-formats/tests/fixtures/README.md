# sk-formats test fixtures

| File | Origin |
|---|---|
| `corel-x5-stored.cdr` | Real CorelDRAW X5 (CDR 15) file, ZIP container with the drawing stream stored, from LibreOffice's libcdr test corpus (`writerperfect/qa/unit/data/draw/libcdr/pass/fdo65220-2.cdr`, MPL-2.0). libcdr 0.1.7 reads 5 paths. |
| `corel-x5-deflated.cdr` | The same entries re-zipped with deflate compression, to test detection with and without a decompressor. |
| `corrupt-not-riff.cdr` | LibreOffice "fail" test file (`EDB-35217-1.cdr`, MPL-2.0): `.cdr` extension, but the content is not a CDR stream. |
| `corel.cmx` | Real CMX file from the same corpus (`fdo63782-1.cmx`, MPL-2.0). |
| `img.*` | Real 8×8 images written by ImageMagick. `renamed-png.cdr` is the PNG with a wrong extension. |
| `r12.dxf`, `r2018.dxf` | Real DXF written by CADRA (R12) and by ezdxf (R2018). |
| `min.*`, `*.stl`, `plot.plt`, `table.csv`, project files | Small, valid hand-written files of each format. |
| `synthetic-header.dwg`, `synthetic-ole.sldprt`, `synthetic-header.psd`, `illustrator.ai`, `ps-illustrator.ai` | **Synthetic:** only the header bytes that detection reads. They test detection, not import. Real DWG/SolidWorks/PSD/Illustrator files are still needed. |
| `random.dsn`, `noise.xyz` | Random bytes: must never be identified as a real format. |
