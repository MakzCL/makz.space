// Turns Tauri's NSIS output into the files the update feed serves:
//   SEND-Setup-<version>.exe and latest.yml (electron-builder's format, so both the old Electron
//   builds and this shell read the same feed). Usage: node scripts/feed.mjs <out-dir>
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "release";
const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const version = conf.version;
const dir = "src-tauri/target/release/bundle/nsis";
const built = readdirSync(dir).find((f) => f.endsWith("-setup.exe") && f.includes(version));
if (!built) throw new Error(`No NSIS installer for ${version} in ${dir}`);
mkdirSync(out, { recursive: true });
const name = `SEND-Setup-${version}.exe`;
copyFileSync(join(dir, built), join(out, name));
const buf = readFileSync(join(out, name));
const sha512 = createHash("sha512").update(buf).digest("base64");
const size = statSync(join(out, name)).size;
writeFileSync(join(out, "latest.yml"), [
  `version: ${version}`, "files:", `  - url: ${name}`, `    sha512: ${sha512}`, `    size: ${size}`,
  `path: ${name}`, `sha512: ${sha512}`, `releaseDate: '${new Date().toISOString()}'`, "",
].join("\n"));
console.log(`${name} ${(size / 1048576).toFixed(1)} MB sha512=${sha512}`);
