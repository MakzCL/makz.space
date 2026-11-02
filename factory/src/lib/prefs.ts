import { useEffect, useState } from "react";
import type { Tab } from "./roles";

export interface Prefs {
  startTab: Tab;
  reduceMotion: boolean;
  haptics: boolean;
  scale: "s" | "m" | "l";
  sounds: boolean;
  theme: "night" | "deep" | "light";
  lang: "en" | "pl";
}
const DEF: Prefs = { startTab: "home", reduceMotion: false, haptics: true, scale: "m", sounds: false, theme: "night",
  lang: typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("pl") ? "pl" : "en" };
const KEY = "skf-prefs";

function read(): Prefs {
  try {
    const p = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") } as Prefs;
    if (p.theme !== "night" && p.theme !== "deep" && p.theme !== "light") p.theme = "night";
    return p;
  } catch { return DEF; }
}
let current = read();
const subs = new Set<(p: Prefs) => void>();

export function setPrefs(p: Partial<Prefs>) {
  current = { ...current, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* ignore */ }
  subs.forEach((s) => s(current));
  apply();
}
export const getPrefs = () => current;
export function usePrefs() {
  const [p, set] = useState(current);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return p;
}
export function apply() {
  const r = document.documentElement;
  r.dataset.scale = current.scale;
  r.dataset.theme = current.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", current.theme === "light" ? "#f3f4fa" : current.theme === "deep" ? "#060920" : "#0b1033");
  r.dataset.motion = current.reduceMotion ? "reduce" : "full";
  r.lang = current.lang === "pl" ? "pl" : "en-GB";
}

export function buzz(pattern: number | number[] = 12) {
  if (!current.haptics) return;
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

let ctx: AudioContext | null = null;
export function blip(freq = 880, dur = 0.07) {
  if (!current.sounds) return;
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.type = "sine";
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
  } catch { /* ignore */ }
}
