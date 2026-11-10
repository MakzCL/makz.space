import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useState } from "react";
import { Archive, BarChart3, ChevronLeft, Hash, LayoutGrid, List, Lock, MessageSquare, Plus, Search, Tag, Trash2, Unlock, Users, X } from "lucide-react";
import { ChannelType, P, type Channel, type ForumTag, type Message } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { sendMessage, startUpload, type PendingUpload } from "../actions.ts";
import { Markdown, plainText } from "../markdown.tsx";
import { navigate } from "../router.ts";
import { can, channelById, dmTitle, isThreadType, memberName, putThreads, toast, useStore } from "../store.ts";
import { Avatar, Field, Modal, Toggle, fmtTime } from "../components/ui.tsx";
import { LayerBox } from "../components/overlay.tsx";
import { openModal } from "./modals.tsx";

/* ------------------------------------------------------------------------ create thread -- */
export function openCreateThread(parent: Channel, from?: Message) {
  openModal((close) => <CreateThread parent={parent} from={from} onClose={close} />);
}
function CreateThread({ parent, from, onClose }: { parent: Channel; from?: Message; onClose: () => void }) {
  const [name, setName] = useState(from ? plainText(from.content).slice(0, 60) || "New thread" : "");
  const [priv, setPriv] = useState(false);
  const [archive, setArchive] = useState(4320);
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);
  const canPrivate = !from && can(parent, P.CREATE_PRIVATE_THREADS);
  const go = async () => {
    setBusy(true);
    try {
      const t = await api.post<Channel>(`/api/channels/${parent.id}/threads`, { name: name.trim(), type: priv ? 12 : 11, auto_archive_minutes: archive, ...(from ? { message_id: from.id } : {}) });
      putThreads([t]);
      if (first.trim()) await sendMessage(t.id, first.trim());
      onClose();
      navigate(`/channels/${parent.guild_id}/${t.id}`);
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Modal title="Create thread" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={go}>Create thread</button></>}>
      {from && <div className="thread-from"><Avatar user={from.author} size={20} /> <strong>{memberName(parent.guild_id, from.author)}</strong> <span className="ellipsis muted">{plainText(from.content)}</span></div>}
      <Field label="Thread name"><input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) go(); }} /></Field>
      {!from && <Field label="Starter message (optional)"><textarea rows={3} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Say something to get it going" /></Field>}
      <Field label="Hide after inactivity">
        <select value={archive} onChange={(e) => setArchive(Number(e.target.value))}>
          <option value={60}>1 hour</option><option value={1440}>24 hours</option><option value={4320}>3 days</option><option value={10080}>1 week</option>
        </select>
      </Field>
      {canPrivate && <Toggle label="Private thread" hint="Only people you invite (and moderators) can see it." checked={priv} onChange={setPriv} />}
    </Modal>
  );
}

