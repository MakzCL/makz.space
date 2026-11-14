const { chromium } = require('playwright'); const { execSync } = require('child_process');
const BASE = 'http://localhost:3900', OUT = process.argv[2], DB = 'postgres://syndo:syndo@localhost:5432/syndo_e2e';
const SFX = Date.now().toString(36).slice(-4);
const sql = (q) => execSync(`psql ${DB} -qtAc "${q}"`).toString().trim();
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + __dirname + '/cam.y4m', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (vp = { width: 1280, height: 720 }) => { const c = await b.newContext({ viewport: vp, deviceScaleFactor: 1.5, permissions: ['microphone', 'camera'] });
    await c.addInitScript(() => { try { localStorage.setItem('send.whatsNew.seen', 'skip'); for (const k of ['send.desktop-prompt.dismissed.v1', 'send.android-prompt.dismissed.v1']) localStorage.setItem(k, '1'); } catch {} });
    const p = await c.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 160))); return p; };
  const api = (p, m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  const people = [['Makz', 'fx-crimson-static'], ['Ava', 'fx-liquid-platinum'], ['Kai', 'fx-neon-circuit'], ['Rin', 'sakura']];
  const ps = [];
  for (const [name, fx] of people) { const p = await mk(); await p.goto(BASE + '/login');
    const r = await api(p, 'POST', '/api/auth/register', { email: `${name.toLowerCase()}${SFX}@example.test`, username: `${name.toLowerCase()}${SFX}`, password: 'correct horse battery', display_name: name });
    p.uid = r.body.user.id; p.name = name;
    await api(p, 'PATCH', '/api/users/@me', { profile_theme: { collection: fx } }); ps.push(p); }
  const [A, B2, C, D] = ps;
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Night Owls' })).body;
  const text = g.channels.find((c) => c.type === 0), voice = g.channels.find((c) => c.type === 2);
  const inv = (await api(A, 'POST', `/api/channels/${text.id}/invites`, {})).body;
  for (const p of [B2, C, D]) await api(p, 'POST', `/api/invites/${inv.code}`);
  const lines = [[B2, 'anyone up for a late session tonight?'], [C, 'always. new map dropped today'], [A, 'I set up the call, jump in whenever'], [D, 'just changed my profile effect, look at it'], [B2, 'the platinum one is so clean'], [A, 'Crimson Static has fairy lights now. the lightning crawls the edge of the card']];
  for (const [p, t] of lines) { await api(p, 'POST', `/api/channels/${text.id}/messages`, { content: t }); await new Promise((r) => setTimeout(r, 150)); }
  // chat
  await A.goto(`${BASE}/channels/${g.id}/${text.id}`); await A.waitForTimeout(5000);
  await A.screenshot({ path: `${OUT}/chat.png` });
  // store
  const tab = async (id) => { await A.locator(`[data-tab="${id}"]`).click(); await A.waitForTimeout(2500); };
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('send:dialog', { detail: { kind: 'userSettings', tab: 'effects' } }))); await A.waitForTimeout(3000);
  await A.screenshot({ path: `${OUT}/store.png` });
  const chip = A.getByRole('tab', { name: /Supernatural Cinema/ }); if (await chip.count()) { await chip.click(); await A.waitForTimeout(800); }
  await A.locator('.collection-grid').evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {}); await A.locator('.collection-tile').nth(1).hover().catch(() => {}); await A.waitForTimeout(2500);
  await A.screenshot({ path: `${OUT}/store-grid.png` });
  // sparks
  sql(`update users set avatar_key='avatars/x/a.webp', banner_key='banners/x/b.webp', bio='hello' where id=${A.uid}`);
  sql(`insert into challenge_progress(user_id, season, key, progress) values (${A.uid},'2026','messages',64),(${A.uid},'2026','calltime',182),(${A.uid},'2026','bigcall',10),(${A.uid},'2026','golive',9),(${A.uid},'2026','reactions',31),(${A.uid},'2026','days',12) on conflict do nothing`);
  await tab('boosts');
  await A.screenshot({ path: `${OUT}/boosts.png` });
  await A.locator('.sparks').evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {}); await A.waitForTimeout(800);
  await A.screenshot({ path: `${OUT}/sparks.png` });
  const ready = A.locator('.challenge.ready .challenge-claim').first();
  if (await ready.count()) { await ready.click(); await A.waitForTimeout(450); await A.screenshot({ path: `${OUT}/sparks-claim.png` }); await A.waitForTimeout(2500); await A.screenshot({ path: `${OUT}/sparks-after.png` }); }
  // sponsor
  await tab('sponsor');
  await A.screenshot({ path: `${OUT}/sponsor.png` });
  // voice settings
  await tab('voice');
  await A.screenshot({ path: `${OUT}/voice-settings.png` });
  await A.keyboard.press('Escape'); await A.waitForTimeout(500);
  // call
  for (const p of [A, B2, C, D]) { await p.goto(`${BASE}/channels/${g.id}/${voice.id}`); await p.waitForTimeout(1500);
    const join = p.getByRole('button', { name: /join voice|join call|^join$/i }).first(); if (await join.count()) await join.click().catch(() => {}); await p.waitForTimeout(2500); }
  for (const p of [B2, C]) { const cam = p.getByRole('button', { name: /turn on camera|camera/i }).first(); if (await cam.count()) await cam.click().catch(() => {}); }
  await A.waitForTimeout(6000);
  await A.screenshot({ path: `${OUT}/call.png` });
  const share = A.getByRole('button', { name: 'Share screen', exact: true }).first();
  if (await share.count()) { await share.click().catch(() => {}); await A.waitForTimeout(2000); await A.screenshot({ path: `${OUT}/share-dialog.png` }); }
  await b.close();
})();
