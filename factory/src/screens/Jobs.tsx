import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, Check, Layers, Pause, Pencil, Play, Plus, RotateCcw, Search, Trash2, UserPlus, Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Chip, Empty, Field, HoldButton, Section, Segmented, Sheet, list } from "../components/ui";
import { useActions, useMine } from "../lib/actions";
import { can } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { clock, dayLabel, hm, human, jobStats, participantMs } from "../lib/time";
import type { Job } from "../lib/types";
import { InviteSheet, JobCard, PRIORITY, STATUS } from "./parts";

export function Jobs({ onOpenJob, onNew }: { onOpenJob: (j: Job) => void; onNew: () => void }) {
  const { db, me } = useStore();
  const lead = can.manageJobs(me.role);
  const [view, setView] = useState<"active" | "done">("active");
  const [scope, setScope] = useState<"mine" | "all">(lead ? "all" : "mine");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Job["status"] | "any">("any");

  const jobs = useMemo(() => db.jobs
    .filter((j) => (view === "done" ? j.status === "done" : j.status !== "done"))
    .filter((j) => scope === "all" || j.assignees.includes(me.id))
    .filter((j) => status === "any" || j.status === status)
    .filter((j) => !q || `${j.code} ${j.title} ${j.customer}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => view === "done"
      ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
      : a.priority - b.priority || (a.due_date ?? "9").localeCompare(b.due_date ?? "9")),
  [db.jobs, view, scope, status, q, me.id]);

  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <Section title={lead ? "All jobs" : "My jobs"} sub="Sorted by manufacturing priority. Colour shows status."
        action={<Segmented size="s" value={view} onChange={setView} options={[{ value: "active", label: "Active" }, { value: "done", label: "Done" }]} />}>
        <div className="searchbar"><Search size={18} /><input placeholder="Search code, title, customer…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="chips">
          {!lead && <Chip on={scope === "all"} onClick={() => setScope(scope === "all" ? "mine" : "all")}><Users size={14} /> Whole floor</Chip>}
          {lead && <Chip on={scope === "mine"} onClick={() => setScope(scope === "mine" ? "all" : "mine")}>Mine only</Chip>}
          {view === "active" && (["in_progress", "open", "paused", "blocked"] as const).map((s) => (
            <Chip key={s} on={status === s} onClick={() => setStatus(status === s ? "any" : s)}>{STATUS[s].label}</Chip>
          ))}
        </div>
        <motion.div className="stack" variants={list} initial="hidden" animate="show" key={view + scope + status}>
          {jobs.map((j, i) => <JobCard key={j.id} job={j} onOpen={onOpenJob} rank={view === "active" ? i + 1 : undefined} />)}
          {!jobs.length && <Empty icon={<Layers size={28} />} title={view === "done" ? "Nothing finished yet" : "No jobs here"} hint={scope === "mine" ? "No production operations are assigned to your account." : "Try clearing filters."} />}
        </motion.div>
      </Section>
      {lead && (
        <motion.button className="fab" onClick={onNew} initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} whileTap={{ scale: 0.9 }} aria-label="New job">
          <Plus size={26} />
        </motion.button>
      )}
    </motion.div>
  );
}

export function JobSheet({ job, onClose, onEdit, onReport }: { job: Job | null; onClose: () => void; onEdit: (j: Job) => void; onReport: (j: Job) => void }) {
  const { db, me, person } = useStore();
  const now = useNow(1000);
  const a = useActions();
  const mine = useMine();
  const [inviting, setInviting] = useState(false);
  const j = job ? db.jobs.find((x) => x.id === job.id) ?? job : null;
  const st = j ? jobStats(db, j.id, now) : null;
  const lead = can.manageJobs(me.role);

  return (
    <Sheet open={!!job} onClose={onClose} tall title={j && <span className="row gap-s"><span className="code">{j.code}</span><Badge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</Badge></span>}>
      {j && st && (() => {
        const imIn = mine.part?.job_id === j.id;
        const crew = st.live ? db.participants.filter((p) => p.session_id === st.live!.id && !p.left_at) : [];
        const canWork = j.assignees.includes(me.id) || lead || !!st.live;
        return (
          <div className="stack">
            <h2 className="job-h">{j.title}</h2>
            <div className="row gap-s wrap">
              <Badge tone={j.priority <= 2 ? "red" : "muted"}>{PRIORITY[j.priority]}</Badge>
              {j.customer && <Badge>{j.customer}</Badge>}
              {j.quantity ? <Badge>Qty {j.quantity}</Badge> : null}
              {j.due_date && <Badge tone="blue">Due {dayLabel(j.due_date)}</Badge>}
              {st.team && <Badge tone="violet"><Users size={12} /> Team job · up to {st.maxCrew}</Badge>}
            </div>
            {j.description && <p className="desc">{j.description}</p>}

            <div className="tri">
              <div><small>Job time</small><b className="mono">{hm(st.wall)}</b><em>clock on the job</em></div>
              <div><small>Person-hours</small><b className="mono">{hm(st.person)}</b><em>all hands combined</em></div>
              <div><small>Estimate</small><b className="mono">{j.estimate_minutes ? hm(j.estimate_minutes * 60000) : "—"}</b><em>{j.estimate_minutes ? `${Math.round((st.wall / (j.estimate_minutes * 60000)) * 100)}% used` : "not set"}</em></div>
            </div>

            {j.status !== "done" && (
              <div className="stack">
                {imIn ? (
                  <>
                    <Btn tone="soft" wide icon={<UserPlus size={18} />} onClick={() => setInviting(true)}>Invite a helper</Btn>
                    <div className="row gap">
                      <Btn tone="soft" wide icon={<Pause size={18} />} onClick={() => crew.length > 1 ? a.leaveSession() : a.stopJob(j, "paused")}>{crew.length > 1 ? "Leave job" : "Pause"}</Btn>
                      <HoldButton tone="primary" icon={<Check size={18} />} onConfirm={async () => { await a.stopJob(j, "done"); onClose(); }}>Hold · complete</HoldButton>
                    </div>
                  </>
                ) : canWork && j.status !== "blocked" ? (
                  <Btn tone="primary" wide icon={st.live ? <Users size={18} /> : <Play size={18} />} onClick={() => a.startJob(j)}>
                    {st.live ? `Join the crew (${crew.length} working)` : mine.part ? "Switch to this job" : mine.shift ? "Start job" : "Clock in & start job"}
                  </Btn>
                ) : j.status === "blocked" ? (
                  <p className="muted center">This job is blocked by an issue. {lead && "Resolve the issue or reopen it below."}</p>
                ) : <p className="muted center">Not assigned to you. Ask a teammate to invite you.</p>}
                <div className="row gap">
                  <Btn tone="ghost" wide icon={<AlertTriangle size={18} />} onClick={() => onReport(j)}>Report issue</Btn>
                  {lead && j.status === "blocked" && <Btn tone="ghost" wide icon={<RotateCcw size={18} />} onClick={() => a.reopenJob(j)}>Unblock</Btn>}
                </div>
              </div>
            )}
            {j.status === "done" && lead && <Btn tone="ghost" wide icon={<RotateCcw size={18} />} onClick={() => a.reopenJob(j)}>Reopen job</Btn>}

            {st.perPerson.size > 0 && (
              <div className="card flat">
                <small className="eyebrow">Who put time in</small>
                {[...st.perPerson.entries()].sort((x, y) => y[1] - x[1]).map(([uid, ms]) => (
                  <div key={uid} className="contrib">
                    <Avatar p={person(uid)} size={30} status={crew.some((c) => c.user_id === uid) ? "working" : undefined} />
                    <span className="grow">{person(uid)?.full_name}</span>
                    <b className="mono">{hm(ms)}</b>
                    <div className="contrib-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${(ms / Math.max(1, st.person)) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}

            {st.sessions.length > 0 && (
              <div className="card flat">
                <small className="eyebrow">Timeline</small>
                <div className="timeline">
                  {[...st.sessions].sort((x, y) => y.started_at.localeCompare(x.started_at)).slice(0, 12).map((s) => {
                    const ps = db.participants.filter((p) => p.session_id === s.id);
                    const people = [...new Set(ps.map((p) => p.user_id))];
                    const wall = (s.ended_at ? new Date(s.ended_at).getTime() : now) - new Date(s.started_at).getTime();
                    const pers = ps.reduce((x, p) => x + participantMs(p, now), 0);
                    return (
                      <div key={s.id} className={`tl ${!s.ended_at ? "live" : ""}`}>
                        <i />
                        <div className="grow">
                          <div className="row between"><b>{dayLabel(s.started_at)} · {clock(s.started_at)}–{s.ended_at ? clock(s.ended_at) : "now"}</b><span className="mono">{human(wall)}</span></div>
                          <div className="row gap-s wrap">
                            {people.map((u) => <span key={u} className="who"><Avatar p={person(u)} size={18} />{person(u)?.full_name.split(" ")[0]}</span>)}
                          </div>
                          {people.length > 1 && <small className="violet-t">{people.length} people · {human(pers)} person-time</small>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="card flat">
              <small className="eyebrow">Assigned</small>
              <div className="row gap-s wrap">
                {j.assignees.map((u) => <span key={u} className="who big"><Avatar p={person(u)} size={26} />{person(u)?.full_name}</span>)}
                {!j.assignees.length && <span className="muted">Nobody yet</span>}
              </div>
            </div>

            {lead && (
              <div className="row gap">
                <Btn tone="ghost" wide icon={<Pencil size={16} />} onClick={() => onEdit(j)}>Edit</Btn>
                <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={async () => { await a.deleteJob(j); onClose(); }}>Hold · delete</HoldButton>
              </div>
            )}
            {imIn && mine.session && <InviteSheet open={inviting} onClose={() => setInviting(false)} jobId={j.id} sessionId={mine.session.id} />}
          </div>
        );
      })()}
    </Sheet>
  );
}

export function JobEditor({ open, job, onClose }: { open: boolean; job: Job | null; onClose: () => void }) {
  const { db } = useStore();
  const a = useActions();
  const blank = { title: "", description: "", customer: "", priority: 3, estimate_minutes: null as number | null, quantity: null as number | null, due_date: null as string | null, assignees: [] as string[] };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(job ? { title: job.title, description: job.description, customer: job.customer, priority: job.priority, estimate_minutes: job.estimate_minutes, quantity: job.quantity, due_date: job.due_date, assignees: job.assignees } : blank);
  }, [open, job]); // eslint-disable-line react-hooks/exhaustive-deps
  const staff = db.profiles.filter((p) => p.role === "operator" || p.role === "assistant" || f.assignees.includes(p.id));
  const others = db.profiles.filter((p) => !staff.includes(p));
  return (
    <Sheet open={open} onClose={onClose} tall title={job ? `Edit ${job.code}` : "New job"}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); await a.saveJob({ ...f, id: job?.id }); onClose(); }}>
        <Field label="Title"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Control board rev D — SMT" /></Field>
        <Field label="Customer"><input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} placeholder="Optional" /></Field>
        <Field label="Instructions"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Drawing refs, checks, torque values…" /></Field>
        <Field label="Priority">
          <div className="chips">{[1, 2, 3, 4, 5].map((p) => <Chip key={p} on={f.priority === p} onClick={() => setF({ ...f, priority: p })}>{PRIORITY[p]}</Chip>)}</div>
        </Field>
        <div className="row gap">
          <Field label="Estimate (hours)"><input type="number" min={0} step={0.25} inputMode="decimal" value={f.estimate_minutes ? f.estimate_minutes / 60 : ""} onChange={(e) => setF({ ...f, estimate_minutes: e.target.value ? Math.round(Number(e.target.value) * 60) : null })} /></Field>
          <Field label="Quantity"><input type="number" min={0} inputMode="numeric" value={f.quantity ?? ""} onChange={(e) => setF({ ...f, quantity: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
        <Field label="Due date"><input type="date" value={f.due_date ?? ""} onChange={(e) => setF({ ...f, due_date: e.target.value || null })} /></Field>
        <Field label="Assign to">
          <div className="pick-grid">
            {[...staff, ...others].map((p) => {
              const on = f.assignees.includes(p.id);
              return (
                <motion.button type="button" key={p.id} className={`pick ${on ? "on" : ""}`} whileTap={{ scale: 0.92 }}
                  onClick={() => setF({ ...f, assignees: on ? f.assignees.filter((x) => x !== p.id) : [...f.assignees, p.id] })}>
                  <Avatar p={p} size={40} />
                  <AnimatePresence>{on && <motion.i className="pick-check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check size={12} /></motion.i>}</AnimatePresence>
                  <small>{p.full_name.split(" ")[0]}</small>
                </motion.button>
              );
            })}
          </div>
        </Field>
        <div className="sheet-foot"><Btn type="submit" tone="primary" wide icon={<Check size={18} />}>{job ? "Save changes" : "Create job"}</Btn></div>
      </form>
    </Sheet>
  );
}
