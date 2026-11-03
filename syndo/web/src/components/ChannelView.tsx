import { DmPrivacyBar } from "./DmPrivacy.tsx";
import { useShallow } from "zustand/react/shallow";
import {
  AtSign, Bookmark, BookmarkCheck, Copy, CornerUpLeft, File as FileIcon, Hash, Link2, Paperclip, Pencil, Phone, Pin, PinOff,
  Search, SendHorizontal, SmilePlus, Trash2, Users, Video, X, RotateCcw, Megaphone, Volume2, UserPlus, Mic, Square, Bell, BellOff,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChannelType, MessageType, P, has, type Channel, type Message } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { ackChannel, discardFailed, loadMembers, loadMessages, openDm, sendMessage, sendTyping, setConversationMuted, startUpload, toggleReaction, type PendingUpload } from "../actions.ts";
import { Markdown, plainText } from "../markdown.tsx";
import { messageLink, navigate, setTitle } from "../router.ts";
import { can, channelById, displayName, dmTitle, memberName, toast, useStore, type UIMessage } from "../store.ts";
import { joinVoice, useVoice } from "../voice/session.ts";
import { openDialog } from "./Shell.tsx";
import { Avatar, fmtBytes, fmtTime, Modal } from "./ui.tsx";
import { ProfileCard } from "./Dialogs.tsx";
import { ChannelType as CT } from "@syndo/shared";
import { Palette } from "lucide-react";
import { Backdrop, useActiveBackground } from "../appearance/Backdrop.tsx";
import { ConversationPanel } from "../appearance/ConversationPanel.tsx";
import { StyledName, useCosmetics } from "../appearance/effects.tsx";
import { scopeKey, useAppearance } from "../appearance/store.ts";
import { useMentionAutocomplete } from "./MentionAutocomplete.tsx";

const QUICK = ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "🌻", "✨", "👀", "🔥", "💙"];

