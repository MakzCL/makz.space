/**
 * Syndo theme engine — schema, validation, layering and safety rules.
 *
 * Everything appearance-related is plain data described by the specs below.
 * The same validator runs in the client (live editing, import) and on the
 * server (before anything is stored), so a theme can never carry markup,
 * script, remote URLs or unbounded values.
 *
 * Appearance hierarchy (later wins), see resolveAppearance():
 *   built-in defaults → selected theme → global personal overrides
 *   → device overrides (layout/performance) → personal server overrides
 *   → accepted shared conversation theme → personal channel/conversation overrides
 *   → accessibility enforcement (always last; nothing can override it)
 */

/* ------------------------------------------------------------- regions -- */
export const REGIONS = [
  { id: "app", label: "Application background", hint: "Behind everything" },
  { id: "rail", label: "Server navigation", hint: "Server icons rail or bar" },
  { id: "sidebar", label: "Channel sidebar", hint: "Channels inside a server" },
  { id: "dmSidebar", label: "Friends & DM sidebar", hint: "Conversations list" },
  { id: "chat", label: "Message area", hint: "Where messages are read" },
  { id: "header", label: "Chat header", hint: "Channel name and tools" },
  { id: "composer", label: "Message composer", hint: "Where you type" },
  { id: "members", label: "Member list", hint: "People in the server" },
  { id: "panels", label: "Side panels", hint: "Threads, forum, pins and search panels" },
  { id: "userPanel", label: "User controls", hint: "Your status, mute/deafen, voice connection" },
  { id: "call", label: "Call screen & controls", hint: "Voice/video stage and buttons" },
  { id: "profileCard", label: "Profile cards", hint: "Popouts and previews" },
  { id: "settings", label: "Settings panels", hint: "Settings and Studio" },
  { id: "overlay", label: "Dialogs, menus & tooltips", hint: "Floating surfaces" },
] as const;
export type RegionId = (typeof REGIONS)[number]["id"];
export const REGION_IDS = REGIONS.map((r) => r.id) as RegionId[];

export const FONTS = {
  cabinet: { label: "Cabinet Grotesk", stack: `"Cabinet Grotesk", system-ui, sans-serif` },
  system: { label: "System sans", stack: `"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif` },
  rounded: { label: "Rounded", stack: `ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", "Segoe UI", system-ui, sans-serif` },
  serif: { label: "Serif", stack: `"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif` },
  mono: { label: "Monospace", stack: `"JetBrains Mono", "Cascadia Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` },
  readable: { label: "Readable (Atkinson-style, system fallback)", stack: `"Atkinson Hyperlegible", Verdana, Tahoma, "Segoe UI", sans-serif` },
  condensed: { label: "Condensed", stack: `"Roboto Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif` },
} as const;
export type FontId = keyof typeof FONTS;

/* --------------------------------------------------------------- types -- */
export interface Gradient { to: string; angle: number }
export interface PanelStyle {
  bg?: string; opacity?: number; gradient?: Gradient | null; blur?: number;
  border?: string; borderOpacity?: number; borderWidth?: number; radius?: number; shadow?: number;
  image?: string | null; text?: string | null; icon?: string | null;
}
export interface Background {
  kind: "none" | "color" | "gradient" | "image" | "video";
  color?: string;
  gradient?: { from: string; via?: string | null; to: string; angle: number; type: "linear" | "radial" };
  asset?: string | null;      // "builtin:<name>" or "a<id>" (personal library)
  poster?: string | null;     // still fallback for animated/video
  fit?: "cover" | "contain" | "tile" | "stretch";
  x?: number; y?: number;     // focal point, %
  zoom?: number;              // 1 = 100 %
  brightness?: number; saturation?: number; blur?: number;
  tint?: string; overlay?: number; vignette?: number;
}
export interface BackgroundSet { dark?: Background | null; light?: Background | null; target?: "app" | "chat" }
export interface Layout {
  nav: "vertical" | "horizontal"; railColumns: 1 | 2 | 3;
  sidebarWidth: number; memberWidth: number; showMembers: boolean; showSidebar: boolean;
  density: "compact" | "cozy" | "spacious" | "custom"; spacing: number;
  messageStyle: "list" | "bubbles"; avatarSize: number; grouping: boolean;
  timestamps: "always" | "hover" | "none"; timeFormat: "12h" | "24h" | "relative";
  panelStyle: "flat" | "rounded" | "floating"; radius: number; gap: number; margin: number;
  unreadStyle: "pill" | "dot" | "bar"; mentionStyle: "tint" | "bar" | "outline"; statusStyle: "dot" | "ring" | "square";
  scale: number;
}
export interface Bubbles { mine: string; theirs: string; radius: number; spacing: number }
export interface ConversationPrefs { label?: string | null; messageStyle?: Layout["messageStyle"]; bubbles?: Partial<Bubbles>; compact?: boolean; chatOpacity?: number }
export interface ThemeColors {
  bg0: string; bg1: string; bg2: string; bg3: string; line: string; text: string; textMuted: string; textFaint: string;
  accent: string; accent2: string; mention: string; link: string; danger: string; success: string; warning: string;
}
export interface ThemeDoc {
  schema: "syndo.theme"; version: 2;
  meta: { id: string; name: string; author?: string; description?: string; version?: string; license?: string; tags: string[]; scheme: "dark" | "light" };
  colors: ThemeColors;
  panels: Partial<Record<RegionId, PanelStyle>>;
  typography: { font: FontId; size: number; lineHeight: number; letterSpacing: number };
  layout: Layout;
  background: BackgroundSet;
  effects: { animatedBackground: boolean; glow: number; blurScale: number };
  conversation: { bubbles: Bubbles };
  customCss?: string;
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? T[K] : DeepPartial<T[K]> | null) : T[K] | null };

