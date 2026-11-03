// PCB end to end in the real UI: example → board → autoroute → DRC clean → rip-up and hand-route a connection →
// move + undo → Gerber/drill/pick-and-place zip checked by gerbonara → save → reopen with the board intact.
// Run: npm run build ; npm run preview   then   node tests/e2e/pcb.mjs [shotsDir]
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(execFileSync("npm", ["root", "-g"], { shell: true }).toString().trim() + "/playwright")); }
const URL = process.env.NUCLEUS_URL ?? "http://localhost:4280/"; const SHOTS = process.argv[2];
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`); const shot = async (p, name) => SHOTS && p.screenshot({ path: `${SHOTS}/pcb-${String(n).padStart(2, "0")}-${name}.png` });
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 960 }, acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept().catch(() => {}));
  await p.goto(URL); await p.getByTestId("schematic-canvas").waitFor(); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.getByTestId("example-led-pcb").click(); await p.getByTestId("sim-state").filter({ hasText: /Solved/ }).waitFor({ timeout: 60000 });
  step("LED board example opened and simulated (ngspice)");
  await p.getByTestId("menu-PCB").click(); await p.getByRole("menuitem", { name: "Open PCB layout" }).click();
  const status = p.getByTestId("pcb-status"); await status.filter({ hasText: "8 connections to route" }).waitFor();
  step("PCB tab: 5 parts on the board, ratsnest shows 8 connections to route"); await shot(p, "placed");
  await p.getByTestId("pcb-autoroute").click(); await status.filter({ hasText: "All connections routed" }).waitFor({ timeout: 60000 });
  step(`autorouter routed everything (${(await status.innerText()).split("\n")[0]})`);
  await p.getByTestId("pcb-drc").click(); const drcHead = p.locator(".n-pcb-side h4", { hasText: "Design rules" });
  await drcHead.filter({ hasText: "clean" }).waitFor(); step("DRC: no errors"); await shot(p, "routed");
  // rip up and route one connection by hand: R1 pad 2 → D1 pad 1 (net LED_A)
  await p.getByTestId("menu-PCB").click(); await p.getByRole("menuitem", { name: "Remove all tracks and vias" }).click();
  await status.filter({ hasText: "8 connections to route" }).waitFor();
  await p.getByTestId("pcb-tool-route").click();
  const a = await p.evaluate(() => window.__nucleusPcb.pad("R1", "2")), c = await p.evaluate(() => window.__nucleusPcb.pad("D1", "1"));
  await p.mouse.click(a[0], a[1]); await p.mouse.move(c[0], c[1]); await p.mouse.click(c[0], c[1]);
  await status.filter({ hasText: "7 connections to route" }).waitFor();
  await p.getByTestId("pcb-drc").click(); const items = await p.getByTestId("pcb-drc-list").locator("li").allInnerTexts();
  assert.ok(!items.some((t) => /Short|Clearance/.test(t)), items.join("\n")); step("hand-routed R1.2 → D1.1: one connection fewer, no shorts or clearance errors");
  // move a part, then undo
  await p.getByTestId("pcb-tool-select").click(); const before = await p.evaluate(() => window.__nucleusPcb.part("C1"));
  await p.mouse.move(before[0], before[1]); await p.mouse.down(); await p.mouse.move(before[0] + 60, before[1] + 10, { steps: 6 }); await p.mouse.up();
  const after = await p.evaluate(() => window.__nucleusPcb.part("C1")); assert.notEqual(after[2], before[2]);
  await p.keyboard.press("Control+z"); const undone = await p.evaluate(() => window.__nucleusPcb.part("C1")); assert.equal(undone[2], before[2]);
  step("moved C1 on the board, undo put it back");
  // autoroute again and export
  await p.getByTestId("pcb-autoroute").click(); await status.filter({ hasText: "All connections routed" }).waitFor({ timeout: 60000 });
  await p.getByTestId("pcb-add-zone").click(); await p.getByTestId("zone-net").selectOption("GND"); await p.getByTestId("zone-layer").selectOption("B.Cu"); await p.getByTestId("zone-add").click();
  await p.locator(".n-zone").filter({ hasText: "GND" }).waitFor(); await p.getByTestId("pcb-drc").click(); await drcHead.filter({ hasText: "clean" }).waitFor();
  step(`added a GND copper pour on the bottom (${(await p.locator(".n-zone small").innerText())}); DRC still clean`); await shot(p, "pour");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByTestId("pcb-export").click()]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nuc-fab-e2e-")); const zipPath = path.join(dir, "fab.zip"); await dl.saveAs(zipPath); execFileSync("unzip", ["-q", zipPath, "-d", dir]);
  const names = fs.readdirSync(dir).filter((f) => f !== "fab.zip").sort();
  for (const f of ["F_Cu.gbr", "B_Cu.gbr", "F_Mask.gbr", "B_Mask.gbr", "F_Silkscreen.gbr", "Edge_Cuts.gbr", "PTH.drl", "pos.csv"]) assert.ok(names.some((x) => x.endsWith(f)), `${f} in ${names}`);
  const chk = JSON.parse(execFileSync("/opt/nuc-venv/bin/python", [path.resolve("tests/tools/check_fab.py"), dir], { encoding: "utf8" }));
  const fcu = Object.entries(chk).find(([k]) => k.endsWith("F_Cu.gbr"))[1], drl = Object.entries(chk).find(([k]) => k.endsWith("PTH.drl"))[1];
  const vias = Number(/(\d+) vias?\b/.exec(await status.innerText())[1]); // through-hole pads: J1 2 + D1 2 + SW1 4 = 8; SMD on top: R1 2 + C1 2
  const bcu = Object.entries(chk).find(([k]) => k.endsWith("B_Cu.gbr"))[1]; assert.ok(bcu.dark_regions >= 1, JSON.stringify(bcu));
  assert.equal(drl.hits, 8 + vias, JSON.stringify(drl)); assert.equal(fcu.flashes, 8 + 4 + vias, JSON.stringify(fcu)); assert.ok(fcu.lines > 3);
  step(`exported ${names.length} manufacturing files; gerbonara reads them (${fcu.flashes} top pads/vias, ${fcu.lines} top tracks, ${drl.hits} drill hits)`);
  // save and reopen
  const [sv] = await Promise.all([p.waitForEvent("download"), p.keyboard.press("Control+s")]); const proj = path.join(dir, "board.nucleus"); await sv.saveAs(proj);
  const q = await ctx.newPage(); await q.goto(URL); await q.getByTestId("schematic-canvas").waitFor();
  await q.locator("input[type=file]").first().setInputFiles(proj).catch(async () => {
    const [fc] = await Promise.all([q.waitForEvent("filechooser"), (async () => { await q.getByTestId("menu-File").click(); await q.getByRole("menuitem", { name: /^Open/ }).click(); })()]); await fc.setFiles(proj); });
  await q.getByTestId("menu-PCB").click(); await q.getByRole("menuitem", { name: "Open PCB layout" }).click();
  await q.getByTestId("pcb-status").filter({ hasText: "All connections routed" }).waitFor();
  step("saved, reopened in a fresh window: the routed board is intact");
  assert.deepEqual(errors, []); console.log("\nNUCLEUS PCB e2e: all steps passed");
} finally { await b.close(); }
