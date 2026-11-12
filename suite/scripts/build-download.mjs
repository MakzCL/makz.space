// Builds the Windows zip and publishes it on the update site as < 25 MiB parts (the Cloudflare Pages per-file limit).
// functions/download/[file].js joins them back into one download at a permanent address:
//   /download/SK-Suite-win-x64.zip   (always the latest version)
// Usage: node scripts/build-download.mjs [siteDir=site]
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { execSync } from "node:child_process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const site = path.resolve(process.argv[2] ?? path.join(root, "site")); const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
execSync("node scripts/bundle.mjs", { cwd: root, stdio: "inherit" }); // writes version.json and copies the offline apps
execSync("node scripts/package-win.mjs", { cwd: root, stdio: "inherit" });
const name = `SK-Suite-${version}-win-x64.zip`; const zip = fs.readFileSync(path.join(root, "release", name));
const PART = 20 * 1024 * 1024; const dir = path.join(site, "download", "parts"); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const parts = []; for (let i = 0, k = 0; i < zip.length; i += PART, k++) { const f = `${version}-${String(k).padStart(3, "0")}.bin`; fs.writeFileSync(path.join(dir, f), zip.subarray(i, i + PART)); parts.push(f); }
const manifest = { name, version, size: zip.length, sha256: crypto.createHash("sha256").update(zip).digest("hex"), parts, built: new Date().toISOString() };
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(`download ${name}: ${(zip.length / 1048576).toFixed(1)} MB in ${parts.length} parts, sha256 ${manifest.sha256}`);