export interface A11yPrefs {
  reducedMotion: "system" | "on" | "off"; highContrast: boolean; disableAnimatedBackgrounds: boolean; disableProfileEffects: boolean;
  disableOthersCosmetics: boolean; blur: "full" | "reduced" | "off"; lowPower: boolean; readableOverlay: boolean; minContrast: boolean;
}
export const DEFAULT_A11Y: A11yPrefs = {
  reducedMotion: "system", highContrast: false, disableAnimatedBackgrounds: false, disableProfileEffects: false,
  disableOthersCosmetics: false, blur: "full", lowPower: false, readableOverlay: false, minContrast: true,
};

/** Personal appearance, stored per scope (server table `appearance_prefs`). */
export interface GlobalAppearance {
  v: 2; themeId: string; lightThemeId: string | null; followSystem: boolean;
  overrides: DeepPartial<ThemeDoc>; a11y: A11yPrefs; customCssEnabled: boolean;
}
export interface ScopeAppearance { overrides: DeepPartial<ThemeDoc>; conversation?: ConversationPrefs }

/* ------------------------------------------------------------- defaults -- */
export const DEFAULT_LAYOUT: Layout = {
  nav: "vertical", railColumns: 1, sidebarWidth: 248, memberWidth: 260, showMembers: true, showSidebar: true,
  density: "cozy", spacing: 4, messageStyle: "list", avatarSize: 40, grouping: true, timestamps: "always", timeFormat: "12h",
  panelStyle: "flat", radius: 10, gap: 0, margin: 0, unreadStyle: "pill", mentionStyle: "tint", statusStyle: "dot", scale: 1,
};
export const DEFAULT_THEME: ThemeDoc = {
  schema: "syndo.theme", version: 2,
  meta: { id: "syndo-midnight", name: "Syndo Midnight", author: "Syndo", tags: ["dark", "default"], scheme: "dark" },
  colors: {
    bg0: "#0E1220", bg1: "#141A2B", bg2: "#1A2136", bg3: "#232C45", line: "#2E3858", text: "#EEF1F8", textMuted: "#A9B2C7", textFaint: "#7C8597",
    accent: "#3D6BFF", accent2: "#FFC93C", mention: "#FFC93C", link: "#7EA2FF", danger: "#E5484D", success: "#2FBF71", warning: "#F2B33D",
  },
  panels: {},
  typography: { font: "cabinet", size: 15, lineHeight: 1.4, letterSpacing: 0 },
  layout: DEFAULT_LAYOUT,
  background: { dark: null, light: null, target: "app" },
  effects: { animatedBackground: false, glow: 0, blurScale: 1 },
  conversation: { bubbles: { mine: "#3D6BFF", theirs: "#232C45", radius: 16, spacing: 4 } },
};
export const DEFAULT_GLOBAL: GlobalAppearance = { v: 2, themeId: "syndo-glass", lightThemeId: "syndo-paper", followSystem: false, overrides: {}, a11y: DEFAULT_A11Y, customCssEnabled: false };

/* ----------------------------------------------------------- validation -- */
type Spec =
  | { t: "color" } | { t: "num"; min: number; max: number; int?: boolean } | { t: "bool" } | { t: "str"; max: number; re?: RegExp }
  | { t: "enum"; values: readonly (string | number)[] } | { t: "asset" } | { t: "nullable"; of: Spec }
  | { t: "obj"; fields: Record<string, Spec> } | { t: "map"; keys: readonly string[]; of: Spec } | { t: "arr"; of: Spec; max: number };

const color: Spec = { t: "color" };
const num = (min: number, max: number, int = false): Spec => ({ t: "num", min, max, int });
const pct = num(0, 100, true);
const en = (...values: (string | number)[]): Spec => ({ t: "enum", values });
const nul = (of: Spec): Spec => ({ t: "nullable", of });
const obj = (fields: Record<string, Spec>): Spec => ({ t: "obj", fields });

