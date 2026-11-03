// Raster engraving in the editor: import a greyscale gradient, set Floyd–Steinberg / threshold / invert, and check the
// processing settings are stored on the image and drawn as the dithered result. Mocked backend.
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import fs from "node:fs";
import { context, seed } from "./mock.mjs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const BASE = process.env.TROTAN_URL ?? "http://localhost:4173/trotan"; const [png, SHOTS] = process.argv.slice(2);
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const D = seed(); const b = await chromium.launch();
try {
  const { page: p, errors } = await context(b, D);
  await p.goto(BASE); await p.getByTestId("manage").waitFor({ timeout: 15000 });
  await p.getByTestId("new-project").click(); await p.getByTestId("project-name").fill("Photo plaque"); await p.getByTestId("project-name").blur(); await p.getByTestId("create-project").click(); await p.getByTestId("editor").waitFor();
  await p.getByTestId("file-input").setInputFiles({ name: "gradient.png", mimeType: "image/png", buffer: fs.readFileSync(png) });
  await p.waitForTimeout(1200); await p.locator("[data-testid=editor] canvas").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await p.keyboard.press("Control+a"); await p.getByRole("tab", { name: "Properties" }).click(); await p.getByTestId("img-proc").waitFor({ timeout: 15000 }).catch(async (e) => { await p.screenshot({ path: "/tmp/claude-0/-home-user-makz-space/51998819-3d75-5c61-8ebe-d99f9adf9a2f/scratchpad/dev/raster-fail.png" }); throw e; }); step("PNG placed; the Engraving image panel is shown");
  // the editor draws the processed image: sample the canvas and expect only (near) black/white pixels inside the image
  const sample = async () => p.evaluate(() => { const c = document.querySelector("[data-testid=editor] canvas"); const x = c.getContext("2d"); const d = x.getImageData(0, 0, c.width, c.height).data; let bw = 0, grey = 0; for (let i = 0; i < d.length; i += 4) { const v = d[i]; if (d[i] === d[i + 1] && d[i + 1] === d[i + 2]) { if (v < 20 || v > 235) bw++; else if (v > 60 && v < 200) grey++; } } return { bw, grey }; });
  await p.waitForTimeout(800); const s1 = await sample(); assert.ok(s1.bw > s1.grey * 4, JSON.stringify(s1));
  step(`preview is dithered (Floyd–Steinberg by default): ${s1.bw} black/white pixels vs ${s1.grey} mid-grey`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/trotan-raster-floyd.png` });
  await p.getByTestId("img-mode").selectOption("threshold"); await p.getByTestId("img-invert").click(); await p.waitForTimeout(800);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/trotan-raster-threshold-invert.png` });
  await p.getByTestId("img-mode").selectOption("grey"); await p.waitForTimeout(800); const s3 = await sample(); assert.ok(s3.grey > 1000, JSON.stringify(s3));
  step("greyscale mode keeps tones (power follows the tone)");
  await p.keyboard.press("Control+s"); await p.waitForTimeout(3500);
  const proc = D.trotan_projects.at(-1)?.doc?.objects?.find((o) => o.kind === "image")?.proc;
  assert.equal(proc?.mode, "grey"); assert.equal(proc?.invert, true); step(`saved with the image settings ${JSON.stringify(proc)}`);
  assert.deepEqual(errors, []); console.log("\nTROTAN raster e2e: passed");
} finally { await b.close(); }
