// Phone layout and touch behaviour. Usage: node e2e/mobile.cjs http://localhost:3900 <shot-dir>
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const seen = (loc, ms = 5000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const gone = (loc, ms = 4000) => loc.waitFor({ state: 'hidden', timeout: ms }).then(() => true, () => false);

(async () => {
  const b = await chromium.launch();
  for (const [label, dev] of [['Pixel 7', devices['Pixel 7']], ['iPhone SE', devices['iPhone SE']]]) {
    const SFX = Date.now().toString(36).slice(-5) + label.length;
    const mk = async () => { const c = await b.newContext({ ...dev }); await c.addInitScript(() => { try { localStorage.setItem('send.desktop-prompt.dismissed.v1', '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); localStorage.setItem('send.android-prompt.dismissed.v1', '1'); localStorage.setItem('send.ios-prompt.dismissed.v1', '1'); } catch {} }); const p = await c.newPage(); p.setDefaultTimeout(8000); return p; };
    const p = await mk(), q = await mk(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('native dialog'); d.dismiss(); });
    const api = (pg, m, path, body) => pg.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
    await p.goto(BASE + '/login'); await api(p, 'POST', '/api/auth/register', { email: `mb${SFX}@example.test`, username: `mb${SFX}`, password: 'correct horse battery', display_name: 'Mobi' });
    await q.goto(BASE + '/login'); await api(q, 'POST', '/api/auth/register', { email: `mc${SFX}@example.test`, username: `mc${SFX}`, password: 'correct horse battery', display_name: 'Cass' });
    const g = (await api(p, 'POST', '/api/guilds', { name: 'Thumb Zone' })).body; const t = g.channels.find((x) => x.type === 0);
    const second = (await api(p, 'POST', `/api/guilds/${g.id}/channels`, { name: 'second', type: 0 })).body;
    const inv = (await api(p, 'POST', `/api/channels/${t.id}/invites`, {})).body; await api(q, 'POST', `/api/invites/${inv.code}`);
    await api(q, 'POST', `/api/channels/${t.id}/messages`, { content: 'a long message from Cass that should wrap nicely on a narrow phone screen without ever overflowing sideways' });
    await api(p, 'POST', `/api/channels/${t.id}/messages`, { content: 'mine' });
    const L = (n) => `[${label}] ${n}`;
    const noOverflow = async () => (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0;
    const vw = dev.viewport.width, vh = dev.viewport.height;

    // Home opens on the conversation list (two-screen model).
    await p.goto(BASE + '/channels/@me');
    await p.locator('.shell').waitFor();
    check(L('Home starts on the channel list'), await p.locator('.shell.nav-open').count() === 1);
    check(L('No horizontal overflow (home)'), await noOverflow());

    // Channel: header has its own navigation button, nothing overlaps the title.
    await p.goto(`${BASE}/channels/${g.id}/${t.id}`); await p.locator('article.msg').first().waitFor();
    const hdr = await p.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); const btn = r('.ch-h .m-nav-btn'), h1 = r('.ch-h h1'); return { btn, h1, floating: !!document.querySelector('.nav-toggle') }; });
    check(L('Navigation button sits inside the header, left of the title (no overlap)'), hdr.btn && hdr.h1 && hdr.btn.right <= hdr.h1.left && !hdr.floating, JSON.stringify({ b: hdr.btn?.right, h: hdr.h1?.left }));
    const small = await p.evaluate(() => [...document.querySelectorAll('.ch-h button, .composer button')].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()).filter((r) => r.width < 38 || r.height < 38).length);
    check(L('Header and composer buttons are at least ~40px touch targets'), small === 0, `${small} small`);
    check(L('Member list does not open by default on phones'), !(await p.locator('.side-panel.members').isVisible()));
    check(L('No horizontal overflow (channel)'), await noOverflow());
    const composerFree = await p.evaluate(() => { const ta = document.querySelector('.composer textarea'); const r = ta.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el === ta && r.bottom <= innerHeight; });
    check(L('Message box is fully on screen and not covered'), composerFree);
    await p.locator('article.msg').first().tap();
    check(L('Tapping a message does not show the desktop hover toolbar'), !(await p.locator('.msg-tools').first().isVisible()));

    // Long-press → action sheet anchored to the bottom, big rows, closes with back.
    const msg = p.locator('article.msg', { hasText: 'mine' });
    const box = await msg.locator('.msg-content').boundingBox(); const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 30, y: box.y + box.height / 2 }] }); await p.waitForTimeout(650); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const sheet = p.locator('.ctx-menu').first();
    check(L('Long-press opens the message action sheet'), await seen(sheet)); await p.waitForTimeout(350); // let the sheet's slide-up finish before measuring
    const sb = await sheet.boundingBox();
    check(L('Action sheet is bottom-anchored and fits the screen'), sb && sb.y + sb.height <= vh + 1 && sb.y + sb.height >= vh - 40 && sb.x >= 0 && sb.x + sb.width <= vw, JSON.stringify(sb));
    const rowH = await sheet.locator('.ctx-item').first().evaluate((e) => e.getBoundingClientRect().height);
    check(L('Sheet rows are thumb-sized (≥44px)'), rowH >= 44, String(rowH));
    check(L('Own-message sheet offers edit and delete'), await sheet.getByRole('menuitem', { name: 'Edit message' }).isVisible() && await sheet.getByRole('menuitem', { name: 'Delete message' }).isVisible());
    check(L('Back closes the sheet first'), await p.evaluate(() => window.__sendBack()) && await gone(sheet));

    // Emoji sheet and back.
    await p.locator('.composer [aria-label="Emoji"]').tap();
    const pk = p.getByRole('dialog', { name: 'Pick an emoji' }); await pk.waitFor(); await p.waitForTimeout(350);
    const pr = await pk.evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, ih: innerHeight, iw: innerWidth }; });
    check(L('Emoji picker opens as a full-width bottom sheet'), pr.l <= 1 && Math.abs(pr.r - pr.iw) <= 1 && Math.abs(pr.b - pr.ih) <= 1, JSON.stringify(pr));
    await p.evaluate(() => window.__sendBack()); await gone(pk);

    // Members page full-screen with its own close; back closes it.
    await p.locator('.ch-h .ch-title').tap();
    const mem = p.locator('.side-panel.members'); await mem.waitFor(); await p.waitForTimeout(350);
    check(L('Member list opens as a full-screen page'), await seen(mem) && await mem.evaluate((e) => { const r = e.getBoundingClientRect(); return r.left <= 0 && r.top <= 0 && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }));
    check(L('Back closes the member list'), await p.evaluate(() => window.__sendBack()) && await gone(mem));

    // Back from the conversation returns to the channel list; tapping a channel returns to the chat.
    check(L('Back from a conversation opens the channel list'), await p.evaluate(() => window.__sendBack()) && await seen(p.locator('.shell.nav-open'), 2000));
    await p.locator('.side-ch', { hasText: 'second' }).tap();
    await p.waitForTimeout(400);
    check(L('Choosing a channel closes the list and opens it'), new URL(p.url()).pathname.endsWith(second.id) && await p.locator('.shell.nav-open').count() === 0);
    // Swipe right opens the list, swipe left returns.
    const swipe = async (x1, x2) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: vh / 2 }] }); for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 6, y: vh / 2 + i }] }); await p.waitForTimeout(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(350); };
    await swipe(20, vw * 0.7);
    check(L('Swipe right reveals the channel list'), await p.locator('.shell.nav-open').count() === 1);
    await swipe(vw * 0.8, 20);
    check(L('Swipe left returns to the conversation'), await p.locator('.shell.nav-open').count() === 0);

    // Settings: section list → section → back.
    await p.locator('.m-nav-btn').first().tap(); await p.waitForTimeout(300);
    await p.locator('.user-panel [aria-label="User settings"]').tap();
    const dlg = p.locator('[role=dialog][aria-modal=true]').first();
    check(L('Settings open full-screen on the section list'), await seen(dlg) && await dlg.evaluate((e) => e.getBoundingClientRect().height >= innerHeight - 1) && await seen(p.getByRole('tab', { name: 'Profile', exact: true })));
    await p.getByRole('tab', { name: 'Profile', exact: true }).tap();
    check(L('Choosing a section shows it full-width with a back button'), await seen(p.getByRole('button', { name: '‹ All settings' })) && !(await p.getByRole('tab', { name: 'Notifications', exact: true }).isVisible()));
    check(L('No horizontal overflow (settings)'), await noOverflow() && await dlg.evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
    const clipped = await dlg.evaluate((e) => [...e.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([hidden]),textarea,button')].filter((x) => x.offsetParent).filter((x) => x.getBoundingClientRect().right > innerWidth + 1).length);
    check(L('No field or button runs off the right edge'), clipped === 0, `${clipped} clipped`);
    await p.getByRole('button', { name: '‹ All settings' }).tap();
    check(L('Back returns to the section list'), await seen(p.getByRole('tab', { name: 'Notifications', exact: true })));
    await p.evaluate(() => window.__sendBack()); await gone(dlg);

    await p.screenshot({ path: `${OUT}/mobile-${label.replace(/\W+/g, '')}.png` });
    check(L('No page errors or native dialogs'), errs.length === 0, errs.slice(0, 3).join(' | '));
    await p.context().close(); await q.context().close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await b.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n')[0]); process.exit(2); });