const PANEL: Spec = obj({
  bg: color, opacity: pct, gradient: nul(obj({ to: color, angle: num(0, 360, true) })), blur: num(0, 40), border: color,
  borderOpacity: pct, borderWidth: num(0, 6), radius: num(0, 40), shadow: pct, image: nul({ t: "asset" }), text: nul(color), icon: nul(color),
});
const BACKGROUND: Spec = obj({
  kind: en("none", "color", "gradient", "image", "video"), color,
  gradient: obj({ from: color, via: nul(color), to: color, angle: num(0, 360, true), type: en("linear", "radial") }),
  asset: nul({ t: "asset" }), poster: nul({ t: "asset" }), fit: en("cover", "contain", "tile", "stretch"),
  x: pct, y: pct, zoom: num(0.5, 4), brightness: num(0, 200, true), saturation: num(0, 200, true), blur: num(0, 40), tint: color, overlay: pct, vignette: pct,
});
const BUBBLES: Spec = obj({ mine: color, theirs: color, radius: num(0, 28), spacing: num(0, 24) });
const LAYOUT: Spec = obj({
  nav: en("vertical", "horizontal"), railColumns: en(1, 2, 3), sidebarWidth: num(180, 420, true), memberWidth: num(180, 400, true),
  showMembers: { t: "bool" }, showSidebar: { t: "bool" }, density: en("compact", "cozy", "spacious", "custom"), spacing: num(0, 16),
  messageStyle: en("list", "bubbles"), avatarSize: num(24, 56, true), grouping: { t: "bool" }, timestamps: en("always", "hover", "none"),
  timeFormat: en("12h", "24h", "relative"), panelStyle: en("flat", "rounded", "floating"), radius: num(0, 28), gap: num(0, 24), margin: num(0, 32),
  unreadStyle: en("pill", "dot", "bar"), mentionStyle: en("tint", "bar", "outline"), statusStyle: en("dot", "ring", "square"), scale: num(0.8, 1.3),
});
export const THEME_SPEC: Spec = obj({
  schema: en("syndo.theme"), version: en(2),
  meta: obj({
    id: { t: "str", max: 64, re: /^[a-z0-9][a-z0-9-]{0,63}$/ }, name: { t: "str", max: 64 }, author: { t: "str", max: 64 }, description: { t: "str", max: 400 },
    version: { t: "str", max: 20 }, license: { t: "str", max: 64 }, tags: { t: "arr", of: { t: "str", max: 24 }, max: 12 }, scheme: en("dark", "light"),
  }),
  colors: obj(Object.fromEntries(Object.keys(DEFAULT_THEME.colors).map((k) => [k, color]))),
  panels: { t: "map", keys: REGION_IDS, of: PANEL },
  typography: obj({ font: en(...(Object.keys(FONTS) as string[])), size: num(12, 22), lineHeight: num(1.1, 2), letterSpacing: num(-1, 2) }),
  layout: LAYOUT,
  background: obj({ dark: nul(BACKGROUND), light: nul(BACKGROUND), target: en("app", "chat") }),
  effects: obj({ animatedBackground: { t: "bool" }, glow: pct, blurScale: num(0, 1) }),
  conversation: obj({ bubbles: BUBBLES }),
  customCss: { t: "str", max: 20_000 },
});
const CONVERSATION_SPEC: Spec = obj({ label: nul({ t: "str", max: 64 }), messageStyle: en("list", "bubbles"), bubbles: BUBBLES, compact: { t: "bool" }, chatOpacity: pct });
const A11Y_SPEC: Spec = obj({
  reducedMotion: en("system", "on", "off"), highContrast: { t: "bool" }, disableAnimatedBackgrounds: { t: "bool" }, disableProfileEffects: { t: "bool" },
  disableOthersCosmetics: { t: "bool" }, blur: en("full", "reduced", "off"), lowPower: { t: "bool" }, readableOverlay: { t: "bool" }, minContrast: { t: "bool" },
});

export interface Issue { path: string; message: string; level: "error" | "warning" }

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const ASSET = /^(builtin:[a-z0-9-]{1,40}|a\d{1,20})$/;

/**
 * Validate `v` against `spec`. Returns a cleaned copy containing only valid,
 * known values (partial input stays partial). Invalid values are dropped and
 * reported; unknown keys are dropped with a warning.
 */
