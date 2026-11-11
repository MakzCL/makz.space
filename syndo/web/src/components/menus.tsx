import { removeChannelBanner, setChannelBanner } from "../expressions.ts";
import { ChannelType, P, has, isVoiceType, type Channel, type Guild, type User } from "@send/shared";
import { audioMenuItems, selfCallMenuItems } from "./callMenus.tsx";
import { useVoice } from "../voice/session.ts";
import { api, errMsg } from "../api.ts";
import { ackChannel, openDm, setConversationMuted, updateSettings } from "../actions.ts";
import { navigate } from "../router.ts";
import { can, displayName, guildPerms, isUnread, toast, useStore } from "../store.ts";
import { openStudio } from "../appearance/Studio.tsx";
import { askConfirm, askText, type MenuItem } from "./overlay.tsx";
import { openDialog } from "./Shell.tsx";

/**
 * Right-click menus. Each item is shown only when the current user's permissions allow it — but the server
 * re-checks every action, so hiding an item is a convenience, never the authorization.
 */
const sep: MenuItem = { kind: "separator" };
const settings = () => (useStore.getState().me?.settings ?? {}) as Record<string, unknown>;
export const developerMode = () => settings().developer_mode === true;
const listOf = (k: string) => { const v = settings()[k]; return Array.isArray(v) ? (v as string[]) : []; };
export async function copy(text: string, what = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(`${what}.`, "success"); } catch { toast("Couldn't access the clipboard.", "error"); }
}
const idItem = (id: string, label: string): MenuItem[] => developerMode() ? [sep, { label, onSelect: () => copy(id, "ID copied") }] : [];

export function markGuildRead(g: Guild) { for (const c of g.channels) if (c.type !== ChannelType.CATEGORY && !isVoiceType(c.type) && isUnread(c)) ackChannel(c); }

export function guildMenuItems(g: Guild): MenuItem[] {
  const perms = guildPerms(g), muted = listOf("muted_guilds").includes(g.id);
  const unread = g.channels.some((c) => c.type !== ChannelType.CATEGORY && !isVoiceType(c.type) && isUnread(c));
  const manage = [P.MANAGE_GUILD, P.MANAGE_ROLES, P.KICK_MEMBERS, P.BAN_MEMBERS, P.VIEW_AUDIT_LOG].some((f) => has(perms, f));
  const owner = g.owner_id === g.me.user.id;
  return [
    { label: "Mark as read", disabled: !unread, onSelect: () => markGuildRead(g) },
    sep,
    ...(has(perms, P.CREATE_INVITE) ? [{ label: "Invite people", onSelect: () => openDialog({ kind: "invite", guildId: g.id }) } as MenuItem] : []),
    sep,
    { label: "Mute server", checked: muted, onSelect: () => updateSettings({ muted_guilds: muted ? listOf("muted_guilds").filter((x) => x !== g.id) : [...listOf("muted_guilds"), g.id] }) },
    { label: "Notification settings", onSelect: () => import("../features/Notifications.tsx").then((m) => m.openServerNotifications(g)) },
    { label: "Events", onSelect: () => import("../features/Events.tsx").then((m) => m.openEvents(g)) },
    { label: "Server Boost", onSelect: () => import("../features/Boosts.tsx").then((m) => m.openBoostServer(g)) },
    sep,
    ...(manage ? [{ label: "Server settings", onSelect: () => openDialog({ kind: "serverSettings", guildId: g.id }) } as MenuItem] : []),
    ...(has(perms, P.MANAGE_CHANNELS) ? [
      { label: "Create channel", onSelect: () => openDialog({ kind: "createChannel", guildId: g.id }) } as MenuItem,
      { label: "Create category", onSelect: () => openDialog({ kind: "createChannel", guildId: g.id, type: ChannelType.CATEGORY }) } as MenuItem,
    ] : []),
    { label: "Edit server profile", onSelect: () => { navigate(`/channels/${g.id}`); openStudio("profile"); } },
    ...(!owner ? [sep, { label: "Leave server", danger: true, onSelect: async () => {
      if (!(await askConfirm({ title: `Leave ${g.name}?`, body: "You won't be able to rejoin unless you are re-invited.", confirmLabel: "Leave server", danger: true }))) return;
      try { await api.del(`/api/guilds/${g.id}/members/@me`); navigate("/channels/@me"); } catch (e) { toast(errMsg(e), "error"); }
    } } as MenuItem] : []),
    ...idItem(g.id, "Copy server ID"),
  ];
}

