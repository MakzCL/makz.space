import { BRAND } from "@syndo/shared";

/**
 * Themes are data, never code: a whitelisted set of colour tokens plus a few
 * numeric/enum preferences, validated before use. Imported themes go through
 * the same validator, so a shared theme file can't inject CSS or script.
 */
export type ThemeMode = "dark" | "light" | "system" | "contrast" | "custom";
export interface Appearance {
  theme: ThemeMode;
  accent: string;
  custom: Partial<Record<TokenKey, string>>;
  fontScale: number;
  density: "compact" | "cozy" | "spacious";
  reducedMotion: "system" | "on" | "off";
  chatBackground: string | null;
  roundAvatars: boolean;
  showAnimatedAvatars: boolean;
}

export const TOKEN_KEYS = ["bg0", "bg1", "bg2", "bg3", "line", "text", "textMuted", "textFaint"] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark", accent: BRAND.colors.blue, custom: {}, fontScale: 1, density: "cozy", reducedMotion: "system",
  chatBackground: null, roundAvatars: true, showAnimatedAvatars: true,
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const CONTRAST = { bg0: "#000000", bg1: "#0A0A0A", bg2: "#000000", bg3: "#1A1A1A", line: "#FFFFFF", text: "#FFFFFF", textMuted: "#F0F0F0", textFaint: "#D0D0D0" };

/** Sanitise anything that claims to be appearance settings. Unknown keys are dropped. */
export function validateAppearance(input: unknown): Appearance {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const custom: Appearance["custom"] = {};
  if (a.custom && typeof a.custom === "object") for (const k of TOKEN_KEYS) if (HEX.test(a.custom[k])) custom[k] = a.custom[k];
  return {
    theme: ["dark", "light", "system", "contrast", "custom"].includes(a.theme) ? a.theme : DEFAULT_APPEARANCE.theme,
    accent: HEX.test(a.accent) ? a.accent : DEFAULT_APPEARANCE.accent,
    custom,
    fontScale: typeof a.fontScale === "number" ? Math.min(1.4, Math.max(0.8, a.fontScale)) : 1,
    density: ["compact", "cozy", "spacious"].includes(a.density) ? a.density : "cozy",
    reducedMotion: ["system", "on", "off"].includes(a.reducedMotion) ? a.reducedMotion : "system",
    chatBackground: HEX.test(a.chatBackground) ? a.chatBackground : null,
    roundAvatars: a.roundAvatars !== false,
    showAnimatedAvatars: a.showAnimatedAvatars !== false,
  };
}

export function exportTheme(a: Appearance) {
  return JSON.stringify({ syndo_theme: 1, theme: a.theme, accent: a.accent, custom: a.custom, chatBackground: a.chatBackground }, null, 2);
}
export function importTheme(text: string, current: Appearance): Appearance {
  if (text.length > 10_000) throw new Error("That theme file is too large.");
  const data = JSON.parse(text);
  if (data?.syndo_theme !== 1) throw new Error(`That isn't a ${BRAND.name} theme file.`);
  return validateAppearance({ ...current, theme: data.theme, accent: data.accent, custom: data.custom, chatBackground: data.chatBackground });
}

function mix(hex: string, other: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(other)];
  return "#" + a.map((v, i) => Math.round(v + (b[i]! - v) * t).toString(16).padStart(2, "0")).join("");
}
/** WCAG relative luminance → choose readable text on the accent. */
export function onColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return L > 0.4 ? "#0E1220" : "#FFFFFF";
}

let mq: MediaQueryList | null = null;
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const base = a.theme === "light" || (a.theme === "system" && !sysDark) ? BRAND.surfaces.light
    : a.theme === "contrast" ? CONTRAST : BRAND.surfaces.dark;
  const tokens = { ...base, ...(a.theme === "custom" ? a.custom : {}) };
  for (const k of TOKEN_KEYS) root.style.setProperty(`--${k}`, tokens[k]);
  const isLight = a.theme === "light" || (a.theme === "system" && !sysDark) || (a.theme === "custom" && onColor(tokens.bg2) !== "#FFFFFF");
  root.dataset.scheme = isLight ? "light" : "dark";
  root.dataset.contrast = a.theme === "contrast" ? "high" : "normal";
  root.style.setProperty("--accent", a.accent);
  root.style.setProperty("--accent-hover", mix(a.accent, isLight ? "#000000" : "#FFFFFF", 0.12));
  root.style.setProperty("--accent-soft", a.accent + (isLight ? "22" : "33"));
  root.style.setProperty("--on-accent", onColor(a.accent));
  root.style.setProperty("--chat-bg", a.chatBackground ?? "var(--bg2)");
  for (const [k, v] of Object.entries(BRAND.colors)) root.style.setProperty(`--brand-${k}`, v);
  root.style.setProperty("--font-ui", BRAND.fonts.ui);
  root.style.setProperty("--font-mono", BRAND.fonts.mono);
  root.style.setProperty("--font-scale", String(a.fontScale));
  root.dataset.density = a.density;
  root.dataset.avatars = a.roundAvatars ? "round" : "square";
  const reduce = a.reducedMotion === "on" || (a.reducedMotion === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  root.dataset.motion = reduce ? "reduce" : "full";
  if (!mq) { mq = window.matchMedia("(prefers-color-scheme: dark)"); mq.addEventListener("change", () => applyAppearance(currentAppearance)); }
  currentAppearance = a;
}
let currentAppearance = DEFAULT_APPEARANCE;
export const prefersReducedMotion = () => document.documentElement.dataset.motion === "reduce";
