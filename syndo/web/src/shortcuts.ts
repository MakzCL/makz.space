import { create } from "zustand";
import { ChannelType, isVoiceType, type Channel } from "@send/shared";
import { ackChannel } from "./actions.ts";
import { hasBlockingLayers as hasLayers } from "./layers.ts";
import { navigate } from "./router.ts";
import { channelTree, isUnread, useStore } from "./store.ts";

/**
 * Central keyboard (and mouse-button) shortcut registry.
 *
 * Bindings are strings like "Mod+Shift+M", "Alt+ArrowUp", "Shift+Escape" or "MouseBack". `Mod` is Ctrl on
 * Windows/Linux and ⌘ on macOS, so one stored binding works on every device. User overrides are kept in the
 * synced account settings (`settings.keybinds`), so they follow the account; only actual keys differ per OS.
 *
 * Rules: nothing fires while an IME composition is active; nothing fires when a layer (dialog, menu, picker)
 * has already handled the key; plain keys never fire inside text fields (so typing is never hijacked), while
 * modified combos do — unless the action opts out; key-repeat is ignored except for navigation actions.
 */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export type ShortcutAction = {
  id: string; label: string; group: string; defaults: string[];
  /** Whether the action may fire while typing in a text field. Default: only when the binding has Mod/Ctrl/Alt. */
  inInput?: boolean;
  repeat?: boolean;
  /** Reserved by web browsers (e.g. Ctrl+Shift+N opens a private window): works in the desktop app only. */
  browserReserved?: boolean;
  /** Still works while a dialog/menu is open (call controls). */
  whileLayers?: boolean;
  /** Only active in a specific situation (e.g. while a call rings), so it may share a key with another action. */
  situational?: boolean;
  note?: string;
  run: () => boolean | void;
};

/* ---------------------------------------------------------------- formatting */
const MODS = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const KEY_NAMES: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", PageUp: "Page Up", PageDown: "Page Down", " ": "Space", MouseBack: "Mouse Back", MouseForward: "Mouse Forward", MouseMiddle: "Middle Click" };
export function prettyBinding(b: string) {
  return b.split("+").map((p) => p === "Mod" ? (isMac ? "⌘" : "Ctrl") : p === "Alt" ? (isMac ? "⌥" : "Alt") : p === "Ctrl" ? (isMac ? "⌃" : "Ctrl") : p === "Shift" ? (isMac ? "⇧" : "Shift") : KEY_NAMES[p] ?? p).join(isMac ? "" : "+");
}
/** The binding string for a keyboard event, or null for a lone modifier. */
export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Meta", "Alt", "Shift", "OS", "AltGraph", "CapsLock", "Dead", "Unidentified", "Process"].includes(key)) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  // Shift is part of the binding for non-character keys; for characters it is already in e.key ("?" not "Shift+/").
  const named = key.length > 1;
  // With Alt (⌥ on macOS) e.key becomes a symbol; use the physical key so Option+letter shortcuts still match.
  let k = named ? key : (e.altKey || (e as KeyboardEvent).code?.startsWith("Key")) && (e as KeyboardEvent).code ? codeToKey((e as KeyboardEvent).code) ?? key : key;
  if (k.length === 1) k = k.toUpperCase();
  if (e.shiftKey && (named || /^[A-Z0-9]$/.test(k) || parts.length)) parts.push("Shift");
  parts.push(k);
  return normalize(parts.join("+"));
}
function codeToKey(code: string) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return ({ Slash: "/", BracketLeft: "[", BracketRight: "]", Backquote: "`", Comma: ",", Period: ".", Semicolon: ";", Quote: "'", Minus: "-", Equal: "=", Backslash: "\\" } as Record<string, string>)[code] ?? null;
}
export function normalize(b: string) {
  const parts = b.split("+"); const key = parts.pop()!;
  const mods = MODS.filter((m) => parts.includes(m));
  return [...mods, key].join("+");
}
const hasModifier = (b: string) => /^(Mod|Ctrl|Alt)\+/.test(b) || /\+(Mod|Ctrl|Alt)\+/.test(b);

/* ------------------------------------------------------------------ registry */
const actions = new Map<string, ShortcutAction>();
export const registerShortcut = (a: ShortcutAction) => { actions.set(a.id, a); useBindings.setState((s) => ({ v: s.v + 1 })); };
export const shortcutActions = () => [...actions.values()];
const useBindings = create<{ v: number }>(() => ({ v: 0 }));
export const useShortcutVersion = () => useBindings((s) => s.v) + useStore((s) => JSON.stringify((s.me?.settings as any)?.keybinds ?? null)).length;
export function overrides(): Record<string, string[]> {
  const k = (useStore.getState().me?.settings as any)?.keybinds;
  return k && typeof k === "object" ? k : {};
}
export const bindingsFor = (id: string) => overrides()[id] ?? actions.get(id)?.defaults ?? [];
/** Every action currently using `binding` (for conflict detection). */
export const usersOf = (binding: string, except?: string) => { const me = except ? actions.get(except) : undefined; return shortcutActions().filter((a) => a.id !== except && bindingsFor(a.id).includes(binding) && !(a.situational || me?.situational)); };

