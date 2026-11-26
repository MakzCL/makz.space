import { useEffect, useState } from "react";
import { AtSign, CheckCheck, Inbox, MessageSquare, X } from "lucide-react";
import { ChannelType, isVoiceType, type Message } from "@send/shared";
import { api } from "../api.ts";
import { ackChannel } from "../actions.ts";
import { Markdown } from "../markdown.tsx";
import { navigate } from "../router.ts";
import { channelById, isUnread, memberName, useStore } from "../store.ts";
import { Avatar, Modal, fmtTime } from "../components/ui.tsx";

/** Inbox (Ctrl/⌘+I): recent mentions across servers, and channels with unread messages. */
export function InboxHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const on = () => setOpen((v) => !v); window.addEventListener("send:inbox", on); return () => window.removeEventListener("send:inbox", on); }, []);
  return open ? <InboxDialog onClose={() => setOpen(false)} /> : null;
}

function InboxDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"mentions" | "unreads">("mentions");
  const [list, setList] = useState<Message[] | null>(null);
  const [opts, setOpts] = useState({ everyone: true, roles: true });
  const guilds = useStore((s) => s.guilds);
  const readStates = useStore((s) => s.readStates);
  useEffect(() => {
    if (tab !== "mentions") return;
    setList(null);
    api.get<Message[]>(`/api/users/@me/mentions?everyone=${opts.everyone ? 1 : 0}&roles=${opts.roles ? 1 : 0}`).then(setList).catch(() => setList([]));
  }, [tab, opts]);
  const go = (m: { guild_id: string | null; channel_id: string; id?: string }) => { onClose(); navigate(`/channels/${m.guild_id ?? "@me"}/${m.channel_id}${m.id ? `/${m.id}` : ""}`); };
  const unread = Object.values(guilds).flatMap((g) => g.channels.filter((c) => c.type !== ChannelType.CATEGORY && !isVoiceType(c.type) && isUnread(c)).map((c) => ({ g, c })));
  void readStates;
  return (
    <Modal title={<><Inbox size={20} /> Inbox</>} label="Inbox" onClose={onClose} wide>
      <div className="seg" role="tablist"><button role="tab" aria-selected={tab === "mentions"} onClick={() => setTab("mentions")}><AtSign size={14} /> Mentions</button><button role="tab" aria-selected={tab === "unreads"} onClick={() => setTab("unreads")}><MessageSquare size={14} /> Unreads ({unread.length})</button></div>
      {tab === "mentions" ? <>
        <div className="row small"><label><input type="checkbox" checked={opts.everyone} onChange={(e) => setOpts({ ...opts, everyone: e.target.checked })} /> Include @everyone and @here</label><label><input type="checkbox" checked={opts.roles} onChange={(e) => setOpts({ ...opts, roles: e.target.checked })} /> Include role mentions</label></div>
        {!list ? <p className="muted pad">Loading…</p> : !list.length ? <div className="empty-state"><AtSign size={36} /><p className="muted">No recent mentions. When someone @mentions you, it shows up here for 30 days.</p></div>
          : list.map((m) => { const ch = channelById(m.channel_id); const g = m.guild_id ? guilds[m.guild_id] : null; return (
            <div key={m.id} className="inbox-item">
              <div className="inbox-where muted small">{g?.name} · #{ch?.name ?? "channel"}</div>
              <button className="result" onClick={() => go(m)}>
                <div className="msg-head"><Avatar user={m.author} size={24} /><strong>{memberName(m.guild_id, m.author)}</strong><span className="muted small">{fmtTime(m.created_at)}</span></div>
                <div className="msg-content"><Markdown text={m.content.slice(0, 600)} ctx={{ guildId: m.guild_id }} /></div>
              </button>
              <button className="icon-btn sm" aria-label="Dismiss" onClick={() => setList((l) => (l ?? []).filter((x) => x.id !== m.id))}><X size={14} /></button>
            </div>); })}
      </> : <>
        {unread.length > 0 && <button className="btn sm" onClick={() => unread.forEach(({ c }) => ackChannel(c))}><CheckCheck size={14} /> Mark all as read</button>}
        {!unread.length ? <div className="empty-state"><CheckCheck size={36} /><p className="muted">You're all caught up.</p></div>
          : unread.map(({ g, c }) => <div key={c.id} className="inbox-item"><button className="result" onClick={() => go({ guild_id: g.id, channel_id: c.id })}><strong>{g.name}</strong> <span className="muted">#{c.name}</span>{(readStates[c.id]?.mention_count ?? 0) > 0 && <span className="badge inline">{readStates[c.id]!.mention_count}</span>}</button><button className="icon-btn sm" aria-label="Mark as read" onClick={() => ackChannel(c)}><CheckCheck size={14} /></button></div>)}
      </>}
    </Modal>
  );
}
