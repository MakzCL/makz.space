// Audit the SK Suite hub: static checks on every view at 1180×760 and 820×600, and every control clicked once
// (fresh reload before each). App windows that open are closed again. Run: xvfb-run -a node tests/audit.mjs <outDir>
import { createRequire } from "node:module"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { STATIC_JS, report } from "../../factory/tests/audit/crawl.mjs";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(execFileSync("npm", ["root", "-g"], { shell: true }).toString().trim() + "/playwright"); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."); const OUT = process.argv[2] ?? "."; fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sk-suite-audit-"));
const app = await pw._electron.launch({ executablePath: require(path.join(root, "node_modules/electron")), env: { ...process.env, SK_SUITE_USER_DATA: profile, SK_SUITE_UPDATE_BASE: "http://127.0.0.1:9/" }, args: [root, "--no-sandbox"] });
const all = []; const add = (screen, w, kind, detail) => all.push({ app: "suite", screen, viewport: w, kind, detail });
try {
  const hub = await app.firstWindow(); const errs = []; hub.on("pageerror", (e) => errs.push(e.message)); hub.on("console", (m) => m.type() === "error" && errs.push(m.text())); hub.on("dialog", (d) => d.dismiss().catch(() => {}));
  for (const [w, h] of [[1180, 760], [820, 600]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("app://hub/")).setContentSize(w, h), [w, h]);
    for (const view of ["home", "apps", "settings"]) {
      await hub.reload(); await hub.locator(".tile").first().waitFor(); await hub.locator(`.nav[data-view=${view}]`).click(); await hub.waitForTimeout(300);
      for (const x of await hub.evaluate(STATIC_JS)) add(view, w, x.kind, x.detail);
      if (w !== 1180) continue;
      const n = await hub.locator(`#view-${view} button, .rail button`).filter({ visible: true }).count();
      for (let i = 0; i < n; i++) {
        await hub.reload(); await hub.locator(".tile").first().waitFor(); await hub.locator(`.nav[data-view=${view}]`).click(); await hub.waitForTimeout(200);
        const el = hub.locator(`#view-${view} button, .rail button`).filter({ visible: true }).nth(i); const label = ((await el.getAttribute("aria-label")) || (await el.innerText()) || (await el.getAttribute("title")) || `#${i}`).trim().replace(/\s+/g, " ").slice(0, 40);
        const before = await hub.evaluate(() => document.body.innerText + "|" + document.documentElement.dataset.theme); const wins0 = app.windows().length;
        await el.click().catch((e) => add(view, w, "click-failed", `"${label}": ${e.message.split("\n")[0]}`)); await hub.waitForTimeout(1200);
        const after = await hub.evaluate(() => document.body.innerText + "|" + document.documentElement.dataset.theme);
        const active = await el.evaluate((e) => e.classList.contains("on")).catch(() => false);
        if (before === after && !active && app.windows().length === wins0 && !/Open in browser|Sign out on this computer/.test(label)) add(view, w, "dead-control", `"${label}" changes nothing`);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => !x.webContents.getURL().startsWith("app://hub/")).forEach((x) => x.destroy()));
      }
    }
  }
  for (const e of errs) if (!/127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|Failed to fetch/.test(e)) add("(any)", 0, "console-error", e.slice(0, 200));
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
console.log(`${report(all, `${OUT}/audit-suite`).length} distinct findings`);
