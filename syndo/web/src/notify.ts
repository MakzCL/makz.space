import { BRAND } from "@syndo/shared";
import { plainText } from "./markdown.tsx";
import { navigate } from "./router.ts";
import { channelById, displayName, dmTitle, onEvent, useStore } from "./store.ts";

/**
 * Desktop notifications for mentions and DMs while the tab isn't focused,
 * honouring Do Not Disturb, quiet hours and the user's toggle.
 */
function quiet(n: { quietStart?: string; quietEnd?: string }) {
  if (!n.quietStart || !n.quietEnd) return false;
  const now = new Date(); const cur = now.getHours() * 60 + now.getMinutes();
  const [a, b] = [n.quietStart, n.quietEnd].map((t) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; });
  return a! <= b! ? cur >= a! && cur < b! : cur >= a! || cur < b!;
}

let chime: AudioContext | null = null;
function ping() {
  try {
    chime ??= new AudioContext();
    const o = chime.createOscillator(); const g = chime.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.08, chime.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, chime.currentTime + 0.25);
    o.connect(g).connect(chime.destination); o.start(); o.stop(chime.currentTime + 0.26);
  } catch { /* */ }
}

export function initNotifications() {
  const unread = () => {
    const s = useStore.getState();
    const n = Object.values(s.readStates).reduce((a, r) => a + r.mention_count, 0);
    document.title = (n ? `(${n}) ` : "") + document.title.replace(/^\(\d+\) /, "");
  };
  useStore.subscribe(unread);
  onEvent("MESSAGE_CREATE", (m) => {
    const s = useStore.getState();
    if (!s.me || m.author.id === s.me.id) return;
    const ch = channelById(m.channel_id);
    const isDm = !m.guild_id;
    const mentioned = isDm || m.mentions.includes(s.me.id) || m.mention_everyone || (m.guild_id && m.mention_roles.some((r: string) => s.guilds[m.guild_id]?.me.roles.includes(r)));
    if (!mentioned) return;
    const prefs = ((s.me.settings as any)?.notifications ?? {}) as { desktop?: boolean; sounds?: boolean; quietStart?: string; quietEnd?: string };
    const muted = ((s.me.settings as any)?.muted_channels ?? []).includes(m.channel_id) || ((s.me.settings as any)?.muted_guilds ?? []).includes(m.guild_id);
    if (muted || s.me.status === "dnd" || quiet(prefs)) return;
    const visible = document.visibilityState === "visible" && document.hasFocus();
    if (prefs.sounds !== false && !visible) ping();
    if (visible || !prefs.desktop || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const title = isDm ? (ch && ch.type === 3 ? `${displayName(m.author)} in ${dmTitle(ch)}` : displayName(m.author)) : `${displayName(m.author)} (#${ch?.name ?? "channel"})`;
    const n = new Notification(title, { body: plainText(m.content).slice(0, 200) || "Sent an attachment", icon: BRAND.assets.appIcon192, tag: m.channel_id });
    n.onclick = () => { window.focus(); navigate(`/channels/${m.guild_id ?? "@me"}/${m.channel_id}/${m.id}`); n.close(); };
  });
  onEvent("CALL_UPDATE", (c) => {
    const s = useStore.getState();
    if (!s.me || !c.ringing.includes(s.me.id) || s.me.status === "dnd") return;
    if (document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(`Incoming call · ${BRAND.name}`, { body: dmTitle(channelById(c.channel_id)!), icon: BRAND.assets.appIcon192, tag: `call-${c.channel_id}`, requireInteraction: true });
      n.onclick = () => { window.focus(); navigate(`/channels/@me/${c.channel_id}`); n.close(); };
    } else ping();
  });
}