function check(spec: Spec, v: unknown, path: string, issues: Issue[]): unknown {
  const bad = (message: string) => { issues.push({ path, message, level: "error" }); return undefined; };
  if (v === undefined) return undefined;
  switch (spec.t) {
    case "nullable": return v === null ? null : check(spec.of, v, path, issues);
    case "color": return typeof v === "string" && HEX.test(v) ? v.toUpperCase() : bad(`expected a #RRGGBB colour, got ${JSON.stringify(v)?.slice(0, 40)}`);
    case "num": {
      if (typeof v !== "number" || !Number.isFinite(v)) return bad("expected a number");
      if (v < spec.min || v > spec.max) return bad(`must be between ${spec.min} and ${spec.max}`);
      return spec.int ? Math.round(v) : v;
    }
    case "bool": return typeof v === "boolean" ? v : bad("expected true or false");
    case "str": {
      if (typeof v !== "string") return bad("expected text");
      if (v.length > spec.max) return bad(`at most ${spec.max} characters`);
      if (spec.re && !spec.re.test(v)) return bad("invalid format");
      return v;
    }
    case "enum": return spec.values.includes(v as never) ? v : bad(`must be one of: ${spec.values.join(", ")}`);
    case "asset": return typeof v === "string" && ASSET.test(v) ? v : bad("assets must be a library reference (a123) or a built-in (builtin:name); URLs are not allowed");
    case "arr": {
      if (!Array.isArray(v)) return bad("expected a list");
      if (v.length > spec.max) return bad(`at most ${spec.max} items`);
      return v.map((x, i) => check(spec.of, x, `${path}[${i}]`, issues)).filter((x) => x !== undefined);
    }
    case "obj": case "map": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return bad("expected an object");
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        const sub = spec.t === "obj" ? spec.fields[k] : (spec.keys.includes(k) ? spec.of : undefined);
        if (!sub) { issues.push({ path: p, message: "unknown setting — ignored", level: "warning" }); continue; }
        const c = x === null && sub.t !== "nullable" ? undefined : check(sub, x, p, issues);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
  }
}

export function validateThemePartial(input: unknown): { value: DeepPartial<ThemeDoc>; issues: Issue[] } {
  const issues: Issue[] = [];
  const value = (check(THEME_SPEC, input, "", issues) ?? {}) as DeepPartial<ThemeDoc>;
  if (typeof value.customCss === "string") {
    const r = validateCustomCss(value.customCss);
    for (const e of r.errors) issues.push({ path: "customCss", message: e, level: "error" });
    if (r.errors.length) delete value.customCss;
  }
  return { value, issues };
}

export function validateGlobal(input: unknown): { value: GlobalAppearance; issues: Issue[] } {
  const issues: Issue[] = [];
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const ov = validateThemePartial(i.overrides ?? {});
  issues.push(...ov.issues.map((x) => ({ ...x, path: `overrides.${x.path}` })));
  const a11y = check(A11Y_SPEC, i.a11y ?? {}, "a11y", issues) as Partial<A11yPrefs>;
  const id = (x: unknown, d: string | null) => (typeof x === "string" && /^(syndo-[a-z]+|preset:\d{1,20})$/.test(x) ? x : d);
  return {
    value: {
      v: 2, themeId: id(i.themeId, DEFAULT_GLOBAL.themeId)!, lightThemeId: id(i.lightThemeId, DEFAULT_GLOBAL.lightThemeId),
      followSystem: i.followSystem === true, overrides: ov.value, a11y: { ...DEFAULT_A11Y, ...a11y }, customCssEnabled: i.customCssEnabled === true,
    },
    issues,
  };
}

/** Per-server / per-channel: only colours, panels, backgrounds, bubbles and conversation prefs may be overridden. */
export const SCOPE_OVERRIDABLE = ["colors", "panels", "background", "conversation", "effects"] as const;
export function validateScope(input: unknown): { value: ScopeAppearance; issues: Issue[] } {
  const issues: Issue[] = [];
  const i = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const raw = i.overrides && typeof i.overrides === "object" ? i.overrides : {};
  const allowed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if ((SCOPE_OVERRIDABLE as readonly string[]).includes(k)) allowed[k] = v;
    else issues.push({ path: `overrides.${k}`, message: "can't be overridden per server or conversation (it is a global setting)", level: "warning" });
  }
  const ov = validateThemePartial(allowed);
  issues.push(...ov.issues.map((x) => ({ ...x, path: `overrides.${x.path}` })));
  const conversation = i.conversation ? (check(CONVERSATION_SPEC, i.conversation, "conversation", issues) as ConversationPrefs) : undefined;
  return { value: { overrides: ov.value, ...(conversation ? { conversation } : {}) }, issues };
}

/** Full theme document (import / preset save). Missing sections fall back to defaults. */
export function validateThemeDoc(input: unknown): { doc: ThemeDoc | null; issues: Issue[] } {
  if (!input || typeof input !== "object") return { doc: null, issues: [{ path: "", message: "Not a theme file (expected a JSON object).", level: "error" }] };
  const migrated = migrateThemeInput(input as Record<string, unknown>);
  if (!migrated) return { doc: null, issues: [{ path: "schema", message: "Not a Syndo theme. Expected \"schema\": \"syndo.theme\". Themes made for other apps (for example BetterDiscord .theme.css files) can't be imported.", level: "error" }] };
  const { value, issues } = validateThemePartial(migrated);
  const doc = mergeDeep(DEFAULT_THEME, value) as ThemeDoc;
  if (!value.meta?.name) issues.push({ path: "meta.name", message: "missing a name — using \"Untitled theme\"", level: "warning" });
  doc.meta = { ...doc.meta, name: value.meta?.name || "Untitled theme" };
  return { doc, issues };
}

