// Lists English strings in the code that have no Polish translation.
//   node tests/i18n-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PL } from '../js/pl.js';

const files = [];
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : f.name.endsWith('.js') && files.push(join(d, f.name)); };
walk(new URL('../js', import.meta.url).pathname);
const skip = /(db|time|i18n|pl|config|sync|icons)\.js$/;
const keys = new Set();
const str = String.raw`(['"])((?:\\.|(?!\1).)*?)\1`;
const patterns = [
  new RegExp(String.raw`\b(?:t|tr|empty)\(\s*` + str, 'g'),
  new RegExp(String.raw`\b(?:t|tr|empty)\([^()]*?\?\s*` + str + String.raw`\s*:\s*` + str, 'g'),
  new RegExp(String.raw`\b(?:label|help|title|submitLabel|placeholder|deleteLabel|deleteConfirm)\s*:\s*` + str, 'g'),
  new RegExp(String.raw`\[\s*'[^']*'\s*,\s*` + str + String.raw`\s*\]`, 'g'),
];
for (const f of files.filter((x) => !skip.test(x))) {
  const s = readFileSync(f, 'utf8');
  for (const re of patterns) for (const m of s.matchAll(re)) {
    for (const v of [m[2], m[4]]) if (v && /[a-z]{2}/i.test(v)) keys.add(v.replace(/\\'/g, "'").replace(/\\n/g, '\n'));
  }
}
const missing = [...keys].filter((k) => !(k in PL) && !/^(#|\.|\[|[a-z]+$|[A-Z]{2,}$|stun:)/.test(k));
console.log(missing.length ? missing.join('\n') : 'all strings translated');
process.exitCode = missing.length ? 1 : 0;
