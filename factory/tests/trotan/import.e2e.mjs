// TROTAN import by content (SK Suite file-format SDK): SVGZ/GIF/WebP import, a renamed PNG is read as PNG with a note,
// a real CorelDRAW X5 file is recognised with its version and refused precisely, random bytes are refused, and an SVG
// with text shows the review dialog (Cancel leaves the design unchanged; Import adds the shapes). Mocked backend.
// Run: npm run build && npx vite preview --port 4173 &  then  node tests/trotan/import.e2e.mjs
import { createRequire } from "node:module"; import assert from "node:assert/strict"; import fs from "node:fs"; import zlib from "node:zlib"; import path from "node:path";
import { context, seed } from "./mock.mjs";
const require = createRequire(import.meta.url); const { chromium } = require("playwright");
const BASE = process.env.TROTAN_URL ?? "http://localhost:4173/trotan"; const FX = path.resolve(import.meta.dirname, "../../../packages/sk-formats/tests/fixtures");
let n = 0; const step = (s) => console.log(`✓ ${++n}. ${s}`);
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="20mm" viewBox="0 0 50 20">${body}</svg>`;
const b = await chromium.launch(); const D = seed();
try {
  const { page: p, errors } = await context(b, D);
  await p.goto(BASE); await p.getByTestId("manage").waitFor({ timeout: 15000 });
  await p.getByTestId("new-project").click(); await p.getByTestId("project-name").fill("Import test"); await p.getByTestId("project-name").blur(); await p.getByTestId("create-project").click(); await p.getByTestId("editor").waitFor();
  const put = (name, buffer) => p.getByTestId("file-input").setInputFiles({ name, mimeType: "application/octet-stream", buffer });
  const status = () => p.getByTestId("status").innerText();
  // 1 SVGZ
  await put("plate.svgz", zlib.gzipSync(svg('<rect x="0" y="0" width="40" height="15" fill="none" stroke="#f00"/>'))); await p.getByText(/Imported 1 object from plate.svgz/).waitFor();
  assert.match(await status(), /40\.00 × 15\.00 mm/); step("SVGZ (gzip-compressed SVG) imported at true size, 40 × 15 mm");
  // 2 GIF and WebP (browser-decoded)
  for (const f of ["img.gif", "img.webp"]) { await put(f, fs.readFileSync(path.join(FX, f))); await p.getByText(`Placed ${f}`).waitFor(); }
  step("GIF and WebP images placed");
  // 3 renamed PNG
  await put("logo.cdr", fs.readFileSync(path.join(FX, "img.png"))); await p.getByText("Placed logo.cdr").waitFor();
  step("a PNG renamed to logo.cdr was identified by its content and placed as an image");
  // 4 real CorelDRAW X5 file: recognised precisely, refused honestly, design unchanged
  const before = await p.evaluate(() => document.querySelectorAll("[data-testid=objects] li, .t-objects li").length);
  await put("fdo65220.cdr", fs.readFileSync(path.join(FX, "corel-x5-stored.cdr")));
  const err = p.getByText(/fdo65220\.cdr is a CorelDRAW drawing \(CDR 15 \(CorelDRAW X5\)\) file\..*Nothing was imported\./); await err.waitFor();
  assert.equal(await p.evaluate(() => document.querySelectorAll("[data-testid=objects] li, .t-objects li").length), before);
  step("real CorelDRAW X5 file recognised with its version; TROTAN says CDR import comes next and imports nothing");
  // 5 random bytes
  await put("mystery.cdr", fs.readFileSync(path.join(FX, "noise.xyz"))); await p.getByText(/mystery\.cdr: not a file TROTAN recognises/).waitFor();
  step("random bytes named .cdr are refused, not guessed");
  // 6 review dialog: SVG with text → Cancel leaves design unchanged, Import adds the shape
  const withText = svg('<rect x="2" y="2" width="30" height="10" fill="none" stroke="#00f"/><text x="5" y="9">SERIAL</text>');
  const statusBefore = await status();
  await put("label.svg", Buffer.from(withText)); await p.getByTestId("import-review").waitFor();
  assert.match(await p.getByTestId("import-review").innerText(), /Skipped 1 × text elements/); await p.getByTestId("import-cancel").click();
  await p.getByText(/Import of label.svg cancelled/).waitFor(); assert.equal(await status(), statusBefore);
  step("SVG with text: the review lists the skipped text; Cancel leaves the design unchanged");
  await put("label.svg", Buffer.from(withText)); await p.getByTestId("import-confirm").click(); await p.getByText(/Imported 1 object from label.svg/).waitFor();
  assert.match(await status(), /30\.00 × 10\.00 mm/); step("…and Import adds the 30 × 10 mm rectangle");
  assert.deepEqual(errors.filter((e) => !/favicon|fontshare/.test(e)), []); step("no page errors");
  console.log("TROTAN import e2e: all steps passed");
} finally { await b.close(); }
