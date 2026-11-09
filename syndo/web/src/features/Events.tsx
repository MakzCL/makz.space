import { useEffect, useState } from "react";
import { CalendarDays, Clock, MapPin, Plus, Radio, Share2, Star, Trash2, Users, Volume2 } from "lucide-react";
import { ChannelType, P, type Guild, type GuildEvent } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { navigate } from "../router.ts";
import { can, guildPerms, toast, useStore } from "../store.ts";
import { Avatar, Field, Modal } from "../components/ui.tsx";
import { askConfirm } from "../components/overlay.tsx";
import { openModal } from "./modals.tsx";

/** Scheduled events: the "N Events" row at the top of the channel list, the events list, and the create form. */

async function loadEvents(guildId: string) {
  try { const list = await api.get<GuildEvent[]>(`/api/guilds/${guildId}/events`); useStore.setState((s) => ({ events: { ...s.events, [guildId]: list } })); } catch { /* */ }
}
const when = (e: GuildEvent) => {
  const d = new Date(e.start_at);
  if (e.status === 2) return "Happening now";
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return days === 0 ? `Today at ${time}` : days === 1 ? `Tomorrow at ${time}` : `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
};

export function EventsButton({ guild }: { guild: Guild }) {
  const list = useStore((s) => s.events[guild.id]);
  useEffect(() => { if (!list) loadEvents(guild.id); }, [guild.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = (list ?? []).filter((e) => e.status === 2);
  if (!list?.length) return null;
  return <button className={`side-link events-link ${live.length ? "live" : ""}`} onClick={() => openEvents(guild)}>
    <CalendarDays size={18} /><span>{live.length ? `${live[0]!.name} — live now` : `${list.length} Event${list.length === 1 ? "" : "s"}`}</span>
  </button>;
}

export function openEvents(guild: Guild) {
  loadEvents(guild.id);
  openModal((close) => <EventsList guild={guild} onClose={close} />);
}

function EventsList({ guild, onClose }: { guild: Guild; onClose: () => void }) {
  const list = useStore((s) => s.events[guild.id] ?? []);
  const canCreate = guildPerms(guild) & P.MANAGE_EVENTS || guild.channels.some((c) => (c.type === ChannelType.VOICE || c.type === ChannelType.STAGE) && can(c, P.MANAGE_EVENTS));
  return (
    <Modal title={<><CalendarDays size={20} /> {list.length} Event{list.length === 1 ? "" : "s"}</>} label="Events" wide onClose={onClose}
      footer={canCreate ? <button className="btn primary" onClick={() => openModal((c) => <EventForm guild={guild} onClose={c} />)}><Plus size={16} /> Create event</button> : undefined}>
      {!list.length && <div className="empty-state"><CalendarDays size={40} /><h3>There are no upcoming events.</h3><p className="muted">Schedule an event for any planned activity in your server.</p></div>}
      <div className="event-list">{list.map((e) => <EventCard key={e.id} e={e} guild={guild} onNavigate={onClose} />)}</div>
    </Modal>
  );
}

function EventCard({ e, guild, onNavigate }: { e: GuildEvent; guild: Guild; onNavigate: () => void }) {
  const me = useStore((s) => s.me!.id);
  const ch = guild.channels.find((c) => c.id === e.channel_id);
  const manage = !!(guildPerms(guild) & P.MANAGE_EVENTS) || e.creator?.id === me;
  const rsvp = () => api[e.me ? "del" : "put"](`/api/guilds/${guild.id}/events/${e.id}/users/@me`).catch((x) => toast(errMsg(x), "error"));
  const status = (s: number) => api.patch(`/api/guilds/${guild.id}/events/${e.id}`, { status: s }).catch((x) => toast(errMsg(x), "error"));
  return (
    <article className={`event-card ${e.status === 2 ? "live" : ""}`}>
      {e.image && <img className="event-img" src={e.image} alt="" />}
      <div className="event-b">
        <div className={`event-when ${e.status === 2 ? "live" : ""}`}><Clock size={14} /> {when(e)}{e.recurrence && <span className="muted"> · repeats {e.recurrence}</span>}</div>
        <h3>{e.name}</h3>
        {e.description && <p className="muted">{e.description}</p>}
        <div className="event-meta muted small">
          {e.entity_type === 3 ? <><MapPin size={14} /> {e.location}</> : ch ? <button className="link" onClick={() => { onNavigate(); navigate(`/channels/${guild.id}/${ch.id}`); }}>{e.entity_type === 1 ? <Radio size={14} /> : <Volume2 size={14} />} {ch.name}</button> : null}
          <span><Users size={14} /> {e.user_count} interested</span>
          {e.creator && <span><Avatar user={e.creator} size={16} /> {e.creator.display_name || e.creator.username}</span>}
        </div>
      </div>
      <div className="event-actions">
        {manage && e.status === 1 && e.entity_type !== 3 && <button className="btn primary sm" onClick={() => status(2)}>Start</button>}
        {manage && e.status === 2 && <button className="btn sm" onClick={() => status(3)}>End event</button>}
        <button className={`btn sm ${e.me ? "active" : ""}`} aria-pressed={e.me} onClick={rsvp}><Star size={14} fill={e.me ? "currentColor" : "none"} /> {e.me ? "Interested" : "Interested?"}</button>
        <button className="icon-btn sm" aria-label="Copy event link" onClick={() => { navigator.clipboard.writeText(`${location.origin}/channels/${guild.id}?event=${e.id}`); toast("Link copied.", "success"); }}><Share2 size={14} /></button>
        {manage && e.status === 1 && <button className="icon-btn sm" aria-label="Edit event" onClick={() => openModal((c) => <EventForm guild={guild} edit={e} onClose={c} />)}>Edit</button>}
        {manage && <button className="icon-btn sm danger" aria-label="Delete event" onClick={async () => { if (await askConfirm({ title: "Cancel this event?", confirmLabel: "Cancel event", danger: true })) status(4).then(() => api.del(`/api/guilds/${guild.id}/events/${e.id}`)); }}><Trash2 size={14} /></button>}
      </div>
    </article>
  );
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function EventForm({ guild, edit, onClose }: { guild: Guild; edit?: GuildEvent; onClose: () => void }) {
  const voiceLike = guild.channels.filter((c) => (c.type === ChannelType.VOICE || c.type === ChannelType.STAGE));
  const [type, setType] = useState<1 | 2 | 3>(edit?.entity_type ?? (voiceLike.some((c) => c.type === ChannelType.STAGE) ? 1 : voiceLike.length ? 2 : 3));
  const [channel, setChannel] = useState(edit?.channel_id ?? voiceLike.find((c) => c.type === (type === 1 ? ChannelType.STAGE : ChannelType.VOICE))?.id ?? "");
  const [location, setLocation] = useState(edit?.location ?? "");
  const [name, setName] = useState(edit?.name ?? "");
  const [desc, setDesc] = useState(edit?.description ?? "");
  const [start, setStart] = useState(localInput(edit ? new Date(edit.start_at) : new Date(Date.now() + 3600_000)));
  const [end, setEnd] = useState(edit?.end_at ? localInput(new Date(edit.end_at)) : "");
  const [repeat, setRepeat] = useState(edit?.recurrence ?? "");
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim(), description: desc.trim() || null, entity_type: type, channel_id: type === 3 ? null : channel, location: type === 3 ? location.trim() : null,
        start_at: new Date(start).toISOString(), end_at: end ? new Date(end).toISOString() : null, recurrence: repeat || null };
      const e = edit ? await api.patch<GuildEvent>(`/api/guilds/${guild.id}/events/${edit.id}`, body) : await api.post<GuildEvent>(`/api/guilds/${guild.id}/events`, body);
      if (image) { const fd = new FormData(); fd.append("file", image); await api.post(`/api/guilds/${guild.id}/events/${e.id}/image`, fd); }
      await loadEvents(guild.id);
      onClose();
    } catch (x) { toast(errMsg(x), "error"); } finally { setBusy(false); }
  };
  return (
    <Modal title={edit ? "Edit event" : "Create an event"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim() || (type === 3 ? !location.trim() || !end : !channel)} onClick={save}>{edit ? "Save" : "Create event"}</button></>}>
      <fieldset className="radio-list"><legend>Where is your event?</legend>
        <label><input type="radio" checked={type === 1} onChange={() => setType(1)} disabled={!guild.channels.some((c) => c.type === ChannelType.STAGE)} /> <Radio size={16} /> Stage channel</label>
        <label><input type="radio" checked={type === 2} onChange={() => setType(2)} disabled={!guild.channels.some((c) => c.type === ChannelType.VOICE)} /> <Volume2 size={16} /> Voice channel</label>
        <label><input type="radio" checked={type === 3} onChange={() => setType(3)} /> <MapPin size={16} /> Somewhere else</label>
      </fieldset>
      {type === 3 ? <Field label="Location"><input value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} placeholder="Add a location, link or something." /></Field>
        : <Field label="Channel"><select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Pick a channel</option>{voiceLike.filter((c) => c.type === (type === 1 ? ChannelType.STAGE : ChannelType.VOICE)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      <Field label="Event topic"><input autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="What's your event?" /></Field>
      <div className="row">
        <Field label="Start"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={type === 3 ? "End" : "End (optional)"}><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <Field label="Repeats"><select value={repeat} onChange={(e) => setRepeat(e.target.value)}><option value="">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="biweekly">Every other week</option><option value="monthly">Every month</option><option value="yearly">Every year</option></select></Field>
      <Field label="Description"><textarea rows={3} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Tell people a little more about your event." /></Field>
      <Field label="Cover image"><input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} /></Field>
    </Modal>
  );
}
