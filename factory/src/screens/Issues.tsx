import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Cpu, Eye, HardHat, Package, Send, Wrench, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Chip, Empty, Field, Section, Segmented, Sheet, Toggle, item, list } from "../components/ui";
import { useActions, useMine } from "../lib/actions";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { jobCode } from "./parts";
import { t } from "../lib/i18n";
import { Scene } from "../components/Scene";
import { ago } from "../lib/time";
import type { Issue, Job, Severity } from "../lib/types";
import { TICKET_STATUS, TicketSheet, ticketNo } from "../kimera/Tickets";

const CATS: { v: string; label: string; icon: ReactNode }[] = [
  { v: "machine", label: "Machine", icon: <Cpu size={14} /> },
  { v: "material", label: "Material", icon: <Package size={14} /> },
  { v: "quality", label: "Quality", icon: <Eye size={14} /> },
  { v: "safety", label: "Safety", icon: <HardHat size={14} /> },
  { v: "tooling", label: "Tooling", icon: <Wrench size={14} /> },
  { v: "other", label: "Other", icon: <Zap size={14} /> },
];
const SEV: { v: Severity; label: string; tone: string }[] = [
  { v: "low", label: "Low", tone: "muted" }, { v: "medium", label: "Medium", tone: "moon" },
  { v: "high", label: "High", tone: "red" }, { v: "critical", label: "Critical", tone: "alert" },
];
export const sevTone = (s: Severity) => SEV.find((x) => x.v === s)!.tone;

