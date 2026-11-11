// Crop-to-size editor for avatars and banners. Usage: node e2e/crop.cjs http://localhost:3900 <shot-dir>
const { chromium } = require('playwright');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const fs = require('fs');
const BASE = process.argv[2] ?? 'http://localhost:3900';
const OUT = process.argv[3] ?? '.';
const SFX = Date.now().toString(36).slice(-5);
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const seen = (loc, ms = 5000) => loc.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const gone = (loc, ms = 8000) => loc.waitFor({ state: 'hidden', timeout: ms }).then(() => true, () => false);

function makeGif(w, h, colors) {
  const enc = GIFEncoder();
  for (const [r, g, b] of colors) {
    const data = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) data.set([r, g, b, 255], i * 4);
    const palette = quantize(data, 16); enc.writeFrame(applyPalette(data, palette), w, h, { palette, delay: 200 });
  }
  enc.finish(); return Buffer.from(enc.bytes());
}

(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 1280, height: 860 } });
  await c.addInitScript(() => { try { localStorage.setItem('send.desktop-prompt.dismissed.v1', '1'); localStorage.setItem('send.whatsNew.seen', 'skip'); localStorage.setItem('send.android-prompt.dismissed.v1', '1'); localStorage.setItem('send.ios-prompt.dismissed.v1', '1'); } catch {} });
  const p = await c.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { errs.push('NATIVE ' + d.message()); d.dismiss(); });
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const r = await fetch(path, { method: m, headers: body ? { 'content-type': 'application/json', 'x-syndo-client': '1' } : { 'x-syndo-client': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, path, body]);
  await p.goto(BASE + '/login');
  await api('POST', '/api/auth/register', { email: `crop_${SFX}@example.test`, username: `crop_${SFX}`, password: 'correct horse battery', display_name: 'Cropper' });
  await p.goto(BASE + '/channels/@me');
  await p.getByRole('button', { name: 'User settings' }).first().click();
  const dlg = p.locator('[role=dialog][aria-modal=true]').first();
  await dlg.getByRole('tab', { name: 'Profile', exact: true }).click();

  // 800×400 PNG: left half red, right half blue.
  const png = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 800; c.height = 400; const x = c.getContext('2d'); x.fillStyle = '#e02020'; x.fillRect(0, 0, 400, 400); x.fillStyle = '#2040e0'; x.fillRect(400, 0, 400, 400); const b = await new Promise((r) => c.toBlob(r, 'image/png')); return [...new Uint8Array(await b.arrayBuffer())]; });
  fs.writeFileSync(`${OUT}/halves.png`, Buffer.from(png));
  const before = (await api('GET', '/api/users/@me')).body.avatar;

  // Cancel keeps the old avatar.
  let chooser = p.waitForEvent('filechooser'); await dlg.getByRole('button', { name: 'Edit avatar' }).first().click(); await (await chooser).setFiles(`${OUT}/halves.png`);
  const editor = p.getByRole('dialog', { name: 'Edit avatar' });
  check('Choosing an image opens the crop editor', await seen(editor));
  await editor.locator('.crop-prev-av').first().waitFor({ timeout: 5000 }).catch(() => {});
  check('Editor shows exact-size previews', (await editor.locator('.crop-prev-av').count()) === 3);
  await p.keyboard.press('Escape');
  check('Esc closes the editor but not the settings dialog', await gone(editor) && await dlg.isVisible());
  check('Cancelling leaves the avatar unchanged', (await api('GET', '/api/users/@me')).body.avatar === before);

  // Keyboard: move to the left edge (all red), apply, verify output.
  chooser = p.waitForEvent('filechooser'); await dlg.getByRole('button', { name: 'Edit avatar' }).first().click(); await (await chooser).setFiles(`${OUT}/halves.png`);
  await seen(editor);
  const stage = editor.locator('.crop-stage'); await stage.focus();
  for (let i = 0; i < 12; i++) await p.keyboard.press('Shift+ArrowLeft');
  await p.screenshot({ path: `${OUT}/crop-avatar.png` });
  await editor.getByRole('button', { name: 'Apply' }).click();
  check('Apply uploads and closes the editor', await gone(editor, 15000));
  const after = (await api('GET', '/api/users/@me')).body.avatar;
  check('Avatar URL changed after saving', after && after !== before);
  const px = await p.evaluate(async (u) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = u; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return { w: img.naturalWidth, h: img.naturalHeight, mid: [...x.getImageData(c.width / 2, c.height / 2, 1, 1).data].slice(0, 3) }; }, after);
  check('Output is square and not upscaled (400×400 from a 400px-tall source)', px.w === 400 && px.h === 400, JSON.stringify(px));
  check('Keyboard repositioning changed the crop (centre is the red half)', px.mid[0] > 180 && px.mid[2] < 90, JSON.stringify(px.mid));

  // Zoom with the keyboard and the wheel keeps the crop within the image.
  chooser = p.waitForEvent('filechooser'); await dlg.getByRole('button', { name: 'Edit avatar' }).first().click(); await (await chooser).setFiles(`${OUT}/halves.png`);
  await seen(editor); await stage.focus();
  await p.keyboard.press('+'); await p.keyboard.press('+');
  const zoomVal = Number(await editor.getByRole('slider', { name: 'Zoom' }).inputValue());
  check('+ zooms in', zoomVal > 1.2, String(zoomVal));
  await p.keyboard.press('0');
  check('0 resets zoom', Number(await editor.getByRole('slider', { name: 'Zoom' }).inputValue()) === 1);
  await editor.getByRole('button', { name: 'Cancel' }).click(); await gone(editor);

  // Animated GIF banner keeps its animation.
  fs.writeFileSync(`${OUT}/anim.gif`, makeGif(320, 120, [[220, 30, 30], [30, 60, 220], [30, 200, 60]]));
  chooser = p.waitForEvent('filechooser'); await dlg.getByRole('button', { name: 'Edit banner' }).first().click(); await (await chooser).setFiles(`${OUT}/anim.gif`);
  const bEditor = p.getByRole('dialog', { name: 'Edit banner' });
  check('Banner editor opens with the 16:5 frame', await seen(bEditor) && await bEditor.locator('.crop-stage').evaluate((el) => Math.abs(el.clientWidth / el.clientHeight - 3.2) < 0.05));
  check('Editor says the animation will be kept', await seen(bEditor.getByText(/animation kept/)));
  await bEditor.getByRole('button', { name: 'Apply' }).click();
  check('Animated banner saves', await gone(bEditor, 20000));
  const banner = (await api('GET', '/api/users/@me')).body.banner;
  const gif = await p.evaluate(async (u) => { const r = await fetch(u); const a = new Uint8Array(await r.arrayBuffer()); let frames = 0; for (let i = 0; i < a.length - 3; i++) if (a[i] === 0x21 && a[i + 1] === 0xf9 && a[i + 2] === 0x04) frames++; return { type: r.headers.get('content-type'), sig: String.fromCharCode(...a.slice(0, 3)), w: a[6] | (a[7] << 8), h: a[8] | (a[9] << 8), frames }; }, banner);
  check('Saved banner is still an animated GIF (3 frames)', gif.sig === 'GIF' && gif.frames === 3, JSON.stringify(gif));
  check('Banner keeps the 16:5 ratio without upscaling', gif.w <= 320 && Math.abs(gif.w / gif.h - 3.2) < 0.05, `${gif.w}x${gif.h}`);

  await p.screenshot({ path: `${OUT}/crop-done.png` });
  check('No page errors or native dialogs', errs.length === 0, errs.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await b.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message.split('\n')[0]); process.exit(2); });
