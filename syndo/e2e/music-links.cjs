// SEND Music links: YouTube videos and playlists play in YouTube's player (in sync), Spotify and Deezer songs,
// albums and playlists are read and matched, and the YouTube player can be hidden.
// Usage: node e2e/music-links.cjs http://localhost:3900 [outdir]   (needs internet access from the server)
const { chromium } = require('playwright');
const BASE = process.argv[2], OUT = process.argv[3] ?? '.', SFX = Date.now().toString(36).slice(-5);
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => { try { for (const k of ['send.desktop-prompt.dismissed.v1', 'send.android-prompt.dismissed.v1']) localStorage.setItem(k, '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); } catch {} });
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { c, p, name, errs };
  };
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  const A = await mk('a'), B = await mk('b');
  for (const x of [A, B]) { await x.p.goto(BASE + '/login'); await api(x, 'POST', '/api/auth/register', { email: `l_${x.name}_${SFX}@example.test`, username: `l_${x.name}_${SFX}`, password: 'correct horse battery' }); }
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Links', template: 'friends' })).body;
  const chans = (await api(A, 'GET', `/api/guilds/${g.id}`)).body.channels ?? g.channels;
  const text = chans.find((c) => c.type === 0), room = chans.find((c) => c.type === 2);
  const inv = (await api(A, 'POST', `/api/channels/${text.id}/invites`, {})).body; await api(B, 'POST', `/api/invites/${inv.code}`, {});
  for (const x of [A, B]) { await x.p.goto(`${BASE}/channels/${g.id}/${text.id}`); await x.p.waitForSelector('.side-ch', { timeout: 20000 }); await x.p.locator('.side-ch', { hasText: room.name }).first().click(); await x.p.waitForSelector('.call-controls', { timeout: 15000 }); }
  await sleep(1200);
  const state = () => api(A, 'GET', `/api/music/${room.id}`).then((r) => r.body);
  const bot = async () => (await api(A, 'GET', `/api/channels/${text.id}/messages?limit=10`)).body.filter((m) => m.author.username === 'sendmusic').map((m) => m.content);
  // Same as typing the /command in the message box.
  const say = async (c, wait = 2500) => { const m = /^!(\w+)(?:\s+(.*))?$/.exec(c); const command = { np: 'nowplaying' }[m[1]] ?? m[1]; await api(A, 'POST', '/api/music/command', { channel_id: text.id, command, ...(m[2] ? { query: m[2] } : {}) }); await sleep(wait); };
  const stop = async () => { await say('!stop', 1500); };

  // YouTube video
  await say('!play https://www.youtube.com/watch?v=dQw4w9WgXcQ', 3000);
  let s = await state();
  check('YouTube link plays as a YouTube track', s.playing?.kind === 'youtube' && s.playing.video_id === 'dQw4w9WgXcQ' && /Never Gonna Give You Up/.test(s.playing.title), s.playing?.title);
  check('the bot names it as YouTube', (await bot()).some((m) => /Now playing \*\*Rick Astley.*\(YouTube\)/.test(m)));
  await A.p.waitForSelector('.yt-dock iframe', { timeout: 20000 }).catch(() => {});
  await B.p.waitForSelector('.yt-dock iframe', { timeout: 20000 }).catch(() => {});
  check('YouTube player dock shows for both listeners', await A.p.locator('.yt-dock iframe').count() === 1 && await B.p.locator('.yt-dock iframe').count() === 1);
  const yt = (x) => x.p.evaluate(() => { const p = window.__sendYT; if (!p?.getPlayerState) return null; return { state: p.getPlayerState(), t: p.getCurrentTime(), vid: p.getVideoData?.().video_id }; });
  let ya = null, yb = null;
  for (let i = 0; i < 20; i++) { ya = await yt(A); yb = await yt(B); if (ya?.state === 1 && yb?.state === 1 && ya.t > 1) break; await sleep(1000); }
  check('YouTube actually plays on both (player state playing, time moving)', ya?.state === 1 && yb?.state === 1, JSON.stringify([ya, yb]));
  if (ya && yb) check('both YouTube players in sync (within 2.5 s)', Math.abs(ya.t - yb.t) < 2.5, `${ya.t?.toFixed(1)} vs ${yb.t?.toFixed(1)}`);
  s = await state();
  check('YouTube length reported back to the server', s.playing?.duration > 100, String(s.playing?.duration));
  await A.p.screenshot({ path: `${OUT}/music-youtube.png` });
  await say('!pause', 2500);
  ya = await yt(A); check('pause pauses the YouTube player', ya?.state === 2, JSON.stringify(ya));
  await say('!resume', 2500);
  // On the call screen YouTube's player sits in the music player's video spot (it must stay visible).
  const spot = await A.p.evaluate(() => { const d = document.querySelector('.yt-dock')?.getBoundingClientRect(), v = document.querySelector('.ms-video')?.getBoundingClientRect(); return !!d && !!v && Math.abs(d.x - v.x) < 2 && Math.abs(d.y - v.y) < 2 && d.width >= 200 && d.height >= 200; });
  check("YouTube's player sits in the call screen player's video spot", spot);
  await stop();
  check('stopping removes the YouTube player', await A.p.locator('.yt-dock').count() === 0);

  // YouTube playlist
  await say('!play https://www.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i', 4000);
  s = await state();
  const said = await bot();
  check('YouTube playlist queues its songs', s.playing?.source === 'youtube' && s.queue.length >= 5, `${s.queue.length} queued, playing ${s.playing?.title} via ${s.playing?.via ?? 'YouTube'}`);
  check('the bot says how many were added and from which playlist', said.some((m) => /Added \*\*\d+\*\* songs from \*\*/.test(m)), said.find((m) => /Added/.test(m)));
  await say('!skip', 3000); s = await state();
  check('skip moves through the playlist', s.playing?.source === 'youtube' || !s.playing, s.playing?.title);
  await stop();

  // Spotify song, read and matched
  await say('!play https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', 5000);
  s = await state(); let m = await bot();
  const sp = s.playing ?? null;
  check('Spotify song is read (title and artist)', sp ? /Never Gonna Give You Up/i.test(sp.title) && /Rick Astley/i.test(sp.artist ?? '') && sp.source === 'spotify' : m.some((x) => /Skipped \*\*Never Gonna Give You Up by Rick Astley\*\*/.test(x)), sp ? `${sp.title} by ${sp.artist}, via ${sp.via}` : m[0]);
  check('Spotify song plays from a matched source, or says why not', (sp && sp.via && sp.kind) || m.some((x) => /couldn't find a version I can play/.test(x)), sp ? `via ${sp.via}` : 'no match');
  await stop();

  // Spotify playlist
  await say('!play https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 12000);
  s = await state(); m = await bot();
  check('Spotify playlist adds its songs', m.some((x) => /Added \*\*\d+\*\* songs from \*\*Today/.test(x)) && (s.queue.length >= 5), m.find((x) => /Added|couldn't/.test(x)));
  check('queued Spotify songs keep their names', s.queue.every((q) => q.source === 'spotify' && q.title && q.artist));
  await stop();

  // Deezer album
  await say('!play https://www.deezer.com/album/302127', 4000);
  s = await state(); m = await bot();
  check('Deezer album adds its songs', m.some((x) => /Added \*\*\d+\*\* songs from \*\*Discovery/.test(x)), m.find((x) => /Added|couldn't/.test(x)));
  await stop();

  check('no page errors', !A.errs.length && !B.errs.length, [...A.errs, ...B.errs].join(' | ').slice(0, 300));
  await b.close();
})();