/* ----------------------------------------------------------------- dispatch */
function editable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button", "range", "submit"].includes((el as HTMLInputElement).type)) || el.tagName === "SELECT");
}
function fire(binding: string, e: Event, typing: boolean, repeat: boolean) {
  const layered = hasLayers();
  // Situational actions get the first chance (e.g. Escape declines a ringing call before marking read).
  for (const a of [...actions.values()].sort((x, y) => Number(!!y.situational) - Number(!!x.situational))) {
    if (!bindingsFor(a.id).includes(binding)) continue;
    if (layered && !a.whileLayers) continue;
    if (repeat && !a.repeat) continue;
    if (typing && !(a.inInput ?? hasModifier(binding))) continue;
    if (a.run() !== false) { e.preventDefault(); e.stopPropagation(); return true; }
  }
  return false;
}
let installed = false;
export function initShortcuts() {
  if (installed) return; installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
    if (document.body.dataset.recordingKeybind) return; // the Keybinds recorder is capturing
    const combo = comboFromEvent(e); if (!combo) return;
    const typing = editable(e.target);
    if (fire(combo, e, typing, e.repeat)) return;
    // Typing anywhere in the app starts a message (Discord behaviour): focus the composer and let the key through.
    if (!typing && !hasLayers() && combo.length === 1 && /\S/.test(e.key) && !(e.target as HTMLElement)?.closest?.("button,a,[role=menu],[role=listbox],[role=tab],.viewer")) {
      const composer = document.querySelector<HTMLTextAreaElement>(".composer textarea");
      if (composer && !composer.disabled) composer.focus();
    }
  });
  window.addEventListener("mouseup", (e) => {
    const name = e.button === 1 ? "MouseMiddle" : e.button === 3 ? "MouseBack" : e.button === 4 ? "MouseForward" : null;
    if (!name || hasLayers()) return;
    const parts: string[] = []; if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod"); if (e.altKey) parts.push("Alt"); if (e.shiftKey) parts.push("Shift");
    const combo = normalize([...parts, name].join("+"));
    // In a browser plain back/forward buttons already move through history; only act when a user bound them to something.
    if (shortcutActions().some((a) => overrides()[a.id]?.includes(combo))) { fire(combo, e, false, false); return; }
    // The desktop app's window doesn't do that by itself, so move through channel history here.
    if ((window as any).sendDesktop && parts.length === 0 && (name === "MouseBack" || name === "MouseForward")) {
      e.preventDefault();
      if (name === "MouseBack") history.back(); else history.forward();
    }
  });
}

/* ---------------------------------------------------- navigation helpers */
const route = () => { const p = location.pathname.split("/").filter(Boolean); return { guild: p[1] ?? "@me", channel: p[2] ?? "" }; };
function guildOrder() {
  const s = useStore.getState();
  const order = ((s.me?.settings as any)?.guild_order as string[] | undefined) ?? [];
  const ids = Object.keys(s.guilds);
  return ["@me", ...order.filter((id) => s.guilds[id]), ...ids.filter((id) => !order.includes(id))];
}
/** Text-like channels in sidebar order for the current server, or DMs in list order. Voice channels are skipped: entering one joins it. */
export function navigableChannels(guildId: string): Channel[] {
  const s = useStore.getState();
  if (guildId === "@me") return Object.values(s.dms).sort((a, b) => (BigInt(b.last_message_id ?? b.id) > BigInt(a.last_message_id ?? a.id) ? 1 : -1));
  const g = s.guilds[guildId]; if (!g) return [];
  const { loose, cats } = channelTree(g);
  return [...loose, ...cats.flatMap((c) => c.children)].filter((c) => c.type !== ChannelType.CATEGORY && !isVoiceType(c.type));
}
const go = (c: Channel) => navigate(`/channels/${c.guild_id ?? "@me"}/${c.id}`);
export function stepServer(d: 1 | -1) { const ids = guildOrder(), i = ids.indexOf(route().guild); navigate(`/channels/${ids[(i + d + ids.length) % ids.length]}`); }
export function stepChannel(d: 1 | -1, filter?: (c: Channel) => boolean) {
  const r = route(); const list = navigableChannels(r.guild); if (!list.length) return false;
  let i = list.findIndex((c) => c.id === r.channel);
  for (let n = 0; n < list.length; n++) { i = (i + d + list.length) % list.length; if (!filter || filter(list[i]!)) { go(list[i]!); return true; } }
  return false;
}
/** Next/previous channel with an unread mention anywhere (servers in rail order, then DMs). */
export function stepMention(d: 1 | -1) {
  const s = useStore.getState();
  const all = guildOrder().flatMap((g) => navigableChannels(g));
  const r = route(); let i = all.findIndex((c) => c.id === r.channel);
  for (let n = 0; n < all.length; n++) { i = (i + d + all.length) % all.length; if ((s.readStates[all[i]!.id]?.mention_count ?? 0) > 0) { go(all[i]!); return true; } }
  return false;
}
export function markCurrentRead() { const r = route(); const c = navigableChannels(r.guild).find((x) => x.id === r.channel); if (c) ackChannel(c); return !!c; }
export function markServerRead() {
  const r = route(); if (r.guild === "@me") { for (const c of navigableChannels("@me")) if (isUnread(c)) ackChannel(c); return true; }
  const g = useStore.getState().guilds[r.guild]; if (!g) return false;
  for (const c of g.channels) if (c.type !== ChannelType.CATEGORY && !isVoiceType(c.type) && isUnread(c)) ackChannel(c);
  return true;
}
