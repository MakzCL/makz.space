import { createPortal } from "react-dom";
import { askConfirm, askText } from "./overlay.tsx";
import { Select } from "./Select.tsx";
import { useShallow } from "zustand/react/shallow";
import { MoreHorizontal,
  AtSign, Bookmark, BookmarkCheck, Copy, CornerUpLeft, File as FileIcon, Hash, Link2, Paperclip, Pencil, Plus, Phone, Pin, PinOff,
  Search, SendHorizontal, SmilePlus, Trash2, Users, Video, X, RotateCcw, Megaphone, Volume2, UserPlus, Mic, Square, Bell, BellOff,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChannelType, MessageType, P, boostPerks, has, type Channel, type Message, type Sticker } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { ackChannel, discardFailed, loadMembers, loadMessages, openDm, sendMessage, sendTyping, setConversationMuted, startUpload, toggleReaction, type PendingUpload } from "../actions.ts";
import { CustomEmoji, Markdown, plainText } from "../markdown.tsx";
import { AttachSheet, CameraCapture } from "./AttachSheet.tsx";
import { VoiceStage } from "./VoiceStage.tsx";
import { Maximize2, Minimize2 } from "lucide-react";
import { ChannelGlyph } from "./ChannelGlyph.tsx";
import { messageLink, navigate, setTitle } from "../router.ts";
import { can, channelById, displayName, dmTitle, memberName, toast, useStore, type UIMessage } from "../store.ts";
import { joinVoice, useVoice } from "../voice/session.ts";
import { primeCallAudio } from "../voice/cloudflare.ts";
import { openDialog } from "./Shell.tsx";
import { Avatar, fmtBytes, fmtTime, MobileNavButton } from "./ui.tsx";
import { MoreVertical, ChevronRight } from "lucide-react";
import { ProfileCard } from "./Dialogs.tsx";
import { LayerBox, openContextMenu, openMediaViewer, type MediaItem, type MenuItem } from "./overlay.tsx";
import { copy, developerMode, userMenuItems } from "./menus.tsx";
import { useLayer } from "../layers.ts";
import { isPhone } from "../mobile.ts";
import { createContext, useContext } from "react";
import { create } from "zustand";
import { Smile, Sticker as StickerIcon } from "lucide-react";
import { ChannelType as CT } from "@syndo/shared";
import { Palette } from "lucide-react";
import { Backdrop, useActiveBackground } from "../appearance/Backdrop.tsx";
import { customReaction, emojiText, myEmojis, myStickers, reactionKey } from "../expressions.ts";
import { ThirdPartyEmote, emoteGroups, emoteToken, emoteUrl, loadEmotes, parseEmoteToken, useEmotes } from "../features/Emotes.tsx";
import { ConversationPanel } from "../appearance/ConversationPanel.tsx";
import { StyledName, useCosmetics } from "../appearance/effects.tsx";
import { scopeKey, useAppearance } from "../appearance/store.ts";
import { useMentionAutocomplete } from "./MentionAutocomplete.tsx";
import { Components, Embeds, InteractionLine, PollView, Snapshot, SourceTag, ThreadChip, extraSystemText, useGridClass } from "../features/MessageExtras.tsx";
import { forwardMessage, openCreateThread, openPollComposer, ThreadsPanel, ThreadHeader } from "../features/Threads.tsx";
import { ComposerExtras, useSlashCommands } from "../features/Commands.tsx";
import { ChannelBell } from "../features/Notifications.tsx";
import { FollowButton } from "../features/Stage.tsx";
import { isThreadType } from "../store.ts";
import { MessageSquare, CornerUpRight, Send as SendIcon, ArrowDown } from "lucide-react";

/** Which message is being edited (one at a time, like Discord); lets ↑ in the composer start editing. */
const useEditing = create<{ id: string | null }>(() => ({ id: null }));
const NO_SETTINGS = {};
const QUICK = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "🌻", "✨", "👀", "🔥", "💙"];

export function ChannelView({ channelId, guildId, highlight }: { channelId: string; guildId: string | null; highlight: string | null }) {
  const channel = useStore(() => channelById(channelId));
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : null));
  const data = useStore((s) => s.messages[channelId]);
  const showMembersDefault = useAppearance((s) => s.resolved.theme.layout.showMembers);
  const [panel, setPanel] = useState<null | "members" | "pins" | "search" | "appearance" | "threads">(guildId && showMembersDefault && !isPhone() ? "members" : null); // phones: the list is a full-screen page, opened on demand
  const label = useAppearance((s) => s.scopes[scopeKey("channel", channelId)]?.data.conversation?.label ?? null);
  const { bg, target } = useActiveBackground();
  const [reply, setReply] = useState<Message | null>(null);
  const [profile, setProfile] = useState<{ id: string; el: HTMLElement } | null>(null);
  const call = useStore((s) => s.calls[channelId]);
  const inVoiceHere = useVoice((s) => s.channelId === channelId);
  const muted = useStore((s) => { const ids = s.me?.settings?.muted_channels; return Array.isArray(ids) && ids.includes(channelId); });
  const [muteBusy, setMuteBusy] = useState(false);
  const title = channel ? (channel.guild_id ? `#${channel.name}` : dmTitle(channel)) : "";

  useEffect(() => { setTitle(channel ? (guild ? `${channel.name} · ${guild.name}` : dmTitle(channel)) : undefined); }, [channel, guild]);
  useEffect(() => { if (highlight) loadMessages(channelId, { around: highlight }); else if (!data?.loaded) loadMessages(channelId); }, [channelId, highlight]); // eslint-disable-line
  useEffect(() => { if (guildId && !useStore.getState().members[guildId]) loadMembers(guildId); }, [guildId]);
  // Ctrl/⌘+P, +U, +F from the shortcut registry toggle the same panels as the header buttons.
  useEffect(() => {
    const on = (e: Event) => {
      const want = (e as CustomEvent).detail as "pins" | "members" | "search" | "threads";
      if (want === "members" && !(guildId || channel?.type === ChannelType.GROUP_DM)) return;
      setPanel((p) => (p === want && want !== "search" ? null : want));
      if (want === "search") requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".side-panel[role=search] input")?.focus());
    };
    window.addEventListener("syndo:panel", on); return () => window.removeEventListener("syndo:panel", on);
  }, [guildId, channel?.type]);
  useEffect(() => {
    if (!channel) return;
    const ack = () => { if (document.visibilityState === "visible" && document.hasFocus()) ackChannel(channel); };
    ack();
    window.addEventListener("focus", ack);
    return () => window.removeEventListener("focus", ack);
  }, [channel?.last_message_id]); // eslint-disable-line

  if (!channel) return <div className="empty-state"><h2>This channel doesn't exist or you can't see it.</h2><button className="btn" onClick={() => navigate("/channels/@me")}>Go home</button></div>;
  const isDm = !channel.guild_id;
  const Icon = channel.type === ChannelType.ANNOUNCEMENT ? Megaphone : channel.type === ChannelType.VOICE ? Volume2 : Hash;
  const startCall = async (video: boolean) => {
    primeCallAudio(); // inside the tap, before any network wait
    try {
      await api.post(`/api/channels/${channel.id}/call`);
      await joinVoice(channel.id);
      if (video) (await import("../voice/session.ts")).toggleCamera();
    } catch (e) { toast(errMsg(e), "error"); }
  };
  const mdCtx = { guildId, onMention: (id: string, el: HTMLElement) => setProfile((p) => (p && p.el === el ? null : { id, el })), onChannel: (id: string) => { const c = channelById(id); if (c) navigate(`/channels/${c.guild_id ?? "@me"}/${id}`); } };

  return (
    <div className="channel">
      <header className="ch-h" data-region="header">
        <MobileNavButton />
        {isDm && channel.type === ChannelType.DM ? <Avatar user={channel.recipients?.[0]} size={26} status="" /> : <ChannelGlyph c={channel} size={22} className="muted" />}
        <div className="ch-title" onClick={() => { if (isPhone() && (guildId || channel.type === ChannelType.GROUP_DM)) setPanel(panel === "members" ? null : "members"); }}>
        <h1 className="ellipsis">{isDm ? (label && channel.type === ChannelType.DM ? <><span className="local-label" title="Your private label — only you see it">{label}</span> <span className="muted small">{dmTitle(channel)}</span></> : dmTitle(channel)) : channel.name}</h1>
        {guildId && <OnlineCount guildId={guildId} />}
        </div>
        {isThreadType(channel.type) && <ThreadHeader channel={channel} />}
        {channel.topic && <span className="topic ellipsis" title={channel.topic}>{channel.topic}</span>}
        <div className="ch-actions">
          {channel.type === ChannelType.ANNOUNCEMENT && <FollowButton channel={channel} />}
          {(channel.type === ChannelType.TEXT || channel.type === ChannelType.ANNOUNCEMENT) && <button className={`icon-btn d-only ${panel === "threads" ? "active" : ""}`} aria-pressed={panel === "threads"} aria-label="Threads" title="Threads" onClick={() => setPanel(panel === "threads" ? null : "threads")}><MessageSquare size={20} /></button>}
          {!isDm && <span className="d-only"><ChannelBell channel={channel} /></span>}
          <button className={`icon-btn d-only ${muted ? "active" : ""} ${isDm ? "" : "hidden"}`} disabled={muteBusy} aria-pressed={muted} aria-label={muted ? "Unmute conversation" : "Mute conversation"} title={muted ? "Unmute notifications" : "Mute notifications"} onClick={async () => {
            setMuteBusy(true);
            try { await setConversationMuted(channelId, !muted); toast(muted ? "Notifications unmuted." : "Conversation muted. You can still read and send messages.", "success"); }
            catch (e) { toast(errMsg(e), "error"); }
            finally { setMuteBusy(false); }
          }}>{muted ? <BellOff size={20} /> : <Bell size={20} />}</button>
          {isDm && <button className="icon-btn" aria-label="Start voice call" title="Voice call" onClick={() => startCall(false)}><Phone size={20} /></button>}
          {isDm && <button className="icon-btn" aria-label="Start video call" title="Video call" onClick={() => startCall(true)}><Video size={20} /></button>}
          {isDm && channel.type === ChannelType.GROUP_DM && <button className="icon-btn" aria-label="Add friends" onClick={() => openDialog({ kind: "groupDm" })}><UserPlus size={20} /></button>}
          <button className={`icon-btn d-only ${panel === "pins" ? "active" : ""}`} aria-pressed={panel === "pins"} aria-label="Pinned messages" onClick={() => setPanel(panel === "pins" ? null : "pins")}><Pin size={20} /></button>
          {(guildId || channel.type === ChannelType.GROUP_DM) && <button className={`icon-btn d-only ${panel === "members" ? "active" : ""}`} aria-pressed={panel === "members"} aria-label="Member list" onClick={() => setPanel(panel === "members" ? null : "members")}><Users size={20} /></button>}
          <button className={`icon-btn ${panel === "search" ? "active" : ""}`} aria-pressed={panel === "search"} aria-label="Search" onClick={() => setPanel(panel === "search" ? null : "search")}><Search size={20} /></button>
          <button className={`icon-btn d-only ${panel === "appearance" ? "active" : ""}`} aria-pressed={panel === "appearance"} aria-label="Edit appearance for this conversation" title="Edit appearance" onClick={() => setPanel(panel === "appearance" ? null : "appearance")}><Palette size={20} /></button>
          <button className="icon-btn m-only" aria-label="More options" onClick={(e) => openContextMenu({ clientX: 1, clientY: 1, preventDefault: () => e.preventDefault() }, [
            ...(guildId || channel.type === ChannelType.GROUP_DM ? [{ label: "Members", onSelect: () => setPanel("members") }] : []),
            ...(channel.type === ChannelType.TEXT || channel.type === ChannelType.ANNOUNCEMENT ? [{ label: "Threads", onSelect: () => setPanel("threads") }] : []),
            { label: "Pinned messages", onSelect: () => setPanel("pins") },
            ...(guild ? [{ label: "Notification settings", onSelect: () => { void import("../features/Notifications.tsx").then((m) => m.openServerNotifications(guild)); } }] : []),
            { label: muted ? "Unmute notifications" : "Mute notifications", onSelect: () => setConversationMuted(channelId, !muted).catch((x) => toast(errMsg(x), "error")) },
            { label: "Conversation appearance", onSelect: () => setPanel("appearance") },
          ])}><MoreVertical size={20} /></button>
        </div>
      </header>
      {call && call.ringing.length > 0 && !inVoiceHere && (
        <div className="call-banner" role="alert">
          <Phone size={18} /> <span>{call.ringing.includes(useStore.getState().me!.id) ? "Incoming call" : "Ringing…"}</span>
          <button className="btn primary sm" onClick={() => joinVoice(channel.id)}>Join</button>
          <button className="btn danger sm" onClick={() => api.post(`/api/channels/${channel.id}/call/decline`)}>Decline</button>
        </div>
      )}
      {isDm && <DmCall channel={channel} />}
      <div className="ch-body">
        <div className="ch-main" data-region="chat">
          {bg && target === "chat" && <Backdrop bg={bg} className="chat-bd" />}
        <MessageList channel={channel} data={data} highlight={highlight} onReply={setReply} mdCtx={mdCtx} />
          <Typing channelId={channel.id} guildId={guildId} />
          <Composer channel={channel} title={title} reply={reply} onClearReply={() => setReply(null)} />
        </div>
        {panel === "members" && (guildId ? <MemberList guildId={guildId} channel={channel} onClose={() => setPanel(null)} onProfile={(id, el) => setProfile((p) => (p && p.el === el ? null : { id, el }))} /> : <Recipients channel={channel} onClose={() => setPanel(null)} />)}
        {panel === "pins" && <Pins channel={channel} mdCtx={mdCtx} onClose={() => setPanel(null)} />}
        {panel === "threads" && <ThreadsPanel channel={channel} onClose={() => setPanel(null)} />}
        {panel === "appearance" && <ConversationPanel channel={channel} onClose={() => setPanel(null)} />}
        {panel === "search" && <SearchPanel channel={channel} guildId={guildId} mdCtx={mdCtx} onClose={() => setPanel(null)} />}
      </div>
      {profile && <ProfileCard userId={profile.id} guildId={guildId} anchor={profile.el} onClose={() => setProfile(null)} />}
    </div>
  );
}

