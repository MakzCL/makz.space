import { presetById, DEFAULT_GLOBAL } from "@syndo/shared";
import {
  DEFAULT_THEME, FONTS, REGION_IDS, mixHex, readableOn, resolveAppearance,
  type Background, type ConversationPrefs, type DeepPartial, type PanelStyle, type RegionId, type Resolved, type ThemeDoc,
} from "@syndo/shared";

/**
 * Turns a resolved theme into CSS custom properties and data attributes on
 * <html>. Panels use *background-layer* transparency: only the background
 * colour/gradient gets alpha, so text, icons and controls stay fully opaque.
 */

/** Region → token it uses when the theme doesn't style it. */
const REGION_BASE: Record<RegionId, keyof ThemeDoc["colors"] | "call"> = {
  app: "bg0", rail: "bg0", sidebar: "bg1", dmSidebar: "bg1", chat: "bg2", header: "bg2", composer: "bg3", members: "bg1",
  panels: "bg1", userPanel: "bg0", call: "call", profileCard: "bg0", settings: "bg2", overlay: "bg2",
};

export const assetUrl = (ref: string | null | undefined) => {
  if (!ref) return null;
  if (ref.startsWith("builtin:")) return `/wallpapers/${ref.slice(8)}.svg`;
  if (/^a\d+$/.test(ref)) return `/api/appearance/assets/${ref.slice(1)}`;
  return null; // never a remote URL
};

export const rgba = (hex: string, alphaPct: number) => {
  const h = hex.length >= 7 ? hex.slice(0, 7) : "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, alphaPct)) / 100})`;
};

export interface PanelVars { bg: string; blur: string; border: string; radius: string; shadow: string; text: string; icon: string }

export function panelVars(t: ThemeDoc, id: RegionId, blurScale: number): PanelVars {
  const p: PanelStyle = t.panels[id] ?? {};
  const baseKey = REGION_BASE[id];
  const baseColor = baseKey === "call" ? mixHex(t.colors.bg0, "#000000", 0.35) : t.colors[baseKey];
  const color = p.bg ?? baseColor;
  const op = p.opacity ?? 100;
  const layers: string[] = [];
  const img = assetUrl(p.image ?? null);
  if (p.gradient) layers.push(`linear-gradient(${p.gradient.angle}deg, ${rgba(color, op)}, ${rgba(p.gradient.to, op)})`);
  else layers.push(`linear-gradient(${rgba(color, op)}, ${rgba(color, op)})`);
  if (img) layers.push(`center / cover no-repeat url("${img}")`);
  const blur = (p.blur ?? 0) * blurScale;
  const shadow = p.shadow ?? 0;
  return {
    bg: layers.join(", "),
    blur: blur > 0 ? `blur(${blur.toFixed(1)}px) saturate(1.2)` : "none",
    border: (p.borderWidth ?? 0) > 0 ? `${p.borderWidth}px solid ${rgba(p.border ?? t.colors.line, p.borderOpacity ?? 100)}` : "0 solid transparent",
    radius: p.radius !== undefined ? `${p.radius}px` : "",
    shadow: shadow > 0 ? `0 ${Math.round(shadow / 8)}px ${Math.round(shadow / 2)}px rgba(0,0,0,${(shadow / 160).toFixed(2)})` : "none",
    text: p.text ?? "",
    icon: p.icon ?? "",
  };
}

export interface Applied { resolved: Resolved; background: Background | null; conversation: ConversationPrefs; scheme: "dark" | "light" }

/** Build CSS text for a resolved theme. Scoped to a selector so Studio previews can use the same engine. */
export function themeCss(sel: string, r: Resolved, conv: ConversationPrefs = {}): string {
  const t = r.theme;
  const v: Record<string, string> = {};
  for (const [k, c] of Object.entries(t.colors)) v[`--${k}`] = c;
  v["--accent-hover"] = mixHex(t.colors.accent, t.meta.scheme === "light" ? "#000000" : "#FFFFFF", 0.12);
  v["--accent-soft"] = rgba(t.colors.accent, t.meta.scheme === "light" ? 14 : 22);
  v["--on-accent"] = readableOn(t.colors.accent);
  v["--brand-blue"] = t.colors.accent; v["--brand-online"] = t.colors.success; v["--brand-danger"] = t.colors.danger; v["--brand-idle"] = t.colors.warning;
  v["--brand-success"] = t.colors.success; v["--brand-yellow"] = t.colors.accent2; v["--mention"] = t.colors.mention; v["--link"] = t.colors.link;
  v["--font-ui"] = FONTS[t.typography.font]?.stack ?? FONTS.system.stack;
  v["--fs"] = `${t.typography.size}px`; v["--lh"] = String(t.typography.lineHeight); v["--ls"] = `${t.typography.letterSpacing}px`;
  const L = t.layout;
  v["--side"] = `${L.sidebarWidth}px`; v["--panel"] = `${L.memberWidth}px`; v["--r"] = `${L.radius}px`; v["--r-sm"] = `${Math.max(2, Math.round(L.radius * 0.6))}px`;
  v["--pgap"] = `${L.panelStyle === "floating" ? L.gap : 0}px`; v["--pmargin"] = `${L.panelStyle === "floating" ? L.margin : 0}px`;
  v["--avatar"] = `${L.avatarSize}px`; v["--msg-pad"] = `${L.density === "compact" ? 1 : L.density === "spacious" ? 8 : L.density === "custom" ? L.spacing : 3}px`;
  v["--scale"] = String(L.scale);
  const bub = { ...t.conversation.bubbles, ...(conv.bubbles ?? {}) };
  v["--bubble-mine"] = bub.mine; v["--bubble-theirs"] = bub.theirs; v["--bubble-radius"] = `${bub.radius}px`; v["--bubble-gap"] = `${bub.spacing}px`;
  v["--on-bubble-mine"] = readableOn(bub.mine); v["--on-bubble-theirs"] = readableOn(bub.theirs);
  v["--glow"] = String(t.effects.glow / 100);
  for (const id of REGION_IDS) {
    const pv = panelVars(t, id, t.effects.blurScale);
    if (id === "chat" && conv.chatOpacity !== undefined) {
      const p = t.panels.chat ?? {};
      const c = p.bg ?? t.colors.bg2;
      pv.bg = `linear-gradient(${rgba(c, conv.chatOpacity)}, ${rgba(c, conv.chatOpacity)})`;
    }
    v[`--r-${id}-bg`] = pv.bg; v[`--r-${id}-blur`] = pv.blur; v[`--r-${id}-border`] = pv.border; v[`--r-${id}-shadow`] = pv.shadow;
    if (pv.radius) v[`--r-${id}-radius`] = pv.radius;
    if (pv.text) v[`--r-${id}-text`] = pv.text;
    if (pv.icon) v[`--r-${id}-icon`] = pv.icon;
  }
  return `${sel} {\n${Object.entries(v).map(([k, x]) => `  ${k}: ${x};`).join("\n")}\n}`;
}

