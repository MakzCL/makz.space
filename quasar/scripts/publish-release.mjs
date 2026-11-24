// Point the in-app updater at a GitHub release built by CI:
//
//   node scripts/publish-release.mjs 0.1.7 <sha256 of QUASAR_0.1.7_x64-setup.exe> "note" "note"
//
// The checksum is GitHub's own `digest` for the release asset. Writes
// site/public/version.json; commit and push to publish.
import { writeFileSync } from "node:fs";

const [version, sha256, ...notes] = process.argv.slice(2);
if (!version || !/^[0-9a-f]{64}$/.test(sha256 ?? "")) throw new Error("usage: publish-release.mjs <version> <sha256> [notes...]");
const name = `QUASAR_${version}_x64-setup.exe`;
const manifest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  notes,
  windows: { url: `https://github.com/MakzCL/makz.space/releases/download/quasar-v${version}/${name}`, sha256 },
};
writeFileSync("site/public/version.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest);
