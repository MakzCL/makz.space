// Copies the offline apps into bundled/<id>/: NUCLUES (../nucleus) and CADRA (../cadra). Web apps load from their live URLs.
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
for (const [id, name] of [["nucleus", "NUCLUES"], ["cadra", "CADRA"]]) {
  const src = path.join(root, "..", id);
  if (!fs.existsSync(path.join(src, "dist", "index.html"))) { console.log(`building ${name}…`); execSync("npm run build", { cwd: src, stdio: "inherit", shell: true }); }
  const out = path.join(root, "bundled", id); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.cpSync(path.join(src, "dist"), out, { recursive: true });
  console.log(`bundled ${name} ${JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).version}`);
}
fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({ version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version }) + "\n");
