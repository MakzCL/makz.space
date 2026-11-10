// Collects the interface text in the web app (JSX text, labels, placeholders, titles, toasts)
// into i18n/strings.json, which the translation files are keyed by.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const root = new URL("../src/", import.meta.url).pathname;
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx|ts)$/.test(f) && !/preview|catalog|crypto/.test(p)) files.push(p); } };
walk(root);
const found = new Map();
const add = (s, file) => {
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 160 || !/[A-Za-z]{2}/.test(s) || /^[a-z0-9_.:/#-]+$/.test(s) || /[{}<>`$;=()\[\]&|\\]|=>|\bclassName\b|^https?:|\?\?|\.\w+\(/.test(s) || /^[A-Z_]+$/.test(s) || !/^[A-Za-z0-9"'“‘¿¡@#+✨📅🔴]/.test(s)) return;
  if (!found.has(s)) found.set(s, new Set());
  found.get(s).add(file.replace(root, ""));
};
for (const f of files) {
  const src = readFileSync(f, "utf8");
  if (f.endsWith(".tsx")) for (const m of src.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)) add(m[1], f);
  for (const m of src.matchAll(/\b(?:label|placeholder|title|hint|aria-label|confirmLabel|body|clearLabel|description)\s*[=:]\s*"([^"\n]{2,160})"/g)) add(m[1], f);
  for (const m of src.matchAll(/\b(?:toast|askConfirm|setErr|throw new Error)\(\s*"([^"\n]{2,160})"/g)) add(m[1], f);
  if (f.endsWith(".tsx")) for (const m of src.matchAll(/[?:]\s*"([A-Z][^"\n]{1,120})"/g)) add(m[1], f);
  for (const m of src.matchAll(/\b[a-z_]+:\s*"([A-Z][a-z][^"\n]{0,60})"/g)) add(m[1], f);
  // The changelog keeps its text in plain lists.
  if (f.endsWith("WhatsNew.tsx")) for (const m of src.matchAll(/"([A-Z][^"\n]{3,200})"/g)) add(m[1], f);
  for (const m of src.matchAll(/\[\s*"[a-z_]+"\s*,\s*"([A-Z][^"\n]{1,60})"/g)) add(m[1], f);
}
// Keep the existing order so finished translations stay aligned; new strings go on the end.
let prev = [];
try { prev = JSON.parse(readFileSync(new URL("../src/i18n/strings.json", import.meta.url), "utf8")); } catch {}
const out = [...prev, ...[...found.keys()].filter((k) => !prev.includes(k)).sort()];
mkdirSync(new URL("../src/i18n/", import.meta.url), { recursive: true });
writeFileSync(new URL("../src/i18n/strings.json", import.meta.url), JSON.stringify(out, null, 0));
console.log(out.length, "strings");
