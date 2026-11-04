import { askConfirm, askText } from "./overlay.tsx";
import { useShallow } from "zustand/react/shallow";
import {
  ChevronDown, Hash, Headphones, HeadphoneOff, Megaphone, Mic, MicOff, Plus, Settings, Users, Volume2, Lock, MessageSquare,
  Compass, FolderPlus, UserPlus, LogOut, PhoneOff, Monitor, Video, Signal, Image, Radio, Bookmark,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Popover, openContextMenu } from "./overlay.tsx";
import { isPhone } from "../mobile.ts";
import { guildMenuItems, channelMenuItems, dmMenuItems } from "./menus.tsx";
import { BRAND, ChannelType, P, has, isVoiceType, type Channel, type Guild } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { updateSettings } from "../actions.ts";
import { gwSend } from "../gateway.ts";
import { navigate, useRoute } from "../router.ts";
import { can, channelTree, displayName, dmTitle, guildPerms, isUnread, toast, useStore } from "../store.ts";
import { joinVoice, leaveVoice, setDeafened, setMuted, useVoice } from "../voice/session.ts";
import { ChannelView } from "./ChannelView.tsx";
import { CreateChannel, CreateServer, InviteDialog, NewGroupDm } from "./Dialogs.tsx";
import { Friends } from "./Friends.tsx";
import { SavedMessages } from "./SavedMessages.tsx";
import { ServerSettings } from "./ServerSettings.tsx";
import { UserSettings } from "./UserSettings.tsx";
import { Avatar, Mark, statusLabel } from "./ui.tsx";
import { VoiceStage } from "./VoiceStage.tsx";
import { Backdrop, useActiveBackground } from "../appearance/Backdrop.tsx";
import { openStudio } from "../appearance/Studio.tsx";
import { setContext, updateGlobal, useAppearance } from "../appearance/store.ts";
import { Palette, PanelLeftOpen } from "lucide-react";

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
    window.addEventListener("syndo:nav", on); return () => window.removeEventListener("syndo:nav", on);
  }, []);
  useEffect(() => {
    const open = (e: Event) => setDialog((e as CustomEvent).detail);
    window.addEventListener("syndo:dialog", open);
    return () => window.removeEventListener("syndo:dialog", open);
  }, []);

  const voiceChannel = useVoice((s) => s.channelId);
  const viewingVoice = guild && guild.channels.find((c) => c.id === cid && isVoiceType(c.type));
  // Appearance follows the route: server and channel/conversation scopes apply immediately on navigation.
  useEffect(() => { setContext(guild?.id ?? null, viewingSaved ? null : cid || null); }, [guild?.id, cid, viewingSaved]);
  const { bg, target } = useActiveBackground();
  const showSidebar = useAppearance((s) => s.resolved.theme.layout.showSidebar);

  return (
    <div className={`shell syndo-css ${navOpen ? "nav-open" : ""} ${showSidebar ? "" : "no-sidebar"}`} data-region="app">
      {bg && target === "app" && <Backdrop bg={bg} className="app-bd" />}
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
        {viewingSaved ? <SavedMessages /> : viewingVoice ? <VoiceStage channel={viewingVoice} guild={guild!} />
          : cid ? <ChannelView key={cid} channelId={cid} guildId={guild?.id ?? null} highlight={route.params.message || null} />
            : <Friends onDialog={setDialog} />}
      </main>
      {dialog?.kind === "createServer" && <CreateServer onClose={() => setDialog(null)} />}
      {dialog?.kind === "invite" && <InviteDialog guildId={dialog.guildId} channelId={dialog.channelId} onClose={() => setDialog(null)} />}
      {dialog?.kind === "createChannel" && <CreateChannel guildId={dialog.guildId} parentId={dialog.parentId ?? null} type={dialog.type} onClose={() => setDialog(null)} />}
      {dialog?.kind === "groupDm" && <NewGroupDm onClose={() => setDialog(null)} />}
      {dialog?.kind === "userSettings" && <UserSettings tab={dialog.tab} onClose={() => setDialog(null)} />}
      {dialog?.kind === "serverSettings" && <ServerSettings guildId={dialog.guildId} tab={dialog.tab} onClose={() => setDialog(null)} />}
    </div>
  );
}

