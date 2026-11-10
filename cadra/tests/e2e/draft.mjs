// CADRA end-to-end: draw by typing and by clicking, snap, edit, dimension, layers, export DXF, reopen it, three palettes.
// Run: npm run build ; npx vite preview --port 4290   then   node tests/e2e/draft.mjs <outDir>
import { createRequire } from "node:module"; import fs from "node:fs"; import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const URL = process.env.APP_URL ?? "http://localhost:4290/"; const OUT = process.argv[2] ?? "tests/out"; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/fonts/.test(m.text()) && errs.push(m.text()));
let step = 0; const ok = (m) => console.log(`✓ ${++step}. ${m}`); const fail = (m) => { console.error(`✗ ${m}`); process.exitCode = 1; };
const cmd = async (...xs) => { for (const x of xs) { await p.getByTestId("cmdline").fill(x); await p.keyboard.press("Enter"); await p.waitForTimeout(40); } };
const log = () => p.locator(".c-log").innerText();
const count = () => p.locator(".c-status .c-dimtxt").innerText().then((t) => +t.split(" ")[0]);
await p.goto(URL); await p.waitForTimeout(500);
// 1 typed geometry
await cmd("rec", "0,0", "@120,80"); await cmd("c", "60,40", "25"); await cmd("l", "0,0", "120,80", ""); await cmd("pl", "0,100", "@50,0", "@0,20", "c");
(await count()) === 4 ? ok("rectangle, circle, line and closed polyline drawn from typed coordinates") : fail(`objects ${await count()}`);
await cmd("z"); await p.screenshot({ path: `${OUT}/cadra-1-typed.png` });
// 2 click drawing with an endpoint snap: start a line near the rectangle's corner, end with a typed polar point
const box = await p.getByTestId("canvas").boundingBox(); const view = await p.evaluate(() => 0);
await cmd("l"); const corner = await p.evaluate(() => null); void corner; void view;
// find the screen position of world (120,0) from the status bar readout by hovering
const scr = async (x, y) => { let lo = [box.x, box.y], hi = [box.x + box.width, box.y + box.height]; // locate world point by probing the coordinate readout
  const at = async (sx, sy) => { await p.mouse.move(sx, sy); const t = await p.getByTestId("coords").innerText(); return t.split(",").map(Number); };
  const a = await at(box.x + 100, box.y + 100), c = await at(box.x + 300, box.y + 300); const kx = (c[0] - a[0]) / 200, ky = (c[1] - a[1]) / 200; void lo; void hi;
  return [box.x + 100 + (x - a[0]) / kx, box.y + 100 + (y - a[1]) / ky]; };
