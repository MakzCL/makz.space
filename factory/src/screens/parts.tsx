import { AnimatePresence, motion } from "motion/react";
import {
  Check, ChevronDown, ChevronRight, Coffee, LogOut, Megaphone, Pause, Pin, Play, Send, Sun, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarStack } from "../components/Avatar";
import { Dial } from "../components/Dial";
import { Scene } from "../components/Scene";
import { Badge, Btn, Chip, HoldButton, HoldCircle, RoundBtn, Section, Sheet, item, list } from "../components/ui";
import { useActions, useMine, usePresence, useStations } from "../lib/actions";
import { locale, t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { DAY_TARGET, ago, clock, hm, hms, hrMin, human, jobStats, longDate, shiftWorked } from "../lib/time";
import type { Invite, Job } from "../lib/types";

export const STATUS: Record<Job["status"], { label: string; tone: string }> = {
  open: { label: "Open", tone: "white" },
  in_progress: { label: "In progress", tone: "red" },
  paused: { label: "Paused", tone: "moon" },
  blocked: { label: "Blocked", tone: "alert" },
  done: { label: "Done", tone: "muted" },
};
export const statusLabel = (s: Job["status"]) => t(STATUS[s].label);
/** Orders in production show as MO-<order number>; finished ones as the plain Shopify number. */
export const jobCode = (j: Pick<Job, "code" | "order_id" | "route" | "status">) =>
  j.order_id && j.route?.length && j.status !== "done" ? `MO-${j.code.replace(/^#/, "").replace(/^SO-/, "")}` : j.code;
const PRI = ["", "Urgent", "High", "Normal", "Low", "Backlog"];
export const priorityLabel = (p: number) => `P${p} · ${t(PRI[p] ?? "")}`;

const hashSeed = (s: string) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);