export const openDialog = (d: Dialog) => window.dispatchEvent(new CustomEvent("syndo:dialog", { detail: d }));

function defaultChannel(g: Guild) {
  const last = sessionStorage.getItem(`syndo.last.${g.id}`);
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
  return (
    <nav className="rail" data-region="rail" aria-label="Servers" onKeyDown={railArrows}>
      <RailItem active={current === "@me"} label="Direct messages" badge={dmMentions} onClick={() => navigate("/channels/@me")}><Mark size={30} title={`${BRAND.name} home`} /></RailItem>
      <hr />
      {sorted.map((g) => {
        const mentions = g.channels.reduce((n, c) => n + (readStates[c.id]?.mention_count ?? 0), 0);
        const unread = g.channels.some((c) => c.type !== ChannelType.CATEGORY && !isVoiceType(c.type) && isUnread(c));
        return (
          <div key={g.id} className="rail-slot" draggable onDragStart={() => setDrag(g.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag && drag !== g.id) move(drag, g.id); setDrag(null); }} onKeyDown={(e) => onKeyMove(e, g.id)}>
            <RailItem active={current === g.id} unread={unread} badge={mentions} label={g.name + (g.tag ? ` [${g.tag}]` : "")} onClick={() => navigate(`/channels/${g.id}`)} onContextMenu={(e) => openContextMenu(e, guildMenuItems(g))}>
              {g.icon ? <img src={g.icon} alt="" /> : <span className="rail-initials">{g.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>}
            </RailItem>
          </div>
        );
      })}
      <RailItem label="Add a server" onClick={() => onDialog({ kind: "createServer" })} accent><Plus size={22} /></RailItem>
      <RailItem label="Join with an invite" onClick={async () => { const code = await askText({ title: "Join a server", label: "Invite link or code", placeholder: "https://syndo.makz.space/invite/…", confirmLabel: "Join" }); if (code) navigate(`/invite/${code.trim().split("/").pop()}`); }} accent><Compass size={22} /></RailItem>
    </nav>
  );
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
function DmSidebar({ current, onDialog }: { current: string; onDialog: (d: Dialog) => void }) {
  const dms = useStore((s) => s.dms);
  const readStates = useStore((s) => s.readStates);
  const pending = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 3).length);
  const scopes = useAppearance((s) => s.scopes);
  const list = Object.values(dms).sort((a, b) => (BigInt(b.last_message_id ?? b.id) > BigInt(a.last_message_id ?? a.id) ? 1 : -1));
  return (
    <>
      <header className="side-h"><span>Direct messages</span></header>
      <div className="side-scroll">
        <button className={`side-link ${!current ? "active" : ""}`} onClick={() => navigate("/channels/@me")}>
          <Users size={20} /> <span>Friends</span>{pending > 0 && <span className="badge inline">{pending}</span>}
        </button>
        <button className={`side-link ${current === "saved" ? "active" : ""}`} aria-current={current === "saved" ? "page" : undefined} onClick={() => navigate("/channels/@me/saved")}><Bookmark size={20} /><span>Saved messages</span></button>
        <div className="side-sec"><span>Conversations</span><button className="icon-btn sm" aria-label="New group conversation" title="New group" onClick={() => onDialog({ kind: "groupDm" })}><Plus size={16} /></button></div>
        {list.map((c) => {
          const other = c.type === ChannelType.DM ? c.recipients?.[0] : null;
          const mentions = readStates[c.id]?.mention_count ?? 0;
          return (
            <button key={c.id} className={`side-dm ${current === c.id ? "active" : ""} ${isUnread(c) ? "unread" : ""}`} onClick={() => navigate(`/channels/@me/${c.id}`)} onContextMenu={(e) => openContextMenu(e, dmMenuItems(c))}>
              {other ? <Avatar user={other} size={32} status="" /> : <span className="group-ico"><Users size={18} /></span>}
              <span className="ellipsis">{other ? (scopes[`channel:${c.id}`]?.data.conversation?.label ? <><span className="local-label">{scopes[`channel:${c.id}`]!.data.conversation!.label}</span> <small className="muted">{displayName(other)}</small></> : displayName(other)) : dmTitle(c)}{c.type === ChannelType.GROUP_DM && <small className="muted block">{(c.recipients?.length ?? 0) + 1} members</small>}</span>
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(`syndo.collapsed.${guild.id}`) ?? "{}"); } catch { return {}; } });
  const perms = guildPerms(guild);
  const { loose, cats } = channelTree(guild);
  useEffect(() => { if (current) sessionStorage.setItem(`syndo.last.${guild.id}`, current); }, [current, guild.id]);
  const toggle = (id: string) => { const n = { ...collapsed, [id]: !collapsed[id] }; setCollapsed(n); try { localStorage.setItem(`syndo.collapsed.${guild.id}`, JSON.stringify(n)); } catch { /* */ } };
  const leave = async () => {
    if (!(await askConfirm({ title: `Leave ${guild.name}?`, body: "You won't be able to rejoin unless you are re-invited.", confirmLabel: "Leave server", danger: true }))) return;
    try { await api.del(`/api/guilds/${guild.id}/members/@me`); navigate("/channels/@me"); } catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <>
      <header className="side-h guild-h" style={guild.banner ? { backgroundImage: `linear-gradient(transparent, var(--bg1)), url(${guild.banner})` } : undefined}>
        <button ref={menuBtn} className="guild-menu-btn" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)} onContextMenu={(e) => openContextMenu(e, guildMenuItems(guild))}>
          <span className="ellipsis">{guild.name}</span>{guild.tag && <span className="tag">{guild.tag}</span>}<ChevronDown size={18} />
        </button>
        {menu && (
          <Popover className="menu" label={`${guild.name} options`} anchor={() => menuBtn.current} onClose={() => setMenu(false)} onClick={(e) => { if ((e.target as HTMLElement).closest("[role=menuitem]")) setMenu(false); }}>
            {has(perms, P.CREATE_INVITE) && <button role="menuitem" onClick={() => onDialog({ kind: "invite", guildId: guild.id, channelId: current })}><UserPlus size={16} /> Invite people</button>}
            {(has(perms, P.MANAGE_GUILD) || has(perms, P.MANAGE_ROLES) || has(perms, P.KICK_MEMBERS) || has(perms, P.BAN_MEMBERS) || has(perms, P.VIEW_AUDIT_LOG)) &&
              <button role="menuitem" onClick={() => onDialog({ kind: "serverSettings", guildId: guild.id })}><Settings size={16} /> Server settings</button>}
            {has(perms, P.MANAGE_CHANNELS) && <button role="menuitem" onClick={() => onDialog({ kind: "createChannel", guildId: guild.id })}><Plus size={16} /> Create channel</button>}
            {has(perms, P.MANAGE_CHANNELS) && <button role="menuitem" onClick={() => onDialog({ kind: "createChannel", guildId: guild.id, type: ChannelType.CATEGORY })}><FolderPlus size={16} /> Create category</button>}
            <button role="menuitem" onClick={() => openStudio("profile")}><Users size={16} /> Edit server profile</button>
            <button role="menuitem" onClick={() => openStudio("colors", { kind: "guild", id: guild.id, label: guild.name })}><Palette size={16} /> Edit appearance</button>
            {guild.owner_id !== guild.me.user.id && <button role="menuitem" className="danger" onClick={leave}><LogOut size={16} /> Leave server</button>}
          </Popover>
        )}
      </header>
      <div className="side-scroll">
        {loose.map((c) => <ChannelLink key={c.id} c={c} guild={guild} active={current === c.id} />)}
        {cats.map(({ cat, children }) => (
          <div key={cat.id} className="cat">
            <div className="side-sec">
              <button className="cat-btn" aria-expanded={!collapsed[cat.id]} onClick={() => toggle(cat.id)} onContextMenu={(e) => openContextMenu(e, channelMenuItems(cat, guild))}><ChevronDown size={12} className={collapsed[cat.id] ? "rot" : ""} /> {cat.name}</button>
              {can(cat, P.MANAGE_CHANNELS) && <button className="icon-btn sm" aria-label={`Create channel in ${cat.name}`} onClick={() => onDialog({ kind: "createChannel", guildId: guild.id, parentId: cat.id })}><Plus size={14} /></button>}
            </div>
            {children.filter((c) => !collapsed[cat.id] || c.id === current || isUnread(c)).map((c) => <ChannelLink key={c.id} c={c} guild={guild} active={current === c.id} />)}
          </div>
        ))}
      </div>
    </>
  );
}

