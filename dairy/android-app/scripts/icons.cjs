// Render Android launcher icons and splash screens from ../icons/icon.svg.
// Run: node scripts/icons.cjs   (needs Playwright; only used when the icon changes)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const res = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const svg = fs.readFileSync(path.join(__dirname, '..', '..', 'icons', 'icon.svg'), 'utf8');
const GREEN = '#14532d';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (file, w, h, inner, round = false, bg = GREEN) => {
    await p.setViewportSize({ width: w, height: h });
    const s = svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `);
    await p.setContent(`<body style="margin:0;width:${w}px;height:${h}px;display:grid;place-items:center;background:${bg};${round ? 'border-radius:50%;overflow:hidden;' : ''}">${s}</body>`);
    await p.screenshot({ path: file, omitBackground: round });
  };
  for (const [d, k] of Object.entries(densities)) {
    const dir = path.join(res, `mipmap-${d}`);
    const size = Math.round(48 * k);
    await shot(path.join(dir, 'ic_launcher.png'), size, size, size);
    await shot(path.join(dir, 'ic_launcher_round.png'), size, size, Math.round(size * 0.86), true);
    const fg = Math.round(108 * k);
    await shot(path.join(dir, 'ic_launcher_foreground.png'), fg, fg, Math.round(fg * 0.62));
  }
  // Splash screens: keep each file's size, draw the icon on green.
  for (const dir of fs.readdirSync(res).filter((x) => x.startsWith('drawable'))) {
    const f = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    const w = buf.readUInt32BE(16); const h = buf.readUInt32BE(20);
    await shot(f, w, h, Math.round(Math.min(w, h) * 0.35));
  }
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${GREEN}</color>\n</resources>\n`);
  await b.close();
  console.log('icons and splash written');
})();
