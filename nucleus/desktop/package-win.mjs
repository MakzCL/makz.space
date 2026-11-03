// Builds the portable Windows x64 package: release/NUCLEUS-<version>-win-x64.zip
// Uses the official Electron Windows runtime (checksum-verified against the release's SHASUMS256.txt),
// renames electron.exe to NUCLEUS.exe and places the app in resources/app. Nothing is code-signed.
// Needs: dist/ (vite build), network access to github.com, and the zip/unzip commands (Linux/macOS) or
// PowerShell's Expand-Archive/Compress-Archive (Windows).
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { execFileSync } from "node:child_process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const ev = JSON.parse(fs.readFileSync(path.join(root, "node_modules/electron/package.json"), "utf8")).version;
const name = `electron-v${ev}-win32-x64.zip`, base = `https://github.com/electron/electron/releases/download/v${ev}/`;
const cache = path.join(root, ".cache"); fs.mkdirSync(cache, { recursive: true });
const zipPath = path.join(cache, name);
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const sums = (await get(base + "SHASUMS256.txt")).toString();
const want = sums.split("\n").find((l) => l.trim().endsWith(`*${name}`) || l.trim().endsWith(` ${name}`))?.split(/\s+/)[0];
if (!want) throw new Error(`No checksum for ${name}`);
if (!fs.existsSync(zipPath) || crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex") !== want) { console.log(`downloading ${name}`); fs.writeFileSync(zipPath, await get(base + name)); }
const got = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
if (got !== want) throw new Error(`Checksum mismatch for ${name}`); console.log(`electron ${ev} win32-x64 runtime: sha256 ${got} (matches SHASUMS256.txt)`);
if (!fs.existsSync(path.join(root, "dist/index.html"))) throw new Error("Run `npm run build` first (dist/ missing)");

const outName = `NUCLEUS-${pkg.version}-win-x64`, rel = path.join(root, "release"), dir = path.join(rel, outName);
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const win = process.platform === "win32";
if (win) execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dir}' -Force`]);
else execFileSync("unzip", ["-q", zipPath, "-d", dir]);
fs.renameSync(path.join(dir, "electron.exe"), path.join(dir, "NUCLEUS.exe"));
const { stampExe } = await import("./winexe.mjs");
stampExe(path.join(dir, "NUCLEUS.exe"), { icon: path.join(root, "desktop/nucleus.ico"), product: "NUCLEUS", description: "NUCLEUS electronics design and simulation", version: pkg.version, company: "NUCLEUS", fileName: "NUCLEUS.exe" });
fs.rmSync(path.join(dir, "resources", "default_app.asar"), { force: true });
const app = path.join(dir, "resources", "app"); fs.mkdirSync(path.join(app, "desktop"), { recursive: true });
fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "nucleus", productName: "NUCLEUS", version: pkg.version, main: "desktop/main.cjs", private: true }, null, 2));
fs.copyFileSync(path.join(root, "desktop/main.cjs"), path.join(app, "desktop/main.cjs"));
fs.cpSync(path.join(root, "dist"), path.join(app, "dist"), { recursive: true });
fs.writeFileSync(path.join(dir, "README.txt"), [`NUCLEUS ${pkg.version} - portable Windows x64 build`, "",
  "Run NUCLEUS.exe. No installation is needed and nothing is written outside your user profile.",
  "The build is not code-signed, so Windows SmartScreen may warn the first time: More info > Run anyway.",
  "Projects are saved as .nucleus files wherever you choose.", "",
  `Runtime: Electron ${ev} (MIT, LICENSE and LICENSES.chromium.html in this folder). Simulation: ngspice (BSD) compiled to WebAssembly.`, ""].join("\r\n"));
const out = path.join(rel, `${outName}.zip`); fs.rmSync(out, { force: true });
if (win) execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${dir}' -DestinationPath '${out}'`]);
else execFileSync("zip", ["-qr9", out, outName], { cwd: rel });
const sha = crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
fs.writeFileSync(`${out}.sha256`, `${sha}  ${path.basename(out)}\n`);
console.log(`${path.relative(root, out)}  ${(fs.statSync(out).size / 1048576).toFixed(1)} MB  sha256 ${sha}`);
