import { api, errMsg } from "./api.ts";
import { navigate } from "./router.ts";
import { isUnread, toast, useStore } from "./store.ts";
import { markCurrentRead, markServerRead, registerShortcut, stepChannel, stepMention, stepServer } from "./shortcuts.ts";
import { joinVoice, setDeafened, setMuted, useVoice } from "./voice/session.ts";

/** UI requests are sent as events so the shortcut layer doesn't need to know which component owns which state. */
export const uiEvent = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const route = () => { const p = location.pathname.split("/").filter(Boolean); return { guild: p[1] ?? "@me", channel: p[2] ?? "" }; };
const inChannel = () => !!route().channel && route().channel !== "saved";
const ringingHere = () => { const s = useStore.getState(), me = s.me?.id; return Object.values(s.calls ?? {}).find((c: any) => me && c.ringing?.includes(me)) as any; };
const history: string[] = [];
let lastText = "";
// Remember text channels as they're visited so "previous text channel" works like Discord (not raw browser history).
const track = () => { const r = route(); if (r.channel && r.channel !== "saved") { const k = `/channels/${r.guild}/${r.channel}`; if (k !== lastText) { if (lastText) history.push(lastText); lastText = k; if (history.length > 50) history.shift(); } } };

export function registerDefaultShortcuts() {
  window.addEventListener("popstate", track);
  const orig = window.history.pushState.bind(window.history);
  window.history.pushState = (...a: Parameters<History["pushState"]>) => { orig(...a); track(); };
  track();

  const nav = "Navigation", chat = "Chat", voice = "Voice & calls", app = "App";
  registerShortcut({ id: "help.shortcuts", group: app, label: "Show keyboard shortcuts", defaults: ["Mod+/"], run: () => uiEvent("syndo:shortcut-help") });
  registerShortcut({ id: "nav.quickSwitcher", group: nav, label: "Quick switcher (find a server, channel or DM)", defaults: ["Mod+K"], run: () => uiEvent("syndo:quickswitcher") });
  registerShortcut({ id: "nav.serverPrev", group: nav, label: "Previous server", defaults: ["Mod+Alt+ArrowUp"], repeat: true, run: () => stepServer(-1) });
  registerShortcut({ id: "nav.serverNext", group: nav, label: "Next server", defaults: ["Mod+Alt+ArrowDown"], repeat: true, run: () => stepServer(1) });
  registerShortcut({ id: "nav.channelPrev", group: nav, label: "Previous channel or DM", defaults: ["Alt+ArrowUp"], repeat: true, run: () => stepChannel(-1) });
  registerShortcut({ id: "nav.channelNext", group: nav, label: "Next channel or DM", defaults: ["Alt+ArrowDown"], repeat: true, run: () => stepChannel(1) });
  registerShortcut({ id: "nav.unreadPrev", group: nav, label: "Previous unread channel", defaults: ["Alt+Shift+ArrowUp"], repeat: true, run: () => stepChannel(-1, isUnread) });
  registerShortcut({ id: "nav.unreadNext", group: nav, label: "Next unread channel", defaults: ["Alt+Shift+ArrowDown"], repeat: true, run: () => stepChannel(1, isUnread) });
  registerShortcut({ id: "nav.mentionPrev", group: nav, label: "Previous channel with mentions", defaults: ["Mod+Alt+Shift+ArrowUp"], repeat: true, run: () => stepMention(-1) });
  registerShortcut({ id: "nav.mentionNext", group: nav, label: "Next channel with mentions", defaults: ["Mod+Alt+Shift+ArrowDown"], repeat: true, run: () => stepMention(1) });
  registerShortcut({ id: "nav.back", group: nav, label: "Back to previous text channel", defaults: ["Alt+ArrowLeft", "Mod+B"], inInput: false, run: () => { const to = history.pop(); if (!to) return false; lastText = ""; navigate(to); return true; } });
  registerShortcut({ id: "nav.forward", group: nav, label: "Forward (browser history)", defaults: ["Alt+ArrowRight"], inInput: false, run: () => { window.history.forward(); } });
  registerShortcut({ id: "nav.voice", group: nav, label: "Go to the connected voice channel", defaults: ["Mod+Alt+A"], run: () => { const id = useVoice.getState().channelId; if (!id) return false; const c = Object.values(useStore.getState().guilds).flatMap((g) => g.channels).find((x) => x.id === id); navigate(`/channels/${c?.guild_id ?? "@me"}/${id}`); } });
  registerShortcut({ id: "read.channel", group: chat, label: "Mark channel as read", defaults: ["Escape"], inInput: true, run: () => (inChannel() ? markCurrentRead() : false) });
  registerShortcut({ id: "read.server", group: chat, label: "Mark server as read", defaults: ["Shift+Escape"], inInput: true, run: () => markServerRead() });
  registerShortcut({ id: "chat.oldestUnread", group: chat, label: "Jump to oldest unread message", defaults: ["Shift+PageUp"], inInput: true, run: () => { const el = document.querySelector(".new-div"); if (!el) return false; el.scrollIntoView({ block: "center" }); } });
  registerShortcut({ id: "chat.inbox", group: chat, label: "Open the inbox (mentions and unreads)", defaults: ["Mod+I"], run: () => uiEvent("syndo:inbox") });
  registerShortcut({ id: "chat.pins", group: chat, label: "Toggle pinned messages", defaults: ["Mod+P"], run: () => (inChannel() ? uiEvent("syndo:panel", "pins") : false) });
  registerShortcut({ id: "chat.members", group: chat, label: "Toggle member list", defaults: ["Mod+U"], run: () => (inChannel() ? uiEvent("syndo:panel", "members") : false) });
  registerShortcut({ id: "chat.search", group: chat, label: "Search", defaults: ["Mod+F"], run: () => (inChannel() ? uiEvent("syndo:panel", "search") : false) });
  registerShortcut({ id: "chat.emoji", group: chat, label: "Toggle emoji picker", defaults: ["Mod+E"], run: () => (inChannel() ? uiEvent("syndo:composer", "emoji") : false) });
  registerShortcut({ id: "chat.upload", group: chat, label: "Upload a file", defaults: ["Mod+Shift+U"], run: () => (inChannel() ? uiEvent("syndo:composer", "upload") : false) });
  registerShortcut({ id: "chat.focus", group: chat, label: "Focus the message box", defaults: [], inInput: false, note: "Unbound by default: Tab is kept for keyboard navigation and the skip link. Typing any character already starts a message.", run: () => { const t = document.querySelector<HTMLTextAreaElement>(".composer textarea"); if (!t || (document.activeElement && document.activeElement !== document.body && document.activeElement.id !== "main")) return false; t.focus(); } });
  registerShortcut({ id: "app.createServer", group: app, label: "Create or join a server", defaults: ["Mod+Shift+N"], browserReserved: true, run: () => uiEvent("syndo:dialog", { kind: "createServer" }) });
  registerShortcut({ id: "app.createGroup", group: app, label: "Create a group DM", defaults: ["Mod+Shift+T"], browserReserved: true, run: () => uiEvent("syndo:dialog", { kind: "groupDm" }) });
  registerShortcut({ id: "voice.mute", group: voice, label: "Toggle mute", defaults: ["Mod+Shift+M"], whileLayers: true, run: () => { setMuted(!useVoice.getState().muted); } });
  registerShortcut({ id: "voice.deafen", group: voice, label: "Toggle deafen", defaults: ["Mod+Shift+D"], whileLayers: true, run: () => { setDeafened(!useVoice.getState().deafened); } });
  registerShortcut({ id: "call.start", group: voice, label: "Start a call in this DM", defaults: ["Mod+["], run: () => {
    const r = route(); if (r.guild !== "@me" || !r.channel || r.channel === "saved") return false;
    api.post(`/api/channels/${r.channel}/call`).then(() => joinVoice(r.channel)).catch((e) => toast(errMsg(e), "error"));
  } });
  registerShortcut({ id: "call.answer", group: voice, label: "Answer incoming call", defaults: ["Mod+Enter"], inInput: true, situational: true, whileLayers: true, note: "Only while a call is ringing", run: () => { const c = ringingHere(); if (!c) return false; joinVoice(c.channel_id); } });
  registerShortcut({ id: "call.decline", group: voice, label: "Decline incoming call", defaults: ["Escape"], inInput: true, situational: true, note: "Only while a call is ringing", run: () => { const c = ringingHere(); if (!c || useVoice.getState().channelId === c.channel_id) return false; api.post(`/api/channels/${c.channel_id}/call/decline`).catch(() => {}); } });
}
