// Two phones, one farm, against the real sync server.
//   node serve.mjs &   then   node tests/sync-e2e.mjs [http://localhost:8080]
// Creates a farm called "E2E sync test" on the server (delete it afterwards).
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8080';
const dirA = mkdtempSync(join(tmpdir(), 'dairy-a-'));
const dirB = mkdtempSync(join(tmpdir(), 'dairy-b-'));
const opts = { viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Warsaw', serviceWorkers: 'block' };
const step = (s) => console.log(`\n▶ ${s}`);
const ok = (s) => console.log(`  ✓ ${s}`);
const errors = [];

const ctxA = await chromium.launchPersistentContext(dirA, opts);
const ctxB = await chromium.launchPersistentContext(dirB, opts);
const A = ctxA.pages()[0]; const B = ctxB.pages()[0];
for (const [n, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
  p.on('dialog', (d) => d.accept());
}
const go = async (p, h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(150); };
const save = async (p) => { await p.click('.sheet button[type=submit]'); await p.waitForSelector('.sheet', { state: 'detached', timeout: 20000 }); await p.waitForTimeout(150); };
const choose = (p, name, value) => p.check(`.sheet input[name="${name}"][value="${value}"]`);
const waitText = (p, sel, re, timeout = 10000) => p.waitForFunction(([s, src]) => new RegExp(src).test(document.querySelector(s)?.textContent || ''), [sel, re.source], { timeout });
const t0 = () => Date.now();

try {
  step('Phone A: new farm, shared online');
  await A.goto(BASE);
  await A.click('[data-testid=gate-new]');
  await choose(A, 'language', 'en');
  await A.fill('#f_farmName', 'E2E sync test');
  await A.fill('#f_ownerName', 'Anna'); await A.fill('#f_pin', '1234'); await A.fill('#f_pin2', '1234');
  await A.check('.sheet input[name=online]');
  await A.uncheck('.sheet input[name=sample]');
  await save(A);
  await waitText(A, '[data-testid=sync-pill]', /Synced|Live/);
  ok(`A pill: ${await A.textContent('[data-testid=sync-pill]')}`);

  await A.click('[data-act=add]');
  await A.fill('#f_code', '0042'); await save(A);
  await A.waitForSelector('[data-testid=record-insemination]');
  await A.click('[data-testid=record-insemination]'); await save(A);
  ok('A recorded cow 0042 and an insemination');

  await go(A, '#/sync');
  await A.click('[data-testid=invite]');
  await A.waitForSelector('[data-testid=invite-code]');
  const code = (await A.textContent('[data-testid=invite-code]')).trim();
  ok(`invite code ${code}`);

  step('Phone B: join with the code, log in with the farm PIN');
  await B.goto(BASE);
  await B.click('[data-testid=gate-join]');
  await B.fill('#f_code', code.toLowerCase());
  await B.fill('#f_label', 'Tom phone');
  await save(B);
  await B.waitForSelector('[data-testid=login-pin]', { timeout: 20000 });
  assert.match(await B.textContent('.login'), /Anna/);
  await B.fill('[data-testid=login-pin]', '1234');
  await B.click('[data-testid=login-submit]');
  await B.waitForSelector('[data-testid=count-inseminated]');
  assert.equal((await B.textContent('[data-testid=count-inseminated] .count-n')).trim(), '1');
  await B.fill('#find', '0042');
  assert.match(await B.textContent('#results'), /Inseminated today/);
  ok('B sees the farm: 0042, inseminated today, count 1');

  step('Live: A inseminates another cow; B updates without reloading');
  await B.fill('#find', '');
  await go(A, '#/');
  await A.click('[data-act=add]');
  await A.fill('#f_code', '0043'); await save(A);
  await A.waitForSelector('[data-testid=record-insemination]');
  let s = t0();
  await A.click('[data-testid=record-insemination]'); await save(A);
  await waitText(B, '[data-testid=count-inseminated] .count-n', /^2$/, 15000);
  ok(`B's "Cows inseminated" became 2 after ${((Date.now() - s) / 1000).toFixed(1)} s`);

  step('Live the other way: B records milk; A sees the total');
  await go(A, '#/');
  await go(B, '#/milk');
  await B.click('[data-act=add][data-kind=session]');
  await choose(B, 'session', 'AM'); await B.fill('#f_litres', '500');
  s = t0();
  await save(B);
  await waitText(A, '[data-testid=t-produced]', /^500 L$/, 15000);
  ok(`A's "Litres produced" became 500 L after ${((Date.now() - s) / 1000).toFixed(1)} s`);

  step('B offline: records milk, sends it when back online');
  await ctxB.setOffline(true);
  await B.evaluate(() => window.dispatchEvent(new Event('offline')));
  await B.click('[data-act=add][data-kind=session]');
  await choose(B, 'session', 'PM'); await B.fill('#f_litres', '300');
  await save(B);
  await go(B, '#/');
  await waitText(B, '[data-testid=sync-pill]', /Offline · 1 to send/);
  await A.waitForTimeout(2000);
  assert.equal((await A.textContent('[data-testid=t-produced]')).trim(), '500 L');
  await ctxB.setOffline(false);
  await B.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitText(A, '[data-testid=t-produced]', /^800 L$/, 20000);
  ok('A stayed at 500 L while B was offline, then showed 800 L');

  step('Edits and deletes sync too');
  await go(A, '#/herd');
  await A.click('a.row:has-text("0043")');
  await A.click('.timeline button:has-text("Insemination")');
  await A.click('.sheet [data-delete]');
  await A.waitForTimeout(300);
  await waitText(B, '[data-testid=count-inseminated] .count-n', /^1$/, 15000);
  ok('deleting the 0043 insemination on A brought B back to 1');

  step('Admin removes phone B');
  await go(A, '#/sync');
  await A.waitForSelector('[data-act=revoke]');
  await A.click('[data-act=revoke]');
  await A.waitForTimeout(500);
  await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await go(B, '#/');
  await waitText(B, '[data-testid=sync-pill]', /removed/, 15000);
  ok('B shows "Phone removed from farm"');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nSYNC SCENARIOS PASSED');
} catch (err) {
  await A.screenshot({ path: 'sync-failure-A.png', fullPage: true }).catch(() => {});
  await B.screenshot({ path: 'sync-failure-B.png', fullPage: true }).catch(() => {});
  console.error('\nFAILED:', err.message, errors.length ? `\npage errors: ${errors.join('\n')}` : '');
  process.exitCode = 1;
} finally {
  await ctxA.close().catch(() => {}); await ctxB.close().catch(() => {});
  rmSync(dirA, { recursive: true, force: true }); rmSync(dirB, { recursive: true, force: true });
}
