import { create } from "zustand";
import {
  DEFAULT_A11Y, DEFAULT_GLOBAL, PRESETS, migrateV1Appearance, presetById, resolveAppearance, validateCustomCss, validateGlobal, validateScope,
  type A11yPrefs, type ConversationPrefs, type DeepPartial, type GlobalAppearance, type Layout, type Resolved, type ScopeAppearance, type ThemeDoc,
} from "@syndo/shared";
import { ApiError, api, errMsg } from "../api.ts";
import { onEvent, toast, useStore } from "../store.ts";
import { applyToDocument, clearSnapshot, defaultResolved, saveSnapshot } from "./engine.ts";

export interface Preset { id: string; name: string; data: ThemeDoc }
export interface SharedTheme { id: string; channel_id: string; proposer_id: string; data: DeepPartial<ThemeDoc>; my_vote: boolean | null; created_at: string }
export interface Asset { id: string; kind: "image" | "video"; mime: string; size: number; width: number | null; height: number | null; animated: boolean; name: string; favorite: boolean; url: string; references?: string[] }
/** Device-specific: never synced (screen size, GPU, battery differ per device). */
export interface DeviceOverrides { layout?: Partial<Layout>; a11y?: Partial<Pick<A11yPrefs, "blur" | "lowPower" | "disableAnimatedBackgrounds">>; enabled?: boolean }
export interface Draft { global: GlobalAppearance; scopes: Record<string, ScopeAppearance | null> }
export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

interface AS {
  loaded: boolean;
  safeMode: boolean;
  global: { data: GlobalAppearance; rev?: number };
  scopes: Record<string, { data: ScopeAppearance; rev?: number }>;
  presets: Preset[];
  shared: SharedTheme[];
  storage: { used: number; count: number; quota: number; max_file: number } | null;
  assets: Asset[] | null;
  device: DeviceOverrides;
  draft: Draft | null;
  past: Draft[];
  future: Draft[];
  ctx: { guildId: string | null; channelId: string | null };
  previewCtx: { guildId: string | null; channelId: string | null } | null;
  resolved: Resolved;
  conversation: ConversationPrefs;
  saveState: SaveState;
  saveError: string | null;
}

const DEVICE_KEY = "syndo.device.v1";
const SAFE_KEY = "syndo.safe-appearance";
const loadDevice = (): DeviceOverrides => { try { return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "{}"); } catch { return {}; } };
const initialSafe = () => {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("safe-appearance") || q.has("safe")) { localStorage.setItem(SAFE_KEY, "1"); return true; }
    return localStorage.getItem(SAFE_KEY) === "1";
  } catch { return false; }
};

export const useAppearance = create<AS>(() => ({
  loaded: false, safeMode: initialSafe(), global: { data: DEFAULT_GLOBAL }, scopes: {}, presets: [], shared: [], storage: null, assets: null,
  device: loadDevice(), draft: null, past: [], future: [], ctx: { guildId: null, channelId: null }, previewCtx: null,
  resolved: defaultResolved(), conversation: {}, saveState: "idle", saveError: null,
}));
const set = useAppearance.setState;
const get = useAppearance.getState;

export const scopeKey = (scope: "guild" | "channel", id: string) => `${scope}:${id}`;
const committed = (): Draft => {
  const s = get();
  return { global: s.global.data, scopes: Object.fromEntries(Object.entries(s.scopes).map(([k, v]) => [k, v.data])) };
};
export const effective = (): Draft => get().draft ?? committed();

/* -------------------------------------------------------------- resolve -- */
export function themeFor(id: string | null | undefined): ThemeDoc {
  if (id?.startsWith("preset:")) return get().presets.find((p) => `preset:${p.id}` === id)?.data ?? PRESETS[2]!;
  return presetById(id ?? "") ?? presetById("syndo-midnight")!;
}

export function resolveFor(ctx: { guildId: string | null; channelId: string | null }, d: Draft = effective()): { resolved: Resolved; conversation: ConversationPrefs; customCss: string | null } {
  const s = get();
  const sysReduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (s.safeMode) return { resolved: resolveAppearance({ theme: presetById("syndo-midnight")!, global: {}, a11y: { ...DEFAULT_A11Y, reducedMotion: "on" }, systemReducedMotion: true }), conversation: {}, customCss: null };
  const g = d.global;
  const light = !matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = themeFor(g.followSystem && light && g.lightThemeId ? g.lightThemeId : g.themeId);
  const dev = s.device.enabled === false ? {} : s.device;
  const a11y: A11yPrefs = { ...DEFAULT_A11Y, ...g.a11y, ...(dev.a11y ?? {}) };
  const server = ctx.guildId ? d.scopes[scopeKey("guild", ctx.guildId)] : null;
  const chan = ctx.channelId ? d.scopes[scopeKey("channel", ctx.channelId)] : null;
  const shared = ctx.channelId ? s.shared.filter((x) => x.channel_id === ctx.channelId && x.my_vote === true).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] : undefined;
  const resolved = resolveAppearance({
    theme, global: g.overrides, device: dev.layout ? { layout: dev.layout } as DeepPartial<ThemeDoc> : undefined,
    server: server?.overrides, shared: shared?.data, conversation: chan?.overrides, a11y, systemReducedMotion: sysReduce,
  });
  const conversation: ConversationPrefs = { ...(server?.conversation ?? {}), ...(chan?.conversation ?? {}) };
  let customCss: string | null = null;
  if (g.customCssEnabled && resolved.theme.customCss) { const r = validateCustomCss(resolved.theme.customCss); customCss = r.errors.length ? null : r.css; }
  return { resolved, conversation, customCss };
}

