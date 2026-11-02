// Two-window call test. Start: npx vite --port 5179 --strictPort   then: node tests/calls/run.cjs
// Checks video both ways, camera off/on (avatar, no frozen frame), mute, self-view corners, hang-up ends both.
const { chromium } = require('playwright');
const BASE = 'http://localhost:5179/tests/calls/harness.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, step = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); } return false; }
const remote = (p) => p.evaluate(() => { const v = document.querySelector('.tile-v video'); if (!v) return null; return { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, shown: getComputedStyle(v).opacity === '1', avatar: !!document.querySelector('.tile-av'), micOff: !!document.querySelector('.tile-name svg') }; });
const flowing = async (p) => { const a = await remote(p); if (!a || !a.shown || !a.w) return false; await sleep(400); const b = await remote(p); return b && b.t > a.t; };

async function scenario(b, callerId, opts = '') {
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, permissions: ['camera', 'microphone'] });
  const ids = { A: 'aaaaaaaa-0000-0000-0000-000000000001', B: 'bbbbbbbb-0000-0000-0000-000000000002' };
  const pa = await ctx.newPage(), pb = await ctx.newPage();
  const errs = []; for (const p of [pa, pb]) p.on('pageerror', (e) => errs.push(e.message));
  await pa.goto(`${BASE}?me=${ids.A}${opts}`); await pb.goto(`${BASE}?me=${ids.B}${opts}`);
  await until(() => pa.evaluate(() => !!window.__calls)); await until(() => pb.evaluate(() => !!window.__calls));
  const [caller, callee] = callerId === 'A' ? [pa, pb] : [pb, pa];
  const R = {};
  await caller.evaluate(() => window.__calls.start({ conversationId: 'c0000000-0000-0000-0000-000000000001', kind: 'video' }));
  const call = await until(() => caller.evaluate(() => window.__calls.current?.call));
  await sleep(600);
  await callee.evaluate((c) => window.__calls.join(c), call);
  R.connect_caller_sees = !!(await until(() => flowing(caller), 12000));
  R.connect_callee_sees = !!(await until(() => flowing(callee), 12000));
  // camera off on each side → the other side shows the avatar (no frozen frame)
  for (const [who, me, other] of [['callee', callee, caller], ['caller', caller, callee]]) {
    await me.getByRole('button', { name: 'Camera off' }).click();
    R[`${who}_cam_off_shows_avatar`] = !!(await until(async () => (await remote(other))?.avatar, 3000));
    await me.getByRole('button', { name: 'Camera on' }).click();
    R[`${who}_cam_on_video_back`] = !!(await until(() => flowing(other), 6000));
  }
  await callee.getByRole('button', { name: 'Mute' }).click();
  R.mute_shown = !!(await until(async () => (await remote(caller))?.micOff, 3000));
  await callee.getByRole('button', { name: 'Unmute' }).click();
  // self view: drag to the middle-left; it must settle in a corner, fully on screen
  const sv = callee.locator('.self-view'); const box = await sv.boundingBox();
  await callee.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await callee.mouse.down();
  await callee.mouse.move(60, 330, { steps: 8 }); await callee.mouse.move(-200, 300, { steps: 6 }); await callee.mouse.up(); await sleep(900);
  const after = await sv.boundingBox();
  R.selfview_corner = { x: Math.round(after.x), y: Math.round(after.y), w: Math.round(after.width), h: Math.round(after.height), onScreen: after.x >= 0 && after.y >= 0 && after.x + after.width <= 412 && after.y + after.height <= 860, left: after.x < 40, top: after.y < 200 };
  await callee.screenshot({ path: `/tmp/CALL-${callerId}${opts ? '-lag' : ''}.png` });
  // caller hangs up → callee's call ends too, with no "Calling…" restart
  await caller.getByRole('button', { name: 'Leave call' }).click();
  R.hangup_ends_both = !!(await until(() => callee.evaluate(() => !document.querySelector('.call-screen') && !window.__calls.current), 4000));
  R.errors = errs;
  await ctx.close();
  return R;
}
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  for (const [c, o] of [['A', ''], ['B', ''], ['B', '&presencelag=900']]) console.log(`caller=${c} ${o || ''}`, JSON.stringify(await scenario(b, c, o)));
  await b.close();
})();