/** "5 Online" under the channel name on phones, like Discord. */
function OnlineCount({ guildId }: { guildId: string }) {
  const n = useStore((s) => { const m = s.members[guildId]; if (!m) return -1; let c = 0; for (const id in m) { const p = s.presences[id]; if (p && p !== "offline" && p !== "invisible") c++; } return c; });
  if (n < 0) return null;
  return <small className="ch-sub m-only"><i className="dot-online" aria-hidden />{n} Online <ChevronRight size={12} aria-hidden /></small>;
}

/** The text chat beside a voice call (voice channels have their own messages, like Discord). */
export function CallChat({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const data = useStore((s) => s.messages[channel.id]);
  const guildId = channel.guild_id ?? null;
  const [reply, setReply] = useState<Message | null>(null);
  const [profile, setProfile] = useState<{ id: string; el: HTMLElement } | null>(null);
  useEffect(() => { if (!data?.loaded) loadMessages(channel.id); }, [channel.id]); // eslint-disable-line
  useEffect(() => { if (document.visibilityState === "visible") ackChannel(channel); }, [channel.last_message_id]); // eslint-disable-line
  const mdCtx = { guildId, onMention: (id: string, el: HTMLElement) => setProfile((p) => (p && p.el === el ? null : { id, el })), onChannel: (id: string) => { const c = channelById(id); if (c) navigate(`/channels/${c.guild_id ?? "@me"}/${id}`); } };
  return (
    <aside className="channel call-chat" aria-label={`Chat in ${channel.name ?? "this call"}`}>
      <header className="call-chat-h">
        <MessageSquare size={20} aria-hidden /><ChannelGlyph c={channel} size={18} className="muted" /><strong className="ellipsis">{channel.name}</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Hide chat" title="Close"><X size={20} /></button>
      </header>
      <div className="ch-body"><div className="ch-main" data-region="chat">
        <MessageList channel={channel} data={data} highlight={null} onReply={setReply} mdCtx={mdCtx} />
        <Typing channelId={channel.id} guildId={guildId} />
        <Composer channel={channel} title={channel.name ?? ""} reply={reply} onClearReply={() => setReply(null)} />
      </div></div>
      {profile && <ProfileCard userId={profile.id} guildId={guildId} anchor={profile.el} onClose={() => setProfile(null)} />}
    </aside>
  );
}

/** DM / group-DM call: the call view at the top of the conversation while I'm in it (expandable). */
function DmCall({ channel }: { channel: Channel }) {
  const inCall = useVoice((v) => v.channelId === channel.id);
  const [full, setFull] = useState(false);
  if (!inCall) return null;
  return <div className={`dm-call ${full ? "full" : ""}`}>
    <VoiceStage channel={channel} guild={null} />
    <button className="dm-call-size icon-btn" onClick={() => setFull((f) => !f)} aria-label={full ? "Show the conversation" : "Expand the call"} title={full ? "Show chat" : "Expand"}>{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
  </div>;
}

/* ------------------------------------------------------------- list -- */
function MessageList({ channel, data, highlight, onReply, mdCtx }: { channel: Channel; data: ReturnType<typeof useStore.getState>["messages"][string] | undefined; highlight: string | null; onReply: (m: Message) => void; mdCtx: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const list = data?.list ?? [];
  // Where I'd read up to when I opened this channel (kept until I switch channel).
  const [opened, setOpened] = useState(() => ({ channel: channel.id, lastRead: useStore.getState().readStates[channel.id]?.last_read_id ?? null, at: Date.now() }));
  if (opened.channel !== channel.id) setOpened({ channel: channel.id, lastRead: useStore.getState().readStates[channel.id]?.last_read_id ?? null, at: Date.now() });
  const myId = useStore((s) => s.me?.id);
  const big = (id: string) => { try { return BigInt(id.replace(/\D/g, "") || "0"); } catch { return 0n; } };
  const unread = useMemo(() => {
    const lr = opened.lastRead ? big(opened.lastRead) : null;
    if (lr === null || opened.channel !== channel.id) return { firstId: null as string | null, count: 0, since: null as string | null };
    const real = list.filter((m) => !m._state);
    // Sending a message myself clears the divider, like Discord.
    if (real.some((m) => m.author.id === myId && big(m.id) > lr && new Date(m.created_at).getTime() >= opened.at - 1000)) return { firstId: null, count: 0, since: null };
    const after = real.filter((m) => big(m.id) > lr && m.author.id !== myId);
    return { firstId: after[0]?.id ?? null, count: after.length, since: after[0]?.created_at ?? null };
  }, [list, opened, myId, channel.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [barHidden, setBarHidden] = useState<string | null>(null);
  const [dividerAbove, setDividerAbove] = useState(false);
  const jumped = useRef<string | null>(null);
  const canHistory = can(channel, P.READ_MESSAGE_HISTORY) || !channel.guild_id;
  const [away, setAway] = useState(false);
  const latestLoaded = !channel.last_message_id || list.some((m) => m.id === channel.last_message_id);
  const jumpToPresent = async () => {
    if (!latestLoaded) await loadMessages(channel.id, { latest: true });
    if (highlight) navigate(`/channels/${channel.guild_id ?? "@me"}/${channel.id}`, true);
    stick.current = true;
    requestAnimationFrame(() => { const el = ref.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); });
  };
  const groupingOn = useAppearance((s) => s.resolved.theme.layout.grouping);

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (highlight) {
      const t = el.querySelector(`[data-mid="${highlight}"]`) as HTMLElement | null;
      if (t) { t.scrollIntoView({ block: "center" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 2000); stick.current = false; return; }
    }
    if (prevHeight.current && el.scrollTop < 50) el.scrollTop = el.scrollHeight - prevHeight.current; // keep position after loading older
    else if (stick.current) el.scrollTop = el.scrollHeight;
    prevHeight.current = 0;
    // First open with lots unread: start at the "New" line instead of the bottom.
    if (unread.firstId && jumped.current !== channel.id) {
      jumped.current = channel.id;
      const d = el.querySelector(".new-div") as HTMLElement | null;
      if (d && el.scrollHeight - d.offsetTop > el.clientHeight) { el.scrollTop = Math.max(0, d.offsetTop - 24); stick.current = false; }
    }
    checkDivider();
  }, [list.length, highlight, unread.firstId]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkDivider = () => {
    const el = ref.current, d = el?.querySelector(".new-div") as HTMLElement | null;
    setDividerAbove(!!unread.firstId && (!d || (!!el && d.offsetTop < el.scrollTop)));
  };
  const jumpToUnread = () => {
    const el = ref.current, d = el?.querySelector(".new-div") as HTMLElement | null;
    if (el && d) { el.scrollTo({ top: Math.max(0, d.offsetTop - 24), behavior: "smooth" }); stick.current = false; }
    else if (data?.hasMore && list.length) loadMessages(channel.id, { before: list.find((m) => !m._state)?.id });
  };

  // Keep the newest message visible when the message box grows/shrinks (it overlays the list).
  useEffect(() => {
    const el = ref.current, host = el?.closest(".channel");
    if (!el || !host) return;
    const on = () => { if (stick.current) el.scrollTop = el.scrollHeight; };
    host.addEventListener("composer-resize", on); return () => host.removeEventListener("composer-resize", on);
  }, []);
  const onScroll = () => {
    const el = ref.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight * 1.5 || !latestLoaded);
    checkDivider();
    if (el.scrollTop < 200 && data?.hasMore && !data.loading && list.length) {
      prevHeight.current = el.scrollHeight;
      loadMessages(channel.id, { before: list.find((m) => !m._state)?.id });
    }
  };

  return (
    <div className="msgs" ref={ref} onScroll={onScroll} onKeyDown={(e) => {
      // Keyboard: ↑/↓ move between messages, Home/End jump, Esc goes back to the message box.
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const items = [...(ref.current?.querySelectorAll<HTMLElement>("article.msg") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(); return; }
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) || (i < 0 && e.target !== ref.current)) return;
      e.preventDefault();
      const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : i < 0 ? items.length - 1 : i + (e.key === "ArrowUp" ? -1 : 1);
      const el = items[Math.max(0, Math.min(items.length - 1, n))]; el?.focus(); el?.scrollIntoView({ block: "nearest" });
    }} role="log" aria-live="polite" aria-relevant="additions" aria-label={`Messages in ${channel.name ?? "conversation"}`} tabIndex={0}>
      {unread.count > 0 && dividerAbove && barHidden !== `${channel.id}:${unread.firstId}` && <div className="unread-bar" role="status">
      <button className="unread-jump" onClick={jumpToUnread}>{unread.count >= 50 ? "50+" : unread.count} new message{unread.count === 1 ? "" : "s"} since {unread.since ? fmtTime(unread.since) : "you were last here"}</button>
      <button className="unread-mark" onClick={() => { ackChannel(channel); setBarHidden(`${channel.id}:${unread.firstId}`); }}>Mark as read</button>
    </div>}
      {(away || !latestLoaded) && list.length > 0 && <div className="jump-present"><span>You're viewing older messages</span><button onClick={jumpToPresent}>Jump to present <ArrowDown size={14} /></button></div>}
      {!canHistory && <p className="muted pad">You can't read the history of this channel.</p>}
      {data && !data.hasMore && <Welcome channel={channel} />}
      {data?.loading && <p className="muted pad center">Loading messages…</p>}
      {list.map((m, i) => {
        const prev = list[i - 1];
        const day = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
        const grouped = groupingOn && !!prev && !day && prev.author.id === m.author.id && m.type === 0 && prev.type === 0 && !m.reply_to && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60_000;
        const newLine = m.id === unread.firstId;
        return (
          <div key={m.id}>
            {day && <div className="day-div" role="separator"><span>{new Date(m.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span></div>}
            {newLine && <div className="new-div" role="separator" aria-label="New messages"><span>New</span></div>}
            <MessageRow m={m} channel={channel} grouped={grouped} onReply={onReply} mdCtx={mdCtx} />
          </div>
        );
      })}
    </div>
  );
}

function Welcome({ channel }: { channel: Channel }) {
  return (
    <div className="welcome">
      <div className="welcome-ico">{channel.guild_id ? <ChannelGlyph c={channel} size={36} /> : <Avatar user={channel.recipients?.[0]} size={72} />}</div>
      <h2>{channel.guild_id ? `Welcome to ${channel.type === ChannelType.VOICE ? "" : "#"}${channel.name}!` : dmTitle(channel)}</h2>
      <p className="muted">{channel.guild_id ? "This is the start of the channel." : "This is the beginning of your conversation."}</p>
    </div>
  );
}

const MessageRow = memo(function MessageRow({ m, channel, grouped, onReply, mdCtx }: { m: UIMessage; channel: Channel; grouped: boolean; onReply: (m: Message) => void; mdCtx: any }) {
  const me = useStore((s) => s.me!);
  const guildId = channel.guild_id;
  const editing = useEditing((s) => s.id === m.id);
  const setEditing = (v: boolean) => { useEditing.setState({ id: v ? m.id : null }); if (!v) document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus({ preventScroll: true }); };
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const media = useRef(new Map<number, MediaItem>());
  const mine = m.author.id === me.id;
  const canManage = !!guildId && can(channel, P.MANAGE_MESSAGES);
  const mentioned = m.mentions.includes(me.id) || m.mention_everyone || (guildId ? m.mention_roles.some((r) => useStore.getState().guilds[guildId]?.me.roles.includes(r)) : false);
  const roleColor = useStore(useShallow((s) => {
    if (!guildId) return null;
    const g = s.guilds[guildId]; const mem = s.members[guildId]?.[m.author.id];
    if (!g || !mem) return null;
    const r = g.roles.filter((r) => mem.roles.includes(r.id) && r.color).sort((a, b) => b.position - a.position)[0];
    return r ? { c: r.color!, c2: r.color2 } : null;
  }));
  if (m.type !== 0 && m.type !== 19 && m.type !== 20) return <SystemMessage m={m} channel={channel} />;
  const gridClass = useGridClass(m);
  const name = m.member_nick || memberName(guildId, m.author);
  const cos = useCosmetics(m.author, m.member?.profile_theme ?? undefined);
  const nameStyle = roleColor ? (roleColor.c2 ? { backgroundImage: `linear-gradient(90deg, ${roleColor.c}, ${roleColor.c2})`, WebkitBackgroundClip: "text", color: "transparent" } : { color: roleColor.c }) : undefined;
  const del = async (skipConfirm = false) => {
    if (!skipConfirm && !(await askConfirm({ title: "Delete message?", body: "Are you sure you want to delete this message? Hold Shift when clicking Delete to skip this.", confirmLabel: "Delete", danger: true }))) return;
    try { await api.del(`/api/channels/${channel.id}/messages/${m.id}`); } catch (e) { toast(errMsg(e), "error"); }
  };
  const pin = async () => { try { m.pinned ? await api.del(`/api/channels/${channel.id}/pins/${m.id}`) : await api.put(`/api/channels/${channel.id}/pins/${m.id}`); } catch (e) { toast(errMsg(e), "error"); } };
  const save = async () => { try { await api.put(`/api/users/@me/saved/${m.id}`); toast("Saved for later.", "success"); } catch (e) { toast(errMsg(e), "error"); } };
  const canReact = can(channel, P.ADD_REACTIONS) || !guildId;
  const canSend = can(channel, P.SEND_MESSAGES) || !guildId;
  const authorMenu = (e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); const el = e.currentTarget; openContextMenu(e, userMenuItems(m.author, { guildId, onProfile: () => mdCtx.onMention(m.author.id, el) })); };
  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("textarea,input,[contenteditable=true]") || m._state === "pending") return; // native menu for text fields (spellcheck, paste)
    const sel = window.getSelection();
    const selected = sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode) ? sel.toString() : "";
    const media = t.closest<HTMLElement>("[data-media-url]"), link = t.closest<HTMLAnchorElement>("a[href]");
    const sep: MenuItem = { kind: "separator" };
    const items: MenuItem[] = [];
    if (selected) items.push({ label: "Copy", hint: "Ctrl+C", onSelect: () => copy(selected, "Copied") }, sep);
    if (m._state === "failed") items.push({ label: "Retry sending", onSelect: () => sendMessage(channel.id, m.content, { retryOf: m }) }, { label: "Discard", danger: true, onSelect: () => discardFailed(channel.id, m.id) });
    else {
      if (canReact) items.push(
        { kind: "custom", render: (close) => <div className="ctx-emoji-row" role="group" aria-label="Quick reactions">{QUICK.slice(0, 4).map((x) => <button key={x} aria-label={`React ${x}`} onClick={() => { close(); toggleReaction(m, x); }}>{x}</button>)}</div> },
        { label: "Add reaction", submenu: QUICK.map((x) => ({ label: x, checked: m.reactions.some((r) => r.emoji === x && r.me), onSelect: () => toggleReaction(m, x) })) }, sep);
      if (mine && m.type === 0) items.push({ label: "Edit message", onSelect: () => setEditing(true) });
      if (canSend) items.push({ label: "Reply", onSelect: () => onReply(m) });
      items.push({ label: "Forward", onSelect: () => forwardMessage(m) });
      if (guildId && !m.thread && !isThreadType(channel.type) && (channel.type === ChannelType.TEXT || channel.type === ChannelType.ANNOUNCEMENT) && can(channel, P.CREATE_PUBLIC_THREADS)) items.push({ label: "Create thread", onSelect: () => openCreateThread(channel, m) });
      if (channel.type === ChannelType.ANNOUNCEMENT && !((m.flags ?? 0) & 1) && (mine || canManage)) items.push({ label: "Publish", onSelect: () => api.post(`/api/channels/${channel.id}/messages/${m.id}/crosspost`).then(() => toast("Published to following servers.", "success")).catch((x) => toast(errMsg(x), "error")) });
      if ((m.embeds?.length ?? 0) > 0 && (mine || canManage)) items.push({ label: "Remove embeds", onSelect: () => api.patch(`/api/channels/${channel.id}/messages/${m.id}/flags`, { suppress_embeds: true }).catch((x) => toast(errMsg(x), "error")) });
      if (canManage || !guildId) items.push({ label: m.pinned ? "Unpin message" : "Pin message", onSelect: pin });
      items.push(sep);
      if (m.content) items.push({ label: "Copy text", onSelect: () => copy(plainText(m.content), "Text copied") });
      items.push({ label: "Mark unread", hint: "Alt+click", onSelect: () => { api.post(`/api/channels/${channel.id}/messages/${m.id}/unread`).catch((x) => toast(errMsg(x), "error")); } });
      items.push({ label: "Copy message link", onSelect: () => copy(messageLink(guildId, channel.id, m.id), "Link copied") });
      items.push({ label: "Save message", onSelect: save });
      if (media) {
        const url = media.dataset.mediaUrl!, encrypted = url.startsWith("blob:");
        items.push(sep, { label: "Save image", onSelect: () => { const a = document.createElement("a"); a.href = url; a.download = media.dataset.filename ?? "image"; a.click(); } });
        if (!encrypted) items.push({ label: "Copy image link", onSelect: () => copy(new URL(url, location.href).href, "Link copied") }, { label: "Open image", onSelect: () => window.open(url, "_blank", "noopener,noreferrer") });
      } else if (link) items.push(sep, { label: "Copy link", onSelect: () => copy(link.href, "Link copied") }, { label: "Open link", onSelect: () => window.open(link.href, "_blank", "noopener,noreferrer") });
      if (mine || canManage) items.push(sep, { label: "Delete message", danger: true, hint: "Shift+click", onSelect: () => del() });
      if (developerMode()) items.push(sep, { label: "Copy message ID", onSelect: () => copy(m.id, "ID copied") });
    }
    openContextMenu(e, items);
  };
  // Discord-style shortcuts on the message itself: Alt+click marks unread from here.
  const onClickCapture = (e: React.MouseEvent) => {
    if (e.altKey && !m._state && !(e.target as HTMLElement).closest("a,button,textarea,input")) { e.preventDefault(); api.post(`/api/channels/${channel.id}/messages/${m.id}/unread`).catch((x) => toast(errMsg(x), "error")); }
  };
  return (
    <article onContextMenu={onContextMenu} onClickCapture={onClickCapture} className={`msg ${picker ? "picking" : ""} ${grouped ? "grouped" : ""} ${mentioned ? "mentioned" : ""} ${mine ? "mine" : ""} ${m._state ?? ""}`} data-mid={m.id} aria-label={`${name}, ${fmtTime(m.created_at)}`} tabIndex={-1}>
      {m.reply_to && (
        <button className="reply-ref" onClick={() => navigate(`/channels/${guildId ?? "@me"}/${channel.id}/${m.reply_to!.id}`)}>
          <span className="reply-spine" aria-hidden /> {m.reply_to.deleted ? <em className="muted">Original message was deleted</em> : <>{m.reply_to.author && <Avatar user={m.reply_to.author} size={16} />}<strong className="reply-who">@{m.reply_to.author ? memberName(guildId, m.reply_to.author) : "unknown"}</strong> <span className="ellipsis">{plainText(m.reply_to.content) || "Click to see attachment"}</span></>}
        </button>
      )}
      <div className="msg-row">
        <div className="msg-gutter">{grouped ? <time className="msg-time-hover" dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
          : <button className="av-btn" aria-label={`${name}'s profile`} onClick={(e) => mdCtx.onMention(m.author.id, e.currentTarget)} onContextMenu={authorMenu}><Avatar user={m.author} size={40} src={m.member?.avatar ?? undefined} serverTheme={m.member?.profile_theme ?? undefined} /></button>}</div>
        <div className="msg-body">
          {!grouped && <div className="msg-head"><button className="msg-name" style={nameStyle} onClick={(e) => mdCtx.onMention(m.author.id, e.currentTarget)} onContextMenu={authorMenu}><StyledName theme={cos.theme} animate={cos.animate}>{name}</StyledName></button>{m.author.bot && <span className="tag">{m.webhook_id && !m.source ? "BOT" : "APP"}</span>}<SourceTag m={m} /><time dateTime={m.created_at} className="muted small">{fmtTime(m.created_at)}</time></div>}
          <InteractionLine m={m} guildId={guildId} />
          {editing ? <EditBox m={m} onDone={() => setEditing(false)} /> : (
            <div className="msg-content">
              {m.content && !(m.embeds?.length === 1 && (m.embeds[0]!.type === "gifv" || m.embeds[0]!.type === "image") && m.embeds[0]!.url === m.content.trim()) && <Markdown text={m.content} ctx={mdCtx} />}
              {!m.content && (m.interaction as any)?.deferred && !m.embeds?.length && <em className="muted">{m.author.display_name || m.author.username} is thinking…</em>}
              {m.edited_at && <span className="muted edited-tag" title={`Edited ${fmtTime(m.edited_at)}`}> (edited)</span>}
            </div>
          )}
          {(m.stickers?.length ?? 0) > 0 && <div className="msg-stickers">{m.stickers!.map((st) => <img key={st.id} className="msg-sticker" src={st.url} alt={`Sticker: ${st.name}`} title={st.name} draggable={false} loading="lazy" />)}</div>}
          {m.snapshot && <Snapshot m={m} mdCtx={mdCtx} />}
          {m.poll && <PollView m={m} channel={channel} />}
          <GalleryCtx.Provider value={media.current}>{gridClass ? <div className={gridClass}>{m.attachments.map((a, i) => <AttachmentView key={a.id} a={a} index={i} />)}</div> : m.attachments.map((a, i) => <AttachmentView key={a.id} a={a} index={i} />)}</GalleryCtx.Provider>
          <Embeds m={m} channel={channel} />
          <Components m={m} channel={channel} />
          {m.thread && <ThreadChip m={m} guildId={guildId} />}
          {m._state === "pending" && <span className="muted small">Sending…</span>}
          {m._state === "failed" && (
            <div className="send-failed" role="alert">
              <span>{m._error ?? "Couldn't send."}</span>
              <button className="link" onClick={() => sendMessage(channel.id, m.content, { retryOf: m })}><RotateCcw size={13} /> Retry</button>
              <button className="link" onClick={() => discardFailed(channel.id, m.id)}>Discard</button>
            </div>
          )}
          {m.reactions.length > 0 && (
            <div className="reactions">
              {m.reactions.map((r) => (
                <button key={r.emoji} className={`reaction ${r.me ? "me" : ""}`} aria-pressed={r.me} aria-label={`${customReaction(r.emoji) ? `:${customReaction(r.emoji)!.name}:` : r.emoji} ${r.count} reaction${r.count === 1 ? "" : "s"}`} onClick={() => toggleReaction(m, r.emoji)}>
                  <span className="r-emoji">{customReaction(r.emoji) ? <CustomEmoji id={customReaction(r.emoji)!.id} name={customReaction(r.emoji)!.name} /> : r.emoji}</span> {r.count}
                </button>
              ))}
              {can(channel, P.ADD_REACTIONS) || !guildId ? <button className="reaction add" aria-label="Add reaction" onClick={(e) => { const el = e.currentTarget; setPicker((p) => (p === el ? null : el)); }}><SmilePlus size={14} /></button> : null}
            </div>
          )}
        </div>
      </div>
      {!m._state && !editing && (
        <div className="msg-tools" role="toolbar" aria-label="Message actions">
          {QUICK.slice(0, 3).map((e) => <button key={e} className="icon-btn sm" aria-label={`React ${e}`} onClick={() => toggleReaction(m, e)}>{e}</button>)}
          <button className="icon-btn sm" aria-label="Add reaction" onClick={(e) => { const el = e.currentTarget; setPicker((p) => (p === el ? null : el)); }}><SmilePlus size={16} /></button>
          <button className="icon-btn sm" aria-label="Reply" onClick={() => onReply(m)}><CornerUpLeft size={16} /></button>
          <button className="icon-btn sm" aria-label="Forward" title="Forward" onClick={() => forwardMessage(m)}><CornerUpRight size={16} /></button>
          {guildId && !m.thread && !isThreadType(channel.type) && (channel.type === ChannelType.TEXT || channel.type === ChannelType.ANNOUNCEMENT) && can(channel, P.CREATE_PUBLIC_THREADS) && <button className="icon-btn sm" aria-label="Create thread" title="Create thread" onClick={() => openCreateThread(channel, m)}><MessageSquare size={16} /></button>}
          {channel.type === ChannelType.ANNOUNCEMENT && !((m.flags ?? 0) & 1) && (mine || canManage) && <button className="icon-btn sm" aria-label="Publish" title="Publish to followers" onClick={() => api.post(`/api/channels/${channel.id}/messages/${m.id}/crosspost`).then(() => toast("Published.", "success")).catch((x) => toast(errMsg(x), "error"))}><SendIcon size={16} /></button>}
          {mine && <button className="icon-btn sm" aria-label="Edit" onClick={() => setEditing(true)}><Pencil size={16} /></button>}
          <button className="icon-btn sm" aria-label="More" title="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.closest("article")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom + 4, button: 2 })); }}><MoreHorizontal size={16} /></button>
          {(mine || canManage) && <button className="icon-btn sm danger" aria-label="Delete" title="Delete (hold Shift to skip confirmation)" onClick={(e) => del(e.shiftKey)}><Trash2 size={16} /></button>}
        </div>
      )}
      {picker && <EmojiPicker anchor={picker} guildId={guildId} onPick={(e) => { toggleReaction(m, reactionKey(e)); setPicker(null); }} onClose={() => setPicker(null)} />}
    </article>
  );
});

function SystemMessage({ m, channel }: { m: UIMessage; channel: Channel }) {
  const users = useStore((s) => s.users);
  const who = memberName(channel.guild_id, m.author);
  let text: React.ReactNode = extraSystemText(m, channel, <strong>{who}</strong>);
  if (text) { /* new system message kinds */ }
  else if (m.type === MessageType.MEMBER_JOIN) text = <><strong>{who}</strong> joined. Say hi! 👋</>;
  else if (m.type === MessageType.PINNED) text = <><strong>{who}</strong> pinned a message.</>;
  else if (m.type === MessageType.GROUP_RENAME) text = <><strong>{who}</strong> renamed the group to <strong>{m.content || "(no name)"}</strong>.</>;
  else if (m.type === MessageType.RECIPIENT_ADD) text = <><strong>{who}</strong> added <strong>{displayName(users[m.mentions[0]!])}</strong>.</>;
  else if (m.type === MessageType.RECIPIENT_REMOVE) text = m.mentions[0] === m.author.id ? <><strong>{who}</strong> left.</> : <><strong>{who}</strong> removed <strong>{displayName(users[m.mentions[0]!])}</strong>.</>;
  else if (m.type === MessageType.CALL) {
    let info: any = {}; try { info = JSON.parse(m.content); } catch { /* */ }
    text = info.state === "missed" ? <>Missed call from <strong>{who}</strong></> : info.state === "ended" ? <><strong>{who}</strong> started a call that lasted {Math.max(1, Math.round(info.duration_s / 60))} min.</> : <><strong>{who}</strong> started a call.</>;
  } else text = <em className="muted">Unsupported message type</em>;
  return <div className="sys-msg" data-mid={m.id}><span className="muted small">{fmtTime(m.created_at)}</span> {text}</div>;
}

const GalleryCtx = createContext<Map<number, MediaItem> | null>(null);
const isVisual = (t: string) => t.startsWith("image/") || t.startsWith("video/");
function AttachmentView({ a, index }: { a: Message["attachments"][number]; index: number }) {
  const [url, setUrl] = useState<string | null>(a.encryption ? null : a.url);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!a.encryption) { setUrl(a.url); return; }
    let local: string | null = null, stopped = false; const controller = new AbortController();
    fetch(a.url, { credentials: "same-origin", signal: controller.signal }).then(r => { if (!r.ok) throw Error("Download failed"); return r.arrayBuffer(); }).then(async bytes => {
      const { decryptFile } = await import("../crypto/core.ts"); const clear = await decryptFile(new Uint8Array(bytes), a.encryption!.key, a.encryption!.nonce);
      if (!stopped) { local = URL.createObjectURL(new Blob([new Uint8Array(clear)], { type: a.content_type })); setUrl(local); }
    }).catch(() => { if (!stopped) setError(true); });
    return () => { stopped = true; controller.abort(); if (local) URL.revokeObjectURL(local); };
  }, [a.url, a.encryption?.key]);
  if (error) return <span className="muted">Encrypted attachment could not be opened.</span>;
  if (!url) return <span className="muted">Decrypting attachment…</span>;
  return <AttachmentContent a={{ ...a, url }} index={index} />;
}
function AttachmentContent({ a, index }: { a: Message["attachments"][number]; index: number }) {
  const gallery = useContext(GalleryCtx);
  // Register resolved (possibly decrypted) media so the viewer can page through everything in this message.
  useEffect(() => {
    if (!gallery || !isVisual(a.content_type)) return;
    gallery.set(index, { url: a.url, filename: a.filename, content_type: a.content_type, width: a.width, height: a.height });
    return () => { gallery.delete(index); };
  }, [gallery, index, a.url]); // eslint-disable-line
  const open = () => {
    const items = gallery ? [...gallery.entries()].sort((x, y) => x[0] - y[0]) : [[index, { url: a.url, filename: a.filename, content_type: a.content_type, width: a.width, height: a.height }] as const];
    openMediaViewer(items.map((x) => x[1]), Math.max(0, items.findIndex((x) => x[0] === index)));
  };
  if (a.content_type.startsWith("image/")) return (
    <button className="att-img" onClick={open} aria-label={`Open image ${a.filename}`} data-media-url={a.url} data-filename={a.filename}>
      <img src={a.url} alt={a.filename} loading="lazy" decoding="async" style={a.width && a.height ? { aspectRatio: `${a.width}/${a.height}` } : undefined} />
    </button>
  );
  if (a.content_type.startsWith("video/")) return <video className="att-video" src={a.url} controls preload="metadata" />;
  if (a.content_type.startsWith("audio/")) return (
    <div className="att-audio">{a.waveform && <Waveform data={a.waveform} />}<audio src={a.url} controls preload="metadata" aria-label={a.filename} /></div>
  );
  return (
    <a className="att-file" href={a.url} download={a.filename}>
      <FileIcon size={28} aria-hidden /><span><strong className="ellipsis block">{a.filename}</strong><small className="muted">{fmtBytes(a.size)}</small></span>
    </a>
  );
}

