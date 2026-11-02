import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Boxes, CalendarCheck, Clock3, Layers, RefreshCw, Users, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { AvatarStack } from "../components/Avatar";
import { Count, Empty, Section, item, list } from "../components/ui";
import { useMine, usePresence } from "../lib/actions";
import { can, ROLE_META, type Tab } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { greeting, hm, hms, jobStats, participantMs, startOfDay } from "../lib/time";
import type { Job } from "../lib/types";
import { InviteCard, JobCard, LiveJobCard, NewsFeed, OnShiftRow, ShiftCard } from "./parts";

export function Hello() {
  const { me } = useStore();
  const first = me.full_name.split(" ")[0];
  return (
    <motion.div className="hello" initial="hidden" animate="show" variants={list}>
      <motion.p variants={item} className="muted">{greeting()},</motion.p>
      <motion.h1 variants={item}><span className="grad">{first}</span> <motion.span className="wave" animate={{ rotate: [0, 18, -8, 14, 0] }} transition={{ delay: 0.8, duration: 1.2 }}>👋</motion.span></motion.h1>
      <motion.div variants={item} className="script">Have a wonderful day!</motion.div>
      <motion.span variants={item} className="role-tag" style={{ ["--c" as string]: ROLE_META[me.role].hue }}>{ROLE_META[me.role].label} · #{me.employee_code}</motion.span>
    </motion.div>
  );
}

export function Home({ onOpenJob, go, onPerson }: { onOpenJob: (j: Job) => void; go: (t: Tab) => void; onPerson: (id: string) => void }) {
  const { me } = useStore();
  return can.admin(me.role)
    ? <LeadHome onOpenJob={onOpenJob} go={go} onPerson={onPerson} />
    : <WorkerHome onOpenJob={onOpenJob} go={go} onPerson={onPerson} />;
}

