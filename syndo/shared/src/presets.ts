import { DEFAULT_THEME, mergeDeep, normalizeThemeId, type DeepPartial, type ThemeDoc } from "./theme.ts";

/**
 * Built-in SEND themes. Each is an ordinary ThemeDoc layered on the defaults,
 * so every preset uses the real engine and stays fully editable (Studio →
 * Duplicate). Wallpapers referenced as `builtin:<name>` are original SVGs in
 * web/public/wallpapers/, created for SEND (no third-party artwork).
 */
const p = (d: DeepPartial<ThemeDoc>): ThemeDoc => mergeDeep(DEFAULT_THEME, { meta: { author: "SEND", license: "Included with SEND" } }, d) as ThemeDoc;

const glassPanel = (opacity: number, blur: number) => ({ bg: "#0E1220", opacity, blur, border: "#FFFFFF", borderOpacity: 12, borderWidth: 1, shadow: 20 });

export const PRESETS: ThemeDoc[] = [
  p({
    meta: { id: "send-glass", name: "SEND Glass", description: "The default SEND look. Translucent panels, soft blur and a warm landscape.", tags: ["default", "glass", "wallpaper", "transparent", "dark"], scheme: "dark" },
    colors: { bg0: "#0B1020", bg1: "#111A33", bg2: "#131C36", bg3: "#22305A", line: "#3A4A7A", accent: "#6C8CFF" },
    panels: {
      rail: glassPanel(35, 18), sidebar: glassPanel(40, 18), dmSidebar: glassPanel(40, 18), chat: glassPanel(25, 10), header: glassPanel(35, 16),
      composer: { ...glassPanel(55, 16), radius: 14 }, members: glassPanel(35, 18), panels: glassPanel(45, 18), userPanel: glassPanel(55, 16),
      call: glassPanel(30, 10), profileCard: glassPanel(70, 20), settings: glassPanel(48, 24), overlay: glassPanel(48, 24),
    },
    background: { dark: { kind: "image", asset: "builtin:dunes", fit: "cover", x: 50, y: 50, zoom: 1, brightness: 90, saturation: 110, blur: 0, tint: "#0B1020", overlay: 20, vignette: 30 }, target: "app" },
    layout: { panelStyle: "floating", gap: 8, margin: 8, radius: 14 },
  }),
  p({
    meta: { id: "send-frost", name: "SEND Frost", description: "Cool frosted panels and restrained blue accents.", tags: ["frosted", "glass", "blue", "dark"], scheme: "dark" },
    colors: { bg0: "#0D1824", bg1: "#132233", bg2: "#16283B", bg3: "#20374F", line: "#35536F", text: "#EAF4FF", textMuted: "#A8C1D8", accent: "#5AB4FF", accent2: "#BDE3FF", mention: "#5AB4FF" },
    panels: Object.fromEntries(["rail", "sidebar", "dmSidebar", "header", "members", "userPanel", "panels"].map((r) => [r, { bg: "#132233", opacity: 60, blur: 22, border: "#BDE3FF", borderOpacity: 15, borderWidth: 1 }])),
    background: { dark: { kind: "image", asset: "builtin:frost", fit: "cover", brightness: 85, saturation: 90, overlay: 25, tint: "#0D1824", vignette: 20 }, target: "app" },
  }),
  p({
    meta: { id: "send-midnight", name: "SEND Midnight", description: "Clean dark surfaces with subtle contrast.", tags: ["dark", "clean"], scheme: "dark" },
  }),
  p({
    meta: { id: "send-oled", name: "SEND OLED", description: "Near-black surfaces with minimal visual noise: easy on OLED screens and batteries.", tags: ["amoled", "black", "minimal", "dark"], scheme: "dark" },
    colors: { bg0: "#000000", bg1: "#000000", bg2: "#000000", bg3: "#0F0F12", line: "#1C1C22", text: "#ECECEC", textMuted: "#9C9CA4", textFaint: "#74747C", accent: "#5B7CFF" },
    panels: { header: { border: "#1C1C22", borderWidth: 1, borderOpacity: 100 }, composer: { bg: "#0F0F12", opacity: 100, radius: 12 } },
  }),
  p({
    meta: { id: "send-aurora", name: "SEND Aurora", description: "Soft, slowly shifting gradients behind translucent panels. Static when motion is reduced.", tags: ["gradient", "animated", "colourful", "dark"], scheme: "dark" },
    colors: { bg0: "#0C0F1E", bg1: "#121633", bg2: "#141838", bg3: "#24295A", line: "#363C78", accent: "#8E7BFF", accent2: "#3FE0C5", mention: "#3FE0C5" },
    panels: Object.fromEntries(["rail", "sidebar", "dmSidebar", "chat", "header", "members", "userPanel", "panels"].map((r) => [r, { bg: "#0C0F1E", opacity: r === "chat" ? 35 : 50, blur: 14 }])),
    background: { dark: { kind: "gradient", gradient: { from: "#3A1C71", via: "#1E6F8C", to: "#0F3B2E", angle: 135, type: "linear" }, overlay: 0, vignette: 25 }, target: "app" },
    effects: { animatedBackground: true },
  }),
  p({
    meta: { id: "send-neon", name: "SEND Neon", description: "Vivid, configurable accents with controlled glow on a deep background.", tags: ["neon", "vivid", "glow", "dark"], scheme: "dark" },
    colors: { bg0: "#07040F", bg1: "#0D0820", bg2: "#100A26", bg3: "#1F1445", line: "#3B2580", text: "#F5F0FF", textMuted: "#B9A9E6", accent: "#FF3FD8", accent2: "#33F0FF", mention: "#33F0FF", link: "#33F0FF" },
    panels: { header: { border: "#FF3FD8", borderOpacity: 50, borderWidth: 1 }, composer: { bg: "#1F1445", opacity: 90, border: "#33F0FF", borderOpacity: 60, borderWidth: 1, radius: 12, shadow: 40 }, rail: { border: "#33F0FF", borderOpacity: 25, borderWidth: 1 } },
    background: { dark: { kind: "image", asset: "builtin:grid", fit: "cover", y: 100, brightness: 100, saturation: 120, overlay: 35, tint: "#07040F", vignette: 40 }, target: "chat" },
    effects: { glow: 60 },
  }),
  p({
    meta: { id: "send-soft", name: "SEND Soft", description: "Rounded surfaces, gentle shadows and muted colours.", tags: ["rounded", "soft", "muted", "dark"], scheme: "dark" },
    colors: { bg0: "#1B1D26", bg1: "#22252F", bg2: "#272A35", bg3: "#323644", line: "#3D4252", text: "#ECE9F1", textMuted: "#B4AFC0", accent: "#9DB4FF", accent2: "#F3C7A1", mention: "#F3C7A1" },
    typography: { font: "rounded", size: 15, lineHeight: 1.5 },
    layout: { panelStyle: "floating", gap: 10, margin: 10, radius: 20, messageStyle: "bubbles", statusStyle: "ring" },
    panels: Object.fromEntries(["rail", "sidebar", "dmSidebar", "chat", "members", "panels"].map((r) => [r, { radius: 20, shadow: 35 }])),
    conversation: { bubbles: { mine: "#4A5A8F", theirs: "#323644", radius: 20, spacing: 6 } },
  }),
  p({
    meta: { id: "send-paper", name: "SEND Paper", description: "Bright, readable, minimal light theme.", tags: ["light", "minimal", "readable"], scheme: "light" },
    colors: { bg0: "#ECEEF3", bg1: "#F6F7FA", bg2: "#FFFFFF", bg3: "#F1F3F7", line: "#D8DCE6", text: "#141A2B", textMuted: "#4A5470", textFaint: "#6B7590", accent: "#2547C9", accent2: "#B37A00", mention: "#B37A00", link: "#2547C9" },
    conversation: { bubbles: { mine: "#2547C9", theirs: "#F1F3F7", radius: 16, spacing: 4 } },
    typography: { lineHeight: 1.5 },
  }),
  p({
    meta: { id: "send-terminal", name: "SEND Terminal", description: "Monospace text and configurable terminal colours.", tags: ["monospace", "retro", "green", "dark"], scheme: "dark" },
    colors: { bg0: "#030603", bg1: "#060C06", bg2: "#070D07", bg3: "#0E1A0E", line: "#1E3A1E", text: "#9BFF9B", textMuted: "#5FCF5F", textFaint: "#3F9F3F", accent: "#3DFF6E", accent2: "#FFD23D", mention: "#FFD23D", link: "#7DFFF0" },
    typography: { font: "mono", size: 14, lineHeight: 1.45 },
    layout: { radius: 0, panelStyle: "flat", statusStyle: "square", timestamps: "always", timeFormat: "24h" },
    panels: Object.fromEntries(["rail", "sidebar", "dmSidebar", "header", "composer", "members"].map((r) => [r, { border: "#1E3A1E", borderOpacity: 100, borderWidth: 1, radius: 0 }])),
  }),
  p({
    meta: { id: "send-compact", name: "SEND Compact", description: "Dense layout for small screens and busy servers.", tags: ["compact", "dense", "dark"], scheme: "dark" },
    typography: { size: 14, lineHeight: 1.3 },
    layout: { density: "compact", avatarSize: 28, sidebarWidth: 210, memberWidth: 200, timestamps: "hover", radius: 6 },
  }),
  p({
    meta: { id: "send-panorama", name: "SEND Panorama", description: "Horizontal server bar across the top and a wide content area.", tags: ["horizontal", "layout", "wide", "dark"], scheme: "dark" },
    colors: { accent: "#4DA3FF" },
    layout: { nav: "horizontal", sidebarWidth: 232, memberWidth: 230 },
    panels: { rail: { bg: "#0E1220", opacity: 100, border: "#2E3858", borderOpacity: 100, borderWidth: 1 } },
  }),
  p({
    meta: { id: "send-canvas", name: "SEND Canvas", description: "A neutral foundation designed for your own wallpaper: soft translucent panels, readable overlay.", tags: ["wallpaper", "neutral", "transparent", "dark"], scheme: "dark" },
    colors: { bg0: "#16171C", bg1: "#1C1D23", bg2: "#1F2027", bg3: "#2A2C35", line: "#3A3C47", accent: "#7F8CFF" },
    panels: Object.fromEntries(["rail", "sidebar", "dmSidebar", "chat", "header", "members", "userPanel", "panels", "composer"].map((r) => [r, { bg: "#16171C", opacity: r === "chat" ? 55 : 70, blur: 12 }])),
    background: { dark: { kind: "image", asset: "builtin:canvas", fit: "cover", overlay: 10, vignette: 15 }, light: { kind: "image", asset: "builtin:canvas", fit: "cover", overlay: 10 }, target: "app" },
  }),
];

export const presetById = (id: string) => { const want = normalizeThemeId(id); return PRESETS.find((t) => t.meta.id === want) ?? null; };
