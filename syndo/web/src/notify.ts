import { BRAND } from "@syndo/shared";
import { plainText } from "./markdown.tsx";
import { navigate } from "./router.ts";
import { channelById, displayName, dmTitle, onEvent, useStore } from "./store.ts";
import { playSound } from "./voice/sounds.ts";
import { isPhone } from "./mobile.ts";
import { pushNotice } from "./components/InAppNotices.tsx";

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

const ping = (mention = false) => playSound(mention ? "mention" : "message");

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
    const prefs = ((s.me.settings as any)?.notifications ?? {}) as { desktop?: boolean; sounds?: boolean; inApp?: boolean; quietStart?: string; quietEnd?: string };
    const muted = ((s.me.settings as any)?.muted_channels ?? []).includes(m.channel_id) || ((s.me.settings as any)?.muted_guilds ?? []).includes(m.guild_id);
    if (muted || s.me.status === "dnd" || quiet(prefs)) return;
    const visible = document.visibilityState === "visible" && document.hasFocus();
    const here = location.pathname.split("/")[3] === m.channel_id;
    if (prefs.sounds !== false && (!visible || (isPhone() && !here))) ping(!isDm);
    // Phones: an in-app banner for DMs and mentions elsewhere (browsers/WebViews can't show system ones here).
    if (isPhone() && document.visibilityState === "visible" && !here && prefs.inApp !== false) {
      const where = isDm ? (ch && ch.type === 3 ? dmTitle(ch) : "Direct message") : `#${ch?.name ?? "channel"} · ${useStore.getState().guilds[m.guild_id]?.name ?? "Server"}`;
      const text = (m.stickers?.length ? "Sent a sticker" : plainText(m.content).slice(0, 140)) || (m.attachments?.length ? "Sent an attachment" : "New message");
      pushNotice({ id: m.id, user: m.author, title: displayName(m.author), where, text, href: `/channels/${m.guild_id ?? "@me"}/${m.channel_id}/${m.id}`, mention: !isDm });
    }
    if (visible || !prefs.desktop || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const title = isDm ? (ch && ch.type === 3 ? `${displayName(m.author)} in ${dmTitle(ch)}` : displayName(m.author)) : `${displayName(m.author)} (#${ch?.name ?? "channel"})`;
    const n = new Notification(title, { body: isDm ? "New private message" : plainText(m.content).slice(0, 200) || "Sent an attachment", icon: BRAND.assets.appIcon192, tag: m.channel_id });
    n.onclick = () => { window.focus(); navigate(`/channels/${m.guild_id ?? "@me"}/${m.channel_id}/${m.id}`); n.close(); };
  });
  onEvent("CALL_UPDATE", (c) => {
    const s = useStore.getState();
    if (!s.me || !c.ringing.includes(s.me.id) || s.me.status === "dnd") return;
    if (document.visibilityState !== "visible" && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(`Incoming call · ${BRAND.name}`, { body: dmTitle(channelById(c.channel_id)!), icon: BRAND.assets.appIcon192, tag: `call-${c.channel_id}`, requireInteraction: true });
      n.onclick = () => { window.focus(); navigate(`/channels/@me/${c.channel_id}`); n.close(); };
    } // (the ringtone itself is played by voice/sounds.ts)
  });
}