export function ChannelView({ channelId, guildId, highlight }: { channelId: string; guildId: string | null; highlight: string | null }) {
  const channel = useStore(() => channelById(channelId));
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : null));
  const data = useStore((s) => s.messages[channelId]);
  const showMembersDefault = useAppearance((s) => s.resolved.theme.layout.showMembers);
  const [panel, setPanel] = useState<null | "members" | "pins" | "search" | "appearance">(guildId && showMembersDefault ? "members" : null);
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
    try {
      await api.post(`/api/channels/${channel.id}/call`);
      await joinVoice(channel.id);
      if (video) (await import("../voice/session.ts")).toggleCamera();
    } catch (e) { toast(errMsg(e), "error"); }
  };
  const mdCtx = { guildId, onMention: (id: string, el: HTMLElement) => setProfile({ id, el }), onChannel: (id: string) => { const c = channelById(id); if (c) navigate(`/channels/${c.guild_id ?? "@me"}/${id}`); } };

  return (
    <div className="channel">
      <header className="ch-h" data-region="header">
        {isDm && channel.type === ChannelType.DM ? <Avatar user={channel.recipients?.[0]} size={26} status="" /> : <Icon size={22} aria-hidden className="muted" />}
        <h1 className="ellipsis">{isDm ? (label && channel.type === ChannelType.DM ? <><span className="local-label" title="Your private label — only you see it">{label}</span> <span className="muted small">{dmTitle(channel)}</span></> : dmTitle(channel)) : channel.name}</h1>
        {channel.topic && <span className="topic ellipsis" title={channel.topic}>{channel.topic}</span>}
        <div className="ch-actions">
          <button className={`icon-btn ${muted ? "active" : ""}`} disabled={muteBusy} aria-pressed={muted} aria-label={muted ? "Unmute conversation" : "Mute conversation"} title={muted ? "Unmute notifications" : "Mute notifications"} onClick={async () => {
            setMuteBusy(true);
            try { await setConversationMuted(channelId, !muted); toast(muted ? "Notifications unmuted." : "Conversation muted. You can still read and send messages.", "success"); }
            catch (e) { toast(errMsg(e), "error"); }
            finally { setMuteBusy(false); }
          }}>{muted ? <BellOff size={20} /> : <Bell size={20} />}</button>
          {isDm && <button className="icon-btn" aria-label="Start voice call" title="Voice call" onClick={() => startCall(false)}><Phone size={20} /></button>}
          {isDm && <button className="icon-btn" aria-label="Start video call" title="Video call" onClick={() => startCall(true)}><Video size={20} /></button>}
          {isDm && channel.type === ChannelType.GROUP_DM && <button className="icon-btn" aria-label="Add friends" onClick={() => openDialog({ kind: "groupDm" })}><UserPlus size={20} /></button>}
          <button className={`icon-btn ${panel === "pins" ? "active" : ""}`} aria-pressed={panel === "pins"} aria-label="Pinned messages" onClick={() => setPanel(panel === "pins" ? null : "pins")}><Pin size={20} /></button>
          {(guildId || channel.type === ChannelType.GROUP_DM) && <button className={`icon-btn ${panel === "members" ? "active" : ""}`} aria-pressed={panel === "members"} aria-label="Member list" onClick={() => setPanel(panel === "members" ? null : "members")}><Users size={20} /></button>}
          <button className={`icon-btn ${panel === "search" ? "active" : ""}`} aria-pressed={panel === "search"} aria-label="Search" onClick={() => setPanel(panel === "search" ? null : "search")}><Search size={20} /></button>
          <button className={`icon-btn ${panel === "appearance" ? "active" : ""}`} aria-pressed={panel === "appearance"} aria-label="Edit appearance for this conversation" title="Edit appearance" onClick={() => setPanel(panel === "appearance" ? null : "appearance")}><Palette size={20} /></button>
        </div>
      </header>
      {call && call.ringing.length > 0 && !inVoiceHere && (
        <div className="call-banner" role="alert">
          <Phone size={18} /> <span>{call.ringing.includes(useStore.getState().me!.id) ? "Incoming call" : "Ringing…"}</span>
          <button className="btn primary sm" onClick={() => joinVoice(channel.id)}>Join</button>
          <button className="btn danger sm" onClick={() => api.post(`/api/channels/${channel.id}/call/decline`)}>Decline</button>
        </div>
      )}
      <div className="ch-body">
        <div className="ch-main" data-region="chat">
          {bg && target === "chat" && <Backdrop bg={bg} className="chat-bd" />}
          {!channel.guild_id && <DmPrivacyBar channel={channel.id}/>}
        <MessageList channel={channel} data={data} highlight={highlight} onReply={setReply} mdCtx={mdCtx} />
          <Typing channelId={channel.id} guildId={guildId} />
          <Composer channel={channel} title={title} reply={reply} onClearReply={() => setReply(null)} />
        </div>
        {panel === "members" && (guildId ? <MemberList guildId={guildId} channel={channel} onProfile={(id, el) => setProfile({ id, el })} /> : <Recipients channel={channel} />)}
        {panel === "pins" && <Pins channel={channel} mdCtx={mdCtx} onClose={() => setPanel(null)} />}
        {panel === "appearance" && <ConversationPanel channel={channel} onClose={() => setPanel(null)} />}
        {panel === "search" && <SearchPanel channel={channel} guildId={guildId} mdCtx={mdCtx} onClose={() => setPanel(null)} />}
      </div>
      {profile && <ProfileCard userId={profile.id} guildId={guildId} anchor={profile.el} onClose={() => setProfile(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------- list -- */
function MessageList({ channel, data, highlight, onReply, mdCtx }: { channel: Channel; data: ReturnType<typeof useStore.getState>["messages"][string] | undefined; highlight: string | null; onReply: (m: Message) => void; mdCtx: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevHeight = useRef(0);
  const list = data?.list ?? [];
  const lastRead = useRef(useStore.getState().readStates[channel.id]?.last_read_id ?? null);
  const canHistory = can(channel, P.READ_MESSAGE_HISTORY) || !channel.guild_id;
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
  }, [list.length, highlight]);

  const onScroll = () => {
    const el = ref.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200 && data?.hasMore && !data.loading && list.length) {
      prevHeight.current = el.scrollHeight;
      loadMessages(channel.id, { before: list.find((m) => !m._state)?.id });
    }
  };

  return (
    <div className="msgs" ref={ref} onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions" aria-label={`Messages in ${channel.name ?? "conversation"}`} tabIndex={0}>
      {!canHistory && <p className="muted pad">You can't read the history of this channel.</p>}
      {data && !data.hasMore && <Welcome channel={channel} />}
      {data?.loading && <p className="muted pad center">Loading messages…</p>}
      {list.map((m, i) => {
        const prev = list[i - 1];
        const day = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
        const grouped = groupingOn && !!prev && !day && prev.author.id === m.author.id && m.type === 0 && prev.type === 0 && !m.reply_to && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 7 * 60_000;
        const newLine = lastRead.current && prev && !m._state && BigInt(prev.id.replace(/\D/g, "") || "0") <= BigInt(lastRead.current) && BigInt(m.id) > BigInt(lastRead.current) && m.author.id !== useStore.getState().me?.id;
        return (
          <div key={m.id}>
            {day && <div className="day-div" role="separator"><span>{new Date(m.created_at).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span></div>}
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
      <div className="welcome-ico">{channel.guild_id ? <Hash size={36} /> : <Avatar user={channel.recipients?.[0]} size={72} />}</div>
      <h2>{channel.guild_id ? `Welcome to #${channel.name}!` : dmTitle(channel)}</h2>
      <p className="muted">{channel.guild_id ? "This is the start of the channel." : "This is the beginning of your conversation."}</p>
    </div>
  );
}

const MessageRow = memo(function MessageRow({ m, channel, grouped, onReply, mdCtx }: { m: UIMessage; channel: Channel; grouped: boolean; onReply: (m: Message) => void; mdCtx: any }) {
  const me = useStore((s) => s.me!);
  const guildId = channel.guild_id;
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
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
  if (m.type !== 0 && m.type !== 19) return <SystemMessage m={m} channel={channel} />;
  const name = m.member_nick || memberName(guildId, m.author);
  const cos = useCosmetics(m.author, m.member?.profile_theme ?? undefined);
  const nameStyle = roleColor ? (roleColor.c2 ? { backgroundImage: `linear-gradient(90deg, ${roleColor.c}, ${roleColor.c2})`, WebkitBackgroundClip: "text", color: "transparent" } : { color: roleColor.c }) : undefined;
  const del = async () => {
    if (!confirm("Delete this message?")) return;
    try { await api.del(`/api/channels/${channel.id}/messages/${m.id}`); } catch (e) { toast(errMsg(e), "error"); }
  };
  const pin = async () => { try { m.pinned ? await api.del(`/api/channels/${channel.id}/pins/${m.id}`) : await api.put(`/api/channels/${channel.id}/pins/${m.id}`); } catch (e) { toast(errMsg(e), "error"); } };
  const save = async () => { try { await api.put(`/api/users/@me/saved/${m.id}`); toast("Saved for later.", "success"); } catch (e) { toast(errMsg(e), "error"); } };
  return (
    <article className={`msg ${grouped ? "grouped" : ""} ${mentioned ? "mentioned" : ""} ${mine ? "mine" : ""} ${m._state ?? ""}`} data-mid={m.id} aria-label={`${name}, ${fmtTime(m.created_at)}`} tabIndex={-1}>
      {m.reply_to && (
        <button className="reply-ref" onClick={() => navigate(`/channels/${guildId ?? "@me"}/${channel.id}/${m.reply_to!.id}`)}>
          <CornerUpLeft size={14} aria-hidden /> {m.reply_to.deleted ? <em className="muted">Original message was deleted</em> : <><strong>@{m.reply_to.author ? memberName(guildId, m.reply_to.author) : "unknown"}</strong> <span className="ellipsis">{plainText(m.reply_to.content)}</span></>}
        </button>
      )}
      <div className="msg-row">
        <div className="msg-gutter">{grouped ? <time className="msg-time-hover" dateTime={m.created_at}>{new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
          : <button className="av-btn" aria-label={`${name}'s profile`} onClick={(e) => mdCtx.onMention(m.author.id, e.currentTarget)}><Avatar user={m.author} size={40} src={m.member?.avatar ?? undefined} serverTheme={m.member?.profile_theme ?? undefined} /></button>}</div>
        <div className="msg-body">
          {!grouped && <div className="msg-head"><button className="msg-name" style={nameStyle} onClick={(e) => mdCtx.onMention(m.author.id, e.currentTarget)}><StyledName theme={cos.theme} animate={cos.animate}>{name}</StyledName></button>{m.author.bot && <span className="tag">APP</span>}<time dateTime={m.created_at} className="muted small">{fmtTime(m.created_at)}</time></div>}
          {editing ? <EditBox m={m} onDone={() => setEditing(false)} /> : (
            <div className="msg-content">
              {m.content && <Markdown text={m.content} ctx={mdCtx} />}
              {!m.guild_id && m.type === 0 && <small className="muted encryption-mark">{m._encrypted ? " · Encrypted" : m._encryptionError ? " · Locked" : " · Older unencrypted message"}</small>}
              {m.edited_at && <span className="muted small" title={`Edited ${fmtTime(m.edited_at)}`}> (edited)</span>}
            </div>
          )}
          {m.attachments.map((a) => <AttachmentView key={a.id} a={a} />)}
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
                <button key={r.emoji} className={`reaction ${r.me ? "me" : ""}`} aria-pressed={r.me} aria-label={`${r.emoji} ${r.count} reaction${r.count === 1 ? "" : "s"}`} onClick={() => toggleReaction(m, r.emoji)}>
                  <span className="r-emoji">{r.emoji}</span> {r.count}
                </button>
              ))}
              {can(channel, P.ADD_REACTIONS) || !guildId ? <button className="reaction add" aria-label="Add reaction" onClick={() => setPicker(true)}><SmilePlus size={14} /></button> : null}
            </div>
          )}
        </div>
      </div>
      {!m._state && !editing && (
        <div className="msg-tools" role="toolbar" aria-label="Message actions">
          {QUICK.slice(0, 3).map((e) => <button key={e} className="icon-btn sm" aria-label={`React ${e}`} onClick={() => toggleReaction(m, e)}>{e}</button>)}
          <button className="icon-btn sm" aria-label="Add reaction" onClick={() => setPicker(true)}><SmilePlus size={16} /></button>
          <button className="icon-btn sm" aria-label="Reply" onClick={() => onReply(m)}><CornerUpLeft size={16} /></button>
          {mine && <button className="icon-btn sm" aria-label="Edit" onClick={() => setEditing(true)}><Pencil size={16} /></button>}
          {(canManage || !guildId) && <button className="icon-btn sm" aria-label={m.pinned ? "Unpin" : "Pin"} onClick={pin}>{m.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>}
          <button className="icon-btn sm" aria-label="Save message" onClick={save}><Bookmark size={16} /></button>
          <button className="icon-btn sm" aria-label="Copy message link" onClick={() => { navigator.clipboard.writeText(messageLink(guildId, channel.id, m.id)); toast("Link copied.", "success"); }}><Link2 size={16} /></button>
          <button className="icon-btn sm" aria-label="Mark unread" onClick={() => api.post(`/api/channels/${channel.id}/messages/${m.id}/unread`)}><BookmarkCheck size={16} /></button>
          {(mine || canManage) && <button className="icon-btn sm danger" aria-label="Delete" onClick={del}><Trash2 size={16} /></button>}
        </div>
      )}
      {picker && <EmojiPicker onPick={(e) => { toggleReaction(m, e); setPicker(false); }} onClose={() => setPicker(false)} />}
    </article>
  );
});

function SystemMessage({ m, channel }: { m: UIMessage; channel: Channel }) {
  const users = useStore((s) => s.users);
  const who = memberName(channel.guild_id, m.author);
  let text: React.ReactNode = null;
  if (m.type === MessageType.MEMBER_JOIN) text = <><strong>{who}</strong> joined. Say hi! 👋</>;
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

function AttachmentView({ a }: { a: Message["attachments"][number] }) {
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
  return <AttachmentContent a={{ ...a, url }} />;
}
function AttachmentContent({ a }: { a: Message["attachments"][number] }) {
  const [open, setOpen] = useState(false);
  if (a.content_type.startsWith("image/")) return (
    <>
      <button className="att-img" onClick={() => setOpen(true)} aria-label={`Open image ${a.filename}`}>
        <img src={a.url} alt={a.filename} loading="lazy" style={a.width && a.height ? { aspectRatio: `${a.width}/${a.height}` } : undefined} />
      </button>
      {open && <Modal onClose={() => setOpen(false)} label={a.filename} wide><img className="lightbox" src={a.url} alt={a.filename} /><a href={a.url} target="_blank" rel="noreferrer">Open original</a></Modal>}
    </>
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
        onKeyDown={(e) => { if (e.key === "Escape") onDone(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } }} />
      <small className="muted">escape to cancel · enter to save</small>
    </div>
  );
}

export function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ALL = "😀 😃 😄 😁 😆 🥹 😅 😂 🤣 🥲 😊 😇 🙂 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤯 😳 🥵 🥶 😱 😨 🤗 🤔 🫡 🤭 🤫 😶 😐 😑 😬 🙄 😯 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 👍 👎 👏 🙌 👐 🤝 🙏 ✌️ 🤞 🫶 🤟 🤘 👌 👋 💪 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💖 💕 💯 ✨ 🌟 ⭐ 🔥 🎉 🎊 🌻 🌈 ☀️ 🌙 ⚡ 🍀 🌸 🐶 🐱 🦊 🐻 🐼 🐨 🦁 🐸 🐧 🦄 🍕 🍔 🍟 🍩 🍪 🎂 🍰 ☕ 🧋 🎮 🎧 🎵 🎨 📚 ⚽ 🏀 🚀 🧦 👀 ✅ ❌ ❓ ❗".split(" ");
  const [q, setQ] = useState("");
  return (
    <div className="picker" role="dialog" aria-label="Pick an emoji" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="picker-h"><input autoFocus placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter emoji" /><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
      <div className="picker-grid">{ALL.filter((e) => !q || e.includes(q)).map((e) => <button key={e} onClick={() => onPick(e)} aria-label={e}>{e}</button>)}</div>
    </div>
  );
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
  const mentions = useMentionAutocomplete(channel, text, setText, ta);
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
      if (limits && f.size > limits.max_upload_bytes) { toast(`${f.name} is larger than this server's ${fmtBytes(limits.max_upload_bytes)} limit.`, "error"); continue; }
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
    setText(""); setUploads([]); onClearReply();
    await sendMessage(channel.id, content, { reply_to: reply?.id, attachment_ids: ready.map((u) => u.id!) });
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
      rec.onstop = () => {
        clearInterval(timer); ctx.close(); stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const duration = (Date.now() - started) / 1000;
        if (duration < 0.5) return;
        const step = Math.max(1, Math.floor(levels.length / 64));
        const wf = btoa(String.fromCharCode(...levels.filter((_, i) => i % step === 0).slice(0, 64)));
        const file = new File([blob], `voice-message.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type });
        if (confirm(`Send this ${Math.round(duration)}s voice message?`)) {
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
    <div className="composer-wrap" data-region="composer" onDragOver={(e) => { e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
      {reply && <div className="reply-bar">Replying to <strong>{memberName(channel.guild_id, reply.author)}</strong><button className="icon-btn sm" aria-label="Cancel reply" onClick={onClearReply}><X size={14} /></button></div>}
      {uploads.length > 0 && (
        <ul className="uploads" aria-label="Attachments">
          {uploads.map((u) => (
            <li key={u.key} className={`upload u-${u.status}`}>
              <FileIcon size={18} aria-hidden /><span className="ellipsis">{u.file.name}</span>
              {u.status === "uploading" && <progress max={1} value={u.progress} aria-label={`Uploading ${u.file.name}`} />}
              {u.status === "error" && <><span className="danger-text small">{u.error}</span><button className="link" onClick={() => { setUploads((l) => l.filter((x) => x.key !== u.key)); addFiles([u.file]); }}>Retry</button></>}
              <button className="icon-btn sm" aria-label={u.status === "uploading" ? "Cancel upload" : "Remove"} onClick={() => { u.cancel?.(); if (u.id) api.del(`/api/attachments/${u.id}`).catch(() => {}); setUploads((l) => l.filter((x) => x.key !== u.key)); }}><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {mentions.popup}
      <div className="composer">
        {canAttach && <><button className="icon-btn" aria-label="Attach files" onClick={() => fileIn.current?.click()}><Paperclip size={20} /></button>
          <input ref={fileIn} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} /></>}
        <textarea ref={ta} rows={1} value={text} placeholder={`Message ${title}`} aria-label={`Message ${title}`} maxLength={limits?.max_message_length} {...mentions.inputProps} onSelect={mentions.onSelect} onBlur={mentions.onBlur}
          onChange={(e) => { setText(e.target.value); if (e.target.value) sendTyping(channel.id); }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          onKeyDown={(e) => { if (mentions.onKeyDown(e)) return; if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } if (e.key === "Escape" && reply) onClearReply(); }} />
        {recording ? <button className="icon-btn danger" aria-label="Stop recording" onClick={() => { recording.rec.stop(); setRecording(null); }}><Square size={18} /></button>
          : canAttach && <button className="icon-btn" aria-label="Record a voice message" onClick={startRec}><Mic size={20} /></button>}
        <button className="icon-btn" aria-label="Send" onClick={submit}><SendHorizontal size={20} /></button>
      </div>
      <div className="composer-meta muted small">
        {slow > 0 && <span>Slow mode: {slow}s</span>}
        {limits && text.length > limits.max_message_length * 0.8 && <span>{text.length}/{limits.max_message_length}</span>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- side panels -- */
function MemberList({ guildId, channel, onProfile }: { guildId: string; channel: Channel; onProfile: (id: string, el: HTMLElement) => void }) {
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
      <input className="panel-search" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search members" />
      {!members && <p className="muted pad">Loading…</p>}
      {groups.map((g) => (
        <section key={g.label}>
          <h3 className="side-sec">{g.label} — {g.items.length}</h3>
          {g.items.map((m) => {
            const status = presences[m.user.id] ?? "offline";
            const role = guild.roles.filter((r) => m.roles.includes(r.id) && r.color).sort((a, b) => b.position - a.position)[0];
            return (
              <button key={m.user.id} className={`member ${status === "offline" ? "off" : ""}`} onClick={(e) => onProfile(m.user.id, e.currentTarget)}>
                <Avatar user={m.user} size={32} status={status} src={m.guild_avatar} serverTheme={m.guild_profile_theme ?? undefined} />
                <span className="ellipsis" style={role ? { color: role.color! } : undefined}>{m.nick || displayName(m.user)}{guild.owner_id === m.user.id && <span title="Server owner" aria-label="Server owner"> 👑</span>}</span>
              </button>
            );
          })}
        </section>
      ))}
    </aside>
  );
}

function Recipients({ channel }: { channel: Channel }) {
  const me = useStore((s) => s.me!);
  return (
    <aside className="side-panel members" data-region="members" aria-label="Members">
      <h3 className="side-sec">Members — {(channel.recipients?.length ?? 0) + 1}</h3>
      {[me, ...(channel.recipients ?? [])].map((u) => (
        <div key={u.id} className="member">
          <Avatar user={u} size={32} status="" /><span className="ellipsis">{displayName(u)}{channel.owner_id === u.id && " 👑"}</span>
          {u.id !== me.id && <button className="icon-btn sm" aria-label={`Message ${displayName(u)}`} onClick={() => openDm(u.id)}><AtSign size={14} /></button>}
          {channel.owner_id === me.id && u.id !== me.id && <button className="icon-btn sm danger" aria-label={`Remove ${displayName(u)}`} onClick={() => api.del(`/api/channels/${channel.id}/recipients/${u.id}`).catch((e) => toast(errMsg(e), "error"))}><X size={14} /></button>}
        </div>
      ))}
      <button className="btn danger sm" onClick={() => confirm("Leave this group?") && api.del(`/api/channels/${channel.id}`).then(() => navigate("/channels/@me"))}>Leave group</button>
      <button className="btn sm" onClick={async () => { const name = prompt("Group name", channel.name ?? ""); if (name !== null) await api.patch(`/api/channels/${channel.id}`, { name }).catch((e) => toast(errMsg(e), "error")); }}>Rename group</button>
    </aside>
  );
}

function Pins({ channel, mdCtx, onClose }: { channel: Channel; mdCtx: any; onClose: () => void }) {
  const [list, setList] = useState<Message[] | null>(null);
  useEffect(() => { api.get<Message[]>(`/api/channels/${channel.id}/pins`).then(setList).catch(() => setList([])); }, [channel.id]);
  return (
    <aside className="side-panel" data-region="panels" aria-label="Pinned messages">
      <header className="panel-h"><h3>Pinned messages</h3><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      {!list ? <p className="muted pad">Loading…</p> : !list.length ? <p className="muted pad">Nothing pinned yet.</p> : list.map((m) => <ResultCard key={m.id} m={m} mdCtx={mdCtx} />)}
    </aside>
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
    <aside className="side-panel" data-region="panels" aria-label="Search">
      <header className="panel-h"><h3>Search</h3><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      <form className="search-form" onSubmit={run}>
        <input autoFocus placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search text" />
        <div className="row">
          <select value={scope} onChange={(e) => setScope(e.target.value as any)} aria-label="Scope"><option value="channel">This channel</option><option value="all">{guildId ? "Whole server" : "All DMs"}</option></select>
          <select value={has} onChange={(e) => setHas(e.target.value)} aria-label="Has"><option value="">Anything</option><option value="link">Has link</option><option value="file">Has file</option><option value="image">Has image</option><option value="video">Has video</option><option value="audio">Has audio</option><option value="pinned">Pinned</option></select>
        </div>
        {guildId && <input placeholder="From username" value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="From user" />}
        <div className="row"><label className="small">After <input type="date" value={after} onChange={(e) => setAfter(e.target.value)} /></label><label className="small">Before <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} /></label></div>
        <button className="btn primary sm" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {res && <p className="muted small pad">{res.total} result{res.total === 1 ? "" : "s"}</p>}
      {res?.messages.map((m) => <ResultCard key={m.id} m={m} mdCtx={mdCtx} />)}
    </aside>
  );
}

export { Copy };