const CHANNEL_ICON: Record<number, typeof Hash> = { [ChannelType.TEXT]: Hash, [ChannelType.VOICE]: Volume2, [ChannelType.ANNOUNCEMENT]: Megaphone, [ChannelType.STAGE]: Radio, [ChannelType.FORUM]: MessageSquare, [ChannelType.MEDIA]: Image };

function ChannelLink({ c, guild, active }: { c: Channel; guild: Guild; active: boolean }) {
  const Icon = CHANNEL_ICON[c.type] ?? Hash;
  const mentions = useStore((s) => s.readStates[c.id]?.mention_count ?? 0);
  const unread = useStore(() => !isVoiceType(c.type) && isUnread(c));
  const voiceUsers = useStore(useShallow((s) => Object.values(s.voice).filter((v) => v.channel_id === c.id)));
  const users = useStore((s) => s.users);
  const priv = c.permission_overwrites.some((o) => o.target_id === guild.id && (BigInt(o.deny) & P.VIEW_CHANNEL));
  const open = () => {
    navigate(`/channels/${guild.id}/${c.id}`);
    if (isVoiceType(c.type) && useVoice.getState().channelId !== c.id) joinVoice(c.id);
  };
  return (
    <>
      <button className={`side-ch ${active ? "active" : ""} ${unread ? "unread" : ""}`} onClick={open} onContextMenu={(e) => openContextMenu(e, channelMenuItems(c, guild))} aria-current={active ? "page" : undefined}
        aria-label={`${c.name}, ${isVoiceType(c.type) ? "voice channel" : "channel"}${unread ? ", unread" : ""}${mentions ? `, ${mentions} mentions` : ""}`}>
        <Icon size={18} aria-hidden />{priv && <Lock size={11} className="lock" aria-hidden />}
        <span className="ellipsis">{c.name}</span>
        {c.user_limit > 0 && isVoiceType(c.type) && <small className="muted">{voiceUsers.length}/{c.user_limit}</small>}
        {mentions > 0 && <span className="badge inline">{mentions}</span>}
      </button>
      {voiceUsers.length > 0 && (
        <ul className="voice-users" aria-label={`In ${c.name}`}>
          {voiceUsers.map((v) => (
            <li key={v.user_id}>
              <Avatar user={users[v.user_id] ?? null} size={22} />
              <span className="ellipsis">{displayName(users[v.user_id])}</span>
              {v.self_stream && <span className="live">LIVE</span>}
              {v.self_video && <Video size={13} aria-label="camera on" />}
              {(v.self_mute || v.server_mute) && <MicOff size={13} aria-label="muted" />}
              {(v.self_deaf || v.server_deaf) && <HeadphoneOff size={13} aria-label="deafened" />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* -------------------------------------------------------- voice bar -- */
function VoiceBar() {
  const v = useVoice();
  const ch = useStore(useShallow((s) => { for (const g of Object.values(s.guilds)) { const c = g.channels.find((x) => x.id === v.channelId); if (c) return { name: c.name, guild: g.name, gid: g.id }; } const d = v.channelId ? s.dms[v.channelId] : null; return d ? { name: dmTitle(d), guild: "Call", gid: "@me" } : null; }));
  const label = { idle: "Disconnected", connecting: "Connecting…", connected: "Voice connected", reconnecting: "Reconnecting…", error: "Connection failed" }[v.status];
  return (
    <section className={`voice-bar vs-${v.status}`} data-region="userPanel" aria-label="Voice connection">
      <div className="vb-top">
        <Signal size={16} aria-hidden />
        <button className="link" onClick={() => v.channelId && navigate(`/channels/${ch?.gid ?? "@me"}/${v.channelId}`)}>
          <strong>{label}</strong><small className="block muted ellipsis">{ch ? `${ch.name} / ${ch.guild}` : ""}</small>
        </button>
        <button className="icon-btn danger" onClick={() => leaveVoice()} aria-label="Disconnect"><PhoneOff size={18} /></button>
      </div>
      {v.sharing && <div className="sharing-ind" role="status"><Monitor size={14} /> You're sharing your screen</div>}
    </section>
  );
}

/* ------------------------------------------------------- user panel -- */
function UserPanel({ onDialog }: { onDialog: (d: Dialog) => void }) {
  const me = useStore((s) => s.me)!;
  const v = useVoice();
  const [menu, setMenu] = useState(false);
  const meBtn = useRef<HTMLButtonElement>(null);
  const setStatus = (status: string) => { gwSend("status", { status }); api.patch("/api/users/@me", { status }).catch(() => {}); setMenu(false); };
  return (
    <section className="user-panel" data-region="userPanel" aria-label="Your account">
      <button ref={meBtn} className="up-me" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" aria-label={`Set status, currently ${statusLabel(me.status)}`}>
        <Avatar user={me} size={34} status={me.status === "invisible" ? "invisible" : me.status} />
        <span className="ellipsis"><strong>{displayName(me)}</strong><small className="block muted ellipsis">{me.custom_status?.text || statusLabel(me.status)}</small></span>
      </button>
      {menu && (
        <Popover className="menu up" label="Status" anchor={() => meBtn.current} onClose={() => setMenu(false)}>
          {(["online", "idle", "dnd", "invisible"] as const).map((s) => (
            <button key={s} role="menuitemradio" aria-checked={me.status === s} onClick={() => setStatus(s)}><i className={`sdot s-${s}`} /> {statusLabel(s)}</button>
          ))}
          <button role="menuitem" onClick={() => { setMenu(false); openStudio("gallery"); }}><Palette size={14} /> Edit appearance</button>
          <button role="menuitem" onClick={async () => {
            setMenu(false);
            const text = await askText({ title: "Set a custom status", label: "Status", initial: me.custom_status?.text ?? "", optional: true, placeholder: "What's happening?" });
            if (text === null) return;
            await api.patch("/api/users/@me", { custom_status: text ? { text } : null }).catch((e) => toast(errMsg(e), "error"));
          }}>Set custom status…</button>
        </Popover>
      )}
      <button className={`icon-btn ${v.muted ? "on-danger" : ""}`} aria-pressed={v.muted} aria-label={v.muted ? "Unmute" : "Mute"} onClick={() => setMuted(!v.muted)}>{v.muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
      <button className={`icon-btn ${v.deafened ? "on-danger" : ""}`} aria-pressed={v.deafened} aria-label={v.deafened ? "Undeafen" : "Deafen"} onClick={() => setDeafened(!v.deafened)}>{v.deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</button>
      <button className="icon-btn" aria-label="User settings" onClick={() => onDialog({ kind: "userSettings" })}><Settings size={18} /></button>
    </section>
  );
}
