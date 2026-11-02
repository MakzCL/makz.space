import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft, Check, CheckCheck, CornerUpLeft, FileText, Hash, Image as ImageIcon, Loader2, MessageSquarePlus, Paperclip,
  Pencil, Phone, PhoneIncoming, Search, Send, SmilePlus, Trash2, Users, Video, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useCalls } from "../components/Calls";
import { SceneTabs } from "../components/Scene";
import { useToast } from "../components/Toast";
import { Btn, Chip, Empty, Field, Sheet, list } from "../components/ui";
import { STATUS_META, prepareImage, shownStatus, useConversations, useOnline, useSignedUrl, type ConvView } from "../lib/comms";
import { locale, t } from "../lib/i18n";
import { useDesktop } from "../lib/media";
import { buzz } from "../lib/prefs";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { ago, clock, dayLabel } from "../lib/time";
import type { Attachment, Message, Profile } from "../lib/types";
import { CalendarView } from "./Calendar";

const EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function PresenceDot({ p, size = 12 }: { p: Profile | undefined; size?: number }) {
  const online = useOnline();
  const s = shownStatus(p, online);
  return <i className={`pdot s-${s}`} style={{ width: size, height: size, background: STATUS_META[s].color }} title={t(STATUS_META[s].label)} />;
}

/* ================================================================ hub == */
export function ChatHub({ openConv, onOpenConv, openEvent, onOpenEvent }: {
  openConv: string | null; onOpenConv: (id: string | null) => void; openEvent: string | null; onOpenEvent: (id: string | null) => void;
}) {
  const [view, setView] = useState<"chats" | "channels" | "calendar">(openEvent ? "calendar" : "chats");
  useEffect(() => { if (openEvent) setView("calendar"); }, [openEvent]);
  useEffect(() => { if (openConv) setView((v) => (v === "calendar" ? "chats" : v)); }, [openConv]);
  const desktop = useDesktop();
  const convs = useConversations();
  const unreadChats = convs.filter((v) => v.c.kind !== "channel").reduce((n, v) => n + v.unread, 0);
  const unreadCh = convs.filter((v) => v.c.kind === "channel").reduce((n, v) => n + v.unread, 0);
  return (
    <motion.div className="page chat-page" initial="hidden" animate="show" variants={list}>
      <SceneTabs kind="town" height={desktop ? 150 : 160} value={view} onChange={setView} title={t("Chat")} sub={t("Messages, calls and meetings")}
        tabs={[
          { value: "chats", label: t("Chats") + (unreadChats ? ` · ${unreadChats}` : "") },
          { value: "channels", label: t("Channels") + (unreadCh ? ` · ${unreadCh}` : "") },
          { value: "calendar", label: t("Calendar") },
        ]} />
      {view === "calendar" ? <CalendarView openEvent={openEvent} onOpenEvent={onOpenEvent} />
        : <ChatsView channels={view === "channels"} convs={convs} openConv={openConv} onOpenConv={onOpenConv} />}
    </motion.div>
  );
}

