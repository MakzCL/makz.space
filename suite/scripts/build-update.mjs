// Builds the one-click update feed: <out>/update/latest.json + <out>/update/<version>/<files>.
// The feed carries the suite's own code (main, preload, hub, app list) and the bundled NUCLEUS and CADRA; boot.cjs and the
// Electron runtime are not part of it. Every file is listed with its size and SHA-256, which the suite checks.
// Usage: node scripts/build-update.mjs [outDir=site] [--version x.y.z] [--notes "…"]
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { execSync } from "node:child_process";
import { BETA, CHANNEL } from "./channel.mjs";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const vOverride = opt("--version"), notesArg = opt("--notes"); const out = path.resolve(args[0] ?? path.join(root, "site"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = vOverride ?? pkg.version;
execSync("node scripts/bundle.mjs", { cwd: root, stdio: "inherit" });
const notes = notesArg ?? (() => { try { return JSON.parse(fs.readFileSync(path.join(root, "release-notes.json"), "utf8"))[version] ?? ""; } catch { return ""; } })();
const dir = path.join(out, "update", version); fs.rmSync(path.join(out, "update"), { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const files = [];
const add = (rel, buf) => { const dst = path.join(dir, rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, buf); files.push({ path: rel.split(path.sep).join("/"), size: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex") }); };
const walk = (rel) => { const abs = path.join(root, rel); if (fs.statSync(abs).isDirectory()) for (const e of fs.readdirSync(abs).sort()) walk(path.join(rel, e)); else add(rel, fs.readFileSync(abs)); };
for (const f of ["main.cjs", "preload.cjs", "apps.json", ...(BETA ? ["channel.json"] : [])]) walk(f);
walk("hub"); walk("bundled");
add("version.json", Buffer.from(JSON.stringify({ version }) + "\n"));
const big = files.filter((f) => f.size > 25 * 1024 * 1024); if (big.length) throw new Error(`Files over the 25 MiB hosting limit: ${big.map((f) => f.path).join(", ")}`);
const minRuntime = (pkg.devDependencies?.electron ?? "").replace(/^[^\d]*/, "") || null;
fs.writeFileSync(path.join(out, "update", "latest.json"), JSON.stringify({ version, notes, minRuntime, published: new Date().toISOString(), files }, null, 1));
fs.writeFileSync(path.join(out, "_headers"), "/update/latest.json\n  Cache-Control: no-store\n/update/*\n  Access-Control-Allow-Origin: *\n");
const P = CHANNEL.name, dl = `/download/${CHANNEL.slug}-win-x64.zip`;
fs.writeFileSync(path.join(out, "index.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${P}</title><style>body{font:16px system-ui;background:#0b1033;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:520px;padding:24px}a{color:#8a9bff}.dl{display:inline-block;background:#e3342f;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px}.beta{display:inline-block;background:#f5a524;color:#1a1200;font-weight:800;letter-spacing:.15em;font-size:12px;padding:3px 8px;border-radius:6px;vertical-align:middle}</style><main><h1>${P}${BETA ? ' <span class="beta">BETA</span>' : ""}</h1>${BETA ? "<p>The pre-publish suite: every update lands here first for testing, before it reaches SK Suite. It installs next to SK Suite, signs in separately, and uses the same company data.</p>" : ""}<p><a class="dl" href="${dl}">Download ${P} ${version} for Windows</a></p><p>Portable: unzip and run <b>${P}.exe</b>. It is not code-signed, so Windows may warn the first time (More info → Run anyway). Checksum: <a href="${dl}.sha256">SHA-256</a>.</p><p>Already installed? Open ${P} → Settings → Updates and press <b>Update now</b>.</p></main>`);
console.log(`update feed ${version}: ${files.length} files, ${(files.reduce((a, f) => a + f.size, 0) / 1048576).toFixed(1)} MB → ${path.relative(process.cwd(), out) || "."}`);
