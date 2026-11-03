// Screenshots TROTAN (MANAGE and DESIGN with an imported drawing) in Light / Granat / Dark, against the mocked backend.
// Run: npm run build ; npx vite preview --port 4173   then   node tests/trotan/palettes.mjs <shotsDir>
import { createRequire } from "node:module"; import fs from "node:fs";
import { context, seed } from "./mock.mjs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const BASE = process.env.TROTAN_URL ?? "http://localhost:4173/trotan"; const OUT = process.argv[2] ?? "."; fs.mkdirSync(OUT, { recursive: true });
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40"><rect x="1" y="1" width="78" height="38" rx="4" fill="none" stroke="#ff0000" stroke-width="0.1"/><circle cx="12" cy="20" r="4" fill="none" stroke="#ff0000" stroke-width="0.1"/></svg>`;
const browser = await chromium.launch();
try {
  const { page: p, errors } = await context(browser, seed());
  await p.goto(BASE); await p.getByTestId("manage").waitFor({ timeout: 15000 });
  for (const t of ["light", "granat", "dark"]) { await p.getByTestId(`theme-${t}`).click(); await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/trotan-manage-${t}.png` }); }
  await p.getByTestId("new-project").click(); await p.getByTestId("project-name").fill("Coaster set"); await p.getByTestId("project-name").blur();
  await p.getByTestId("create-project").click(); await p.getByTestId("editor").waitFor();
  await p.getByTestId("file-input").setInputFiles({ name: "coaster.svg", mimeType: "image/svg+xml", buffer: Buffer.from(SVG) });
  await p.getByText(/Imported 2 objects/).waitFor();
  for (const t of ["light", "granat", "dark"]) { await p.getByTestId(`theme-${t}`).click(); await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/trotan-design-${t}.png` }); }
  if (errors.length) { console.error(errors); process.exit(1); }
  console.log("TROTAN palette screenshots written");
} finally { await browser.close(); }
