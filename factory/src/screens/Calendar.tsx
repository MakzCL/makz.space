import { motion } from "motion/react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, HelpCircle, MapPin, Plus, Trash2, Video, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { isLive, useCalls } from "../components/Calls";
import { useToast } from "../components/Toast";
import { Badge, Btn, Chip, Empty, Field, HoldButton, Sheet, Toggle } from "../components/ui";
import { locale, t } from "../lib/i18n";
import { useStore } from "../lib/store";
import { clock } from "../lib/time";
import type { CalEvent, EventAttendee } from "../lib/types";

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const sameDay = (iso: string, day: string) => ymdLocal(new Date(iso)) === day;
const RESP: Record<EventAttendee["response"], { label: string; tone: string }> = {
  accepted: { label: "Going", tone: "ok" }, tentative: { label: "Maybe", tone: "moon" }, declined: { label: "Declined", tone: "red" }, pending: { label: "No reply", tone: "muted" },
};

export function CalendarView({ openEvent, onOpenEvent }: { openEvent: string | null; onOpenEvent: (id: string | null) => void }) {
  const { db, me } = useStore();
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [day, setDay] = useState(() => ymdLocal(new Date()));
  const [edit, setEdit] = useState<CalEvent | "new" | null>(null);
  useEffect(() => {
    const e = openEvent ? db.events.find((x) => x.id === openEvent) : null;
    if (e) { setDay(ymdLocal(new Date(e.starts_at))); const m = new Date(e.starts_at); m.setDate(1); setMonth(m); }
  }, [openEvent, db.events]);

  const mine = useMemo(() => db.events.filter((e) => e.organizer_id === me.id || db.event_attendees.some((a) => a.event_id === e.id && a.user_id === me.id && a.response !== "declined"))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at)), [db.events, db.event_attendees, me.id]);
  const cells = useMemo(() => {
    const first = new Date(month); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const today = ymdLocal(new Date());
  const dayEvents = mine.filter((e) => sameDay(e.starts_at, day) || (e.starts_at.slice(0, 10) <= day && e.ends_at.slice(0, 10) >= day && e.all_day));
  const upcoming = mine.filter((e) => new Date(e.ends_at) >= new Date()).slice(0, 5);
  const invites = db.event_attendees.filter((a) => a.user_id === me.id && a.response === "pending").map((a) => db.events.find((e) => e.id === a.event_id)).filter(Boolean) as CalEvent[];
  const open = openEvent ? db.events.find((e) => e.id === openEvent) ?? null : null;

  return (
    <div className="cal-wrap">
      <div className="stack">
        {invites.length > 0 && (
          <div className="card invites-card">
            <small className="label">{t("Meeting invites")}</small>
            {invites.map((e) => <EventRow key={e.id} e={e} onClick={() => onOpenEvent(e.id)} />)}
          </div>
        )}
        <div className="card cal-card">
          <div className="row between">
            <button type="button" className="icon-btn subtle" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))} aria-label={t("Previous month")}><ChevronLeft size={20} /></button>
            <b className="cal-month">{month.toLocaleDateString(locale(), { month: "long", year: "numeric" })}</b>
            <button type="button" className="icon-btn subtle" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))} aria-label={t("Next month")}><ChevronRight size={20} /></button>
          </div>
          <div className="cal-grid">
            {Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i)).map((d) => <small key={d.getDay()} className="cal-dow">{d.toLocaleDateString(locale(), { weekday: "narrow" })}</small>)}
            {cells.map((d) => {
              const k = ymdLocal(d);
              const n = mine.filter((e) => sameDay(e.starts_at, k)).length;
              return (
                <button type="button" key={k} className={`cal-day ${d.getMonth() !== month.getMonth() ? "out" : ""} ${k === today ? "today" : ""} ${k === day ? "on" : ""}`} onClick={() => setDay(k)}>
                  <span>{d.getDate()}</span>{n > 0 && <i className="cal-dots">{Array.from({ length: Math.min(n, 3) }, (_, j) => <em key={j} />)}</i>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="stack">
        <div className="row between">
          <div><b className="cal-dayh">{new Date(day + "T12:00").toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}</b></div>
          <Btn tone="primary" small icon={<Plus size={16} />} onClick={() => setEdit("new")}>{t("New meeting")}</Btn>
        </div>
        {dayEvents.length ? dayEvents.map((e) => <EventRow key={e.id} e={e} onClick={() => onOpenEvent(e.id)} />)
          : <Empty icon={<CalendarDays size={26} />} title={t("Nothing booked")} hint={t("Book a meeting and invite people — online meetings get a Join button.")} />}
        {upcoming.length > 0 && (
          <>
            <small className="label">{t("Coming up")}</small>
            {upcoming.filter((e) => !dayEvents.includes(e)).map((e) => <EventRow key={e.id} e={e} withDate onClick={() => onOpenEvent(e.id)} />)}
          </>
        )}
      </div>
      <EventSheet e={open} onClose={() => onOpenEvent(null)} onEdit={(e) => { onOpenEvent(null); setEdit(e); }} />
      <EventEditor e={edit} day={day} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); onOpenEvent(id); }} />
    </div>
  );
}

