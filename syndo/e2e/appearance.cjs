// Appearance acceptance tests in real browser contexts against a running Syndo server.
// Usage: node e2e/appearance.cjs http://localhost:3900 <screenshot-dir>
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const SFX = Date.now().toString(36).slice(-5);
const U = (n) => `${n}_${SFX}`;
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const seen = (loc, ms = 8000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(page, method, path, body) {
  return page.evaluate(async ([m, p, b]) => {
    const r = await fetch(p, { method: m, headers: b === undefined ? { 'x-syndo-client': '1' } : { 'content-type': 'application/json', 'x-syndo-client': '1' }, body: b === undefined ? undefined : JSON.stringify(b) });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, [method, path, body]);
}
const cssVar = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const alphaOf = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map((x) => parseFloat(x)); return p.length === 4 ? p[3] : 1; };
async function setRange(loc, value) {
  await loc.evaluate((el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
}

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const mk = async (opts = {}) => { const c = await b.newContext({ viewport: { width: 1360, height: 860 }, ...opts }); await c.addInitScript(() => { try { localStorage.setItem('send.desktop-prompt.dismissed.v1', '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); localStorage.setItem('send.android-prompt.dismissed.v1', '1'); localStorage.setItem('send.ios-prompt.dismissed.v1', '1'); } catch {} }); const p = await c.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return { c, p }; };
  const reg = async (x, u) => {
    await x.p.goto(BASE + '/register');
    await x.p.getByLabel('Email').fill(`${U(u)}@example.test`);
    await x.p.getByLabel('Display name').fill(u[0].toUpperCase() + u.slice(1));
    await x.p.getByLabel('Username').fill(U(u));
    await x.p.getByLabel('Password').fill('correct horse battery');
    await x.p.getByRole('button', { name: 'Create account' }).click();
    await x.p.waitForURL('**/channels/@me', { timeout: 10000 });
    await x.p.getByRole('heading', { name: 'Friends' }).waitFor();
    x.id = (await api(x.p, 'GET', '/api/users/@me')).body.id;
  };
  const A = await mk(), B = await mk(), C = await mk();
  await reg(A, 'ana'); await reg(B, 'ben'); await reg(C, 'cyd');
  for (const x of [B, C]) { await api(A.p, 'POST', '/api/users/@me/relationships', { username: U(x === B ? 'ben' : 'cyd') }); await api(x.p, 'PUT', `/api/users/@me/relationships/${A.id}`, { type: 1 }); }
  const dm1 = (await api(A.p, 'POST', '/api/users/@me/channels', { recipient_id: B.id })).body;
  const dm2 = (await api(A.p, 'POST', '/api/users/@me/channels', { recipient_id: C.id })).body;
  await api(B.p, 'POST', `/api/channels/${dm1.id}/messages`, { content: 'hey from Ben' });
  await api(A.p, 'POST', `/api/channels/${dm1.id}/messages`, { content: 'hi Ben!' });
  const guild = (await api(A.p, 'POST', '/api/guilds', { name: 'Looks Club' })).body;
  const text = guild.channels.find((c) => c.type === 0);
  const inv = (await api(A.p, 'POST', `/api/channels/${text.id}/invites`, {})).body;
  await api(B.p, 'POST', `/api/invites/${inv.code}`);
  await api(A.p, 'POST', `/api/channels/${text.id}/messages`, { content: 'welcome to the club' });

  // --- Studio: apply Syndo Glass through the UI
  await A.p.goto(`${BASE}/channels/${guild.id}/${text.id}`);
  await A.p.getByRole('button', { name: 'User settings' }).click();
  await A.p.getByRole('tab', { name: 'Appearance' }).click();
  await A.p.getByRole('button', { name: 'Open SEND Studio' }).click();
  await A.p.getByRole('dialog', { name: 'SEND Studio' }).waitFor();
  // Glass is the default since the SEND rebrand: preview a different theme (Paper, light) and make sure Cancel reverts it.
  const schemeBefore = await A.p.evaluate(() => document.documentElement.dataset.scheme);
  await A.p.locator('.theme-card', { hasText: 'SEND Paper' }).getByRole('button', { name: 'Use' }).click();
  await sleep(300);
  check('Studio previews a theme before saving', (await A.p.evaluate(() => document.documentElement.dataset.scheme)) === 'light' && schemeBefore !== 'light');
  await A.p.screenshot({ path: `${OUT}/studio-gallery.png` });
  await A.p.getByRole('button', { name: 'Cancel' }).click();
  const discard = A.p.getByRole('alertdialog');
  if (await discard.isVisible().catch(() => false) || await discard.waitFor({ timeout: 1500 }).then(() => true, () => false)) await discard.getByRole('button', { name: 'Discard' }).click();
  await sleep(400);
  check('Cancel reverts the preview', (await A.p.evaluate(() => document.documentElement.dataset.scheme)) === schemeBefore && alphaOf(await cssVar(A.p, '--r-chat-bg')) < 1);
  await A.p.evaluate(() => window.dispatchEvent(new CustomEvent('syndo:studio', { detail: { section: 'gallery' } })));
  await A.p.getByRole('dialog', { name: 'SEND Studio' }).waitFor();
  await A.p.locator('.theme-card', { hasText: 'SEND Glass' }).getByRole('button', { name: /^(Use|Applied \(preview\))$/ }).first().click();
  // Panels: message area opacity 30 %, rail blur 6 px — independently.
  await A.p.getByRole('tab', { name: 'Panels & transparency' }).click();
  await A.p.getByRole('option', { name: /Message area/ }).click();
  await setRange(A.p.getByLabel('Background opacity', { exact: true }), 30);
  await A.p.getByRole('option', { name: /Server navigation/ }).click();
  await setRange(A.p.getByLabel('Backdrop blur', { exact: true }), 6);
  await A.p.getByRole('button', { name: 'Undo' }).click(); await A.p.getByRole('button', { name: 'Redo' }).click();
  await A.p.screenshot({ path: `${OUT}/studio-panels.png` });
  await A.p.getByRole('button', { name: 'Apply' }).click();
  await A.p.getByRole('dialog', { name: 'SEND Studio' }).waitFor({ state: 'detached', timeout: 8000 });
  await sleep(500);
  // Acceptance 1: background opacity changes independently of text and icons.
  const chatBg = await A.p.locator('.ch-main').evaluate((el) => getComputedStyle(el).backgroundImage);
  const textColor = await A.p.locator('.msg-content').first().evaluate((el) => getComputedStyle(el).color);
  const textOpacity = await A.p.locator('.msg-content').first().evaluate((el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; });
  const iconOpacity = await A.p.locator('.ch-h svg').first().evaluate((el) => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; });
  check('1. chat background is 30 % while text and icons stay fully opaque', chatBg.includes('0.3)') && alphaOf(textColor) === 1 && textOpacity === 1 && iconOpacity === 1, `${chatBg.slice(0, 60)} text=${textColor}`);
  await A.p.screenshot({ path: `${OUT}/glass-applied.png` });
  // Acceptance 2: panels keep their own styling after refresh.
  await A.p.reload(); await A.p.locator('.ch-main').waitFor(); await sleep(800);
  const railBlur = await A.p.locator('.rail').evaluate((el) => getComputedStyle(el).backdropFilter);
  const chatAfter = await A.p.locator('.ch-main').evaluate((el) => getComputedStyle(el).backgroundImage);
  check('2. each panel keeps its own styling after refresh', railBlur.includes('blur(6px)') && chatAfter.includes('0.3)'), `rail=${railBlur}`);

  // Acceptance 3: two DMs, different backgrounds, no leaking.
  await A.p.goto(`${BASE}/channels/@me/${dm1.id}`);
  await A.p.getByRole('button', { name: 'Edit appearance for this conversation' }).click();
  await A.p.getByRole('button', { name: 'Gradient #3D6BFF to #FF8A6B' }).click();
  await A.p.getByLabel('Your label for this conversation').fill('Bestie');
  await sleep(1200);
  await A.p.goto(`${BASE}/channels/@me/${dm2.id}`);
  await A.p.getByRole('button', { name: 'Edit appearance for this conversation' }).click();
  await A.p.getByRole('button', { name: 'Colour #3B1E1E' }).click();
  await sleep(1200);
  const bgOf = async () => A.p.locator('.chat-bd .bd-fill').first().evaluate((el) => getComputedStyle(el).backgroundImage + '|' + getComputedStyle(el).backgroundColor).catch(() => 'none');
  const dm2bg = await bgOf();
  await A.p.getByRole('link', { name: /Bestie/ }).or(A.p.locator('.side-dm', { hasText: 'Bestie' })).first().click();
  await sleep(500);
  const dm1bg = await bgOf();
  await A.p.screenshot({ path: `${OUT}/dm-bestie.png` });
  await A.p.locator('.side-dm', { hasText: 'Cyd' }).click();
  await sleep(500);
  const dm2again = await bgOf();
  check('3. two DMs keep different backgrounds without leaking', dm1bg.includes('gradient') && dm2bg.includes('rgb(59, 30, 30)') && dm2again === dm2bg && !dm2again.includes('gradient'), `${dm1bg.slice(0, 40)} vs ${dm2bg.slice(-20)}`);
  check('local label is shown, distinguished from the real name', await seen(A.p.locator('.side-dm .local-label', { hasText: 'Bestie' }), 3000));
  // Acceptance 7: personal themes stay private.
  const bProfile = JSON.stringify((await api(B.p, 'GET', `/api/users/${A.id}/profile`)).body) + JSON.stringify((await api(B.p, 'GET', '/api/appearance')).body);
  check('7. personal appearance and labels are invisible to others', !bProfile.includes('Bestie') && !bProfile.includes('syndo-glass'));

  // Acceptance 4: server and channel overrides inherit and reset.
  await api(A.p, 'PUT', `/api/appearance/guild/${guild.id}`, { data: { overrides: { colors: { accent: '#FF00AA' } } } });
  await A.p.goto(`${BASE}/channels/${guild.id}/${text.id}`); await sleep(800);
  const accServer = await cssVar(A.p, '--accent');
  await api(A.p, 'PUT', `/api/appearance/channel/${text.id}`, { data: { overrides: { colors: { accent: '#00CC66' } } } });
  await sleep(600);
  const accChan = await cssVar(A.p, '--accent');
  await A.p.goto(`${BASE}/channels/@me/${dm1.id}`); await sleep(600);
  const accOutside = await cssVar(A.p, '--accent');
  await api(A.p, 'DELETE', `/api/appearance/channel/${text.id}`);
  await A.p.goto(`${BASE}/channels/${guild.id}/${text.id}`); await sleep(800);
  const accReset = await cssVar(A.p, '--accent');
  check('4. server → channel overrides inherit and reset', accServer === '#FF00AA' && accChan === '#00CC66' && accOutside !== '#FF00AA' && accReset === '#FF00AA', `${accServer} ${accChan} ${accOutside} ${accReset}`);

  // Acceptance 5/6: server profile separate from global, seen by other members.
  const sp = await api(A.p, 'PATCH', `/api/guilds/${guild.id}/members/@me`, { nick: 'Captain Ana', pronouns: 'she/her', profile_theme: { primary: '#FF5E7E', secondary: '#3D6BFF', ring: { style: 'spin', color: '#FF5E7E', speed: 1 }, nameStyle: 'gradient', frame: 'gradient', effects: [{ kind: 'sparkle', enabled: true, color: '#FFFFFF', intensity: 70, speed: 1, duration: 4, loop: true, trigger: 'always', density: 50 }] } });
  if (sp.status !== 200) console.log('server profile patch:', sp.status, JSON.stringify(sp.body).slice(0, 300));
  const global = (await api(A.p, 'GET', '/api/users/@me')).body;
  check('5. server nickname/profile does not alter the global profile', global.display_name === 'Ana' && global.pronouns === '' && !global.profile_theme);
  await B.p.goto(`${BASE}/channels/${guild.id}/${text.id}`);
  await B.p.locator('.msg-name', { hasText: 'Captain Ana' }).first().waitFor({ timeout: 8000 }).catch(() => {});
  await B.p.locator('.msg-name', { hasText: 'Captain Ana' }).first().click();
  const card = B.p.locator('.profile-card');
  const cardOk = await seen(card.getByText('Captain Ana'), 5000) && await seen(card.getByText(`@${U('ana')}`), 2000) && await seen(card.getByText('she/her'), 2000);
  await B.p.screenshot({ path: `${OUT}/server-profile-card.png` });
  check('6. other members see the server profile (with the stable @username)', cardOk);
  const ringAnim = await B.p.locator('.profile-card .avatar.ring').first().evaluate((el) => getComputedStyle(el, '::after').animationName).catch(() => 'missing');
  check('animated ring renders for viewers', ringAnim === 'spin', ringAnim);

  // Acceptance 9: reduced motion disables effects.
  const R = await mk({ reducedMotion: 'reduce', storageState: await B.c.storageState() });
  await R.p.goto(`${BASE}/channels/${guild.id}/${text.id}`);
  await R.p.locator('.msg-name', { hasText: 'Captain Ana' }).first().click();
  await R.p.locator('.profile-card').waitFor();
  const rm = await R.p.evaluate(() => document.documentElement.dataset.motion);
  const ringRm = await R.p.locator('.profile-card .avatar').first().evaluate((el) => getComputedStyle(el, '::after').animationName);
  const canvas = await R.p.locator('.profile-card canvas.fx-canvas').count();
  check('9. reduced motion stops rings and particle effects', rm === 'reduce' && ringRm === 'none' && canvas === 0, `${rm} ${ringRm} canvas=${canvas}`);
  // Viewer can hide other people's cosmetics.
  await api(B.p, 'PUT', '/api/appearance/global', { data: { themeId: 'syndo-midnight', a11y: { disableOthersCosmetics: true } } });
  await B.p.reload(); await B.p.locator('.msg-name').first().waitFor(); await sleep(800);
  const plain = await B.p.locator('.msg', { hasText: 'welcome to the club' }).locator('.avatar').first().evaluate((el) => el.className);
  check('viewers can disable other people\'s cosmetics', !plain.includes('ring'), plain);

  // Acceptance 8: shared conversation theme requires explicit acceptance.
  const prop = (await api(A.p, 'POST', `/api/channels/${dm1.id}/theme-proposals`, { data: { colors: { accent: '#FFAA00' } } })).body;
  await B.p.goto(`${BASE}/channels/@me/${dm1.id}`); await sleep(800);
  const before = await cssVar(B.p, '--accent');
  await B.p.getByRole('button', { name: 'Edit appearance for this conversation' }).click();
  await B.p.getByRole('button', { name: 'Accept' }).click();
  await sleep(1200);
  const after = await cssVar(B.p, '--accent');
  check('8. shared theme applies only after the other person accepts', before !== '#FFAA00' && after === '#FFAA00', `${before} → ${after}`);
  void prop;

  // Acceptance 10: import/export round trip; invalid packages rejected.
  const exp = await api(A.p, 'POST', '/api/appearance/validate', { data: { schema: 'syndo.theme', version: 2, meta: { name: 'RT', scheme: 'dark' }, colors: { accent: '#123456' }, panels: { chat: { opacity: 40, blur: 8 } }, layout: { nav: 'horizontal' } } });
  const bad = await api(A.p, 'POST', '/api/appearance/validate', { data: { schema: 'syndo.theme', version: 2, meta: { name: 'Bad' }, background: { dark: { kind: 'image', asset: 'https://x.example/a.png' } } } });
  check('10. import keeps supported settings and rejects invalid packages', exp.body.ok && exp.body.doc.panels.chat.opacity === 40 && exp.body.doc.layout.nav === 'horizontal' && !bad.body.ok);
  await A.p.evaluate(() => window.dispatchEvent(new CustomEvent('syndo:studio', { detail: { section: 'presets' } })));
  await A.p.locator('input[type=file][accept*=".css"]').setInputFiles({ name: 'midnight.theme.css', mimeType: 'text/css', buffer: Buffer.from(':root{--background-primary:#000}') });
  check('BetterDiscord-style .theme.css files are clearly rejected', await seen(A.p.getByText(/theme files made for other apps aren't compatible/), 3000));
  await A.p.getByRole('button', { name: 'Cancel' }).click();

  // Acceptance 11 + 15: missing asset fallback; others can't fetch my wallpaper.
  const up = await A.p.evaluate(async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'w.png');
    return (await fetch('/api/appearance/assets', { method: 'POST', body: fd, headers: { 'x-syndo-client': '1' } })).json();
  });
  const peek = await B.p.evaluate(async (u) => (await fetch(u)).status, up.url);
  check('15. other users cannot fetch someone\'s private wallpaper', peek === 404);
  await api(A.p, 'PUT', '/api/appearance/global', { data: { themeId: 'syndo-canvas', overrides: { background: { dark: { kind: 'image', asset: up.id, color: '#334455' } } } } });
  await api(A.p, 'DELETE', `/api/appearance/assets/${up.id.slice(1)}?force=1`);
  await A.p.goto(`${BASE}/channels/@me`);
  await A.p.waitForFunction(() => window.__syndoTheme === 'syndo-canvas', null, { timeout: 8000 }).catch(() => {});
  await A.p.locator('.app-bd .bd-fill').first().waitFor({ timeout: 5000 }).catch(() => {});
  // The colour fallback appears once the deleted image's request fails; wait for it rather than a fixed delay.
  await A.p.waitForFunction(() => { const el = document.querySelector('.app-bd .bd-fill'); return el && getComputedStyle(el).backgroundColor === 'rgb(51, 68, 85)'; }, null, { timeout: 6000 }).catch(() => {});
  const fb = await A.p.locator('.app-bd .bd-fill').first().evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => 'none');
  check('11. a deleted wallpaper falls back to a usable colour', fb === 'rgb(51, 68, 85)' && await seen(A.p.getByRole('heading', { name: 'Friends' }), 2000), fb);

  // Acceptance 13: horizontal + multi-column rail keyboard access.
  await api(A.p, 'PUT', '/api/appearance/global', { data: { themeId: 'syndo-panorama' } });
  await A.p.goto(`${BASE}/channels/@me`); await sleep(900);
  const railBox = await A.p.locator('.rail').boundingBox();
  await A.p.locator('.rail-item > button').first().focus();
  await A.p.keyboard.press('ArrowRight');
  const focused = await A.p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await A.p.screenshot({ path: `${OUT}/panorama-horizontal.png` });
  check('13a. horizontal server bar is keyboard navigable', railBox.height <= 70 && railBox.width > 600 && /Looks Club/.test(focused ?? ''), focused);
  await api(A.p, 'PUT', '/api/appearance/global', { data: { themeId: 'syndo-midnight', overrides: { layout: { railColumns: 2 } } } });
  await A.p.reload(); await sleep(900);
  await A.p.locator('.rail-item > button').first().focus();
  await A.p.keyboard.press('ArrowDown');
  const f2 = await A.p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check('13b. multi-column rail is keyboard navigable', /Looks Club/.test(f2 ?? ''), f2);

  // Acceptance 14: small window + large text keep critical controls reachable.
  await api(A.p, 'PUT', '/api/appearance/global', { data: { themeId: 'syndo-midnight', overrides: { typography: { size: 22 }, layout: { scale: 1.3, showSidebar: false } } } });
  await A.p.setViewportSize({ width: 820, height: 560 });
  await A.p.goto(`${BASE}/channels/${guild.id}/${text.id}`); await sleep(1000);
  const inView = async (loc) => { const bx = await loc.boundingBox().catch(() => null); return !!bx && bx.x >= 0 && bx.y >= 0 && bx.x + bx.width <= 820 && bx.y + bx.height <= 560; };
  const settingsBtn = A.p.getByRole('button', { name: 'User settings' }).first();
  const composer = A.p.getByRole('textbox', { name: /Message/ });
  await A.p.screenshot({ path: `${OUT}/small-large-text.png` });
  check('14. small window + large text + hidden sidebar keep settings and composer reachable', await inView(settingsBtn) && await inView(composer) && await inView(A.p.getByRole('button', { name: 'Show channel sidebar' })));
  await A.p.setViewportSize({ width: 1360, height: 860 });

  // Acceptance 17: recovery from deliberately problematic customization.
  await api(A.p, 'PUT', '/api/appearance/global', { data: { themeId: 'syndo-midnight', customCssEnabled: true, a11y: { minContrast: false }, overrides: { colors: { text: '#1A2136', textMuted: '#1A2136' }, customCss: '.msg-content { color: #1A2136; } .btn { color: #1A2136; }' } } });
  await A.p.reload(); await sleep(1000);
  const broken = await A.p.locator('.ch-h h1').evaluate((el) => getComputedStyle(el).color);
  await A.p.keyboard.press('Control+Shift+Alt+KeyR');
  await sleep(500);
  const banner = await seen(A.p.getByText('Safe appearance mode'), 3000);
  const custom = await A.p.evaluate(() => document.getElementById('syndo-custom-css')?.textContent ?? '');
  const readable = await A.p.locator('.ch-h h1').evaluate((el) => getComputedStyle(el).color);
  await A.p.screenshot({ path: `${OUT}/recovery-safe-mode.png` });
  await A.p.getByRole('button', { name: 'Reset appearance' }).first().click();
  await sleep(1500);
  await A.p.reload(); await sleep(900);
  const restored = await A.p.locator('.ch-h h1').evaluate((el) => getComputedStyle(el).color);
  check('17. safe mode + reset restore a readable interface', broken === 'rgb(26, 33, 54)' && banner && custom === '' && readable !== broken && restored === 'rgb(238, 241, 248)', `${broken} → ${readable} → ${restored}`);
  check('recovery link exists on the sign-in screen', await (async () => { const L = await mk(); await L.p.goto(BASE + '/login'); return seen(L.p.getByRole('button', { name: 'Reset appearance' }), 4000); })());

  // Acceptance 18: cross-device sync respects device-specific overrides.
  const A2 = await mk({ storageState: await A.c.storageState() });
  await A2.p.goto(`${BASE}/channels/@me`); await sleep(1000);
  await A2.p.evaluate(() => localStorage.setItem('syndo.device.v1', JSON.stringify({ layout: { nav: 'horizontal' } })));
  await A2.p.reload(); await sleep(1000);
  await api(A.p, 'PUT', '/api/appearance/global', { data: { themeId: 'syndo-neon' } });
  await sleep(1500);
  const a2Theme = await cssVar(A2.p, '--accent');
  const a2Nav = await A2.p.evaluate(() => document.documentElement.dataset.nav);
  await A.p.reload(); await sleep(900);
  const a1Nav = await A.p.evaluate(() => document.documentElement.dataset.nav);
  check('18. synced theme reaches the other device live; device-only layout stays local', a2Theme === '#FF3FD8' && a2Nav === 'horizontal' && a1Nav === 'vertical', `${a2Theme} ${a2Nav}/${a1Nav}`);

  // Acceptance 16: every built-in theme styles the real app incl. dialogs, profiles and call screen.
  const ids = ['syndo-glass', 'syndo-frost', 'syndo-midnight', 'syndo-oled', 'syndo-aurora', 'syndo-neon', 'syndo-soft', 'syndo-paper', 'syndo-terminal', 'syndo-compact', 'syndo-panorama', 'syndo-canvas'];
  const vc = guild.channels.find((c) => c.type === 2);
  let allStyled = true; const seenBg = new Set();
  for (const id of ids) {
    await api(A.p, 'PUT', '/api/appearance/global', { data: { themeId: id } });
    await A.p.goto(`${BASE}/channels/${guild.id}/${text.id}`);
    // Wait until this theme's preferences have loaded and been applied (layout may shift once).
    await A.p.waitForFunction((tid) => document.getElementById('syndo-theme')?.textContent?.length > 0 && window.__syndoTheme === tid, id, { timeout: 8000 }).catch(() => {});
    await sleep(500);
    for (let attempt = 0; attempt < 3; attempt++) {
      await A.p.locator('.msg-name').first().click();
      if (await seen(A.p.locator('.pcv'), 3000)) break;
    }
    const s = await A.p.evaluate(() => {
      const cs = (sel, p) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[p] : null; };
      return { chat: cs('.ch-main', 'backgroundImage'), card: cs('.pcv', 'backgroundImage'), font: cs('body', 'fontFamily'), scheme: document.documentElement.dataset.scheme };
    });
    await A.p.screenshot({ path: `${OUT}/theme-${id}.png` });
    await A.p.keyboard.press('Escape');
    await A.p.getByRole('button', { name: 'User settings' }).first().click();
    const modal = await A.p.locator('.modal').evaluate((el) => getComputedStyle(el).backgroundImage).catch(() => null);
    await A.p.keyboard.press('Escape');
    await A.p.goto(`${BASE}/channels/${guild.id}/${vc.id}`); await sleep(400);
    const stage = await A.p.locator('[data-region="call"], .stage-empty').first().evaluate((el) => getComputedStyle(el).backgroundImage).catch(() => null);
    const toastText = await A.p.locator('.toast').allInnerTexts().catch(() => []);
    const ok = !!s.chat && !!s.card && !!modal && !!stage && s.chat.includes('gradient') && s.card.includes('gradient');
    if (!ok) { allStyled = false; console.log('  not styled:', id, JSON.stringify({ ...s, modal: !!modal, stage: !!stage, toastText })); }
    seenBg.add(s.chat);
  }
  check(`16. all ${ids.length} built-in themes style chat, profile cards, dialogs and the call screen`, allStyled && seenBg.size >= 8, `${seenBg.size} distinct chat surfaces`);

  check('no uncaught page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
