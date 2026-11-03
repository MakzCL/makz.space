// PRODUCE workspace: the machine queue, pre-run checks, running on the virtual laser (simulation only),
// recording results (good / scrap / time / material) and job history. Real machines without a
// validated interface are shown but can never be started from here.
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../../components/Toast";
import { useStore } from "../../lib/store";
import type { Doc } from "../geom/core";
import { ADAPTERS, NO_INTERFACE, type RunProgress } from "../geom/adapters";
import { buildToolpath, type Toolpath } from "../geom/laser";
import { errText, fmtTime, useT, type JobRow, type MachineRow, type RunRow } from "../data";
import { Btn, Check, Empty, Modal, Num, Pill, Text } from "../ui";
import { Workbed } from "./Workbed";

const OPERATOR_CHECKS = ["Material is on the bed, flat and inside the marked area", "Focus is set for this material", "Extraction and air assist are running", "Lid is closed and the area is clear", "I am at the machine and can stop it"];
const key = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
export const STATUS_TONE: Record<string, "" | "ok" | "warn" | "err" | "info"> = { draft: "", ready: "info", queued: "info", running: "warn", done: "ok", failed: "err", cancelled: "" };

export function Produce({ dark }: { dark: boolean }) {
  const T = useT(); const toast = useToast(); const { db } = useStore();
  const [machineId, setMachineId] = useState<string | null>(null);
  const machine = T.machines.find((m) => m.id === machineId) ?? T.machines.find((m) => m.active) ?? null;
  const queue = T.jobs.filter((j) => j.machine_id === machine?.id && (j.status === "queued" || j.status === "running")).sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : a.position - b.position));
  const [jobId, setJobId] = useState<string | null>(null);
  const job = queue.find((j) => j.id === jobId) ?? queue[0] ?? null;
  const [doc, setDoc] = useState<Doc | null>(null);
  useEffect(() => { setDoc(null); if (job) T.revisionDoc(job.project_id, job.revision).then(setDoc).catch((e) => toast(errText(e), "error")); }, [job?.id, job?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const tp: Toolpath | null = useMemo(() => (doc && job ? buildToolpath(doc, job.placements, { ops: job.ops, kerf: Number(job.kerf), commonLine: job.common_line }) : null), [doc, job]);
  const run = job ? T.runs.find((r) => r.job_id === job.id && r.status === "running") ?? null : null;
  const [prog, setProgS] = useState<RunProgress | null>(null); const progRef = useRef<RunProgress | null>(null);
  const setProg = (p: RunProgress | null) => { progRef.current = p; setProgS(p); };
  const abort = useRef<AbortController | null>(null);
  const [finish, setFinish] = useState<{ run: RunRow; status: "done" | "failed" | "aborted"; seconds: number } | null>(null);
  const canRun = T.can("produce"), canPrep = T.can("prepare");
  const [tab, setTab] = useState<"queue" | "history">("queue");
  useEffect(() => () => abort.current?.abort(), []);

  if (!T.machines.length) return <div className="t-page"><Empty title="No machines" hint="An administrator adds machines in ADMINISTRATION → Machines." /></div>;
  const adapter = machine ? ADAPTERS[machine.adapter] : undefined;
  const info = machine ? (adapter ? adapter.info(machine.caps) : NO_INTERFACE(machine.manufacturer || "Unknown", machine.model || machine.name)) : null;
  const project = (id: string) => T.projects.find((p) => p.id === id);
  const material = (id: string | null) => T.materials.find((m) => m.id === id);

  const startRun = async (checks: { name: string; ok: boolean }[]) => {
    if (!job || !machine || !adapter || !tp) return;
    try {
      const rid = await T.rpc<string>("trotan_start", { p_job: job.id, p_checks: checks, p_key: key() });
      await T.refresh();
      const ctl = new AbortController(); abort.current = ctl;
      const t0 = performance.now();
      const state = await adapter.run(tp, Math.max(1, Number(job.estimate_s ?? 30)), setProg, ctl.signal, 20);
      const simulated = Math.round(Number(job.estimate_s ?? (performance.now() - t0) / 1000) * 10) / 10;
      const r = T.runs.find((x) => x.id === rid) ?? ({ id: rid } as RunRow);
      setFinish({ run: r, status: state === "done" ? "done" : "aborted", seconds: state === "done" ? simulated : Math.round((progRef.current?.t ?? 0) * 10) / 10 });
    } catch (e) { toast(errText(e), "error"); }
  };
  const back = async (j: JobRow, status: "ready" | "cancelled") => { try { const { error } = await T.sb.from("trotan_jobs").update({ status }).eq("id", j.id); if (error) throw new Error(error.message); await T.refresh(); toast(status === "ready" ? "Back to ready — the material reservation was released" : "Job cancelled", "ok"); } catch (e) { toast(errText(e), "error"); } };
  const move = async (j: JobRow, dir: -1 | 1) => {
    const i = queue.findIndex((x) => x.id === j.id), other = queue[i + dir]; if (!other || other.status === "running") return;
    try { for (const [a, pos] of [[j, other.position], [other, j.position]] as const) { const { error } = await T.sb.from("trotan_jobs").update({ position: pos }).eq("id", a.id); if (error) throw new Error(error.message); } await T.refresh("jobs"); } catch (e) { toast(errText(e), "error"); }
  };

  return (
    <div className={`t-produce ${tab === "history" ? "hist" : ""}`} data-testid="produce">
      <div className="t-prod-l">
        <div className="t-seg"><button type="button" className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>Queue</button><button type="button" className={tab === "history" ? "on" : ""} onClick={() => setTab("history")} data-testid="history-tab">History</button></div>
        {tab === "queue" ? <>
          <div className="t-machines">
            {T.machines.map((m) => <button key={m.id} type="button" className={`t-machine ${machine?.id === m.id ? "on" : ""}`} onClick={() => { setMachineId(m.id); setJobId(null); }}>
              <b>{m.name}</b><span><Pill tone={m.status === "idle" ? "ok" : m.status === "busy" ? "warn" : ""}>{m.status}</Pill> {m.adapter === "virtual" ? "simulation" : "no interface"}{!m.active && " · off"}</span></button>)}
          </div>
          <h4>Queue · {machine?.name}</h4>
          {!queue.length && <p className="t-note">Nothing queued. Jobs are queued from PREPARE.</p>}
          {queue.map((j, i) => (
            <div key={j.id} className={`t-qjob ${job?.id === j.id ? "on" : ""}`} onClick={() => setJobId(j.id)} data-testid="queue-item">
              <div><b>{j.number}</b> {project(j.project_id)?.name ?? "—"} {j.test && <Pill tone="warn">test</Pill>}</div>
              <small>{j.copies} cop{j.copies === 1 ? "y" : "ies"} · {material(j.material_id)?.name ?? "no material"} · {fmtTime(j.estimate_s)} <Pill tone={STATUS_TONE[j.status]}>{j.status}</Pill></small>
              {canPrep && j.status === "queued" && <span className="t-qmove" onClick={(e) => e.stopPropagation()}><button type="button" disabled={i === 0 || queue[i - 1]?.status === "running"} onClick={() => move(j, -1)} aria-label="Move up">↑</button><button type="button" disabled={i === queue.length - 1} onClick={() => move(j, 1)} aria-label="Move down">↓</button></span>}
            </div>
          ))}
        </> : <History />}
      </div>
      {tab === "queue" && <div className="t-prod-c">
        {machine && doc && job ? <Workbed testid="produce-bed" dark={dark} doc={doc} placements={job.placements} bed={{ w: machine.caps.bedW, h: machine.caps.bedH }} sheet={(() => { const m = material(job.material_id); return m?.sheet_w && m?.sheet_h ? { w: Number(m.sheet_w), h: Number(m.sheet_h) } : null; })()} margin={0}
          toolpath={tp} head={prog?.head ?? null} laserOn={!!prog?.laserOn} doneItems={prog ? prog.item : -1} /> : <Empty title={job ? "Loading design…" : "Select a queued job"} />}
        {prog && <div className="t-progress" data-testid="sim-progress"><div style={{ width: `${(prog.t / prog.total) * 100}%` }} /><span>{prog.state === "running" ? `Simulating ${prog.item}/${prog.items} · ${fmtTime(prog.t)} of ${fmtTime(prog.total)} (20× speed)` : prog.state}</span></div>}
      </div>}
      {tab === "queue" && <div className="t-prod-r">
        {info && <section><h4>Machine</h4><p className="t-note">{info.notes}</p>{machine?.adapter === "none" && <p className="t-note warn">Export the job from PREPARE and run it with the manufacturer's software, using the machine's own start button and safety procedure.</p>}</section>}
        {job && <section>
          <h4>{job.number}</h4>
          <dl className="t-dl"><dt>Project</dt><dd>{project(job.project_id)?.name} · design v{job.revision}</dd><dt>Material</dt><dd>{material(job.material_id)?.name ?? "—"} · {Number(job.sheets)} sheet(s)</dd>
            <dt>Copies</dt><dd>{job.copies}</dd><dt>Estimate</dt><dd>{fmtTime(job.estimate_s)} <Pill tone="info">estimate</Pill></dd>
            <dt>Stock</dt><dd>{(() => { const r = T.reservations.find((x) => x.job_id === job.id); return r ? `${Number(r.quantity)} reserved in KORTANA (${r.status})` : "No KORTANA link"; })()}</dd>
            {job.mo_job_id && <><dt>SK Factory</dt><dd>{db.jobs.find((x) => x.id === job.mo_job_id)?.code ?? "linked job"}</dd></>}</dl>
          {job.status === "queued" && <PreRun machine={machine!} canRun={canRun && !!adapter && machine?.adapter === "virtual" && machine.status === "idle" && !!tp} blocked={!canRun ? "Your role cannot run jobs" : machine?.adapter !== "virtual" ? "No validated interface for this machine" : machine.status !== "idle" ? `Machine is ${machine.status}` : !tp ? "Loading…" : null} onStart={startRun} />}
          {job.status === "queued" && canPrep && <div className="t-row"><Btn small onClick={() => back(job, "ready")}>Back to ready</Btn><Btn small tone="danger" onClick={() => back(job, "cancelled")}>Cancel job</Btn></div>}
          {run && <>
            <p className="t-note">Running since {new Date(run.started_at).toLocaleTimeString("en-GB")}.</p>
            {prog?.state === "running" ? <Btn tone="danger" onClick={() => abort.current?.abort()} testid="abort-run">Stop simulation</Btn>
              : <Btn tone="primary" onClick={() => setFinish({ run, status: "done", seconds: Number(job.estimate_s ?? 0) })} testid="record-result">Record result…</Btn>}
          </>}
        </section>}
      </div>}
      {finish && job && <FinishForm job={job} f={finish} onClose={() => { setFinish(null); setProg(null); }} />}
    </div>
  );
}

function PreRun({ machine, canRun, blocked, onStart }: { machine: MachineRow; canRun: boolean; blocked: string | null; onStart: (c: { name: string; ok: boolean }[]) => void }) {
  const [ready, setReady] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null);
  const [ticks, setTicks] = useState<boolean[]>(OPERATOR_CHECKS.map(() => false));
  useEffect(() => { const a = ADAPTERS[machine.adapter]; if (a) a.readiness().then((r) => setReady(r.checks)); else setReady([{ name: "Machine interface", ok: false, detail: "No validated interface" }]); }, [machine.adapter]);
  const all = ticks.every(Boolean) && !!ready?.every((r) => r.ok);
  return (
    <div className="t-prerun" data-testid="prerun">
      <h4>Before you start</h4>
      {ready?.map((r) => <p key={r.name} className={`t-note ${r.ok ? "" : "err"}`}>{r.ok ? "✓" : "✕"} {r.name}: {r.detail}</p>)}
      {machine.adapter === "virtual" && <p className="t-note">This is a simulation. Confirm the checks as you would on a real machine — it is part of the recorded run.</p>}
      {OPERATOR_CHECKS.map((c, i) => <Check key={c} on={ticks[i]} onChange={(v) => setTicks((t) => t.map((x, k) => (k === i ? v : x)))} label={c} testid={`check-${i}`} />)}
      <Btn tone="primary" disabled={!canRun || !all} onClick={() => onStart([...(ready ?? []).map((r) => ({ name: r.name, ok: r.ok })), ...OPERATOR_CHECKS.map((c, i) => ({ name: c, ok: ticks[i] }))])} testid="start-run"
        title={blocked ?? (all ? "Start the simulated run" : "Confirm every check first")}>Start {machine.adapter === "virtual" ? "simulation" : ""}</Btn>
      {blocked && <p className="t-note">{blocked}</p>}
    </div>
  );
}

