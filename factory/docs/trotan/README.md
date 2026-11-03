# TROTAN: laser design and production

TROTAN is the third app in the Skalarki system, next to SK Factory (shop floor) and KORTANA (inventory and MRP). It is for machine operators and covers laser cutting and engraving from design to finished parts. Trotec Ruby was used as a reference for what a complete product does. TROTAN does not use Trotec's name, code, artwork or machine protocols.

- **Where:** `/trotan` on the factory site (for example `https://factory.makz.space/trotan`). Once DNS is added, it will also be at `trotan.makz.space`.
- **Code:** `factory/src/trotan/` is one lazy-loaded chunk. The other apps never download it.
- **Data:** the `trotan_*` tables in the shared Supabase project (`factory/supabase/schema.sql`, TROTAN section).
- **Sign-in and people:** the same accounts, profiles and roles as SK Factory and KORTANA.

## Workspaces

| Workspace | What it does |
|---|---|
| MANAGE | Projects: create, open, duplicate, save as template, archive. Optional link to an SK Factory job. Also job history, and material stock read from KORTANA. |
| DESIGN | Vector editor. Tools: select, nodes, pen, pencil, line, rectangle, ellipse, polygon/star, text and pan. Also exact sizes, transforms, align/distribute, groups, booleans, offset, join, break apart, layers with laser operations, geometry checks, revisions, import/export, snapping, guides, rulers, context menus and shortcuts. |
| PREPARE | Choose machine and material. Settings come from approved profiles, and manual settings are marked unverified. Place copies by single, array, nesting or dragging. Set kerf and common-line cutting. Validation, toolpath preview and a labelled time estimate. Save the job (tied to a design revision) and queue it. |
| PRODUCE | Per-machine queue with reordering, pre-run checks, a run on the virtual laser (simulation), recording results (good, scrap, time, sheets) and history. |
| ADMINISTRATION | Laser settings (versions, approval), material test cards, machines (capabilities, prohibited materials), materials (KORTANA link), access matrix, audit log and diagnostics. |

## Implementation checklist

The first beta is the 15-step workflow below. It is covered end to end by `tests/trotan/e2e.mjs`.

- [x] 1. Sign in. Shared Supabase auth; same session as the other apps.
- [x] 2. Create a project. Number `TP-xxxx`, customer, tags, template, SK Factory link.
- [x] 3. Import SVG. Real millimetres from width/height/viewBox. One layer per colour (filled → raster, stroked → cut). Notes for skipped content. Parsing runs in a Web Worker.
- [x] 4. Draw and edit. All tools listed above. Node editing: move, add (curve-preserving), delete, line↔curve, split, close/open.
- [x] 5. Precise size and position. X/Y/W/H/angle in mm. Fields accept arithmetic (`25.4*2`). Keep-proportions option.
- [x] 6. Save and reopen. Autosave after 2.5 s with an optimistic version check (no silent overwrite). Named revisions. A recovery copy is kept in the browser until the server has the save.
- [x] 7. Virtual workbed. Bed, sheet, margin, copies, toolpath, travel moves and a simulated head.
- [x] 8. Material profile. Settings start as untested; only an approver can approve them; approved settings are locked; one approved version per material, machine and operation.
- [x] 9. Assign operations: per layer, overridable per object.
- [x] 10. Preview toolpath. Order: raster, marks, vector engrave, scores, kiss cuts, then cuts. Holes before outlines, nearest-neighbour ordering, passes, kerf, common line.
- [x] 11. Validate against the machine: bed, sheet and margin, power, speed, passes, focus, frequency and DPI against the machine's capabilities, prohibited material, unverified settings, overlaps, open contours, self-intersections, tiny shapes and duplicate lines.
- [x] 12. Queue. The server re-checks status, validation, material, revision, approved settings (exact values) and stock, then reserves sheets in KORTANA. Nothing is deducted at this point.
- [x] 13. Simulate. The operator confirms the pre-run checks and the virtual laser runs the toolpath.
- [x] 14. Record production. Good, scrap, time, sheets and notes. Material is consumed from KORTANA exactly once; repeating the request does nothing.
- [x] 15. Job history.

Beyond the beta:

- [x] DXF import and export.
- [x] PNG, JPG and BMP placement, with the effective DPI shown.
- [x] PNG export at 300 DPI.
- [x] `.trotan` project file: versioned, and refuses files from a newer format.
- [x] Material test cards: a power × speed grid with per-square settings; the best square can be saved as untested settings.
- [x] Light and dark themes, resizable panel, keyboard shortcuts, context menus.
- [ ] PDF, AI, EPS and CDR import. These are shown as "not supported" in the File menu; nothing pretends to import them.
- [ ] PDF export. Shown as "not available yet".
- [ ] True-shape nesting. Nesting is currently by bounding box, and the UI says so.
- [x] Raster engraving images: brightness, contrast, gamma, invert; Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Atkinson, Sierra, ordered (Bayer 8×8), black-and-white threshold, and greyscale (power follows tone). Processed at the engraving DPI; the editor shows what will burn; the machine bed file carries the processed bitmap. Tested: dither coverage equals the tone, Bayer levels exact, resampling keeps the mean (`tests/trotan/raster.test.ts`, `tests/trotan/raster.e2e.mjs`).
- [ ] Raster time estimate from the processed lines (`rasterSeconds`: blank lines skipped, overscan per line) is implemented and tested, but the PREPARE estimate still treats rasters as filled areas.
- [x] Real machines: bed file (SVG/DXF), printable job sheet with settings per colour, and recording runs done with the machine's own software.
- [x] Access per role and per person, set in Kortana → Settings → TROTAN.
- [ ] Controlling a real machine. Not built, by design (see the adapter API below).
- [ ] Laser activity in the SK Factory job screen. The `trotan_mo_activity` view is ready; no UI shows it yet.

## Running jobs on real machines

TROTAN never controls hardware. For a machine with no validated interface (the normal case), the operator:

1. Prepares and queues the job as usual. Queuing needs approved settings for that material on that machine, and reserves the sheets in KORTANA.
2. In PRODUCE, downloads the **bed file**. The SVG has engraving fills and cut lines; the DXF is vector work only. Every copy is on it, in millimetres, in cutting order, with kerf and common-line already applied, and one colour per layer.
3. Prints the **job sheet**. It lists the exact settings to enter for each colour, who approved them and when, the material, sheet and copies, and a checklist to complete at the machine. A test job is marked as a test; colour clashes are flagged.
4. Runs the job with the machine's own software, start button and safety procedure.
5. Uses **Record the run…** to confirm three checks and enter good parts, scrap, time and sheets. The server function `trotan_record_external` writes the run and consumes the material from KORTANA once only (an idempotency key stops a repeated save counting twice). It only accepts machines that have no interface.

## Access

Access is managed in **Kortana → Settings → TROTAN**, by the Owner, a Developer or a Manager:

- Each role gets a set of sections (Manage, Design, Prepare, Produce, Administration, Approve laser settings).
- Any individual person can be given their own set, which replaces their role's. "Use role" removes it.
- Owner and Developer always have everything.
- A fresh install opens TROTAN only to Owner, Developer and Manager.
- Changes go through `set_trotan_role_access` and `set_trotan_person_access`, which only those three roles may call. Every TROTAN table and function checks access through `trotan_can` on the server.
- In SK Factory, the TROTAN link in the sidebar is only shown to people who have access.

## Precision

- Units are millimetres everywhere: documents, placements, validation and exports. The units in the UI come from one table (`UNITS` in `geom/laser.ts`).
- Geometry is stored as exact lines and cubic Béziers with affine matrices. Curves are only flattened for checks, estimates and the toolpath, with a tolerance of 0.01–0.05 mm.
- Booleans and offsets use Clipper at a scale of 10 000 (0.1 µm).
- Bounding boxes use the exact extremes of each cubic, not sampled points.
- Tests check coordinates to 1e-9 mm through transforms and SVG/DXF round trips (`tests/trotan/*.test.ts`).

## Safety rules (enforced on the server)