function ChatsView({ channels, convs, openConv, onOpenConv }: { channels: boolean; convs: ConvView[]; openConv: string | null; onOpenConv: (id: string | null) => void }) {
  const { me } = useStore();
  const desktop = useDesktop();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const shown = convs.filter((v) => (channels ? v.c.kind === "channel" : v.c.kind !== "channel"))
    .filter((v) => !q || v.title.toLowerCase().includes(q.toLowerCase()));
  const current = convs.find((v) => v.c.id === openConv);
  const listEl = (
    <div className="stack">
      <div className="row gap">
        <div className="searchbar grow"><Search size={18} /><input placeholder={channels ? t("Search channels…") : t("Search chats…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {(!channels || can.admin(me.role)) && <button className="icon-btn big-ic" onClick={() => setCreating(true)} aria-label={channels ? t("New channel") : t("New chat")}><MessageSquarePlus size={20} /></button>}
      </div>
      <div className="conv-list">
        {shown.map((v) => <ConvRow key={v.c.id} v={v} on={v.c.id === openConv} onClick={() => onOpenConv(v.c.id)} />)}
        {!shown.length && <Empty icon={channels ? <Hash size={26} /> : <MessageSquarePlus size={26} />} title={channels ? t("No channels") : t("No chats yet")}
          hint={channels ? undefined : t("Start one with the button above — pick a person or a few for a group.")} />}
      </div>
      <NewChatSheet open={creating} channel={channels} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpenConv(id); }} />
    </div>
  );
  if (desktop) {
    return (
      <div className="chat-split">
        <div className="chat-list-col">{listEl}</div>
        <div className="chat-main card">{current ? <Conversation v={current} onBack={() => onOpenConv(null)} /> : <div className="chat-empty"><MessageSquarePlus size={34} /><p className="muted">{t("Pick a chat or start a new one")}</p></div>}</div>
      </div>
    );
  }
  return (
    <>
      {listEl}
      <AnimatePresence>
        {current && (
          <motion.div className="chat-full" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 340, damping: 34 }}>
            <Conversation v={current} onBack={() => onOpenConv(null)} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function ConvRow({ v, on, onClick }: { v: ConvView; on: boolean; onClick: () => void }) {
  const { me, person, db } = useStore();
  const last = v.last;
  const who = last?.sender_id === me.id ? t("You") : person(last?.sender_id)?.full_name.split(" ")[0];
  const preview = !last ? (v.c.topic || t("No messages yet")) : last.deleted_at ? t("Message deleted") : last.kind === "call" ? `${last.body === "voice" ? "📞" : "🎥"} ${t("Call")}`
    : last.kind === "system" ? `${person(last.sender_id)?.full_name.split(" ")[0] ?? ""} ${t(last.body)}`
    : last.body || (last.attachments[0]?.type?.startsWith("image/") ? "📷 " + t("Photo") : last.attachments[0]?.type?.startsWith("video/") ? "🎬 " + t("Video") : "📎 " + t("File"));
  const joined = db.conversation_members.some((m) => m.conversation_id === v.c.id && m.user_id === me.id);
  return (
    <button className={`conv-row ${on ? "on" : ""} ${v.unread ? "unread" : ""}`} onClick={onClick}>
      <span className="conv-av">
        {v.c.kind === "direct" ? <><Avatar p={v.other} size={46} /><PresenceDot p={v.other} /></>
          : v.c.kind === "channel" ? <span className="ch-av"><Hash size={20} /></span> : <span className="ch-av grp"><Users size={20} /></span>}
      </span>
      <span className="grow">
        <span className="row between"><b>{v.title}</b><small className="muted">{last ? ago(last.created_at) : ""}</small></span>
        <span className="row between"><small className="conv-prev">{last && v.c.kind !== "direct" && last.kind === "text" && who ? `${who}: ` : ""}{preview}</small>
          {v.unread > 0 ? <span className="unread-pill">{v.unread}</span> : v.c.kind === "channel" && !joined ? <small className="muted">{t("Join")}</small> : null}</span>
      </span>
    </button>
  );
}

/* ======================================================== conversation == */
function Conversation({ v, onBack }: { v: ConvView; onBack: () => void }) {
  const { db, me, person, backend, patch, refresh } = useStore();
  const toast = useToast();
  const calls = useCalls();
  const online = useOnline();
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [info, setInfo] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const chan = useRef<ReturnType<typeof backend.channel> | null>(null);
  const lastTyping = useRef(0);
  const c = v.c;
  const isMember = v.members.includes(me.id);
  const msgs = useMemo(() => db.messages.filter((m) => m.conversation_id === c.id).sort((a, b) => a.created_at.localeCompare(b.created_at)), [db.messages, c.id]);
  const members = db.conversation_members.filter((m) => m.conversation_id === c.id);
  const activeCall = db.calls.find((k) => k.conversation_id === c.id && k.status !== "ended" && Date.now() - new Date(k.started_at).getTime() < 12 * 3600e3);

  // Typing indicator over a realtime room.
  useEffect(() => {
    const ch = backend.channel(`chat:${c.id}`);
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { user: string };
      if (p.user !== me.id) setTyping((x) => ({ ...x, [p.user]: Date.now() }));
    });
    ch.subscribe();
    chan.current = ch;
    const i = setInterval(() => setTyping((x) => Object.fromEntries(Object.entries(x).filter(([, at]) => Date.now() - at < 4000))), 1500);
    return () => { clearInterval(i); backend.removeChannel(ch); chan.current = null; };
  }, [backend, c.id, me.id]);

  // Read receipts: mark read while the chat is open; clear its notifications.
  const lastId = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    const mem = members.find((m) => m.user_id === me.id);
    const newest = msgs[msgs.length - 1];
    if (mem && newest && newest.created_at > mem.last_read_at && document.visibilityState === "visible") {
      const at = new Date().toISOString();
      patch("conversation_members", (rows) => rows.map((r) => (r.id === mem.id ? { ...r, last_read_at: at } : r)));
      backend.update("conversation_members", mem.id, { last_read_at: at }).catch(() => {});
    }
    const notes = db.notifications.filter((n) => n.user_id === me.id && !n.read_at && n.link?.conversation_id === c.id && n.kind === "message");
    if (notes.length) {
      const at = new Date().toISOString();
      patch("notifications", (rows) => rows.map((r) => (notes.some((n) => n.id === r.id) ? { ...r, read_at: at } : r)));
      notes.forEach((n) => backend.update("notifications", n.id, { read_at: at }).catch(() => {}));
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [c.id]);

  const ensureMember = async () => {
    if (isMember) return;
    await backend.insert("conversation_members", { conversation_id: c.id, user_id: me.id });
    await refresh("conversation_members");
  };
  const send = async (attachments: Attachment[] = []) => {
    const body = text.trim();
    if (!body && !attachments.length) return;
    try {
      await ensureMember();
      if (editing) {
        await backend.update("messages", editing.id, { body });
        setEditing(null); setText(""); return;
      }
      setText(""); setReply(null);
      const m = await backend.insert("messages", { conversation_id: c.id, sender_id: me.id, kind: "text", body, attachments, reply_to: reply?.id ?? null });
      patch("messages", (rows) => (rows.some((r) => r.id === m.id) ? rows : [...rows, m]));
      buzz(6);
    } catch (e) { toast(t((e as Error).message), "error"); setText(body); }
  };
  const upload = async (files: FileList | File[]) => {
    const arr = [...files];
    if (!arr.length) return;
    try { await ensureMember(); } catch (e) { toast(t((e as Error).message), "error"); return; }
    for (const f of arr) {
      if (f.size > 50 * 1024 * 1024) { toast(t("{name} is over 50 MB", { name: f.name }), "error"); continue; }
      setUploading((u) => [...u, f.name]);
      try {
        const img = f.type.startsWith("image/") && !f.type.includes("gif") ? await prepareImage(f) : null;
        const blob = img?.blob ?? f;
        const path = await backend.uploadChatFile(c.id, blob, img?.name ?? f.name);
        const m = await backend.insert("messages", { conversation_id: c.id, sender_id: me.id, kind: "text", body: "",
          attachments: [{ path, name: f.name, type: blob.type || f.type, size: blob.size, w: img?.w, h: img?.h }], reply_to: null });
        patch("messages", (rows) => (rows.some((r) => r.id === m.id) ? rows : [...rows, m]));
      } catch (e) { toast(t((e as Error).message), "error"); }
      finally { setUploading((u) => u.filter((x) => x !== f.name)); }
    }
  };
  const react = async (m: Message, emoji: string) => {
    setMenu(null);
    const mine = db.message_reactions.find((r) => r.message_id === m.id && r.user_id === me.id && r.emoji === emoji);
    try {
      if (mine) { patch("message_reactions", (rows) => rows.filter((r) => r.id !== mine.id)); await backend.remove("message_reactions", mine.id); }
      else { const r = await backend.insert("message_reactions", { message_id: m.id, conversation_id: c.id, user_id: me.id, emoji }); patch("message_reactions", (rows) => (rows.some((x) => x.id === r.id) ? rows : [...rows, r])); }
    } catch (e) { toast(t((e as Error).message), "error"); }
  };
  const onType = (val: string) => {
    setText(val);
    if (Date.now() - lastTyping.current > 2500 && val) { lastTyping.current = Date.now(); chan.current?.send({ type: "broadcast", event: "typing", payload: { user: me.id } }); }
  };

  // Receipts for my latest message.
  const others = members.filter((m) => m.user_id !== me.id);
  const myLast = [...msgs].reverse().find((m) => m.sender_id === me.id && m.kind === "text");
  const seenBy = myLast ? others.filter((m) => m.last_read_at >= myLast.created_at) : [];
  const typers = Object.keys(typing).map((u) => person(u)?.full_name.split(" ")[0]).filter(Boolean);
  const sub = c.kind === "direct" ? t(STATUS_META[shownStatus(v.other, online)].label) + (v.other?.status_note ? ` · ${v.other.status_note}` : "")
    : c.kind === "channel" ? (c.topic || t("{n} members", { n: members.length })) : t("{n} members", { n: members.length });

  let lastDay = "";
  return (
    <div className="conv">
      <div className="conv-head">
        <button className="icon-btn subtle back-btn" onClick={onBack} aria-label={t("Back")}><ArrowLeft size={20} /></button>
        <button className="row gap grow conv-title" onClick={() => setInfo(true)}>
          {c.kind === "direct" ? <span className="conv-av"><Avatar p={v.other} size={38} /><PresenceDot p={v.other} size={11} /></span>
            : <span className="ch-av sm">{c.kind === "channel" ? <Hash size={17} /> : <Users size={17} />}</span>}
          <span className="grow"><b>{v.title}</b><small className="muted">{typers.length ? t("{names} typing…", { names: typers.join(", ") }) : sub}</small></span>
        </button>
        {c.kind !== "channel" && <>
          <button className="icon-btn" onClick={() => calls.start({ conversationId: c.id, kind: "voice" })} aria-label={t("Voice call")}><Phone size={18} /></button>
          <button className="icon-btn" onClick={() => calls.start({ conversationId: c.id, kind: "video" })} aria-label={t("Video call")}><Video size={18} /></button>
        </>}
      </div>
      {activeCall && !calls.current && (
        <button className="call-banner" onClick={() => calls.join(activeCall)}><PhoneIncoming size={18} /><span className="grow">{t("Call in progress")}</span><b>{t("Join")}</b></button>
      )}
      <div className="msgs" ref={scroller} onClick={() => setMenu(null)}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        {msgs.map((m, i) => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay; lastDay = day;
          const prev = msgs[i - 1];
          const grouped = prev && prev.sender_id === m.sender_id && prev.kind === "text" && !showDay && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000;
          return (
            <div key={m.id}>
              {showDay && <div className="day-sep"><span>{day}</span></div>}
              <Bubble m={m} grouped={!!grouped} group={c.kind !== "direct"} menu={menu === m.id} onMenu={() => setMenu(menu === m.id ? null : m.id)}
                onReact={(e) => react(m, e)} onReply={() => { setReply(m); setMenu(null); }}
                onEdit={() => { setEditing(m); setText(m.body); setMenu(null); }}
                onDelete={async () => { setMenu(null); await backend.update("messages", m.id, { deleted_at: new Date().toISOString() }).catch((e) => toast(t((e as Error).message), "error")); }}
                receipt={m.id === myLast?.id ? (seenBy.length === 0 ? "sent" : seenBy.length >= others.length ? "seen" : `seen-${seenBy.length}`) : null}
                onJoinCall={(id) => { const k = db.calls.find((x) => x.id === id); if (k) calls.join(k); }} />
            </div>
          );
        })}
        {!msgs.length && <div className="chat-empty"><p className="muted">{t("Say hello 👋")}</p></div>}
        {uploading.map((u) => <div key={u} className="bubble mine uploading"><Loader2 size={16} className="spin" /> {u}</div>)}
      </div>
      {(reply || editing) && (
        <div className="reply-bar">
          {editing ? <Pencil size={15} /> : <CornerUpLeft size={15} />}
          <span className="grow"><b>{editing ? t("Editing message") : person(reply!.sender_id)?.full_name.split(" ")[0]}</b><small>{(editing ?? reply)!.body || t("Attachment")}</small></span>
          <button className="icon-btn subtle" onClick={() => { setReply(null); if (editing) { setEditing(null); setText(""); } }} aria-label={t("Cancel")}><X size={16} /></button>
        </div>
      )}
      <form className="composer-bar" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <button type="button" className="icon-btn subtle" onClick={() => fileIn.current?.click()} aria-label={t("Attach photo, video or file")}><Paperclip size={20} /></button>
        <input ref={fileIn} type="file" multiple hidden accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.dxf,.dwg,.step,.stp"
          onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
        <textarea rows={1} value={text} placeholder={isMember || c.kind !== "channel" ? t("Type a message") : t("Type to join and post")}
          onChange={(e) => onType(e.target.value)}
          onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); upload(f); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(min-width: 1024px)").matches) { e.preventDefault(); send(); } }} />
        <motion.button type="submit" className="send-btn" whileTap={{ scale: 0.9 }} disabled={!text.trim()} aria-label={t("Send")}>{editing ? <Check size={19} /> : <Send size={19} />}</motion.button>
      </form>
      <ConvInfo v={v} open={info} onClose={() => setInfo(false)} onLeft={onBack} />
    </div>
  );
}

