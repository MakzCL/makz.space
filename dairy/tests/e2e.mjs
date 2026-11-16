// End-to-end check of the release scenarios in a real Chromium.
//   node serve.mjs &   then   node tests/e2e.mjs [http://localhost:8080]
// Uses the Playwright that is installed globally or in a parent project.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { todayKey, addDays } from '../js/time.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8080';
const FARM_TZ = 'Pacific/Auckland'; // deliberately different from the phone's zone below
const PHONE_TZ = 'Europe/London';
const dir = mkdtempSync(join(tmpdir(), 'dairy-e2e-'));
const opts = { viewport: { width: 390, height: 844 }, timezoneId: PHONE_TZ, serviceWorkers: 'allow', acceptDownloads: true };
const step = (s) => console.log(`\n▶ ${s}`);
const ok = (s) => console.log(`  ✓ ${s}`);

let ctx = await chromium.launchPersistentContext(dir, opts);
let p = ctx.pages()[0] || await ctx.newPage();
const errors = [];
const watch = (page) => page.on('pageerror', (e) => errors.push(e.message));
watch(p);

const go = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(150); };
const text = (sel) => p.textContent(sel);
const save = async () => { await p.click('.sheet button[type=submit]'); await p.waitForSelector('.sheet', { state: 'detached' }); await p.waitForTimeout(150); };
const choose = (name, value) => p.check(`.sheet input[name="${name}"][value="${value}"]`);
const details = async () => { const d = p.locator('.sheet details.more'); if (await d.count() && !(await d.getAttribute('open'))) await d.locator('summary').click(); };
const openCow = async (q) => {
  await go('#/');
  await p.fill('#find', q);
  await p.click('[data-testid=search-results] a.row >> nth=0');
  await p.waitForSelector('[data-testid=animal-code]');
};
const countOf = async (id) => Number((await text(`[data-testid=${id}] .count-n`)).trim());
const today = todayKey(FARM_TZ);

