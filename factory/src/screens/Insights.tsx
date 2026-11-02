import { motion } from "motion/react";
import { Clock3, Gauge, Layers, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar, AvatarStack } from "../components/Avatar";
import { Badge, Count, Empty, Section, Segmented, item, list } from "../components/ui";
import { useNow, useStore } from "../lib/store";
import { dailyTotals, hm, human, participantMs, sessionMs, splitOvertime, startOfDay } from "../lib/time";
import type { Job } from "../lib/types";

export function Insights({ onOpenJob }: { onOpenJob: (j: Job) => void }) {
  const { db, person } = useStore();
  const now = useNow(60000);
  const [range, setRange] = useState<"week" | "month">("week");
  const from = startOfDay().getTime() - (range === "week" ? 6 : 29) * 864e5;

  const d = useMemo(() => {
    const sessions = db.work_sessions.filter((s) => new Date(s.started_at).getTime() >= from);
    const sids = new Set(sessions.map((s) => s.id));
    const parts = db.participants.filter((p) => sids.has(p.session_id));
    const wall = sessions.reduce((a, s) => a + sessionMs(s, now), 0);
    const personMs = parts.reduce((a, p) => a + participantMs(p, now), 0);
    const crewOf = (sid: string) => new Set(parts.filter((p) => p.session_id === sid).map((p) => p.user_id)).size;
    const teamSessions = sessions.filter((s) => crewOf(s.id) >= 2);
    const teamPerson = parts.filter((p) => teamSessions.some((s) => s.id === p.session_id)).reduce((a, p) => a + participantMs(p, now), 0);

    const byJob = new Map<string, { wall: number; person: number; crew: number; people: Set<string>; teamSessions: number }>();
    for (const s of sessions) {
      const r = byJob.get(s.job_id) ?? { wall: 0, person: 0, crew: 0, people: new Set(), teamSessions: 0 };
      r.wall += sessionMs(s, now);
      const ps = parts.filter((p) => p.session_id === s.id);
      r.person += ps.reduce((a, p) => a + participantMs(p, now), 0);
      ps.forEach((p) => r.people.add(p.user_id));
      const c = crewOf(s.id); r.crew = Math.max(r.crew, c); if (c >= 2) r.teamSessions++;
      byJob.set(s.job_id, r);
    }
    const jobs = [...byJob.entries()].map(([id, v]) => ({ job: db.jobs.find((j) => j.id === id), ...v })).filter((x) => x.job).sort((a, b) => b.person - a.person);

    const staff = db.profiles.map((p) => {
      const shifts = db.shifts.filter((s) => s.user_id === p.id && new Date(s.clock_in).getTime() >= from);
      const { normal, over } = splitOvertime(dailyTotals(shifts, db.breaks, now).values());
      const onJobs = parts.filter((x) => x.user_id === p.id).reduce((a, x) => a + participantMs(x, now), 0);
      return { p, worked: normal + over, over, onJobs };
    }).filter((x) => x.worked > 0 || x.onJobs > 0).sort((a, b) => b.worked - a.worked);

    const done = db.jobs.filter((j) => j.completed_at && new Date(j.completed_at).getTime() >= from);
    const estAcc = done.filter((j) => j.estimate_minutes).map((j) => {
      const w = db.work_sessions.filter((s) => s.job_id === j.id).reduce((a, s) => a + sessionMs(s, now), 0);
      return w / (j.estimate_minutes! * 60000);
    });
    return { wall, personMs, teamSessions: teamSessions.length, teamShare: personMs ? teamPerson / personMs : 0, jobs, staff, done: done.length, est: estAcc.length ? estAcc.reduce((a, b) => a + b, 0) / estAcc.length : 0 };
  }, [db, from, now]);

  const maxW = Math.max(1, ...d.staff.map((s) => s.worked));
  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <Section title="Insights" sub="Where the hours go — and who teams up" action={<Segmented size="s" value={range} onChange={setRange} options={[{ value: "week", label: "7 days" }, { value: "month", label: "30 days" }]} />}>
        <motion.div className="kpis" variants={list}>
          <motion.div className="kpi c-blue" variants={item}><span className="kpi-ic"><Clock3 size={18} /></span><b><Count value={d.personMs / 36e5} format={(v) => hm(v * 36e5)} /></b><small>Person-hours on jobs</small></motion.div>
          <motion.div className="kpi c-green" variants={item}><span className="kpi-ic"><Gauge size={18} /></span><b><Count value={d.wall / 36e5} format={(v) => hm(v * 36e5)} /></b><small>Job clock time</small></motion.div>
          <motion.div className="kpi c-violet" variants={item}><span className="kpi-ic"><Users size={18} /></span><b><Count value={d.teamShare * 100} format={(v) => `${Math.round(v)}%`} /></b><small>Hours worked in teams</small></motion.div>
          <motion.div className="kpi c-amber" variants={item}><span className="kpi-ic"><Layers size={18} /></span><b><Count value={d.done} /></b><small>Jobs completed · est. {d.est ? `${Math.round(d.est * 100)}%` : "—"}</small></motion.div>
        </motion.div>
      </Section>

      <Section title="Jobs by effort" sub="Job time vs person-hours. Team jobs use more hands than the clock shows.">
        <motion.div className="stack" variants={list} initial="hidden" animate="show" key={range}>
          {d.jobs.slice(0, 10).map(({ job, wall, person: pm, crew, people, teamSessions }) => (
            <motion.button key={job!.id} variants={item} className="card effort" onClick={() => onOpenJob(job!)} whileTap={{ scale: 0.985 }}>
              <div className="row between"><span className="code">{job!.code}</span>{crew >= 2 && <Badge tone="violet"><Users size={12} /> up to ×{crew} · {teamSessions} team run{teamSessions > 1 ? "s" : ""}</Badge>}</div>
              <b>{job!.title}</b>
              <div className="dual">
                <div><small>Job time</small><div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${(wall / Math.max(1, d.jobs[0]!.person)) * 100}%` }} /></div><span className="mono">{human(wall)}</span></div>
                <div><small>Person-hours</small><div className="bar violet"><motion.i initial={{ width: 0 }} animate={{ width: `${(pm / Math.max(1, d.jobs[0]!.person)) * 100}%` }} /></div><span className="mono">{human(pm)}</span></div>
              </div>
              <AvatarStack people={[...people].map(person)} size={22} max={6} />
            </motion.button>
          ))}
          {!d.jobs.length && <Empty icon={<Layers size={28} />} title="No job time yet" hint="Once people start jobs, the effort shows up here." />}
        </motion.div>
      </Section>

      <Section title="Hours by person" sub="Shift time, with the part spent on jobs">
        <motion.div className="card flat" variants={item}>
          {d.staff.map(({ p, worked, over, onJobs }, i) => (
            <div key={p.id} className="hbar">
              <Avatar p={p} size={28} />
              <div className="grow">
                <div className="row between"><span>{p.full_name}</span><span className="mono">{hm(worked)}{over ? <em className="violet-t"> +{hm(over)}</em> : null}</span></div>
                <div className="bar stacked">
                  <motion.i initial={{ width: 0 }} animate={{ width: `${(worked / maxW) * 100}%` }} transition={{ delay: i * 0.03 }} />
                  <motion.b initial={{ width: 0 }} animate={{ width: `${(Math.min(onJobs, worked) / maxW) * 100}%` }} transition={{ delay: 0.2 + i * 0.03 }} />
                </div>
              </div>
            </div>
          ))}
          <div className="legend"><span><i className="a" />Shift</span><span><i className="b" />On jobs</span></div>
        </motion.div>
      </Section>
    </motion.div>
  );
}
