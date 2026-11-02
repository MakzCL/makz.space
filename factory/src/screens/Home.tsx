import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Layers, RefreshCw, Users, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { AvatarStack } from "../components/Avatar";
import { Scene } from "../components/Scene";
import { Count, Empty, RoundBtn, Section, item, list } from "../components/ui";
import { useMine, usePresence } from "../lib/actions";
import { t } from "../lib/i18n";
import { can, ROLE_META, TABS_FOR, type Tab } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { greeting, hm, hms, jobStats, participantMs, startOfDay } from "../lib/time";
import type { Job, Role } from "../lib/types";
import { InviteCard, JobCard, LiveJobCard, NewsFeed, OnShiftRow, ShiftCard } from "./parts";

function Hero() {
  const { me, refresh } = useStore();
  const [spin, setSpin] = useState(false);
  return (
    <motion.div className="hero" variants={item}>
      <Scene kind="factory" height={230}>
        <div className="scene-actions">
          <RoundBtn label={t("Refresh")} onClick={async () => { setSpin(true); await refresh(); setTimeout(() => setSpin(false), 500); }}>
            <motion.span animate={{ rotate: spin ? 360 : 0 }} transition={{ duration: 0.5 }} style={{ display: "grid" }}><RefreshCw size={18} /></motion.span>
          </RoundBtn>
        </div>
        <div className="hero-text">
          <p>{greeting()},</p>
          <h1>{me.full_name.split(" ")[0]}</h1>
          <span className="script">{t("Have a wonderful day!")}</span>
        </div>
      </Scene>
      <div className="hero-foot">
        <span className="role-tag">{t(ROLE_META[me.role].label)}</span>
        <span className="muted">#{me.employee_code}</span>
      </div>
    </motion.div>
  );
}

export function Home({ onOpenJob, go, onPerson, onReport }: { onOpenJob: (j: Job) => void; go: (t: Tab) => void; onPerson: (id: string) => void; onReport: (j: Job) => void }) {
  const { me } = useStore();
  return can.admin(me.role)
    ? <LeadHome onOpenJob={onOpenJob} go={go} onPerson={onPerson} onReport={onReport} />
    : <WorkerHome onOpenJob={onOpenJob} go={go} onPerson={onPerson} onReport={onReport} />;
}