let applyQueued = false;
/** Re-apply after any change. Batched per frame; does not touch media, devices or calls. */
export function reapply() {
  if (applyQueued) return;
  applyQueued = true;
  requestAnimationFrame(() => {
    applyQueued = false;
    const s = get();
    const ctx = s.previewCtx ?? s.ctx;
    const r = resolveFor(ctx);
    applyToDocument(r.resolved, r.conversation, r.customCss);
    set({ resolved: r.resolved, conversation: r.conversation });
    (window as any).__syndoTheme = r.resolved.theme.meta.id; // test/diagnostics hook
    if (!s.draft && !s.safeMode && !s.previewCtx) saveSnapshot();
  });
}
useAppearance.subscribe((s, p) => {
  if (s.global !== p.global || s.scopes !== p.scopes || s.draft !== p.draft || s.ctx !== p.ctx || s.previewCtx !== p.previewCtx || s.presets !== p.presets || s.shared !== p.shared || s.device !== p.device || s.safeMode !== p.safeMode) reapply();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reapply);
matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", reapply);

export function setContext(guildId: string | null, channelId: string | null) {
  const c = get().ctx;
  if (c.guildId !== guildId || c.channelId !== channelId) set({ ctx: { guildId, channelId } });
}

/* ----------------------------------------------------------------- load -- */
export async function loadAppearance() {
  try {
    const r = await api.get<{ prefs: { scope: string; scope_id: string; data: any; rev: number }[]; presets: Preset[]; shared: SharedTheme[]; storage: AS["storage"] }>("/api/appearance");
    const scopes: AS["scopes"] = {};
    let global: AS["global"] | null = null;
    for (const p of r.prefs) {
      if (p.scope === "global") global = { data: validateGlobal(p.data).value, rev: p.rev };
      else scopes[scopeKey(p.scope as "guild" | "channel", p.scope_id)] = { data: validateScope(p.data).value, rev: p.rev };
    }
    if (!global) {
      // First run on v2: carry over v1 appearance settings (theme, accent, font size, motion…).
      const v1 = (useStore.getState().me?.settings as any)?.appearance;
      global = { data: v1 ? migrateV1Appearance(v1) : DEFAULT_GLOBAL };
    }
    set({ loaded: true, global, scopes, presets: r.presets, shared: r.shared, storage: r.storage });
  } catch (e) {
    set({ loaded: true });
    if (!(e instanceof ApiError && e.status === 401)) toast(`Couldn't load your appearance: ${errMsg(e)}. Using the default look.`, "error");
  }
}
onEvent("READY", () => loadAppearance());
onEvent("APPEARANCE_UPDATE", (d) => {
  // Another device saved. Adopt unless we're mid-edit of that scope (then the conflict surfaces on save).
  const key = d.scope === "global" ? "global" : scopeKey(d.scope, d.scope_id);
  if (key === "global") { if ((get().global.rev ?? 0) < d.rev) set({ global: { data: validateGlobal(d.data).value, rev: d.rev } }); return; }
  set((s) => {
    const scopes = { ...s.scopes };
    if (!d.data) delete scopes[key]; else if ((scopes[key]?.rev ?? 0) < d.rev) scopes[key] = { data: validateScope(d.data).value, rev: d.rev };
    return { scopes };
  });
});
onEvent("PRESETS_UPDATE", () => api.get<any>("/api/appearance").then((r) => set({ presets: r.presets, storage: r.storage })).catch(() => {}));
onEvent("CONVERSATION_THEME_UPDATE", () => api.get<any>("/api/appearance").then((r) => set({ shared: r.shared })).catch(() => {}));

/* ----------------------------------------------------------------- save -- */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
async function putScope(key: string, data: unknown) {
  const s = get();
  const rev = key === "global" ? s.global.rev : s.scopes[key]?.rev;
  const path = key === "global" ? "/api/appearance/global" : `/api/appearance/${key.replace(":", "/")}`;
  set({ saveState: "saving", saveError: null });
  try {
    if (data === null) {
      await api.del(path);
      set((st) => { const scopes = { ...st.scopes }; delete scopes[key]; return { scopes, saveState: "saved" }; });
      return;
    }
    const r = await api.put<{ rev: number; data: any; warnings: { message: string; path: string }[] }>(path, { data, rev });
    if (key === "global") set({ global: { data: r.data, rev: r.rev }, saveState: "saved" });
    else set((st) => ({ scopes: { ...st.scopes, [key]: { data: r.data, rev: r.rev } }, saveState: "saved" }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      // Two devices edited the same scope: keep the newer server copy, tell the user.
      await loadAppearance();
      set({ saveState: "error", saveError: "Changed on another device — loaded the latest version. Re-apply your edit if you still want it." });
      return;
    }
    set({ saveState: "error", saveError: errMsg(e) });
    throw e;
  }
}
/** Debounced autosave used by quick controls outside Studio. */
export function autosave(key: string, data: unknown, delay = 600) {
  set({ saveState: "pending" });
  if (key === "global") set({ global: { ...get().global, data: data as GlobalAppearance } });
  else set((s) => ({ scopes: data === null ? Object.fromEntries(Object.entries(s.scopes).filter(([k]) => k !== key)) : { ...s.scopes, [key]: { rev: s.scopes[key]?.rev, data: data as ScopeAppearance } } }));
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => { pending.delete(key); putScope(key, data).catch(() => {}); }, delay));
}
export const updateGlobal = (fn: (g: GlobalAppearance) => GlobalAppearance) => autosave("global", validateGlobal(fn(get().global.data)).value);
export const updateScope = (key: string, fn: (s: ScopeAppearance) => ScopeAppearance | null) => {
  const next = fn(get().scopes[key]?.data ?? { overrides: {} });
  autosave(key, next === null ? null : validateScope(next).value);
};

