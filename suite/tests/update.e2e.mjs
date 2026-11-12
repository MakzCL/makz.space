// One-click update path, end to end against a local feed: check → download (SHA-256 checked) → install →
// restart into the new version → healthy; a broken start rolls back; a tampered file is refused. Also "Sign out on this computer".
// Run: node tests/update.e2e.mjs   (Linux CI: xvfb-run -a)
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import { execFileSync } from "node:child_process";
import path from "node:path"; import fs from "node:fs"; import os from "node:os"; import http from "node:http";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require(execFileSync("npm", ["root", "-g"], { shell: true }).toString().trim() + "/playwright"); }
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const appDir = process.env.SUITE_APP_DIR ?? root;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sk-suite-upd-")); const feed = path.join(tmp, "feed"), profile = path.join(tmp, "profile");
const shipped = JSON.parse(fs.readFileSync(path.join(appDir, "version.json"), "utf8")).version;
const next = shipped.replace(/\d+$/, (n) => String(Number(n) + 1));
execFileSync("node", [path.join(root, "scripts/build-update.mjs"), feed, "--version", next, "--notes", "Test release"], { stdio: "ignore" });
const srv = http.createServer((q, r) => { const f = path.join(feed, decodeURIComponent(new URL(q.url, "http://x").pathname)); if (!f.startsWith(feed) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200); fs.createReadStream(f).pipe(r); });
await new Promise((ok) => srv.listen(4291, ok));
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const env = { ...process.env, SK_SUITE_UPDATE_BASE: "http://localhost:4291/update/", SK_SUITE_NO_RELAUNCH: "1", SK_SUITE_USER_DATA: profile };
const launch = () => pw._electron.launch({ executablePath: require(path.join(root, "node_modules/electron")), env, args: [appDir, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])] });
const close = async (a) => { await a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await a.close().catch(() => {}); };
const settings = async (hub) => { await hub.locator('.nav[data-view="settings"]').click(); return hub.locator("#upd-text"); };
const cur = () => JSON.parse(fs.readFileSync(path.join(profile, "updates", "current.json"), "utf8"));
try {
  let app = await launch(); let hub = await app.firstWindow(); await hub.locator(".tile").first().waitFor();
  let txt = await settings(hub);
  await hub.locator("#nav-dot").waitFor({ timeout: 20000 }); assert.equal(await hub.locator("#upd-banner").getAttribute("hidden"), null); // background check found it
  step(`background check found ${next}; Home shows an "Update now" banner and Settings has a dot`);
  await hub.locator("#upd-check").click(); await txt.filter({ hasText: `${next} is available` }).waitFor();
  assert.equal(await hub.locator("#upd-go").innerText(), `Update to ${next}`);
  await hub.locator("#upd-go").click(); await txt.filter({ hasText: "installed" }).waitFor({ timeout: 60000 });
  assert.equal(cur().version, next); assert.ok(fs.existsSync(path.join(cur().dir, "bundled/nucleus/index.html")));
  step(`one click: downloaded ${next} (every file SHA-256 checked) and installed it`);
  await close(app);

  app = await launch(); hub = await app.firstWindow(); await hub.locator(".tile").first().waitFor();
  await settings(hub); await hub.locator("#about").filter({ hasText: `SK Suite ${next} (updated from ${shipped})` }).waitFor();
  await hub.waitForTimeout(500); assert.equal(cur().pending, false);
  const [nuc] = await Promise.all([app.waitForEvent("window"), (async () => { await hub.locator('.nav[data-view="home"]').click(); await hub.locator('.tile[data-app="nucleus"]').click(); })()]);
  await nuc.getByTestId("schematic-canvas").waitFor();
  step(`restarted into ${next}; marked healthy; NUCLEUS opens from the updated files`);
  await close(app);

  // a start that never becomes healthy rolls back to the shipped version
  fs.writeFileSync(path.join(profile, "updates", "current.json"), JSON.stringify({ ...cur(), pending: true }));
  app = await launch(); hub = await app.firstWindow(); await hub.locator(".tile").first().waitFor();
  await settings(hub); await hub.locator("#about").filter({ hasText: `SK Suite ${shipped} ·` }).waitFor();
  assert.equal(cur().failed, true); step(`an update that crashed on start is rolled back to ${shipped} automatically`);

  // tampered download is refused
  fs.rmSync(path.join(profile, "updates"), { recursive: true, force: true });
  fs.appendFileSync(path.join(feed, "update", next, "hub", "hub.js"), "\n// tampered");
  await hub.locator("#upd-check").click(); await hub.locator("#upd-text").filter({ hasText: "is available" }).waitFor();
  await hub.locator("#upd-go").click(); await hub.locator("#upd-text").filter({ hasText: /Checksum mismatch: hub\/hub\.js/ }).waitFor({ timeout: 60000 });
  assert.ok(!fs.existsSync(path.join(profile, "updates", "current.json"))); step("a file that does not match its checksum is refused; nothing is installed");

  // sign out on this computer
  hub.on("dialog", (d) => d.accept().catch(() => {}));
  await hub.locator("#signout-here").click(); await hub.locator("#signout-done").waitFor({ state: "visible" });
  step("Sign out on this computer clears the shared session of the web apps");
  await close(app);
  console.log("\nSK Suite update e2e: all steps passed");
} finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
