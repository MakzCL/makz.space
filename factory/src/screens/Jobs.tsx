import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, Check, Layers, Undo2, Mail, MapPin, Pause, Pencil, Phone, Play, Plus, RotateCcw, Search, Settings2, ShoppingBag, Trash2, Truck, UserPlus, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { SceneTabs } from "../components/Scene";
import { Badge, Btn, Chip, Empty, Field, HoldButton, RoundBtn, Sheet, list } from "../components/ui";
import { useActions, useMine, useStations } from "../lib/actions";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { clock, dayLabel, hm, human, jobStats, participantMs } from "../lib/time";
import type { Job } from "../lib/types";
import { InviteSheet, JobCard, statusMeta, jobCode, priorityLabel, statusLabel } from "./parts";
import { ProductionSheet } from "./Production";
import { MoProduction } from "../kimera/MoProduction";
import { moIngredients } from "../kimera/status";
import { ScanButton } from "../components/Scanner";
import { resolveCode } from "../lib/scan";

export function Jobs({ onOpenJob, onNew }: { onOpenJob: (j: Job) => void; onNew: () => void }) {
  const { db, me } = useStore();
  const lead = can.manageJobs(me.role);
  const [view, setView] = useState<"active" | "done">("active");
  const [scope, setScope] = useState<"mine" | "all">(lead ? "all" : "mine");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Job["status"] | "any">("any");
  const [station, setStation] = useState<string | "any">("any");
  const [setup, setSetup] = useState(false);
  const stations = useStations();
  // Jobs I finished my part of, which have since moved on to the next station.
  const passedOn = useMemo(() => new Set(db.job_steps.filter((s) => s.completed_by === me.id).map((s) => s.job_id)), [db.job_steps, me.id]);
  const isPassed = (j: Job) => view === "done" && j.status !== "done" && passedOn.has(j.id) && !j.assignees.includes(me.id);

  const jobs = useMemo(() => db.jobs
    .filter((j) => (view === "done" ? j.status === "done" || (scope === "mine" && passedOn.has(j.id) && !j.assignees.includes(me.id)) : j.status !== "done"))
    .filter((j) => scope === "all" || j.assignees.includes(me.id) || (view === "done" && passedOn.has(j.id)))
    .filter((j) => status === "any" || j.status === status)
    .filter((j) => station === "any" || j.station_id === station)
    .filter((j) => !q || `${j.code} ${jobCode(j)} ${j.title} ${j.customer} ${j.sku ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => view === "done"
      ? (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at)
      : a.priority - b.priority || (a.due_date ?? "9").localeCompare(b.due_date ?? "9") || a.created_at.localeCompare(b.created_at)),
  [db.jobs, view, scope, status, station, q, me.id, passedOn]);
  const atStation = (id: string) => db.jobs.filter((j) => j.station_id === id && j.status !== "done").length;

  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <SceneTabs kind="line" value={view} onChange={setView} title={lead ? t("All jobs") : t("My jobs")} sub={t("Sorted by manufacturing priority")}
        actions={lead ? <RoundBtn label={t("Production setup")} onClick={() => setSetup(true)}><Settings2 size={18} /></RoundBtn> : undefined}
        tabs={[{ value: "active", label: t("Active") }, { value: "done", label: t("Done") }]} />
      <div className="row gap">
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search order, product, customer…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <ScanButton label="" continuous={false} title={t("Scan an order label")} hint={t("Scan the label on the job card or traveller to open it.")}
          onCode={(code) => { const h = resolveCode(db, code); if (h.kind !== "job") return false; onOpenJob(h.job); return true; }} />
      </div>
      {lead && stations.list.length > 0 && view === "active" && (
        <div className="station-strip">
          <button type="button" className={station === "any" ? "on" : ""} onClick={() => setStation("any")}><b>{db.jobs.filter((j) => j.status !== "done").length}</b><small>{t("All stations")}</small></button>
          {stations.list.map((s) => (
            <button type="button" key={s.id} className={station === s.id ? "on" : ""} onClick={() => setStation(station === s.id ? "any" : s.id)}>
              <b>{atStation(s.id)}</b><small>{s.name}</small>
            </button>
          ))}
        </div>
      )}
      <div className="chips">
        {!lead && <Chip on={scope === "all"} onClick={() => setScope(scope === "all" ? "mine" : "all")}><Users size={14} /> {t("Whole floor")}</Chip>}
        {lead && <Chip on={scope === "mine"} onClick={() => setScope(scope === "mine" ? "all" : "mine")}>{t("Mine only")}</Chip>}
        {view === "active" && (["in_progress", "open", "paused", "blocked"] as const).map((s) => (
          <Chip key={s} on={status === s} onClick={() => setStatus(status === s ? "any" : s)}>{statusLabel(s)}</Chip>
        ))}
      </div>
      <motion.div className="stack" variants={list} initial="hidden" animate="show" key={view + scope + status}>
        {jobs.map((j, i) => <JobCard key={j.id} job={j} onOpen={onOpenJob} rank={view === "active" ? i + 1 : undefined} passed={isPassed(j)} />)}
        {!jobs.length && <Empty icon={<Layers size={26} />} title={view === "done" ? t("Nothing finished yet") : t("No jobs here")} hint={scope === "mine" ? t("No production jobs are assigned to you yet.") : t("Try clearing filters.")} />}
      </motion.div>
      {lead && (
        <motion.button type="button" className="fab" onClick={onNew} initial={{ scale: 0 }} animate={{ scale: 1 }} whileTap={{ scale: 0.9 }} aria-label={t("New job")}>
          <Plus size={26} />
        </motion.button>
      )}
      {lead && <ProductionSheet open={setup} onClose={() => setSetup(false)} />}
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
  const stations = useStations();
  const order = j?.order_id ? db.orders.find((o) => o.id === j.order_id) : undefined;
  const routed = !!j?.route?.length;
  const nextStation = j && routed && j.stage + 1 < j.route.length ? stations.name(j.route[j.stage + 1]) : null;
  const doneLabel = !routed ? t("Hold to complete") : nextStation ? t("Hold when done → {station}", { station: nextStation }) : t("Hold to finish the order line");

  return (
    <Sheet open={!!job} onClose={onClose} tall title={j && <span className="row gap-s"><span className="code">{jobCode(j)}</span><Badge tone={statusMeta(j.status).tone} dot>{statusLabel(j.status)}</Badge></span>}>
      {j && st && (() => {
        const imIn = mine.part?.job_id === j.id;
        const crew = st.live ? db.participants.filter((p) => p.session_id === st.live!.id && !p.left_at) : [];
        const canWork = j.assignees.includes(me.id) || lead || !!st.live;
        return (
          <div className="stack">
            <h2 className="job-h">{j.title}</h2>
            <div className="row gap-s wrap">
              <Badge tone={j.priority <= 2 ? "red" : "muted"}>{priorityLabel(j.priority)}</Badge>
              {j.customer && <Badge>{j.customer}</Badge>}
              {j.quantity ? <Badge>{t("Qty")} {j.quantity}</Badge> : null}
              {j.due_date && <Badge>{t("Due")} {dayLabel(j.due_date)}</Badge>}
              {st.team && <Badge tone="blue"><Users size={12} /> {t("Team job · up to {n}", { n: st.maxCrew })}</Badge>}
            </div>
            {order && (
              <div className="card flat order-card">
                <div className="row between"><small className="label"><ShoppingBag size={13} /> {t("Shopify order")} {order.order_number}</small>
                  {order.ordered_at && <small className="muted">{dayLabel(order.ordered_at)} · {clock(order.ordered_at)}</small>}</div>
                <div className="order-grid">
                  <div><small>{t("Product")}</small><b>{j.title}</b>{j.sku && <span className="code">{j.sku}</span>}</div>
                  <div className="qty-big"><small>{t("Qty")}</small><b>{j.quantity ?? 1}</b></div>
                </div>
                <div className="order-lines">
                  <span><Users size={15} /><span><b>{order.customer}</b>{order.company && <> · {order.company}</>}</span></span>
                  {order.ship_to && <span><MapPin size={15} /><span>{order.ship_to}</span></span>}
                  {order.shipping_method && <span><Truck size={15} /><span>{order.shipping_method}</span></span>}
                  {lead && order.email && <span><Mail size={15} /><a href={`mailto:${order.email}`}>{order.email}</a></span>}
                  {lead && order.phone && <span><Phone size={15} /><a href={`tel:${order.phone}`}>{order.phone}</a></span>}
                </div>
              </div>
            )}
            {routed && (
              <div className="card flat">
                <small className="label">{t("Route")}</small>
                <div className="route">
                  {j.route.map((sid, i) => {
                    const step = db.job_steps.filter((s) => s.job_id === j.id && s.stage === i).sort((x, y) => y.completed_at.localeCompare(x.completed_at))[0];
                    const state = j.status === "done" || i < j.stage ? "done" : i === j.stage ? "now" : "next";
                    const crew = stations.crew(sid).map(person).filter(Boolean);
                    return (
                      <div key={sid + i} className={`route-step ${state}`}>
                        <i>{state === "done" ? <Check size={13} strokeWidth={3} /> : i + 1}</i>
                        <div className="grow">
                          <b>{stations.name(sid) || t("Removed station")}</b>
                          {state === "done" && step ? <small>{person(step.completed_by)?.full_name.split(" ")[0] ?? "—"} · {dayLabel(step.completed_at)} {clock(step.completed_at)}</small>
                            : <small>{crew.length ? crew.map((p) => p!.full_name.split(" ")[0]).join(", ") : t("Nobody at this station yet")}</small>}
                        </div>
                        {state === "now" && <Badge tone="red" dot>{t("Here now")}</Badge>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {j.description && <p className="desc">{j.description}</p>}

            <div className="tri">
              <div><small>{t("Job time")}</small><b>{hm(st.wall)}</b><em>{t("clock on the job")}</em></div>
              <div className="hl"><small>{t("Person-hours")}</small><b>{hm(st.person)}</b><em>{t("everyone combined")}</em></div>
              <div><small>{t("Estimate")}</small><b>{j.estimate_minutes ? hm(j.estimate_minutes * 60000) : "—"}</b><em>{j.estimate_minutes ? t("{n}% used", { n: Math.round((st.wall / (j.estimate_minutes * 60000)) * 100) }) : t("not set")}</em></div>
            </div>

            {j.status !== "done" && (
              <div className="stack">
                {imIn ? (
                  <>
                    <Btn tone="soft" wide icon={<UserPlus size={18} />} onClick={() => setInviting(true)}>{t("Invite a helper")}</Btn>
                    <div className="row gap">
                      <Btn tone="soft" wide icon={<Pause size={18} />} onClick={() => crew.length > 1 ? a.leaveSession() : a.stopJob(j, "paused")}>{crew.length > 1 ? t("Leave job") : t("Pause")}</Btn>
                      <HoldButton tone="primary" icon={<Check size={18} />} onConfirm={async () => { await a.stopJob(j, "done"); onClose(); }}>{doneLabel}</HoldButton>
                    </div>
                  </>
                ) : canWork && j.status !== "blocked" ? (
                  <Btn tone="primary" wide icon={st.live ? <Users size={18} /> : <Play size={18} />} onClick={() => a.startJob(j)}>
                    {st.live ? t("Join the crew ({n} working)", { n: crew.length }) : mine.part ? t("Switch to this job") : mine.shift ? t("Start job") : t("Clock in & start job")}
                  </Btn>
                ) : j.status === "blocked" ? (
                  <p className="muted center">{t("This job is blocked by an issue.")}</p>
                ) : <p className="muted center">{t("Not assigned to you. Ask a teammate to invite you.")}</p>}
                <div className="row gap">
                  <Btn tone="ghost" wide icon={<AlertTriangle size={18} />} onClick={() => onReport(j)}>{t("Report issue")}</Btn>
                  {lead && j.status === "blocked" && <Btn tone="ghost" wide icon={<RotateCcw size={18} />} onClick={() => a.reopenJob(j)}>{t("Unblock")}</Btn>}
                </div>
              </div>
            )}
            {lead && routed && (j.status === "done" || j.stage > 0) && (
              <HoldButton tone="ghost" icon={<Undo2 size={18} />} onConfirm={() => a.sendBack(j)}>
                {t("Hold to send back to {station}", { station: stations.name(j.route[j.status === "done" ? j.route.length - 1 : j.stage - 1]) })}
              </HoldButton>
            )}
            {j.status === "done" && lead && !routed && <Btn tone="ghost" wide icon={<RotateCcw size={18} />} onClick={() => a.reopenJob(j)}>{t("Reopen job")}</Btn>}

            {st.perPerson.size > 0 && (
              <div className="card flat">
                <small className="label">{t("Who put time in")}</small>
                {[...st.perPerson.entries()].sort((x, y) => y[1] - x[1]).map(([uid, ms]) => (
                  <div key={uid} className="contrib">
                    <Avatar p={person(uid)} size={30} status={crew.some((c) => c.user_id === uid) ? "working" : undefined} />
                    <span className="grow">{person(uid)?.full_name}</span>
                    <b>{hm(ms)}</b>
                    <div className="thin"><motion.i initial={{ width: 0 }} animate={{ width: `${(ms / Math.max(1, st.person)) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}

            {st.sessions.length > 0 && (
              <div className="card flat">
                <small className="label">{t("Timeline")}</small>
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
                          <div className="row between"><b>{dayLabel(s.started_at)} · {clock(s.started_at)}–{s.ended_at ? clock(s.ended_at) : t("now")}</b><span>{human(wall)}</span></div>
                          <div className="row gap-s wrap">
                            {people.map((u) => <span key={u} className="who"><Avatar p={person(u)} size={18} />{person(u)?.full_name.split(" ")[0]}</span>)}
                          </div>
                          {people.length > 1 && <small className="blue-t">{t("{n} people · {time} person-time", { n: people.length, time: human(pers) })}</small>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {j.sku && (j.assignees.includes(me.id) || lead || can.editStock(me.role)) && moIngredients(db, j).length > 0 && <MoProduction job={j} compact />}

            <div className="card flat">
              <small className="label">{t("Assigned")}</small>
              <div className="row gap-s wrap">
                {j.assignees.map((u) => <span key={u} className="who big"><Avatar p={person(u)} size={26} />{person(u)?.full_name}</span>)}
                {!j.assignees.length && <span className="muted">{t("Nobody yet")}</span>}
              </div>
            </div>

            {lead && (
              <div className="row gap">
                <Btn tone="ghost" wide icon={<Pencil size={16} />} onClick={() => onEdit(j)}>{t("Edit")}</Btn>
                <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={async () => { await a.deleteJob(j); onClose(); }}>{t("Hold to delete")}</HoldButton>
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
  const stations = useStations();
  const blank = { title: "", description: "", customer: "", priority: 3, estimate_minutes: null as number | null, quantity: null as number | null, due_date: null as string | null, assignees: [] as string[], route: [] as string[] };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(job ? { title: job.title, description: job.description, customer: job.customer, priority: job.priority, estimate_minutes: job.estimate_minutes, quantity: job.quantity, due_date: job.due_date, assignees: job.assignees, route: job.route ?? [] } : { ...blank, route: stations.list.filter((s) => s.in_default).map((s) => s.id) });
  }, [open, job]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = db.profiles.filter((p) => p.active);
  const staff = active.filter((p) => p.role === "operator" || p.role === "assistant" || f.assignees.includes(p.id));
  const others = active.filter((p) => !staff.includes(p));
  return (
    <Sheet open={open} onClose={onClose} tall title={job ? t("Edit {code}", { code: job.code }) : t("New job")}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); await a.saveJob({ ...f, id: job?.id }); onClose(); }}>
        <Field label={t("Title")}><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("e.g. Control board rev D — SMT")} /></Field>
        <Field label={t("Customer")}><input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} placeholder={t("Optional")} /></Field>
        <Field label={t("Instructions")}><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t("Drawing refs, checks, torque values…")} /></Field>
        <Field label={t("Priority")}>
          <div className="chips">{[1, 2, 3, 4, 5].map((p) => <Chip key={p} on={f.priority === p} onClick={() => setF({ ...f, priority: p })}>{priorityLabel(p)}</Chip>)}</div>
        </Field>
        <div className="row gap">
          <Field label={t("Estimate (hours)")}><input type="number" min={0} step={0.25} inputMode="decimal" value={f.estimate_minutes ? f.estimate_minutes / 60 : ""} onChange={(e) => setF({ ...f, estimate_minutes: e.target.value ? Math.round(Number(e.target.value) * 60) : null })} /></Field>
          <Field label={t("Quantity")}><input type="number" min={0} inputMode="numeric" value={f.quantity ?? ""} onChange={(e) => setF({ ...f, quantity: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
        <Field label={t("Due date")}><input type="date" value={f.due_date ?? ""} onChange={(e) => setF({ ...f, due_date: e.target.value || null })} /></Field>
        {stations.list.length > 0 && (
          <Field label={t("Route — stations in order")} hint={job?.route?.length && f.route.join() !== job.route.join() ? t("Changing the route sends the job back to its first station.") : t("Tap stations in the order the job visits them. None = a one-off job.")}>
            <RoutePicker value={f.route} onChange={(route) => setF({ ...f, route })} />
          </Field>
        )}
        <Field label={t("Assign to")}>
          <div className="pick-grid">
            {[...staff, ...others].map((p) => {
              const on = f.assignees.includes(p.id);
              return (
                <motion.button type="button" key={p.id} className={`pick ${on ? "on" : ""}`} whileTap={{ scale: 0.92 }}
                  onClick={() => setF({ ...f, assignees: on ? f.assignees.filter((x) => x !== p.id) : [...f.assignees, p.id] })}>
                  <Avatar p={p} size={42} />
                  <AnimatePresence>{on && <motion.i className="pick-check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check size={12} /></motion.i>}</AnimatePresence>
                  <small>{p.full_name.split(" ")[0]}</small>
                </motion.button>
              );
            })}
          </div>
        </Field>
        <div className="sheet-foot"><Btn type="submit" tone="primary" wide icon={<Check size={18} />}>{job ? t("Save changes") : t("Create job")}</Btn></div>
      </form>
    </Sheet>
  );
}

/** Pick stations in visiting order: tap to add to the end, tap again to remove. */
export function RoutePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const stations = useStations();
  return (
    <div className="stack">
      <div className="route-pick">
        {value.map((id, i) => (
          <span key={id} className="route-chip"><i>{i + 1}</i>{stations.name(id)}<button type="button" aria-label={t("Remove")} onClick={() => onChange(value.filter((x) => x !== id))}><X size={13} /></button></span>
        ))}
        {!value.length && <span className="muted">{t("No stations")}</span>}
      </div>
      <div className="chips">
        {stations.list.filter((s) => !value.includes(s.id)).map((s) => <Chip key={s.id} onClick={() => onChange([...value, s.id])}><Plus size={13} />{s.name}</Chip>)}
      </div>
    </div>
  );
}