function Waveform({ data }: { data: string }) {
  const bars = useMemo(() => { try { return [...atob(data)].map((c) => c.charCodeAt(0) / 255); } catch { return []; } }, [data]);
  return <div className="wave" aria-hidden>{bars.map((b, i) => <i key={i} style={{ height: `${Math.max(8, b * 100)}%` }} />)}</div>;
}

function EditBox({ m, onDone }: { m: Message; onDone: () => void }) {
  const [text, setText] = useState(m.content);
  const save = async () => {
    if (text === m.content) return onDone();
    try { await api.patch(`/api/channels/${m.channel_id}/messages/${m.id}`, { content: text }); onDone(); } catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <div className="edit-box">
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit message"
        onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Escape") { e.preventDefault(); onDone(); } if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } }} />
      <small className="muted">escape to cancel · enter to save</small>
    </div>
  );
}

/** A favourite / recent entry: unicode, a server emoji or a 7TV/BTTV emote. */
function pickerGlyph(e: string) {
  const t = parseEmoteToken(e);
  if (t) return <ThirdPartyEmote provider={t.provider} id={t.id} name={t.name} />;
  if (/^<a?:/.test(e)) return <CustomEmoji id={e.match(/:(\d+)>$/)?.[1] ?? ""} name={e.match(/:(\w+):/)?.[1] ?? ""} />;
  return e;
}