try {
  step('First start: settings with farm time zone and sample data');
  await p.goto(BASE);
  await p.click('[data-testid=gate-new]');
  await p.waitForSelector('.sheet');
  await choose('language', 'en');
  await p.uncheck('.sheet input[name=online]');
  await p.fill('#f_ownerName', 'Anna');
  await p.fill('#f_pin', '1234');
  await p.fill('#f_pin2', '1234');
  await p.selectOption('#f_timeZone', FARM_TZ);
  await p.selectOption('#f_currency', 'EUR');
  await p.check('.sheet input[name=sample]');
  await save();
  await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
  ok('set up with an owner login');

  step('Scenario 1: find 0042, inseminate 18 days ago, reload');
  const ins0 = await countOf('count-inseminated');
  await p.fill('#find', '0042');
  await p.click('[data-testid=search-results] a.row >> nth=0');
  assert.equal((await text('[data-testid=animal-code]')).trim(), '0042');
  await p.click('[data-testid=record-insemination]');
  assert.match(await text('.sheet .cow-banner'), /0042/);
  await p.fill('#f_at', `${addDays(today, -18)}T08:30`);
  await save();
  await p.reload();
  await p.waitForFunction(() => window.__dairyReady);
  await p.waitForSelector('[data-testid=breeding-headline]');
  assert.equal((await text('[data-testid=breeding-headline]')).trim(), 'Inseminated 18 days ago');
  assert.match(await text('.breeding .sub'), new RegExp(`08:30`));
  ok('after reload: "Inseminated 18 days ago" with the actual date');

  step('Cow photo');
  await p.click('[data-testid=photo-btn]');
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-testid=photo-gallery]')]);
  await chooser.setFiles(new URL('../icons/icon-512.png', import.meta.url).pathname);
  await p.waitForSelector('.animal-hero img.hero-img');
  await p.reload();
  await p.waitForSelector('.animal-hero img.hero-img');
  ok('photo saved, cropped and still there after reload');

  step('Scenario 2: second insemination, both kept, counts once');
  await p.click('[data-testid=record-insemination]');
  await details();
  await p.fill('#f_sire', 'Sire 2');
  // double tap on save must not create two records
  await p.locator('.sheet button[type=submit]').dblclick();
  await p.waitForSelector('.sheet', { state: 'detached' });
  await p.waitForTimeout(200);
  assert.equal((await text('[data-testid=breeding-headline]')).trim(), 'Inseminated today');
  assert.equal(await p.locator('[data-testid=attempts] li').count(), 2);
  await go('#/');
  assert.equal(await countOf('count-inseminated'), ins0 + 1);
  assert.match(await text('[data-testid=count-inseminated]'), /inseminations/);
  ok(`2 attempts in history (double tap saved once), count went ${ins0} → ${ins0 + 1}`);

  step('Scenario 3: pregnancy check updates the follow-up list; bull exposure shows a range');
  const aw0 = await countOf('count-awaiting');
  await openCow('42');
  await p.click('.grid-actions button:has-text("Pregnancy check")');
  await choose('result', 'inconclusive');
  await save();
  await go('#/');
  assert.equal(await countOf('count-awaiting'), aw0, 'inconclusive stays on the list');
  await go('#/breeding/awaiting');
  assert.match(await text('main'), /0042[\s\S]*last check inconclusive/);
  await p.click('.brow:has-text("0042") >> text=Check result');
  await choose('result', 'pregnant');
  await save();
  await go('#/');
  assert.equal(await countOf('count-awaiting'), aw0 - 1);
  ok(`inconclusive kept 0042 on the list (${aw0}); pregnant removed her (${aw0 - 1})`);

  await p.click('[data-act=add]');
  await p.fill('#f_code', 'H300');
  await choose('type', 'heifer');
  await p.fill('#f_group', 'Bulling heifers');
  await save();
  await p.waitForSelector('[data-testid=animal-code]');
  await go('#/breeding/exposures');
  await p.click('text=+ Bull with a group');
  await p.fill('#f_bullText', 'Hired Angus');
  await p.fill('#f_group', 'Bulling heifers');
  await p.dispatchEvent('#f_group', 'change');
  await p.fill('#f_start', addDays(today, -60));
  await p.fill('#f_end', addDays(today, -20));
  assert.ok(await p.isChecked('.sheet label:has-text("H300") input'));
  await save();
  await openCow('H300');
  const card = await text('[data-testid=breeding-card]');
  assert.match(card, /With bull/);
  assert.match(card, /Service date not known/);
  assert.match(card, /20–60 days since possible service/);
  assert.match(card, /If pregnant, calving between .+ and .+/);
  assert.doesNotMatch(card, /Inseminated|Served/);
  ok(`no invented service date: "${card.replace(/\s+/g, ' ').trim()}"`);

  step('Scenario 4: milk production, tanker collection, buyer payment → dashboard totals');
  await go('#/data');
  p.once('dialog', (d) => d.accept());
  await p.click('text=Remove sample data');
  await p.waitForTimeout(300);
  await go('#/milk');
  await p.click('[data-act=add][data-kind=session]');
  await choose('session', 'AM'); await p.fill('#f_litres', '500'); await save();
  await p.click('[data-act=add][data-kind=session]');
  await choose('session', 'PM'); await p.fill('#f_litres', '450'); await save();
  await p.click('[data-act=add][data-kind=daily]');
  await p.fill('#f_litres', '960'); await save(); // a tank dip: reference only, not counted again
  await p.click('[data-act=add][data-kind=cow]');
  await p.selectOption('#f_animalId', { label: 'H300' }); await p.fill('#f_litres', '25'); await save();
  await p.click('[data-act=add][data-kind=kept]');
  await choose('use', 'discarded'); await p.fill('#f_litres', '12'); await save();
  assert.equal((await text('[data-testid=p-produced]')).trim(), '950 L');
  await go('#/milk/sales');
  await p.click('text=Milk collection');
  await p.fill('#f_newBuyer', 'Valley Dairies');
  await p.fill('#f_litresAccepted', '900');
  await p.fill('#f_litresRejected', '20');
  await p.fill('#f_reference', 'TK-1001');
  await p.fill('#f_pricePerLitre', '0.5');
  await save();
  await p.click('text=Statement / payment');
  await p.fill('#f_from', `${today.slice(0, 8)}01`);
  await p.fill('#f_to', today);
  await p.fill('#f_bonuses', '15');
  await p.fill('#f_deductions', '5');
  await p.waitForTimeout(100);
  assert.match(await text('.sheet [data-exp]'), /1 collections, 900 L\. Expected €460\.00/);
  await p.fill('#f_statementAmount', '458');
  await p.fill('#f_paymentDate', today);
  await p.fill('#f_paidAmount', '458');
  await save();
  await go('#/');
  await p.click('[data-act=period][data-v=month]');
  const totals = {
    produced: (await text('[data-testid=t-produced]')).trim(), sold: (await text('[data-testid=t-sold]')).trim(),
    expected: (await text('[data-testid=t-expected]')).trim(), received: (await text('[data-testid=t-received]')).trim(),
  };
  assert.deepEqual(totals, { produced: '950 L', sold: '900 L', expected: '€460.00', received: '€458.00' });
  ok(`dashboard: ${JSON.stringify(totals)}`);

  step('Scenario 5: two overlapping treatments keep the milk hold until both are resolved');
  await go('#/');
  await p.click('[data-act=add]');
  await p.fill('#f_code', '0500'); await save();
  await p.waitForSelector('[data-testid=animal-code]');
  await p.click('.grid-actions button:has-text("Treatment")');
  await p.fill('#f_product', 'Tube A');
  await choose('milk', 'yes'); await p.fill('#f_milkPeriod', '60'); await choose('milkUnit', 'hours');
  await save();
  await p.click('.grid-actions button:has-text("Treatment")');
  await p.fill('#f_product', 'Injection B');
  await choose('milk', 'yes'); // end not known yet
  await save();
  let hold = await text('[data-testid=profile-hold]');
  assert.match(hold, /end time missing/); assert.match(hold, /2 overlapping treatments/);
  assert.equal(await p.locator('.timeline .badge:has-text("overlaps")').count(), 2);
  await go('#/'); assert.match(await text('[data-testid=today-hold]'), /0500/);
  await go('#/milk'); assert.match(await text('[data-testid=milk-hold]'), /0500/);
  // Resolve A: its withdrawal ended. Hold stays because of B.
  await p.click('[data-testid=milk-hold] a:has-text("0500")');
  await p.click('.timeline button:has-text("Tube A")');
  await p.fill('#f_milkEndManual', `${addDays(today, -1)}T06:00`);
  await save();
  hold = await text('[data-testid=profile-hold]');
  assert.match(hold, /Injection B/); assert.match(hold, /end time missing/);
  ok('after A resolved: hold still on for B');
  await p.click('[data-testid=profile-hold] >> text=Add withdrawal end time');
  await p.fill('#f_milkEndManual', `${addDays(today, -1)}T07:00`);
  await save();
  assert.equal(await p.locator('[data-testid=profile-hold]').count(), 0);
  await go('#/'); assert.equal(await p.locator('[data-testid=today-hold]').count(), 0);
  ok('after both resolved: hold gone from profile, Today and Milk');

  step('Scenario 6: offline after install: save, close, reopen offline');
  const swOk = await p.evaluate(() => !!navigator.serviceWorker.controller);
  assert.ok(swOk, 'service worker controls the page');
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForFunction(() => window.__dairyReady);
  assert.equal(await p.isVisible('[data-net]'), true);
  await openCow('0500');
  await p.click('.grid-actions button:has-text("Health problem")');
  await choose('condition', 'lameness'); await choose('leg', 'LH');
  await save();
  await ctx.close();
  ctx = await chromium.launchPersistentContext(dir, { ...opts, offline: true });
  p = ctx.pages()[0] || await ctx.newPage();
  watch(p);
  await p.goto(BASE);
  await p.waitForFunction(() => window.__dairyReady);
  await p.fill('[data-testid=login-pin]', '1234');
  await p.click('[data-testid=login-submit]');
  await p.waitForSelector('#find');
  await p.fill('#find', '0500');
  await p.click('[data-testid=search-results] a.row >> nth=0');
  assert.match(await text('[data-testid=timeline]'), /Lameness · LH[\s\S]*entered by Anna/);
  ok('record saved offline is there after closing and reopening with no network');

  step('Backup → restore round trip');
  await ctx.setOffline(false);
  await go('#/data');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('text=Download full backup')]);
  const file = join(dir, 'backup.json');
  await dl.saveAs(file);
  p.once('dialog', (d) => d.accept());
  await p.setInputFiles('[data-restore]', file);
  await p.waitForTimeout(400);
  await go('#/'); await p.fill('#find', '0500');
  assert.equal(await p.locator('[data-testid=search-results] a.row').count(), 1);
  ok('backup downloaded and restored');

  step('Login keeps strangers out');
  await go('#/more');
  await p.click('[data-testid=lock]');
  await p.waitForSelector('[data-testid=login-pin]');
  assert.equal(await p.locator('#find').count(), 0);
  assert.doesNotMatch(await text('main'), /0042|0500|WITHHOLD/);
  assert.equal(await p.isVisible('#nav'), false);
  await go('#/animal/s-0042');
  assert.equal(await p.locator('[data-testid=animal-code]').count(), 0, 'deep link stays locked');
  await p.fill('[data-testid=login-pin]', '9999');
  await p.click('[data-testid=login-submit]');
  await p.waitForSelector('.login .form-error:not([hidden])');
  assert.match(await text('.login .form-error'), /Wrong PIN/);
  await p.fill('[data-testid=login-pin]', '1234');
  await p.click('[data-testid=login-submit]');
  await p.waitForSelector('#nav:not([hidden])');
  ok('locked screen shows no records; wrong PIN refused; right PIN opens');

  step('Polish');
  await go('#/more');
  await p.click('[data-act=lang][data-v=pl]');
  await openCow('0500');
  assert.match(await text('main'), /Historia/);
  assert.match(await text('main'), /Kulawizna/);
  await go('#/');
  assert.match(await text('[data-testid=count-inseminated]'), /Krowy zainseminowane/);
  assert.match(await text('[data-testid=count-awaiting]'), /Czeka na wynik cielności/);
  await p.click('[data-act=period][data-v=month]');
  assert.match(await text('[data-testid=t-expected]'), /460,00/);
  await p.reload();
  await p.waitForFunction(() => window.__dairyReady);
  assert.match(await text('.find-label'), /Znajdź krowę po numerze/);
  ok('switches to Polish, numbers in Polish format, language kept after reload');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nALL SCENARIOS PASSED');
} catch (err) {
  await p.screenshot({ path: join(process.cwd(), 'e2e-failure.png'), fullPage: true }).catch(() => {});
  console.error('\nFAILED:', err.message, errors.length ? `\npage errors: ${errors.join('\n')}` : '');
  process.exitCode = 1;
} finally {
  await ctx.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