- TROTAN never invents laser settings. A first install has no approved settings. Manual settings are labelled "unverified" and cannot be queued. Only material tests may use unapproved settings, and only an approver can queue one.
- `trotan_queue` requires that the job's settings are **exactly** the approved ones (power, speed, frequency, passes, focus, DPI for raster, air assist). Per-layer settings are only allowed on test jobs.
- `trotan_start` needs every pre-run check confirmed and an idle machine. It refuses any machine that is not the virtual laser, so there is no hardware path at all.
- Prohibited materials are refused when queuing.
- Status changes follow a fixed state machine: draft → ready → queued → running → done/failed, plus cancel and back-to-ready. A queued, running or finished job cannot be edited.

## Machine adapter API (`geom/adapters.ts`)

```ts
interface MachineAdapter {
  info(caps): AdapterInfo;                 // name, connection, operations, which safety states it reports, submit mode
  readiness(): Promise<{ ready; checks }>; // e-stop, lid, interlocks… as reported by the machine
  run(toolpath, seconds, onProgress, signal, speedUp?): Promise<RunState>;
}
```

The only adapter is `VirtualLaser`, which simulates and never touches hardware. Real machines are recorded with `adapter = 'none'` (`NO_INTERFACE`). TROTAN prepares and exports their jobs, and the operator runs them with the manufacturer's software, start button and safety procedure.

A future hardware adapter would need all of the following:

1. A documented, authorised interface from the manufacturer.
2. A local gateway next to the machine; a browser can never start a laser on its own.
3. Readiness that comes from the machine itself.
4. Validation on that machine.
5. A server change to allow that adapter.

## Integration contracts

**KORTANA (stock)**
- `trotan_materials.stock_item_id` points at a stock item; one sheet equals one unit.
- Queuing checks free stock (on hand at real locations, minus other reservations) and creates or updates one `trotan_reservations` row per job.
- Back-to-ready and cancel release the reservation.
- `trotan_finish` consumes the used sheets once through `move_stock('consume')`, with `stock_source('trotan_job', id)` so the movement can be traced. An aborted run with no material used releases the reservation instead.

**SK Factory (jobs)**
- A project, and a job, can carry `mo_job_id` pointing to `public.jobs`.
- The read-only view `trotan_mo_activity` (security invoker, so normal access rules apply) gives each MO's laser jobs, status, quantities and times.

## Data model

| Table | Holds |
|---|---|
| `trotan_access` | Sections per role. Owner and Developer always have everything. |
| `trotan_projects` | The project and its current design (`doc` jsonb, checked to be millimetres). |
| `trotan_revisions` | Named versions of the design. |
| `trotan_machines` | Machines, with capabilities, prohibited materials and status. |
| `trotan_materials` | Materials. |
| `trotan_profiles` | Laser settings, with versions and approval. |
| `trotan_tests` | Material test cards. |
| `trotan_jobs` | Jobs, which point at a design revision. |
| `trotan_runs` | Runs; at most one running run per machine. |
| `trotan_reservations` | Stock reservations. |

Every table has row-level security and is audited, and changes are pushed to clients through realtime.

## Run locally

```bash
cd factory
npm install
npm run dev                  # then open http://localhost:5173/trotan
npm run test:trotan          # geometry and editor unit tests (29)
npm run build && npx vite preview --port 4173 &
npm run e2e:trotan           # 15-step beta workflow in Chromium, with a mocked backend
# database rules (needs local PostgreSQL 16):
cd supabase/tests && su postgres -c "dropdb --if-exists t; createdb t" && \
  su postgres -c "psql -q -d t -v ON_ERROR_STOP=1 -f ../../../supabase/tests/00-supabase-stub.sql -f ../schema.sql -f ../schema.sql -f schema.test.sql"
```

## Deploy

These steps run only when publishing is approved.

1. Back up the database to a `backup_<date>_trotan` schema, and create a restore-point branch `backup/pre-trotan-<date>` at the live commit.
2. Apply the TROTAN part of `schema.sql` to Supabase. The script can be re-run safely. Seeds are only inserted if the tables are empty: one virtual laser and seven materials, with no settings.
3. Push `main`. Cloudflare Pages (`skalarki-factory`) builds it, and TROTAN is then at `/trotan`.
4. Optional: add a `trotan` CNAME and a Pages custom domain `trotan.makz.space`. The app recognises the host automatically.
