import { AnimatePresence, motion } from "motion/react";
import {
  Check, Coffee, LogIn, LogOut, Megaphone, Pause, Pin, Play, Send, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarStack } from "../components/Avatar";
import { Badge, Btn, Chip, HoldButton, Ring, Section, Sheet, item, list } from "../components/ui";
import { useActions, useMine, usePresence } from "../lib/actions";
import { can } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { DAY_TARGET, ago, clock, hm, hms, human, jobStats, longDate, shiftWorked } from "../lib/time";
import type { Invite, Job } from "../lib/types";

export const STATUS: Record<Job["status"], { label: string; tone: string }> = {
  open: { label: "Open", tone: "blue" },
  in_progress: { label: "In progress", tone: "green" },
  paused: { label: "Paused", tone: "amber" },
  blocked: { label: "Blocked", tone: "red" },
  done: { label: "Done", tone: "muted" },
};
export const PRIORITY = ["", "P1 · Urgent", "P2 · High", "P3 · Normal", "P4 · Low", "P5 · Backlog"];

export function ShiftCard() {
  const { db } = useStore();
  const now = useNow(1000);
  const { shift, brk } = useMine();
  const a = useActions();
  const worked = shift ? shiftWorked(shift, db.breaks, now) : 0;
  const state = !shift ? "off" : brk ? "break" : "on";
  const brkTotal = shift ? db.breaks.filter((b) => b.shift_id === shift.id).reduce((x, b) => x + ((b.ended_at ? new Date(b.ended_at).getTime() : now) - new Date(b.started_at).getTime()), 0) : 0;

  return (
    <motion.div className={`card shift ${state}`} layout variants={item}>
      <div className="shift-glow" />
      <div className="row between">
        <div>
          <small className="eyebrow">Today's shift</small>
          <div className="shift-date">{longDate(new Date(now))}</div>
        </div>
        <motion.span key={state} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className={`badge ${state === "on" ? "green" : state === "break" ? "amber" : "muted"} live`}>
          {state !== "off" && <i className="pulse" />}{state === "on" ? "Clocked in" : state === "break" ? "On break" : "Not clocked in"}
        </motion.span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {!shift ? (
          <motion.div key="off" className="shift-off" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="big-clock">{new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}<span>{String(new Date(now).getSeconds()).padStart(2, "0")}</span></div>
            <motion.button className="clock-in" onClick={() => a.clockIn()} whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }}>
              <i className="clock-in-ripple" /><LogIn size={22} /> Clock in
            </motion.button>
          </motion.div>
        ) : (
          <motion.div key="on" className="shift-on" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Ring value={worked / DAY_TARGET} size={128} stroke={11} color={brk ? "var(--amber)" : worked > DAY_TARGET ? "var(--violet)" : "var(--green)"}>
              <b className="mono">{hm(worked)}</b><small>{worked > DAY_TARGET ? `+${hm(worked - DAY_TARGET)} OT` : `of 08:00`}</small>
            </Ring>
            <div className="shift-facts">
              <div><small>Started</small><b className="mono">{clock(shift.clock_in)}</b></div>
              <div><small>{brk ? "Break" : "Breaks"}</small><b className="mono">{brk ? hms(now - new Date(brk.started_at).getTime()) : human(brkTotal)}</b></div>
              <div><small>Finish ~</small><b className="mono">{clock(new Date(new Date(shift.clock_in).getTime() + DAY_TARGET + Math.max(brkTotal, 30 * 60000)).toISOString())}</b></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {shift && (
        <div className="row gap">
          <Btn tone={brk ? "primary" : "soft"} icon={brk ? <Play size={18} /> : <Coffee size={18} />} onClick={a.toggleBreak} wide>{brk ? "End break" : "Break"}</Btn>
          <HoldButton icon={<LogOut size={18} />} onConfirm={a.clockOut}>Hold to clock out</HoldButton>
        </div>
      )}
    </motion.div>
  );
}

