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
const opts = { viewport: { width: 390, height: 844 }, timezoneId: 'Europe/Warsaw', serviceWorkers: 'block', permissions: ['microphone'],
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] };
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
let s0 = 0;

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
  await A.fill('#f_note', 'Tomek');
  await A.click('.sheet button[type=submit]');
  await A.waitForSelector('[data-testid=invite-code]');
  const code = (await A.textContent('[data-testid=invite-code]')).trim();
  const link = (await A.textContent('[data-testid=invite-link]')).trim();
  assert.match(link, /\/join\?c=[A-Z0-9]{10}$/);
  assert.ok(await A.isVisible('.qr svg'), 'QR code shown');
  await A.click('.sheet [data-close]');
  ok(`invite ${code} with QR code and link ${link}`);

  step('Invite page (what the link opens)');
  const P = await ctxB.newPage();
  await P.goto(`${BASE}/join?c=${code.replace(/-/g, '')}`);
  await P.waitForSelector('[data-testid=download]');
  assert.match(await P.textContent('.j-hero'), /E2E sync test/);
  assert.match(await P.getAttribute('[data-testid=download]', 'href'), /dairy-app\/releases\/DairyHerd-.*\.apk$/);
  assert.equal(await P.getAttribute('[data-testid=open-app]', 'href'), `dairyherd://join/${code.replace(/-/g, '')}`);
  await P.close();
  ok('invite page shows the farm, a download button for the latest APK and an "open in app" link');

  step('Phone B: opens the link in the app, creates its own account');
  await B.goto(`${BASE}/?join=${code.replace(/-/g, '')}`);
  await B.waitForSelector('.sheet #f_code');
  assert.equal((await B.inputValue('#f_code')).replace(/-/g, ''), code.replace(/-/g, ''));
  await B.waitForSelector('.invite-hello');
  assert.match(await B.textContent('.invite-hello'), /worker/);
  await B.fill('#f_name', 'Tomek'); await B.fill('#f_pin', '5678'); await B.fill('#f_pin2', '5678');
  await B.fill('#f_phone', '+48 600 000 000');
  await save(B);
  await B.waitForSelector('[data-testid=count-inseminated]', { timeout: 20000 });
  await go(B, '#/more');
  assert.match(await B.textContent('.user-card'), /Tomek[\s\S]*Worker/);
  await go(B, '#/');
  await waitText(A, 'body', /./); // keep A alive
  await go(A, '#/users');
  await A.waitForFunction(() => /Tomek/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
  await go(A, '#/');
  ok('B joined as worker "Tomek" without knowing anyone else\'s PIN; A sees Tomek in Users');
  assert.equal((await B.textContent('[data-testid=count-inseminated] .count-n')).trim(), '1');
  await B.fill('#find', '0042');
  assert.match(await B.textContent('#results'), /Inseminated today/);
  ok('B sees the farm: 0042, inseminated today, count 1');

  step('Photo: A photographs 0042; B sees it');
  await go(A, '#/herd');
  await A.click('a.row:has-text("0042")');
  await A.click('[data-testid=photo-btn]');
  const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click('[data-testid=photo-gallery]')]);
  await chooser.setFiles(new URL('../icons/icon-512.png', import.meta.url).pathname);
  await A.waitForSelector('.animal-head img.photo-lg');
  const size = await A.evaluate(() => document.querySelector('.animal-head img.photo-lg').src.length);
  assert.ok(size < 60000, `thumbnail is small (${size} chars)`);
  await B.fill('#find', '0042');
  await B.waitForSelector('#results img.thumb', { timeout: 15000 });
  ok(`B shows the photo in search results (thumbnail ${Math.round(size / 1024)} KB)`);
  await B.fill('#find', '');

  step('Chat both ways');
  await go(A, '#/chat/farm');
  await A.fill('[data-testid=chat-input]', 'Dzień dobry, cielenie w boksie 3');
  await A.click('[data-testid=chat-send]');
  await go(B, '#/');
  await B.waitForSelector('[data-testid=chat-dot]', { timeout: 15000 });
  await go(B, '#/chat');
  assert.match(await B.textContent('main'), /cielenie w boksie 3/);
  await B.click('a.chat-link >> nth=0');
  await B.fill('[data-testid=chat-input]', 'OK, idę');
  s0 = Date.now();
  await B.click('[data-testid=chat-send]');
  await A.waitForFunction(() => /OK, idę/.test(document.querySelector('[data-testid=messages]')?.textContent || ''), null, { timeout: 15000 });
  ok(`farm chat: message and unread badge reached B; B's reply showed on A's open chat after ${((Date.now() - s0) / 1000).toFixed(1)} s`);

  step('Voice call A → Tomek');
  await go(B, '#/');
  await go(A, '#/chat');
  await A.click('[data-act=call]');
  await B.waitForSelector('[data-testid=call-accept]', { timeout: 15000 });
  await B.click('[data-testid=call-accept]');
  await A.waitForFunction(() => /^\d\d:\d\d$/.test(document.querySelector('[data-testid=call-status]')?.textContent || ''), null, { timeout: 20000 });
  await B.waitForFunction(() => /^\d\d:\d\d$/.test(document.querySelector('[data-testid=call-status]')?.textContent || ''), null, { timeout: 20000 });
  const audioIn = await B.evaluate(() => !!document.querySelector('#call audio')?.srcObject?.getAudioTracks().length);
  assert.ok(audioIn, 'B receives audio');
  await A.click('[data-testid=call-hangup]');
  await B.waitForFunction(() => /ended|zakończone/i.test(document.querySelector('[data-testid=call-status]')?.textContent || '') || !document.getElementById('call'), null, { timeout: 10000 });
  await A.click('#call [data-call=close]').catch(() => {});
  await B.click('#call [data-call=close]').catch(() => {});
  ok('B rang, answered, both connected with audio, hang-up reached B');

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