export function EmojiPicker({ onPick, onClose, anchor, guildId, onClear, clearLabel, emotes }: { onPick: (e: string) => void; onClose: () => void; anchor?: HTMLElement | null; guildId?: string | null; onClear?: () => void; clearLabel?: string; emotes?: boolean }) {
  const custom = useStore(useShallow((s) => Object.values(s.guilds).map((g) => g.emojis?.length ?? 0).join(",")));
  const groups = useMemo(() => myEmojis(guildId), [custom, guildId]); // eslint-disable-line react-hooks/exhaustive-deps
  // 7TV / BTTV sections (message box only — reactions and icons take emoji the server can check).
  const emoteVersion = useEmotes((s) => `${s.global?.length ?? 0}:${Object.keys(s.guild).length}`);
  useEffect(() => { if (emotes) loadEmotes(guildId); }, [emotes, guildId]);
  const emoteSecs = useMemo(() => (emotes ? emoteGroups(guildId) : []), [emotes, guildId, emoteVersion]);
  const ALL = "😀 😃 😄 😁 😆 🥹 😅 😂 🤣 🥲 😊 😇 🙂 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 🤗 🤔 🫡 🤭 🤫 😶 😐 😑 😬 🙄 😯 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 👍 👎 👏 🙌 👐 🤝 🙏 ✌️ 🤞 🫶 🤟 🤘 👌 👋 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💕 💯 ✨ 🌟 ⭐ 🔥 🎉 🎊 🌻 🌈 ☀️ 🌙 ⚡ 🍀 🌸 🐶 🐱 🦊 🐻 🐼 🐨 🦁 🐸 🐧 🦄 🍕 🍔 🍟 🍩 🍪 🎂 🍰 ☕ 🧋 🎮 🎧 🎵 🎨 📚 ⚽ 🏀 🚀 🧦 👀 ✅ ❌ ❓ ❗".split(" ");
  const [q, setQ] = useState("");
  const settings = useStore((s) => (s.me?.settings ?? NO_SETTINGS) as any);
  const tone: string = settings.emoji_tone ?? "";
  const favs: string[] = settings.emoji_favorites ?? [];
  const recent: string[] = settings.emoji_recent ?? [];
  const TONES = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];
  const toneable = (e: string) => /^[\u{1F44A}-\u{1F450}\u{1F44D}\u{1F44E}\u{1F64C}\u{1F64F}\u{1F91D}\u{1F91E}\u{1F91F}\u{1F918}\u{1F44B}\u{1F4AA}\u{1F44F}\u{1FAF6}\u{270C}]/u.test(e);
  const withTone = (e: string) => (tone && toneable(e) ? e.replace(/\uFE0F/g, "") + tone : e);
  const pickEmoji = (e: string) => {
    const v = withTone(e);
    import("../actions.ts").then((a) => a.updateSettings({ emoji_recent: [v, ...recent.filter((x) => x !== v)].slice(0, 24) }));
    onPick(v);
  };
  const toggleFav = (e: string) => import("../actions.ts").then((a) => a.updateSettings({ emoji_favorites: favs.includes(e) ? favs.filter((x) => x !== e) : [e, ...favs].slice(0, 48) }));
  const ref = useRef<HTMLDivElement>(null);
  // Outside press and Escape close it; pressing the button that opened it again toggles it closed.
  useLayer(ref, onClose, { anchor: () => anchor });
  const [pos, setPos] = useState<React.CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect(), w = ref.current.offsetWidth, h = ref.current.offsetHeight, m = 8, vw = window.innerWidth, vh = window.innerHeight;
    // From the channel list: open beside it (to the right), so the list stays visible.
    const side = anchor.closest(".sidebar"); if (side) { setPos({ position: "fixed", left: Math.min(vw - w - m, side.getBoundingClientRect().right + 8), top: Math.max(m, Math.min(vh - h - m, r.top - 40)), right: "auto" }); return; }
    // Above the button, else below it, else beside it — never on top of the button that toggles it.
    let left = Math.max(m, Math.min(vw - w - m, r.right - w)), top: number;
    if (r.top - h - 8 >= m) top = r.top - h - 8;
    else if (r.bottom + 8 + h <= vh - m) top = r.bottom + 8;
    else { top = Math.max(m, Math.min(vh - h - m, r.top + r.height / 2 - h / 2)); left = r.left - w - 8 >= m ? r.left - w - 8 : Math.min(vw - w - m, r.right + 8); }
    setPos({ position: "fixed", left, top, right: "auto" });
  }, [anchor]);
  return (
    createPortal(<div ref={ref} className="picker" role="dialog" aria-label="Pick an emoji" data-layer style={pos}>
      <div className="picker-h"><input autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter emoji" /><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
      {onClear && <button className="picker-clear" onClick={onClear}>{clearLabel ?? "Remove"}</button>}
      <div className="tone-row" role="radiogroup" aria-label="Skin tone">{TONES.map((t) => <button key={t || "default"} role="radio" aria-checked={tone === t} className={tone === t ? "on" : ""} onClick={() => import("../actions.ts").then((a) => a.updateSettings({ emoji_tone: t }))} aria-label={t ? `Skin tone ${TONES.indexOf(t)}` : "Default skin tone"}>{"👋" + t}</button>)}</div>
      <div className="picker-scroll">
        {!q && favs.length > 0 && <section aria-label="Favorites"><h4 className="picker-sec">Favorites</h4><div className="picker-grid">{favs.filter((e) => emotes || !parseEmoteToken(e)).map((e) => <button key={e} onClick={() => onPick(e)} onContextMenu={(ev) => { ev.preventDefault(); toggleFav(e); }} aria-label={e} title="Right-click to unfavorite">{pickerGlyph(e)}</button>)}</div></section>}
        {!q && recent.length > 0 && <section aria-label="Frequently used"><h4 className="picker-sec">Frequently used</h4><div className="picker-grid">{recent.filter((e) => emotes || !parseEmoteToken(e)).map((e) => <button key={e} onClick={() => pickEmoji(e)} onContextMenu={(ev) => { ev.preventDefault(); toggleFav(e); }} aria-label={e}>{pickerGlyph(e)}</button>)}</div></section>}
        {groups.map((g) => { const list = g.emojis.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase())); return list.length ? <section key={g.guildId} aria-label={g.guildName}>
          <h4 className="picker-sec">{g.guildName}</h4>
          <div className="picker-grid">{list.map((e) => <button key={e.id} onClick={() => pickEmoji(emojiText(e))} onContextMenu={(ev) => { ev.preventDefault(); toggleFav(emojiText(e)); }} aria-label={`:${e.name}:`} title={`:${e.name}:`}><img src={e.url} alt="" loading="lazy" draggable={false} /></button>)}</div>
        </section> : null; })}
        {emoteSecs.map((g) => { const list = g.emotes.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase())); return list.length ? <section key={g.key} aria-label={g.title}>
          <h4 className="picker-sec">{g.title}</h4>
          <div className="picker-grid emote-grid">{list.slice(0, q ? 200 : 400).map((e) => <button key={e.provider + e.id} onClick={() => pickEmoji(emoteToken(e))} onContextMenu={(ev) => { ev.preventDefault(); toggleFav(emoteToken(e)); }} aria-label={`:${e.name}:`} title={`:${e.name}:`}><img src={emoteUrl(e.provider, e.id)} alt="" loading="lazy" draggable={false} /></button>)}</div>
        </section> : null; })}
        {(groups.length > 0 || emoteSecs.length > 0) && <h4 className="picker-sec">Emoji</h4>}
        <div className="picker-grid">{ALL.filter((e) => !q || e.includes(q)).map((e) => <button key={e} onClick={() => pickEmoji(e)} onContextMenu={(ev) => { ev.preventDefault(); toggleFav(e); }} aria-label={e} title="Right-click to favorite">{withTone(e)}</button>)}</div>
      </div>
    </div>, document.body)
  );
}

