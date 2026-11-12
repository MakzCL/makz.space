# TROTAN laser features

The full feature list, safety rules and machine adapter API are in `README.md`. This page summarises them against the TROTAN 2.0 laser requirements.

| Requirement | TROTAN | Status |
|---|---|---|
| Operations: raster, vector engrave, cut, score, mark, kiss cut, multi-pass | All seven operation types, per layer, with per-object override; passes | VERIFIED (`geom.test.ts` toolpath; e2e) |
| Material database: power, speed, frequency, passes, DPI, focus, air assist, versions and approval | Yes. A first install has no approved settings; manual settings are unverified and cannot be queued | VERIFIED (e2e steps 8–9, server rules) |
| Open-path and duplicate detection, self-intersections, tiny shapes | Yes | VERIFIED (`geom.test.ts` validation) |
| Kerf compensation, common-line cutting | Yes | VERIFIED |
| Nesting and arrays | Arrays and bounding-box nesting (true-shape nesting not built) | VERIFIED for what exists |
| Toolpath order and travel minimisation | Raster → marks → engrave → scores → kiss → cuts; holes before outlines; nearest neighbour | VERIFIED |
| Lead-in / lead-out | — | NOT STARTED |
| Bed, origin, sheet and margin, job bounds, machine checks | Yes | VERIFIED |
| Queue, pre-run checks, explicit authorisation | Yes | VERIFIED |
| Real machine control | Not built by design: no documented, authorised protocol. Real machines get a bed file and job sheet, run with the machine's own software. | NOT SUPPORTED until a validated driver exists |
| Rotary, camera positioning, print-and-cut | — | NOT STARTED |
| Importing a file never starts a job | Import only adds objects. Queuing re-validates everything on the server. | VERIFIED (import.e2e, server rules) |