export function channelMenuItems(c: Channel, g: Guild): MenuItem[] {
  const muted = listOf("muted_channels").includes(c.id);
  const link = `${location.origin}/channels/${g.id}/${c.id}`;
  const textLike = !isVoiceType(c.type) && c.type !== ChannelType.CATEGORY;
  return [
    ...(textLike ? [{ label: "Mark as read", disabled: !isUnread(c), onSelect: () => ackChannel(c) } as MenuItem, sep] : []),
    ...(can(c, P.CREATE_INVITE) && c.type !== ChannelType.CATEGORY ? [{ label: "Invite people", onSelect: () => openDialog({ kind: "invite", guildId: g.id, channelId: c.id }) } as MenuItem] : []),
    ...(c.type !== ChannelType.CATEGORY ? [{ label: "Copy link", onSelect: () => copy(link, "Link copied") } as MenuItem] : []),
    sep,
    ...(textLike ? [{ label: "Mute channel", checked: muted, onSelect: () => setConversationMuted(c.id, !muted).catch((e) => toast(errMsg(e), "error")) } as MenuItem] : []),
    ...(can(c, P.MANAGE_CHANNELS) ? [sep,
      ...(c.type !== ChannelType.CATEGORY ? [{ label: "Change icon", onSelect: () => window.dispatchEvent(new CustomEvent("send:channel-icon", { detail: c.id })) } as MenuItem] : []),
      ...(c.type === ChannelType.CATEGORY ? [{ label: "Create channel", onSelect: () => openDialog({ kind: "createChannel", guildId: g.id, parentId: c.id }) } as MenuItem,
        ...(c.banner !== undefined ? [{ label: c.banner ? "Change banner" : "Add banner", onSelect: () => setChannelBanner(c) } as MenuItem] : []),
        ...(c.banner ? [{ label: "Remove banner", onSelect: () => removeChannelBanner(c) } as MenuItem] : [])] : []),
      { label: c.type === ChannelType.CATEGORY ? "Rename category" : "Rename channel", onSelect: async () => {
        const cat = c.type === ChannelType.CATEGORY;
        const name = await askText({ title: cat ? "Rename category" : "Rename channel", label: cat ? "Name (leave empty to show only the banner)" : "Name", initial: c.name ?? "", optional: cat && !!c.banner });
        if (name !== null && (name || (cat && c.banner))) api.patch(`/api/channels/${c.id}`, { name }).catch((e) => toast(errMsg(e), "error"));
      } } as MenuItem,
      { label: c.type === ChannelType.CATEGORY ? "Delete category" : "Delete channel", danger: true, onSelect: async () => {
        if (!(await askConfirm({ title: `Delete ${c.type === ChannelType.CATEGORY ? "category" : "channel"} ${c.name}?`, body: c.type === ChannelType.CATEGORY ? "Channels inside it are kept and become uncategorised." : "Its messages are deleted for everyone. This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
        api.del(`/api/channels/${c.id}`).catch((e) => toast(errMsg(e), "error"));
      } } as MenuItem] : []),
    ...idItem(c.id, "Copy channel ID"),
  ];
}

export function userMenuItems(u: User, opts: { guildId?: string | null; onProfile?: () => void } = {}): MenuItem[] {
  const s = useStore.getState(), me = s.me!, self = u.id === me.id, rel: number = s.relationships[u.id]?.type ?? 0;
  const g = opts.guildId ? s.guilds[opts.guildId] : null;
  const perms = g ? guildPerms(g) : 0n;
  const relAct = (fn: () => Promise<unknown>) => fn().catch((e) => toast(errMsg(e), "error"));
  const items: MenuItem[] = [
    ...(opts.onProfile ? [{ label: "Profile", onSelect: opts.onProfile } as MenuItem] : []),
    ...(!self && rel !== 2 ? [{ label: "Message", onSelect: () => openDm(u.id) } as MenuItem] : []),
    ...(self ? [{ label: "Edit profile", onSelect: () => openStudio("profile") } as MenuItem] : []),
  ];
  if (!self) {
    items.push(sep);
    if (rel === 0) items.push({ label: "Add friend", onSelect: () => relAct(() => api.post("/api/users/@me/relationships", { username: u.username })) });
    if (rel === 3) items.push({ label: "Accept friend request", onSelect: () => relAct(() => api.put(`/api/users/@me/relationships/${u.id}`, { type: 1 })) });
    if (rel === 4) items.push({ label: "Cancel friend request", onSelect: () => relAct(() => api.del(`/api/users/@me/relationships/${u.id}`)) });
    if (rel === 1) items.push({ label: "Remove friend", danger: true, onSelect: async () => { if (await askConfirm({ title: `Remove ${displayName(u)}?`, body: "You can send a new friend request later.", confirmLabel: "Remove friend", danger: true })) relAct(() => api.del(`/api/users/@me/relationships/${u.id}`)); } });
    items.push(rel === 2
      ? { label: "Unblock", onSelect: () => relAct(() => api.del(`/api/users/@me/relationships/${u.id}`)) }
      : { label: "Block", danger: true, onSelect: async () => { if (await askConfirm({ title: `Block ${displayName(u)}?`, body: "They won't be able to message or call you, and won't be told.", confirmLabel: "Block", danger: true })) relAct(() => api.put(`/api/users/@me/relationships/${u.id}`, { type: 2 })); } });
    if (g && u.id !== g.owner_id && (has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS))) {
      items.push(sep);
      if (has(perms, P.KICK_MEMBERS)) items.push({ label: `Kick ${displayName(u)}`, danger: true, onSelect: async () => {
        if (await askConfirm({ title: `Kick ${displayName(u)}?`, body: "They can rejoin with a new invite.", confirmLabel: "Kick", danger: true })) relAct(() => api.del(`/api/guilds/${g.id}/members/${u.id}`));
      } });
      if (has(perms, P.BAN_MEMBERS)) items.push({ label: `Ban ${displayName(u)}`, danger: true, onSelect: async () => {
        const reason = await askText({ title: `Ban ${displayName(u)}?`, body: "They are removed and can't rejoin. Their messages from the last hour are deleted.", label: "Reason (optional, shown in the audit log)", optional: true, confirmLabel: "Ban", danger: true });
        if (reason !== null) relAct(() => api.put(`/api/guilds/${g.id}/bans/${u.id}`, { reason: reason || undefined, delete_message_seconds: 3600 }));
      } });
    }
  }
  const call = useVoice.getState();
  const inCall = !!call.channelId && (self || !!call.peers[u.id] || s.voice[u.id]?.channel_id === call.channelId);
  if (inCall) items.push(sep, ...(self ? selfCallMenuItems() : audioMenuItems(u.id)));
  items.push(sep, { label: "Copy username", onSelect: () => copy(u.username, "Username copied") }, ...idItem(u.id, "Copy user ID"));
  return items;
}

export function dmMenuItems(c: Channel): MenuItem[] {
  const muted = listOf("muted_channels").includes(c.id);
  const other = c.type === ChannelType.DM ? c.recipients?.[0] : null;
  return [
    { label: "Mark as read", disabled: !isUnread(c), onSelect: () => ackChannel(c) },
    sep,
    { label: "Mute conversation", checked: muted, onSelect: () => setConversationMuted(c.id, !muted).catch((e) => toast(errMsg(e), "error")) },
    ...(other ? [sep, ...userMenuItems(other).filter((i) => !("label" in i) || i.label !== "Message")] : []),
    ...(c.type === ChannelType.GROUP_DM ? [sep, { label: "Leave group", danger: true, onSelect: async () => {
      if (!(await askConfirm({ title: "Leave this group?", body: "You won't get its messages unless someone adds you back.", confirmLabel: "Leave group", danger: true }))) return;
      api.del(`/api/channels/${c.id}`).then(() => navigate("/channels/@me")).catch((e) => toast(errMsg(e), "error"));
    } } as MenuItem] : []),
    ...(c.type === ChannelType.GROUP_DM ? idItem(c.id, "Copy channel ID") : []),
  ];
}