/** Stickers from my servers (current one first). Picking one sends it straight away, like Discord. */
function StickerPicker({ onPick, onClose, anchor, guildId }: { onPick: (s: Sticker) => void; onClose: () => void; anchor?: HTMLElement | null; guildId?: string | null }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { anchor: () => anchor });
  const [pos, setPos] = useState<React.CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect(), w = ref.current.offsetWidth, h = ref.current.offsetHeight, m = 8;
    setPos({ position: "fixed", left: Math.max(m, Math.min(window.innerWidth - w - m, r.right - w)), top: r.top - h - 8 >= m ? r.top - h - 8 : Math.min(window.innerHeight - h - m, r.bottom + 8), right: "auto" });
  }, [anchor]);
  const groups = myStickers(guildId);
  const match = (s: Sticker) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.tags ?? "").includes(q);
  return createPortal(<div ref={ref} className="picker sticker-picker" role="dialog" aria-label="Pick a sticker" data-layer style={pos}>
    <div className="picker-h"><input autoFocus placeholder="Search stickers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter stickers" /><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
    <div className="picker-scroll">{groups.map((g) => { const list = g.stickers.filter(match); return list.length ? <section key={g.guildId} aria-label={g.guildName}>
      <h4 className="picker-sec">{g.guildName}</h4>
      <div className="sticker-grid">{list.map((st) => <button key={st.id} onClick={() => onPick(st)} aria-label={`Send sticker ${st.name}`} title={st.name}><img src={st.url} alt="" loading="lazy" draggable={false} /></button>)}</div>
    </section> : null; })}
      {!groups.length && <p className="muted small" style={{ padding: 10 }}>No stickers yet. Server admins can add them in Server settings → Stickers.</p>}</div>
  </div>, document.body);
}

