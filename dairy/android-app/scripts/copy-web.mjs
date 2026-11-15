// Copy the Dairy Herd web app (one folder up) into www/ for Capacitor.
import { cp, rm, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const src = dirname(here);
const out = join(here, 'www');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of ['index.html', 'join.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'fonts']) {
  await cp(join(src, f), join(out, f), { recursive: true });
}
console.log('Copied web app to', out);