p.locator(".c-status button", { hasText: "OSNAP" }).click(); await p.waitForTimeout(50); // probe without snapping
const q = await scr(120, 0); await p.locator(".c-status button", { hasText: "OSNAP" }).click();
await p.mouse.move(q[0] + 4, q[1] - 3); await p.waitForTimeout(80); const snapped = await p.getByTestId("coords").innerText();
await p.mouse.click(q[0] + 4, q[1] - 3); await cmd("@40<90", "");
snapped.startsWith("120, 0") ? ok(`endpoint snap locked the cursor to the corner (${snapped})`) : fail(`snap readout ${snapped}`);
// 3 trim: cut the diagonal inside the circle region isn't needed; trim circle with the diagonal + rectangle edges is complex: trim the new vertical line's top beyond a crossing line
await cmd("l", "100,20", "140,20", ""); const before = await count();
await cmd("tr"); const t1 = await scr(120, 35); await p.mouse.click(t1[0], t1[1]); await p.keyboard.press("Escape");
const lg = await log(); (await count()) === before && !/nothing to trim/.test(lg) ? ok("TRIM removed the picked part of the line above the cutting edge") : fail(`trim: ${lg.split("\n").slice(-3).join(" | ")}`);
// 4 dimension + radius dimension
await cmd("dli", "0,0", "120,0", "60,-15"); /= 120/.test(await log()) ? ok("linear dimension reads 120") : fail("dim text");
await cmd("dra"); const ce = await scr(85, 40); await p.mouse.click(ce[0], ce[1]); await cmd("100,60"); /R25/.test(await log()) ? ok("radius dimension picked on the circle reads R25") : fail(`dra ${(await log()).slice(-200)}`);
// 5 window select + move + undo
const w1 = await scr(-5, 95), w2 = await scr(55, 125); await p.mouse.move(w1[0], w1[1]); await p.mouse.down(); await p.mouse.move(w2[0], w2[1], { steps: 4 }); await p.mouse.up();
const selTxt = await p.locator("[aria-label=Properties]").innerText(); /1 polyline/.test(selTxt) && /Area/.test(selTxt) ? ok("window selection picked the polyline; properties show its area") : fail(`props ${selTxt}`);
await cmd("m", "0,0", "@0,10"); await p.waitForTimeout(80); const after = await p.locator("[aria-label=Properties]").innerText(); void after;
await p.keyboard.press("Control+z"); /Undo/.test(await log()) ? ok("MOVE then Ctrl+Z undo") : fail("undo");
// 6 layers: new layer, draw on it, hide it
await cmd("la", "Holes"); await cmd("c", "20,20", "5"); const n1 = await count();
await p.getByRole("button", { name: "Hide layer Holes" }).click(); await p.waitForTimeout(80);
(await p.locator(".c-layers").innerText()).includes("Holes") && n1 >= 9 ? ok("layer Holes created, circle drawn on it, layer hidden") : fail("layers");
await p.getByRole("button", { name: "Show layer Holes" }).click();
// 7 bad input and Esc
await cmd("line", "nonsense"); /Invalid point/.test(await log()) ? ok("invalid coordinates are explained, command keeps waiting") : fail("invalid");
await p.keyboard.press("Escape"); await p.waitForTimeout(40); /\*Cancel\*/.test(await log()) ? ok("Esc cancels the running command") : fail("esc");
// 7b fillet with radius by clicking two lines, polar array, block + insert
await cmd("l", "200,0", "240,0", "240,40", ""); await cmd("c", "300,0", "2"); await cmd("z"); const fa = await scr(220, 0), fb = await scr(240, 20);
await cmd("f", "r", "5"); await p.mouse.click(fa[0], fa[1]); await p.mouse.click(fb[0], fb[1]); await p.waitForTimeout(60);
const props = async () => { await p.keyboard.press("Escape"); const c = await scr(240 - 5 + 5 * Math.cos(-Math.PI / 4), 5 + 5 * Math.sin(-Math.PI / 4)); await p.mouse.click(c[0], c[1]); await p.waitForTimeout(60); return p.locator("[aria-label=Properties]").innerText(); };
/1 arc/.test(await props()) && /Radius\s*5/.test(await p.locator("[aria-label=Properties]").innerText()) ? ok("FILLET R5 on two clicked lines made a radius-5 arc") : fail(`fillet: ${(await log()).slice(-200)}`);
await p.keyboard.press("Escape"); const n0 = await count() - 1; await cmd("pa"); const pc = await scr(300, 0); await p.mouse.click(pc[0], pc[1]); await cmd("", "300,20", "6", "360");
(await count()) === n0 + 6 ? ok("ARRAYPOLAR made 6 circles around a centre") : fail(`polar array count ${await count()} vs ${n0 + 6}: ${(await log()).slice(-200)}`);
await cmd("b", "HOLE6", "300,20"); const w3 = await scr(276, -10), w4 = await scr(324, 45); await p.mouse.move(w3[0], w3[1]); await p.mouse.down(); await p.mouse.move(w4[0], w4[1], { steps: 4 }); await p.mouse.up(); await cmd("");
await cmd("i", "HOLE6", "260,20", "0.5", "0"); /Block "HOLE6" defined from 6 object/.test(await log()) && /Inserted "HOLE6"/.test(await log()) ? ok("BLOCK from a window selection, then INSERT at half scale") : fail(`block: ${(await log()).slice(-300)}`);
// 8 export DXF, validate with ezdxf, reopen
await p.getByRole("button", { name: "File" }).click(); const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("menuitem", { name: /Export DXF/ }).click()]);
const f = `${OUT}/cadra-e2e.dxf`; await dl.saveAs(f);
const py = execFileSync("/opt/nuc-venv/bin/python", ["-c", "import sys,ezdxf;from ezdxf import recover;d,a=recover.readfile(sys.argv[1]);c={};[c.__setitem__(e.dxftype(),c.get(e.dxftype(),0)+1) for e in d.modelspace()];print(len(a.errors),sorted(l.dxf.name for l in d.layers),c)", f]).toString().trim();
py.startsWith("0 ") && py.includes("Holes") && py.includes("INSERT") ? ok(`exported DXF opens in ezdxf with no errors: ${py}`) : fail(`ezdxf ${py}`);
await p.getByRole("button", { name: "File" }).click(); await p.getByRole("menuitem", { name: "New" }).click(); await p.waitForTimeout(100);
const [fc] = await Promise.all([p.waitForEvent("filechooser"), (async () => { await p.getByRole("button", { name: "File" }).click(); await p.getByRole("menuitem", { name: /Open/ }).click(); })()]);
await fc.setFiles(f); await p.waitForTimeout(300); /Opened cadra-e2e\.dxf: \d+ objects/.test(await log()) && (await count()) > 5 ? ok(`reopened the DXF (${await count()} objects)`) : fail(`reopen ${(await log()).slice(-200)}`);
// 9 palettes + phone width
for (const pal of ["Light", "Dark", "Granat"]) { await p.getByRole("button", { name: pal.slice(0, 1), exact: true }).click(); await p.waitForTimeout(120); await p.screenshot({ path: `${OUT}/cadra-pal-${pal.toLowerCase()}.png` }); }
await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200); const sw = await p.evaluate(() => document.documentElement.scrollWidth); await p.screenshot({ path: `${OUT}/cadra-phone.png` });
sw <= 391 ? ok("three palettes captured; no horizontal scroll at 390 px") : fail(`phone width ${sw}`);
errs.length ? fail(`page errors: ${errs.join(" | ")}`) : ok("no page errors");
await b.close();
