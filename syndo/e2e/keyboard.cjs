// Keyboard shortcuts + Keybinds page. Usage: node e2e/keyboard.cjs http://localhost:3900 <shot-dir>
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const SFX = Date.now().toString(36).slice(-5);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const seen = (loc, ms = 5000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const gone = (loc, ms = 4000) => loc.waitFor({ state: 'hidden', timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch();
  const mk = async (name) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => { try { localStorage.setItem('send.desktop-prompt.dismissed.v1', '1'); } catch {} });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('NATIVE ' + d.message()); d.dismiss(); });
    return { c, p, errs, name };
  };
  const A = await mk('a'), B = await mk('b');
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-syndo-client': '1' } : { 'x-syndo-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  for (const x of [A, B]) {
    await x.p.goto(BASE + '/login');
    const r = await api(x, 'POST', '/api/auth/register', { email: `kb_${x.name}_${SFX}@example.test`, username: `kb_${x.name}_${SFX}`, password: 'correct horse battery', display_name: x.name === 'a' ? 'Kai' : 'Lee' });
    if (r.status >= 300) throw new Error('register ' + JSON.stringify(r));
  }
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Keys' })).body;
  const general = g.channels.find((c) => c.type === 0);
  const two = (await api(A, 'POST', `/api/guilds/${g.id}/channels`, { name: 'second', type: 0 })).body;
  const three = (await api(A, 'POST', `/api/guilds/${g.id}/channels`, { name: 'third', type: 0 })).body;
  const inv = (await api(A, 'POST', `/api/channels/${general.id}/invites`, {})).body;
  await api(B, 'POST', `/api/invites/${inv.code}`);
  await api(B, 'POST', `/api/channels/${general.id}/messages`, { content: 'hello from Lee' });
  await api(A, 'POST', `/api/channels/${general.id}/messages`, { content: 'my last message' });
  await api(B, 'POST', `/api/channels/${three.id}/messages`, { content: 'unread over here' });
  const p = A.p, mod = 'Control';
  const here = () => new URL(p.url()).pathname;
  await p.goto(`${BASE}/channels/${g.id}/${general.id}`);
  const composer = () => p.locator('.composer textarea');
  await composer().waitFor({ timeout: 15000 }).catch(async (e) => { await p.screenshot({ path: OUT + '/kb-debug.png' }); console.log('URL', p.url(), A.errs.join(' | '), JSON.stringify(two).slice(0, 200)); throw e; });
  await p.locator('main').click({ position: { x: 600, y: 300 } }).catch(() => {});

  /* help + quick switcher */
  await p.keyboard.press(`${mod}+/`);
  const help = p.getByRole('dialog', { name: 'Keyboard shortcuts' });
  check('Ctrl+/ opens the shortcut list', await seen(help));
  check('Shortcut list shows current bindings', await seen(help.getByText('Next unread channel'), 1000) && (await help.locator('kbd', { hasText: 'Ctrl+K' }).count()) > 0);
  await p.keyboard.press('Escape');
  check('Esc closes the shortcut list', await gone(help));
  await p.keyboard.press(`${mod}+k`);
  const qs = p.locator('.quick-switcher, [role=dialog]').filter({ has: p.locator('input') }).first();
  check('Ctrl+K opens the quick switcher', await seen(qs));
  await p.keyboard.press('Escape'); await gone(qs);

  /* channel navigation */
  await p.keyboard.press('Alt+ArrowDown');
  await p.waitForTimeout(300);
  check('Alt+↓ moves to the next channel', here().endsWith(two.id), here());
  await p.keyboard.press('Alt+ArrowUp'); await p.waitForTimeout(300);
  check('Alt+↑ moves back', here().endsWith(general.id));
  await p.keyboard.press('Alt+Shift+ArrowDown'); await p.waitForTimeout(300);
  check('Alt+Shift+↓ jumps to the next unread channel (skipping read ones)', here().endsWith(three.id), here());
  await p.keyboard.press('Alt+ArrowLeft'); await p.waitForTimeout(300);
  check('Alt+← returns to the previous text channel', here().endsWith(general.id), here());
  await p.keyboard.press(`${mod}+Alt+ArrowUp`); await p.waitForTimeout(300);
  check('Ctrl+Alt+↑ switches server (to Home)', here().startsWith('/channels/@me'), here());
  await p.keyboard.press(`${mod}+Alt+ArrowDown`); await p.waitForTimeout(500);
  check('Ctrl+Alt+↓ switches back to the server', here().includes(g.id), here());
  await p.goto(`${BASE}/channels/${g.id}/${general.id}`); await composer().waitFor();

  /* typing anywhere focuses the composer; Esc marks read */
  await p.locator('.msgs').focus();
  await p.keyboard.type('h');
  check('Typing with nothing focused goes into the message box', (await composer().inputValue()) === 'h' && await composer().evaluate((el) => document.activeElement === el));
  await composer().fill('');
  await api(B, 'POST', `/api/channels/${two.id}/messages`, { content: 'second unread' });
  const twoLink = p.locator('.side-ch', { hasText: 'second' });
  await p.waitForFunction(() => document.querySelector('.side-ch.unread') !== null, null, { timeout: 5000 }).catch(() => {});
  await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(400);
  await api(B, 'POST', `/api/channels/${two.id}/messages`, { content: 'another one' });
  await p.waitForTimeout(400);
  await p.keyboard.press('Shift+Escape'); await p.waitForTimeout(600);
  check('Shift+Esc marks the whole server read', (await p.locator('.side-ch.unread').count()) === 0);
  void twoLink;

  /* message editing from the keyboard */
  await p.goto(`${BASE}/channels/${g.id}/${general.id}`); await composer().waitFor();
  await composer().focus();
  await p.keyboard.press('ArrowUp');
  const editBox = p.getByRole('textbox', { name: 'Edit message' });
  check('↑ in an empty message box edits your last message', await seen(editBox) && (await editBox.inputValue()) === 'my last message');
  await p.keyboard.press('Escape');
  check('Esc cancels editing and returns to the message box', await gone(editBox) && await composer().evaluate((el) => document.activeElement === el));
  await composer().fill('not empty');
  await p.keyboard.press('ArrowUp');
  check('↑ with text in the box does not start editing', !(await editBox.isVisible()));
  await composer().fill('');

  /* emoji picker + panels */
  await composer().focus();
  await p.keyboard.press(`${mod}+e`);
  const picker = p.getByRole('dialog', { name: 'Pick an emoji' });
  check('Ctrl+E opens the emoji picker', await seen(picker));
  await picker.locator('.picker-grid button').first().click();
  check('Picking an emoji inserts it at the cursor', /\p{Extended_Pictographic}/u.test(await composer().inputValue()) && await gone(picker));
  await composer().fill('');
  await p.keyboard.press(`${mod}+p`);
  check('Ctrl+P toggles pinned messages', await seen(p.getByRole('complementary', { name: 'Pinned messages' })));
  await p.keyboard.press(`${mod}+p`);
  check('Ctrl+P again closes them', await gone(p.getByRole('complementary', { name: 'Pinned messages' })));
  const membersOpen = async () => (await p.locator('.ch-actions [aria-label="Member list"]').getAttribute('aria-pressed')) === 'true';
  const m0 = await membersOpen(); await p.keyboard.press(`${mod}+u`); await p.waitForTimeout(200);
  check('Ctrl+U toggles the member list', (await membersOpen()) !== m0);
  await p.keyboard.press(`${mod}+u`); await p.waitForTimeout(200);

  /* mute toggle and IME safety */
  const muteBtn = p.locator('.user-panel [aria-label="Mute"], .user-panel [aria-label="Unmute"]').first();
  const before = await muteBtn.getAttribute('aria-pressed');
  await p.keyboard.press(`${mod}+Shift+m`); await p.waitForTimeout(200);
  check('Ctrl+Shift+M toggles mute', (await muteBtn.getAttribute('aria-pressed')) !== before);
  await p.keyboard.press(`${mod}+Shift+m`);
  const urlBefore = here();
  await composer().focus();
  await p.evaluate(() => document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, isComposing: true, bubbles: true })));
  await p.waitForTimeout(300);
  check('Shortcuts are ignored during IME composition', here() === urlBefore);

  /* Keybinds page: record, conflict, persist, restore */
  await p.getByRole('button', { name: 'User settings' }).first().click();
  const dlg = p.locator('[role=dialog][aria-modal=true]').first();
  await dlg.getByRole('tab', { name: 'Keybinds' }).click();
  check('Keybinds page lists actions and push to talk', await seen(dlg.locator('.kb-label strong', { hasText: /^Push to talk$/ })) && await seen(dlg.locator('.kb-label strong', { hasText: /^Toggle member list$/ })));
  const row = dlg.locator('.kb-row', { hasText: 'Toggle pinned messages' });
  await row.getByRole('button', { name: /Add a shortcut/ }).click();
  check('Recorder waits for a key', await seen(row.getByText('Press a shortcut')));
  await p.keyboard.press(`${mod}+k`);
  check('Recording a used combination explains the conflict', await seen(row.getByText(/Also used by .Quick switcher/)));
  check('Recording did not trigger the shortcut itself', !(await p.locator('.quick-switcher').isVisible().catch(() => false)));
  await row.getByRole('button', { name: 'Save' }).click();
  await p.waitForTimeout(400);
  check('Saving moves the binding (removed from the quick switcher)', !(await dlg.locator('.kb-row', { hasText: 'Quick switcher' }).locator('kbd', { hasText: /^Ctrl\+K$/ }).count()) && (await row.locator('kbd', { hasText: /^Ctrl\+K$/ }).count()) === 1);
  await row.getByRole('button', { name: /Add a shortcut/ }).click(); await seen(row.getByText('Press a shortcut'));
  await p.keyboard.press('Escape');
  check('Esc while recording is captured (dialog stays open)', await dlg.isVisible() && await seen(row.getByRole('button', { name: 'Save' })));
  await row.getByRole('button', { name: 'Cancel' }).click();
  await p.keyboard.press('Escape'); await gone(dlg);
  await p.reload(); await composer().waitFor();
  await p.locator('.msgs').focus();
  await p.keyboard.press(`${mod}+k`);
  check('Custom binding persists across reload (Ctrl+K now opens pins)', await seen(p.getByRole('complementary', { name: 'Pinned messages' })));
  const ctx2 = await b.newContext({ storageState: await A.c.storageState() }); const p2 = await ctx2.newPage();
  await p2.goto(`${BASE}/channels/${g.id}/${general.id}`); await p2.locator('.composer textarea').waitFor();
  await p2.keyboard.press(`${mod}+/`);
  check('Custom binding syncs to another device', (await p2.getByRole('dialog', { name: 'Keyboard shortcuts' }).locator('div', { hasText: 'Toggle pinned messages' }).locator('kbd', { hasText: 'Ctrl+K' }).count()) > 0);
  await ctx2.close();
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'User settings' }).first().click();
  await dlg.getByRole('tab', { name: 'Keybinds' }).click();
  await dlg.getByRole('button', { name: 'Restore defaults' }).click();
  await p.getByRole('alertdialog').getByRole('button', { name: 'Restore defaults' }).click();
  await p.waitForTimeout(400);
  check('Restore defaults brings Ctrl+K back to the quick switcher', (await dlg.locator('.kb-row', { hasText: 'Quick switcher' }).locator('kbd', { hasText: /^Ctrl\+K$/ }).count()) === 1);
  await dlg.getByRole('tab', { name: 'Advanced' }).click();
  await dlg.getByRole('switch', { name: /Developer mode/ }).check();
  await p.keyboard.press('Escape'); await gone(dlg);
  await p.locator('article.msg', { hasText: 'my last message' }).click({ button: 'right' });
  check('Developer mode adds Copy message ID', await seen(p.getByRole('menuitem', { name: 'Copy message ID' })));
  await p.keyboard.press('Escape');

  await p.screenshot({ path: `${OUT}/keyboard.png` });
  for (const x of [A, B]) check(`No page errors or native dialogs (${x.name})`, x.errs.length === 0, x.errs.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await b.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n')[0]); process.exit(2); });
