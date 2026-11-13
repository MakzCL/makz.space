import { askConfirm, askText } from "./overlay.tsx";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronDown, Hash, Headphones, HeadphoneOff, Megaphone, Mic, MicOff, Plus, Settings, Users, Volume2, Lock, MessageSquare,
  Compass, FolderPlus, UserPlus, LogOut, PhoneOff, Phone, Monitor, Video, Signal, Image, Radio, Bookmark,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, openContextMenu, type MenuItem } from "./overlay.tsx";
import { AudioLines, ChevronRight, FolderOpen, Search } from "lucide-react";
import { contextMenuKey } from "./callMenus.tsx";
import { isPhone } from "../mobile.ts";
import { guildMenuItems, channelMenuItems, dmMenuItems, userMenuItems } from "./menus.tsx";
import { BRAND, ChannelType, P, has, isVoiceType, type Channel, type Guild } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { updateSettings } from "../actions.ts";
import { gwSend } from "../gateway.ts";
import { navigate, useRoute } from "../router.ts";
import { can, channelTree, displayName, dmTitle, guildPerms, isUnread, toast, useStore } from "../store.ts";
import { joinVoice, leaveVoice, setDeafened, setMuted, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { suppressionFor } from "../voice/settings.ts";
import { ChannelView } from "./ChannelView.tsx";
import { CreateChannel, CreateServer, InviteDialog, NewGroupDm, ProfileCard } from "./Dialogs.tsx";
import { Friends } from "./Friends.tsx";
import { SavedMessages } from "./SavedMessages.tsx";
import { ServerSettings } from "./ServerSettings.tsx";
import { UserSettings } from "./UserSettings.tsx";
import { Avatar, Mark, statusLabel } from "./ui.tsx";
import { VoiceStage } from "./VoiceStage.tsx";
import { Backdrop, useActiveBackground } from "../appearance/Backdrop.tsx";
import { useSoundboardActivity } from "../expressions.ts";
import { ChannelGlyph } from "./ChannelGlyph.tsx";
import { EmojiPicker } from "./ChannelView.tsx";
import { openStudio } from "../appearance/Studio.tsx";
import { usePhone } from "../mobile.ts";
import { MobileMessages, MobileUserCard, MobileYou } from "../mobile/MobileHome.tsx";
import { setContext, updateGlobal, useAppearance } from "../appearance/store.ts";
import { Palette, PanelLeftOpen, Link as LinkIcon, Bell, CalendarDays, Sparkles, Inbox as InboxIcon } from "lucide-react";
import { ForumView, SidebarThreads, useActiveThreads } from "../features/Threads.tsx";
import { openServerNotifications } from "../features/Notifications.tsx";
import { EventsButton, openEvents } from "../features/Events.tsx";
import { Discovery } from "../features/Discovery.tsx";
import { openBoostServer, ServerBoostBar } from "../features/Boosts.tsx";
import { InboxHost } from "../features/Inbox.tsx";
import { OnboardingGate } from "../features/Onboarding.tsx";
import { isMutedScope } from "../store.ts";

/** Arrow keys move focus between server icons in the rail/bar (works vertically, horizontally and in columns). */
function railArrows(e: React.KeyboardEvent<HTMLElement>) {
  if (e.altKey || e.ctrlKey || e.metaKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".rail-item > button")];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : i + (e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1);
  items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
}

export type Dialog = null | { kind: "createServer" } | { kind: "invite"; guildId: string; channelId?: string } | { kind: "createChannel"; guildId: string; parentId?: string | null; type?: number }
  | { kind: "groupDm" } | { kind: "userSettings"; tab?: string } | { kind: "serverSettings"; guildId: string; tab?: string };