/* --------------------------------------------------------- Studio draft -- */
export function beginDraft() { if (!get().draft) set({ draft: structuredClone(committed()), past: [], future: [] }); }
export function editDraft(fn: (d: Draft) => Draft) {
  const s = get();
  if (!s.draft) beginDraft();
  const cur = get().draft!;
  const next = fn(structuredClone(cur));
  set({ draft: next, past: [...get().past.slice(-99), cur], future: [] });
}
export function undo() { const s = get(); if (!s.past.length || !s.draft) return; set({ draft: s.past[s.past.length - 1]!, past: s.past.slice(0, -1), future: [s.draft, ...s.future] }); }
export function redo() { const s = get(); if (!s.future.length || !s.draft) return; set({ draft: s.future[0]!, future: s.future.slice(1), past: [...s.past, s.draft] }); }
export function cancelDraft() { set({ draft: null, past: [], future: [], previewCtx: null }); }
export const isDirty = () => { const s = get(); return !!s.draft && JSON.stringify(s.draft) !== JSON.stringify(committed()); };

/** Apply: persist every changed scope. Validation happens again on the server. */
export async function applyDraft() {
  const s = get();
  if (!s.draft) return true;
  const base = committed();
  try {
    if (JSON.stringify(s.draft.global) !== JSON.stringify(base.global)) await putScope("global", validateGlobal(s.draft.global).value);
    for (const [k, v] of Object.entries(s.draft.scopes)) {
      if (JSON.stringify(v ?? null) === JSON.stringify(base.scopes[k] ?? null)) continue;
      await putScope(k, v === null || (!Object.keys(v.overrides ?? {}).length && !v.conversation) ? null : validateScope(v).value);
    }
    set({ draft: null, past: [], future: [], previewCtx: null });
    toast("Appearance saved.", "success");
    return true;
  } catch { toast(get().saveError ?? "Couldn't save appearance.", "error"); return false; }
}

/* ------------------------------------------------------- device & safety -- */
export function setDevice(d: DeviceOverrides) {
  set({ device: d });
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); } catch { /* */ }
}
export function setSafeMode(on: boolean) {
  try { on ? localStorage.setItem(SAFE_KEY, "1") : localStorage.removeItem(SAFE_KEY); } catch { /* */ }
  if (!on && new URLSearchParams(location.search).has("safe-appearance")) history.replaceState(null, "", location.pathname);
  set({ safeMode: on });
}
/** Recovery: restore the default appearance everywhere (keeps presets and the asset library). */
export async function resetAppearance(scope: "all" | "global" = "all") {
  clearSnapshot();
  set({ draft: null, past: [], future: [], previewCtx: null });
  const keepA11y = get().global.data.a11y;
  await putScope("global", { ...DEFAULT_GLOBAL, a11y: keepA11y, customCssEnabled: false }).catch(() => {});
  if (scope === "all") for (const k of Object.keys(get().scopes)) await putScope(k, null).catch(() => {});
  setDevice({});
  setSafeMode(false);
  toast("Appearance reset to the SEND default.", "success");
}
// Emergency shortcut, works anywhere and before anything else loads: Ctrl+Shift+Alt+R.
window.addEventListener("keydown", (e) => { if (e.ctrlKey && e.shiftKey && e.altKey && e.code === "KeyR") { e.preventDefault(); setSafeMode(!get().safeMode); } });

export async function loadAssets() {
  try { set({ assets: await api.get<Asset[]>("/api/appearance/assets") }); } catch (e) { toast(errMsg(e), "error"); }
}