function WorkerHome({ onOpenJob, go, onPerson, onReport }: { onOpenJob: (j: Job) => void; go: (t: Tab) => void; onPerson: (id: string) => void; onReport: (j: Job) => void }) {
  const { db, me } = useStore();
  const { invites, job: current } = useMine();
  const mine = db.jobs.filter((j) => j.assignees.includes(me.id) && j.status !== "done").sort((a, b) => a.priority - b.priority || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const counts = {
    progress: mine.filter((j) => j.status === "in_progress").length,
    open: mine.filter((j) => j.status === "open" || j.status === "paused").length,
    blocked: mine.filter((j) => j.status === "blocked").length,
  };
  return (
    <motion.div className="page" variants={list} initial="hidden" animate="show">
      <Hero />
      <AnimatePresence>{invites.map((i) => <InviteCard key={i.id} inv={i} />)}</AnimatePresence>
      <LiveJobCard onOpen={onOpenJob} onReport={onReport} />
      <ShiftCard />

      <motion.div className="tiles3" variants={item}>
        <button className="tile red" onClick={() => go("jobs")}><b><Count value={counts.progress} /></b><small>{t("In progress")}</small></button>
        <button className="tile blue" onClick={() => go("jobs")}><b><Count value={counts.open} /></b><small>{t("Open tasks")}</small></button>
        <button className="tile plain" onClick={() => go("jobs")}><b><Count value={counts.blocked} /></b><small>{t("Blocked")}</small></button>
      </motion.div>

      <Section title={t("Priority jobs")} sub={t("Start at the top.")}>
        <motion.div className="stack" variants={list} initial="hidden" animate="show">
          {mine.filter((j) => j.id !== current?.id).slice(0, 4).map((j, i) => <JobCard key={j.id} job={j} onOpen={onOpenJob} rank={i + 1} />)}
          {!mine.length && <Empty icon={<Layers size={26} />} title={t("All clear")} hint={t("No production jobs are assigned to you yet.")} />}
          {mine.length > 4 && <button className="link center" onClick={() => go("jobs")}>{t("See all {n} jobs", { n: mine.length })} <ArrowRight size={14} /></button>}
        </motion.div>
      </Section>
      <OnShiftRow onPerson={onPerson} />
      <NewsFeed />
    </motion.div>
  );
}

function LeadHome({ onOpenJob, go, onPerson }: { onOpenJob: (j: Job) => void; go: (t: Tab) => void; onPerson: (id: string) => void; onReport: (j: Job) => void }) {
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
      requests: db.absences.filter((a) => a.status === "pending").length + db.profiles.filter((p) => !p.active).length,
      low: db.stock_items.filter((s) => s.quantity <= s.min_quantity).length,
    };
  }, [db, presence, now, today]);

  const small = [
    { label: t("Person-hours today"), v: k.personToday / 3600000, f: (v: number) => hm(v * 3600000), tab: (me.role === "boss" ? "insights" : "team") as Tab },
    { label: t("Team jobs today"), v: k.teamToday, tab: (me.role === "boss" ? "insights" : "jobs") as Tab },
    { label: t("Open issues"), v: k.issues, tab: "issues" as Tab },
    { label: t("Waiting for you"), v: k.requests, tab: "requests" as Tab },
    ...(me.role === "office" ? [{ label: t("Low stock"), v: k.low, tab: "stock" as Tab }] : []),
  ];

  return (
    <motion.div className="page" variants={list} initial="hidden" animate="show">
      <Hero />
      <AnimatePresence>{invites.map((i) => <InviteCard key={i.id} inv={i} />)}</AnimatePresence>
      <motion.div className="awards" variants={item}>
        <button className="award red" onClick={() => go("team")}><span className="medal"><Users size={22} /></span><b><Count value={k.on} /></b><small>{t("On shift")}</small></button>
        <button className="award blue" onClick={() => go(tabsHas(me.role, "jobs") ? "jobs" : "team")}><span className="medal"><Zap size={22} /></span><b><Count value={k.live.length} /></b><small>{t("Live jobs")}</small></button>
      </motion.div>
      <motion.div className="stat-list card" variants={item}>
        {small.map((s) => (
          <button key={s.label} className="stat-line" onClick={() => go(s.tab)}>
            <span>{s.label}</span><b><Count value={s.v} format={s.f} /></b><ArrowRight size={16} />
          </button>
        ))}
      </motion.div>

      <Section title={t("Live floor")} sub={t("Every job running right now, with its crew")}>
        <motion.div className="stack" variants={list} initial="hidden" animate="show">
          {k.live.length === 0 && <Empty icon={<Zap size={24} />} title={t("Quiet floor")} hint={t("No jobs are being worked on right now.")} />}
          {k.live.map((s) => {
            const job = db.jobs.find((j) => j.id === s.job_id);
            if (!job) return null;
            const crew = db.participants.filter((p) => p.session_id === s.id && !p.left_at);
            const st = jobStats(db, job.id, now);
            return (
              <motion.button key={s.id} variants={item} className="card floor-job" onClick={() => onOpenJob(job)} whileTap={{ scale: 0.985 }}>
                <div className="row between"><span className="code">{job.code}</span><span className="clock-chip"><i className="live-dot" />{hms(now - new Date(s.started_at).getTime())}</span></div>
                <b>{job.title}</b>
                <div className="row between">
                  <AvatarStack people={crew.map((c) => person(c.user_id))} size={30} />
                  <small className="muted">{crew.length > 1 ? t("{n} people", { n: crew.length }) : t("1 person")} · {hm(st.person)} {t("person-hours")}</small>
                </div>
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

const tabsHas = (r: Role, tab: Tab) => TABS_FOR[r].includes(tab);