export function Shell() {
  const route = useRoute();
  const guilds = useStore((s) => s.guilds);
  const conn = useStore((s) => s.conn);
  const [dialog, setDialog] = useState<Dialog>(null);
  // Phones: the channel list and the conversation are two screens. Start on the list when no conversation is open.
  const [navOpen, setNavOpen] = useState(() => isPhone() && !route.params.channel);
  const autoRoute = useRef(false);
  const gid = route.params.guild ?? "@me";
  const guild = gid !== "@me" ? guilds[gid] : null;
  const cid = route.params.channel || (guild ? defaultChannel(guild) : "");
  const viewingSaved = gid === "@me" && cid === "saved";
  const viewingDiscover = gid === "@me" && cid === "discover";
  const forum = useStore((s) => { const c = guild?.channels.find((x) => x.id === cid); return c && (c.type === ChannelType.FORUM || c.type === ChannelType.MEDIA) ? c : null; });

  useEffect(() => {
    if (gid !== "@me" && !guild && conn === "ready") navigate("/channels/@me", true);
    else if (guild && !route.params.channel && cid) { autoRoute.current = true; navigate(`/channels/${guild.id}/${cid}`, true); }
  }, [gid, guild, cid, route.params.channel, conn]);
  // Switching server keeps the channel list open (pick a channel next); opening a conversation from anywhere closes it.
  const prevRoute = useRef({ gid, cid });
  useEffect(() => {
    const prev = prevRoute.current; prevRoute.current = { gid, cid };
    if (autoRoute.current) { autoRoute.current = false; return; }
    if (prev.gid === gid && prev.cid !== cid) setNavOpen(false);
  }, [cid, gid]);
  useEffect(() => {
    const on = (e: Event) => { const open = (e as CustomEvent).detail?.open; setNavOpen((v) => (open === undefined ? !v : !!open)); };
    window.addEventListener("send:nav", on); return () => window.removeEventListener("send:nav", on);
  }, []);
  useEffect(() => {
    const open = (e: Event) => setDialog((e as CustomEvent).detail);
    window.addEventListener("send:dialog", open);
    return () => window.removeEventListener("send:dialog", open);
  }, []);

  const voiceChannel = useVoice((s) => s.channelId);
  const viewingVoice = guild && guild.channels.find((c) => c.id === cid && isVoiceType(c.type));
  // Appearance follows the route: server and channel/conversation scopes apply immediately on navigation.
  useEffect(() => { setContext(guild?.id ?? null, viewingSaved ? null : cid || null); }, [guild?.id, cid, viewingSaved]);
  const { bg, target } = useActiveBackground();
  const showSidebar = useAppearance((s) => s.resolved.theme.layout.showSidebar);
  // Phones: the wallpaper runs behind every screen (lists, chat, settings, sheets), not just the chat.
  useEffect(() => { const h = document.documentElement; if (bg) h.dataset.wallpaper = "1"; else delete h.dataset.wallpaper; return () => { delete h.dataset.wallpaper; }; }, [!!bg]);

  return (
    <div className={`shell send-css ${navOpen ? "nav-open" : ""} ${showSidebar ? "" : "no-sidebar"}`} data-region="app">
      {bg && <Backdrop bg={bg} className={`app-bd ${target === "app" ? "" : "phone-only"}`} />}
      <a className="skip" href="#main">Skip to content</a>
      {conn === "reconnecting" && <div className="conn-banner" role="status">Reconnecting… messages will catch up automatically.</div>}
      <GuildRail current={gid} onDialog={setDialog} />
      {navOpen && <div className="nav-scrim" aria-hidden onClick={() => setNavOpen(false)} />}
      <nav className="sidebar" data-region={guild ? "sidebar" : "dmSidebar"} aria-label={guild ? `${guild.name} channels` : "Direct messages"}
        onClickCapture={(e) => { if ((e.target as HTMLElement).closest(".side-ch, .side-dm, .side-link")) setNavOpen(false); }}>
        {guild ? <GuildSidebar guild={guild} current={cid} onDialog={setDialog} /> : <DmSidebar current={cid} onDialog={setDialog} />}
        {voiceChannel && <VoiceBar />}
        <UserPanel onDialog={setDialog} />
      </nav>
      {!showSidebar && (
        // Sidebar hidden by layout: navigation and settings must stay reachable.
        <div className="collapsed-tools">
          <button className="icon-btn" aria-label="Show channel sidebar" title="Show sidebar" onClick={() => updateGlobal((x) => ({ ...x, overrides: { ...x.overrides, layout: { ...(x.overrides.layout ?? {}), showSidebar: true } } }))}><PanelLeftOpen size={18} /></button>
          <button className="icon-btn" aria-label="User settings" onClick={() => setDialog({ kind: "userSettings" })}><Settings size={18} /></button>
        </div>
      )}
      <main id="main" className="main" tabIndex={-1}>
        {guild && <OnboardingGate guild={guild} />}
        {viewingSaved ? <SavedMessages /> : viewingDiscover ? <Discovery /> : forum ? <ForumView key={forum.id} channel={forum} /> : viewingVoice ? <VoiceStage channel={viewingVoice} guild={guild!} />
          : cid ? <ChannelView key={cid} channelId={cid} guildId={guild?.id ?? null} highlight={route.params.message || null} />
            : <Friends onDialog={setDialog} />}
      </main>
      {dialog?.kind === "createServer" && <CreateServer onClose={() => setDialog(null)} />}
      {dialog?.kind === "invite" && <InviteDialog guildId={dialog.guildId} channelId={dialog.channelId} onClose={() => setDialog(null)} />}
      {dialog?.kind === "createChannel" && <CreateChannel guildId={dialog.guildId} parentId={dialog.parentId ?? null} type={dialog.type} onClose={() => setDialog(null)} />}
      {dialog?.kind === "groupDm" && <NewGroupDm onClose={() => setDialog(null)} />}
      {dialog?.kind === "userSettings" && <UserSettings tab={dialog.tab} onClose={() => setDialog(null)} />}
      {dialog?.kind === "serverSettings" && <ServerSettings guildId={dialog.guildId} tab={dialog.tab} onClose={() => setDialog(null)} />}
      <InboxHost />
      <YouHost onDialog={setDialog} />
    </div>
  );
}

function YouHost({ onDialog }: { onDialog: (d: Dialog) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const on = () => setOpen(true); window.addEventListener("send:you", on); return () => window.removeEventListener("send:you", on); }, []);
  return open ? <MobileYou onClose={() => setOpen(false)} onDialog={onDialog} /> : null;
}

export const openDialog = (d: Dialog) => window.dispatchEvent(new CustomEvent("send:dialog", { detail: d }));

function defaultChannel(g: Guild) {
  const last = sessionStorage.getItem(`send.last.${g.id}`);
  if (last && g.channels.some((c) => c.id === last)) return last;
  const { loose, cats } = channelTree(g);
  return [...loose, ...cats.flatMap((c) => c.children)].find((c) => c.type === ChannelType.TEXT || c.type === ChannelType.ANNOUNCEMENT)?.id ?? "";
}