export function ShiftCard() {
  const { db } = useStore();
  const now = useNow(1000);
  const { shift, brk } = useMine();
  const a = useActions();
  const d = new Date(now);

  if (!shift) {
    return (
      <motion.div className="card shift-off" variants={item} layout>
        <div className="shift-off-top">
          <div><small className="label">{t("Today")}</small><b className="date">{longDate(d)}</b></div>
          <span className="time-now">{d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div className="big-start">
          <i className="halo h1" /><i className="halo h2" />
          <motion.button type="button" onClick={() => a.clockIn()} whileTap={{ scale: 0.94 }}>
            <b>{t("Clock in")}</b><small>{t("Start your shift")}</small>
          </motion.button>
        </div>
      </motion.div>
    );
  }

  const worked = shiftWorked(shift, db.breaks, now);
  const brkTotal = db.breaks.filter((b) => b.shift_id === shift.id).reduce((x, b) => x + ((b.ended_at ? new Date(b.ended_at).getTime() : now) - new Date(b.started_at).getTime()), 0);
  const finish = new Date(new Date(shift.clock_in).getTime() + DAY_TARGET + Math.max(brkTotal, 30 * 60000));
  const w = hrMin(worked);
  return (
    <motion.div className={`card shift-on ${brk ? "on-break" : ""}`} variants={item} layout>
      <div className="row between">
        <div><small className="label">{t("Today's shift")}</small><b className="date">{longDate(d)}</b></div>
        <Badge tone={brk ? "moon" : "red"} dot>{brk ? t("On break") : t("Clocked in")}</Badge>
      </div>
      <div className="dial-wrap">
        <Dial from={new Date(shift.clock_in)} to={d} tone={brk ? "moon" : "red"} startIcon={<Sun size={13} />} endIcon={brk ? <Coffee size={13} /> : <i className="knob-dot" />}>
          <span className="dial-big">{w.h}<small>hr</small> {w.m}</span>
          <span className="dial-sub">{brk ? `${t("Break")} ${hms(now - new Date(brk.started_at).getTime())}` : worked > DAY_TARGET ? `+${hm(worked - DAY_TARGET)} ${t("overtime")}` : t("worked today")}</span>
        </Dial>
      </div>
      <div className="pair">
        <div className="mini sun"><i className="mini-art" /><small>{t("Started")}</small><b>{clock(shift.clock_in)}</b></div>
        <div className="mini moon"><i className="mini-art" /><small>{t("Finish around")}</small><b>{clock(finish.toISOString())}</b></div>
      </div>
      <div className="row gap">
        <Btn tone={brk ? "primary" : "soft"} icon={brk ? <Play size={18} /> : <Coffee size={18} />} onClick={a.toggleBreak} wide>{brk ? t("End break") : t("Break")}</Btn>
        <HoldButton icon={<LogOut size={18} />} onConfirm={a.clockOut}>{t("Hold to clock out")}</HoldButton>
      </div>
      {brkTotal > 0 && !brk && <p className="fine">{t("Breaks today")}: {human(brkTotal)}</p>}
    </motion.div>
  );
}

/** The job I am working on — laid out like a music player. */
export function LiveJobCard({ onOpen, onReport }: { onOpen: (j: Job) => void; onReport?: (j: Job) => void }) {
  const { db, person } = useStore();
  const now = useNow(1000);
  const { part, session, job } = useMine();
  const a = useActions();
  const { name: stationName } = useStations();
  const [inviting, setInviting] = useState(false);
  if (!part || !session || !job) return null;
  const crew = db.participants.filter((p) => p.session_id === session.id && !p.left_at);
  const st = jobStats(db, job.id, now);
  const pending = db.invites.filter((i) => i.session_id === session.id && i.status === "pending");
  const est = job.estimate_minutes ? job.estimate_minutes * 60000 : 0;
  const pct = est ? Math.min(1, st.wall / est) : 0;
  return (
    <motion.div className="card player" layout variants={item}>
      <div className="cover" onClick={() => onOpen(job)}>
        <Scene kind="line" height={170} seed={hashSeed(job.code)} />
        <div className="cover-title"><span className="code">{jobCode(job)}</span><b>{job.title}</b></div>
        <span className="live-chip"><i />{t("Live")}</span>
      </div>
      <div className="player-body">
        <div className="track"><motion.i animate={{ width: `${pct * 100}%` }} /></div>
        <div className="row between track-times"><span>{hm(st.wall)}</span><span>{est ? hm(est) : t("no estimate")}</span></div>
        <div className="player-ctrl">
          <RoundBtn label={t("Invite a helper")} onClick={() => setInviting(true)}><UserPlus size={20} /></RoundBtn>
          <RoundBtn label={crew.length > 1 ? t("Leave job") : t("Pause")} onClick={() => (crew.length > 1 ? a.leaveSession() : a.stopJob(job, "paused"))}><Pause size={20} /></RoundBtn>
          <HoldCircle label={t("Hold to complete")} icon={<Check size={34} strokeWidth={2.6} />} onConfirm={() => a.stopJob(job, "done")} />
          <RoundBtn label={t("Details")} onClick={() => onOpen(job)}><ChevronRight size={22} /></RoundBtn>
          <RoundBtn label={t("Report issue")} onClick={() => onReport?.(job)}><span className="excl">!</span></RoundBtn>
        </div>
        <p className="hint center">{job.route?.length && job.stage + 1 < job.route.length
          ? t("Hold the red button when {station} is done — it goes to {next}", { station: stationName(job.station_id), next: stationName(job.route[job.stage + 1]) })
          : t("Hold the red button to complete")}</p>
        <div className="timer-row">
          <div><small>{t("You")}</small><b>{hms(now - new Date(part.joined_at).getTime())}</b></div>
          <div><small>{t("Crew")}</small><b>{crew.length}</b></div>
          <div><small>{t("Person-hours")}</small><b>{hm(st.person)}</b></div>
        </div>
        <div className="crew-row">
          {crew.map((c) => (
            <motion.div key={c.id} className="crew" layout initial={{ scale: 0 }} animate={{ scale: 1 }}>
              <Avatar p={person(c.user_id)} size={38} status="working" />
              <small>{person(c.user_id)?.full_name.split(" ")[0]}</small>
            </motion.div>
          ))}
          {pending.map((i) => (
            <motion.div key={i.id} className="crew pending" layout initial={{ scale: 0 }} animate={{ scale: 1 }}>
              <Avatar p={person(i.to_user)} size={38} />
              <small>{t("invited")}</small>
              <button type="button" className="mini-x" onClick={() => a.cancelInvite(i)} aria-label={t("Cancel invite")}><X size={12} /></button>
            </motion.div>
          ))}
          <button type="button" className="crew add" onClick={() => setInviting(true)}><span><UserPlus size={18} /></span><small>{t("Invite")}</small></button>
        </div>
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
    .filter((p) => p.active && p.id !== me.id && !inSession.has(p.id) && p.full_name.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => rank(x.id) - rank(y.id) || Number(job?.assignees.includes(y.id)) - Number(job?.assignees.includes(x.id)));
  return (
    <Sheet open={open} onClose={() => { onClose(); setSel([]); }} title={t("Invite a helper")} tall>
      <p className="muted">{t("They get an invite on their phone. Once they join, everyone's time is counted, so the owner sees the real crew size and person-hours.")}</p>
      <input className="search" placeholder={t("Search staff…")} value={q} onChange={(e) => setQ(e.target.value)} />
      <motion.div className="stack" variants={list} initial="hidden" animate="show">
        {people.map((p) => {
          const pr = presence.get(p.id)!;
          const on = sel.includes(p.id);
          const busyJob = pr.jobId ? db.jobs.find((j) => j.id === pr.jobId) : null;
          return (
            <motion.button type="button" key={p.id} variants={item} className={`person-row select ${on ? "on" : ""}`} disabled={invited.has(p.id)}
              onClick={() => setSel(on ? sel.filter((x) => x !== p.id) : [...sel, p.id])}>
              <Avatar p={p} size={42} status={pr.state} />
              <span><b>{p.full_name}</b>
                <small>{invited.has(p.id) ? t("Invite pending") : pr.state === "working" ? t("On {code}", { code: busyJob?.code ?? "" }) : pr.state === "on" ? t("Free · on shift") : pr.state === "break" ? t("On break") : t("Off shift")}</small>
              </span>
              <i className="check">{on && <Check size={16} />}</i>
            </motion.button>
          );
        })}
      </motion.div>
      <div className="sheet-foot">
        <Btn tone="primary" wide disabled={!sel.length} icon={<Send size={18} />}
          onClick={async () => { await a.invite(db.profiles.filter((p) => sel.includes(p.id))); setSel([]); onClose(); }}>
          {sel.length ? t("Send {n} invite(s)", { n: sel.length }) : t("Pick someone")}
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
    <motion.div className="card invite" layout initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 80 }}>
      <div className="row gap">
        <Avatar p={from} size={48} />
        <div className="grow">
          <small className="label">{t("Team invite")} · {ago(inv.created_at)}</small>
          <b className="invite-title">{t("{name} needs a hand", { name: from?.full_name.split(" ")[0] ?? "" })}</b>
          <p className="muted">{job ? jobCode(job) : ""} · {job?.title}</p>
        </div>
      </div>
      <div className="row gap">
        <Btn tone="soft" wide onClick={() => a.respond(inv, false)}>{t("Not now")}</Btn>
        <Btn tone="primary" wide icon={<Users size={18} />} onClick={() => a.respond(inv, true)}>{t("Join job")}</Btn>
      </div>
    </motion.div>
  );
}

