import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, Check, X } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Empty, Section, item, list } from "../components/ui";
import { useActions } from "../lib/actions";
import { useStore } from "../lib/store";
import { plural, t } from "../lib/i18n";
import { SceneTabs } from "../components/Scene";
import { PendingMembers } from "./Team";
import { ago, dayLabel, daysBetween, ymd } from "../lib/time";
import type { Absence } from "../lib/types";

export const KIND = { sick: { label: "Off-sick", tone: "moon" }, day_off: { label: "Day off", tone: "blue" }, holiday: { label: "Holiday", tone: "red" } } as const;
export const kindLabel = (k: keyof typeof KIND) => t(KIND[k].label);

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
      <SceneTabs kind="town" title={t("Requests")} sub={t("Absences and new starters waiting for you")} value={view} onChange={setView}
        tabs={[{ value: "pending", label: t("Pending") }, { value: "upcoming", label: t("Upcoming") }, { value: "history", label: t("History") }]} />
      {view === "pending" && <PendingMembers />}
      {offToday.length > 0 && (
        <motion.div className="card off-today" variants={item}>
          <small className="label">{t("Away today")}</small>
          <div className="row gap wrap">{offToday.map((x) => <span key={x.id} className="who big"><Avatar p={person(x.user_id)} size={26} />{person(x.user_id)?.full_name.split(" ")[0]} <Badge tone={KIND[x.kind].tone}>{kindLabel(x.kind)}</Badge></span>)}</div>
        </motion.div>
      )}
      <Section title={t("Absence requests")}>
        <motion.div className="stack" variants={list} initial="hidden" animate="show" key={view}>
          <AnimatePresence initial={false}>
            {rows.map((r) => <RequestCard key={r.id} r={r} onDecide={(s) => a.decideAbsence(r.id, s)} />)}
          </AnimatePresence>
          {!rows.length && <Empty icon={<CalendarCheck size={28} />} title={view === "pending" ? t("Nothing waiting") : t("Nothing here")} hint={view === "pending" ? t("No requests waiting for a decision.") : undefined} />}
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
          <span className="row gap-s"><Badge tone={KIND[r.kind].tone}>{kindLabel(r.kind)}</Badge><span className="muted">{plural(n, ["day", "days"], ["dzień", "dni", "dni"])}</span>{r.status !== "pending" && <Badge tone={r.status === "approved" ? "ok" : "red"}>{t(r.status)}</Badge>}</span>
        </div>
      </div>
      <div className="range"><b>{dayLabel(r.start_date)}</b>{r.start_date !== r.end_date && <> → <b>{dayLabel(r.end_date)}</b></>}</div>
      {r.note && <p className="muted">“{r.note}”</p>}
      {r.status === "pending" && (
        <div className="row gap">
          <Btn tone="danger" wide icon={<X size={16} />} onClick={() => onDecide("rejected")}>{t("Reject")}</Btn>
          <Btn tone="ok" wide icon={<Check size={16} />} onClick={() => onDecide("approved")}>{t("Approve")}</Btn>
        </div>
      )}
    </motion.div>
  );
}
