// Merges i18n/chunks/NN.json ({ start, langs: { pl: [...], ... } }) into i18n/<lang>.json ({ t: [...], patterns }).
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
const dir = new URL("../src/i18n/", import.meta.url);
const keys = JSON.parse(readFileSync(new URL("strings.json", dir), "utf8"));
const patterns = existsSync(new URL("patterns.json", dir)) ? JSON.parse(readFileSync(new URL("patterns.json", dir), "utf8")) : {};
const out = {};
for (const f of readdirSync(new URL("chunks/", dir)).filter((f) => f.endsWith(".json")).sort()) {
  const c = JSON.parse(readFileSync(new URL(`chunks/${f}`, dir), "utf8"));
  // Either { start, langs } (positional) or { keys, langs } (matched by English text).
  const at = c.keys ? c.keys.map((k) => { const i = keys.indexOf(k); if (i < 0) console.warn("unknown key in", f, ":", k); return i; }) : null;
  for (const [lang, list] of Object.entries(c.langs)) {
    out[lang] ??= new Array(keys.length).fill("");
    if (at && list.length !== at.length) throw new Error(`${f} ${lang}: ${list.length} values for ${at.length} keys`);
    list.forEach((v, i) => { const idx = at ? at[i] : c.start + i; if (idx >= 0 && idx < keys.length) out[lang][idx] = v; });
  }
}
for (const [lang, t] of Object.entries(out)) {
  writeFileSync(new URL(`${lang}.json`, dir), JSON.stringify({ t, patterns: patterns[lang] ?? [] }));
  console.log(lang, t.filter(Boolean).length, "/", keys.length);
}
