import { Check, Languages } from "lucide-react";
import { api } from "../api.ts";
import { toast } from "../store.ts";

/**
 * Interface languages.
 *
 * Translations are keyed by the English text itself (i18n/strings.json, produced by
 * scripts/extract-strings.mjs). Each language file is an array in the same order, plus a few
 * patterns for text with names or numbers in it. A light DOM translator swaps interface text,
 * placeholders, tooltips and accessible labels as React renders them — people's own content
 * (messages, names, channel names, anything typed) is never touched.
 */

export const LANGUAGES: { code: string; name: string; native: string; rtl?: boolean }[] = [
  { code: "en", name: "English", native: "English" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "fr", name: "French", native: "Français" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "pt", name: "Portuguese", native: "Português" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "nl", name: "Dutch", native: "Nederlands" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "ar", name: "Arabic", native: "العربية", rtl: true },
  { code: "tr", name: "Turkish", native: "Türkçe" },
];

const KEY = "send.locale";
export function currentLocale() {
  try { const s = localStorage.getItem(KEY); if (s && LANGUAGES.some((l) => l.code === s)) return s; } catch { /* */ }
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return LANGUAGES.some((l) => l.code === nav) ? nav : "en";
}

interface Pack { t: string[]; patterns?: [string, string][] }
// Vite turns this into a map of lazy imports at build time; outside Vite (unit tests) there are no language files.
let files: Record<string, () => Promise<{ default: Pack }>> = {};
try { files = import.meta.glob<{ default: Pack }>("../i18n/*.json"); } catch { /* not built by Vite */ }
let dict: Map<string, string> | null = null;
let patterns: [RegExp, string][] = [];

/** Text inside these is people's content, never translated. */
const SKIP = [
  ".msg-content", ".msg-name", ".reply-ref", ".embed", ".poll-q", ".poll-a .ellipsis", ".fwd-body", ".thread-chip strong", ".post-title", ".post-snip",
  ".side-ch .ellipsis", ".side-dm .ellipsis", ".side-thread", ".member .ellipsis", ".guild-menu-btn .ellipsis", ".ch-h h1:not(.t)", ".topic", ".result",
  ".mention-option strong", ".profile-card .bio", ".profile-name", ".voice-participant .ellipsis", ".stage-person .ellipsis", ".discover-card strong",
  ".discover-card p", ".app-card", ".event-card h3", ".event-card p", ".inbox-item .msg-content", "textarea", "input", "code", "pre", "[contenteditable]", "[data-no-i18n]",
].join(",");

function tr(s: string): string | null {
  const key = s.replace(/\s+/g, " ").trim();
  if (!key || !dict) return null;
  const hit = dict.get(key);
  if (hit) return s.replace(key, hit);
  for (const [re, to] of patterns) if (re.test(key)) return s.replace(key, key.replace(re, to));
  return null;
}
const done = new WeakMap<Node, string>();
function translateNode(n: Node) {
  if (n.nodeType === 3) {
    const el = n.parentElement;
    if (!el || el.closest(SKIP)) return;
    const v = n.nodeValue ?? "";
    if (done.get(n) === v) return;
    const out = tr(v);
    if (out !== null && out !== v) { n.nodeValue = out; done.set(n, out); } else done.set(n, v);
    return;
  }
  if (n.nodeType !== 1) return;
  const el = n as Element;
  if (el.closest?.(SKIP) && !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  for (const a of ["placeholder", "aria-label", "title"]) {
    const v = el.getAttribute(a);
    if (!v || el.getAttribute(`data-i18n-${a}`) === v) continue;
    const out = tr(v);
    if (out && out !== v) { el.setAttribute(a, out); el.setAttribute(`data-i18n-${a}`, out); }
  }
  for (const c of el.childNodes) translateNode(c);
}

let started = false;
export async function initI18n() {
  if (started) return; started = true;
  const lang = currentLocale();
  const meta = LANGUAGES.find((l) => l.code === lang)!;
  document.documentElement.lang = lang;
  document.documentElement.dir = meta.rtl ? "rtl" : "ltr";
  if (lang === "en") return;
  const load = files[`../i18n/${lang}.json`];
  if (!load) return;
  const [{ default: pack }, { default: keys }] = await Promise.all([load(), import("../i18n/strings.json")]);
  dict = new Map();
  (keys as string[]).forEach((k, i) => { const v = pack.t[i]; if (v) dict!.set(k, v); });
  patterns = (pack.patterns ?? []).map(([from, to]) => [new RegExp(from), to]);
  translateNode(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") translateNode(m.target);
      else if (m.type === "attributes") translateNode(m.target);
      else m.addedNodes.forEach(translateNode);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "aria-label", "title"] });
}

export function LanguageTab() {
  const cur = currentLocale();
  const pick = async (code: string) => {
    try { localStorage.setItem(KEY, code); } catch { /* */ }
    await api.patch("/api/users/@me", { locale: code }).catch(() => {});
    toast("Changing language…", "info");
    setTimeout(() => location.reload(), 300);
  };
  return <div className="settings-section">
    <h2><Languages size={20} /> Language</h2>
    <p className="muted">Choose the language of SEND's interface. Messages and names are never translated.</p>
    <div className="lang-list" role="radiogroup" aria-label="Language">
      {LANGUAGES.map((l) => <button key={l.code} role="radio" aria-checked={cur === l.code} className={`lang ${cur === l.code ? "on" : ""}`} onClick={() => pick(l.code)} lang={l.code} dir={l.rtl ? "rtl" : undefined}>
        <span><strong>{l.native}</strong><small className="muted block">{l.name}</small></span>{cur === l.code && <Check size={16} />}
      </button>)}
    </div>
  </div>;
}
