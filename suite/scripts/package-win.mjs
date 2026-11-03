// Builds release/SK-Suite-<version>-win-x64.zip: portable, unsigned. Run SK Suite.exe from the unzipped folder.
import fs from "node:fs"; import path from "node:path";
import { electronWin, unzip, zipDir, stampExe } from "./winexe.mjs";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const ev = JSON.parse(fs.readFileSync(path.join(root, "node_modules/electron/package.json"), "utf8")).version;
if (!fs.existsSync(path.join(root, "bundled/nucleus/index.html"))) throw new Error("Run `npm run bundle` first");
const zip = await electronWin(ev, path.join(root, ".cache"));
const folder = `SK-Suite-${pkg.version}-win-x64`, rel = path.join(root, "release"), dir = path.join(rel, folder);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); unzip(zip, dir);
const exe = path.join(dir, "SK Suite.exe"); fs.renameSync(path.join(dir, "electron.exe"), exe);
stampExe(exe, { icon: path.join(root, "build/suite.ico"), product: "SK Suite", description: "SK Suite", version: pkg.version, company: "Skalarki Electronics Ltd", fileName: "SK Suite.exe" });
fs.rmSync(path.join(dir, "resources", "default_app.asar"), { force: true });
const app = path.join(dir, "resources", "app"); fs.mkdirSync(app, { recursive: true });
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: "main.cjs", private: true }, null, 2));
for (const f of ["main.cjs", "preload.cjs", "apps.json"]) fs.copyFileSync(path.join(root, f), path.join(app, f));
for (const d of ["hub", "bundled"]) fs.cpSync(path.join(root, d), path.join(app, d), { recursive: true });
fs.writeFileSync(path.join(dir, "README.txt"), [`SK Suite ${pkg.version} - portable Windows x64`, "",
  "Run \"SK Suite.exe\". No installation needed. Right-click it > Send to > Desktop (create shortcut) to pin it.",
  "Not code-signed: Windows SmartScreen may warn the first time (More info > Run anyway).",
  "SK Factory, Kortana and TROTAN load their live sites (internet needed) and stay signed in.",
  "NUCLEUS is included and works offline.", "",
  `Runtime: Electron ${ev} (MIT; LICENSE and LICENSES.chromium.html in this folder).`, ""].join("\r\n"));
const s = zipDir(rel, folder, path.join(rel, `${folder}.zip`));
console.log(`release/${folder}.zip  ${(fs.statSync(path.join(rel, `${folder}.zip`)).size / 1048576).toFixed(1)} MB  sha256 ${s}`);