const NO_ORDER: string[] = [];
/* -------------------------------------------------------------- rail -- */
function GuildRail({ current, onDialog }: { current: string; onDialog: (d: Dialog) => void }) {
  const guilds = useStore((s) => s.guilds);
  const order = useStore((s) => (s.me?.settings as any)?.guild_order as string[] | undefined) ?? NO_ORDER;
  const readStates = useStore((s) => s.readStates);
  const dms = useStore((s) => s.dms);
  const sorted = useMemo(() => {
    const ids = Object.keys(guilds);
    return [...order.filter((id) => guilds[id]), ...ids.filter((id) => !order.includes(id))].map((id) => guilds[id]!);
  }, [guilds, order]);
  const [drag, setDrag] = useState<string | null>(null);
  const dmMentions = Object.values(dms).reduce((n, c) => n + (readStates[c.id]?.mention_count ?? 0), 0);
  const move = (from: string, to: string) => {
    const ids = sorted.map((g) => g.id).filter((x) => x !== from);
    ids.splice(ids.indexOf(to), 0, from);
    updateSettings({ guild_order: ids });
  };
  const onKeyMove = (e: React.KeyboardEvent, id: string) => {
    // Ctrl/Cmd+Shift+arrows reorder; Alt+arrows stay free for Discord-style channel navigation even with a server icon focused.
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const ids = sorted.map((g) => g.id); const i = ids.indexOf(id); const j = i + (e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!]; updateSettings({ guild_order: ids });
  };
  const folders = useStore((s) => ((s.me?.settings as any)?.guild_folders ?? NO_ORDER) as { id: string; name: string; color: string | null; guild_ids: string[] }[]);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("send.folders.open") ?? "{}"); } catch { return {}; } });
  const toggleFolder = (id: string) => { const n = { ...openFolders, [id]: !openFolders[id] }; setOpenFolders(n); try { localStorage.setItem("send.folders.open", JSON.stringify(n)); } catch { /* */ } };
  const inFolder = new Map<string, string>(); for (const f of folders) for (const g of f.guild_ids) if (guilds[g]) inFolder.set(g, f.id);
  const renderGuild = (g: Guild) => {
    const mentions = g.channels.reduce((n, c) => n + (readStates[c.id]?.mention_count ?? 0), 0);
    const unread = g.channels.some((c) => c.type !== ChannelType.CATEGORY && !isVoiceType(c.type) && isUnread(c)) && !isMutedScope(g.id);
    return (
      <div key={g.id} className="rail-slot" draggable onDragStart={() => setDrag(g.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag && drag !== g.id) move(drag, g.id); setDrag(null); }} onKeyDown={(e) => onKeyMove(e, g.id)}>
        <RailItem active={current === g.id} unread={unread} badge={mentions} label={g.name + (g.tag ? ` [${g.tag}]` : "")} onClick={() => navigate(`/channels/${g.id}`)} onContextMenu={(e) => openContextMenu(e, [...guildMenuItems(g), { kind: "separator" }, ...folderMenu(g.id, folders)])}>
          {g.icon ? <img src={g.icon} alt="" /> : <span className="rail-initials">{g.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>}
        </RailItem>
      </div>
    );
  };
  const seen = new Set<string>();
  return (
    <nav className="rail" data-region="rail" aria-label="Servers" onKeyDown={railArrows}>
      <RailItem active={current === "@me"} label="Direct messages" badge={dmMentions} onClick={() => navigate("/channels/@me")}><Mark size={30} title={`${BRAND.name} home`} /></RailItem>
      <hr />
      {sorted.map((g) => {
        const fid = inFolder.get(g.id);
        if (!fid) return renderGuild(g);
        if (seen.has(fid)) return null;
        seen.add(fid);
        const f = folders.find((x) => x.id === fid)!;
        const list = f.guild_ids.map((id) => guilds[id]).filter(Boolean) as Guild[];
        const open = !!openFolders[f.id];
        const mentions = list.reduce((n, x) => n + x.channels.reduce((m, c) => m + (readStates[c.id]?.mention_count ?? 0), 0), 0);
        return <div key={f.id} className={`rail-folder ${open ? "open" : ""}`} style={f.color ? { ["--folder" as any]: f.color } : undefined}>
          <RailItem label={`${f.name || "Folder"} (${list.length} servers)`} badge={open ? 0 : mentions} onClick={() => toggleFolder(f.id)} onContextMenu={(e) => openContextMenu(e, folderItems(f, folders))}>
            {open ? <FolderOpen size={22} /> : <span className="folder-mini">{list.slice(0, 4).map((x) => x.icon ? <img key={x.id} src={x.icon} alt="" /> : <i key={x.id}>{x.name[0]}</i>)}</span>}
          </RailItem>
          {open && list.map(renderGuild)}
        </div>;
      })}
      <RailItem label="Add a server" onClick={() => onDialog({ kind: "createServer" })} accent><Plus size={22} /></RailItem>
      <RailItem label="Join with an invite" onClick={async () => { const code = await askText({ title: "Join a server", label: "Invite link or code", placeholder: "https://syndo.makz.space/invite/…", confirmLabel: "Join" }); if (code) navigate(`/invite/${code.trim().split("/").pop()}`); }} accent><LinkIcon size={22} /></RailItem>
      <RailItem label="Explore discoverable servers" active={current === "@me" && location.pathname.endsWith("/discover")} onClick={() => navigate("/channels/@me/discover")} accent><Compass size={22} /></RailItem>
    </nav>
  );
}

