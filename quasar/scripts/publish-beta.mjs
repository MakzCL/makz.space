// Put a Windows installer on quasar.makz.space and announce it to the
// in-app updater:
//
//   node scripts/publish-beta.mjs <path/to/QUASAR_x.y.z_x64-setup.exe> "note one" "note two"
//
// Copies the installer to site/public/download/ (removing older ones) and
// writes site/public/version.json with its SHA-256. Commit and push; Cloudflare
// Pages deploys the site and every running QUASAR sees the update.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [file, ...notes] = process.argv.slice(2);
if (!file) throw new Error("usage: publish-beta.mjs <installer.exe> [notes...]");
const name = basename(file);
const version = /QUASAR_([\d.]+)_/.exec(name)?.[1];
if (!version) throw new Error(`cannot read a version from ${name}`);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.version !== version) throw new Error(`installer is ${version} but package.json says ${pkg.version}`);

const dir = "site/public/download";
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (/^QUASAR_.*\.exe$/.test(f) && f !== name) rmSync(join(dir, f));
copyFileSync(file, join(dir, name));
const bytes = readFileSync(file);
const manifest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  notes,
  windows: { url: `https://quasar.makz.space/download/${name}`, sha256: createHash("sha256").update(bytes).digest("hex"), size: statSync(file).size },
};
writeFileSync("site/public/version.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest);
