// Opening a conversation after a live message arrived must still load its history.
// Usage: node e2e/history.cjs http://localhost:3900
const { chromium } = require('playwright');
const BASE = process.argv[2]; const SFX = Date.now().toString(36).slice(-5);
(async () => {
  const b = await chromium.launch();
  const mk = async (name, vp) => { const c = await b.newContext({ viewport: vp ?? { width: 1280, height: 800 } }); await c.addInitScript(() => { try { for (const k of ['send.desktop-prompt.dismissed.v1','send.android-prompt.dismissed.v1']) localStorage.setItem(k,'1'); localStorage.setItem('send.whatsNew.seen','skip'); } catch {} }); const p = await c.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message)); p.on('console', m=>{ if(m.type()==='error') errs.push('console: '+m.text()); }); return { c, p, name, errs }; };
  const api = (x, m, path, body) => x.p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-send-client': '1' } : { 'x-send-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  const A = await mk('a'), B = await mk('b'), C = await mk('c');
  for (const x of [A,B,C]) { await x.p.goto(BASE+'/login'); const r = await api(x,'POST','/api/auth/register',{ email:`g_${x.name}_${SFX}@example.test`, username:`g_${x.name}_${SFX}`, password:'correct horse battery' }); x.id = r.body.user.id; }
  for (const y of [B,C]) { await api(A,'POST','/api/users/@me/relationships',{ username:`g_${y.name}_${SFX}` }); await api(y,'PUT',`/api/users/@me/relationships/${A.id}`,{ type:1 }); }
  const g = (await api(A,'POST','/api/users/@me/channels',{ recipients:[B.id,C.id] })).body;
  for (let i=0;i<12;i++) await api([A,B,C][i%3],'POST',`/api/channels/${g.id}/messages`,{ content:`history ${i}` });
  require('child_process').execSync(`psql postgres://syndo:syndo@localhost:5432/syndo_e2e -c "insert into messages(id, channel_id, author_id, type, content, created_at) select (select max(id) from messages)+1+n, ${g.id}, ${A.id}, 3, c, now() - interval '1 day' + n * interval '1 minute' from (values (1, '{\\"state\\":\\"ongoing\\"}'), (2, '{\\"state\\":\\"ended\\",\\"participants\\":[\\"${A.id}\\",\\"${B.id}\\"],\\"duration_s\\":1975}')) v(n,c)"`, { stdio: 'inherit' });
  const list = await api(A,'GET',`/api/channels/${g.id}/messages?limit=50`);
  console.log('api count', list.body.length);
  for (const [x, vp] of [[A],[B,{width:390,height:844}]]) {
    if (vp) await x.p.setViewportSize(vp);
    await x.p.goto(`${BASE}/channels/@me/${g.id}`); await x.p.waitForTimeout(4000);
    console.log(x.name, 'rendered', await x.p.locator('[data-mid]').count(), x.errs.slice(0,5));
    await x.p.screenshot({ path: `${process.argv[3] ?? '.'}/gdm-${x.name}.png` });
  }
  // C has the app open elsewhere, a new message arrives live, then C opens the group.
  await C.p.goto(`${BASE}/channels/@me`); await C.p.waitForTimeout(3000);
  await api(A,'POST',`/api/channels/${g.id}/messages`,{ content:'live one' }); await C.p.waitForTimeout(1500);
  await C.p.locator('.side-dm', { hasText: 'members' }).first().click();
  await C.p.waitForTimeout(3000); const n = await C.p.locator('[data-mid]').count(); console.log(`${n === 15 ? 'PASS' : 'FAIL'} history loads after a live message (${n}/15)`); if (n !== 15) process.exitCode = 1;
  await b.close();
})();
