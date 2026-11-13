// Super reactions, who-reacted preview and viewer, and the group DM options panel.
// Usage: node e2e/reactions.cjs http://localhost:3900 <screenshot-dir>
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const SFX = Date.now().toString(36).slice(-5);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const seen = (loc, ms = 6000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch();
  const mk = async (name, vp = { width: 1280, height: 800 }) => {
    const c = await b.newContext({ viewport: vp, deviceScaleFactor: 1 });
    await c.addInitScript(() => { try { for (const k of ['send.desktop-prompt.dismissed.v1', 'send.android-prompt.dismissed.v1', 'send.ios-prompt.dismissed.v1']) localStorage.setItem(k, '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); } catch {} });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    return { c, p, errs, name };
  };
  const A = await mk('a'), B = await mk('b'), C = await mk('c');
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  for (const x of [A, B, C]) {
    await x.p.goto(BASE + '/login');
    const r = await api(x, 'POST', '/api/auth/register', { email: `rx_${x.name}_${SFX}@example.test`, username: `rx_${x.name}_${SFX}`, password: 'correct horse battery', display_name: { a: 'Ada', b: 'Bo', c: 'Cy' }[x.name] });
    if (r.status >= 300) throw new Error('register ' + JSON.stringify(r));
    x.id = r.body?.user?.id ?? (await api(x, 'GET', '/api/users/@me')).body.id;
  }
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Reaction Lab' })).body;
  const text = g.channels.find((c) => c.type === 0);
  const inv = (await api(A, 'POST', `/api/channels/${text.id}/invites`, {})).body;
  for (const x of [B, C]) await api(x, 'POST', `/api/invites/${inv.code}`);
  const msg = (await api(A, 'POST', `/api/channels/${text.id}/messages`, { content: 'react to this one' })).body;
  const base = `/api/channels/${text.id}/messages/${msg.id}/reactions/${encodeURIComponent('🔥')}`;
  check('API: normal reaction', (await api(C, 'PUT', base + '/@me')).status === 200);
  check('API: super reaction on the same emoji is separate', (await api(C, 'PUT', base + '/@me?type=burst')).status === 200);
  const list = (await api(C, 'GET', `/api/channels/${text.id}/messages?limit=5`)).body.find((m) => m.id === msg.id);
  check('API: message has a normal and a burst entry', list.reactions.length === 2 && list.reactions.some((r) => r.burst && r.count === 1) && list.reactions.some((r) => !r.burst && r.count === 1), JSON.stringify(list.reactions));
  check('API: who reacted (burst)', (await api(A, 'GET', base + '?type=burst')).body.length === 1);

  // B watches the channel, A super reacts in the UI.
  for (const x of [A, B]) { await x.p.goto(`${BASE}/channels/${g.id}/${text.id}`); await seen(x.p.locator(`[data-mid="${msg.id}"]`), 15000); }
  const am = A.p.locator(`[data-mid="${msg.id}"]`);
  await am.hover();
  await am.locator('.msg-tools [aria-label="Add super reaction"]').click();
  const picker = A.p.locator('.emoji-picker, [role="dialog"][aria-label*="moji"]').first();
  check('Super reaction button opens the picker', await seen(picker, 4000));
  const fire = picker.getByRole('button', { name: /🔥|fire/i }).first();
  const burstSeenB = B.p.waitForSelector('.burst-layer', { state: 'attached', timeout: 6000 }).then(() => true, () => false);
  if (await fire.count()) await fire.click(); else { await A.p.keyboard.type('fire'); await A.p.waitForTimeout(300); await picker.getByRole('button', { name: /🔥|fire/i }).first().click(); }
  check('Burst animation plays for the reactor', await A.p.waitForSelector('.burst-layer', { state: 'attached', timeout: 3000 }).then(() => true, () => false));
  await A.p.waitForTimeout(250); await A.p.screenshot({ path: `${OUT}/reactions-burst.png` });
  check('Burst animation plays for others watching', await burstSeenB);
  const chip = am.locator('.reaction.burst');
  check('Super reaction chip shows with count 2', await seen(chip.filter({ hasText: '2' }), 5000));
  await A.p.waitForTimeout(1600);
  // hover preview
  await A.p.mouse.move(5, 5); await chip.hover();
  const tip = A.p.locator('.reaction-tip');
  check('Hovering a reaction previews who reacted', await seen(tip, 3000) && /Cy|Ada/.test(await tip.textContent()), await tip.textContent().catch(() => ''));
  await A.p.screenshot({ path: `${OUT}/reactions-tip.png` });
  // right-click viewer
  await chip.click({ button: 'right' });
  await A.p.getByRole('menuitem', { name: 'View reactions' }).click();
  const viewer = A.p.locator('.reactions-viewer');
  check('Right-click, View reactions opens the viewer', await seen(viewer, 3000));
  check('Viewer lists everyone who super reacted', await seen(viewer.locator('.rv-user', { hasText: 'Cy' }), 4000) && await seen(viewer.locator('.rv-user', { hasText: 'Ada' }), 4000));
  check('Viewer has a tab per reaction kind', (await viewer.locator('.rv-tab').count()) === 2);
  await A.p.screenshot({ path: `${OUT}/reactions-viewer.png` });
  await viewer.locator('.rv-tab:not(.burst)').click(); await A.p.waitForTimeout(700);
  check('Normal tab shows the normal reactors', await seen(viewer.locator('.rv-user', { hasText: 'Cy' }), 3000) && (await viewer.locator('.rv-user').count()) === 1);
  await A.p.keyboard.press('Escape');
  // removing my super reaction
  await chip.click();
  check('Clicking my super reaction removes mine', await seen(am.locator('.reaction.burst').filter({ hasText: '1' }), 4000));

  // Group DM options on a phone
  const P = await mk('p', { width: 390, height: 844 });
  await P.p.goto(BASE + '/login');
  await api(P, 'POST', '/api/auth/login', { login: `rx_a_${SFX}@example.test`, password: 'correct horse battery' });
  for (const [x, y] of [[A, B], [A, C]]) { await api(x, 'POST', '/api/users/@me/relationships', { username: `rx_${y.name}_${SFX}` }); await api(y, 'PUT', `/api/users/@me/relationships/${x.id}`, { type: 1 }); }
  const gdm = await api(A, 'POST', '/api/users/@me/channels', { recipients: [B.id, C.id] });
  check('Group DM created', gdm.status < 300, JSON.stringify(gdm.body).slice(0, 120));
  if (gdm.status < 300) {
    await P.p.goto(`${BASE}/channels/@me/${gdm.body.id}`); await P.p.waitForTimeout(1500);
    const title = P.p.locator('.ch-title, .m-ch-title, header button').filter({ hasText: /Bo|Cy/ }).first();
    if (await title.count()) await title.click();
    const actions = P.p.locator('.m-info .group-actions');
    check('Group info shows the options list', await seen(actions, 5000));
    if (await actions.count()) { await P.p.waitForTimeout(700);
      const box = await P.p.locator('.m-info-members .side-panel').evaluate((e) => { const s = getComputedStyle(e); return { border: s.borderLeftWidth, bg: s.backgroundColor }; });
      check('No box behind the member list', box.border === '0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(box.bg), JSON.stringify(box));
      const r = await actions.boundingBox();
      check('Options sit away from the screen edges', r.x >= 14 && r.x + r.width <= 390 - 14, JSON.stringify(r));
      await P.p.screenshot({ path: `${OUT}/group-info.png` });
    }
  }
  const errs = [...A.errs, ...B.errs, ...C.errs, ...P.errs];
  check('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