/** Thumbnail of a picked photo/video (local, before upload); other files get an icon. */
function UploadThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (!/^(image|video)\//.test(file.type)) return; const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  if (url && file.type.startsWith("image/")) return <img className="upload-thumb" src={url} alt="" />;
  if (url) return <video className="upload-thumb" src={url} muted playsInline preload="metadata" />;
  return <span className="upload-thumb file" aria-hidden><FileIcon size={22} /></span>;
}

/* ------------------------------------------------------------ typing -- */
function Typing({ channelId, guildId }: { channelId: string; guildId: string | null }) {
  const typing = useStore((s) => s.typing[channelId]);
  const users = useStore((s) => s.users);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 2000); return () => clearInterval(t); }, []);
  const who = Object.entries(typing ?? {}).filter(([, until]) => until > Date.now()).map(([id]) => memberName(guildId, users[id]));
  return (
    <div className="typing" aria-live="polite">
      {who.length > 0 && <><span className="dots" aria-hidden><i /><i /><i /></span>{who.length > 3 ? "Several people are typing…" : `${who.join(", ")} ${who.length === 1 ? "is" : "are"} typing…`}</>}
    </div>
  );
}

/* ---------------------------------------------------------- composer -- */
function Composer({ channel, title, reply, onClearReply }: { channel: Channel; title: string; reply: Message | null; onClearReply: () => void }) {
  const [text, setText] = useState(() => sessionStorage.getItem(`syndo.draft.${channel.id}`) ?? "");
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [recording, setRecording] = useState<null | { rec: MediaRecorder; started: number; levels: number[] }>(null);
  const limits = useStore((s) => s.limits);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const emojiBtn = useRef<HTMLButtonElement>(null);
  const stickerBtn = useRef<HTMLButtonElement>(null);
  const [stickers, setStickers] = useState(false);
  const hasStickers = useStore((s) => Object.values(s.guilds).some((g) => (g.stickers?.length ?? 0) > 0));
  const [emoji, setEmoji] = useState(false);
  const [attach, setAttach] = useState(false);
  const [camera, setCamera] = useState(false);
  const plusBtn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // The list scrolls behind the message box: publish its height so the list can pad and fade under it.
  useLayoutEffect(() => {
    const el = wrap.current, host = el?.closest(".channel") as HTMLElement | null;
    if (!el || !host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { host.style.setProperty("--composer-h", `${Math.ceil(el.getBoundingClientRect().height)}px`); host.dispatchEvent(new Event("composer-resize")); });
    ro.observe(el); return () => { ro.disconnect(); host.style.removeProperty("--composer-h"); };
  }, []);
  const insert = (s: string) => {
    const el = ta.current; if (!el) { setText((t) => t + s); return; }
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    const next = el.value.slice(0, a) + s + el.value.slice(b);
    setText(next); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + s.length, a + s.length); });
  };
  useEffect(() => {
    const on = (e: Event) => { const what = (e as CustomEvent).detail; if (what === "emoji") setEmoji((v) => !v); if (what === "upload") fileIn.current?.click(); };
    window.addEventListener("syndo:composer", on); return () => window.removeEventListener("syndo:composer", on);
  }, []);
  /** ↑ in an empty box edits your most recent message (Discord behaviour). */
  const editLast = () => {
    const me = useStore.getState().me?.id, list = useStore.getState().messages[channel.id]?.list ?? [];
    const last = [...list].reverse().find((x) => x.author.id === me && !x._state && x.type === 0);
    if (!last) return false;
    useEditing.setState({ id: last.id });
    requestAnimationFrame(() => document.querySelector(`[data-mid="${last.id}"]`)?.scrollIntoView({ block: "nearest" }));
    return true;
  };
  const mentions = useMentionAutocomplete(channel, text, setText, ta);
  const slash = useSlashCommands(channel, text, setText, ta);
  const [pingReply, setPingReply] = useState(true);
  useEffect(() => { setPingReply(true); }, [reply?.id]);
  const isDm = !channel.guild_id;
  const canSend = isDm ? can(channel, P.SEND_MESSAGES) || !channel.my_permissions : can(channel, P.SEND_MESSAGES);
  const canAttach = isDm || can(channel, P.ATTACH_FILES);
  const slow = channel.rate_limit_per_user;
  useEffect(() => { try { sessionStorage.setItem(`syndo.draft.${channel.id}`, text); } catch { /* */ } }, [text, channel.id]);
  useEffect(() => { if (reply) ta.current?.focus(); }, [reply]);

  const update = useCallback((u: PendingUpload) => setUploads((list) => { const i = list.findIndex((x) => x.key === u.key); if (i < 0) return [...list, u]; const n = [...list]; n[i] = u; return n; }), []);
  const addFiles = (files: FileList | File[]) => {
    if (!canAttach) { toast("You can't attach files here.", "error"); return; }
    for (const f of [...files].slice(0, 10)) {
      // Boosted servers allow bigger files (up to 500 MB); the server checks again.
      const tier = channel.guild_id ? useStore.getState().guilds[channel.guild_id]?.premium_tier ?? 0 : 0;
      const maxBytes = limits ? Math.min(500 * 1048576, Math.max(limits.max_upload_bytes, boostPerks(tier).upload_mb * 1048576)) : Infinity;
      if (f.size > maxBytes) { toast(`${f.name} is larger than the ${fmtBytes(maxBytes)} limit here.`, "error"); continue; }
      const extra: Record<string, string> = {};
      if (f.type.startsWith("image/")) {
        const img = new Image(); const url = URL.createObjectURL(f);
        img.onload = () => { extra.width = String(img.naturalWidth); extra.height = String(img.naturalHeight); URL.revokeObjectURL(url); startUpload(channel.id, f, update, extra); };
        img.onerror = () => startUpload(channel.id, f, update);
        img.src = url;
      } else startUpload(channel.id, f, update, extra);
    }
  };
  const submit = async () => {
    const content = text.trim();
    const ready = uploads.filter((u) => u.status === "done");
    if (uploads.some((u) => u.status === "uploading")) { toast("Wait for uploads to finish.", "info"); return; }
    if (!content && !ready.length) return;
    if (limits && content.length > limits.max_message_length) { toast(`Messages can be up to ${limits.max_message_length} characters.`, "error"); return; }
    if (content.startsWith("/") && !ready.length) {
      const handled = await slash.run(content);
      if (handled === true) { setText(""); return; }
      if (typeof handled === "string") { setText(""); onClearReply(); await sendMessage(channel.id, handled, { reply_to: reply?.id, extra: { mention_author: pingReply } }); return; }
    }
    setText(""); setUploads([]); onClearReply();
    await sendMessage(channel.id, content, { reply_to: reply?.id, attachment_ids: ready.map((u) => u.id!), extra: reply ? { mention_author: pingReply } : undefined });
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      const chunks: Blob[] = []; const levels: number[] = [];
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(stream).connect(an); an.fftSize = 256;
      const buf = new Uint8Array(an.frequencyBinCount);
      const timer = setInterval(() => { an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128)); levels.push(Math.min(255, peak * 2)); }, 100);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        clearInterval(timer); ctx.close(); stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const duration = (Date.now() - started) / 1000;
        if (duration < 0.5) return;
        const step = Math.max(1, Math.floor(levels.length / 64));
        const wf = btoa(String.fromCharCode(...levels.filter((_, i) => i % step === 0).slice(0, 64)));
        const file = new File([blob], `voice-message.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type });
        if (await askConfirm({ title: `Send this ${Math.round(duration)}s voice message?`, confirmLabel: "Send" })) {
          const u = startUpload(channel.id, file, (x) => { update(x); if (x.status === "done") { sendMessage(channel.id, "", { attachment_ids: [x.id!] }); setUploads((l) => l.filter((y) => y.key !== x.key)); } }, { duration: duration.toFixed(1), waveform: wf });
          void u;
        }
      };
      const started = Date.now();
      rec.start(250);
      setRecording({ rec, started, levels });
    } catch (e) { toast((await import("../voice/session.ts")).deviceError(e), "error"); }
  };

  if (!canSend) return <div className="composer disabled" role="note">{isDm ? "You can't message this person right now." : "You don't have permission to send messages in this channel."}</div>;
  return (
    <div ref={wrap} className="composer-wrap" data-region="composer" onDragOver={(e) => { e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
      {reply && <div className="reply-bar">Replying to <strong>{memberName(channel.guild_id, reply.author)}</strong>
        {reply.author.id !== useStore.getState().me?.id && <button className={`reply-ping ${pingReply ? "on" : ""}`} aria-pressed={pingReply} title={pingReply ? "They'll be notified. Click to reply without a ping." : "They won't be notified."} onClick={() => setPingReply((v) => !v)}><AtSign size={14} /> {pingReply ? "ON" : "OFF"}</button>}
        <button className="icon-btn sm" aria-label="Cancel reply" onClick={onClearReply}><X size={14} /></button></div>}
      {uploads.length > 0 && (
        <ul className="uploads" aria-label="Attachments">
          {uploads.map((u) => (
            <li key={u.key} className={`upload u-${u.status}`}>
              <UploadThumb file={u.file} /><span className="ellipsis upload-name">{u.file.name}</span>
              {u.status === "uploading" && <progress max={1} value={u.progress} aria-label={`Uploading ${u.file.name}`} />}
              {u.status === "error" && <><span className="danger-text small">{u.error}</span><button className="link" onClick={() => { setUploads((l) => l.filter((x) => x.key !== u.key)); addFiles([u.file]); }}>Retry</button></>}
              <button className="icon-btn sm" aria-label={u.status === "uploading" ? "Cancel upload" : "Remove"} onClick={() => { u.cancel?.(); if (u.id) api.del(`/api/attachments/${u.id}`).catch(() => {}); setUploads((l) => l.filter((x) => x.key !== u.key)); }}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {mentions.popup}
      {slash.popup}
      <div className="composer">
        {canAttach && <><button ref={plusBtn} className={`icon-btn composer-plus ${attach ? "active" : ""}`} aria-label="Add photos, videos or files" aria-expanded={attach} title="Add" onClick={() => setAttach((v) => !v)}><Plus size={22} /></button>
          <input ref={fileIn} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} /></>}
        {attach && <AttachSheet anchor={plusBtn.current} onFiles={(f) => addFiles(f)} onClose={() => setAttach(false)} onCamera={() => setCamera(true)} onStickers={hasStickers ? () => setStickers(true) : undefined} />}
        {camera && <CameraCapture onCapture={(f) => { setCamera(false); addFiles([f]); }} onClose={() => setCamera(false)} />}
        <div className="composer-field">
        <textarea ref={ta} rows={1} value={text} placeholder={`Message ${title}`} aria-label={`Message ${title}`} maxLength={limits?.max_message_length} {...mentions.inputProps} onSelect={mentions.onSelect} onBlur={mentions.onBlur}
          onChange={(e) => { setText(e.target.value); if (e.target.value) sendTyping(channel.id); }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => {
            if (slash.onKeyDown(e) || mentions.onKeyDown(e) || e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            if (e.key === "Escape" && reply) { e.preventDefault(); onClearReply(); } // cancel the reply before Esc marks the channel read
            if (e.key === "ArrowUp" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !text && editLast()) e.preventDefault();
          }} />
        <button ref={emojiBtn} className={`icon-btn ${emoji ? "active" : ""}`} aria-label="Emoji" aria-expanded={emoji} title="Emoji" onClick={() => setEmoji((v) => !v)}><Smile size={20} /></button>
        {emoji && <EmojiPicker emotes anchor={emojiBtn.current} guildId={channel.guild_id} onPick={(x) => { insert(x); setEmoji(false); }} onClose={() => setEmoji(false)} />}
        {hasStickers && <button ref={stickerBtn} className={`icon-btn ${stickers ? "active" : ""}`} aria-label="Stickers" aria-expanded={stickers} title="Stickers" onClick={() => setStickers((v) => !v)}><StickerIcon size={20} /></button>}
        <ComposerExtras channel={channel} onSendGif={(url) => sendMessage(channel.id, url, { reply_to: reply?.id })} />
        {stickers && <StickerPicker anchor={stickerBtn.current} guildId={channel.guild_id} onPick={(st) => { setStickers(false); sendMessage(channel.id, "", { sticker: st, reply_to: reply?.id }); onClearReply(); }} onClose={() => setStickers(false)} />}
        </div>
        {recording ? <button className="icon-btn danger" aria-label="Stop recording" onClick={() => { recording.rec.stop(); setRecording(null); }}><Square size={18} /></button>
          : canAttach && <button className="icon-btn" aria-label="Record a voice message" onClick={startRec}><Mic size={20} /></button>}
        <button className={`icon-btn composer-send ${text.trim() || uploads.some((u) => u.status === "done") ? "ready" : ""}`} aria-label="Send" onClick={submit}><SendHorizontal size={20} /></button>
      </div>
      <div className="composer-meta muted small">
        {slow > 0 && <span>Slow mode: {slow}s</span>}
        {limits && text.length > limits.max_message_length * 0.8 && <span>{text.length}/{limits.max_message_length}</span>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- side panels -- */
function MemberList({ guildId, channel, onProfile, onClose }: { guildId: string; channel: Channel; onProfile: (id: string, el: HTMLElement) => void; onClose: () => void }) {
  const guild = useStore((s) => s.guilds[guildId]!);
  const members = useStore((s) => s.members[guildId]);
  const presences = useStore((s) => s.presences);
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const list = Object.values(members ?? {}).filter((m) => !q || memberName(guildId, m.user).toLowerCase().includes(q.toLowerCase()) || m.user.username.includes(q.toLowerCase()));
    const hoisted = guild.roles.filter((r) => r.hoist && r.id !== guild.id).sort((a, b) => b.position - a.position);
    const out: { label: string; color?: string | null; items: typeof list }[] = [];
    const taken = new Set<string>();
    const online = (m: (typeof list)[number]) => (presences[m.user.id] ?? "offline") !== "offline";
    for (const r of hoisted) {
      const items = list.filter((m) => !taken.has(m.user.id) && m.roles.includes(r.id) && online(m));
      items.forEach((m) => taken.add(m.user.id));
      if (items.length) out.push({ label: r.name, color: r.color, items });
    }
    const on = list.filter((m) => !taken.has(m.user.id) && online(m));
    const off = list.filter((m) => !taken.has(m.user.id) && !online(m));
    if (on.length) out.push({ label: "Online", items: on });
    if (off.length) out.push({ label: "Offline", items: off });
    for (const g of out) g.items.sort((a, b) => memberName(guildId, a.user).localeCompare(memberName(guildId, b.user)));
    return out;
  }, [members, presences, q, guild, guildId]);
  void channel;
  return (
    <aside className="side-panel members" data-region="members" aria-label="Members">
      <header className="panel-h m-only"><h3>Members</h3><button className="icon-btn sm" data-panel-close onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <input className="panel-search" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
      {!members && <p className="muted pad">Loading…</p>}
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="side-sec">{g.label} — {g.items.length}</h3>
          {g.items.map((m) => {
            const status = presences[m.user.id] ?? "offline";
            const role = guild.roles.filter((r) => m.roles.includes(r.id) && r.color).sort((a, b) => b.position - a.position)[0];
            return (
              <button key={m.user.id} className={`member ${status === "offline" ? "off" : ""}`} onClick={(e) => onProfile(m.user.id, e.currentTarget)} onContextMenu={(e) => { const el = e.currentTarget; openContextMenu(e, userMenuItems(m.user, { guildId, onProfile: () => onProfile(m.user.id, el) })); }}>
                <Avatar user={m.user} size={32} status={status} src={m.guild_avatar} serverTheme={m.guild_profile_theme ?? undefined} />
                <span className="member-txt"><span className="ellipsis block" style={role ? { color: role.color! } : undefined}>{m.nick || displayName(m.user)}{guild.owner_id === m.user.id && <span title="Server owner" aria-label="Server owner"> 👑</span>}{m.premium_since && <span title="Server Booster" aria-label="Server Booster"> ✨</span>}{m.user.bot && <span className="tag">APP</span>}</span>
                  <MemberActivity id={m.user.id} /></span>
              </button>
            );
          })}
        </section>
      ))}
    </aside>
  );
}

function MemberActivity({ id }: { id: string }) {
  const a = useStore((s) => s.activities[id]);
  if (!a) return null;
  return <small className="muted ellipsis block member-act">{["Playing", "Streaming", "Listening to", "Watching", "", "Competing in"][a.type] ?? "Playing"} <strong>{a.name}</strong></small>;
}

function Recipients({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const me = useStore((s) => s.me!);
  return (
    <aside className="side-panel members" data-region="members" aria-label="Members">
      <header className="panel-h m-only"><h3>Members</h3><button className="icon-btn sm" data-panel-close onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <h3 className="side-sec">Members — {(channel.recipients?.length ?? 0) + 1}</h3>
      {[me, ...(channel.recipients ?? [])].map((u) => (
        <div key={u.id} className="member">
          <Avatar user={u} size={32} status="" /><span className="ellipsis">{displayName(u)}{channel.owner_id === u.id && " 👑"}</span>
          {u.id !== me.id && <button className="icon-btn sm" aria-label={`Message ${displayName(u)}`} onClick={() => openDm(u.id)}><AtSign size={14} /></button>}
          {channel.owner_id === me.id && u.id !== me.id && <button className="icon-btn sm danger" aria-label={`Remove ${displayName(u)}`} onClick={() => api.del(`/api/channels/${channel.id}/recipients/${u.id}`).catch((e) => toast(errMsg(e), "error"))}><X size={14} /></button>}
        </div>
      ))}
      <button className="btn danger sm" onClick={async () => (await askConfirm({ title: "Leave this group?", body: "You won't get its messages unless someone adds you back.", confirmLabel: "Leave group", danger: true })) && api.del(`/api/channels/${channel.id}`).then(() => navigate("/channels/@me"))}>Leave group</button>
      <button className="btn sm" onClick={async () => { const name = await askText({ title: "Rename group", label: "Group name", initial: channel.name ?? "", optional: true }); if (name !== null) await api.patch(`/api/channels/${channel.id}`, { name }).catch((e) => toast(errMsg(e), "error")); }}>Rename group</button>
    </aside>
  );
}

function Pins({ channel, mdCtx, onClose }: { channel: Channel; mdCtx: any; onClose: () => void }) {
  const [list, setList] = useState<Message[] | null>(null);
  useEffect(() => { api.get<Message[]>(`/api/channels/${channel.id}/pins`).then(setList).catch(() => setList([])); }, [channel.id]);
  return (
    <LayerBox className="side-panel" data-region="panels" role="complementary" aria-label="Pinned messages" onDismiss={onClose} anchor={() => document.querySelector(".ch-actions [aria-label='Pinned messages']")} opts={{ blocksShortcuts: false }}>
      <header className="panel-h"><h3>Pinned messages</h3><button className="icon-btn sm" data-panel-close onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      {!list ? <p className="muted pad">Loading…</p> : !list.length ? <p className="muted pad">Nothing pinned yet.</p> : list.map((m) => <ResultCard key={m.id} m={m} mdCtx={mdCtx} />)}
    </LayerBox>
  );
}

function ResultCard({ m, mdCtx }: { m: Message; mdCtx: any }) {
  const ch = channelById(m.channel_id);
  return (
    <button className="result" onClick={() => navigate(`/channels/${m.guild_id ?? "@me"}/${m.channel_id}/${m.id}`)}>
      <div className="msg-head"><Avatar user={m.author} size={20} /><strong>{memberName(m.guild_id, m.author)}</strong><span className="muted small">{ch?.name ? `#${ch.name} · ` : ""}{fmtTime(m.created_at)}</span></div>
      <div className="msg-content"><Markdown text={m.content.slice(0, 500)} ctx={mdCtx} /></div>
      {m.attachments.length > 0 && <small className="muted">📎 {m.attachments.map((a) => a.filename).join(", ")}</small>}
    </button>
  );
}