/** Little segments showing how far a routed job has travelled. */
export function RouteDots({ job }: { job: Job }) {
  if (!job.route?.length) return null;
  return (
    <span className="route-dots" aria-label={t("Stage {n} of {total}", { n: Math.min(job.stage + 1, job.route.length), total: job.route.length })}>
      {job.route.map((id, i) => <i key={id + i} className={job.status === "done" || i < job.stage ? "done" : i === job.stage ? "now" : ""} />)}
    </span>
  );
}

export function JobCard({ job, onOpen, rank, passed }: { job: Job; onOpen: (j: Job) => void; rank?: number; passed?: boolean }) {
  const { db, person } = useStore();
  const stations = useStations();
  const order = job.order_id ? db.orders.find((o) => o.id === job.order_id) : undefined;
  const now = useNow(30000);
  const st = jobStats(db, job.id, now);
  const liveCrew = st.live ? db.participants.filter((p) => p.session_id === st.live!.id && !p.left_at).map((p) => person(p.user_id)) : [];
  const pct = job.estimate_minutes ? Math.min(1, st.wall / (job.estimate_minutes * 60000)) : 0;
  const overdue = job.due_date && job.status !== "done" && new Date(job.due_date + "T23:59") < new Date();
  const isOrder = !!order;
  const names = job.assignees.map((u) => person(u)?.full_name.split(" ")[0]).filter(Boolean).join(", ");
  return (
    <motion.div className={`job-row s-${job.status} ${isOrder ? "order-job" : ""}`} variants={item} layout role="button" tabIndex={0}
      onClick={() => onOpen(job)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(job); }} whileTap={{ scale: 0.985 }}>
      <span className="job-badge">{rank ?? job.priority}</span>
      <span className="grow">
        <span className="row between"><span className="code">{jobCode(job)}{job.quantity && job.route?.length ? <span className="qty-tag"> ×{job.quantity}</span> : null}</span>{st.team && <span className="team-tag"><Users size={12} /> ×{st.maxCrew}</span>}</span>
        <b className="job-title">{job.title}</b>
        {isOrder ? (
          <span className="job-meta">
            {passed ? <span className="station-tag passed"><Check size={12} /> {job.status === "done" ? t("Finished") : t("Passed to {station}", { station: stations.name(job.station_id) })}</span>
              : <span className={`st st-${job.status}`}>{st.live && <i className="live-dot" />}{job.status === "done" ? statusLabel(job.status) : stations.name(job.station_id) || statusLabel(job.status)}</span>}
            {names && <span> · {names}</span>}
          </span>
        ) : (
          <>
            {job.station_id && job.status !== "done" && !passed && <span className="station-tag">{stations.name(job.station_id)}</span>}
            {passed && <span className="station-tag passed"><Check size={12} /> {job.status === "done" ? t("Finished") : t("Passed to {station}", { station: stations.name(job.station_id) })}</span>}
            <span className="job-meta">
              <span className={`st st-${job.status}`}>{st.live && <i className="live-dot" />}{statusLabel(job.status)}</span>
              {job.customer && <span> · {job.customer}</span>}
              {job.due_date && <span className={overdue ? "late" : ""}> · {t("due")} {new Date(job.due_date).toLocaleDateString(locale(), { day: "numeric", month: "short" })}</span>}
            </span>
          </>
        )}
        {job.route?.length ? <RouteDots job={job} /> : job.estimate_minutes ? <span className="thin"><motion.i initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} /></span> : null}
        {isOrder && <OrderDetails job={job} />}
      </span>
      <span className="job-side">
        {liveCrew.length ? <AvatarStack people={liveCrew} size={24} /> : <AvatarStack people={job.assignees.map(person)} size={22} max={3} />}
        <span className="go"><Play size={14} fill="currentColor" /></span>
      </span>
    </motion.div>
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
    <Section title={t("Noticeboard")}>
      {can.postNews(me.role) && (
        <div className="card composer">
          <textarea placeholder={t("Share an update with everyone…")} value={txt} onChange={(e) => setTxt(e.target.value)} rows={2} />
          <div className="row between">
            <Chip on={pin} onClick={() => setPin(!pin)}><Pin size={14} /> {t("Pin")}</Chip>
            <Btn small tone="primary" icon={<Megaphone size={16} />} disabled={!txt.trim()} onClick={async () => { await a.post(txt.trim(), pin); setTxt(""); setPin(false); }}>{t("Post")}</Btn>
          </div>
        </div>
      )}
      <motion.div className="stack" variants={list} initial="hidden" animate="show">
        <AnimatePresence initial={false}>
          {news.map((n) => (
            <motion.div key={n.id} className={`card news ${n.pinned ? "pinned" : ""}`} variants={item} layout exit={{ opacity: 0, height: 0 }}>
              <Avatar p={person(n.author_id)} size={36} />
              <div className="grow">
                <div className="row between"><b>{person(n.author_id)?.full_name ?? t("Office")}</b><small className="muted">{n.pinned && <Pin size={12} />} {ago(n.created_at)}</small></div>
                <p>{n.body}</p>
              </div>
              {can.postNews(me.role) && <button type="button" className="icon-btn subtle" onClick={() => a.unpost(n.id)} aria-label={t("Delete")}><Trash2 size={16} /></button>}
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
    <Section title={t("On the floor")} action={<span className="count-pill">{on.length}</span>}>
      <div className="hscroll">
        {on.length === 0 && <p className="muted">{t("Nobody has clocked in yet.")}</p>}
        {on.map((p) => {
          const pr = presence.get(p.id)!;
          return (
            <motion.button type="button" key={p.id} className="floor-person" onClick={() => onPerson?.(p.id)} whileTap={{ scale: 0.93 }}>
              <Avatar p={p} size={54} status={pr.state} />
              <small>{p.full_name.split(" ")[0]}</small>
              <em className={pr.state}>{pr.state === "working" ? db.jobs.find((j) => j.id === pr.jobId)?.code : pr.state === "break" ? t("break") : t("free")}</em>
            </motion.button>
          );
        })}
      </div>
    </Section>
  );
}


/** Fold-out extras on an order card: SKU, parts, destination, price. */
function OrderDetails({ job }: { job: Job }) {
  const { db, me } = useStore();
  const [open, setOpen] = useState(false);
  const order = db.orders.find((o) => o.id === job.order_id);
  const product = job.sku ? db.stock_items.find((s) => s.sku === job.sku) : undefined;
  const parts = product ? db.bom_lines.filter((b) => b.product_id === product.id).map((b) => ({ b, m: db.stock_items.find((s) => s.id === b.material_id) })) : [];
  const qty = job.quantity ?? 1;
  const money = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: order?.currency || "GBP" }).format(n);
  return (
    <span className="order-details" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="details-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("Details")} <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.span className="details-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <span className="dl">
              {job.sku && <><small>SKU</small><b>{job.sku}</b></>}
              <small>{t("Order")}</small><b>{order?.order_number}</b>
              <small>{t("Qty")}</small><b>{qty}</b>
              {can.admin(me.role) && job.unit_price != null && <><small>{t("Price")}</small><b>{money(job.unit_price)}{qty > 1 ? ` × ${qty} = ${money(job.unit_price * qty)}` : ""}</b></>}
              {order?.customer && <><small>{t("Customer")}</small><b>{order.customer}{order.company ? ` · ${order.company}` : ""}</b></>}
              {order?.ship_to && <><small>{t("Ship to")}</small><b>{order.ship_to}</b></>}
              {order?.shipping_method && <><small>{t("Delivery")}</small><b>{order.shipping_method}</b></>}
            </span>
            {parts.length > 0 && (
              <span className="parts">
                <small>{t("Parts")}</small>
                {parts.map(({ b, m }) => <span key={b.id}><span className="code">{m?.sku}</span> {m?.name} <b>× {Math.round(b.quantity * qty * 1000) / 1000} {m?.unit}</b></span>)}
              </span>
            )}
            {job.description && <span className="desc-sm">{job.description}</span>}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
