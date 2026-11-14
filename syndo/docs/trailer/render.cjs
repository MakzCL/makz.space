const { chromium } = require("playwright");
(async () => {
  const [mode, out] = [process.argv[2], process.argv[3]];
  const picks = mode === "all" ? null : mode.split(",").map(Number);
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--allow-file-access-from-files"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  p.on("pageerror", (e) => console.log("err", e.message)); p.on("console", (m) => { if (m.type() === "error") console.log("console", m.text()); });
  await p.goto("file://" + __dirname + "/index.html"); await p.waitForTimeout(800);
  const dur = await p.evaluate(() => window.DURATION), FPS = 30, N = Math.round(dur * FPS);
  const last = picks ? Math.max(...picks) * FPS : N;
  for (let i = 0; i <= last; i++) {
    const t = i / FPS;
    await p.evaluate((t) => window.frame(t), t);
    if (!picks || picks.some((x) => Math.abs(x * FPS - i) < .5)) {
      await p.screenshot({ path: picks ? `${out}/p_${t.toFixed(1)}.png` : `${out}/f_${String(i).padStart(5, "0")}.jpg`, ...(picks ? { type: "png" } : { type: "jpeg", quality: 92 }) });
    }
    if (i % 150 === 0) console.log("frame", i, "/", last);
  }
  await b.close();
})();
