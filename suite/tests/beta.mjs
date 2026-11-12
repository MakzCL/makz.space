// SK Suite Beta (pre-publish suite): a beta build is its own app — name, profile, sign-in session, update feed —
// shows the BETA mark in the hub and in the offline apps, and points SK Factory, Kortana and TROTAN at their beta sites,
// telling them apart by path. The stable build has none of this (npm test covers it).
// Run: SK_CHANNEL=beta node scripts/bundle.mjs && xvfb-run -a node tests/beta.mjs ; then node scripts/bundle.mjs to go back to stable
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import path from "node:path"; import fs from "node:fs"; import os from "node:os";
const require = createRequire(import.meta.url); const pw = require("playwright");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
assert.ok(fs.existsSync(path.join(root, "channel.json")), "build the beta first: SK_CHANNEL=beta node scripts/bundle.mjs");
const appData = fs.mkdtempSync(path.join(os.tmpdir(), "sk-beta-appdata-"));
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const app = await pw._electron.launch({ executablePath: require(path.join(root, "node_modules/electron")), args: [root, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])], env: { ...process.env, XDG_CONFIG_HOME: appData, APPDATA: appData } });
try {
  const info = await app.evaluate(({ app }) => ({ name: app.getName(), userData: app.getPath("userData") }));
  assert.equal(info.name, "SK Suite Beta"); assert.equal(path.basename(info.userData), "SK Suite Beta");
  step(`runs as "${info.name}" with its own profile folder (${path.basename(info.userData)}), next to SK Suite`);
  const hub = await app.firstWindow(); await hub.locator(".tile").first().waitFor();
  await hub.locator("#sk-beta-mark").waitFor(); assert.equal(await hub.locator("#sk-beta-mark").innerText(), "BETA");
  assert.equal(await hub.title(), "SK Suite Beta");
  assert.match(await hub.locator("#about").innerText(), /^SK Suite Beta /);
  step("hub: BETA corner mark, window title and About say SK Suite Beta");
  const apps = await hub.evaluate(() => window.suite.apps());
  const url = Object.fromEntries(apps.map((a) => [a.id, a.url]));
  assert.equal(url.factory, "https://beta.skalarki-factory.pages.dev/"); assert.equal(url.kortana, "https://beta.skalarki-factory.pages.dev/kimera"); assert.equal(url.trotan, "https://beta.skalarki-factory.pages.dev/trotan");
  assert.ok(!JSON.stringify(apps).includes("makz.space"), "no live address in the beta suite");
  step("SK Factory, Kortana and TROTAN point at the beta site (/, /kimera, /trotan); no live address anywhere");
  const [cad] = await Promise.all([app.waitForEvent("window"), hub.locator('.tile[data-app="cadra"]').click()]);
  await cad.getByTestId("cmdline").waitFor(); await cad.locator("#sk-beta-mark").waitFor(); assert.match(await cad.title(), /^BETA · /);
  const [nuc] = await Promise.all([app.waitForEvent("window"), hub.locator('.tile[data-app="nucleus"]').click()]);
  await nuc.locator("#sk-beta-mark").waitFor({ timeout: 30000 }); assert.match(await nuc.title(), /^BETA · /);
  step("CADRA and NUCLEUS (offline, bundled beta builds) show the BETA mark and a BETA title");
  const routed = await app.evaluate(async ({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const part = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.session.storagePath ?? "").filter(Boolean).map((p) => p.split(/[\\/]/).pop()));
  assert.ok(part.includes("sk-suite-beta") && !part.includes("sk-suite"), `sessions: ${part.join(",")}`); // (the hub itself uses the profile's default session)
  step(`app windows use their own sign-in session (sk-suite-beta), not SK Suite's (${routed} windows open)`);
  const feed = await app.evaluate(() => process.env.SK_SUITE_UPDATE_BASE ?? null);
  assert.equal(feed, null); assert.match(fs.readFileSync(path.join(root, "channel.json"), "utf8"), /beta\.sk-suite\.pages\.dev\/update\//);
  step("updates come from the beta feed (beta.sk-suite.pages.dev/update/), never the stable one");
  console.log("\nSK Suite Beta e2e: all steps passed");
} finally { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
