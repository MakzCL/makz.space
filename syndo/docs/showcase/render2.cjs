// Render frames [from, to) seconds into out/ as JPEG. Chunks must start at a scene boundary (scenes start their effects fresh).
const { chromium } = require("playwright");
(async () => {
  const [from, to, out] = [+process.argv[2], +process.argv[3], process.argv[4]];
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--allow-file-access-from-files"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  p.on("pageerror", (e) => console.log("err", e.message));
  await p.goto("file://" + __dirname + "/index.html"); await p.waitForTimeout(1500);
  const FPS = 30, i0 = Math.round(from * FPS), i1 = Math.round(to * FPS);
  for (let i = i0; i < i1; i++) {
    await p.evaluate((t) => window.frame(t), i / FPS);
    await p.screenshot({ path: `${out}/f_${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 90 });
    if (i % 60 === 0) console.log("frame", i);
  }
  await b.close(); console.log("done", from, to);
})();
