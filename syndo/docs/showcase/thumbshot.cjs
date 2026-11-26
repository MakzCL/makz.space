const { chromium } = require("playwright");
(async () => { const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--allow-file-access-from-files"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }); p.on("pageerror", (e) => console.log("err", e.message));
  await p.goto("file://" + __dirname + "/thumb.html"); await p.waitForTimeout(1200); await p.evaluate(() => window.render()); await p.waitForTimeout(300);
  await p.screenshot({ path: __dirname + "/SEND-showcase-thumbnail.png", timeout: 180000 }); await b.close(); })();