/* --------------------------------------------------------------------------- forward -- */
export function forwardMessage(m: Message) {
  openModal((close) => <ForwardDialog m={m} onClose={close} />);
}
function ForwardDialog({ m, onClose }: { m: Message; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const dms = useStore((s) => s.dms);
  const guilds = useStore((s) => s.guilds);
  const targets = useMemo(() => {
    const out: { id: string; label: string; sub: string; ch: Channel }[] = [];
    for (const c of Object.values(dms)) out.push({ id: c.id, label: dmTitle(c), sub: "Direct message", ch: c });
    for (const g of Object.values(guilds)) for (const c of g.channels) if ((c.type === ChannelType.TEXT || c.type === ChannelType.ANNOUNCEMENT) && can(c, P.SEND_MESSAGES)) out.push({ id: c.id, label: `#${c.name}`, sub: g.name, ch: c });
    const l = q.toLowerCase();
    return out.filter((t) => !l || t.label.toLowerCase().includes(l) || t.sub.toLowerCase().includes(l)).slice(0, 60);
  }, [dms, guilds, q]);
  const send = async () => {
    setBusy(true);
    try {
      for (const id of picked) {
        await api.post(`/api/channels/${id}/messages`, { content: "", forward: { message_id: m.id, channel_id: m.channel_id } });
        if (note.trim()) await sendMessage(id, note.trim());
      }
      toast(`Forwarded to ${picked.length} conversation${picked.length === 1 ? "" : "s"}.`, "success");
      onClose();
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Modal title="Forward to" onClose={onClose} footer={<><input className="grow" placeholder="Add an optional message…" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Optional message" /><button className="btn primary" disabled={!picked.length || busy} onClick={send}>Send{picked.length > 1 ? ` (${picked.length})` : ""}</button></>}>
      <div className="fwd-preview"><Avatar user={m.author} size={20} /> <span className="ellipsis">{plainText(m.content) || (m.attachments.length ? `📎 ${m.attachments[0]!.filename}` : "Message")}</span></div>
      <input autoFocus className="panel-search" placeholder="Search conversations and channels" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
      <div className="pick-list" role="listbox" aria-multiselectable>
        {targets.map((t) => (
          <button key={t.id} role="option" aria-selected={picked.includes(t.id)} className={`pick-row ${picked.includes(t.id) ? "on" : ""}`} onClick={() => setPicked((p) => (p.includes(t.id) ? p.filter((x) => x !== t.id) : p.length >= 5 ? p : [...p, t.id]))}>
            {t.ch.guild_id ? <Hash size={18} /> : <Avatar user={t.ch.recipients?.[0]} size={24} />}<span className="ellipsis grow">{t.label}</span><small className="muted">{t.sub}</small><span className="check" aria-hidden />
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------------ polls -- */
export function openPollComposer(channel: Channel) {
  openModal((close) => <PollComposer channel={channel} onClose={close} />);
}
function PollComposer({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState(["", ""]);
  const [hours, setHours] = useState(24);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = question.trim() && answers.filter((a) => a.trim()).length >= 2;
  const post = async () => {
    setBusy(true);
    try {
      await sendMessage(channel.id, "", { extra: { poll: { question: question.trim(), answers: answers.filter((a) => a.trim()).map((text) => ({ text: text.trim() })), duration_hours: hours, allow_multiselect: multi } } });
      onClose();
    } finally { setBusy(false); }
  };
  return (
    <Modal title={<><BarChart3 size={20} /> Create a poll</>} label="Create a poll" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok || busy} onClick={post}>Post</button></>}>
      <Field label="Question"><input autoFocus maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What question do you want to ask?" /></Field>
      <Field label="Answers">
        <div className="poll-edit">
          {answers.map((a, i) => (
            <div key={i} className="row">
              <input maxLength={55} value={a} placeholder={`Answer ${i + 1}`} onChange={(e) => setAnswers((x) => x.map((y, j) => (j === i ? e.target.value : y)))} />
              {answers.length > 2 && <button className="icon-btn sm" aria-label={`Remove answer ${i + 1}`} onClick={() => setAnswers((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
            </div>
          ))}
          {answers.length < 10 && <button className="btn sm" onClick={() => setAnswers((x) => [...x, ""])}><Plus size={14} /> Add another answer</button>}
        </div>
      </Field>
      <div className="row">
        <Field label="Duration">
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={1}>1 hour</option><option value={4}>4 hours</option><option value={8}>8 hours</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>1 week</option><option value={336}>2 weeks</option>
          </select>
        </Field>
        <Toggle label="Allow multiple answers" checked={multi} onChange={setMulti} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------------- thread UI -- */
export function ThreadHeader({ channel }: { channel: Channel }) {
  const parent = channelById(channel.parent_id);
  const t = channel.thread;
  const me = useStore((s) => s.me?.id);
  const joined = useStore((s) => s.joinedThreads.includes(channel.id));
  const mod = can(channel, P.MANAGE_THREADS);
  const owner = channel.owner_id === me;
  const patch = (b: Record<string, unknown>) => api.patch<Channel>(`/api/channels/${channel.id}/thread`, b).then((x) => putThreads([x])).catch((e) => toast(errMsg(e), "error"));
  return (
    <div className="thread-h">
      {parent && <button className="link small" onClick={() => navigate(`/channels/${channel.guild_id}/${parent.id}`)}><ChevronLeft size={14} /> #{parent.name}</button>}
      {t?.archived && <span className="tag">ARCHIVED</span>}
      {t?.locked && <span className="tag"><Lock size={10} /> LOCKED</span>}
      <button className="btn sm" onClick={() => api[joined ? "del" : "put"](`/api/channels/${channel.id}/thread-members/@me`).catch((e) => toast(errMsg(e), "error"))}>{joined ? "Leave thread" : "Join thread"}</button>
      {(mod || owner) && <button className="icon-btn sm" title={t?.archived ? "Unarchive" : "Archive"} aria-label={t?.archived ? "Unarchive thread" : "Archive thread"} onClick={() => patch({ archived: !t?.archived })}><Archive size={16} /></button>}
      {mod && <button className="icon-btn sm" title={t?.locked ? "Unlock" : "Lock"} aria-label={t?.locked ? "Unlock thread" : "Lock thread"} onClick={() => patch({ locked: !t?.locked })}>{t?.locked ? <Unlock size={16} /> : <Lock size={16} />}</button>}
      {mod && <button className="icon-btn sm danger" aria-label="Delete thread" onClick={async () => {
        const { askConfirm } = await import("../components/overlay.tsx");
        if (await askConfirm({ title: "Delete thread?", body: "Everything in it will be gone.", confirmLabel: "Delete", danger: true })) api.del(`/api/channels/${channel.id}/thread`).then(() => navigate(`/channels/${channel.guild_id}/${channel.parent_id}`)).catch((e) => toast(errMsg(e), "error"));
      }}><Trash2 size={16} /></button>}
    </div>
  );
}

/** Threads under a channel: active and archived. */
export function ThreadsPanel({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [list, setList] = useState<Channel[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    setList(null);
    api.get<{ threads: Channel[] }>(`/api/channels/${channel.id}/threads${tab === "archived" ? "?archived=1" : ""}`).then((r) => { putThreads(r.threads); setList(r.threads); }).catch(() => setList([]));
  }, [channel.id, tab]);
  const shown = (list ?? []).filter((t) => !q || (t.name ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <LayerBox className="side-panel" data-region="panels" role="complementary" aria-label="Threads" onDismiss={onClose} opts={{ blocksShortcuts: false }}>
      <header className="panel-h"><h3><MessageSquare size={16} /> Threads</h3>
        {can(channel, P.CREATE_PUBLIC_THREADS) && <button className="btn primary sm" onClick={() => openCreateThread(channel)}>Create</button>}
        <button className="icon-btn sm" data-panel-close onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      <div className="seg" role="tablist"><button role="tab" aria-selected={tab === "active"} onClick={() => setTab("active")}>Active</button><button role="tab" aria-selected={tab === "archived"} onClick={() => setTab("archived")}>Archived</button></div>
      <input className="panel-search" placeholder="Search threads" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search threads" />
      {!list ? <p className="muted pad">Loading…</p> : !shown.length ? <p className="muted pad">{tab === "active" ? "No active threads yet. Start one from a message (right-click → Create thread)." : "No archived threads."}</p>
        : shown.map((t) => <ThreadRow key={t.id} t={t} />)}
    </LayerBox>
  );
}
function ThreadRow({ t }: { t: Channel }) {
  const owner = useStore((s) => (t.owner_id ? s.users[t.owner_id] : null));
  return (
    <button className="thread-row" onClick={() => navigate(`/channels/${t.guild_id}/${t.id}`)}>
      <strong className="ellipsis">{t.type === ChannelType.PRIVATE_THREAD && <Lock size={12} />} {t.name}</strong>
      <span className="muted small">{owner ? `${memberName(t.guild_id, owner)} · ` : ""}{t.thread?.message_count ?? 0} messages{t.thread?.last_activity_at ? ` · ${fmtTime(t.thread.last_activity_at)}` : ""}</span>
    </button>
  );
}

/* ------------------------------------------------------------------- forum & media -- */
export function ForumView({ channel }: { channel: Channel }) {
  const [list, setList] = useState<Channel[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<0 | 1>(channel.default_sort ?? 0);
  const [layout, setLayout] = useState<"list" | "gallery">(channel.type === ChannelType.MEDIA || channel.default_layout === 2 ? "gallery" : "list");
  const [composing, setComposing] = useState(false);
  const live = useStore(useShallow((s) => Object.values(s.threads).filter((t) => t.parent_id === channel.id)));
  const load = () => api.get<{ threads: (Channel & { thread: any })[] }>(`/api/channels/${channel.id}/threads${archived ? "?archived=1" : ""}`).then((r) => { putThreads(r.threads); setList(r.threads); }).catch(() => setList([]));
  useEffect(() => { setList(null); load(); }, [channel.id, archived]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = channel.available_tags ?? [];
  const merged = useMemo(() => {
    const byId = new Map((list ?? []).map((t) => [t.id, t]));
    for (const t of live) if (!archived && !t.thread?.archived) byId.set(t.id, { ...byId.get(t.id), ...t, thread: { ...(byId.get(t.id)?.thread ?? {}), ...t.thread } as any });
    let arr = [...byId.values()].filter((t) => !!t.thread?.archived === archived);
    if (q) arr = arr.filter((t) => (t.name ?? "").toLowerCase().includes(q.toLowerCase()) || (t.thread as any)?.starter?.content?.toLowerCase().includes(q.toLowerCase()));
    if (tagFilter.length) arr = arr.filter((t) => tagFilter.every((x) => t.thread?.applied_tags.includes(x)));
    return arr.sort((a, b) => (sort === 1 ? (BigInt(b.id) > BigInt(a.id) ? 1 : -1) : (b.thread?.last_activity_at ?? "").localeCompare(a.thread?.last_activity_at ?? "")));
  }, [list, live, archived, q, tagFilter, sort]);
  return (
    <div className="forum">
      <header className="forum-h">
        <div className="forum-search"><Search size={16} /><input placeholder="Search or create a post…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search posts" /></div>
        {can(channel, P.SEND_MESSAGES) && <button className="btn primary" onClick={() => setComposing(true)}><Plus size={16} /> New post</button>}
      </header>
      <div className="forum-tools">
        {tags.length > 0 && <div className="tag-filter" role="group" aria-label="Filter by tag">{tags.map((t) => <button key={t.id} className={`ftag ${tagFilter.includes(t.id) ? "on" : ""}`} aria-pressed={tagFilter.includes(t.id)} onClick={() => setTagFilter((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>{t.emoji} {t.name}</button>)}</div>}
        <span className="grow" />
        <select value={sort} onChange={(e) => setSort(Number(e.target.value) as 0 | 1)} aria-label="Sort"><option value={0}>Recently active</option><option value={1}>Date posted</option></select>
        <button className={`icon-btn sm ${layout === "list" ? "active" : ""}`} aria-label="List view" onClick={() => setLayout("list")}><List size={16} /></button>
        <button className={`icon-btn sm ${layout === "gallery" ? "active" : ""}`} aria-label="Gallery view" onClick={() => setLayout("gallery")}><LayoutGrid size={16} /></button>
        <button className={`btn sm ${archived ? "active" : ""}`} onClick={() => setArchived((v) => !v)}><Archive size={14} /> {archived ? "Showing archived" : "Archived"}</button>
      </div>
      {composing && <NewPost channel={channel} initial={q} onClose={() => setComposing(false)} onDone={(t) => { setComposing(false); navigate(`/channels/${channel.guild_id}/${t.id}`); }} />}
      {!list ? <p className="muted pad">Loading posts…</p> : !merged.length ? (
        <div className="empty-state"><MessageSquare size={40} /><h3>{archived ? "No archived posts" : "No posts yet"}</h3><p className="muted">{can(channel, P.SEND_MESSAGES) ? "Start the conversation with a new post." : "Check back later."}</p></div>
      ) : <div className={`posts ${layout}`}>{merged.map((t) => <PostCard key={t.id} t={t} tags={tags} />)}</div>}
    </div>
  );
}

function PostCard({ t, tags }: { t: Channel; tags: ForumTag[] }) {
  const starter = (t.thread as any)?.starter as Message | null | undefined;
  const img = starter?.attachments.find((a) => a.content_type.startsWith("image/")) ?? null;
  const author = starter?.author ?? null;
  return (
    <button className="post" onClick={() => navigate(`/channels/${t.guild_id}/${t.id}`)}>
      {img && <img className="post-img" src={img.url} alt="" loading="lazy" />}
      <div className="post-b">
        <div className="post-tags">{(t.thread?.applied_tags ?? []).map((id) => { const tg = tags.find((x) => x.id === id); return tg ? <span key={id} className="ftag sm"><Tag size={10} /> {tg.emoji} {tg.name}</span> : null; })}</div>
        <strong className="post-title">{t.name}</strong>
        {starter?.content && <div className="post-snip muted"><Markdown text={starter.content.slice(0, 220)} ctx={{ guildId: t.guild_id }} /></div>}
        <div className="post-meta muted small">
          {author && <><Avatar user={author} size={16} /> {memberName(t.guild_id, author)} · </>}
          <MessageSquare size={12} /> {Math.max(0, (t.thread?.message_count ?? 1) - 1)} · {t.thread?.last_activity_at ? fmtTime(t.thread.last_activity_at) : ""}
          {starter?.reactions?.[0] && <span className="post-react">{starter.reactions[0].emoji} {starter.reactions[0].count}</span>}
        </div>
      </div>
    </button>
  );
}

function NewPost({ channel, initial, onClose, onDone }: { channel: Channel; initial: string; onClose: () => void; onDone: (t: Channel) => void }) {
  const [title, setTitle] = useState(initial);
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [busy, setBusy] = useState(false);
  const media = channel.type === ChannelType.MEDIA;
  const avail = (channel.available_tags ?? []).filter((t) => !t.moderated || can(channel, P.MANAGE_THREADS));
  const add = (files: FileList | null) => {
    for (const f of [...(files ?? [])].slice(0, 10)) startUpload(channel.id, f, (u) => setUploads((l) => { const i = l.findIndex((x) => x.key === u.key); if (i < 0) return [...l, u]; const n = [...l]; n[i] = u; return n; }));
  };
  const post = async () => {
    if (uploads.some((u) => u.status === "uploading")) { toast("Wait for uploads to finish.", "info"); return; }
    setBusy(true);
    try {
      const t = await api.post<Channel>(`/api/channels/${channel.id}/threads`, { name: title.trim(), applied_tags: tags, message: { content: body, attachment_ids: uploads.filter((u) => u.status === "done").map((u) => u.id!) } });
      putThreads([t]); onDone(t);
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  return (
    <div className="new-post" role="form" aria-label="New post">
      <input autoFocus className="post-title-in" placeholder="Post title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
      {avail.length > 0 && <div className="tag-filter">{avail.map((t) => <button key={t.id} className={`ftag ${tags.includes(t.id) ? "on" : ""}`} aria-pressed={tags.includes(t.id)} onClick={() => setTags((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : x.length >= 5 ? x : [...x, t.id]))}>{t.emoji} {t.name}</button>)}{channel.require_tag && <small className="muted">Pick at least one tag.</small>}</div>}
      <textarea rows={4} placeholder={media ? "Add a description (optional)" : "Write your post"} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="row">
        <label className="btn sm"><input type="file" multiple hidden accept={media ? "image/*,video/*" : undefined} onChange={(e) => add(e.target.files)} /> Attach{media ? " media" : " files"}</label>
        {uploads.map((u) => <span key={u.key} className="muted small">{u.file.name}{u.status === "uploading" ? "…" : u.status === "error" ? " (failed)" : " ✓"}</span>)}
        <span className="grow" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !title.trim() || (media && !uploads.some((u) => u.status === "done")) || (channel.require_tag && !tags.length)} onClick={post}>Post</button>
      </div>
    </div>
  );
}

/** Active threads in a server, for the channel list (under each parent). */
export function useActiveThreads(guildId: string | null) {
  const loaded = useStore((s) => (guildId ? Object.values(s.threads).some((t) => t.guild_id === guildId) : true));
  useEffect(() => {
    if (!guildId || loaded) return;
    api.get<Channel[]>(`/api/guilds/${guildId}/threads/active`).then(putThreads).catch(() => {});
  }, [guildId]); // eslint-disable-line react-hooks/exhaustive-deps
}
export function SidebarThreads({ parentId, current }: { parentId: string; current: string }) {
  const joined = useStore((s) => s.joinedThreads);
  const list = useStore(useShallow((s) => Object.values(s.threads).filter((t) => t.parent_id === parentId && !t.thread?.archived && (joined.includes(t.id) || t.id === current))));
  if (!list.length) return null;
  return <ul className="side-threads">{list.slice(0, 8).map((t) => <li key={t.id}><button className={`side-thread ${current === t.id ? "active" : ""}`} onClick={() => navigate(`/channels/${t.guild_id}/${t.id}`)}><span className="ellipsis">{t.name}</span></button></li>)}</ul>;
}

export { Users, isThreadType };
