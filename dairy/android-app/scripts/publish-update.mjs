// Publish a built APK so phones offer it under More → App updates.
//
//   SUPABASE_KEY=<service_role key> node scripts/publish-update.mjs "What changed" ["Co się zmieniło"]
//
// Reads the version from android/app/build.gradle, uploads
// releases/DairyHerd-<version>.apk and releases/latest.json to the public
// `dairy-app` bucket. The service_role key is in the Supabase dashboard
// (Project settings → API keys); never put it in the app or in git.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const { SYNC_URL } = await import(join(here, '..', 'js', 'config.js'));
const KEY = process.env.SUPABASE_KEY;
if (!KEY) { console.error('Set SUPABASE_KEY (service_role key).'); process.exit(1); }

const gradle = await readFile(join(here, 'android', 'app', 'build.gradle'), 'utf8');
const versionCode = +gradle.match(/versionCode (\d+)/)[1];
const versionName = gradle.match(/versionName "([^"]+)"/)[1];
const apkPath = process.env.APK || join(here, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const apk = await readFile(apkPath);
const sha256 = createHash('sha256').update(apk).digest('hex');
const name = `releases/DairyHerd-${versionName}.apk`;
const base = `${SYNC_URL}/storage/v1/object`;

async function upload(path, body, type, cache) {
  const res = await fetch(`${base}/dairy-app/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': `max-age=${cache}` },
    body,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

await upload(name, apk, 'application/vnd.android.package-archive', 31536000);
// Stable address for invites: always the newest version.
await upload('releases/DairyHerd-latest.apk', apk, 'application/vnd.android.package-archive', 300);
const latest = {
  versionCode, versionName, sha256, size: apk.length,
  url: `${base}/public/dairy-app/${name}`,
  notes: { en: process.argv[2] || '', pl: process.argv[3] || process.argv[2] || '' },
  publishedAt: new Date().toISOString(),
};
await upload('releases/latest.json', JSON.stringify(latest, null, 2), 'application/json', 60);
console.log(`Published ${versionName} (${versionCode}) — ${latest.url}`);