/** Backward-compatible migrations: v1 export ({syndo_theme:1,…}) and v1 settings.appearance. */
export function migrateThemeInput(i: Record<string, unknown>): Record<string, unknown> | null {
  if (i.schema === "syndo.theme" && (i.version === 2 || i.version === undefined)) return { ...i, version: 2 };
  if (i.syndo_theme === 1 || i.schema === "syndo.theme" && i.version === 1) {
    const custom = (i.custom ?? {}) as Record<string, string>;
    const base = i.theme === "light" ? "light" : "dark";
    return {
      schema: "syndo.theme", version: 2,
      meta: { id: "imported-v1", name: "Imported theme", tags: ["imported"], scheme: base },
      colors: { ...custom, ...(typeof i.accent === "string" ? { accent: i.accent } : {}) },
      ...(typeof i.chatBackground === "string" ? { panels: { chat: { bg: i.chatBackground, opacity: 100 } } } : {}),
    };
  }
  return null;
}

export function migrateV1Appearance(a: Record<string, any> | undefined | null): GlobalAppearance {
  if (!a) return DEFAULT_GLOBAL;
  const themeId = a.theme === "light" ? "syndo-paper" : a.theme === "contrast" ? "syndo-oled" : a.theme ? "syndo-midnight" : DEFAULT_GLOBAL.themeId;
  const overrides: Record<string, any> = { colors: {}, typography: {}, layout: {}, panels: {} };
  if (typeof a.accent === "string") overrides.colors.accent = a.accent;
  if (a.theme === "custom" && a.custom) Object.assign(overrides.colors, a.custom);
  if (typeof a.fontScale === "number") overrides.typography.size = Math.round(15 * a.fontScale);
  if (a.density) overrides.layout.density = a.density;
  if (typeof a.chatBackground === "string") overrides.panels.chat = { bg: a.chatBackground, opacity: 100 };
  const v = validateGlobal({
    themeId, followSystem: a.theme === "system", overrides,
    a11y: { reducedMotion: a.reducedMotion ?? "system", highContrast: a.theme === "contrast", disableProfileEffects: a.showAnimatedAvatars === false },
  }).value;
  return v;
}

/* --------------------------------------------------------------- merge -- */
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** Deep merge; `null` in a later layer means "reset to inherited" (removes the key). */
export function mergeDeep<T>(base: T, ...layers: unknown[]): T {
  let out: any = structuredCloneSafe(base);
  for (const l of layers) out = mergeTwo(out, l);
  return out;
}
function mergeTwo(a: any, b: any): any {
  if (b === undefined) return a;
  if (!isObj(b)) return b;
  const out: Record<string, unknown> = isObj(a) ? { ...a } : {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (v === null) { out[k] = null; continue; }
    out[k] = isObj(v) ? mergeTwo(out[k], v) : v;
  }
  return out;
}
const structuredCloneSafe = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

/** Remove the value at `path` from a partial (used by "Reset to inherited"). */
export function unsetPath<T extends object>(o: T, path: string): T {
  const out: any = structuredCloneSafe(o);
  const parts = path.split(".");
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]!])) return out; cur = cur[parts[i]!]; }
  delete cur[parts[parts.length - 1]!];
  return out;
}
export function setPath<T extends object>(o: T, path: string, value: unknown): T {
  const out: any = structuredCloneSafe(o ?? {});
  const parts = path.split(".");
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) { if (!isObj(cur[parts[i]!])) cur[parts[i]!] = {}; cur = cur[parts[i]!]; }
  cur[parts[parts.length - 1]!] = value;
  return out;
}
export function getPath(o: unknown, path: string): unknown {
  let cur: any = o;
  for (const p of path.split(".")) { if (!isObj(cur)) return undefined; cur = cur[p]; }
  return cur;
}

export type LayerName = "default" | "theme" | "global" | "device" | "server" | "shared" | "conversation" | "accessibility";
export interface ResolveInput {
  theme: ThemeDoc;
  global: DeepPartial<ThemeDoc>;
  device?: DeepPartial<ThemeDoc>;
  server?: DeepPartial<ThemeDoc>;
  shared?: DeepPartial<ThemeDoc>;
  conversation?: DeepPartial<ThemeDoc>;
  a11y: A11yPrefs;
  systemReducedMotion?: boolean;
}
export interface Resolved { theme: ThemeDoc; source: (path: string) => LayerName; reduceMotion: boolean }

