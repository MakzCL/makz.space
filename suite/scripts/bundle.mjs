// Copies the offline apps into bundled/: NUCLEUS (built from ../nucleus). Web apps load from their live URLs.
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const nuc = path.join(root, "..", "nucleus");
if (!fs.existsSync(path.join(nuc, "dist", "index.html"))) { console.log("building NUCLEUS…"); execSync("npm run build", { cwd: nuc, stdio: "inherit", shell: true }); }
const out = path.join(root, "bundled", "nucleus"); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.dirname(out), { recursive: true });
fs.cpSync(path.join(nuc, "dist"), out, { recursive: true });
console.log(`bundled NUCLEUS ${JSON.parse(fs.readFileSync(path.join(nuc, "package.json"), "utf8")).version}`);
