// Sparks: challenges, claiming, buying a boost, invite links, and the grouped boost list.
// Usage: node e2e/sparks.cjs http://localhost:3900 <out dir>
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const BASE = process.argv[2] ?? 'http://localhost:3900', OUT = process.argv[3] ?? '.';
const DB = process.env.E2E_DB ?? 'postgres://syndo:syndo@localhost:5432/syndo_e2e';
const SFX = Date.now().toString(36).slice(-5); const results = [];
const check = (n, ok, x = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${x}`); };
const seen = (l, ms = 6000) => l.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
(async () => {
  const b = await chromium.launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 900 } }); await c.addInitScript(() => { try { localStorage.setItem('send.whatsNew.seen', 'skip'); localStorage.setItem('send.desktop-prompt.dismissed.v1', '1'); } catch {} }); const p = await c.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); return p; };
  const A = await mk(), B = await mk();
  const api = (p, m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  await A.goto(BASE + '/login');
  const a = (await api(A, 'POST', '/api/auth/register', { email: `sk_a_${SFX}@example.test`, username: `sk_a_${SFX}`, password: 'correct horse battery' })).body.user;
  let s = (await api(A, 'GET', '/api/sparks')).body;
  check('14 challenges (enough for Level 3), 0 Sparks to start', s.challenges.length === 14 && s.balance === 0, s.challenges.map((c) => c.key).join(','));
  check('Invite link includes your username', s.invite_link.endsWith(`/register?ref=sk_a_${SFX}`));
  check('Claiming an unfinished challenge is refused', (await api(A, 'POST', '/api/sparks/claim/messages')).status === 400);
  // B joins through A's invite link and sends 5 messages
  await B.goto(BASE + `/register?ref=sk_a_${SFX}`);
  const reg = await B.evaluate(async (sfx) => { const ref = new URLSearchParams(location.search).get('ref'); const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json', 'x-send-client': '1' }, body: JSON.stringify({ email: `sk_b_${sfx}@example.test`, username: `sk_b_${sfx}`, password: 'correct horse battery', ref }) }); return (await r.json()).user; }, SFX);
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Spark Lab' })).body; const ch = g.channels.find((c) => c.type === 0);
  const inv = (await api(A, 'POST', `/api/channels/${ch.id}/invites`, {})).body; await api(B, 'POST', `/api/invites/${inv.code}`);
  for (let i = 0; i < 5; i++) await api(B, 'POST', `/api/channels/${ch.id}/messages`, { content: `hi ${i}` });
  s = (await api(A, 'GET', '/api/sparks')).body;
  check('Friend who joined with the link and sent 5 messages counts', s.challenges.find((c) => c.key === 'invite').progress === 1);
  // A sends 100 messages, claims, buys a boost
  for (let i = 0; i < 100; i++) { await api(A, 'POST', `/api/channels/${ch.id}/messages`, { content: `m ${i}` }); await A.waitForTimeout(360); }
  check('Message challenge reaches 100', (await api(A, 'GET', '/api/sparks')).body.challenges.find((c) => c.key === 'messages').progress === 100);
  const cl = await api(A, 'POST', '/api/sparks/claim/messages');
  check('Claim gives 100 Sparks', cl.status === 200 && cl.body.balance === 100, JSON.stringify(cl.body));
  check('Claiming twice is refused', (await api(A, 'POST', '/api/sparks/claim/messages')).status === 400);
  check('Buying 2 boosts with 100 Sparks is refused', (await api(A, 'POST', '/api/sparks/boosts', { count: 2 })).status === 400);
  const buy = await api(A, 'POST', '/api/sparks/boosts', { count: 1 });
  check('Buying a boost spends 100 Sparks', buy.status === 200 && buy.body.balance === 0);
  const prem = (await api(A, 'GET', '/api/premium')).body; const boost = prem.boosts[0];
  const days = boost?.current_period_end ? Math.round((Date.parse(boost.current_period_end) - Date.now()) / 86400000) : 0;
  check('The boost lasts a year', prem.boosts.length === 1 && days >= 364 && days <= 366, `${days} days`);
  // lots of boosts on one server show as one row
  execSync(`psql ${DB} -c "insert into spark_ledger(id, user_id, amount, reason, ref) values (${Date.now()}, ${a.id}, 1200, 'grant', 'test-${SFX}')"`);
  await api(A, 'POST', '/api/sparks/boosts', { count: 12 });
  for (const x of (await api(A, 'GET', '/api/premium')).body.boosts.slice(0, 10)) await api(A, 'PUT', `/api/premium/boosts/${x.id}`, { guild_id: g.id });
  await A.goto(BASE + '/channels/@me');
  await A.waitForTimeout(1500);
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('send:dialog', { detail: { kind: 'userSettings', tab: 'boosts' } })));
  const groups = A.locator('.boost-group');
  await seen(groups.first(), 8000);
  const texts = await groups.allTextContents();
  check('13 boosts show as 2 rows (10 on Spark Lab, 3 unused)', texts.length === 2 && texts.some((t) => /^10.*Spark Lab/.test(t)) && texts.some((t) => /^3.*Not used yet/.test(t)), texts.join(' | '));
  check('Sparks card shows balance and challenges', await seen(A.locator('.sparks .challenge').first()) && (await A.locator('.sparks h3').textContent()).includes('0 Sparks'));
  await A.locator('.sparks').screenshot({ path: `${OUT}/sparks.png` });
  await A.locator('.boost-group').first().screenshot({ path: `${OUT}/boost-group.png` });
  // move 1 boost from the unused group via the select
  const unused = A.locator('.boost-group.unused select');
  await unused.selectOption({ label: '1 boost to Spark Lab' }); await A.waitForTimeout(1500);
  const after = await A.locator('.boost-group').allTextContents();
  check('Using 1 unused boost moves it to the server', after.some((t) => /^11.*Spark Lab/.test(t)) && after.some((t) => /^2.*Not used yet/.test(t)), after.join(' | '));
  check('No page errors', !A.errs.length && !B.errs.length, [...A.errs, ...B.errs].join(' | '));
  await b.close(); const f = results.filter((r) => !r.ok).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