/** The job I am working on right now — big live timer, crew, invite. */
export function LiveJobCard({ onOpen }: { onOpen: (j: Job) => void }) {
  const { db, person } = useStore();
  const now = useNow(1000);
  const { part, session, job } = useMine();
  const a = useActions();
  const [inviting, setInviting] = useState(false);
  if (!part || !session || !job) return null;
  const crew = db.participants.filter((p) => p.session_id === session.id && !p.left_at);
  const st = jobStats(db, job.id, now);
  const pending = db.invites.filter((i) => i.session_id === session.id && i.status === "pending");
  return (
    <motion.div className="card live-job" layout variants={item} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="live-sheen" />
      <div className="row between">
        <small className="eyebrow"><i className="pulse red" /> Working now</small>
        <button className="link" onClick={() => onOpen(job)}>Details</button>
      </div>
      <h3 className="live-title"><span className="code">{job.code}</span> {job.title}</h3>
      <div className="live-timer mono">{hms(now - new Date(part.joined_at).getTime())}</div>
      <div className="live-stats">
        <div><small>Crew now</small><b>{crew.length} {crew.length > 1 ? "people" : "person"}</b></div>
        <div><small>Job time</small><b className="mono">{hm(st.wall)}</b></div>
        <div><small>Person-hours</small><b className="mono">{hm(st.person)}</b></div>
      </div>
      <div className="crew-row">
        {crew.map((c) => (
          <motion.div key={c.id} className="crew" layout initial={{ scale: 0 }} animate={{ scale: 1 }}>
            <Avatar p={person(c.user_id)} size={36} status="working" />
            <small>{person(c.user_id)?.full_name.split(" ")[0]}</small>
          </motion.div>
        ))}
        {pending.map((i) => (
          <motion.div key={i.id} className="crew pending" layout initial={{ scale: 0 }} animate={{ scale: 1 }}>
            <Avatar p={person(i.to_user)} size={36} />
            <small>invited…</small>
            <button className="mini-x" onClick={() => a.cancelInvite(i)} aria-label="Cancel invite"><X size={12} /></button>
          </motion.div>
        ))}
        <motion.button className="crew add" onClick={() => setInviting(true)} whileTap={{ scale: 0.9 }}>
          <span><UserPlus size={18} /></span><small>Invite</small>
        </motion.button>
      </div>
      <div className="row gap wrap">
        <Btn small tone="soft" icon={<Pause size={16} />} onClick={() => crew.length > 1 ? a.leaveSession() : a.stopJob(job, "paused")}>{crew.length > 1 ? "Leave" : "Pause"}</Btn>
        <HoldButton tone="primary" icon={<Check size={18} />} onConfirm={() => a.stopJob(job, "done")}>Hold to complete</HoldButton>
      </div>
      <InviteSheet open={inviting} onClose={() => setInviting(false)} jobId={job.id} sessionId={session.id} />
    </motion.div>
  );
}

export function InviteSheet({ open, onClose, jobId, sessionId }: { open: boolean; onClose: () => void; jobId: string; sessionId: string }) {
  const { db, me } = useStore();
  const presence = usePresence();
  const a = useActions();
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const inSession = new Set(db.participants.filter((p) => p.session_id === sessionId && !p.left_at).map((p) => p.user_id));
  const invited = new Set(db.invites.filter((i) => i.session_id === sessionId && i.status === "pending").map((i) => i.to_user));
  const job = db.jobs.find((j) => j.id === jobId);
  const rank = (id: string) => { const s = presence.get(id)?.state; return s === "on" ? 0 : s === "break" ? 1 : s === "working" ? 2 : 3; };
  const people = db.profiles
    .filter((p) => p.id !== me.id && !inSession.has(p.id) && p.full_name.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => rank(x.id) - rank(y.id) || Number(job?.assignees.includes(y.id)) - Number(job?.assignees.includes(x.id)));
  return (
    <Sheet open={open} onClose={() => { onClose(); setSel([]); }} title="Invite a helper" tall>
      <p className="muted">They get a live invite. Once they accept, the job timer counts every person — the boss sees the real crew size and person-hours.</p>
      <input className="search" placeholder="Search staff…" value={q} onChange={(e) => setQ(e.target.value)} />
      <motion.div className="stack" variants={list} initial="hidden" animate="show">
        {people.map((p) => {
          const pr = presence.get(p.id)!;
          const on = sel.includes(p.id);
          const busyJob = pr.jobId ? db.jobs.find((j) => j.id === pr.jobId) : null;
          return (
            <motion.button key={p.id} variants={item} className={`person-row select ${on ? "on" : ""}`} disabled={invited.has(p.id)}
              onClick={() => setSel(on ? sel.filter((x) => x !== p.id) : [...sel, p.id])}>
              <Avatar p={p} size={40} status={pr.state} />
              <span><b>{p.full_name}</b>
                <small>{invited.has(p.id) ? "Invite pending" : pr.state === "working" ? `On ${busyJob?.code ?? "a job"}` : pr.state === "on" ? "Available · on shift" : pr.state === "break" ? "On break" : "Off shift"}</small>
              </span>
              <i className="check">{on && <Check size={16} />}</i>
            </motion.button>
          );
        })}
      </motion.div>
      <div className="sheet-foot">
        <Btn tone="primary" wide disabled={!sel.length} icon={<Send size={18} />}
          onClick={async () => { await a.invite(db.profiles.filter((p) => sel.includes(p.id))); setSel([]); onClose(); }}>
          {sel.length ? `Send ${sel.length} invite${sel.length > 1 ? "s" : ""}` : "Pick someone"}
        </Btn>
      </div>
    </Sheet>
  );
}

export function InviteCard({ inv }: { inv: Invite }) {
  const { db, person } = useStore();
  const a = useActions();
  const job = db.jobs.find((j) => j.id === inv.job_id);
  const from = person(inv.from_user);
  return (
    <motion.div className="card invite" layout initial={{ opacity: 0, y: -16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 80 }}>
      <div className="invite-pulse" />
      <div className="row gap">
        <Avatar p={from} size={44} ring />
        <div className="grow">
          <small className="eyebrow">Team invite · {ago(inv.created_at)}</small>
          <b>{from?.full_name.split(" ")[0]} needs a hand</b>
          <p className="muted">{job?.code} · {job?.title}</p>
        </div>
      </div>
      <div className="row gap">
        <Btn tone="soft" wide onClick={() => a.respond(inv, false)}>Not now</Btn>
        <Btn tone="primary" wide icon={<Users size={18} />} onClick={() => a.respond(inv, true)}>Join job</Btn>
      </div>
    </motion.div>
  );
}