type Folder = { id: string; name: string; color: string | null; guild_ids: string[] };
function folderMenu(gid: string, folders: Folder[]): MenuItem[] {
  const strip = (list: Folder[]) => list.map((f) => ({ ...f, guild_ids: f.guild_ids.filter((x) => x !== gid) })).filter((f) => f.guild_ids.length > 0);
  const cur = folders.find((f) => f.guild_ids.includes(gid));
  return [
    { label: "Move to folder", submenu: [
      ...folders.filter((f) => f !== cur).map((f) => ({ label: f.name || "Folder", onSelect: () => updateSettings({ guild_folders: strip(folders).map((x) => (x.id === f.id ? { ...x, guild_ids: [...x.guild_ids, gid] } : x)) }) })),
      { label: "New folder…", onSelect: async () => { const name = await askText({ title: "New folder", label: "Folder name", optional: true }); if (name === null) return; updateSettings({ guild_folders: [...strip(folders), { id: String(Date.now()), name, color: null, guild_ids: [gid] }] }); } },
    ] },
    ...(cur ? [{ label: "Remove from folder", onSelect: () => updateSettings({ guild_folders: strip(folders) }) } as MenuItem] : []),
  ];
}
function folderItems(f: Folder, folders: Folder[]): MenuItem[] {
  const save = (p: Partial<Folder>) => updateSettings({ guild_folders: folders.map((x) => (x.id === f.id ? { ...x, ...p } : x)) });
  return [
    { label: "Rename folder", onSelect: async () => { const name = await askText({ title: "Rename folder", label: "Folder name", initial: f.name, optional: true }); if (name !== null) save({ name }); } },
    { label: "Folder colour", submenu: ["#3D6BFF", "#22CC88", "#FFC93C", "#FF5C5C", "#B05CFF", "#FF8FD1"].map((c) => ({ label: c, checked: f.color === c, onSelect: () => save({ color: c }) })) },
    { label: "Ungroup", danger: true, onSelect: () => updateSettings({ guild_folders: folders.filter((x) => x.id !== f.id) }) },
  ];
}

function RailItem({ active, unread, badge, label, onClick, children, accent, onContextMenu }: { active?: boolean; unread?: boolean; badge?: number; label: string; onClick: () => void; children: React.ReactNode; accent?: boolean; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <div className={`rail-item ${active ? "active" : ""} ${unread ? "unread" : ""} ${accent ? "accent" : ""}`}>
      <span className="pill" aria-hidden />
      <button onClick={onClick} onContextMenu={onContextMenu} aria-label={label + (badge ? `, ${badge} mentions` : unread ? ", unread" : "")} aria-current={active ? "page" : undefined} title={label} data-tip-side="right">{children}</button>
      {!!badge && <span className="badge" aria-hidden>{badge > 99 ? "99+" : badge}</span>}
    </div>
  );
}

/* ------------------------------------------------------- DM sidebar -- */
function DmSidebar(props: { current: string; onDialog: (d: Dialog) => void }) {
  return usePhone() ? <MobileMessages {...props} /> : <DesktopDmSidebar {...props} />;
}
function DesktopDmSidebar({ current, onDialog }: { current: string; onDialog: (d: Dialog) => void }) {
  const dms = useStore((s) => s.dms);
  const readStates = useStore((s) => s.readStates);
  const pending = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 3).length);
  const scopes = useAppearance((s) => s.scopes);
  const list = Object.values(dms).sort((a, b) => (BigInt(b.last_message_id ?? b.id) > BigInt(a.last_message_id ?? a.id) ? 1 : -1));
  // People in a call in each conversation (shown as "In a call" with a phone, like Discord).
  const callers = useStore(useShallow((s) => { const n: Record<string, number> = {}; for (const v of Object.values(s.voice)) if (s.dms[v.channel_id]) n[v.channel_id] = (n[v.channel_id] ?? 0) + 1; return n; }));
  return (
    <>
      <header className="side-h"><span>Direct messages</span></header>
      <div className="side-scroll">
        <button className={`side-link ${!current ? "active" : ""}`} onClick={() => navigate("/channels/@me")}>
          <Users size={20} /> <span>Friends</span>{pending > 0 && <span className="badge inline">{pending}</span>}
        </button>
        <button className="side-link" onClick={() => window.dispatchEvent(new Event("send:inbox"))}><InboxIcon size={20} /><span>Inbox</span></button>
        <button className={`side-link ${current === "saved" ? "active" : ""}`} aria-current={current === "saved" ? "page" : undefined} onClick={() => navigate("/channels/@me/saved")}><Bookmark size={20} /><span>Saved messages</span></button>
        <div className="side-sec"><span>Conversations</span><button className="icon-btn sm" aria-label="New group conversation" title="New group" onClick={() => onDialog({ kind: "groupDm" })}><Plus size={16} /></button></div>
        {list.map((c) => {
          const other = c.type === ChannelType.DM ? c.recipients?.[0] : null;
          const mentions = readStates[c.id]?.mention_count ?? 0;
          return (
            <button key={c.id} className={`side-dm ${current === c.id ? "active" : ""} ${isUnread(c) ? "unread" : ""}`} onClick={() => navigate(`/channels/@me/${c.id}`)} onContextMenu={(e) => openContextMenu(e, dmMenuItems(c))}>
              {other ? <Avatar user={other} size={32} status="" /> : <span className="group-ico"><Users size={18} /></span>}
              <span className="ellipsis">{other ? (scopes[`channel:${c.id}`]?.data.conversation?.label ? <><span className="local-label">{scopes[`channel:${c.id}`]!.data.conversation!.label}</span> <small className="muted">{displayName(other)}</small></> : displayName(other)) : dmTitle(c)}{(callers[c.id] ?? 0) > 0 ? <small className="dm-in-call block">In a call · {callers[c.id]}</small> : c.type === ChannelType.GROUP_DM && <small className="muted block">{(c.recipients?.length ?? 0) + 1} members</small>}</span>
              {(callers[c.id] ?? 0) > 0 && <Phone size={15} className="dm-call-ico" aria-label="Call in progress" />}
              {mentions > 0 && <span className="badge inline">{mentions}</span>}
            </button>
          );
        })}
        {!list.length && <p className="muted small pad">No conversations yet. Add a friend to start one.</p>}
      </div>
    </>
  );
}

