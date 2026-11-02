import { getPrefs } from "./prefs";
import { PL } from "./pl";

export type Lang = "en" | "pl";
export const lang = (): Lang => getPrefs().lang;
export const locale = () => (lang() === "pl" ? "pl-PL" : "en-GB");

/** English text is the key. Missing Polish falls back to English. */
export function t(s: string, vars?: Record<string, string | number>) {
  let out = lang() === "pl" ? PL[s] ?? s : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** "1 day / 2 days" — Polish has three forms: 1 dzień, 2–4 dni, 5+ dni. */
export function plural(n: number, en: [string, string], pl: [string, string, string]) {
  if (lang() !== "pl") return `${n} ${n === 1 ? en[0] : en[1]}`;
  const m10 = n % 10, m100 = n % 100;
  const form = n === 1 ? pl[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? pl[1] : pl[2];
  return `${n} ${form}`;
}
