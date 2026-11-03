import { Bookmark, BookmarkMinus, File, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { Markdown } from "../markdown.tsx";
import { navigate, setTitle } from "../router.ts";
import { channelById, displayName, dmTitle, onEvent, toast, useStore } from "../store.ts";
import { Avatar, fmtTime } from "./ui.tsx";

/** A private inbox; the API checks current channel access for every saved message. */
export function SavedMessages() {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string[]>([]);
  const generation = useRef(0);
  const userId = useStore((s) => s.me?.id);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const list = await api.get<Message[]>("/api/users/@me/saved");
      if (ticket !== generation.current) return;
      setMessages(list); setError("");
    } catch (e) {
      if (ticket === generation.current) { setMessages(null); setError(errMsg(e)); }
    }
  }, []);
  useEffect(() => { setTitle("Saved messages"); }, []);
  useEffect(() => {
    setMessages(null); setError(""); void load();
    // Drop previously fetched copies immediately when visibility can change.
    const invalidate = () => { setMessages(null); void load(); };
    const cleanups = ["SAVED_UPDATE", "MESSAGE_UPDATE", "MESSAGE_DELETE", "MESSAGE_DELETE_BULK", "GUILD_SYNC", "GUILD_DELETE", "CHANNEL_DELETE", "READY"]
      .map((event) => onEvent(event, invalidate));
    return () => { ++generation.current; cleanups.forEach((off) => off()); };
  }, [load, userId]);

  const remove = async (id: string) => {
    setRemoving((ids) => [...ids, id]);
    try { await api.del(`/api/users/@me/saved/${id}`); await load(); }
    catch (e) { toast(errMsg(e), "error"); }
    finally { setRemoving((ids) => ids.filter((x) => x !== id)); }
  };
  const needle = query.trim().toLocaleLowerCase();
  const visible = messages?.filter((m) => {
    const ch = channelById(m.channel_id);
    return !needle || [m.content, displayName(m.author), m.author.username, ch?.name, ...m.attachments.map((a) => a.filename)]
      .some((value) => value?.toLocaleLowerCase().includes(needle));
  }) ?? [];

  return (
    <section className="friends saved-messages" aria-label="Saved messages">
      <header className="ch-h" data-region="header"><Bookmark size={22} aria-hidden /><h1>Saved messages</h1><span className="muted small">Only you can see these</span></header>
      <div className="saved-tools"><Search size={18} aria-hidden /><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your saves" aria-label="Search saved messages" /></div>
      <div className="friends-body saved-body" aria-busy={!messages && !error}>
        {error ? <div className="empty-state" role="alert"><p>{error}</p><button className="btn" onClick={load}><RotateCcw size={16} /> Try again</button></div>
          : !messages ? <p className="muted pad" role="status">Loading saved messages…</p>
          : !messages.length ? <div className="empty-state"><Bookmark size={36} aria-hidden /><h2>Keep something for later</h2><p className="muted">Use “Save message” on a message to find it here.</p></div>
          : !visible.length ? <p className="muted pad" role="status">No saved messages match your search.</p>
          : visible.map((m) => {
            const ch = channelById(m.channel_id);
            const source = ch ? ch.guild_id ? `${useStore.getState().guilds[ch.guild_id]?.name ?? "Server"} / #${ch.name}` : dmTitle(ch) : "Conversation";
            const jump = () => navigate(`/channels/${m.guild_id ?? "@me"}/${m.channel_id}/${m.id}`);
            return <article className="saved-card" key={m.id} aria-label={`Saved message from ${displayName(m.author)}`}>
              <div className="msg-head"><Avatar user={m.author} size={28} /><strong>{displayName(m.author)}</strong><time className="muted small" dateTime={m.created_at}>{fmtTime(m.created_at)}</time></div>
              <p className="muted small saved-source">{source}</p>
              <div className="msg-content"><Markdown text={m.content} ctx={{ guildId: m.guild_id, onChannel: (id) => { const c = channelById(id); if (c) navigate(`/channels/${c.guild_id ?? "@me"}/${id}`); } }} /></div>
              {m.attachments.map((a) => <a key={a.id} className="saved-file" href={a.url} target="_blank" rel="noopener noreferrer"><File size={16} aria-hidden />{a.filename}</a>)}
              <footer className="saved-card-actions"><button className="btn sm" onClick={jump}>Jump to message</button><button className="btn sm" disabled={removing.includes(m.id)} onClick={() => remove(m.id)} aria-label={`Remove saved message from ${displayName(m.author)}`}><BookmarkMinus size={16} aria-hidden /> Remove</button></footer>
            </article>;
          })}
        {messages && messages.length >= 200 && <p className="muted small pad">Showing your 200 most recent saves. Search filters this list.</p>}
      </div>
    </section>
  );
}
