// "Sign out of devices" in SK Factory (Profile), Kortana (Settings → Devices) and TROTAN (Account), against the mocked backend.
// Run: npm run build ; npx vite preview --port 4173   then   node tests/devices.e2e.mjs [shotsDir]
import { createRequire } from "node:module"; import assert from "node:assert/strict";
import { context, seed, OWNER } from "./trotan/mock.mjs";
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const BASE = process.env.APP_URL ?? "http://localhost:4173"; const SHOTS = process.argv[2];
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const sessions = () => [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", user: OWNER, created_at: "2026-10-01T08:00:00Z", last_active: new Date().toISOString(), user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", ip: "10.0.0.5", current: true },
  { id: "aaaaaaaa-0000-0000-0000-000000000002", user: OWNER, created_at: "2026-10-20T08:00:00Z", last_active: new Date(Date.now() - 7200e3).toISOString(), user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", ip: "10.0.0.6", current: false },
  { id: "aaaaaaaa-0000-0000-0000-000000000003", user: OWNER, created_at: "2026-11-01T08:00:00Z", last_active: new Date(Date.now() - 600e3).toISOString(), user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) sk-suite/0.2.0 Chrome/140.0 Electron/45.2.1 Safari/537.36", ip: "10.0.0.7", current: false },
];
const b = await chromium.launch();
try {
  for (const app of ["factory", "kortana", "trotan"]) {
    const D = seed(); D.sessions = sessions();
    const { page: p, errors } = await context(b, D);
    p.on("dialog", (d) => d.accept());
    if (app === "factory") { await p.goto(`${BASE}/`); await p.locator(".me-btn").click(); await p.locator("[aria-label=Settings]").last().click(); }
    if (app === "kortana") { await p.goto(`${BASE}/kimera`); await p.getByText("Settings", { exact: true }).first().click(); await p.getByText("Devices", { exact: true }).first().click(); }
    if (app === "trotan") { await p.goto(`${BASE}/trotan`); await p.getByTestId("account").click(); }
    const dev = p.getByTestId("devices"); await dev.waitFor({ timeout: 15000 }); await dev.scrollIntoViewIfNeeded();
    await p.getByTestId("device").nth(2).waitFor();
    const names = await p.locator("[data-testid=device] b").allInnerTexts();
    assert.deepEqual(names, ["Chrome · Windows", "Safari · iPhone", "SK Suite · Windows"]);
    assert.equal(await p.locator("[data-testid=device].current").count(), 1);
    if (SHOTS) await dev.screenshot({ path: `${SHOTS}/devices-${app}.png` });
    await p.getByTestId("device").nth(1).getByRole("button").click();
    await p.locator("[data-testid=device]").nth(2).waitFor({ state: "detached" });
    assert.equal(D.sessions.length, 2);
    await p.getByTestId("signout-others").click();
    await p.waitForFunction(() => document.querySelectorAll("[data-testid=device]").length === 1);
    assert.deepEqual(D.logouts, ["others"]);
    await p.getByTestId("signout-everywhere").click();
    await p.waitForFunction(() => true); await p.waitForTimeout(800);
    assert.deepEqual(D.logouts, ["others", "global"]);
    assert.deepEqual(errors, []);
    step(`${app}: lists 3 devices with friendly names, ends one, signs out all others, signs out everywhere`);
    await p.context().close();
  }
  console.log("\nSign out of devices e2e: all apps passed");
} finally { await b.close(); }
