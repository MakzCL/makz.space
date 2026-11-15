// Builds SEND's web interface and copies it into the app (dist/app), so the desktop app ships its own interface
// instead of loading the website. Runs before `tauri build` (tauri.conf.json > build.beforeBuildCommand).
// SEND_SKIP_WEB_BUILD=1 reuses an existing web/dist.
import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");            // syndo/
const web = join(root, "web", "dist");
const out = join(here, "..", "dist", "app");

if (!process.env.SEND_SKIP_WEB_BUILD) execSync("npm run build", { cwd: root, stdio: "inherit" });
if (!existsSync(join(web, "index.html"))) throw new Error(`No built interface at ${web}`);
rmSync(out, { recursive: true, force: true });
// Source maps stay out of the app.
cpSync(web, out, { recursive: true, filter: (src) => !src.endsWith(".map") });
let files = 0, bytes = 0;
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else { files++; bytes += s.size; } } };
walk(out);
console.log(`Bundled the interface: ${files} files, ${(bytes / 1048576).toFixed(1)} MB in dist/app`);
