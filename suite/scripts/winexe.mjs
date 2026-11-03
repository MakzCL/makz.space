// Shared Windows packaging helpers: fetch the official Electron win32-x64 runtime (checksum-verified),
// and stamp the executable's icon and version information with resedit (pure JavaScript; no Wine needed).
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { execFileSync } from "node:child_process";
import * as ResEdit from "resedit";
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); };

export async function electronWin(version, cacheDir) {
  const name = `electron-v${version}-win32-x64.zip`, base = `https://github.com/electron/electron/releases/download/v${version}/`;
  fs.mkdirSync(cacheDir, { recursive: true }); const zip = path.join(cacheDir, name);
  const want = (await get(base + "SHASUMS256.txt")).toString().split("\n").find((l) => l.trim().endsWith(name))?.split(/\s+/)[0];
  if (!want) throw new Error(`No checksum for ${name}`);
  if (!fs.existsSync(zip) || sha256(fs.readFileSync(zip)) !== want) { console.log(`downloading ${name}`); fs.writeFileSync(zip, await get(base + name)); }
  const got = sha256(fs.readFileSync(zip)); if (got !== want) throw new Error(`Checksum mismatch for ${name}`);
  console.log(`Electron ${version} win32-x64 runtime: sha256 matches SHASUMS256.txt`);
  return zip;
}
export function unzip(zip, dir) { if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`]); else execFileSync("unzip", ["-q", zip, "-d", dir]); }
export function zipDir(parent, folder, out) {
  fs.rmSync(out, { force: true });
  if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${path.join(parent, folder)}' -DestinationPath '${out}'`]);
  else execFileSync("zip", ["-qr9", out, folder], { cwd: parent });
  const s = sha256(fs.readFileSync(out)); fs.writeFileSync(`${out}.sha256`, `${s}  ${path.basename(out)}\n`); return s;
}
/** Sets icon, product name, description, version and company on a Windows PE executable. */
export function stampExe(exe, { icon, product, description, version, company, fileName }) {
  const data = fs.readFileSync(exe);
  const pe = ResEdit.NtExecutable.from(data, { ignoreCert: true }); const res = ResEdit.NtExecutableResource.from(pe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icon));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const v = version.split(".").map(Number); while (v.length < 4) v.push(0);
  vi.setFileVersion(v[0], v[1], v[2], v[3], 1033); vi.setProductVersion(v[0], v[1], v[2], v[3], 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, { ProductName: product, FileDescription: description, CompanyName: company, OriginalFilename: fileName, InternalName: product, ProductVersion: version, FileVersion: version, LegalCopyright: "" });
  vi.outputToResourceEntries(res.entries); res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
}