function EventRow({ e, onClick, withDate }: { e: CalEvent; onClick: () => void; withDate?: boolean }) {
  const { db, person } = useStore();
  const people = db.event_attendees.filter((a) => a.event_id === e.id).map((a) => a.user_id);
  const now = Date.now();
  const live = now >= new Date(e.starts_at).getTime() - 10 * 60000 && now <= new Date(e.ends_at).getTime();
  return (
    <motion.button type="button" className={`card event-row ${live ? "live" : ""}`} onClick={onClick} whileTap={{ scale: 0.985 }}>
      <span className="ev-time">{e.all_day ? <b>{t("All day")}</b> : <><b>{clock(e.starts_at)}</b><small>{clock(e.ends_at)}</small></>}</span>
      <span className="grow">
        <b>{e.title}</b>
        <small className="muted">{withDate ? new Date(e.starts_at).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }) + " · " : ""}
          {e.online ? t("Online meeting") : e.location || ""}{people.length ? ` · ${[e.organizer_id, ...people].filter((v, i, a) => v && a.indexOf(v) === i).map((u) => person(u)?.full_name.split(" ")[0]).join(", ")}` : ""}</small>
      </span>
      {live && e.online && <Badge tone="red" dot>{t("Now")}</Badge>}
    </motion.button>
  );
}

function EventSheet({ e, onClose, onEdit }: { e: CalEvent | null; onClose: () => void; onEdit: (e: CalEvent) => void }) {
  const { db, me, person, backend, refresh } = useStore();
  const calls = useCalls();
  const toast = useToast();
  if (!e) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const att = db.event_attendees.filter((a) => a.event_id === e.id);
  const mine = att.find((a) => a.user_id === me.id);
  const organizer = e.organizer_id === me.id;
  const now = Date.now();
  const joinable = e.online && now >= new Date(e.starts_at).getTime() - 15 * 60000 && now <= new Date(e.ends_at).getTime() + 30 * 60000;
  const active = db.calls.find((k) => k.event_id === e.id && isLive(k, db.call_participants));
  const answer = async (response: EventAttendee["response"]) => {
    if (!mine) return;
    try { await backend.update("event_attendees", mine.id, { response }); await refresh("event_attendees"); } catch (x) { toast(t((x as Error).message), "error"); }
  };
  return (
    <Sheet open={!!e} onClose={onClose} tall title={e.title}>
      <div className="stack">
        <div className="card flat ev-facts">
          <span><Clock size={16} />{new Date(e.starts_at).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}{e.all_day ? ` · ${t("All day")}` : ` · ${clock(e.starts_at)}–${clock(e.ends_at)}`}</span>
          {e.online && <span><Video size={16} />{t("Online meeting in the app")}</span>}
          {e.location && <span><MapPin size={16} />{e.location}</span>}
        </div>
        {e.online && (
          <Btn tone="primary" wide icon={<Video size={18} />} disabled={!joinable && !active} onClick={() => { onClose(); active ? calls.join(active) : calls.start({ eventId: e.id, kind: "video" }); }}>
            {active ? t("Join now — meeting started") : joinable ? t("Join meeting") : t("Join opens 15 minutes before")}
          </Btn>
        )}
        {mine && (
          <div className="row gap">
            <Btn tone={mine.response === "accepted" ? "primary" : "soft"} wide icon={<Check size={16} />} onClick={() => answer("accepted")}>{t("Going")}</Btn>
            <Btn tone={mine.response === "tentative" ? "primary" : "soft"} wide icon={<HelpCircle size={16} />} onClick={() => answer("tentative")}>{t("Maybe")}</Btn>
            <Btn tone={mine.response === "declined" ? "primary" : "soft"} wide icon={<X size={16} />} onClick={() => answer("declined")}>{t("Decline")}</Btn>
          </div>
        )}
        {e.description && <p className="desc">{e.description}</p>}
        <div className="card flat">
          <small className="label">{t("People")}</small>
          <div className="person-row"><Avatar p={person(e.organizer_id)} size={34} /><span><b>{person(e.organizer_id)?.full_name}</b><small>{t("Organiser")}</small></span></div>
          {att.map((a) => (
            <div key={a.id} className="person-row"><Avatar p={person(a.user_id)} size={34} /><span><b>{person(a.user_id)?.full_name}</b></span><Badge tone={RESP[a.response].tone}>{t(RESP[a.response].label)}</Badge></div>
          ))}
        </div>
        {organizer && (
          <div className="row gap">
            <Btn tone="ghost" wide onClick={() => onEdit(e)}>{t("Edit")}</Btn>
            <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={async () => { await backend.remove("events", e.id); await refresh("events"); onClose(); }}>{t("Hold to cancel meeting")}</HoldButton>
          </div>
        )}
      </div>
    </Sheet>
  );
}

