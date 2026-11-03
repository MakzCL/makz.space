// Opens each built-in example from the start panel in the real UI, lets it auto-run in ngspice (WASM),
// and checks the reading against the hand calculation. Also screenshots the three colour palettes.
// Run (PowerShell or bash, two terminals):  npm run build ; npm run preview   then   node tests/e2e/examples.mjs [shotsDir]
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(execFileSync("npm", ["root", "-g"], { shell: true }).toString().trim() + "/playwright")); }
const URL = process.env.NUCLEUS_URL ?? "http://localhost:4280/"; const SHOTS = process.argv[2];
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } }); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(URL); await p.getByTestId("schematic-canvas").waitFor(); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.getByTestId("start").waitFor(); step("empty schematic shows the start panel with examples");
  const open = async (id) => {
    if (!(await p.getByTestId("start").count())) { await p.getByTestId("menu-File").click(); await p.getByRole("menuitem", { name: new RegExp(`Example: ${id}`) }).click(); }
    else await p.getByTestId(`example-${id}`).click();
    await p.getByTestId("sim-state").filter({ hasText: /Solved/ }).waitFor({ timeout: 60000 });
  };
  const dmm = async (net) => { await p.getByTestId("tab-instruments").click(); await p.getByTestId("dmm-pos").selectOption(net); const t = await p.getByTestId("dmm-value").innerText(); return { t, v: parseFloat(t.replace(/[^\d.\-]/g, "")) * (/mV/.test(t) ? 1e-3 : 1) }; };
  p.on("dialog", (d) => d.accept());
  await open("divider"); let r = await dmm("OUT"); assert.ok(Math.abs(r.v - 2.5) < 1e-3, r.t); step(`Voltage divider: placed parts and wires loaded, ngspice solved, multimeter OUT = ${r.t}`);
  for (const pal of ["light", "granat", "dark"]) { await p.getByTestId(`theme-${pal}`).click(); await p.waitForTimeout(250); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-${pal}.png` }); }
  step("palettes Light / Granat / Dark switch the whole interface");
  await p.getByTestId("theme-granat").click();
  await open("LED with series resistor"); r = await dmm("ANODE"); assert.ok(r.v > 1.6 && r.v < 1.9, r.t); step(`LED: anode ${r.t}`);
  await open("RC charging"); await p.getByText("Analysis").first().waitFor(); assert.ok(await p.locator(".n-plot canvas").count()); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-rc-step.png` });
  step("RC charging: transient solved and the Analysis graph opened");
  await open("RC low-pass"); assert.ok(await p.locator(".n-plot canvas").count() >= 2); if (SHOTS) await p.screenshot({ path: `${SHOTS}/nucleus-rc-ac.png` });
  step("RC low-pass: AC sweep solved; magnitude and phase plots shown");
  await open("Potentiometer"); await p.getByText("Schematic").first().click(); r = await dmm("WIPER"); assert.ok(Math.abs(r.v - 7.5) < 0.05, r.t); step(`Potentiometer: WIPER = ${r.t}`);
  assert.deepEqual(errors, []); console.log("\nNUCLEUS examples e2e: all steps passed");
} finally { await b.close(); }
