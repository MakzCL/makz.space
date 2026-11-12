// Audit NUCLUES: every screen and every menu, desktop (1440) clicks + static checks at 1440 and 1024.
// Run: npm run build ; npm run preview   then   node tests/audit/audit-nucleus.mjs <outDir>
import { createRequire } from "node:module"; import fs from "node:fs";
import { crawlScreen, report } from "../../../factory/tests/audit/crawl.mjs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const URL = process.env.NUCLUES_URL ?? "http://localhost:4280/"; const OUT = process.argv[2] ?? "."; fs.mkdirSync(OUT, { recursive: true });
const example = (id) => async (p) => { await p.getByTestId(`example-${id}`).click(); await p.getByTestId("sim-state").filter({ hasText: /Solved|Error|failed/i }).waitFor({ timeout: 60000 }).catch(() => {}); };
const menu = (m) => async (p) => { await p.getByTestId(`menu-${m}`).click(); };
const pcb = async (p) => { await p.getByTestId("menu-PCB").click(); await p.getByRole("menuitem", { name: "Open PCB layout" }).click(); await p.getByTestId("pcb").waitFor(); };
const SCREENS = [
  ["Start (empty)", []], ["Schematic: LED board", [example("led-pcb")]], ["Analysis: RC AC", [example("rc-ac")]], ["Instruments: divider", [example("divider"), async (p) => p.getByTestId("tab-instruments").click()]],
  ["PCB: LED board", [example("led-pcb"), pcb]], ["PCB: setup dialog", [example("led-pcb"), pcb, async (p) => p.getByRole("button", { name: "Board setup…" }).click()]],
  ["PCB: copper pour dialog", [example("led-pcb"), pcb, async (p) => p.getByTestId("pcb-add-zone").click()]],
  ["Device picker", [async (p) => p.keyboard.press("p")]], ["BOM", [example("led-pcb"), menu("Manufacturing"), async (p) => p.getByRole("menuitem", { name: "Bill of materials" }).click()]],
  ...["File", "Edit", "View", "Place", "Design", "Simulation", "PCB", "Library", "Manufacturing", "Tools", "Window", "Help"].map((m) => [`Menu ${m}`, [example("divider"), menu(m)]]),
];
const b = await chromium.launch(); const all = []; const jobs = [];
for (const [screen, steps] of SCREENS) for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 700 }]) jobs.push({ screen, steps, viewport });
const worker = async () => { for (let j; (j = jobs.shift()); ) {
  const issues = await crawlScreen({ browser: b, app: "nucleus", screen: j.screen, viewport: j.viewport, maxControls: j.viewport.width < 1100 ? 0 : 90,
    newPage: async (vp) => { const ctx = await b.newContext({ viewport: vp, acceptDownloads: true }); await ctx.addInitScript(() => { try { localStorage.clear(); } catch {} delete window.showSaveFilePicker; delete window.showOpenFilePicker; }); return ctx.newPage(); },
    open: async (p) => { await p.goto(URL); await p.getByTestId("schematic-canvas").waitFor(); for (const s of j.steps) { await s(p); await p.waitForTimeout(300); } } }).catch((e) => [{ app: "nucleus", screen: j.screen, viewport: j.viewport.width, kind: "screen-failed", detail: String(e.message).split("\n")[0] }]);
  all.push(...issues); console.log(`nucleus › ${j.screen} @${j.viewport.width}: ${issues.length}`);
} };
await Promise.all([worker(), worker(), worker()]); await b.close();
console.log(`${report(all, `${OUT}/audit-nucleus`).length} distinct findings`);
