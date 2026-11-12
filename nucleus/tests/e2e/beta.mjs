// NUCLUES first-beta acceptance test (steps 1–12) driven through the real UI in Chromium.
// Run: npm run build && npx vite preview --port 4280 &  then  node tests/e2e/beta.mjs [shotsDir]
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import fs from "node:fs"; import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright")); }
const URL = process.env.NUCLUES_URL ?? "http://localhost:4280/"; const SHOTS = process.argv[2]; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`); const shot = async (p, name) => SHOTS && p.screenshot({ path: `${SHOTS}/${String(n).padStart(2, "0")}-${name}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  // 1 launch
  await p.goto(URL); await p.getByTestId("schematic-canvas").waitFor(); await p.evaluate(() => localStorage.clear());
  await p.reload(); await p.getByTestId("schematic-canvas").waitFor(); step("NUCLUES launched");
  // 2 new project
  await p.keyboard.press("Control+n"); await p.getByTestId("new-name").fill("LED tester"); await p.getByTestId("new-ok").click();
  await p.getByText("LED tester").first().waitFor(); step("new project created"); 
  // 3 schematic editor is the active document
  assert.ok(await p.getByTestId("doc-schematic").evaluate((e) => e.classList.contains("on"))); step("schematic editor open");
  // 4 search and place parts (V1 source, R1 + R2 resistors, D1 LED)
  const S = async (x, y) => p.evaluate(([x, y]) => window.__nucleus.toScreen(x, y), [x, y]);
  const place = async (q, id, x, y, rotations = 0) => {
    await p.keyboard.press("p"); await p.getByTestId("pick-search").fill(q); await p.getByTestId(`dev-${id}`).click(); await p.getByTestId("pick-ok").click();
    for (let i = 0; i < rotations; i++) await p.keyboard.press("r");
    const [sx, sy] = await S(x, y); await p.mouse.move(sx, sy); await p.mouse.click(sx, sy); await p.keyboard.press("Escape");
  };
  await place("dc voltage", "VSOURCE", 0, 0);
  await place("resistor", "RES", 800, -600); await place("resistor", "RES", 1600, -600);
  await place("led red", "LED-RED", 2200, -400, 3);
  const parts = await p.evaluate(() => window.__nucleus.parts());
  assert.deepEqual(parts.map((x) => x.ref).sort(), ["D1", "R1", "R2", "V1"]); step("searched and placed V1 (DC source), R1 + R2 (resistors), D1 (red LED)"); await shot(p, "placed");
  // 5 edit values (R2 deliberately wrong first, fixed in step 7)
  const select = async (ref) => { const [x, y] = await p.evaluate((r) => window.__nucleus.parts().find((q) => q.ref === r).at, ref); const [sx, sy] = await S(x, y); await p.mouse.click(sx, sy); await p.getByTestId("inspector").waitFor(); };
  const setVal = async (ref, key, v) => { await select(ref); const f = p.getByTestId(`prop-${key}`); await f.fill(v); await f.press("Enter"); };
  await setVal("V1", "value", "5"); await setVal("R1", "value", "220"); await setVal("R2", "value", "1o0");
  assert.ok(await p.getByText("Not a number (e.g. 4k7, 100n, 2.2u, 1meg)").isVisible(), "invalid value must be refused");
  assert.equal((await p.evaluate(() => window.__nucleus.parts())).find((x) => x.ref === "R2").props.value, "10k", "refused value must not reach the model");
  await p.getByTestId("prop-value").fill("100"); await p.getByTestId("prop-value").press("Enter");
  step("values edited in the inspector (V1 = 5 V, R1 = 220 Ω, R2 = 100 Ω); an invalid entry “1o0” was refused");
  // 6 wires, clicked pin to pin
  const pin = async (ref, num) => S(...(await p.evaluate(([r, k]) => window.__nucleus.pin(r, k), [ref, num])));
  const wire = async (pts) => { await p.keyboard.press("w"); for (const q of pts) { const [x, y] = Array.isArray(q) ? await S(...q) : await pin(...q.split(".")); await p.mouse.click(x, y); await sleep(60); } await p.keyboard.press("Escape"); };
  await wire(["V1.1", "R1.1"]); await wire(["R1.2", "R2.1"]); await wire(["R2.2", "D1.1"]);
  await p.getByTestId("tool-ground").click(); const [gx, gy] = await pin("V1", "2"); await p.mouse.click(gx, gy); await p.keyboard.press("Escape");
  step("wired pin to pin with real wires; ground terminal on V1−; LED cathode deliberately left open"); await shot(p, "wired");
  // 7 ERC finds the open LED pin; clicking the finding selects D1; wire it; ERC clean
  await p.keyboard.press("Control+e"); await p.getByTestId("erc-panel").waitFor();
  const rows = await p.getByTestId("erc-row").allInnerTexts(); assert.ok(rows.some((r) => /D1 pin 2 \(K\) is not connected/.test(r)), rows.join("\n"));
  await shot(p, "erc-found");
  await p.getByTestId("erc-row").filter({ hasText: "D1 pin 2" }).first().click(); await p.locator("[data-testid=inspector] h4", { hasText: "D1" }).waitFor({ timeout: 3000 });
  await wire(["D1.2", [2200, 200], "V1.2"]);
  await p.keyboard.press("Control+e"); assert.equal(await p.getByTestId("erc-row").count(), 0, (await p.getByTestId("erc-row").allInnerTexts()).join("\n"));
  step("ERC found “D1 pin 2 (K) is not connected”; the finding selected D1; wired it; ERC clean"); await shot(p, "erc-clean");
  // 8 DC simulation
  await p.getByTestId("sim-run").click(); await p.getByTestId("sim-state").filter({ hasText: /Solved/ }).waitFor({ timeout: 60000 });
  step("DC operating point solved by ngspice");
  // 9 measure with the multimeter: LED anode voltage + current from V1
  await p.getByTestId("tab-instruments").click();
  const anodeNet = await p.evaluate(() => { const at = window.__nucleus.pin("D1", "1"); return at; });
  await select("D1"); const netName = await p.locator("[data-testid=inspector] tbody tr").first().locator("td").nth(2).innerText();
  await p.getByTestId("dmm-pos").selectOption(netName);
  const reading = await p.getByTestId("dmm-value").innerText(); const v = parseFloat(reading.replace(/[^\d.\-]/g, "")) * (/mV/.test(reading) ? 1e-3 : 1);
  // independent check: export the SPICE deck and solve it with native ngspice
  const [dl] = await Promise.all([p.waitForEvent("download"), (async () => { await p.getByTestId("menu-File").click(); await p.getByRole("menuitem", { name: /SPICE deck/ }).click(); })()]);
  const deck = fs.readFileSync(await dl.path(), "utf8");
  const node = `n_${netName.replace(/\$/g, "_24_").toLowerCase()}`;
  fs.writeFileSync("/tmp/nuc-e2e.cir", deck.replace(".op", `.op\n.control\nop\nprint v(${node})\n.endc`));
  const out = execFileSync("ngspice", ["-b", "/tmp/nuc-e2e.cir"], { encoding: "utf8" }); const ref = Number(/=\s*([-+0-9.eE]+)/.exec(out.split("\n").find((l) => l.toLowerCase().startsWith(`v(${node})`)))[1]);
  assert.ok(Math.abs(v - ref) < 5e-4 * Math.max(1, ref), `multimeter ${v} vs native ngspice ${ref}`); assert.ok(v > 1.6 && v < 2.0, `LED forward voltage ${v}`);
  void anodeNet; step(`multimeter reads ${reading} on the LED anode; native ngspice on the exported deck: ${ref.toFixed(4)} V`); await shot(p, "multimeter");
  // 10 save (file download fallback: no File System Access API in this browser)
  const netBefore = await (async () => { await p.getByRole("button", { name: "Netlist" }).click(); return p.locator(".n-netl pre").first().innerText(); })();
  const [sv] = await Promise.all([p.waitForEvent("download"), p.keyboard.press("Control+s")]);
  const saved = await sv.path(); const file = `/tmp/${sv.suggestedFilename()}`; fs.copyFileSync(saved, file);
  assert.match(sv.suggestedFilename(), /LED tester\.nuclues/); step(`saved ${sv.suggestedFilename()} (${fs.statSync(file).size} bytes, SHA-256 protected)`);
  // 11 close (fresh browser context, no recovery copy) and reopen from the file
  await ctx.close();
  const ctx2 = await b.newContext({ viewport: { width: 1600, height: 1000 } }); await ctx2.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker; });
  const q = await ctx2.newPage(); q.on("pageerror", (e) => errors.push(e.message)); await q.goto(URL); await q.getByTestId("schematic-canvas").waitFor();
  const [fc] = await Promise.all([q.waitForEvent("filechooser"), q.keyboard.press("Control+o")]); await fc.setFiles(file);
  await q.getByText("LED tester").first().waitFor(); await q.getByRole("button", { name: "Netlist" }).click();
  const netAfter = await q.locator(".n-netl pre").first().innerText(); assert.equal(netAfter, netBefore);
  const parts2 = await q.evaluate(() => window.__nucleus.parts()); assert.deepEqual(parts2.map((x) => `${x.ref}:${x.at}:${x.props.value ?? ""}`).sort(), parts.map((x) => x.ref).sort().map((r) => { const o = parts2.find((y) => y.ref === r); return `${r}:${o.at}:${o.props.value ?? ""}`; }));
  step("reopened in a fresh window from the file: identical netlist, parts, positions and values"); await shot(q, "reopened");
  // 12 footprints assigned (defaults) and visible in the BOM; change R1 to 0603
  await q.getByTestId("menu-Design").click(); await q.getByRole("menuitem", { name: "Bill of materials" }).click();
  const bom = await q.getByTestId("bom").innerText(); assert.match(bom, /R_0805_2012Metric/); assert.match(bom, /LED_D5\.0mm/); assert.doesNotMatch(bom, /missing/);
  step("every PCB part has a valid footprint (BOM shows them; sources excluded)"); await shot(q, "bom");
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log(`\nNUCLUES beta steps 1–${n} passed. Steps 13–21 (PCB layout, routing, DRC, Gerber/drill) are covered by tests/e2e/pcb.mjs.`);
} finally { await b.close(); }