/* ---------------------------------------------------- guild sidebar -- */
function GuildSidebar({ guild, current, onDialog }: { guild: Guild; current: string; onDialog: (d: Dialog) => void }) {
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(`send.collapsed.${guild.id}`) ?? "{}"); } catch { return {}; } });
  const perms = guildPerms(guild);
  const { loose, cats } = channelTree(guild);
  useActiveThreads(guild.id);
  const hideMuted = useStore((s) => !!s.notif[guild.id]?.hide_muted);
  const readStatesAll = useStore((s) => s.readStates);
  const visible = (c: Channel) => !hideMuted || c.id === current || !isMutedScope(c.id) || (readStatesAll[c.id]?.mention_count ?? 0) > 0;
  // Drag a channel onto another to move it there (same category or another one).
  const canArrange = has(perms, P.MANAGE_CHANNELS);
  const dropOn = (dragId: string, target: Channel) => {
    const all = [...guild.channels].filter((c) => c.type !== ChannelType.CATEGORY).sort((a, b) => a.position - b.position);
    const moving = all.find((c) => c.id === dragId); if (!moving || moving.id === target.id) return;
    const parent = target.type === ChannelType.CATEGORY ? target.id : target.parent_id;
    const siblings = all.filter((c) => c.parent_id === parent && c.id !== dragId);
    const at = target.type === ChannelType.CATEGORY ? siblings.length : siblings.findIndex((c) => c.id === target.id);
    siblings.splice(Math.max(0, at), 0, moving);
    api.patch(`/api/guilds/${guild.id}/channels`, siblings.map((c, i) => ({ id: c.id, position: i, ...(c.id === dragId ? { parent_id: parent ?? null } : {}) }))).catch((e) => toast(errMsg(e), "error"));
  };
  const drag = canArrange ? { onDragStart: (id: string) => (e: React.DragEvent) => { e.dataTransfer.setData("text/send-channel", id); e.dataTransfer.effectAllowed = "move"; }, onDrop: (c: Channel) => (e: React.DragEvent) => { const id = e.dataTransfer.getData("text/send-channel"); if (id) { e.preventDefault(); dropOn(id, c); } } } : null;
  useEffect(() => { if (current) sessionStorage.setItem(`send.last.${guild.id}`, current); }, [current, guild.id]);
  const toggle = (id: string) => { const n = { ...collapsed, [id]: !collapsed[id] }; setCollapsed(n); try { localStorage.setItem(`send.collapsed.${guild.id}`, JSON.stringify(n)); } catch { /* */ } };
  const leave = async () => {
    if (!(await askConfirm({ title: `Leave ${guild.name}?`, body: "You won't be able to rejoin unless you are re-invited.", confirmLabel: "Leave server", danger: true }))) return;
    try { await api.del(`/api/guilds/${guild.id}/members/@me`); navigate("/channels/@me"); } catch (e) { toast(errMsg(e), "error"); }
  };
  // The tall banner header only when the image really loads — no empty gap for a missing/broken banner.
  const bannerOk = useImageLoads(guild.banner);
  return (
    <>
      <header className={`side-h guild-h ${bannerOk ? "has-banner" : ""}`} style={bannerOk ? { backgroundImage: `url("${guild.banner}")` } : undefined}>
        <button ref={menuBtn} className="guild-menu-btn" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)} onContextMenu={(e) => openContextMenu(e, guildMenuItems(guild))}>
          <span className="ellipsis">{guild.name}</span>{guild.tag && <span className="tag">{guild.tag}</span>}<ChevronDown size={18} />
        </button>
        {menu && (
          <Popover className="menu guild-menu" place="below" label={`${guild.name} options`} anchor={() => menuBtn.current} onClose={() => setMenu(false)} onClick={(e) => { if ((e.target as HTMLElement).closest("[role=menuitem]")) setMenu(false); }}>
            {has(perms, P.CREATE_INVITE) && <button role="menuitem" onClick={() => onDialog({ kind: "invite", guildId: guild.id, channelId: current })}><UserPlus size={16} /> Invite people</button>}
            {(has(perms, P.MANAGE_GUILD) || has(perms, P.MANAGE_ROLES) || has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS) || has(perms, P.VIEW_AUDIT_LOG)) &&
              <button role="menuitem" onClick={() => onDialog({ kind: "serverSettings", guildId: guild.id })}><Settings size={16} /> Server settings</button>}
            <button role="menuitem" onClick={() => openBoostServer(guild)}><Sparkles size={16} /> Server Boost{guild.premium_tier ? ` · Level ${guild.premium_tier}` : ""}</button>
            <button role="menuitem" onClick={() => openServerNotifications(guild)}><Bell size={16} /> Notification settings</button>
            <button role="menuitem" onClick={() => openEvents(guild)}><CalendarDays size={16} /> Events</button>
            {has(perms, P.MANAGE_CHANNELS) && <button role="menuitem" onClick={() => onDialog({ kind: "createChannel", guildId: guild.id })}><Plus size={16} /> Create channel</button>}
            {has(perms, P.MANAGE_CHANNELS) && <button role="menuitem" onClick={() => onDialog({ kind: "createChannel", guildId: guild.id, type: ChannelType.CATEGORY })}><FolderPlus size={16} /> Create category</button>}
            <button role="menuitem" onClick={() => openStudio("profile")}><Users size={16} /> Edit server profile</button>
            <button role="menuitem" onClick={() => openStudio("colors", { kind: "guild", id: guild.id, label: guild.name })}><Palette size={16} /> Edit appearance</button>
            {guild.owner_id !== guild.me.user.id && <button role="menuitem" className="danger" onClick={leave}><LogOut size={16} /> Leave server</button>}
          </Popover>
        )}
      </header>
      {guild.show_boost_bar && <ServerBoostBar guild={guild} />}
      {/* Phones: search and invite under the server name, like Discord's app. */}
      <div className="guild-quick">
        <button className="guild-search" onClick={() => window.dispatchEvent(new Event("send:quickswitcher"))}><Search size={16} aria-hidden /> Search</button>
        {has(perms, P.CREATE_INVITE) && <button className="icon-btn" aria-label="Invite people" title="Invite people" onClick={() => onDialog({ kind: "invite", guildId: guild.id, channelId: current })}><UserPlus size={18} /></button>}
        <button className="icon-btn" aria-label="Events" title="Events" onClick={() => openEvents(guild)}><CalendarDays size={18} /></button>
      </div>
      <div className="side-scroll">
        <EventsButton guild={guild} />
        {loose.filter(visible).map((c) => <ChannelLink key={c.id} c={c} guild={guild} active={current === c.id} current={current} drag={drag} />)}
        {cats.map(({ cat, children }) => (
          <div key={cat.id} className="cat" onDragOver={drag ? (e) => e.preventDefault() : undefined} onDrop={drag ? (e) => { if ((e.target as HTMLElement).closest(".side-ch")) return; drag.onDrop(cat)(e); } : undefined}>
            <div className="side-sec">
              {cat.banner
                ? <button className={`cat-btn cat-banner ${collapsed[cat.id] ? "collapsed" : ""}`} aria-expanded={!collapsed[cat.id]} aria-label={`${cat.name || "Untitled"} category`} title={cat.name || undefined} onClick={() => toggle(cat.id)} onContextMenu={(e) => openContextMenu(e, channelMenuItems(cat, guild))} style={{ backgroundImage: `url("${cat.banner}")` }}><ChevronDown size={12} className={collapsed[cat.id] ? "rot" : ""} aria-hidden />{cat.name && <span className="ellipsis">{cat.name}</span>}</button>
                : <button className="cat-btn" aria-expanded={!collapsed[cat.id]} onClick={() => toggle(cat.id)} onContextMenu={(e) => openContextMenu(e, channelMenuItems(cat, guild))}><ChevronDown size={12} className={collapsed[cat.id] ? "rot" : ""} /> {cat.name}</button>}
              {can(cat, P.MANAGE_CHANNELS) && <button className="icon-btn sm" aria-label={`Create channel in ${cat.name}`} onClick={() => onDialog({ kind: "createChannel", guildId: guild.id, parentId: cat.id })}><Plus size={14} /></button>}
            </div>
            {children.filter((c) => (!collapsed[cat.id] || c.id === current || isUnread(c)) && visible(c)).map((c) => <ChannelLink key={c.id} c={c} guild={guild} active={current === c.id} current={current} drag={drag} />)}
          </div>
        ))}
      </div>
    </>
  );
}


