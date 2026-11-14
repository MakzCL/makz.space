// SEND Music, end to end with real audio: two clients in one voice room hear the same track (measured from the
// audio output with an analyser), the queue advances on its own, pause/resume/skip/stop work, a second room has its
// own queue, unsupported links are explained, and people outside a voice room are refused.
// Usage: node e2e/music.cjs http://localhost:3900 [outdir]   (start the server with MUSIC_IDLE_SECONDS=10)
const { chromium } = require('playwright');
const BASE = process.argv[2], OUT = process.argv[3] ?? '.', SFX = Date.now().toString(36).slice(-5);
const results = []; const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (!ok) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name) => {
    const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => { try { for (const k of ['send.desktop-prompt.dismissed.v1', 'send.android-prompt.dismissed.v1']) localStorage.setItem(k, '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); } catch {} });
    const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    return { c, p, name, errs };
  };
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  const A = await mk('a'), B = await mk('b'), C = await mk('c'), D = await mk('d');
  for (const x of [A, B, C, D]) { await x.p.goto(BASE + '/login'); const r = await api(x, 'POST', '/api/auth/register', { email: `m_${x.name}_${SFX}@example.test`, username: `m_${x.name}_${SFX}`, password: 'correct horse battery' }); x.id = r.body.user.id; }
  const g = (await api(A, 'POST', '/api/guilds', { name: 'Music test', template: 'friends' })).body;
  const full = (await api(A, 'GET', `/api/guilds/${g.id}`)).body;
  const chans = full.channels ?? g.channels;
  const text = chans.find((c) => c.type === 0), [room1, room2] = chans.filter((c) => c.type === 2);
  const inv = (await api(A, 'POST', `/api/channels/${text.id}/invites`, {})).body;
  for (const x of [B, C, D]) await api(x, 'POST', `/api/invites/${inv.code}`, {});
  console.log('rooms', room1.name, room2.name, 'text', text.name);

  const join = async (x, room) => {
    await x.p.goto(`${BASE}/channels/${g.id}/${text.id}`); await x.p.waitForSelector('.side-ch', { timeout: 20000 });
    await x.p.locator('.side-ch', { hasText: room.name }).first().click();
    await sleep(2500);
  };
  const say = async (x, content) => { const r = await api(x, 'POST', `/api/channels/${text.id}/messages`, { content }); await sleep(1800); return r; };
  const botSaid = async (since) => { const r = await api(A, 'GET', `/api/channels/${text.id}/messages?limit=30`); return r.body.filter((m) => m.author.username === 'sendmusic' && BigInt(m.id) > BigInt(since)).map((m) => m.content).reverse(); };
  const lastId = async () => (await api(A, 'GET', `/api/channels/${text.id}/messages?limit=1`)).body[0]?.id ?? '0';
  // What a client is playing, and how loud its audio output is right now.
  const hear = (x) => x.p.evaluate(async () => {
    const el = window.__sendMusic; if (!el) return { has: false };
    let rms = 0;
    try {
      const ctx = window.__musicCtx ??= new AudioContext();
      const an = window.__musicAn ??= (() => { const a = ctx.createAnalyser(); a.fftSize = 2048; return a; })();
      if (window.__musicSrcFor !== el.src) { window.__musicSrcFor = el.src; const s = el.captureStream ? el.captureStream() : el.mozCaptureStream(); window.__musicNode?.disconnect(); window.__musicNode = ctx.createMediaStreamSource(s); window.__musicNode.connect(an); }
      await ctx.resume(); await new Promise((r) => setTimeout(r, 400));
      const buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf); rms = Math.sqrt(buf.reduce((n, v) => n + v * v, 0) / buf.length);
    } catch (e) { rms = -1; }
    return { has: true, paused: el.paused, t: el.currentTime, src: el.src.split('/').pop(), rms: +rms.toFixed(4), muted: el.muted };
  });
  const musicOf = (x, ch) => x.p.evaluate(async ([ch]) => { const r = await fetch(`/api/music/${ch}`, { headers: { 'x-send-client': '1' } }); return r.json(); }, [ch]);

  // 1. Outsider: not in any voice room.
  let since = await lastId();
  await say(D, '!play test');
  let said = await botSaid(since);
  check('someone outside a voice room is refused', said.some((s) => /join a voice room/.test(s)), said[0]);

  // 2. Two clients in room 1; A plays a test track; both hear it, in sync.
  await join(A, room1); await join(B, room1);
  since = await lastId();
  await say(A, '!play test');
  await sleep(2500);
  said = await botSaid(since);
  check('!play starts immediately when idle', said.some((s) => /Now playing \*\*SEND Test Tone A/.test(s)), said[0]);
  const [ha, hb] = [await hear(A), await hear(B)];
  console.log('A', ha, 'B', hb);
  check('client A is playing with audible output', ha.has && !ha.paused && ha.rms > 0.01, `rms ${ha.rms}`);
  check('client B is playing with audible output', hb.has && !hb.paused && hb.rms > 0.01, `rms ${hb.rms}`);
  check('both clients are in sync (within 1.5 s)', Math.abs(ha.t - hb.t) < 1.5, `${ha.t.toFixed(2)} vs ${hb.t.toFixed(2)}`);
  await A.p.screenshot({ path: `${OUT}/music-a.png` });

  // 3. Queue a second track (B requests it); it starts by itself when the first ends.
  since = await lastId();
  await say(B, '!play test 2');
  said = await botSaid(since);
  check('second request is queued with its position', said.some((s) => /Queued \*\*SEND Test Tone B.*position 1/.test(s)), said[0]);
  since = await lastId();
  await say(A, '!queue');
  said = await botSaid(since);
  check('!queue lists current and upcoming tracks with requesters', said.some((s) => /Now playing:.*Tone A.*requested by m_a_/s.test(s) && /1\. SEND Test Tone B.*requested by m_b_/.test(s)), said[0]?.replace(/\n/g, ' | '));
  since = await lastId();
  await say(B, '!np');
  said = await botSaid(since);
  check('!nowplaying shows title, requester and progress', said.some((s) => /Tone A/.test(s) && /🔘/.test(s) && /\/ 0:14/.test(s) && /Requested by m_a_/.test(s)), said[0]?.replace(/\n/g, ' | '));
  // Wait for track A (14 s) to end.
  for (let i = 0; i < 30; i++) { const m = await musicOf(A, room1.id); if (m.playing?.title === 'SEND Test Tone B') break; await sleep(1000); }
  await sleep(1500);
  const [qa, qb] = [await hear(A), await hear(B)];
  const m1 = await musicOf(A, room1.id);
  check('queue advances automatically to the next track', m1.playing?.title === 'SEND Test Tone B' && qa.rms > 0.01 && qb.rms > 0.01, `${m1.playing?.title}, rms ${qa.rms}/${qb.rms}`);

  // 4. Pause and resume.
  await say(B, '!pause');
  await sleep(800);
  const [pa, pb] = [await hear(A), await hear(B)]; await sleep(1500); const pa2 = await hear(A);
  check('!pause stops playback on both clients', pa.paused && pb.paused && Math.abs(pa2.t - pa.t) < 0.05, `A ${pa.paused} B ${pb.paused}`);
  await say(B, '!resume');
  await sleep(1200);
  const [ra, rb] = [await hear(A), await hear(B)];
  const mr = await musicOf(A, room1.id);
  check('!resume continues on both clients from the same spot', !ra.paused && !rb.paused && ra.rms > 0.01 && ra.t >= pa.t && Math.abs(ra.t - mr.position_ms / 1000) < 1.5, `paused at ${pa.t.toFixed(1)}s, now ${ra.t.toFixed(1)}s, server ${(mr.position_ms / 1000).toFixed(1)}s`);

  // 5. Skip: queue another, skip.
  await say(A, '!play test');
  since = await lastId();
  await say(A, '!skip');
  await sleep(1200);
  said = await botSaid(since);
  const m2 = await musicOf(A, room1.id);
  check('!skip moves to the next track', said.some((s) => /Skipped \*\*SEND Test Tone B/.test(s)) && m2.playing?.title === 'SEND Test Tone A', `${m2.playing?.title}`);

  // 6. Second room: C joins room 2 and plays; room 1 keeps its own queue.
  await join(C, room2);
  await say(C, '!play test 2');
  await sleep(1500);
  const r1 = await musicOf(A, room1.id), r2 = await musicOf(C, room2.id); const hc = await hear(C), ha6 = await hear(A);
  check('a second voice room has its own independent queue', r1.playing?.title === 'SEND Test Tone A' && r2.playing?.title === 'SEND Test Tone B' && r1.playing.id !== r2.playing.id && hc.rms > 0.01 && ha6.src !== hc.src, `room1 ${r1.playing?.title}, room2 ${r2.playing?.title}`);
  // C (in room 2) can't control room 1: !skip from C skips room 2 only.
  since = await lastId();
  await say(C, '!stop');
  await sleep(800);
  const r1b = await musicOf(A, room1.id), r2b = await musicOf(C, room2.id);
  check('commands only affect the sender\'s own room', r1b.active && r1b.playing?.title === 'SEND Test Tone A' && !r2b.active);

  // 7. Links: a web page is refused, a YouTube video is queued (it plays in YouTube's player), private addresses are refused.
  since = await lastId();
  await say(A, '!play https://example.com/');
  await say(A, '!play https://www.youtube.com/watch?v=aqz-KE-bpKQ');
  await say(A, '!play http://127.0.0.1:3900/api/health');
  await sleep(1500);
  said = await botSaid(since);
  check('a web page link is refused with the reason', said.some((s) => /can't play that link: it's text\/html, not audio/.test(s)), said.find((s) => /link/.test(s)));
  check('a YouTube link is queued to play in YouTube\'s player', said.some((s) => /Big Buck Bunny/i.test(s)) || (await musicOf(A, room1.id)).queue.some((t) => t.kind === 'youtube'), said.find((s) => /Bunny|YouTube/.test(s)));
  check('a private or plain-http address is refused', said.some((s) => /only play public https:\/\/ audio links/.test(s)));

  // 8. Song-name search through a real catalogue (Audius). Room 1 is idle by now, so it starts straight away.
  since = await lastId();
  await say(A, '!play lofi chill');
  await sleep(6000);
  said = await botSaid(since);
  const m8 = await musicOf(A, room1.id);
  console.log('audius:', said);
  check('song-name search finds a playable Audius track', said.some((s) => /(Now playing|Queued) \*\*/.test(s)) && (m8.playing?.source === 'audius' || m8.queue.some((t) => t.source === 'audius')), m8.playing ? `${m8.playing.title} by ${m8.playing.artist}` : '');
  const h8 = await hear(A), h8b = await hear(B);
  check('an Audius track streams real audio through SEND to both clients', m8.playing?.source === 'audius' && !h8.paused && h8.rms > 0.005 && h8b.rms > 0.005 && h8.t > 0.5, `rms ${h8.rms}/${h8b.rms}, t ${h8.t?.toFixed(1)}`);

  // 9. DJ rule: B (no DJ rights) can't stop while A is listening; A (owner) can.
  since = await lastId();
  await say(B, '!stop');
  said = await botSaid(since);
  check('!stop needs DJ rights when others are listening', said.some((s) => /needs DJ rights/.test(s)) && (await musicOf(A, room1.id)).active);
  since = await lastId();
  await say(A, '!stop');
  await sleep(1000);
  said = await botSaid(since);
  const [sa, sb] = [await hear(A), await hear(B)]; const m9 = await musicOf(A, room1.id);
  check('!stop clears the queue and disconnects the bot', !m9.active && m9.queue.length === 0 && said.some((s) => /Stopped by/.test(s)) && sa.paused && sb.paused);

  // 9b. Simultaneous requests: six at once from two people, into an idle room.
  since = await lastId();
  await Promise.all([A, B, A, B, A, B].map((x, i) => api(x, 'POST', `/api/channels/${text.id}/messages`, { content: i % 2 ? '!play test 2' : '!play test' })));
  await sleep(4000);
  said = await botSaid(since);
  const m9b = await musicOf(A, room1.id);
  check('simultaneous requests: one player, nothing lost', !!m9b.playing && m9b.queue.length === 5 && said.filter((s) => /Now playing/.test(s)).length === 1 && said.filter((s) => /Queued/.test(s)).length === 5, `playing 1, queued ${m9b.queue.length}`);
  await say(A, '!stop');

  // 10. Idle disconnect: play, everyone leaves, the bot leaves after MUSIC_IDLE_SECONDS.
  await say(A, '!play test');
  await sleep(1500);
  // Everyone in room 1 closes the app (their voice state ends when the connection drops).
  await A.c.close(); await B.c.close();
  let left = false;
  for (let i = 0; i < 40 && !left; i++) { await sleep(1000); left = !(await musicOf(D, room1.id)).active; }
  check('bot leaves after the configured idle time with no listeners', left);

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
  console.log('page errors', [A, B, C, D].map((x) => x.errs.slice(0, 3)));
  await b.close();
})();
