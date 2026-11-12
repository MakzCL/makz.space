// 3D board view end to end: LED example → PCB → autoroute → 3D view renders (WebGL) → camera presets and
// component toggle change the picture → Esc closes. Run: npm run build ; npm run preview   then   node tests/e2e/board3d.mjs [shotsDir]
import { createRequire } from "node:module"; import assert from "node:assert/strict";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const URL = process.env.NUCLEUS_URL ?? "http://localhost:4280/"; const SHOTS = process.argv[2];
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const p = await b.newPage({ viewport: { width: 1600, height: 960 } }); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(URL); await p.getByTestId("schematic-canvas").waitFor(); await p.evaluate(() => localStorage.clear()); await p.reload();
  await p.getByTestId("example-led-pcb").click(); await p.getByTestId("menu-PCB").click(); await p.getByRole("menuitem", { name: "Open PCB layout" }).click();
  const status = p.getByTestId("pcb-status"); await p.getByTestId("pcb-autoroute").click(); await status.filter({ hasText: "All connections routed" }).waitFor({ timeout: 60000 });
  step("LED board placed and autorouted");
  await p.getByTestId("pcb-3d").click(); const cv = p.getByTestId("board3d-canvas"); await cv.waitFor({ timeout: 20000 }); await p.waitForTimeout(800);
  // sample the WebGL picture: count distinct colours and the board-green share
  const sample = () => p.evaluate(() => { const c = document.querySelector("[data-testid=board3d-canvas]"); const t = document.createElement("canvas"); t.width = 160; t.height = 100; const g = t.getContext("2d"); g.drawImage(c, 0, 0, 160, 100);
    const d = g.getImageData(0, 0, 160, 100).data; const cols = new Set(); let green = 0; for (let i = 0; i < d.length; i += 4) { cols.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`); if (d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 10) green++; } return { cols: cols.size, green, sig: Array.from(d.filter((_, i) => i % 97 === 0)).join(",") }; });
  const iso = await sample(); assert.ok(iso.cols > 20 && iso.green > 300, JSON.stringify({ cols: iso.cols, green: iso.green }));
  step(`3D view rendered the board (${iso.cols} colour bins, ${iso.green} solder-mask pixels in a 160×100 sample)`); if (SHOTS) await p.screenshot({ path: `${SHOTS}/pcb3d-iso.png` });
  await p.getByTestId("board3d-top").click(); await p.waitForTimeout(500); const top = await sample(); assert.notEqual(top.sig, iso.sig); if (SHOTS) await p.screenshot({ path: `${SHOTS}/pcb3d-top.png` });
  await p.getByTestId("board3d-bottom").click(); await p.waitForTimeout(500); const bot = await sample(); assert.notEqual(bot.sig, top.sig); step("Top and Bottom camera presets change the view");
  await p.getByTestId("board3d-iso").click(); await p.waitForTimeout(400); const a = await sample(); await p.getByLabel("Components").uncheck(); await p.waitForTimeout(400); const c = await sample(); assert.notEqual(a.sig, c.sig); step("hiding components changes the picture");
  await p.getByLabel("Components").check(); const box = await cv.boundingBox(); await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 60, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(500);
  const d = await sample(); assert.notEqual(d.sig, a.sig); step("dragging orbits the camera"); if (SHOTS) await p.screenshot({ path: `${SHOTS}/pcb3d-orbit.png` });
  await p.keyboard.press("Escape"); await p.getByTestId("board3d").waitFor({ state: "detached" }); await p.getByTestId("pcb-canvas").waitFor(); step("Esc closes the 3D view back to the PCB editor");
  assert.deepEqual(errors, []); step("no page errors");
} finally { await b.close(); }
