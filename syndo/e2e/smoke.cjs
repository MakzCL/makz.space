// Two independent browser contexts (separate cookies/storage) drive the real UI end to end.
// Usage: node e2e/smoke.cjs http://localhost:3900 <screenshot-dir>
const { chromium } = require('playwright');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const results = [];
const SFX = Date.now().toString(36).slice(-5);
const U = (n) => `${n}_${SFX}`;
const seen = (loc, ms = 8000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
(async () => {
  const b = await chromium.launch();
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { c, p, errs }; };
  const A = await mk(), B = await mk();
  const reg = async (x, u) => {
    await x.p.goto(BASE + '/register');
    await x.p.getByLabel('Email').fill(`${U(u)}@example.test`);
    await x.p.getByLabel('Display name').fill(u[0].toUpperCase() + u.slice(1));
    await x.p.getByLabel('Username').fill(U(u));
    await x.p.getByLabel('Password').fill('correct horse battery');
    await x.p.getByRole('button', { name: 'Create account' }).click();
    await x.p.waitForURL('**/channels/@me', { timeout: 10000 });
    await x.p.getByRole('heading', { name: 'Friends' }).waitFor();
  };
  await reg(A, 'amara'); await reg(B, 'bodhi');
  check('both users registered and reached the app', true);
  await A.p.screenshot({ path: `${OUT}/01-friends.png` });

  // Friend request A -> B, accept in B
  await A.p.getByRole('tab', { name: 'Add friend' }).click();
  await A.p.getByLabel('Username').fill(U('bodhi'));
  await A.p.getByRole('button', { name: 'Send request' }).click();
  check('friend request sent', await seen(A.p.getByText('Friend request sent'), 5000));
  await B.p.getByRole('tab', { name: /Pending/ }).click();
  await B.p.getByRole('button', { name: 'Accept' }).click({ timeout: 5000 });
  await B.p.getByRole('tab', { name: 'All' }).click();
  check('friendship visible to B in real time', await seen(B.p.getByText('Amara').first(), 5000));

  // DM
  await B.p.getByRole('button', { name: 'Message Amara' }).click();
  await B.p.getByRole('textbox', { name: /Message/ }).fill('Hi **Amara**! `code` and ||secret||');
  await B.p.keyboard.press('Enter');
  await B.p.locator('.msg strong', { hasText: 'Amara' }).waitFor({ timeout: 5000 });
  await A.p.getByRole('button', { name: /Bodhi/ }).first().click({ timeout: 8000 });
  const got = await seen(A.p.locator('.msg-content', { hasText: 'Hi' }).first(), 8000);
  check('A receives B\'s DM with markdown rendered', got && await A.p.locator('.msg-content strong', { hasText: 'Amara' }).count() > 0);
  await A.p.getByRole('textbox', { name: /Message/ }).fill('hey bodhi 🌻');
  await A.p.keyboard.press('Enter');
  check('B receives A\'s reply live', await seen(B.p.getByText('hey bodhi'), 8000));
  await A.p.screenshot({ path: `${OUT}/02-dm.png` });

  // Reload recovers history
  await A.p.reload();
  check('history survives reload', await seen(A.p.getByText('hey bodhi'), 10000));

  // Server: A creates, invites B
  await A.p.getByRole('button', { name: 'Add a server' }).click();
  await A.p.getByLabel('Server name').fill('Sunrise Friends');
  await A.p.getByRole('button', { name: 'Create', exact: true }).click();
  await A.p.waitForURL(/channels\/\d+\/\d+/, { timeout: 10000 });
  check('server created with default channel', await seen(A.p.getByRole('heading', { name: 'general', exact: true }), 5000));
  await A.p.getByRole('button', { name: /Sunrise Friends/ }).last().click();
  await A.p.getByRole('menuitem', { name: 'Invite people' }).click();
  await A.p.waitForFunction(() => /invite\//.test(document.querySelector('input[readonly]')?.value ?? ''), null, { timeout: 8000 });
  const link = await A.p.locator('input[readonly]').inputValue();
  await A.p.keyboard.press('Escape');
  check('invite link created', /\/invite\/\w+/.test(link), link);
  await B.p.goto(link);
  await B.p.getByRole('button', { name: 'Accept invite' }).click();
  await B.p.waitForURL(/channels\/\d+\/\d+/, { timeout: 10000 });
  check('B joined via invite', await seen(B.p.getByRole('heading', { name: 'general', exact: true }), 5000));
  await B.p.getByRole('textbox', { name: /Message #general/ }).fill('glad to be here');
  await B.p.keyboard.press('Enter');
  check('A sees B\'s server message live', await seen(A.p.getByText('glad to be here'), 8000));
  // Reaction from A, visible to B
  const msg = A.p.locator('.msg', { hasText: 'glad to be here' });
  await msg.hover(); await msg.getByRole('button', { name: 'React 👍' }).click();
  check('reaction syncs to B', await seen(B.p.locator('.reaction', { hasText: '👍' }), 8000));
  // Edit by B
  const bm = B.p.locator('.msg', { hasText: 'glad to be here' });
  await bm.hover(); await bm.getByRole('button', { name: 'Edit' }).click();
  await B.p.getByLabel('Edit message').fill('so glad to be here');
  await B.p.keyboard.press('Enter');
  check('edit syncs to A', await seen(A.p.getByText('so glad to be here'), 8000));
  await A.p.screenshot({ path: `${OUT}/03-server.png` });

  // Private channel: B must not see it
  await A.p.getByRole('button', { name: /Sunrise Friends/ }).last().click();
  await A.p.getByRole('menuitem', { name: 'Create channel' }).click();
  await A.p.getByLabel('Channel name').fill('staff only');
  await A.p.getByRole('switch').check();
  await A.p.getByRole('button', { name: 'Create', exact: true }).click();
  await A.p.getByRole('heading', { name: 'staff-only', exact: true }).waitFor({ timeout: 5000 });
  await A.p.getByRole('textbox', { name: /Message #staff-only/ }).fill('top secret');
  await A.p.keyboard.press('Enter');
  await B.p.waitForTimeout(1500);
  check('private channel hidden from B', (await B.p.getByRole('button', { name: /staff-only/ }).count()) === 0 && !(await B.p.getByText('top secret').count()));

  // Settings: theme persists across devices (second context for A logs in)
  await A.p.getByRole('button', { name: 'User settings' }).click();
  await A.p.getByRole('tab', { name: 'Appearance' }).click();
  await A.p.locator('label.theme-sw', { hasText: 'Day' }).click();
  await A.p.waitForTimeout(600);
  const scheme = await A.p.evaluate(() => document.documentElement.dataset.scheme);
  check('light theme applies', scheme === 'light');
  await A.p.screenshot({ path: `${OUT}/04-settings-light.png` });
  await A.p.keyboard.press('Escape');
  const A2 = await mk();
  await A2.p.goto(BASE + '/login');
  await A2.p.getByLabel('Email or username').fill(U('amara'));
  await A2.p.getByLabel('Password').fill('correct horse battery');
  await A2.p.getByRole('button', { name: 'Sign in' }).click();
  await A2.p.waitForURL('**/channels/**', { timeout: 10000 });
  await A2.p.waitForTimeout(1000);
  check('theme synced to second device', (await A2.p.evaluate(() => document.documentElement.dataset.scheme)) === 'light');

  // Keyboard: skip link works
  await B.p.reload(); await B.p.locator('.shell').waitFor({ timeout: 10000 });
  await B.p.keyboard.press('Tab');
  check('skip link is first focus target', (await B.p.evaluate(() => document.activeElement?.textContent)) === 'Skip to content');

  // Mobile layout
  const M = await b.newContext({ viewport: { width: 390, height: 844 }, storageState: await B.c.storageState() });
  const mp = await M.newPage(); await mp.goto(BASE + '/channels/@me');
  await mp.getByRole('heading', { name: 'Friends' }).waitFor({ timeout: 10000 });
  await mp.screenshot({ path: `${OUT}/05-mobile.png` });
  check('mobile layout has no horizontal scroll', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  for (const x of [A, B, A2]) if (x.errs.length) console.log('page errors:', x.errs);
  check('no uncaught page errors', ![A, B, A2].some((x) => x.errs.length));
  await b.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
