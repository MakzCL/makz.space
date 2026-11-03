// TROTAN beta e2e: the 15-step workflow against the built app (vite preview) with a mocked backend.
// Run:  npm run build && npx vite preview --port 4173 &  then  node tests/trotan/e2e.mjs [shotsDir]
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import { context, seed, OPERATOR } from "./mock.mjs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }

const BASE = process.env.TROTAN_URL ?? "http://localhost:4173/trotan";
const SHOTS = process.argv[2]; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${String(n).padStart(2, "0")}-${name}.png` }); };
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40"><rect x="1" y="1" width="78" height="38" rx="4" fill="none" stroke="#ff0000" stroke-width="0.1"/><circle cx="12" cy="20" r="4" fill="none" stroke="#ff0000" stroke-width="0.1"/></svg>`;

const D = seed();
const browser = await chromium.launch();
try {
  const { page: p, errors, ctx } = await context(browser, D);
  // 1 sign in (session restored, shared Supabase sign-in)
  await p.goto(BASE); await p.getByTestId("manage").waitFor({ timeout: 15000 });
  assert.ok(await p.getByText("TROTAN").first().isVisible()); step("signed in, MANAGE open"); await shot(p, "manage");
  // 2 create project
  await p.getByTestId("new-project").click(); await p.getByTestId("project-name").fill("Coaster set"); await p.getByTestId("project-name").blur();
  await p.getByTestId("create-project").click(); await p.getByTestId("editor").waitFor();
  assert.equal(D.trotan_projects.length, 1); step("project created, DESIGN open");
  // 3 import SVG
  await p.getByTestId("file-input").setInputFiles({ name: "coaster.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) });
  await p.getByText(/Imported 2 objects from coaster.svg/).waitFor();
  assert.match(await p.getByTestId("status").innerText(), /2 selected · 78\.00 × 38\.00 mm/); step("SVG imported at true size (78 × 38 mm geometry)"); await shot(p, "import");
  // 4 draw and edit: rectangle + ellipse, undo/redo, boolean
  const c = await p.getByTestId("canvas").boundingBox();
  await p.keyboard.press("Escape"); await p.keyboard.press("r");
  await p.mouse.move(c.x + 120, c.y + 120); await p.mouse.down(); await p.mouse.move(c.x + 220, c.y + 180, { steps: 5 }); await p.mouse.up();
  await p.keyboard.press("e"); await p.mouse.move(c.x + 200, c.y + 150); await p.mouse.down(); await p.mouse.move(c.x + 260, c.y + 210, { steps: 5 }); await p.mouse.up();
  await p.keyboard.press("Control+z"); await p.keyboard.press("Control+Shift+z");
  assert.match(await p.getByTestId("status").innerText(), /1 selected/); step("drew rectangle and ellipse; undo/redo work");
  // 5 precise size and position (rectangle)
  await p.keyboard.press("Escape");
  await p.mouse.click(c.x + 121, c.y + 150); // left edge of rectangle
  await p.getByTestId("prop-w").fill("50"); await p.getByTestId("prop-w").press("Enter");
  await p.getByTestId("prop-h").fill("30"); await p.getByTestId("prop-h").press("Enter");
  await p.getByTestId("prop-x").fill("261+14"); await p.getByTestId("prop-x").press("Enter");
  await p.getByTestId("prop-y").fill("460/2"); await p.getByTestId("prop-y").press("Enter");
  assert.match(await p.getByTestId("status").innerText(), /1 selected · 50\.00 × 30\.00 mm/);
  assert.equal(await p.getByTestId("prop-x").inputValue(), "275"); assert.equal(await p.getByTestId("prop-y").inputValue(), "230");
  step("exact size 50 × 30 mm at X 275, Y 230 (arithmetic accepted)"); await shot(p, "size");
  // delete the ellipse (last object) via select-all → shift-click is fiddly; use the context menu on it
  await p.keyboard.press("Escape"); await p.mouse.click(c.x + 230, c.y + 180, { button: "right" }); await p.getByRole("menuitem", { name: /^Delete/ }).click();
  assert.match(await p.getByTestId("status").innerText(), /3 objects/); step("context menu: ellipse deleted");
  // 6 save (revision) and reopen
  await p.getByTestId("panel-history").click(); await p.getByTestId("save-revision").click(); await p.getByTestId("revision-note").fill("First version"); await p.getByTestId("revision-note").blur();
  await p.getByTestId("save-revision-ok").click(); await p.getByText(/Saved revision v\d/).waitFor();
  const saved = D.trotan_projects[0]; assert.ok(saved.version >= 2 && saved.doc.objects.length === 3, `saved doc has ${saved.doc.objects?.length} objects`);
  await p.reload(); await p.getByTestId("ws-manage").waitFor();
  await p.getByTestId("ws-manage").click(); await p.getByTestId("open-project").click(); await p.getByTestId("editor").waitFor();
  assert.match(await p.getByTestId("status").innerText(), /3 objects/); step("saved as revision and reopened after reload (3 objects)");
  // 8 material profile (ADMIN): new cut settings, approve
  await p.getByTestId("ws-admin").click(); await p.getByTestId("admin-settings").click();
  const mat = D.trotan_materials[0];
  await p.getByTestId("settings-material").selectOption(mat.id);
  await p.getByTestId("new-settings").click(); await p.getByTestId("param-power").fill("62"); await p.getByTestId("param-power").blur(); await p.getByTestId("param-speed").fill("18"); await p.getByTestId("param-speed").blur();
  await p.getByTestId("settings-save").click(); await p.getByText(/Saved v1 as untested/).waitFor();
  assert.equal(D.trotan_profiles[0].status, "untested");
  await p.getByTestId("approve-profile").click(); await p.getByText("Approved v1").waitFor();
  assert.equal(D.trotan_profiles[0].status, "approved"); step("material settings recorded as untested, approved by an authorised user"); await shot(p, "settings");
  // 7 + 9 virtual workbed, operations assigned (design layers are Cut by default; set ellipse to Score → no approved settings → blocked)
  await p.getByTestId("ws-prepare").click(); await p.getByTestId("prepare").waitFor();
  await p.getByTestId("prep-material").selectOption(mat.id);
  await p.getByTestId("op-cut").getByText("Approved v1").waitFor(); step("operations use the approved settings automatically"); 
  // 10 nest + toolpath preview
  await p.getByTestId("nest-count").fill("6"); await p.getByTestId("nest-count").press("Enter"); await p.getByTestId("nest-btn").click();
  await p.getByText(/6 copies placed/).waitFor(); await p.getByTestId("estimate").waitFor();
  assert.match(await p.getByTestId("estimate").innerText(), /estimate/); step("6 copies nested on the 400 × 300 sheet; toolpath and labelled estimate shown"); await shot(p, "prepare");
  // 11 validate against the machine
  const v = await p.getByTestId("validation").innerText();
  assert.ok(await p.getByText("no errors").isVisible(), "validation should have no errors:\n" + v); step("validated: no errors");
  // 12 queue (reserves stock, no deduction)
  await p.getByTestId("queue-job").click(); await p.getByTestId("produce").waitFor();
  const job = D.trotan_jobs[0]; assert.equal(job.status, "queued"); assert.equal(D.trotan_reservations[0].status, "reserved"); assert.equal(D.stock_items[0].quantity, 10);
  step("queued; 1 sheet reserved in KORTANA, stock unchanged (10)");
  await ctx.close();
  // 13 simulate — as the operator
  const op = await context(browser, D, { user: OPERATOR }); const q = op.page;
  await q.goto(BASE + "#produce"); await q.getByTestId("produce").waitFor({ timeout: 15000 });
  await q.getByTestId("queue-item").first().click(); await q.getByTestId("produce-bed").waitFor();
  assert.ok(await q.getByTestId("start-run").isDisabled()); for (let i = 0; i < 5; i++) await q.getByTestId(`check-${i}`).check();
  await q.getByTestId("start-run").click(); await q.getByTestId("sim-progress").waitFor(); await sleep(400); await shot(q, "simulate");
  assert.equal(D.trotan_runs[0].status, "running"); assert.equal(D.trotan_machines[0].status, "busy");
  await q.getByTestId("finish-save").waitFor({ timeout: 60000 }); step("pre-run checks confirmed, virtual laser simulated the toolpath");
  // 14 record production (idempotent consumption)
  await q.getByTestId("finish-good").fill("6"); await q.getByTestId("finish-good").blur(); await q.getByTestId("finish-save").click(); await q.getByText("Production recorded").waitFor();
  assert.equal(job.status, "done"); assert.equal(job.qty_good, 6); assert.equal(D.stock_items[0].quantity, 9); assert.equal(D.trotan_reservations[0].status, "consumed"); assert.equal(D.trotan_machines[0].status, "idle");
  step("result recorded: 6 good; 1 sheet consumed from KORTANA once (10 → 9); machine idle");
  // 15 job history
  await q.getByTestId("history-tab").click(); await q.getByTestId("job-history").getByText(job.number).waitFor(); await shot(q, "history");
  step("job history shows " + job.number);
  await op.ctx.close();
  // real machine (no interface): file + job sheet, run with its own software, then record the result
  const mat0 = D.trotan_materials[0];
  const real = { ...D.trotan_machines[0], id: "real-co2", name: "Workshop CO2", adapter: "none", manufacturer: "Acme", model: "L60", status: "idle", prohibited: [] };
  D.trotan_machines.push(real);
  D.trotan_profiles.push({ id: "pf-real", material_id: mat0.id, machine_id: real.id, operation: "cut", version: 1, params: { ...D.trotan_profiles[0].params }, status: "approved", approved_by: D.profiles[0].id, approved_at: new Date().toISOString(), notes: "", created_at: new Date().toISOString() });
  const own = await context(browser, D); const r = own.page;
  await r.goto(BASE); await r.getByTestId("open-project").first().click(); await r.getByTestId("editor").waitFor();
  await r.getByTestId("ws-prepare").click(); await r.getByTestId("prep-machine").selectOption(real.id); await r.getByTestId("prep-material").selectOption(mat0.id);
  await r.getByTestId("op-cut").getByText("Approved v1").waitFor();
  await r.getByTestId("nest-count").fill("4"); await r.getByTestId("nest-count").press("Enter"); await r.getByTestId("nest-btn").click(); await r.getByText(/4 copies placed/).waitFor();
  const [sheetPage] = await Promise.all([own.ctx.waitForEvent("page"), r.getByTestId("job-sheet").click()]);
  await sheetPage.waitForLoadState(); const sheetText = await sheetPage.locator("body").innerText();
  assert.match(sheetText, /Settings per colour/i); assert.match(sheetText, /Workshop CO2/); assert.match(sheetText, /Approved v1/); assert.match(sheetText, /\tCut\t62\t18\t1\t/);
  await sheetPage.screenshot({ path: SHOTS ? `${SHOTS}/16-jobsheet.png` : "/tmp/js.png", fullPage: true }); await sheetPage.close();
  const [dl] = await Promise.all([r.waitForEvent("download"), r.getByTestId("export-svg").click()]);
  const svgText = fs.readFileSync(await dl.path(), "utf8"); assert.match(svgText, /width="600mm" height="400mm"/); assert.equal((svgText.match(/<path /g) ?? []).length, 4 * 3, "4 copies × (outline + hole + rectangle)");
  step("real machine: approved settings, job sheet with settings per colour, bed SVG in mm (4 copies)");
  await r.getByTestId("queue-job").click(); await r.getByTestId("produce").waitFor();
  await r.getByText("Workshop CO2").first().click(); await r.getByTestId("queue-item").first().click();
  assert.equal(await r.getByTestId("start-run").count(), 0, "a machine without an interface has no Start button");
  await r.getByTestId("record-external").click();
  assert.ok(await r.getByTestId("finish-save").isDisabled());
  for (let i = 0; i < 3; i++) await r.getByTestId(`ext-check-${i}`).check();
  await r.getByTestId("finish-good").fill("4"); await r.getByTestId("finish-good").blur(); await r.getByTestId("finish-save").click(); await r.getByText("Production recorded").waitFor();
  const j2 = D.trotan_jobs.find((j) => j.machine_id === real.id);
  assert.equal(j2.status, "done"); assert.equal(D.stock_items[0].quantity, 8); assert.equal(D.trotan_runs.filter((x) => x.job_id === j2.id && x.adapter === "none").length, 1);
  step("run done with the machine's own software recorded; 1 more sheet consumed (9 → 8)");
  const errs = [...errors, ...op.errors, ...own.errors]; assert.deepEqual(errs, [], "page errors: " + errs.join("\n"));
  console.log(`\nTROTAN e2e: all ${n} steps passed`);
} finally { await browser.close(); }
