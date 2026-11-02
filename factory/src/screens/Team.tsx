import { motion } from "motion/react";
import { Search, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Chip, Field, Section, Sheet, item, list } from "../components/ui";
import { useActions, usePresence } from "../lib/actions";
import { can, ROLE_META, ROLE_ORDER } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { dailyTotals, hm, hms, jobStats, splitOvertime, startOfDay, startOfMonth, ymd } from "../lib/time";
import type { Role } from "../lib/types";
import { TimeSheet } from "./Time";

export function Team({ onPerson }: { onPerson: (id: string) => void }) {
  const { db } = useStore();
  const presence = usePresence();
  const now = useNow(30000);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "on" | Role>("all");
  const today = ymd(startOfDay());
  const people = db.profiles
    .filter((p) => !q || p.full_name.toLowerCase().includes(q.toLowerCase()) || p.employee_code.toLowerCase().includes(q.toLowerCase()))
    .filter((p) => only === "all" || (only === "on" ? presence.get(p.id)!.state !== "off" : p.role === only))
    .sort((a, b) => Number(presence.get(b.id)!.state !== "off") - Number(presence.get(a.id)!.state !== "off") || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.full_name.localeCompare(b.full_name));
  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <Section title="Team" sub={`${db.profiles.length} people · ${[...presence.values()].filter((p) => p.state !== "off").length} on shift`}>
        <div className="searchbar"><Search size={18} /><input placeholder="Search name or code…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="chips">
          <Chip on={only === "on"} onClick={() => setOnly(only === "on" ? "all" : "on")}>On shift</Chip>
          {ROLE_ORDER.map((r) => <Chip key={r} on={only === r} color={ROLE_META[r].hue} onClick={() => setOnly(only === r ? "all" : r)}>{ROLE_META[r].label}</Chip>)}
        </div>
        <motion.div className="stack" variants={list} initial="hidden" animate="show">
          {people.map((p) => {
            const pr = presence.get(p.id)!;
            const todayMs = dailyTotals(db.shifts.filter((s) => s.user_id === p.id), db.breaks, now).get(today) ?? 0;
            const job = pr.jobId ? db.jobs.find((j) => j.id === pr.jobId) : null;
            return (
              <motion.button key={p.id} variants={item} className="card person" onClick={() => onPerson(p.id)} whileTap={{ scale: 0.985 }}>
                <Avatar p={p} size={46} status={pr.state} ring />
                <div className="grow">
                  <b>{p.full_name}</b>
                  <small className="muted">{ROLE_META[p.role].label} · #{p.employee_code}</small>
                  <small className={`state ${pr.state}`}>{pr.state === "working" ? `Working on ${job?.code}` : pr.state === "break" ? "On break" : pr.state === "on" ? "On shift · free" : "Off shift"}</small>
                </div>
                <div className="right"><b className="mono">{hm(todayMs)}</b><small className="muted">today</small></div>
              </motion.button>
            );
          })}
        </motion.div>
      </Section>
    </motion.div>
  );
}

export function PersonSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { db, me, person } = useStore();
  const presence = usePresence();
  const now = useNow(1000);
  const a = useActions();
  const p = person(id);
  const [allow, setAllow] = useState<string>("");
  if (!p) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const pr = presence.get(p.id)!;
  const month = startOfMonth();
  const shifts = db.shifts.filter((s) => s.user_id === p.id && new Date(s.clock_in) >= month);
  const { normal, over } = splitOvertime(dailyTotals(shifts, db.breaks, now).values());
  const jobsDone = new Set(db.participants.filter((x) => x.user_id === p.id).map((x) => x.job_id));
  const teamJobs = [...jobsDone].filter((j) => jobStats(db, j, now).team).length;
  const used = db.absences.filter((x) => x.user_id === p.id && x.kind === "holiday" && x.status === "approved" && x.start_date.startsWith(String(new Date().getFullYear())))
    .reduce((t, x) => t + (new Date(x.end_date).getTime() - new Date(x.start_date).getTime()) / 864e5 + 1, 0);
  const isAdmin = can.admin(me.role);
  return (
    <Sheet open={!!id} onClose={onClose} tall title="Team member">
      <div className="stack">
        <div className="person-hero">
          <Avatar p={p} size={84} status={pr.state} ring />
          <div><h2>{p.full_name}</h2><span className="row gap-s"><Badge tone="role" >{ROLE_META[p.role].label}</Badge><Badge>#{p.employee_code}</Badge></span>
            <small className={`state ${pr.state}`}>{pr.state === "working" ? `Working · ${hms(now - new Date(pr.since!).getTime())}` : pr.state === "break" ? "On break" : pr.state === "on" ? "On shift" : "Off shift"}</small>
          </div>
        </div>
        <div className="tri">
          <div><small>This month</small><b className="mono">{hm(normal + over)}</b></div>
          <div><small>Overtime</small><b className="mono">{hm(over)}</b></div>
          <div><small>Team jobs</small><b className="mono">{teamJobs}</b></div>
        </div>
        {can.changeRoles(me.role) && p.id !== me.id && (
          <Field label="Role / gateway">
            <div className="chips">{ROLE_ORDER.map((r) => <Chip key={r} color={ROLE_META[r].hue} on={p.role === r} onClick={() => a.updateProfile(p.id, { role: r })}><ShieldCheck size={14} />{ROLE_META[r].label}</Chip>)}</div>
          </Field>
        )}
        {isAdmin && (
          <Field label={`Holiday allowance · ${used} of ${p.holiday_allowance} used this year`}>
            <div className="row gap">
              <input type="number" min={0} max={60} placeholder={String(p.holiday_allowance)} value={allow} onChange={(e) => setAllow(e.target.value)} />
              <Btn tone="soft" disabled={!allow} onClick={async () => { await a.updateProfile(p.id, { holiday_allowance: Number(allow) }); setAllow(""); }}>Set</Btn>
            </div>
          </Field>
        )}
        {(isAdmin || p.id === me.id) && <div className="card flat"><TimeSheet userId={p.id} /></div>}
      </div>
    </Sheet>
  );
}