function WorkerHome({ onOpenJob, go, onPerson }: { onOpenJob: (j: Job) => void; go: (t: Tab) => void; onPerson: (id: string) => void }) {
  const { db, me, refresh } = useStore();
  const { invites, job: current } = useMine();
  const [spin, setSpin] = useState(false);
  const mine = db.jobs.filter((j) => j.assignees.includes(me.id) && j.status !== "done").sort((a, b) => a.priority - b.priority || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const counts = {
    progress: mine.filter((j) => j.status === "in_progress").length,
    open: mine.filter((j) => j.status === "open" || j.status === "paused").length,
    blocked: mine.filter((j) => j.status === "blocked").length,
  };
  return (
    <motion.div className="page" variants={list} initial="hidden" animate="show">
      <Hello />
      <AnimatePresence>{invites.map((i) => <InviteCard key={i.id} inv={i} />)}</AnimatePresence>
      <ShiftCard />
      <LiveJobCard onOpen={onOpenJob} />

      <motion.div className="stats3" variants={item}>
        <button onClick={() => go("jobs")}><small>In progress</small><b className="green-t"><Count value={counts.progress} /></b></button>
        <button onClick={() => go("jobs")}><small>Open tasks</small><b><Count value={counts.open} /></b></button>
        <button onClick={() => go("jobs")}><small>Blocked</small><b className={counts.blocked ? "red-t" : ""}><Count value={counts.blocked} /></b></button>
      </motion.div>

      <Section title="Priority jobs" sub="Start at the top. Tap to start or team up."
        action={<motion.button className="icon-btn" animate={{ rotate: spin ? 360 : 0 }} transition={{ duration: 0.6 }}
          onClick={async () => { setSpin(true); await refresh(); setTimeout(() => setSpin(false), 600); }} aria-label="Refresh"><RefreshCw size={18} /></motion.button>}>
        <motion.div className="stack" variants={list} initial="hidden" animate="show">
          {mine.filter((j) => j.id !== current?.id).slice(0, 4).map((j, i) => <JobCard key={j.id} job={j} onOpen={onOpenJob} rank={i + 1} />)}
          {!mine.length && <Empty icon={<Layers size={28} />} title="All clear" hint="No production jobs are assigned to you yet. Your manager will drop them here." />}
          {mine.length > 4 && <button className="link center" onClick={() => go("jobs")}>See all {mine.length} jobs <ArrowRight size={14} /></button>}
        </motion.div>
      </Section>
      <OnShiftRow onPerson={onPerson} />
      <NewsFeed />
    </motion.div>
  );
}

function LeadHome({ onOpenJob, go, onPerson }: { onOpenJob: (j: Job) => void; go: (t: Tab) => void; onPerson: (id: string) => void }) {
  const { db, me, person } = useStore();
  const now = useNow(1000);
  const presence = usePresence();
  const { invites } = useMine();
  const today = startOfDay().getTime();

  const k = useMemo(() => {
    const on = [...presence.values()].filter((p) => p.state !== "off").length;
    const live = db.work_sessions.filter((s) => !s.ended_at);
    const todayParts = db.participants.filter((p) => new Date(p.joined_at).getTime() >= today);
    const personToday = todayParts.reduce((a, p) => a + participantMs(p, now), 0);
    const sessToday = db.work_sessions.filter((s) => new Date(s.started_at).getTime() >= today);
    const teamToday = sessToday.filter((s) => new Set(db.participants.filter((p) => p.session_id === s.id).map((p) => p.user_id)).size >= 2).length;
    return {
      on, live, personToday, teamToday,
      issues: db.issues.filter((i) => i.status !== "resolved").length,
      requests: db.absences.filter((a) => a.status === "pending").length,
      low: db.stock_items.filter((s) => s.quantity <= s.min_quantity).length,
      done: db.jobs.filter((j) => j.completed_at && new Date(j.completed_at).getTime() >= today).length,
    };
  }, [db, presence, now, today]);

  const tiles = [
    { label: "On shift", v: k.on, icon: <Users size={18} />, c: "green", tab: "team" as Tab },
    { label: "Live jobs", v: k.live.length, icon: <Zap size={18} />, c: "red", tab: "jobs" as Tab },
    { label: "Person-hours today", v: k.personToday / 3600000, f: (v: number) => hm(v * 3600000), icon: <Clock3 size={18} />, c: "blue", tab: (me.role === "boss" ? "insights" : "team") as Tab },
    { label: "Team jobs today", v: k.teamToday, icon: <Layers size={18} />, c: "violet", tab: (me.role === "boss" ? "insights" : "jobs") as Tab },
    { label: "Open issues", v: k.issues, icon: <AlertTriangle size={18} />, c: "amber", tab: "issues" as Tab },
    { label: "Pending requests", v: k.requests, icon: <CalendarCheck size={18} />, c: "cyan", tab: "requests" as Tab },
    ...(me.role === "office" ? [{ label: "Low stock", v: k.low, icon: <Boxes size={18} />, c: "red", tab: "stock" as Tab }] : []),
  ];

  return (
    <motion.div className="page" variants={list} initial="hidden" animate="show">
      <Hello />
      <AnimatePresence>{invites.map((i) => <InviteCard key={i.id} inv={i} />)}</AnimatePresence>
      <motion.div className="kpis" variants={list}>
        {tiles.map((t) => (
          <motion.button key={t.label} className={`kpi c-${t.c}`} variants={item} whileTap={{ scale: 0.96 }} onClick={() => go(t.tab)}>
            <span className="kpi-ic">{t.icon}</span>
            <b><Count value={t.v} format={t.f} /></b>
            <small>{t.label}</small>
          </motion.button>
        ))}
      </motion.div>

      <Section title="Live floor" sub="Every job running right now, with its crew">
        <motion.div className="stack" variants={list} initial="hidden" animate="show">
          {k.live.length === 0 && <Empty icon={<Zap size={26} />} title="Quiet floor" hint="No jobs are being worked on right now." />}
          {k.live.map((s) => {
            const job = db.jobs.find((j) => j.id === s.job_id);
            if (!job) return null;
            const crew = db.participants.filter((p) => p.session_id === s.id && !p.left_at);
            const st = jobStats(db, job.id, now);
            return (
              <motion.button key={s.id} variants={item} className="card floor-job" onClick={() => onOpenJob(job)} whileTap={{ scale: 0.985 }}>
                <div className="row between"><span className="code">{job.code}</span>{crew.length > 1 && <span className="badge violet"><Users size={12} /> ×{crew.length}</span>}</div>
                <b>{job.title}</b>
                <div className="row between">
                  <AvatarStack people={crew.map((c) => person(c.user_id))} size={30} />
                  <span className="mono live-mini"><i className="pulse red" />{hms(now - new Date(s.started_at).getTime())}</span>
                </div>
                <small className="muted">Person-hours on job: <b className="mono">{hm(st.person)}</b> · wall time <b className="mono">{hm(st.wall)}</b></small>
              </motion.button>
            );
          })}
        </motion.div>
      </Section>
      <ShiftCard />
      <OnShiftRow onPerson={onPerson} />
      <NewsFeed />
    </motion.div>
  );
}
