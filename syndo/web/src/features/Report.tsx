/** Report a message, a person or a server to MAKZ Labs (Online Safety Act and app store requirement). */
import { useState } from "react";
import { Flag } from "lucide-react";
import { api, errMsg } from "../api.ts";
import { toast } from "../store.ts";
import { Modal } from "../components/ui.tsx";
import { openModal } from "./modals.tsx";

const REASONS: [string, string][] = [
  ["spam", "Spam or scams"], ["harassment", "Harassment or bullying"], ["hate", "Hate or discrimination"], ["violence", "Threats or violence"],
  ["self_harm", "Self-harm or suicide"], ["child_safety", "Child safety"], ["sexual", "Sexual content"], ["illegal", "Something illegal"],
  ["impersonation", "Impersonation"], ["copyright", "Copyright or trade mark"], ["privacy", "Private information shared"], ["other", "Something else"],
];
export interface ReportTarget { type: "message" | "user" | "guild"; id: string; channelId?: string | null; guildId?: string | null; label: string; evidence?: { content?: string; author_id?: string; author_name?: string; attachments?: string[] } }

export function openReport(target: ReportTarget) { openModal((close) => <ReportDialog target={target} onClose={close} />); }

function ReportDialog({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState(""), [details, setDetails] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post("/api/reports", { target_type: target.type, target_id: target.id, channel_id: target.channelId ?? null, guild_id: target.guildId ?? null, reason, details, evidence: target.evidence ?? {} });
      setDone(true);
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  if (done) return <Modal title="Thanks for telling us" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
    <p>We've received your report and will review it. If someone is in immediate danger, contact your local emergency services.</p>
    <p className="muted small">You can also block them so they can't contact you.</p>
  </Modal>;
  return (
    <Modal title={<><Flag size={18} /> Report {target.label}</>} onClose={onClose} label="Report"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!reason || busy} onClick={send}>{busy ? "Sending…" : "Send report"}</button></>}>
      <p className="muted small">Reports go to the SEND safety team at MAKZ Labs, not to the person you're reporting.{target.type === "message" && target.evidence?.content ? " A copy of this message is included so we can review it, even in encrypted conversations." : ""}</p>
      <div className="report-reasons" role="radiogroup" aria-label="Reason">
        {REASONS.map(([k, l]) => <label key={k} className={`report-reason ${reason === k ? "on" : ""}`}><input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} /> {l}</label>)}
      </div>
      <label className="field"><span className="field-l">Anything else we should know? (optional)</span><textarea rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
    </Modal>
  );
}