function Bubble({ m, grouped, group, menu, onMenu, onReact, onReply, onEdit, onDelete, receipt, onJoinCall }: {
  m: Message; grouped: boolean; group: boolean; menu: boolean; onMenu: () => void; onReact: (e: string) => void; onReply: () => void;
  onEdit: () => void; onDelete: () => void; receipt: string | null; onJoinCall: (id: string) => void;
}) {
  const { db, me, person } = useStore();
  const mine = m.sender_id === me.id;
  const who = person(m.sender_id);
  if (m.kind === "system") return <div className="sys-msg">{who?.full_name.split(" ")[0]} {t(m.body)} · {clock(m.created_at)}</div>;
  if (m.kind === "call") {
    const k = db.calls.find((x) => x.id === m.attachments[0]?.call_id);
    const mins = k?.ended_at ? Math.max(1, Math.round((new Date(k.ended_at).getTime() - new Date(k.started_at).getTime()) / 60000)) : 0;
    return (
      <div className={`call-card ${k?.status === "ended" ? "" : "live"}`}>
        {m.body === "voice" ? <Phone size={18} /> : <Video size={18} />}
        <span className="grow"><b>{who?.full_name.split(" ")[0]} {t(m.body === "voice" ? "started a voice call" : "started a video call")}</b>
          <small>{clock(m.created_at)}{k?.status === "ended" ? ` · ${t("{n} min", { n: mins })}` : ""}</small></span>
        {k && k.status !== "ended" && <Btn small tone="primary" onClick={() => onJoinCall(k.id)}>{t("Join")}</Btn>}
      </div>
    );
  }
  const reacts = db.message_reactions.filter((r) => r.message_id === m.id);
  const counts = EMOJI.map((e) => ({ e, n: reacts.filter((r) => r.emoji === e).length, me: reacts.some((r) => r.emoji === e && r.user_id === me.id) })).filter((x) => x.n);
  const quoted = m.reply_to ? db.messages.find((x) => x.id === m.reply_to) : null;
  return (
    <div className={`msg-row ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}>
      {!mine && group && <span className="msg-av">{!grouped && <Avatar p={who} size={30} />}</span>}
      <div className="msg-col">
        {!mine && group && !grouped && <small className="msg-name">{who?.full_name.split(" ")[0]}</small>}
        <div className={`bubble ${mine ? "mine" : ""} ${m.deleted_at ? "deleted" : ""}`} onClick={(e) => { e.stopPropagation(); if (!m.deleted_at) onMenu(); }}
          onContextMenu={(e) => { e.preventDefault(); if (!m.deleted_at) onMenu(); }}>
          {quoted && <span className="quote"><b>{person(quoted.sender_id)?.full_name.split(" ")[0]}</b>{quoted.deleted_at ? t("Message deleted") : quoted.body || t("Attachment")}</span>}
          {m.attachments.map((a, i) => <AttachmentView key={i} a={a} />)}
          {m.deleted_at ? <i>{t("Message deleted")}</i> : m.body && <span className="msg-text">{m.body}</span>}
          <small className="msg-meta">{m.edited_at && !m.deleted_at ? `${t("edited")} · ` : ""}{clock(m.created_at)}
            {receipt && <span className={`rcpt ${receipt === "seen" ? "seen" : ""}`} title={receipt === "sent" ? t("Sent") : receipt === "seen" ? t("Seen") : t("Seen by {n}", { n: receipt.split("-")[1]! })}>
              {receipt === "sent" ? <Check size={13} /> : <CheckCheck size={13} />}</span>}</small>
        </div>
        {counts.length > 0 && <div className="reacts">{counts.map((x) => <button key={x.e} className={x.me ? "on" : ""} onClick={() => onReact(x.e)}>{x.e} {x.n > 1 ? x.n : ""}</button>)}</div>}
        <AnimatePresence>
          {menu && (
            <motion.div className="msg-menu" initial={{ opacity: 0, scale: 0.9, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} onClick={(e) => e.stopPropagation()}>
              <div className="emoji-row">{EMOJI.map((e) => <button key={e} onClick={() => onReact(e)}>{e}</button>)}</div>
              <div className="menu-row">
                <button onClick={onReply}><CornerUpLeft size={15} /> {t("Reply")}</button>
                {mine && m.body && <button onClick={onEdit}><Pencil size={15} /> {t("Edit")}</button>}
                {mine && <button className="red-t" onClick={onDelete}><Trash2 size={15} /> {t("Delete")}</button>}
                {!mine && <span className="muted menu-time"><SmilePlus size={14} /> {new Date(m.created_at).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AttachmentView({ a }: { a: Attachment }) {
  const { backend } = useStore();
  const url = useSignedUrl(backend, a.path);
  const [big, setBig] = useState(false);
  if (!a.path) return null;
  if (a.type?.startsWith("image/")) {
    return (
      <>
        <button className="att-img" style={a.w && a.h ? { aspectRatio: `${a.w} / ${a.h}` } : undefined} onClick={(e) => { e.stopPropagation(); setBig(true); }}>
          {url ? <img src={url} alt={a.name ?? ""} loading="lazy" /> : <ImageIcon size={24} />}
        </button>
        <AnimatePresence>{big && url && (
          <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => { e.stopPropagation(); setBig(false); }}>
            <img src={url} alt="" /><a className="btn soft small" href={url} download={a.name} onClick={(e) => e.stopPropagation()}>{t("Download")}</a>
          </motion.div>)}</AnimatePresence>
      </>
    );
  }
  if (a.type?.startsWith("video/")) return url ? <video className="att-video" src={url} controls playsInline preload="metadata" onClick={(e) => e.stopPropagation()} /> : <div className="att-video skel" />;
  return (
    <a className="att-file" href={url ?? undefined} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      <FileText size={22} /><span className="grow"><b>{a.name}</b><small>{a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB` : ""}</small></span>
    </a>
  );
}

