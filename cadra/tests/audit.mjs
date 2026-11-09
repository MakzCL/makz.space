// Click-everything UI audit of CADRA (shared crawler from factory/tests/audit). Run against `vite preview --port 4290`.
import { createRequire } from "node:module"; import fs from "node:fs";
import { crawlScreen, report } from "../../factory/tests/audit/crawl.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const URL = process.env.APP_URL ?? "http://localhost:4290/"; const OUT = process.argv[2] ?? "tests/out"; fs.mkdirSync(OUT, { recursive: true });
const seedDoc = async (p) => { await p.goto(URL); for (const c of ["rec", "0,0", "@120,80", "c", "60,40", "25", "dli", "0,0", "120,0", "60,-15"]) { await p.getByTestId("cmdline").fill(c); await p.keyboard.press("Enter"); } await p.waitForTimeout(150); };
const b = await chromium.launch(); const all = [];
const screens = [["Drawing", async (p) => { await seedDoc(p); }], ["Drawing + selection", async (p) => { await seedDoc(p); await p.keyboard.press("Control+a"); await p.waitForTimeout(100); }],
  ["File menu", async (p) => { await seedDoc(p); await p.getByRole("button", { name: "File" }).click(); }], ["Command running", async (p) => { await seedDoc(p); await p.getByTestId("cmdline").fill("circle"); await p.keyboard.press("Enter"); }]];
for (const [screen, open] of screens) for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const issues = await crawlScreen({ browser: b, app: "cadra", screen, viewport: vp, maxControls: vp.width < 500 ? 0 : 80, skip: ["Open…", "File"],
    newPage: async (v) => { const c = await b.newContext({ viewport: v }); return c.newPage(); }, open });
  all.push(...issues); console.log(`${screen} @${vp.width}: ${issues.length}`); }
await b.close(); const rows = report(all, `${OUT}/audit-cadra`); console.log(`${rows.length} distinct findings`); for (const r of rows) console.log(`- [${r.kind}] ${r.detail}`);