/** Deterministic resolution of the hierarchy, with provenance for the editor. */
export function resolveAppearance(i: ResolveInput): Resolved {
  const layers: [LayerName, unknown][] = [
    ["theme", i.theme], ["global", i.global], ["device", i.device], ["server", i.server], ["shared", i.shared], ["conversation", i.conversation],
  ];
  let t = mergeDeep(DEFAULT_THEME, ...layers.map(([, l]) => l)) as ThemeDoc;
  const reduceMotion = i.a11y.reducedMotion === "on" || (i.a11y.reducedMotion === "system" && !!i.systemReducedMotion) || i.a11y.lowPower;
  // Accessibility enforcement — last and unconditional.
  const enforce: DeepPartial<ThemeDoc> = {};
  if (reduceMotion || i.a11y.disableAnimatedBackgrounds) (enforce as any).effects = { animatedBackground: false };
  if (i.a11y.blur !== "full" || i.a11y.lowPower) (enforce as any).effects = { ...(enforce as any).effects, blurScale: i.a11y.blur === "off" || i.a11y.lowPower ? 0 : 0.4 };
  if (i.a11y.highContrast) (enforce as any).colors = HIGH_CONTRAST;
  t = mergeDeep(t, enforce);
  if (i.a11y.minContrast) t = enforceTextContrast(t);
  const source = (path: string): LayerName => {
    if (getPath(enforce, path) !== undefined) return "accessibility";
    for (let k = layers.length - 1; k >= 0; k--) if (getPath(layers[k]![1], path) !== undefined && getPath(layers[k]![1], path) !== null) return layers[k]![0];
    return "default";
  };
  return { theme: t, source, reduceMotion };
}

const HIGH_CONTRAST: Partial<ThemeColors> = { bg0: "#000000", bg1: "#000000", bg2: "#000000", bg3: "#141414", line: "#FFFFFF", text: "#FFFFFF", textMuted: "#F2F2F2", textFaint: "#D9D9D9", link: "#FFE066", mention: "#FFE066" };

/* ------------------------------------------------------------ contrast -- */
export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a.slice(0, 7)), luminance(b.slice(0, 7))].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
export const readableOn = (hex: string) => (luminance(hex.slice(0, 7)) > 0.4 ? "#0E1220" : "#FFFFFF");

/** Readability warnings for the editor (WCAG AA 4.5:1 for text, 3:1 for large/UI). */
export function readabilityIssues(t: ThemeDoc): Issue[] {
  const out: Issue[] = [];
  const pairs: [string, string, string, number][] = [
    ["colors.text", t.colors.text, t.colors.bg2, 4.5], ["colors.textMuted", t.colors.textMuted, t.colors.bg2, 4.5],
    ["colors.text (sidebar)", t.colors.text, t.colors.bg1, 4.5], ["colors.accent (on surface)", t.colors.accent, t.colors.bg2, 3],
    ["conversation.bubbles.mine", readableOn(t.conversation.bubbles.mine), t.conversation.bubbles.mine, 4.5],
  ];
  for (const [path, fg, bg, min] of pairs) {
    const c = contrast(fg, bg);
    if (c < min) out.push({ path, message: `contrast ${c.toFixed(1)}:1 is below ${min}:1 — text may be hard to read`, level: "warning" });
  }
  return out;
}