function FinishForm({ job, f, onClose }: { job: JobRow; f: { run: RunRow; status: "done" | "failed" | "aborted"; seconds: number }; onClose: () => void }) {
  const T = useT(); const toast = useToast();
  const [status, setStatus] = useState(f.status); const [good, setGood] = useState(f.status === "done" ? job.copies : 0); const [scrap, setScrap] = useState(0);
  const [secs, setSecs] = useState(f.seconds); const [sheets, setSheets] = useState(f.status === "done" ? Number(job.sheets) : 0); const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false); const k = useRef(key());
  const save = async () => {
    setBusy(true);
    try { await T.rpc("trotan_finish", { p_run: f.run.id, p_status: status, p_good: good, p_scrap: scrap, p_seconds: secs, p_sheets: sheets, p_notes: notes, p_key: k.current }); await T.refresh(); toast(status === "done" ? "Production recorded" : "Run recorded as " + status, "ok"); onClose(); }
    catch (e) { toast(errText(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Record result · ${job.number}`} onClose={onClose} foot={<><Btn onClick={onClose}>Later</Btn><Btn tone="primary" disabled={busy || good + scrap > 100000} onClick={save} testid="finish-save">Save result</Btn></>}>
      <div className="t-seg">{(["done", "failed", "aborted"] as const).map((s) => <button key={s} type="button" className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{{ done: "Finished", failed: "Failed", aborted: "Stopped" }[s]}</button>)}</div>
      <div className="t-grid2">
        <Num label="Good parts" value={good} min={0} step={1} digits={0} onCommit={(v) => setGood(Math.round(v))} testid="finish-good" />
        <Num label="Scrap" value={scrap} min={0} step={1} digits={0} onCommit={(v) => setScrap(Math.round(v))} />
        <Num label="Time" unit="s" value={secs} min={0} onCommit={setSecs} />
        <Num label="Sheets used" value={sheets} min={0} step={0.5} onCommit={setSheets} testid="finish-sheets" />
      </div>
      <Text label="Notes" value={notes} onCommit={setNotes} multiline placeholder={status === "done" ? "Optional" : "What happened?"} />
      <p className="t-note">Saving consumes {sheets} sheet(s) from KORTANA {sheets ? "" : "(none — the reservation is released)"}. Saving twice never deducts twice.</p>
    </Modal>
  );
}

export function History() {
  const T = useT(); const { db } = useStore();
  const [q, setQ] = useState("");
  const rows = T.jobs.filter((j) => ["done", "failed", "cancelled"].includes(j.status)).filter((j) => { if (!q) return true; const p = T.projects.find((x) => x.id === j.project_id); return `${j.number} ${p?.name ?? ""} ${p?.customer ?? ""}`.toLowerCase().includes(q.toLowerCase()); });
  return (
    <div className="t-history-list" data-testid="job-history">
      <input className="t-search" placeholder="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} />
      {!rows.length && <p className="t-note">No finished jobs yet.</p>}
      {rows.slice(0, 300).map((j) => {
        const p = T.projects.find((x) => x.id === j.project_id), m = T.machines.find((x) => x.id === j.machine_id), mt = T.materials.find((x) => x.id === j.material_id);
        return (
          <div key={j.id} className="t-hjob">
            <div><b>{j.number}</b> {p?.name ?? "—"} <Pill tone={STATUS_TONE[j.status]}>{j.status}</Pill>{j.test && <Pill tone="warn">test</Pill>}</div>
            <small>{m?.name} · {mt?.name ?? "—"} · {j.qty_good ?? 0} good / {j.qty_scrap ?? 0} scrap · est. {fmtTime(j.estimate_s)} / actual {fmtTime(j.actual_s)} · {db.profiles.find((x) => x.id === j.operator)?.full_name ?? "—"} · {j.finished_at ? new Date(j.finished_at).toLocaleString("en-GB") : ""}</small>
            {j.error && <small className="t-err">{j.error}</small>}
          </div>
        );
      })}
    </div>
  );
}