/* ------------------------------------------------------------- dialogs -- */
function NewChatSheet({ open, channel, onClose, onCreated }: { open: boolean; channel: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { db, me, backend, refresh } = useStore();
  const toast = useToast();
  const [pick, setPick] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPick([]); setName(""); setQ(""); } }, [open]);
  const people = db.profiles.filter((p) => p.active && p.id !== me.id && (!q || p.full_name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const go = async () => {
    setBusy(true);
    try {
      const id = channel ? await backend.rpc<string>("create_conversation", { p_kind: "channel", p_name: name, p_members: db.profiles.filter((p) => p.active).map((p) => p.id) })
        : pick.length === 1 ? await backend.rpc<string>("open_direct", { p_other: pick[0] })
        : await backend.rpc<string>("create_conversation", { p_kind: "group", p_name: name, p_members: pick });
      await Promise.all([refresh("conversations"), refresh("conversation_members"), refresh("messages")]);
      onCreated(id);
    } catch (e) { toast(t((e as Error).message), "error"); }
    finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} tall title={channel ? t("New channel") : t("New chat")}>
      <div className="stack">
        {(channel || pick.length > 1) && <Field label={channel ? t("Channel name") : t("Group name (optional)")}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={channel ? t("e.g. Panel fitting") : t("e.g. Line 2 crew")} /></Field>}
        {!channel && (
          <>
            <div className="searchbar"><Search size={18} /><input placeholder={t("Search people…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="chips">{pick.map((id) => <Chip key={id} on onClick={() => setPick(pick.filter((x) => x !== id))}>{db.profiles.find((p) => p.id === id)?.full_name.split(" ")[0]} <X size={12} /></Chip>)}</div>
            <div className="stack">
              {people.map((p) => {
                const on = pick.includes(p.id);
                return (
                  <button key={p.id} className={`person-row select ${on ? "on" : ""}`} onClick={() => setPick(on ? pick.filter((x) => x !== p.id) : [...pick, p.id])}>
                    <span className="conv-av"><Avatar p={p} size={38} /><PresenceDot p={p} size={11} /></span>
                    <span><b>{p.full_name}</b><small>#{p.employee_code}</small></span>
                    <i className="check">{on && <Check size={14} />}</i>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {channel && <p className="muted">{t("Everyone in the company is added to new channels.")}</p>}
        <div className="sheet-foot"><Btn tone="primary" wide busy={busy} disabled={channel ? !name.trim() : !pick.length} onClick={go}>
          {channel ? t("Create channel") : pick.length > 1 ? t("Start group chat") : t("Start chat")}</Btn></div>
      </div>
    </Sheet>
  );
}

function ConvInfo({ v, open, onClose, onLeft }: { v: ConvView; open: boolean; onClose: () => void; onLeft: () => void }) {
  const { db, me, person, backend, refresh } = useStore();
  const toast = useToast();
  const online = useOnline();
  const [adding, setAdding] = useState(false);
  const mem = db.conversation_members.filter((m) => m.conversation_id === v.c.id);
  const mine = mem.find((m) => m.user_id === me.id);
  const owner = mine?.role === "owner";
  const files = db.messages.filter((m) => m.conversation_id === v.c.id && !m.deleted_at).flatMap((m) => m.attachments.filter((a) => a.path).map((a) => ({ a, m }))).reverse().slice(0, 24);
  return (
    <Sheet open={open} onClose={onClose} tall title={v.title}>
      <div className="stack">
        <small className="label">{t("People")} · {mem.length}</small>
        {mem.map((m) => {
          const p = person(m.user_id);
          return (
            <div key={m.id} className="person-row">
              <span className="conv-av"><Avatar p={p} size={38} /><PresenceDot p={p} size={11} /></span>
              <span><b>{p?.full_name}</b><small>{t(STATUS_META[shownStatus(p, online)].label)}{m.role === "owner" ? ` · ${t("owner")}` : ""}</small></span>
              {owner && m.user_id !== me.id && v.c.kind === "group" && <button className="icon-btn subtle" onClick={async () => { await backend.remove("conversation_members", m.id); refresh("conversation_members"); }} aria-label={t("Remove")}><X size={16} /></button>}
            </div>
          );
        })}
        {v.c.kind === "group" && (adding
          ? <div className="chips">{db.profiles.filter((p) => p.active && !mem.some((m) => m.user_id === p.id)).map((p) => (
              <Chip key={p.id} onClick={async () => { await backend.insert("conversation_members", { conversation_id: v.c.id, user_id: p.id }).catch((e) => toast(t((e as Error).message), "error")); refresh("conversation_members"); }}>+ {p.full_name.split(" ")[0]}</Chip>))}</div>
          : <Btn tone="soft" onClick={() => setAdding(true)}>{t("Add people")}</Btn>)}
        {files.length > 0 && (
          <>
            <small className="label">{t("Photos, videos & files")}</small>
            <div className="file-grid">{files.map(({ a, m }) => <div key={m.id + a.path}><AttachmentView a={a} /></div>)}</div>
          </>
        )}
        {mine && (
          <div className="row gap">
            <Btn tone="soft" wide onClick={async () => { await backend.update("conversation_members", mine.id, { muted: !mine.muted }); refresh("conversation_members"); }}>{mine.muted ? t("Unmute") : t("Mute")}</Btn>
            {v.c.kind !== "direct" && <Btn tone="danger" wide onClick={async () => { await backend.remove("conversation_members", mine.id); await refresh("conversation_members"); onClose(); onLeft(); }}>{t("Leave")}</Btn>}
          </div>
        )}
      </div>
    </Sheet>
  );
}