/** If minContrast is on, nudge body text toward black/white until it reaches 4.5:1 against the chat surface. */
function enforceTextContrast(t: ThemeDoc): ThemeDoc {
  const fix = (fg: string, bg: string, min: number) => {
    if (contrast(fg, bg) >= min) return fg;
    const target = luminance(bg) > 0.4 ? "#000000" : "#FFFFFF";
    for (let k = 0.1; k <= 1.0001; k += 0.1) { const m = mixHex(fg, target, k); if (contrast(m, bg) >= min) return m; }
    return target;
  };
  const c = { ...t.colors };
  c.text = fix(c.text, c.bg2, 4.5);
  c.textMuted = fix(c.textMuted, c.bg2, 4.5);
  return { ...t, colors: c };
}
export function mixHex(a: string, b: string, k: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/* ---------------------------------------------------------- custom CSS -- */
/**
 * Opt-in advanced styling. This is a real (small) parser with allowlists,
 * not string replacement:
 *   - only `selector { property: value; }` rules — no at-rules, no nesting;
 *   - selectors are built only from documented region hooks, documented
 *     classes, a few element names and harmless pseudo-classes;
 *   - only visual properties (colours, borders, radii, shadows, fonts,
 *     spacing inside an element) — nothing that hides, moves or overlays
 *     elements (display, position, visibility, content, transform, size…),
 *     so recovery controls can't be hidden;
 *   - values may not contain url(), image-set(), expression(), escapes,
 *     quotes-with-urls, or comment tricks.
 * Output is re-serialised from the parsed tokens and scoped under `.syndo-css`.
 */
export const CSS_CLASSES = [
  "msg", "msg-content", "msg-name", "msg-head", "msg-tools", "reaction", "mention", "md-code", "md-pre", "spoiler", "reply-ref", "sys-msg",
  "side-ch", "side-dm", "side-link", "side-sec", "side-h", "rail-item", "member", "btn", "tag", "badge", "composer", "ch-h", "topic",
  "profile-card", "pc-banner", "pc-body", "tile", "ctl", "call-controls", "user-panel", "voice-bar", "modal", "menu", "toast", "day-div", "new-div",
] as const;
const CSS_ELEMENTS = ["a", "b", "strong", "em", "code", "pre", "p", "span", "h1", "h2", "h3", "button", "input", "textarea", "blockquote", "li", "ul", "ol", "small", "time", "svg"];
const CSS_PSEUDO = [":hover", ":focus-visible", ":focus-within", ":active", ":first-child", ":last-child", "::placeholder", "::selection"];
const CSS_PROPS = new Set([
  "color", "background-color", "background", "background-image", "border", "border-color", "border-width", "border-style", "border-top", "border-bottom",
  "border-left", "border-right", "border-radius", "box-shadow", "text-shadow", "font-weight", "font-style", "font-size", "font-family", "letter-spacing",
  "line-height", "text-transform", "text-decoration", "text-decoration-color", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
  "outline-color", "accent-color", "caret-color", "fill", "stroke", "opacity", "backdrop-filter",
]);

export function validateCustomCss(src: string): { css: string; errors: string[] } {
  const errors: string[] = [];
  if (src.length > 20_000) return { css: "", errors: ["Custom CSS is limited to 20,000 characters."] };
  const text = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (/\/\*/.test(text)) errors.push("Unclosed comment.");
  if (/[\\<]/.test(text)) errors.push("Escapes and HTML characters aren't allowed.");
  if (/@/.test(text)) errors.push("At-rules (@import, @font-face, @media, …) aren't allowed.");
  if (/url\s*\(|image-set\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(text)) errors.push("url(), image-set(), expression(), javascript: and bindings aren't allowed — use the Background manager for images.");
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let consumed = "";
  while ((m = re.exec(text))) {
    consumed += m[0];
    const selectors = m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    const scoped: string[] = [];
    for (const sel of selectors) {
      const ok = sel.split(/\s*>\s*|\s+/).every((part) => {
        const pm = part.match(/^(\[data-region="([a-zA-Z]+)"\]|\.([a-z][a-z0-9-]*)|([a-z][a-z0-9]*))((?::{1,2}[a-z-]+)?)$/);
        if (!pm) return false;
        if (pm[2] && !REGION_IDS.includes(pm[2] as RegionId)) return false;
        if (pm[3] && !(CSS_CLASSES as readonly string[]).includes(pm[3])) return false;
        if (pm[4] && !CSS_ELEMENTS.includes(pm[4])) return false;
        if (pm[5] && !CSS_PSEUDO.includes(pm[5])) return false;
        return true;
      });
      if (!ok) { errors.push(`Unsupported selector "${sel.slice(0, 60)}". Use [data-region="…"], documented classes (e.g. .msg, .mention) and simple elements.`); continue; }
      scoped.push(`.syndo-css ${sel}`);
    }
    const decls: string[] = [];
    for (const d of m[2]!.split(";").map((s) => s.trim()).filter(Boolean)) {
      const i = d.indexOf(":");
      if (i < 0) { errors.push(`Malformed declaration "${d.slice(0, 40)}".`); continue; }
      const prop = d.slice(0, i).trim().toLowerCase();
      const val = d.slice(i + 1).trim();
      if (!CSS_PROPS.has(prop) && !/^--[a-z0-9-]+$/.test(prop)) { errors.push(`Property "${prop}" isn't allowed (layout-changing properties are blocked so controls can't be hidden).`); continue; }
      if (!/^[#a-zA-Z0-9.,%()\s\-+/!'"*]*$/.test(val) || /url|expression|javascript|attr\s*\(/i.test(val) || val.length > 300) { errors.push(`Value for "${prop}" isn't allowed.`); continue; }
      if (prop === "opacity" && parseFloat(val) < 0.4) { errors.push("opacity below 0.4 isn't allowed (it would make text unreadable — use panel opacity instead)."); continue; }
      decls.push(`${prop}: ${val}`);
    }
    if (scoped.length && decls.length) out.push(`${scoped.join(", ")} { ${decls.join("; ")}; }`);
  }
  if (text.replace(/([^{}]+)\{([^{}]*)\}/g, "").trim()) errors.push("Some text isn't inside a valid rule (nested blocks aren't supported).");
  return { css: errors.length ? "" : out.join("\n"), errors: [...new Set(errors)] };
}

/* --------------------------------------------------- profile cosmetics -- */
export const RING_STYLES = ["none", "solid", "dual", "spin", "pulse", "rainbow", "dashed"] as const;
export const FRAMES = ["none", "gradient", "holo", "neon", "glass", "sharp"] as const;
export const DECORATIONS = ["none", "halo", "sprout", "starlight", "bubbles", "socks", "hexes", "orbit"] as const;
export const NAMEPLATES = ["none", "solid", "gradient", "shimmer", "glass"] as const;
export const NAME_STYLES = ["plain", "gradient", "glow", "outline", "shimmer"] as const;
export const STATUS_SHAPES = ["circle", "square", "diamond", "hex"] as const;
export const ENTRANCES = ["none", "fade", "rise", "pop", "slide"] as const;
export const EFFECT_KINDS = ["particles", "sparkle", "confetti", "glow", "aurora", "snow"] as const;

export interface EffectLayer {
  kind: (typeof EFFECT_KINDS)[number]; enabled: boolean; color: string; intensity: number; speed: number;
  duration: number; loop: boolean; trigger: "always" | "hover"; density: number;
}
export interface ProfileTheme {
  primary: string; secondary: string;
  collection?: "eclipse" | "rosecourt" | "lepidoptera" | "emberwake" | "glacial" | "sakura" | "abyssal" | "ophidian" | "starlit" | "gilded" | "wisteria" | "phantom" | null;
  decoration: (typeof DECORATIONS)[number]; frame: (typeof FRAMES)[number];
  ring: { style: (typeof RING_STYLES)[number]; color: string; speed: number };
  nameStyle: (typeof NAME_STYLES)[number]; nameColor2?: string | null; nameGlow: number;
  nameplate: (typeof NAMEPLATES)[number]; statusShape: (typeof STATUS_SHAPES)[number];
  entrance: (typeof ENTRANCES)[number]; bannerAnimation: "none" | "pan" | "shimmer";
  effects: EffectLayer[];
}
export const DEFAULT_PROFILE_THEME: ProfileTheme = {
  primary: "#3D6BFF", secondary: "#FFC93C", decoration: "none", frame: "none", ring: { style: "none", color: "#3D6BFF", speed: 1 },
  nameStyle: "plain", nameColor2: null, nameGlow: 40, nameplate: "none", statusShape: "circle", entrance: "fade", bannerAnimation: "none", effects: [],
};
const PROFILE_SPEC: Spec = obj({
  collection: nul(en("eclipse", "rosecourt", "lepidoptera", "emberwake", "glacial", "sakura", "abyssal", "ophidian", "starlit", "gilded", "wisteria", "phantom")),
  primary: color, secondary: color, decoration: en(...DECORATIONS), frame: en(...FRAMES),
  ring: obj({ style: en(...RING_STYLES), color, speed: num(0.25, 3) }),
  nameStyle: en(...NAME_STYLES), nameColor2: nul(color), nameGlow: pct, nameplate: en(...NAMEPLATES), statusShape: en(...STATUS_SHAPES),
  entrance: en(...ENTRANCES), bannerAnimation: en("none", "pan", "shimmer"),
  effects: { t: "arr", max: 6, of: obj({ kind: en(...EFFECT_KINDS), enabled: { t: "bool" }, color, intensity: pct, speed: num(0.25, 3), duration: num(0.5, 30), loop: { t: "bool" }, trigger: en("always", "hover"), density: pct }) },
  // v1 fields kept readable:
  effect: nul({ t: "str", max: 32 }),
});

/** Validate a public profile theme (global or per-server). Legacy v1 values are upgraded. */
export function validateProfileTheme(input: unknown): { value: ProfileTheme | null; issues: Issue[] } {
  if (input === null) return { value: null, issues: [] };
  const issues: Issue[] = [];
  const i = { ...(input as Record<string, any>) };
  // v1 compatibility: {primary, secondary, effect, decoration, nameStyle}
  if (typeof i.decoration === "string" && !(DECORATIONS as readonly string[]).includes(i.decoration)) i.decoration = "none";
  if (i.decoration === "" || i.decoration === null) i.decoration = "none";
  if (i.nameStyle === "" || i.nameStyle === null) i.nameStyle = "plain";
  if (typeof i.effect === "string" && i.effect && !i.effects) {
    const kind = i.effect === "sparkle" ? "sparkle" : i.effect === "aurora" ? "aurora" : "glow";
    i.effects = [{ kind, enabled: true, color: i.primary ?? "#3D6BFF", intensity: 50, speed: 1, duration: 4, loop: true, trigger: "always", density: 40 }];
  }
  delete i.effect;
  const v = check(PROFILE_SPEC, i, "", issues) as Partial<ProfileTheme>;
  return { value: mergeDeep(DEFAULT_PROFILE_THEME, v) as ProfileTheme, issues };
}
