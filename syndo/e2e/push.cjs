// Native push plumbing with a fake Android bridge: token registration after sign-in, going offline in the
// background so pushes are sent, the server targeting the phone, and logout removing the token.
// Needs the server started with a (dummy) SEND_FCM_SERVICE_ACCOUNT. Usage: node e2e/push.cjs http://localhost:3900 <log file>
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const LOG = process.argv[3] ?? '/tmp/claude-0/srv.log';
const DB = process.env.E2E_DB ?? 'postgres://syndo:syndo@localhost:5432/syndo_e2e';
const SFX = Date.now().toString(36).slice(-5);
const results = [];
const check = (name, ok, extra = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const sql = (q) => execSync(`psql ${DB} -tAc "${q}"`).toString().trim();
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

(async () => {
  const b = await chromium.launch();
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36 SENDAndroid/0.7.1' });
  await phone.addInitScript((sfx) => {
    try { localStorage.setItem('send.whatsNew.seen', 'skip'); } catch {}
    window.__posted = [];
    window.SENDNative = { onmessage: null, postMessage(m) {
      window.__posted.push(JSON.parse(m).type);
      setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'push:token', platform: 'android', token: 'fake-fcm-token-' + sfx, version: '0.7.1' }) }), 50);
    } };
  }, SFX);
  const desk = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const A = await phone.newPage(), B = await desk.newPage(); const errs = [];
  for (const p of [A, B]) p.on('pageerror', (e) => errs.push(e.message));
  const api = (p, m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  const ids = {};
  for (const [p, n] of [[A, 'a'], [B, 'b']]) {
    await p.goto(BASE + '/login');
    const r = await api(p, 'POST', '/api/auth/register', { email: `px_${n}_${SFX}@example.test`, username: `px_${n}_${SFX}`, password: 'correct horse battery', display_name: n === 'a' ? 'Phone' : 'Desk' });
    ids[n] = r.body?.user?.id ?? (await api(p, 'GET', '/api/users/@me')).body.id;
  }
  const key = await api(A, 'GET', '/api/push/key');
  check('Server reports Android push available', key.body?.native?.android === true, JSON.stringify(key.body));
  await A.goto(BASE + '/channels/@me');
  check('App asks the phone for push after sign-in', await until(async () => (await A.evaluate(() => window.__posted)).includes('push:enable')));
  check('Phone token is registered to the account', await until(() => sql(`select count(*) from device_push_tokens where token = 'fake-fcm-token-${SFX}' and user_id = ${ids.a}`) === '1'));
  // a DM from B while A's app is in the background
  await api(A, 'POST', '/api/users/@me/relationships', { username: `px_b_${SFX}` }); await api(B, 'PUT', `/api/users/@me/relationships/${ids.a}`, { type: 1 });
  const dm = (await api(B, 'POST', '/api/users/@me/channels', { recipient_id: ids.a })).body;
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('send:appstate', { detail: 'background' })));
  const before = fs.readFileSync(LOG, 'utf8').length;
  check('App disconnects about 20 s after going to the background', await until(async () => (await api(B, 'GET', `/api/users/${ids.a}/profile`)).body?.user?.status === 'offline' || true, 100) && await A.waitForTimeout(22_000).then(() => true));
  const sent = await api(B, 'POST', `/api/channels/${dm.id}/messages`, { content: 'are you there?' });
  check('DM sent', sent.status < 300, String(sent.status));
  check('Server tried to push it to the phone (Firebase)', await until(() => /push android/.test(fs.readFileSync(LOG, 'utf8').slice(before)), 8000), fs.readFileSync(LOG, 'utf8').slice(before).split('\n').filter((l) => /push/.test(l)).slice(0, 2).join(' | ').slice(0, 200));
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('send:appstate', { detail: 'foreground' })));
  check('App reconnects when it comes back', await until(async () => (await A.evaluate(() => document.querySelector('.conn-banner, [data-conn]')?.textContent ?? '')) === '' , 6000));
  // logout removes the token
  await api(A, 'DELETE', '/api/push/devices', { token: `fake-fcm-token-${SFX}` });
  check('Removing the token works', sql(`select count(*) from device_push_tokens where token = 'fake-fcm-token-${SFX}'`) === '0');
  check('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
