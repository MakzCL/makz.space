// Copies the offline apps into bundled/<id>/: NUCLEUS (../nucleus) and CADRA (../cadra). Web apps load from their live URLs.
import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
import { BETA, CHANNEL } from "./channel.mjs";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
for (const [id, name] of [["nucleus", "NUCLEUS"], ["cadra", "CADRA"]]) {
  const src = path.join(root, "..", id);
  // the offline apps carry the channel (BETA mark) in their build; rebuild when the last build was for the other channel
  const mark = path.join(src, "dist", ".sk-channel"); const built = fs.existsSync(mark) ? fs.readFileSync(mark, "utf8").trim() : null;
  if (!fs.existsSync(path.join(src, "dist", "index.html")) || (built !== null && built !== CHANNEL.channel) || (built === null && BETA)) {
    console.log(`building ${name} (${CHANNEL.channel})…`); execSync("npm run build", { cwd: src, stdio: "inherit", shell: true, env: { ...process.env, SK_CHANNEL: CHANNEL.channel } });
    fs.writeFileSync(mark, CHANNEL.channel);
  }
  const out = path.join(root, "bundled", id); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.cpSync(path.join(src, "dist"), out, { recursive: true });
  console.log(`bundled ${name} ${JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).version}`);
}
fs.writeFileSync(path.join(root, "version.json"), JSON.stringify({ version: JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version }) + "\n");
// beta builds carry channel.json (name, profile, update feed, app addresses); stable builds must not
const ch = path.join(root, "channel.json");
if (BETA) fs.writeFileSync(ch, JSON.stringify(CHANNEL, null, 1) + "\n"); else fs.rmSync(ch, { force: true });
console.log(`channel: ${CHANNEL.channel} (${CHANNEL.name})`);
