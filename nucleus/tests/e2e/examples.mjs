// Opens each built-in example from the start panel in the real UI, lets it auto-run in ngspice (WASM),
// and checks the reading against the hand calculation. Also screenshots the three colour palettes.
// Run (PowerShell or bash, two terminals):  npm run build ; npm run preview   then   node tests/e2e/examples.mjs [shotsDir]
import { runExamples } from "./examples-steps.mjs"; import { createRequire } from "node:module"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(execFileSync("npm", ["root", "-g"], { shell: true }).toString().trim() + "/playwright")); }
const URL = process.env.NUCLUES_URL ?? "http://localhost:4280/"; const SHOTS = process.argv[2];
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const b = await chromium.launch();
try {
  const p = await b.newPage({ viewport: { width: 1500, height: 900 } }); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(URL); await p.getByTestId("schematic-canvas").waitFor(); await p.evaluate(() => localStorage.clear()); await p.reload();
  await runExamples(p, SHOTS, step);
  assert.deepEqual(errors, []); console.log("\nNUCLUES examples e2e: all steps passed");
} finally { await b.close(); }