export function applyToDocument(r: Resolved, conv: ConversationPrefs, customCss: string | null) {
  const t = r.theme;
  const root = document.documentElement;
  let style = document.getElementById("syndo-theme") as HTMLStyleElement | null;
  if (!style) { style = document.createElement("style"); style.id = "syndo-theme"; document.head.appendChild(style); }
  style.textContent = themeCss(":root", r, conv);
  let custom = document.getElementById("syndo-custom-css") as HTMLStyleElement | null;
  if (!custom) { custom = document.createElement("style"); custom.id = "syndo-custom-css"; document.head.appendChild(custom); }
  custom.textContent = customCss ?? ""; // already validated + scoped by validateCustomCss
  const L = t.layout;
  Object.assign(root.dataset, {
    scheme: t.meta.scheme, motion: r.reduceMotion ? "reduce" : "full", nav: L.nav, railCols: String(L.railColumns), panelStyle: L.panelStyle,
    density: conv.compact ? "compact" : L.density, msgStyle: conv.messageStyle ?? L.messageStyle, ts: L.timestamps, unread: L.unreadStyle,
    mentionStyle: L.mentionStyle, status: L.statusStyle, grouping: String(L.grouping), members: String(L.showMembers), sidebar: String(L.showSidebar),
    animatedBg: String(t.effects.animatedBackground), glow: t.effects.glow > 0 ? "on" : "off",
  });
  root.style.colorScheme = t.meta.scheme;
  timeFormat = L.timeFormat;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.colors.bg1);
}

export let timeFormat: "12h" | "24h" | "relative" = "12h";

/* ---------------------------------------------------- startup snapshot -- */
const SNAP = "syndo.appearance.snapshot.v2";
/** Last applied CSS, so the next start paints with the user's look before preferences load (no flash). */
/** The wallpaper a theme shows for its scheme, or null. */
export function activeBackground(t: ThemeDoc): Background | null {
  const set = t.background ?? {};
  const bg = (t.meta.scheme === "light" ? set.light ?? set.dark : set.dark ?? set.light) ?? null;
  return bg && bg.kind !== "none" ? bg : null;
}
/** What the last start-up snapshot held: `restored` stops the defaults from repainting over it before preferences load. */
export const snapshot: { restored: boolean; bg: Background | null | undefined } = { restored: false, bg: undefined };
export function saveSnapshot(bg?: Background | null) {
  try {
    const css = document.getElementById("syndo-theme")?.textContent ?? "";
    localStorage.setItem(SNAP, JSON.stringify({ css, data: { ...document.documentElement.dataset }, bg: bg ?? null }));
  } catch { /* storage unavailable */ }
}
export function restoreSnapshot(): boolean {
  try {
    const raw = localStorage.getItem(SNAP);
    if (!raw) return false;
    const { css, data, bg } = JSON.parse(raw);
    if (typeof css !== "string" || css.length > 200_000) return false;
    const style = document.createElement("style"); style.id = "syndo-theme"; style.textContent = css; document.head.appendChild(style);
    for (const [k, v] of Object.entries(data ?? {})) if (typeof v === "string" && /^[a-zA-Z]+$/.test(k)) document.documentElement.dataset[k] = v;
    if (typeof data?.scheme === "string") document.documentElement.style.colorScheme = data.scheme;
    snapshot.restored = true;
    if (bg !== undefined) snapshot.bg = bg && typeof bg === "object" && typeof bg.kind === "string" ? bg : null;
    return true;
  } catch { return false; }
}
export const clearSnapshot = () => { try { localStorage.removeItem(SNAP); } catch { /* */ } };

export function defaultResolved(): Resolved {
  return resolveAppearance({ theme: presetById(DEFAULT_GLOBAL.themeId) ?? DEFAULT_THEME, global: {}, a11y: { reducedMotion: "system", highContrast: false, disableAnimatedBackgrounds: false, disableProfileEffects: false, disableOthersCosmetics: false, blur: "full", lowPower: false, readableOverlay: false, minContrast: true }, systemReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
}
export type { DeepPartial };
