// Builds release/SK-Suite-<version>-win-x64.zip: portable, unsigned. Run SK Suite.exe from the unzipped folder.
import fs from "node:fs"; import path from "node:path";
import { electronWin, unzip, zipDir, stampExe } from "./winexe.mjs";
import { BETA, CHANNEL } from "./channel.mjs";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const ev = JSON.parse(fs.readFileSync(path.join(root, "node_modules/electron/package.json"), "utf8")).version;
if (!fs.existsSync(path.join(root, "bundled/nucleus/index.html")) || !fs.existsSync(path.join(root, "bundled/cadra/index.html"))) throw new Error("Run `npm run bundle` first");
const zip = await electronWin(ev, path.join(root, ".cache"));
const P = CHANNEL.name, folder = `${CHANNEL.slug}-${pkg.version}-win-x64`, rel = path.join(root, "release"), dir = path.join(rel, folder);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); unzip(zip, dir);
const exe = path.join(dir, `${P}.exe`); fs.renameSync(path.join(dir, "electron.exe"), exe);
stampExe(exe, { icon: path.join(root, "build/suite.ico"), product: P, description: P, version: pkg.version, company: "Skalarki Electronics Ltd", fileName: `${P}.exe` });
fs.rmSync(path.join(dir, "resources", "default_app.asar"), { force: true });
const app = path.join(dir, "resources", "app"); fs.mkdirSync(app, { recursive: true });
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: CHANNEL.pkgName, productName: P, version: pkg.version, main: "boot.cjs", private: true }, null, 2));
for (const f of ["boot.cjs", "version.json", "main.cjs", "preload.cjs", "apps.json", ...(BETA ? ["channel.json"] : [])]) fs.copyFileSync(path.join(root, f), path.join(app, f));
for (const d of ["hub", "bundled"]) fs.cpSync(path.join(root, d), path.join(app, d), { recursive: true });
fs.writeFileSync(path.join(dir, "README.txt"), [`${P} ${pkg.version} - portable Windows x64`, "",
  ...(BETA ? ["BETA: the pre-publish suite, for testing updates before they reach SK Suite. It installs and signs in separately, and uses the same company data.", ""] : []),
  `Run "${P}.exe". No installation needed. Right-click it > Send to > Desktop (create shortcut) to pin it.`,
  "Not code-signed: Windows SmartScreen may warn the first time (More info > Run anyway).",
  BETA ? "SK Factory, Kortana and TROTAN load their beta sites (internet needed) and stay signed in." : "SK Factory, Kortana and TROTAN load their live sites (internet needed) and stay signed in.",
  "NUCLEUS and CADRA are included and work offline.", "Updates: Settings > Updates > Update now (one click; the suite restarts itself).", "",
  `Runtime: Electron ${ev} (MIT; LICENSE and LICENSES.chromium.html in this folder).`, ""].join("\r\n"));
const s = zipDir(rel, folder, path.join(rel, `${folder}.zip`));
console.log(`release/${folder}.zip  ${(fs.statSync(path.join(rel, `${folder}.zip`)).size / 1048576).toFixed(1)} MB  sha256 ${s}`);