const DUR = [15, 30, 45, 60, 90, 120];
function EventEditor({ e, day, onClose, onSaved }: { e: CalEvent | "new" | null; day: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { db, me, backend, refresh } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ title: "", date: day, time: "09:00", mins: 30, all_day: false, online: true, location: "", description: "", people: [] as string[] });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!e) return;
    if (e === "new") {
      const n = new Date(); const next = new Date(Math.ceil(n.getTime() / (30 * 60000)) * 30 * 60000);
      setF({ title: "", date: day, time: day === ymdLocal(n) ? `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}` : "09:00", mins: 30, all_day: false, online: true, location: "", description: "", people: [] });
    } else {
      const s = new Date(e.starts_at);
      setF({ title: e.title, date: ymdLocal(s), time: `${String(s.getHours()).padStart(2, "0")}:${String(s.getMinutes()).padStart(2, "0")}`,
        mins: Math.round((new Date(e.ends_at).getTime() - s.getTime()) / 60000), all_day: e.all_day, online: e.online, location: e.location, description: e.description,
        people: db.event_attendees.filter((a) => a.event_id === e.id).map((a) => a.user_id) });
    }
  }, [e]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true);
    try {
      const start = f.all_day ? new Date(f.date + "T00:00") : new Date(`${f.date}T${f.time}`);
      const end = f.all_day ? new Date(f.date + "T23:59") : new Date(start.getTime() + f.mins * 60000);
      const row = { title: f.title.trim(), description: f.description, location: f.location, starts_at: start.toISOString(), ends_at: end.toISOString(), all_day: f.all_day, online: f.online, reminded: false };
      const ev = e && e !== "new" ? await backend.update("events", e.id, row) : await backend.insert("events", { ...row, organizer_id: me.id });
      const had = db.event_attendees.filter((a) => a.event_id === ev.id);
      for (const u of f.people) if (!had.some((a) => a.user_id === u)) await backend.insert("event_attendees", { event_id: ev.id, user_id: u, response: "pending" });
      for (const a of had) if (!f.people.includes(a.user_id)) await backend.remove("event_attendees", a.id);
      await Promise.all([refresh("events"), refresh("event_attendees")]);
      toast(e === "new" ? t("Meeting booked — invites sent") : t("Meeting updated"), "ok");
      onSaved(ev.id);
    } catch (x) { toast(t((x as Error).message), "error"); }
    finally { setBusy(false); }
  };
  const staff = db.profiles.filter((p) => p.active && p.id !== me.id).sort((a, b) => a.full_name.localeCompare(b.full_name));
  return (
    <Sheet open={!!e} onClose={onClose} tall title={e === "new" ? t("New meeting") : t("Edit meeting")}>
      <form className="stack" onSubmit={(x) => { x.preventDefault(); save(); }}>
        <Field label={t("Title")}><input required value={f.title} onChange={(x) => setF({ ...f, title: x.target.value })} placeholder={t("e.g. Weekly production meeting")} /></Field>
        <div className="row gap">
          <Field label={t("Date")}><input type="date" required value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></Field>
          {!f.all_day && <Field label={t("Start")}><input type="time" required value={f.time} onChange={(x) => setF({ ...f, time: x.target.value })} /></Field>}
        </div>
        {!f.all_day && <Field label={t("Length")}><div className="chips">{DUR.map((m) => <Chip key={m} on={f.mins === m} onClick={() => setF({ ...f, mins: m })}>{m < 60 ? `${m} min` : `${m / 60} h`}</Chip>)}</div></Field>}
        <div className="set"><span><b>{t("All day")}</b></span><Toggle label={t("All day")} on={f.all_day} onChange={(v) => setF({ ...f, all_day: v })} /></div>
        <div className="set"><span><b>{t("Online meeting")}</b><small>{t("Video call in the app with a Join button")}</small></span><Toggle label={t("Online meeting")} on={f.online} onChange={(v) => setF({ ...f, online: v })} /></div>
        <Field label={t("Location")}><input value={f.location} onChange={(x) => setF({ ...f, location: x.target.value })} placeholder={t("Optional — e.g. Office upstairs")} /></Field>
        <Field label={t("Invite people")}>
          <div className="pick-grid">
            {staff.map((p) => {
              const on = f.people.includes(p.id);
              return (
                <motion.button type="button" key={p.id} className={`pick ${on ? "on" : ""}`} whileTap={{ scale: 0.92 }} onClick={() => setF({ ...f, people: on ? f.people.filter((x) => x !== p.id) : [...f.people, p.id] })}>
                  <Avatar p={p} size={42} />{on && <i className="pick-check"><Check size={12} /></i>}<small>{p.full_name.split(" ")[0]}</small>
                </motion.button>
              );
            })}
          </div>
        </Field>
        <Field label={t("Agenda / notes")}><textarea rows={3} value={f.description} onChange={(x) => setF({ ...f, description: x.target.value })} /></Field>
        <div className="sheet-foot"><Btn type="submit" tone="primary" wide busy={busy} disabled={!f.title.trim()}>{e === "new" ? t("Book meeting") : t("Save changes")}</Btn></div>
      </form>
    </Sheet>
  );
}