function SearchPanel({ channel, guildId, mdCtx, onClose }: { channel: Channel; guildId: string | null; mdCtx: any; onClose: () => void }) {
  const [q, setQ] = useState(""); const [has, setHas] = useState(""); const [scope, setScope] = useState<"channel" | "all">("channel");
  const [author, setAuthor] = useState(""); const [after, setAfter] = useState(""); const [before, setBefore] = useState("");
  const [res, setRes] = useState<{ total: number; messages: Message[] } | null>(null); const [busy, setBusy] = useState(false);
  const members = useStore((s) => (guildId ? s.members[guildId] : null));
  const run = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true);
    const p = new URLSearchParams();
    if (q) p.set("q", q); if (has) p.set("has", has);
    if (scope === "channel") p.set("channel_id", channel.id); else if (guildId) p.set("guild_id", guildId);
    const a = author && Object.values(members ?? {}).find((m) => m.user.username === author.toLowerCase().replace(/^@/, ""));
    if (a) p.set("author_id", a.user.id);
    if (after) p.set("after", new Date(after).toISOString()); if (before) p.set("before", new Date(before).toISOString());
    try { setRes(await api.get(`/api/search?${p}`)); } catch (x) { toast(errMsg(x), "error"); } finally { setBusy(false); }
  };
  return (
    <LayerBox className="side-panel" data-region="panels" role="search" aria-label="Search" onDismiss={onClose} opts={{ outside: false, modal: false, blocksShortcuts: false }}>
      <header className="panel-h"><h3>Search</h3><button className="icon-btn sm" data-panel-close onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      <form className="search-form" onSubmit={run}>
        <input autoFocus placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search text" />
        <div className="row">
          <Select value={scope} onChange={(e) => setScope(e.target.value as any)} aria-label="Scope"><option value="channel">This channel</option><option value="all">{guildId ? "Whole server" : "All DMs"}</option></Select>
          <Select value={has} onChange={(e) => setHas(e.target.value)} aria-label="Has"><option value="">Anything</option><option value="link">Has link</option><option value="file">Has file</option><option value="image">Has image</option><option value="video">Has video</option><option value="audio">Has audio</option><option value="pinned">Pinned</option></Select>
        </div>
        {guildId && <input placeholder="From username" value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="From user" />}
        <div className="row"><label className="small">After <input type="date" value={after} onChange={(e) => setAfter(e.target.value)} /></label><label className="small">Before <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} /></label></div>
        <button className="btn primary sm" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {res && <p className="muted small pad">{res.total} result{res.total === 1 ? "" : "s"}</p>}
      {res?.messages.map((m) => <ResultCard key={m.id} m={m} mdCtx={mdCtx} />)}
    </LayerBox>
  );
}

export { Copy };
