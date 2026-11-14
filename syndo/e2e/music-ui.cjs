// SEND Music on-screen controls: start from the call screen, now-playing card on every client, queue, pause and
// resume for everyone, skip and stop follow the DJ rules, volume is per person, sidebar mini player.
// Usage: node e2e/music-ui.cjs http://localhost:3900 [outdir]
const { chromium } = require('playwright');
const BASE = process.argv[2], OUT = process.argv[3] ?? '.', SFX = Date.now().toString(36).slice(-5);
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name, viewport = { width: 1280, height: 800 }) => {
    const c = await b.newContext({ viewport });
    await c.addInitScript(() => { try { for (const k of ['send.desktop-prompt.dismissed.v1', 'send.android-prompt.dismissed.v1']) localStorage.setItem(k, '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); } catch {} });
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    return { c, p, name, errs };
  };
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  const A = await mk('a'), B = await mk('b');
  for (const x of [A, B]) { await x.p.goto(BASE + '/login'); const r = await api(x, 'POST', '/api/auth/register', { email: `u_${x.name}_${SFX}@example.test`, username: `u_${x.name}_${SFX}`, password: 'correct horse battery' }); x.id = r.body.user.id; }
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Music UI', template: 'friends' })).body;
  const chans = (await api(A, 'GET', `/api/guilds/${g.id}`)).body.channels ?? g.channels;
  const text = chans.find((c) => c.type === 0), room = chans.find((c) => c.type === 2);
  const inv = (await api(A, 'POST', `/api/channels/${text.id}/invites`, {})).body;
  await api(B, 'POST', `/api/invites/${inv.code}`, {});
  for (const x of [A, B]) { await x.p.goto(`${BASE}/channels/${g.id}/${text.id}`); await x.p.waitForSelector('.side-ch', { timeout: 20000 }); await x.p.locator('.side-ch', { hasText: room.name }).first().click(); await x.p.waitForSelector('.call-controls', { timeout: 15000 }); }
  await sleep(1500);
  const title = (x) => x.p.locator('.music-card .mc-text strong').first().textContent({ timeout: 8000 }).catch(() => null);
  const el = (x) => x.p.evaluate(() => { const e = window.__sendMusic; return e ? { paused: e.paused, volume: e.volume, t: e.currentTime } : null; });
  const botSaid = async () => (await api(A, 'GET', `/api/channels/${room.id}/messages?limit=20`)).body.filter((m) => m.author.username === 'sendmusic').map((m) => m.content);

  // Start from the call screen.
  check('Play music button on the call screen before the bot joins', await A.p.locator('button[aria-label="Play music"]:visible').count() === 1);
  await A.p.click('button[aria-label="Play music"]:visible');
  await A.p.fill('.music-start-pop input', 'test');
  await A.p.click('.music-start-pop button:has-text("Play")');
  await A.p.waitForSelector('.music-card', { timeout: 10000 });
  await sleep(1500);
  check('now-playing card on the starter', /Test Tone A/.test(await title(A) ?? ''), await title(A));
  check('now-playing card on the other listener', /Test Tone A/.test(await title(B) ?? ''), await title(B));
  check('the bot answers in the voice room chat', (await botSaid()).some((s) => /Now playing \*\*SEND Test Tone A/.test(s)));
  check('Play music button hides while the bot is in the room', await A.p.locator('button[aria-label="Play music"]:visible').count() === 0);
  const prog1 = await A.p.locator('.mc-progress span').first().textContent(); await sleep(1600); const prog2 = await A.p.locator('.mc-progress span').first().textContent();
  check('progress ticks', prog1 !== prog2, `${prog1} -> ${prog2}`);
  check('sidebar mini player shows the track', /Test Tone A/.test(await A.p.locator('.music-mini').textContent().catch(() => '')));

  // Queue a second track from the card.
  await A.p.click('.music-card button[aria-label="Add a song"]');
  await A.p.fill('.music-card .music-add input', 'test 2');
  await A.p.click('.music-card .music-add button');
  await sleep(1500);
  check('queue badge counts the next track', (await B.p.locator('.mc-count').textContent().catch(() => '')) === '1');
  await B.p.click('.music-card button[aria-label="Queue"]');
  check('queue list shows it with the requester', /Test Tone B[\s\S]*asked by u_a_/.test(await B.p.locator('.mc-queue').textContent()));
  await B.p.screenshot({ path: `${OUT}/music-card.png` });

  // Pause and resume for everyone.
  await B.p.click('.music-card button[aria-label="Pause"]'); await sleep(1200);
  const [pa, pb] = [await el(A), await el(B)];
  check('pause from the card pauses everyone', pa?.paused && pb?.paused && /Paused/.test(await A.p.locator('.music-card .mc-text small').textContent()));
  await B.p.click('.music-card button[aria-label="Resume"]'); await sleep(1500);
  const [ra, rb] = [await el(A), await el(B)];
  check('resume carries on for everyone', ra && rb && !ra.paused && !rb.paused);

  // Skip: B can't skip A's track while A listens; A can.
  await B.p.click('.music-card button[aria-label="Skip"]'); await sleep(1500);
  check('skipping someone else\'s track needs DJ rights', /Test Tone A/.test(await title(A) ?? '') && (await botSaid()).some((s) => /Only .* DJ rights can skip/.test(s)));
  await A.p.click('.music-card button[aria-label="Skip"]'); await sleep(2000);
  check('requester can skip: next track plays', /Test Tone B/.test(await title(B) ?? ''), await title(B));

  // Volume is per person.
  await A.p.click('.music-card button[aria-label="Mute music for me"]'); await sleep(300);
  const [va, vb] = [await el(A), await el(B)];
  check('muting music only affects me', va?.volume === 0 && vb?.volume > 0, `${va?.volume} / ${vb?.volume}`);
  await A.p.click('.music-card button[aria-label="Unmute music"]');

  // Stop: B needs DJ rights; A owns the server.
  await B.p.click('.music-card button[aria-label="Stop and disconnect the music bot"]'); await sleep(1500);
  check('stop needs DJ rights when others are listening', await A.p.locator('.music-card').count() === 1);
  await A.p.click('.music-card button[aria-label="Stop and disconnect the music bot"]'); await sleep(2000);
  check('stop removes the card for everyone', await A.p.locator('.music-card').count() === 0 && await B.p.locator('.music-card').count() === 0);
  check('Play music button comes back', await B.p.locator('button[aria-label="Play music"]:visible').count() === 1);
  const r = await api(B, 'POST', `/api/music/${room.id}/control`, { action: 'play' });
  check('play without a song name is refused', r.status === 400);
  const C = await mk('c'); await C.p.goto(BASE + '/login'); await api(C, 'POST', '/api/auth/register', { email: `u_c_${SFX}@example.test`, username: `u_c_${SFX}`, password: 'correct horse battery' }); await api(C, 'POST', `/api/invites/${inv.code}`, {});
  check('people outside the room can\'t control it', (await api(C, 'POST', `/api/music/${room.id}/control`, { action: 'play', query: 'test' })).status === 403);

  // Phone layout.
  const P = await mk('p', { width: 393, height: 851 }); P.p.on('pageerror', () => {});
  await P.p.goto(BASE + '/login'); await api(P, 'POST', '/api/auth/register', { email: `u_p_${SFX}@example.test`, username: `u_p_${SFX}`, password: 'correct horse battery' }); await api(P, 'POST', `/api/invites/${inv.code}`, {});
  await P.p.goto(`${BASE}/channels/${g.id}/${room.id}`); await sleep(2500);
  const join = P.p.getByRole('button', { name: /Join voice/i }).first(); if (await join.count()) await join.click().catch(() => {});
  await P.p.waitForSelector('.m-call-top button[aria-label="Play music"]', { timeout: 15000 }).catch(() => {});
  check('phone: Play music button in the call header', await P.p.locator('.m-call-top button[aria-label="Play music"]:visible').count() === 1);
  await P.p.click('.m-call-top button[aria-label="Play music"]'); await P.p.fill('.music-start-pop input', 'test'); await P.p.click('.music-start-pop button:has-text("Play")');
  await P.p.waitForSelector('.music-card', { timeout: 15000 }).catch(() => {});
  await sleep(800);
  const over = await P.p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check('phone: card shows without sideways scrolling', await P.p.locator('.music-card').count() === 1 && !over);
  await P.p.screenshot({ path: `${OUT}/music-card-phone.png` });
  check('no page errors', !A.errs.length && !B.errs.length, [...A.errs, ...B.errs].join(' | ').slice(0, 200));
  await b.close();
})();
