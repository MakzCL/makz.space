// English is the key; PL maps it to Polish. t('Text {n}', { n: 3 }).
import { setTimeLang } from './time.js';
import { PL } from './pl.js';

let LANG = 'en';
export const missing = new Set();
if (typeof window !== 'undefined') window.__i18nMissing = missing;

export function detectLang() {
  try {
    const saved = localStorage.getItem('dairy-lang');
    if (saved) return saved;
  } catch { /* storage blocked */ }
  return /^pl\b/i.test(navigator.language || '') ? 'pl' : 'en';
}

export function setLang(l) {
  LANG = l === 'pl' ? 'pl' : 'en';
  setTimeLang(LANG);
  try { localStorage.setItem('dairy-lang', LANG); } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = LANG;
}
export const lang = () => LANG;
export const locale = () => (LANG === 'pl' ? 'pl-PL' : 'en-GB');

let _vals = null;
const plValues = () => (_vals ||= new Set(Object.values(PL)));

export function t(key, vars) {
  if (key == null || key === '') return key;
  let s = key;
  if (LANG === 'pl') {
    if (Object.prototype.hasOwnProperty.call(PL, key)) s = PL[key];
    else if (/[A-Za-z]{2}/.test(key) && !plValues().has(key)) missing.add(key);
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

/**
 * Count with the right word. English: [one, other]. Polish: [one, few, many]
 * (1 krowa, 2–4 krowy, 5+ krów; 12–14 are "many").
 */
export function plural(n, en, pl) {
  if (LANG !== 'pl') return `${n} ${n === 1 ? en[0] : en[1]}`;
  const m10 = n % 10; const m100 = n % 100;
  const w = n === 1 ? pl[0] : (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) ? pl[1] : pl[2];
  return `${n} ${w}`;
}