function ChannelLink({ c, guild, active, current, drag }: { c: Channel; guild: Guild; active: boolean; current?: string; drag?: { onDragStart: (id: string) => (e: React.DragEvent) => void; onDrop: (c: Channel) => (e: React.DragEvent) => void } | null }) {
  const chMuted = useStore(() => isMutedScope(c.id) || isMutedScope(guild.id));
  const [profile, setProfile] = useState<{ id: string; el: HTMLElement } | null>(null);
  const participantMenu = (id: string, el: HTMLElement, e: { preventDefault(): void; clientX?: number; clientY?: number }) => {
    const user = useStore.getState().users[id] ?? (id === useStore.getState().me?.id ? useStore.getState().me : null);
    if (user) openContextMenu({ clientX: e.clientX, clientY: e.clientY, preventDefault: () => e.preventDefault(), currentTarget: el }, userMenuItems(user, { guildId: guild.id, onProfile: () => setProfile({ id, el }) }));
  };
  const canManage = can(c, P.MANAGE_CHANNELS);
  const [iconPicker, setIconPicker] = useState<HTMLElement | null>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  // "Change icon" in the channel menu opens the same picker.
  useEffect(() => { const on = (e: Event) => { if ((e as CustomEvent).detail === c.id && iconRef.current) setIconPicker(iconRef.current); }; window.addEventListener("send:channel-icon", on); return () => window.removeEventListener("send:channel-icon", on); }, [c.id]);
  const setIcon = (icon_emoji: string | null) => { setIconPicker(null); api.patch(`/api/channels/${c.id}`, { icon_emoji }).catch((e) => toast(errMsg(e), "error")); };
  const mentions = useStore((s) => s.readStates[c.id]?.mention_count ?? 0);
  const unread = useStore(() => !isVoiceType(c.type) && isUnread(c));
  const voiceUsers = useStore(useShallow((s) => Object.values(s.voice).filter((v) => v.channel_id === c.id)));
  const myVoice = useVoice((v) => v.channelId);
  // Who is talking right now — known for the channel I'm connected to.
  const speaking = useVoice(useShallow((v) => v.channelId !== c.id ? [] : [...Object.values(v.peers).filter((p) => p.speaking).map((p) => p.id), ...(v.localSpeaking ? ["@me"] : [])]));
  const myId = useStore((s) => s.me?.id);
  const users = useStore((s) => s.users);
  const priv = c.permission_overwrites.some((o) => o.target_id === guild.id && (BigInt(o.deny) & P.VIEW_CHANNEL));
  const open = () => {
    navigate(`/channels/${guild.id}/${c.id}`);
    if (isVoiceType(c.type) && useVoice.getState().channelId !== c.id) joinVoice(c.id);
  };
  return (
    <>
      <button className={`side-ch ${active ? "active" : ""} ${unread && !chMuted ? "unread" : ""} ${chMuted ? "muted-ch" : ""}`} onClick={open}
        draggable={!!drag} onDragStart={drag?.onDragStart(c.id)} onDragOver={drag ? (e) => e.preventDefault() : undefined} onDrop={drag?.onDrop(c)} onContextMenu={(e) => openContextMenu(e, channelMenuItems(c, guild))} aria-current={active ? "page" : undefined}
        aria-label={`${c.name}, ${isVoiceType(c.type) ? "voice channel" : "channel"}${unread ? ", unread" : ""}${mentions ? `, ${mentions} mentions` : ""}`}>
        <span ref={iconRef} className={`ch-icon ${canManage ? "editable" : ""}`} title={canManage ? "Change icon" : undefined}
          onClick={canManage ? (e) => { e.stopPropagation(); e.preventDefault(); const el = e.currentTarget; setIconPicker((p) => (p ? null : el)); } : undefined}><ChannelGlyph c={c} /></span>{priv && <Lock size={11} className="lock" aria-hidden />}
        {c.type === ChannelType.VOICE && c.voice_status
          ? <span className="side-ch-text"><span className="ellipsis">{c.name}</span><small className="side-voice-status ellipsis" title={c.voice_status}>{c.voice_status}</small></span>
          : <span className="ellipsis">{c.name}</span>}
        {voiceUsers.length > 0 && <CallTimer since={Math.min(...voiceUsers.map((v) => v.joined_at ?? Date.now()))} />}
        {c.user_limit > 0 && isVoiceType(c.type) && <small className="muted">{voiceUsers.length}/{c.user_limit}</small>}
        {mentions > 0 && <span className="badge inline">{mentions}</span>}
      </button>
      {(c.type === ChannelType.TEXT || c.type === ChannelType.ANNOUNCEMENT || c.type === ChannelType.FORUM) && <SidebarThreads parentId={c.id} current={current ?? ""} />}
      {iconPicker && <EmojiPicker anchor={iconPicker} guildId={guild.id} onPick={(e) => setIcon(e)} onClose={() => setIconPicker(null)} onClear={c.icon_emoji ? () => setIcon(null) : undefined} clearLabel={isVoiceType(c.type) ? "Use the speaker icon" : "Use #"} />}
      {profile && <ProfileCard userId={profile.id} guildId={guild.id} anchor={profile.el} onClose={() => setProfile(null)} />}
      {voiceUsers.length > 0 && (
        <ul className="voice-users" aria-label={`In ${c.name}`}>
          {voiceUsers.map((v) => (
            <li key={v.user_id}>
              <button className="voice-participant" aria-label={`Profile and actions for ${displayName(users[v.user_id])}`} aria-haspopup="menu"
                onClick={e => setProfile({ id: v.user_id, el: e.currentTarget })}
                onContextMenu={e => participantMenu(v.user_id, e.currentTarget, e)}
                onKeyDown={e => contextMenuKey(e, () => participantMenu(v.user_id, e.currentTarget, e))}>
              <span className={`voice-avatar ${speaking.includes(v.user_id === myId ? "@me" : v.user_id) ? "speaking" : ""}`}><Avatar user={users[v.user_id] ?? null} size={24} /></span>
              <span className="ellipsis">{displayName(users[v.user_id])}</span>
              <SoundActivity userId={v.user_id} />
              {v.self_stream && <span className="live">LIVE</span>}
              {v.self_video && <Video size={13} aria-label="camera on" />}
              {(v.self_mute || v.server_mute) && <MicOff size={13} aria-label="muted" />}
              {(v.self_deaf || v.server_deaf) && <HeadphoneOff size={13} aria-label="deafened" />}
              </button>
            </li>
          ))}
          {myVoice === c.id && can(c, P.CREATE_INVITE) && <li>
            <button className="voice-participant voice-invite" onClick={() => openDialog({ kind: "invite", guildId: guild.id, channelId: c.id })}>
              <span className="voice-invite-icon" aria-hidden><UserPlus size={13} /></span><span className="ellipsis">Invite to Voice</span><ChevronRight size={15} className="voice-invite-chev" aria-hidden />
            </button>
          </li>}
        </ul>
      )}
    </>
  );
}

