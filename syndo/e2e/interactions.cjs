// Interaction-consistency checks: layers, dismissal, focus/scroll restoration, context menus, tooltips.
// Usage: node e2e/interactions.cjs http://localhost:3900 <screenshot-dir>
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const SFX = Date.now().toString(36).slice(-5);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const seen = (loc, ms = 6000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const gone = (loc, ms = 4000) => loc.waitFor({ state: 'hidden', timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch();
  const mk = async (name) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => { try { localStorage.setItem('send.desktop-prompt.dismissed.v1', '1'); } catch {} });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('dialog', (d) => { errs.push('NATIVE DIALOG: ' + d.message()); d.dismiss(); });
    return { c, p, errs, name };
  };
  const A = await mk('a'), B = await mk('b');
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-syndo-client': '1' } : { 'x-syndo-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  for (const x of [A, B]) {
    await x.p.goto(BASE + '/login');
    const r = await api(x, 'POST', '/api/auth/register', { email: `ix_${x.name}_${SFX}@example.test`, username: `ix_${x.name}_${SFX}`, password: 'correct horse battery', display_name: x.name === 'a' ? 'Ada' : 'Bo' });
    if (r.status >= 300) throw new Error('register ' + JSON.stringify(r));
    x.id = r.body?.user?.id ?? (await api(x, 'GET', '/api/users/@me')).body.id;
  }
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Layer Lab' })).body;
  const text = g.channels.find((c) => c.type === 0);
  const inv = (await api(A, 'POST', `/api/channels/${text.id}/invites`, {})).body;
  const joined = await api(B, 'POST', `/api/invites/${inv.code}`); if (joined.status >= 300) throw new Error('join ' + JSON.stringify(joined));
  // A posts filler + a message with two images (PNG generated in the page).
  for (let i = 0; i < 25; i++) await api(A, 'POST', `/api/channels/${text.id}/messages`, { content: `filler ${i}` });
  const ids = await A.p.evaluate(async (cid) => {
    const png = async (color) => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 320, 200); return new Promise((r) => c.toBlob(r, 'image/png')); };
    const out = [];
    for (const [i, col] of [['one', '#c33'], ['two', '#3a3']]) { const f = new FormData(); f.append('file', new File([await png(col)], `${i}.png`, { type: 'image/png' })); const r = await fetch(`/api/channels/${cid}/attachments`, { method: 'POST', body: f, headers: { 'x-syndo-client': '1' } }); out.push((await r.json()).id); }
    return out;
  }, text.id);
  await api(A, 'POST', `/api/channels/${text.id}/messages`, { content: 'two pictures', attachment_ids: ids });
  for (let i = 0; i < 3; i++) await api(A, 'POST', `/api/channels/${text.id}/messages`, { content: `after ${i}` });

  const p = B.p;
  await p.goto(`${BASE}/channels/${g.id}/${text.id}`);
  const composer = p.getByRole('textbox', { name: /Message/ });
  await composer.waitFor({ timeout: 15000 }).catch(async (e) => { await p.screenshot({ path: OUT + '/debug.png' }); console.log('URL', p.url(), B.errs.join(' | ')); throw e; });

  /* ---- rail pill stays in the gutter */
  const rail = p.locator('.rail-slot .rail-item').first();
  await rail.locator('button').hover();
  await p.waitForTimeout(250);
  const geo = await rail.evaluate((el) => { const pill = el.querySelector('.pill').getBoundingClientRect(), btn = el.querySelector('button').getBoundingClientRect(); return { pillRight: pill.right, btnLeft: btn.left, pillH: pill.height }; });
  check('Rail pill sits left of the server icon (no overlap)', geo.pillRight <= geo.btnLeft + 0.5 && geo.pillH > 0, JSON.stringify(geo));
  check('Rail tooltip is themed and beside the icon', await seen(p.locator('.tooltip[data-side=right]', { hasText: 'Layer Lab' }), 2000));
  await p.mouse.move(640, 400);
  check('Tooltip hides on pointer exit', await gone(p.locator('.tooltip')));

  /* ---- media viewer */
  await composer.fill('draft stays put');
  const imgBtn = p.getByRole('button', { name: 'Open image one.png' });
  await imgBtn.scrollIntoViewIfNeeded();
  const scrollBefore = await p.locator('.msgs').evaluate((el) => el.scrollTop);
  await imgBtn.click();
  const viewer = p.getByRole('dialog', { name: /Media viewer/ });
  check('Clicking an image opens the media viewer', await seen(viewer));
  check('Viewer shows gallery position', await seen(viewer.getByText('1 / 2'), 2000));
  await p.keyboard.press('ArrowRight');
  check('ArrowRight moves to the next image', await seen(viewer.getByText('2 / 2'), 2000));
  await viewer.locator('img.viewer-media').click();
  check('Clicking the image itself does not close the viewer', await viewer.isVisible());
  await viewer.getByRole('button', { name: 'Previous' }).click();
  check('Viewer controls do not close it', await viewer.isVisible() && await viewer.getByText('1 / 2').isVisible());
  const stage = await viewer.locator('.viewer-stage').boundingBox();
  await p.mouse.click(stage.x + 30, stage.y + stage.height - 20);
  check('Clicking the backdrop closes the viewer', await gone(viewer));
  check('Focus returns to the image that opened it', await imgBtn.evaluate((el) => document.activeElement === el));
  check('Chat scroll position preserved', Math.abs((await p.locator('.msgs').evaluate((el) => el.scrollTop)) - scrollBefore) < 2);
  check('Draft text preserved', (await composer.inputValue()) === 'draft stays put');
  await imgBtn.click(); await seen(viewer);
  await p.keyboard.press('Escape');
  check('Escape closes the viewer', await gone(viewer));
  check('Escape did not clear the draft', (await composer.inputValue()) === 'draft stays put');

  /* ---- context menu: viewport clamp, submenu, keyboard */
  const msg = p.locator('article.msg', { hasText: 'two pictures' });
  const box = await msg.boundingBox();
  await p.mouse.click(box.x + box.width - 4, box.y + 10, { button: 'right' });
  const menu = p.locator('.ctx-menu').first();
  check('Right-click opens a themed context menu', await seen(menu));
  await p.mouse.click(box.x + box.width - 4, box.y + 10, { button: 'right' }); // re-open near the right edge
  const mb = await menu.boundingBox();
  check('Context menu stays inside the viewport', mb.x >= 0 && mb.x + mb.width <= 1280 && mb.y >= 0 && mb.y + mb.height <= 800, JSON.stringify(mb));
  await menu.getByRole('menuitem', { name: 'Add reaction' }).hover();
  const sub = p.locator('.ctx-menu').nth(1);
  check('Hovering "Add reaction" opens its submenu', await seen(sub, 2000));
  const sb = await sub.boundingBox();
  await p.mouse.move(sb.x + 20, sb.y + 20, { steps: 6 });
  await p.waitForTimeout(400);
  check('Submenu stays open while moving into it', await sub.isVisible());
  await p.keyboard.press('Escape');
  check('Escape closes only the submenu first', await gone(sub) && await menu.isVisible());
  await p.keyboard.press('Escape');
  check('Second Escape closes the menu', await gone(menu));
  check('Menu Escape did not clear the draft', (await composer.inputValue()) === 'draft stays put');
  await msg.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Add reaction' }).hover(); await seen(sub, 2000);
  await sub.getByRole('menuitemcheckbox').first().click();
  check('Choosing from the submenu reacts and closes the menu', await gone(menu) && await seen(msg.locator('.reaction.me'), 4000));
  await msg.click({ button: 'right' });
  check('Message menu hides author-only actions (no Edit/Delete on others\' messages)', !(await menu.getByRole('menuitem', { name: 'Edit message' }).count()) && !(await menu.getByRole('menuitem', { name: 'Delete message' }).count()));
  await p.mouse.click(5, 790);
  check('Outside press closes the context menu', await gone(menu));

  /* ---- profile popout */
  const name = msg.locator('.msg-name').first().or(p.locator('article.msg .msg-name').last());
  const nameBtn = p.locator('article.msg .msg-name').last();
  await nameBtn.click();
  const card = p.locator('.profile-card');
  check('Clicking a name opens the profile popout', await seen(card));
  await nameBtn.click();
  check('Clicking the same name again closes it', await gone(card));
  await nameBtn.click(); await seen(card);
  await p.mouse.click(640, 30);
  check('Outside press closes the profile popout', await gone(card));
  await nameBtn.focus(); await p.keyboard.press('Enter'); await seen(card);
  await p.keyboard.press('Escape');
  check('Escape closes the popout and restores focus', await gone(card) && await nameBtn.evaluate((el) => document.activeElement === el));
  void name;

  /* ---- emoji picker toggles from its button */
  await msg.hover();
  const addBtn = msg.locator('.msg-tools [aria-label="Add reaction"]');
  await addBtn.click();
  const picker = p.getByRole('dialog', { name: 'Pick an emoji' });
  check('Reaction button opens the emoji picker', await seen(picker));
  await addBtn.click();
  check('Pressing the same button again closes the picker', await gone(picker));

  /* ---- server menu popover */
  const gm = p.locator('.guild-menu-btn');
  await gm.click();
  const gmenu = p.getByRole('menu', { name: /Layer Lab options/ });
  check('Server header opens its menu', await seen(gmenu));
  await gm.click();
  check('Pressing the header again closes it', await gone(gmenu));
  await gm.click(); await seen(gmenu);
  await p.mouse.click(900, 400);
  check('Outside press closes the server menu', await gone(gmenu));

  /* ---- dropdown inside a dialog: Escape closes only the dropdown */
  await p.getByRole('button', { name: 'User settings' }).first().click();
  const dlg = p.locator('[role=dialog][aria-modal=true]').first();
  await seen(dlg);
  let trigger = dlg.locator('.send-select-trigger').first();
  for (const tab of ['Voice & video', 'Voice', 'Appearance', 'Notifications', 'Accessibility']) {
    if (await trigger.count()) break;
    const t = dlg.getByRole('tab', { name: tab }).or(dlg.getByRole('button', { name: tab })).first();
    if (await t.count()) { await t.click(); await p.waitForTimeout(200); trigger = dlg.locator('.send-select-trigger').first(); }
  }
  if (await trigger.count()) {
    await trigger.click();
    const lb = p.locator('.send-select-menu');
    await seen(lb, 2000);
    await p.keyboard.press('Escape');
    check('Dropdown Escape closes the dropdown only', await gone(lb) && await dlg.isVisible());
    await p.keyboard.press('Escape');
    check('Next Escape closes the settings dialog', await gone(dlg));
  } else check('Dropdown inside settings found', false);

  /* ---- themed confirmation, Shift+click delete (on A's own message) */
  await A.p.goto(`${BASE}/channels/${g.id}/${text.id}`);
  const am = A.p.locator('article.msg', { hasText: 'after 2' });
  await am.waitFor({ timeout: 15000 });
  await am.hover();
  await am.locator('.msg-tools [aria-label="Delete"]').click();
  const ask = A.p.getByRole('alertdialog');
  check('Delete asks with a themed dialog (not a native one)', await seen(ask));
  await A.p.keyboard.press('Escape');
  check('Escape cancels the confirmation and keeps the message', await gone(ask) && await am.isVisible());
  await am.hover();
  await am.locator('.msg-tools [aria-label="Delete"]').click({ modifiers: ['Shift'] });
  check('Shift+click deletes without asking', await gone(am, 5000) && !(await ask.isVisible()));
  check('Deletion syncs to the other client', await gone(p.locator('article.msg', { hasText: 'after 2' }), 5000));

  await p.screenshot({ path: `${OUT}/interactions-b.png` });
  for (const x of [A, B]) check(`No page errors or native dialogs (${x.name})`, x.errs.length === 0, x.errs.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await b.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n')[0]); process.exit(2); });
