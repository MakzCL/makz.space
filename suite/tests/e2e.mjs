// SK Suite desktop e2e: hub lists the apps, palette persists, NUCLEUS opens offline in its own window and
// simulates, a web app opens in its own window (live site, or the offline page when unreachable), a second
// click switches to the open window instead of duplicating it.
// Run: npm test   (Linux CI: xvfb-run -a npm test)
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process"; import path from "node:path"; import fs from "node:fs"; import os from "node:os";
import { runExamples } from "../../nucleus/tests/e2e/examples-steps.mjs";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(execFileSync("npm", ["root", "-g"], { shell: true }).toString().trim() + "/playwright"); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const appDir = process.env.SUITE_APP_DIR ?? root; const SHOTS = process.argv[2];
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sk-suite-e2e-"));
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const launch = () => pw._electron.launch({ executablePath: require(path.join(root, "node_modules/electron")), args: [appDir, `--user-data-dir=${profile}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
const closeAll = async (app) => { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); };
let app = await launch();
try {
  const hub = await app.firstWindow(); const errors = []; hub.on("pageerror", (e) => errors.push(e.message));
  await hub.locator(".tile").first().waitFor();
  assert.equal(hub.url(), "app://hub/index.html");
  const names = await hub.locator(".tile b").allInnerTexts(); assert.deepEqual(names, ["SK Factory", "Kortana", "TROTAN", "NUCLEUS", "CADRA"]);
  step(`hub opened with ${names.join(", ")}`);
  if (SHOTS) await hub.screenshot({ path: `${SHOTS}/suite-granat.png` });
  for (const p of ["light", "dark"]) { await hub.locator(`.rail .themes button[data-p=${p}]`).click(); assert.equal(await hub.evaluate(() => document.documentElement.dataset.theme), p); if (SHOTS) await hub.screenshot({ path: `${SHOTS}/suite-${p}.png` }); }
  step("palette switch Light / Granat / Dark");

  // CADRA: bundled, offline, own window; draw by typing and check the result
  const [cad] = await Promise.all([app.waitForEvent("window"), hub.locator('.tile[data-app="cadra"]').click()]);
  await cad.getByTestId("cmdline").waitFor(); assert.match(cad.url(), /^app:\/\/cadra\//);
  await cad.evaluate(() => localStorage.clear()); await cad.reload(); await cad.getByTestId("cmdline").waitFor();
  for (const c of ["rec", "0,0", "@100,50", "c", "50,25", "20"]) { await cad.getByTestId("cmdline").fill(c); await cad.keyboard.press("Enter"); }
  assert.match(await cad.locator(".c-status").innerText(), /2 objects/); if (SHOTS) await cad.screenshot({ path: `${SHOTS}/suite-cadra.png` });
  step("CADRA opened in its own window from the bundled copy and drew a rectangle and a circle");
  await cad.close();

  // NUCLEUS: bundled, offline, own window
  const [nuc] = await Promise.all([app.waitForEvent("window"), hub.locator('.tile[data-app="nucleus"]').click()]);
  await nuc.getByTestId("schematic-canvas").waitFor(); assert.match(nuc.url(), /^app:\/\/nucleus\//);
  step("NUCLEUS opened in its own window from the bundled copy (no network)");
  await nuc.evaluate(() => localStorage.clear()); await nuc.reload(); await nuc.getByTestId("schematic-canvas").waitFor();
  await runExamples(nuc, null, (s) => step(`NUCLEUS: ${s}`));
  await hub.locator('.run').filter({ hasText: "NUCLEUS" }).waitFor(); step("hub shows NUCLEUS under “Open now”");
  const before = (await app.windows()).length; await hub.locator('.tile[data-app="nucleus"]').click(); await hub.waitForTimeout(500);
  assert.equal((await app.windows()).length, before); step("opening NUCLEUS again switches to its window instead of a second copy");

  // a web app in its own window
  const [fac] = await Promise.all([app.waitForEvent("window"), hub.locator('.tile[data-app="factory"]').click()]);
  await fac.waitForLoadState("domcontentloaded"); await fac.waitForTimeout(4000);
  const u = fac.url();
  if (u.startsWith("https://factory.makz.space")) step(`SK Factory loaded the live site in its own window (${await fac.title()})`);
  else { assert.match(u, /^app:\/\/hub\/offline\.html/); step("SK Factory unreachable from this machine: its window shows the “Can't reach the app” page with retry"); }
  if (SHOTS) await fac.screenshot({ path: `${SHOTS}/suite-factory.png` });
  assert.deepEqual(errors, []);
} finally { await closeAll(app); }

// state survives a restart
app = await launch();
try {
  const hub = await app.firstWindow(); await hub.locator(".tile").first().waitFor();
  assert.equal(await hub.evaluate(() => document.documentElement.dataset.theme), "dark");
  const recent = await hub.locator("#recent .chip span").allInnerTexts(); assert.ok(recent.includes("NUCLEUS") && recent.includes("SK Factory"), recent.join());
  step(`after restart: palette kept (Dark), recently opened: ${recent.join(", ")}`);
} finally { await closeAll(app); fs.rmSync(profile, { recursive: true, force: true }); }
console.log("\nSK Suite e2e: all steps passed");