export function Issues({ preset, onPresetUsed }: { preset?: Job | null; onPresetUsed?: () => void }) {
  const { db, me, person } = useStore();
  const a = useActions();
  const [view, setView] = useState<"open" | "resolved">("open");
  const [reporting, setReporting] = useState(false);
  const [openT, setOpenT] = useState<Issue | null>(null);
  useEffect(() => { if (preset) setReporting(true); }, [preset]);
  const issues = db.issues
    .filter((i) => (view === "open" ? i.status !== "resolved" : i.status === "resolved"))
    .sort((x, y) => SEV.findIndex((s) => s.v === y.severity) - SEV.findIndex((s) => s.v === x.severity) || y.created_at.localeCompare(x.created_at));
  const triage = can.admin(me.role);
  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <motion.div className="hero" variants={item}>
        <Scene kind="lighthouse" height={200}>
          <div className="scene-title"><h1>{t("Production issue")}</h1><p>{t("Machine down, missing parts, quality or safety — flag it in seconds.")}</p></div>
        </Scene>
        <div className="hero-cta"><Btn tone="primary" wide icon={<AlertTriangle size={18} />} onClick={() => setReporting(true)}>{t("Report a problem")}</Btn></div>
      </motion.div>
      <Section title={t("Issue log")} action={<Segmented size="s" value={view} onChange={setView} options={[{ value: "open", label: t("Open") }, { value: "resolved", label: t("Resolved") }]} />}>
        <motion.div className="stack" variants={list} initial="hidden" animate="show" key={view}>
          <AnimatePresence initial={false}>
            {issues.map((i) => {
              const job = db.jobs.find((j) => j.id === i.job_id);
              return (
                <motion.div key={i.id} className={`card issue sev-${i.severity} tappable`} variants={item} layout exit={{ opacity: 0, x: 60 }} onClick={() => setOpenT(i)} role="button" tabIndex={0}>
                  <div className="row between">
                    <span className="row gap-s"><span className="code">{ticketNo(i)}</span><Badge tone={sevTone(i.severity)}>{t(SEV.find((x) => x.v === i.severity)!.label)}</Badge><Badge>{t(CATS.find((c) => c.v === i.category)?.label ?? i.category)}</Badge>{job && <span className="code">{jobCode(job)}</span>}</span>
                    <small className="muted">{ago(i.created_at)}</small>
                  </div>
                  <b>{i.title}</b>
                  {i.description && <p className="muted">{i.description}</p>}
                  <div className="row between">
                    <span className="who"><Avatar p={person(i.reported_by)} size={20} />{person(i.reported_by)?.full_name}</span>
                    {i.status === "acknowledged" && <Badge tone="blue">{i.assignee_id ? `${t(TICKET_STATUS.acknowledged.label)} · ${person(i.assignee_id)?.full_name.split(" ")[0] ?? ""}` : t(TICKET_STATUS.acknowledged.label)}</Badge>}
                    {(() => { const n = db.issue_comments.filter((c) => c.issue_id === i.id && c.kind === "comment").length; return n ? <small className="muted">{t("{n} replies", { n })}</small> : null; })()}
                    {i.status === "resolved" && <Badge tone="ok">{t("Resolved by {name}", { name: person(i.resolved_by)?.full_name.split(" ")[0] ?? "" })}</Badge>}
                  </div>
                  {(triage || i.reported_by === me.id) && i.status !== "resolved" && (
                    <div className="row gap" onClick={(e) => e.stopPropagation()}>
                      {triage && i.status === "open" && <Btn small tone="soft" icon={<Eye size={15} />} onClick={() => a.setIssue(i as Issue, "acknowledged")}>{t("On it")}</Btn>}
                      <Btn small tone="ok" icon={<CheckCircle2 size={15} />} onClick={() => a.setIssue(i as Issue, "resolved")}>{t("Resolve")}</Btn>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {!issues.length && <Empty icon={<CheckCircle2 size={28} />} title={view === "open" ? t("No open issues") : t("Nothing resolved yet")} hint={view === "open" ? t("Smooth running. Long may it last.") : undefined} />}
        </motion.div>
      </Section>
      <TicketSheet issue={openT} onClose={() => setOpenT(null)} />
      <ReportSheet open={reporting} preset={preset ?? null} onClose={() => { setReporting(false); onPresetUsed?.(); }} />
    </motion.div>
  );
}

export function ReportSheet({ open, preset, onClose }: { open: boolean; preset: Job | null; onClose: () => void }) {
  const { db, me } = useStore();
  const a = useActions();
  const mine = useMine();
  const [f, setF] = useState({ job_id: "" as string, category: "machine", severity: "medium" as Severity, title: "", description: "", block: false });
  useEffect(() => {
    if (open) setF((x) => ({ ...x, job_id: preset?.id ?? mine.job?.id ?? "", title: "", description: "", block: false }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const jobs = db.jobs.filter((j) => j.status !== "done" && (j.assignees.includes(me.id) || can.admin(me.role) || j.id === f.job_id));
  return (
    <Sheet open={open} onClose={onClose} tall title={t("Report an issue")}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        await a.reportIssue({ job_id: f.job_id || null, category: f.category, severity: f.severity, title: f.title, description: f.description }, f.block);
        onClose();
      }}>
        <Field label={t("Linked job")}>
          <select value={f.job_id} onChange={(e) => setF({ ...f, job_id: e.target.value })}>
            <option value="">{t("General (not job-specific)")}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{jobCode(j)} · {j.title}</option>)}
          </select>
        </Field>
        <Field label={t("What kind?")}><div className="chips">{CATS.map((c) => <Chip key={c.v} on={f.category === c.v} onClick={() => setF({ ...f, category: c.v })}>{c.icon}{t(c.label)}</Chip>)}</div></Field>
        <Field label={t("How bad?")}><div className="chips">{SEV.map((s) => <Chip key={s.v} on={f.severity === s.v} onClick={() => setF({ ...f, severity: s.v })}>{t(s.label)}</Chip>)}</div></Field>
        <Field label={t("Short title")}><input required maxLength={90} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("e.g. Feeder 4 jamming")} /></Field>
        <Field label={t("Details")}><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t("What happened, what you tried…")} /></Field>
        {f.job_id && <div className="row between toggle-row"><span><b>{t("Block this job")}</b><small className="muted">{t("Stops the timer and flags it red")}</small></span><Toggle label={t("Block this job")} on={f.block} onChange={(v) => setF({ ...f, block: v })} /></div>}
        <div className="sheet-foot"><Btn type="submit" tone="primary" wide icon={<Send size={18} />}>{t("Send report")}</Btn></div>
      </form>
    </Sheet>
  );
}
