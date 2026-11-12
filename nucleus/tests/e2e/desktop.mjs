// Launches the NUCLUES desktop app (Electron, desktop/main.cjs + dist/) and runs the example workflow in it:
// parts and wires load, ngspice (WASM) solves inside the desktop app, multimeter/graph values are checked.
// Run: npm run build  then  node tests/e2e/desktop.mjs [shotsDir]   (Linux CI: prefix with xvfb-run -a)
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process"; import path from "node:path";
import { runExamples } from "./examples-steps.mjs";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(execFileSync("npm", ["root", "-g"], { shell: true }).toString().trim() + "/playwright"); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const app = await pw._electron.launch({ executablePath: require(path.join(root, "node_modules/electron")), args: [process.env.NUCLUES_APP_DIR ?? root, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
try {
  const p = await app.firstWindow(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.getByTestId("schematic-canvas").waitFor(); assert.match(p.url(), /^app:\/\/nucleus\//);
  step(`desktop window opened (${await app.evaluate(({ app }) => `Electron ${process.versions.electron}, ${app.getName()} ${app.getVersion()}`)})`);
  await p.evaluate(() => localStorage.clear()); await p.reload(); await p.getByTestId("schematic-canvas").waitFor();
  await p.setViewportSize?.({ width: 1500, height: 900 });
  await runExamples(p, process.argv[2], step);
  assert.deepEqual(errors, []); console.log("\nNUCLUES desktop e2e: all steps passed");
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close(); }
