import { LifeBuoy, Search, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Chip, Empty, Field, Segmented, Sheet } from "../components/ui";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { ago, clock } from "../lib/time";
import type { Issue, Severity } from "../lib/types";
import { jobCode } from "../screens/parts";
import { useKimera } from "./actions";
import { PageHead, shortDate } from "./kit";

export const TICKET_STATUS: Record<Issue["status"], { label: string; tone: string }> = {
  open: { label: "Open", tone: "red" }, acknowledged: { label: "In progress", tone: "blue" }, resolved: { label: "Resolved", tone: "ok" },
};
const SEV: Record<Severity, { label: string; tone: string; n: number }> = {
  critical: { label: "Critical", tone: "alert", n: 0 }, high: { label: "High", tone: "red", n: 1 }, medium: { label: "Medium", tone: "moon", n: 2 }, low: { label: "Low", tone: "muted", n: 3 },
};
const CAT: Record<string, string> = { machine: "Machine", material: "Material", quality: "Quality", safety: "Safety", tooling: "Tooling", other: "Other" };
export const ticketNo = (i: Pick<Issue, "number">) => `TK-${i.number}`;

export function Tickets({ openId, onOpen, onJob }: { openId: string | null; onOpen: (id: string | null) => void; onJob: (id: string) => void }) {
  const { db, me, person } = useStore();
  const [view, setView] = useState<"active" | Issue["status"] | "all">("active");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const jobs = useMemo(() => new Map(db.jobs.map((j) => [j.id, j])), [db.jobs]);
  const rows = db.issues
    .filter((i) => view === "all" || (view === "active" ? i.status !== "resolved" : i.status === view))
    .filter((i) => !mine || i.assignee_id === me.id)
    .filter((i) => !q || `${ticketNo(i)} ${i.title} ${i.description} ${jobs.get(i.job_id ?? "")?.code ?? ""} ${person(i.reported_by)?.full_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.status === "resolved" ? 1 : 0) - (b.status === "resolved" ? 1 : 0) || SEV[a.severity].n - SEV[b.severity].n || b.created_at.localeCompare(a.created_at));
  const count = (s: Issue["status"]) => db.issues.filter((i) => i.status === s).length;
  const cur = openId ? db.issues.find((i) => i.id === openId) ?? null : null;
  return (
    <div className="k-page">
      <PageHead title={t("Tickets")} sub={t("Problems raised by the floor — machine, material, quality, safety. Reply here and the reporter is told.")} />
      <div className="toolbar">
        <div className="chips">
          <Chip on={view === "active"} onClick={() => setView("active")}>{t("Active")} · {count("open") + count("acknowledged")}</Chip>
          <Chip on={view === "open"} onClick={() => setView("open")}>{t("Open")} · {count("open")}</Chip>
          <Chip on={view === "acknowledged"} onClick={() => setView("acknowledged")}>{t("In progress")} · {count("acknowledged")}</Chip>
          <Chip on={view === "resolved"} onClick={() => setView("resolved")}>{t("Resolved")}</Chip>
          <Chip on={view === "all"} onClick={() => setView("all")}>{t("All")}</Chip>
          <Chip on={mine} onClick={() => setMine(!mine)}>{t("Assigned to me")}</Chip>
        </div>
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search tickets…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl k-tbl">
            <thead><tr><th>#</th><th>{t("Raised")}</th><th>{t("Title")}</th><th>{t("Type")}</th><th>{t("Severity")}</th><th>{t("Job")}</th><th>{t("Reported by")}</th><th>{t("Owner")}</th><th>{t("Status")}</th><th>{t("Updated")}</th></tr></thead>
            <tbody>
              {rows.map((i) => {
                const j = i.job_id ? jobs.get(i.job_id) : null;
                const replies = db.issue_comments.filter((c) => c.issue_id === i.id && c.kind === "comment").length;
                return (
                  <tr key={i.id} onClick={() => onOpen(i.id)}>
                    <td><span className="code">{ticketNo(i)}</span></td>
                    <td className="muted nowrap">{shortDate(i.created_at)}</td>
                    <td><b>{i.title}</b>{replies > 0 && <small className="muted"> · {t("{n} replies", { n: replies })}</small>}</td>
                    <td className="muted">{t(CAT[i.category] ?? i.category)}</td>
                    <td><Badge tone={SEV[i.severity].tone}>{t(SEV[i.severity].label)}</Badge></td>
                    <td>{j ? <button className="link" onClick={(e) => { e.stopPropagation(); onJob(j.id); }}>{jobCode(j)}</button> : <span className="muted">—</span>}</td>
                    <td><span className="who"><Avatar p={person(i.reported_by)} size={20} />{person(i.reported_by)?.full_name.split(" ")[0]}</span></td>
                    <td>{i.assignee_id ? <span className="who"><Avatar p={person(i.assignee_id)} size={20} />{person(i.assignee_id)?.full_name.split(" ")[0]}</span> : <span className="muted">{t("Nobody")}</span>}</td>
                    <td><Badge tone={TICKET_STATUS[i.status].tone} dot>{t(TICKET_STATUS[i.status].label)}</Badge></td>
                    <td className="muted nowrap">{ago(i.updated_at ?? i.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<LifeBuoy size={28} />} title={t("No tickets here")} hint={t("Workers raise them from Factory › Issues or from a job.")} />}
      <TicketSheet issue={cur} onClose={() => onOpen(null)} onJob={onJob} />
    </div>
  );
}

/** Ticket detail + conversation. Used by Kimera and by the Factory Issues screen. */
export function TicketSheet({ issue, onClose, onJob }: { issue: Issue | null; onClose: () => void; onJob?: (id: string) => void }) {
  const { db, me, person } = useStore();
  const k = useKimera();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const i = issue ? db.issues.find((x) => x.id === issue.id) ?? issue : null;
  const admin = can.admin(me.role);
  const canTalk = !!i && (admin || i.reported_by === me.id || i.assignee_id === me.id);
  const thread = i ? db.issue_comments.filter((c) => c.issue_id === i.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];
  const job = i?.job_id ? db.jobs.find((j) => j.id === i.job_id) : null;
  const staff = db.profiles.filter((p) => p.active && p.role !== "operator").sort((a, b) => a.full_name.localeCompare(b.full_name));
  const send = async () => {
    if (!i || !text.trim()) return;
    setBusy(true);
    const r = await k.comment(i.id, text.trim(), me.id);
    setBusy(false);
    if (r) setText("");
  };
  const eventText = (body: string) => {
    const [kind, v] = [body.slice(0, body.indexOf(":")), body.slice(body.indexOf(":") + 1)];
    if (kind === "status") return t("set the status to {s}", { s: t(TICKET_STATUS[v as Issue["status"]]?.label ?? v) });
    if (kind === "assign") return v ? t("gave it to {name}", { name: person(v)?.full_name ?? "—" }) : t("removed the owner");
    return body;
  };
  return (
    <Sheet open={!!i} onClose={onClose} tall title={i && <span className="row gap-s"><span className="code">{ticketNo(i)}</span>{i.title}</span>}>
      {i && (
        <div className="stack">
          <div className="row gap-s wrap">
            <Badge tone={TICKET_STATUS[i.status].tone} dot>{t(TICKET_STATUS[i.status].label)}</Badge>
            <Badge tone={SEV[i.severity].tone}>{t(SEV[i.severity].label)}</Badge>
            <Badge>{t(CAT[i.category] ?? i.category)}</Badge>
            {job && (onJob ? <button className="link" onClick={() => onJob(job.id)}>{jobCode(job)} · {job.title}</button> : <span className="code">{jobCode(job)}</span>)}
          </div>
          {(admin || i.assignee_id === me.id || i.reported_by === me.id) && (
            <div className="stack">
              <div className="seg-full"><Segmented value={i.status} onChange={(v) => k.updateTicket(i.id, { status: v })}
                options={(Object.keys(TICKET_STATUS) as Issue["status"][]).filter((s) => admin || i.assignee_id === me.id || s !== "acknowledged").map((s) => ({ value: s, label: t(TICKET_STATUS[s].label) }))} /></div>
              {admin && (
                <div className="row gap">
                  <Field label={t("Owner")}><select value={i.assignee_id ?? ""} onChange={(e) => k.updateTicket(i.id, { assignee_id: e.target.value || null })}>
                    <option value="">{t("Nobody")}</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
                  <Field label={t("Severity")}><select value={i.severity} onChange={(e) => k.updateTicket(i.id, { severity: e.target.value as Severity })}>
                    {(Object.keys(SEV) as Severity[]).map((s) => <option key={s} value={s}>{t(SEV[s].label)}</option>)}</select></Field>
                </div>
              )}
            </div>
          )}
          <div className="k-thread">
            <div className="k-msg first">
              <Avatar p={person(i.reported_by)} size={30} />
              <div><b>{person(i.reported_by)?.full_name}</b> <small className="muted">{ago(i.created_at)}</small>{i.description ? <p>{i.description}</p> : <p className="muted">{t("No details given")}</p>}</div>
            </div>
            {thread.map((c) => c.kind === "event"
              ? <div key={c.id} className="k-evt"><small><b>{person(c.author_id)?.full_name.split(" ")[0] ?? t("System")}</b> {eventText(c.body)} · {clock(c.created_at)}</small></div>
              : <div key={c.id} className={`k-msg ${c.author_id === me.id ? "me" : ""}`}><Avatar p={person(c.author_id)} size={30} /><div><b>{person(c.author_id)?.full_name}</b> <small className="muted">{ago(c.created_at)}</small><p>{c.body}</p></div></div>)}
          </div>
          {canTalk ? (
            <form className="k-reply" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Write a reply…")}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} />
              <Btn type="submit" tone="primary" busy={busy} disabled={!text.trim()} icon={<Send size={16} />}>{t("Send")}</Btn>
            </form>
          ) : <p className="fine">{t("Only the reporter, the owner and the office can reply.")}</p>}
        </div>
      )}
    </Sheet>
  );
}