export function JobCard({ job, onOpen, rank }: { job: Job; onOpen: (j: Job) => void; rank?: number }) {
  const { db, person } = useStore();
  const now = useNow(30000);
  const st = jobStats(db, job.id, now);
  const liveCrew = st.live ? db.participants.filter((p) => p.session_id === st.live!.id && !p.left_at).map((p) => person(p.user_id)) : [];
  const pct = job.estimate_minutes ? Math.min(1, st.wall / (job.estimate_minutes * 60000)) : 0;
  const overdue = job.due_date && job.status !== "done" && new Date(job.due_date + "T23:59") < new Date();
  return (
    <motion.button className={`job-card s-${job.status}`} variants={item} layout onClick={() => onOpen(job)} whileTap={{ scale: 0.985 }}>
      {rank !== undefined && <span className="job-rank">{rank}</span>}
      <div className="grow">
        <div className="row between">
          <span className="code">{job.code}</span>
          <span className="row gap-s">
            {st.team && <Badge tone="violet"><Users size={12} /> Team ×{st.maxCrew}</Badge>}
            <Badge tone={STATUS[job.status].tone}>{st.live && <i className="pulse" />}{STATUS[job.status].label}</Badge>
          </span>
        </div>
        <b className="job-title">{job.title}</b>
        <div className="row between job-meta">
          <span className="muted">{job.customer && `${job.customer} · `}{PRIORITY[job.priority]?.split(" · ")[0]}{job.due_date && <> · <span className={overdue ? "red-t" : ""}>due {new Date(job.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></>}</span>
          {liveCrew.length ? <AvatarStack people={liveCrew} size={24} /> : <AvatarStack people={job.assignees.map(person)} size={22} max={3} />}
        </div>
        {job.estimate_minutes ? <div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ duration: 0.9 }} className={pct >= 1 ? "over" : ""} /></div> : null}
      </div>
    </motion.button>
  );
}

export function NewsFeed() {
  const { db, me, person } = useStore();
  const a = useActions();
  const [txt, setTxt] = useState("");
  const [pin, setPin] = useState(false);
  const news = [...db.announcements].sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.created_at.localeCompare(x.created_at)).slice(0, 6);
  if (!news.length && !can.postNews(me.role)) return null;
  return (
    <Section title="Noticeboard" sub="From the office and management">
      {can.postNews(me.role) && (
        <div className="card composer">
          <textarea placeholder="Share an update with everyone…" value={txt} onChange={(e) => setTxt(e.target.value)} rows={2} />
          <div className="row between">
            <Chip on={pin} onClick={() => setPin(!pin)}><Pin size={14} /> Pin</Chip>
            <Btn small tone="primary" icon={<Megaphone size={16} />} disabled={!txt.trim()} onClick={async () => { await a.post(txt.trim(), pin); setTxt(""); setPin(false); }}>Post</Btn>
          </div>
        </div>
      )}
      <motion.div className="stack" variants={list} initial="hidden" animate="show">
        <AnimatePresence initial={false}>
          {news.map((n) => (
            <motion.div key={n.id} className={`card news ${n.pinned ? "pinned" : ""}`} variants={item} layout exit={{ opacity: 0, height: 0 }}>
              <Avatar p={person(n.author_id)} size={34} />
              <div className="grow">
                <div className="row between"><b>{person(n.author_id)?.full_name ?? "Office"}</b><small className="muted">{n.pinned && <Pin size={12} />} {ago(n.created_at)}</small></div>
                <p>{n.body}</p>
              </div>
              {can.postNews(me.role) && <button className="icon-btn subtle" onClick={() => a.unpost(n.id)} aria-label="Delete"><Trash2 size={16} /></button>}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </Section>
  );
}

export function OnShiftRow({ onPerson }: { onPerson?: (id: string) => void }) {
  const { db } = useStore();
  const presence = usePresence();
  const on = db.profiles.filter((p) => presence.get(p.id)!.state !== "off");
  return (
    <Section title="On the floor" sub={`${on.length} clocked in now`}>
      <div className="hscroll">
        {on.length === 0 && <p className="muted">Nobody yet — first one in gets the good coffee ☕</p>}
        {on.map((p) => {
          const pr = presence.get(p.id)!;
          return (
            <motion.button key={p.id} className="floor-person" onClick={() => onPerson?.(p.id)} whileTap={{ scale: 0.93 }} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
              <Avatar p={p} size={50} status={pr.state} ring />
              <small>{p.full_name.split(" ")[0]}</small>
              <em className={pr.state}>{pr.state === "working" ? db.jobs.find((j) => j.id === pr.jobId)?.code : pr.state === "break" ? "break" : "free"}</em>
            </motion.button>
          );
        })}
      </div>
    </Section>
  );
}
