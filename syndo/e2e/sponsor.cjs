// Sponsor page: presets, custom amount validation, a signed Stripe webhook recording a sponsorship, the badge, and hiding it.
// Needs the server started with STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET=whsec_localtest. Usage: node e2e/sponsor.cjs http://localhost:3900 <out dir>
const { chromium } = require('playwright');
const crypto = require('crypto');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const SFX = Date.now().toString(36).slice(-5);
const results = [];
const check = (name, ok, extra = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const seen = (loc, ms = 6000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await c.addInitScript(() => { try { for (const k of ['send.desktop-prompt.dismissed.v1']) localStorage.setItem(k, '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); } catch {} });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  await p.goto(BASE + '/login');
  const me = (await api('POST', '/api/auth/register', { email: `sp_${SFX}@example.test`, username: `sp_${SFX}`, password: 'correct horse battery', display_name: 'Sponsor Sam' })).body.user.id;
  const info = (await api('GET', '/api/sponsor')).body;
  check('API: sponsor info with presets £1, £5, £10', info.available === true && JSON.stringify(info.presets) === '[100,500,1000]', JSON.stringify(info));
  check('API: refuses amounts under £1', (await api('POST', '/api/sponsor/checkout', { amount_pence: 50 })).status === 400);

  await p.goto(BASE + '/channels/@me?sponsor=manage');
  const page = p.locator('.sponsor');
  check('Returning from Stripe opens the Sponsor page', await seen(page, 10000));
  check('Four options: £1, £5, £10, Custom', (await page.locator('.sponsor-option').allTextContents()).join('|').replace(/\s/g, '') === '£1/month|£5/month|£10/month|Custom/month');
  check('£5 is chosen by default', /Sponsor £5\/month/.test(await page.locator('.sponsor-go').textContent()));
  await page.locator('.sponsor-option', { hasText: 'Custom' }).click();
  await page.locator('.sponsor-custom input').fill('0.50');
  check('Custom below £1 is refused', await page.locator('.sponsor-go').isDisabled() && await seen(page.locator('.danger-text'), 2000));
  await page.locator('.sponsor-custom input').fill('3.50');
  check('Custom £3.50 is accepted', /Sponsor £3\.50\/month/.test(await page.locator('.sponsor-go').textContent()) && !(await page.locator('.sponsor-go').isDisabled()));
  await p.screenshot({ path: `${OUT}/sponsor.png` });

  // Stripe tells us the subscription is active (signed exactly like Stripe does).
  const ev = { type: 'customer.subscription.updated', data: { object: { id: `sub_${SFX}`, customer: `cus_${SFX}`, status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, metadata: { kind: 'sponsor', user_id: me }, items: { data: [{ price: { unit_amount: 350 } }] } } } };
  const body = JSON.stringify(ev), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_localtest').update(`${t}.${body}`).digest('hex');
  const r = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body });
  check('Signed webhook accepted', r.status === 200, String(r.status));
  const bad = await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` }, body });
  check('Forged webhook refused', bad.status >= 400, String(bad.status));
  check('Page switches to "You\'re sponsoring £3.50/month"', await seen(page.locator('.sponsor-active', { hasText: '£3.50/month' }), 6000));
  await p.screenshot({ path: `${OUT}/sponsor-active.png` });
  check('Profile shows the Sponsor badge', (await api('GET', `/api/users/${me}/profile`)).body.sponsor === true);
  await page.locator('.sponsor-active input[type=checkbox], .sponsor-active [role=switch]').first().click();
  await p.waitForTimeout(500);
  check('Hiding the badge works', (await api('GET', `/api/users/${me}/profile`)).body.sponsor === false);
  check('Can\'t start a second sponsorship', (await api('POST', '/api/sponsor/checkout', { amount_pence: 500 })).status === 400);
  // cancelled
  const ev2 = { ...ev, type: 'customer.subscription.deleted' }; const b2 = JSON.stringify(ev2);
  await fetch(`${BASE}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${crypto.createHmac('sha256', 'whsec_localtest').update(`${t}.${b2}`).digest('hex')}` }, body: b2 });
  check('Cancelled sponsorship returns to the options', await seen(page.locator('.sponsor-options'), 6000));
  // phones in the apps never see it
  const app = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 16) Mobile SENDAndroid/0.7.1' });
  const ap = await app.newPage(); await ap.goto(BASE + '/login');
  await ap.evaluate(async (u) => fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-send-client': '1' }, body: JSON.stringify({ login: u, password: 'correct horse battery' }) }), `sp_${SFX}@example.test`);
  await ap.goto(BASE + '/channels/@me'); await ap.waitForTimeout(2500);
  await ap.evaluate(() => window.dispatchEvent(new CustomEvent('send:dialog', { detail: { kind: 'userSettings', tab: 'account' } })));
  const tabs = ap.locator('.settings-nav [role=tab]');
  await seen(tabs.first(), 6000);
  const names = await tabs.allTextContents();
  check('Sponsor tab hidden in the Android app', names.length > 5 && !names.includes('Sponsor'), names.join(', '));
  const webTabs = await (async () => { await p.evaluate(() => window.dispatchEvent(new CustomEvent('send:dialog', { detail: { kind: 'userSettings', tab: 'account' } }))); await p.waitForTimeout(500); return p.locator('.settings-nav [role=tab]').allTextContents(); })();
  check('Sponsor tab shown on the web', webTabs.includes('Sponsor'));
  check('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x.ok).length; console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