/** How long the call in a voice channel has been going (from the earliest person still in it), like Discord. */
function CallTimer({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!Number.isFinite(since)) return null;
  const s = Math.max(0, Math.floor((now - since) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const text = h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  return <time className="call-timer" aria-label={`Call going for ${text}`}>{text}</time>;
}

function useImageLoads(url: string | null | undefined) {
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    if (!url) { setOk(null); return; }
    let alive = true;
    const img = new window.Image();
    img.onload = () => { if (alive && img.naturalWidth > 1) setOk(url); };
    img.onerror = () => { if (alive) setOk(null); };
    img.src = url;
    return () => { alive = false; };
  }, [url]);
  return !!url && ok === url;
}

/** The emoji of a soundboard sound someone just played, next to their name. */
function SoundActivity({ userId }: { userId: string }) {
  const a = useSoundboardActivity((s) => s[userId]);
  return a ? <span className="sb-activity" title={`Played “${a.name}”`} aria-label={`played ${a.name}`}>{a.emoji || "🔊"}</span> : null;
}

/* -------------------------------------------------------- voice bar -- */
/** Wi-Fi style signal: the arcs light up in turn while connecting, then hold steady green once connected. */
function WifiSignal({ status, label }: { status: string; label: string }) {
  return <span className={`wifi-signal ws-${status}`} role="img" aria-label={label} title={label}>
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      <path className="w3" d="M2.5 9.2a13.5 13.5 0 0 1 19 0" /><path className="w2" d="M5.8 12.6a8.8 8.8 0 0 1 12.4 0" /><path className="w1" d="M9.1 16a4.1 4.1 0 0 1 5.8 0" /><circle className="w0" cx="12" cy="19.2" r="1.6" />
    </svg>
  </span>;
}
function VoiceBar() {
  const v = useVoice();
  const ch = useStore(useShallow((s) => { for (const g of Object.values(s.guilds)) { const c = g.channels.find((x) => x.id === v.channelId); if (c) return { name: c.name, guild: g.name, gid: g.id }; } const d = v.channelId ? s.dms[v.channelId] : null; return d ? { name: dmTitle(d), guild: "Call", gid: "@me" } : null; }));
  const label = { idle: "Disconnected", connecting: "Connecting…", connected: "Voice connected", reconnecting: "Reconnecting…", error: "Connection failed" }[v.status];
  const title = v.status === "error" ? (v.error ?? label) : label;
  // The quick toggle switches AI suppression (Advanced or AI, whichever you used last) on and off.
  const aiNs = v.settings.suppression === "rnnoise" || v.settings.suppression === "deepfilter";
  if (aiNs) { try { localStorage.setItem("send.lastAiNs", v.settings.suppression); } catch { /* */ } }
  const lastAiNs = (): "rnnoise" | "deepfilter" => { try { return localStorage.getItem("send.lastAiNs") === "deepfilter" ? "deepfilter" : "rnnoise"; } catch { return "rnnoise"; } };
  return (
    <section className={`voice-bar vs-${v.status}`} data-region="userPanel" aria-label="Voice connection">
      <div className="vb-top">
        <WifiSignal status={v.status} label={title} />
        <button className="link vb-where" onClick={() => v.channelId && navigate(`/channels/${ch?.gid ?? "@me"}/${v.channelId}`)} title={title}>
          <span className="sr-only">{label}: </span><strong className="ellipsis">{ch ? ch.name : ""}</strong><small className="block muted ellipsis">{ch ? ch.guild : ""}</small>
        </button>
        <button className={`icon-btn vb-ns ${aiNs ? "on" : ""}`} aria-pressed={aiNs}
          onClick={() => void updateVoiceSettings({ ...suppressionFor(aiNs ? "standard" : lastAiNs()), presetId: "custom" })}
          aria-label="AI noise suppression" title={aiNs ? "AI noise suppression is on" : "AI noise suppression is off"}><AudioLines size={18} /></button>
        <button className="icon-btn danger" onClick={() => leaveVoice()} aria-label="Disconnect"><PhoneOff size={18} /></button>
      </div>
      {v.sharing && <div className="sharing-ind" role="status"><Monitor size={14} /> You're sharing your screen</div>}
    </section>
  );
}

/* ------------------------------------------------------- user panel -- */
function UserPanel(props: { onDialog: (d: Dialog) => void }) {
  return usePhone() ? <MobileUserCard /> : <DesktopUserPanel {...props} />;
}
function DesktopUserPanel({ onDialog }: { onDialog: (d: Dialog) => void }) {
  const me = useStore((s) => s.me)!;
  const v = useVoice();
  const [menu, setMenu] = useState(false);
  const meBtn = useRef<HTMLButtonElement>(null);
  const setStatus = (status: string) => { gwSend("status", { status }); api.patch("/api/users/@me", { status }).catch(() => {}); setMenu(false); };
  return (
    <section className="user-panel" data-region="userPanel" aria-label="Your account">
      <button ref={meBtn} className="up-me" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" aria-label={`Set status, currently ${statusLabel(me.status)}`}>
        <Avatar user={me} size={34} status={me.status === "invisible" ? "invisible" : me.status} />
        <span className="ellipsis"><strong>{displayName(me)}</strong><small className="block muted ellipsis">{me.custom_status ? `${me.custom_status.emoji ?? ""} ${me.custom_status.text}`.trim() : statusLabel(me.status)}</small></span>
      </button>
      {menu && (
        <Popover className="menu up" label="Status" anchor={() => meBtn.current} onClose={() => setMenu(false)}>
          {(["online", "idle", "dnd", "invisible"] as const).map((s) => (
            <button key={s} role="menuitemradio" aria-checked={me.status === s} onClick={() => setStatus(s)}><i className={`sdot s-${s}`} /> {statusLabel(s)}</button>
          ))}
          <button role="menuitem" onClick={() => { setMenu(false); openStudio("gallery"); }}><Palette size={14} /> Edit appearance</button>
          <button role="menuitem" onClick={() => { setMenu(false); import("../features/live.tsx").then((m) => m.openCustomStatus()); }}>Set custom status…</button>
        </Popover>
      )}
      <button className={`icon-btn ${v.muted ? "on-danger" : ""}`} aria-pressed={v.muted} aria-label={v.muted ? "Unmute" : "Mute"} onClick={() => setMuted(!v.muted)}>{v.muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
      <button className={`icon-btn ${v.deafened ? "on-danger" : ""}`} aria-pressed={v.deafened} aria-label={v.deafened ? "Undeafen" : "Deafen"} onClick={() => setDeafened(!v.deafened)}>{v.deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</button>
      <button className="icon-btn" aria-label="User settings" onClick={() => onDialog({ kind: "userSettings" })}><Settings size={18} /></button>
    </section>
  );
}
