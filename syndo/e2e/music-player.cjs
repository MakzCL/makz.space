// SEND Music player: click and drag the progress bar to jump (for everyone), the DJ rule for jumping in someone
// else's song, and the lyrics column scrolling with the song. Start the server with MUSIC_LYRICS=fixture and
// MUSIC_LYRICS_FIXTURE pointing at made-up lines (SEND never stores real lyrics).
// Usage: node e2e/music-player.cjs http://localhost:3900 [outdir]
const { chromium } = require('playwright');
const BASE = process.argv[2], OUT = process.argv[3] ?? '.', SFX = Date.now().toString(36).slice(-5);
const check = (n, ok, x = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? `  (${x})` : ''}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name) => { const c = await b.newContext({ viewport: { width: 1440, height: 900 } }); await c.addInitScript(() => { localStorage.setItem('send.whatsNew.seen', 'skip'); localStorage.setItem('send.desktop-prompt.dismissed.v1', '1'); }); const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { p, name, errs }; };
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: { 'content-type': 'application/json', 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  const A = await mk('a'), B = await mk('b');
  for (const x of [A, B]) { await x.p.goto(BASE + '/login'); await api(x, 'POST', '/api/auth/register', { email: `mp_${x.name}_${SFX}@example.test`, username: `mp_${x.name}_${SFX}`, password: 'correct horse battery' }); }
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Player v2', template: 'friends' })).body;
  const chans = (await api(A, 'GET', `/api/guilds/${g.id}`)).body.channels ?? g.channels;
  const text = chans.find((c) => c.type === 0), room = chans.find((c) => c.type === 2);
  const inv = (await api(A, 'POST', `/api/channels/${text.id}/invites`, {})).body; await api(B, 'POST', `/api/invites/${inv.code}`, {});
  await A.p.goto(`${BASE}/channels/${g.id}/${text.id}`); await A.p.waitForSelector('.side-ch'); await A.p.locator('.side-ch', { hasText: room.name }).first().click(); await A.p.waitForSelector('.call-controls');
  await sleep(1000);
  await api(A, 'POST', `/api/music/${room.id}/control`, { action: 'play', query: 'test' });
  await A.p.waitForSelector('.music-stage .ms-progress.seekable', { timeout: 15000 }).catch(() => {});
  const state = () => api(A, 'GET', `/api/music/${room.id}`).then((r) => r.body);
  const serverPos = async () => { const s = await state(); return (s.position_ms + (s.paused ? 0 : Date.now() - s.server_time)) / 1000; };
  check('the bar can be moved for your own song', await A.p.locator('.ms-progress.seekable [role=slider]').count() === 1);
  // Click at 70% of the bar.
  const box = await A.p.locator('.ms-bar').boundingBox();
  await A.p.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2); await sleep(900);
  const dur = (await state()).playing.duration;
  let p1 = await serverPos();
  check('clicking the bar jumps there for everyone', Math.abs(p1 - dur * 0.7) < 1.6, `${p1.toFixed(1)}s of ${dur}s`);
  const el = await A.p.evaluate(() => window.__sendMusic?.currentTime ?? -1);
  check('the music itself jumps too', Math.abs(el - p1) < 1.8, `${el.toFixed(1)}s`);
  // Drag from 70% back to 20%.
  await A.p.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2); await A.p.mouse.down();
  await A.p.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2, { steps: 5 });
  const mid = await A.p.evaluate(() => document.querySelector('.ms-progress span')?.textContent);
  await A.p.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 5 }); await A.p.mouse.up(); await sleep(900);
  p1 = await serverPos();
  check('dragging shows the time under the pointer and jumps on release', /0:0[5-7]/.test(mid ?? '') && Math.abs(p1 - dur * 0.2) < 1.6, `while dragging ${mid}, now ${p1.toFixed(1)}s`);
  // Arrow keys.
  await A.p.focus('.ms-bar'); await A.p.keyboard.press('ArrowRight'); await sleep(700);
  const p2 = await serverPos();
  check('arrow keys move 5 seconds', Math.abs(p2 - (p1 + 5.7)) < 1.8, `${p1.toFixed(1)} to ${p2.toFixed(1)}`);
  // Lyrics column scrolls with the song.
  await api(A, 'POST', `/api/music/${room.id}/seek`, { track_id: (await state()).playing.id, position: 0 }); await sleep(1200);
  const ly1 = await A.p.evaluate(() => ({ lines: document.querySelectorAll('.ms-lines p').length, now: [...document.querySelectorAll('.ms-lines p')].findIndex((p) => p.classList.contains('now')), y: document.querySelector('.ms-lines')?.style.transform }));
  await sleep(6500);
  const ly2 = await A.p.evaluate(() => ({ now: [...document.querySelectorAll('.ms-lines p')].findIndex((p) => p.classList.contains('now')), y: document.querySelector('.ms-lines')?.style.transform }));
  check('all lines are in the column and it scrolls up as the song goes', ly1.lines >= 5 && ly2.now > ly1.now && ly1.y !== ly2.y, `line ${ly1.now} to ${ly2.now}, ${ly1.y} to ${ly2.y}`);
  await A.p.screenshot({ path: `${OUT}/player-v2.png` });
  // B joins: jumping in A's song needs DJ rights now that two are listening.
  await B.p.goto(`${BASE}/channels/${g.id}/${text.id}`); await B.p.waitForSelector('.side-ch'); await B.p.locator('.side-ch', { hasText: room.name }).first().click(); await B.p.waitForSelector('.call-controls'); await sleep(2000);
  const r = await api(B, 'POST', `/api/music/${room.id}/seek`, { track_id: (await state()).playing.id, position: 2 });
  check("jumping in someone else's song needs DJ rights when others listen", r.status === 403, `${r.status} ${r.body?.message ?? ''}`);
  const own = await api(A, 'POST', `/api/music/${room.id}/seek`, { track_id: (await state()).playing.id, position: 3 }); await sleep(1200);
  const bEl = await B.p.evaluate(() => window.__sendMusic?.currentTime ?? -1);
  check("the requester's jump reaches the other listener", own.status === 200 && Math.abs(bEl - 4.2) < 2, `B at ${bEl.toFixed(1)}s`);
  check('no page errors', !A.errs.length && !B.errs.length, [...A.errs, ...B.errs].join(' | ').slice(0, 200));
  await b.close();
})();
