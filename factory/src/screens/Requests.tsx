import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, Check, X } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Empty, Section, Segmented, item, list } from "../components/ui";
import { useActions } from "../lib/actions";
import { useStore } from "../lib/store";
import { ago, dayLabel, daysBetween, ymd } from "../lib/time";
import type { Absence } from "../lib/types";

export const KIND = { sick: { label: "Off-sick", tone: "amber" }, day_off: { label: "Day off", tone: "blue" }, holiday: { label: "Holiday", tone: "green" } } as const;

export function Requests() {
  const { db, person } = useStore();
  const a = useActions();
  const [view, setView] = useState<"pending" | "upcoming" | "history">("pending");
  const today = ymd(new Date());
  const rows = db.absences.filter((x) =>
    view === "pending" ? x.status === "pending"
      : view === "upcoming" ? x.status === "approved" && x.end_date >= today
        : x.status !== "pending" && (x.end_date < today || x.status !== "approved"))
    .sort((x, y) => view === "history" ? y.start_date.localeCompare(x.start_date) : x.start_date.localeCompare(y.start_date));
  const offToday = db.absences.filter((x) => x.status === "approved" && x.start_date <= today && x.end_date >= today);
  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      {offToday.length > 0 && (
        <motion.div className="card off-today" variants={item}>
          <small className="eyebrow">Away today</small>
          <div className="row gap wrap">{offToday.map((x) => <span key={x.id} className="who big"><Avatar p={person(x.user_id)} size={26} />{person(x.user_id)?.full_name.split(" ")[0]} <Badge tone={KIND[x.kind].tone}>{KIND[x.kind].label}</Badge></span>)}</div>
        </motion.div>
      )}
      <Section title="Absence requests" action={<Segmented size="s" value={view} onChange={setView} options={[{ value: "pending", label: "Pending" }, { value: "upcoming", label: "Upcoming" }, { value: "history", label: "History" }]} />}>
        <motion.div className="stack" variants={list} initial="hidden" animate="show" key={view}>
          <AnimatePresence initial={false}>
            {rows.map((r) => <RequestCard key={r.id} r={r} onDecide={(s) => a.decideAbsence(r.id, s)} />)}
          </AnimatePresence>
          {!rows.length && <Empty icon={<CalendarCheck size={28} />} title={view === "pending" ? "Inbox zero" : "Nothing here"} hint={view === "pending" ? "No requests waiting for a decision." : undefined} />}
        </motion.div>
      </Section>
    </motion.div>
  );
}

function RequestCard({ r, onDecide }: { r: Absence; onDecide: (s: "approved" | "rejected") => void }) {
  const { person } = useStore();
  const p = person(r.user_id);
  const n = daysBetween(r.start_date, r.end_date);
  return (
    <motion.div className={`card request k-${r.kind}`} variants={item} layout exit={{ opacity: 0, height: 0, marginBottom: 0 }}>
      <div className="row gap">
        <Avatar p={p} size={42} />
        <div className="grow">
          <div className="row between"><b>{p?.full_name}</b><small className="muted">{ago(r.created_at)}</small></div>
          <span className="row gap-s"><Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge><span className="muted">{n} day{n > 1 ? "s" : ""}</span>{r.status !== "pending" && <Badge tone={r.status === "approved" ? "green" : "red"}>{r.status}</Badge>}</span>
        </div>
      </div>
      <div className="range"><b>{dayLabel(r.start_date)}</b>{r.start_date !== r.end_date && <> → <b>{dayLabel(r.end_date)}</b></>}</div>
      {r.note && <p className="muted">“{r.note}”</p>}
      {r.status === "pending" && (
        <div className="row gap">
          <Btn tone="danger" wide icon={<X size={16} />} onClick={() => onDecide("rejected")}>Reject</Btn>
          <Btn tone="ok" wide icon={<Check size={16} />} onClick={() => onDecide("approved")}>Approve</Btn>
        </div>
      )}
    </motion.div>
  );
}
