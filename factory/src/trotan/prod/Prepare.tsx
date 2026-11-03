// PREPARE workspace: machine + material, operation settings from approved profiles, copies on the bed
// (single / array / nesting / drag), kerf and common-line, validation, toolpath preview, estimate,
// save as a job (always tied to a saved design revision) and queue.
import { useEffect, useMemo, useState } from "react";
import { useToast } from "../../components/Toast";
import { useStore } from "../../lib/store";
import { OP_LABEL, leaves, opOf, type Doc, type OpType } from "../geom/core";
import { arrayPlacements, buildToolpath, checkParams, estimate, nestRects, partsArea, validateJob, UNITS, lineSpacing, type Issue, type OpParams, type Placement } from "../geom/laser";
import { errText, fmtTime, useT, type JobRow, type ProfileRow } from "../data";
import { useSession } from "../session";
import { Btn, Check, Empty, Num, Pill, Sel } from "../ui";
import { Workbed } from "./Workbed";
import { sameParams } from "./sameParams";
import { ExportPanel } from "./ExportPanel";

export { sameParams };
export const usedOps = (doc: Doc): OpType[] => {
  const s = new Set<OpType>();
  for (const { o, top } of leaves(doc.objects.filter((x) => !x.hidden))) { const op = o.op ?? opOf(doc, top.kind === "group" ? o : top); if (op !== "none") s.add(op); }
  return [...s];
};
const blank = (dpi: number): OpParams => ({ power: NaN, speed: NaN, freq: null, passes: 1, focus: 0, dpi, air: false, direction: "down", order: 0 });

export function Prepare({ dark, go }: { dark: boolean; go: (w: "manage" | "design" | "produce") => void }) {
  const T = useT(); const S = useSession(); const toast = useToast(); const { db } = useStore();
  const { doc, prep, setPrep } = S;
  const machines = T.machines.filter((m) => m.active);
  const machine = machines.find((m) => m.id === prep.machineId) ?? machines[0] ?? null;
  const materials = T.materials.filter((m) => !m.archived);
  const material = materials.find((m) => m.id === prep.materialId) ?? null;
  const [manual, setManual] = useState<Set<OpType>>(new Set());
  const [mode, setMode] = useState<"array" | "nest">("nest");
  const [arr, setArr] = useState({ rows: 1, cols: 1, gapX: 2, gapY: 2, count: 1, rotate: true });
  const [showPath, setShowPath] = useState(true); const [selPl, setSelPl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [unplaced, setUnplaced] = useState(0);
  const canPrep = T.can("prepare"), canApprove = T.can("approve");
  useEffect(() => { if (machine && prep.machineId !== machine.id) setPrep((p) => ({ ...p, machineId: machine.id })); }, [machine, prep.machineId, setPrep]);
  const ops = useMemo(() => usedOps(doc), [doc]);
  const caps = machine?.caps ?? null;
  const sheet = material?.sheet_w && material?.sheet_h ? { w: Number(material.sheet_w), h: Number(material.sheet_h) } : null;
  const profilesFor = (op: OpType): ProfileRow[] => !machine || !material ? [] : T.profiles.filter((p) => p.material_id === material.id && p.machine_id === machine.id && p.operation === op).sort((a, b) => b.version - a.version);
  const matchOf = (op: OpType) => (manual.has(op) ? null : profilesFor(op).find((p) => sameParams(op, p.params, prep.ops[op])) ?? null);
  // pick the approved settings automatically whenever machine/material change
  useEffect(() => {
    if (!machine || !material) return;
    setPrep((p) => {
      const next = { ...p.ops }; let changed = false;
      for (const op of ops) {
        if (manual.has(op)) continue;
        const appr = T.profiles.find((x) => x.material_id === material.id && x.machine_id === machine.id && x.operation === op && x.status === "approved");
        if (appr && !sameParams(op, appr.params, next[op])) { next[op] = { ...blank(machine.caps.dpi[0] ?? 0), ...appr.params }; changed = true; }
        else if (!appr && next[op] && !T.profiles.some((x) => x.material_id === material.id && x.machine_id === machine.id && x.operation === op && sameParams(op, x.params, next[op]))) { delete next[op]; changed = true; }
      }
      return changed ? { ...p, ops: next } : p;
    });
  }, [machine?.id, material?.id, ops.join(","), T.profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  // first visit: one copy at the sheet margin
  useEffect(() => { if (!prep.placements.length && doc.objects.length && caps) { const pl = arrayPlacements(doc, 1, 1, 0, 0, [prep.margin, prep.margin]); setPrep((p) => ({ ...p, placements: pl })); } }, [doc.objects.length, caps]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobOps = useMemo(() => Object.fromEntries(ops.filter((o) => prep.ops[o]).map((o) => [o, prep.ops[o]!])) as Partial<Record<OpType, OpParams>>, [ops, prep.ops]);
  const profileStatus = useMemo(() => Object.fromEntries(ops.map((op) => [op, matchOf(op)?.status ?? "missing"])), [ops, prep.ops, T.profiles, manual]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues: Issue[] = useMemo(() => {
    if (!caps) return [{ level: "error", code: "machine", msg: "No active machine — add one in ADMINISTRATION." }];
    const out = validateJob({ doc, placements: prep.placements, caps, ops: jobOps, sheet, margin: prep.margin, materialProhibited: !!material && !!machine?.prohibited.includes(material.id), materialName: material?.name, profileStatus, hardware: machine?.adapter !== "virtual" });
    if (!material) out.unshift({ level: "error", code: "material", msg: "Choose a material." });
    if (material && !sheet) out.push({ level: "info", code: "sheet_size", msg: "This material has no sheet size — only the bed limits are checked." });
    if (prep.test && !canApprove) out.push({ level: "error", code: "test", msg: "Only an authorised operator can prepare a material test job." });
    if (machine?.adapter === "none") out.push({ level: "info", code: "no_interface", msg: "This machine has no validated interface: TROTAN can prepare and export the job, but it must be run with the machine's own software." });
    return out;
  }, [doc, prep, caps, jobOps, sheet, material, machine, profileStatus, canApprove]);
  const errors = issues.filter((i) => i.level === "error");
  const tp = useMemo(() => (caps && prep.placements.length ? buildToolpath(doc, prep.placements, { ops: jobOps, kerf: prep.kerf, commonLine: prep.commonLine }) : null), [doc, prep.placements, jobOps, prep.kerf, prep.commonLine, caps]);
  const est = useMemo(() => (tp && caps && Object.values(jobOps).every((p) => p && p.speed > 0) && Object.keys(jobOps).length ? estimate(tp, jobOps, caps, doc.layers) : null), [tp, jobOps, caps, doc.layers]);
  const usage = useMemo(() => { if (!sheet || !prep.placements.length) return null; const a = partsArea(doc, prep.placements); return { parts: a, pct: (a / (sheet.w * sheet.h)) * 100 }; }, [doc, prep.placements, sheet]);
  const highlight = useMemo(() => new Set(issues.flatMap((i) => i.ids ?? []).filter((id) => prep.placements.some((p) => p.id === id))), [issues, prep.placements]);
  const stock = material?.stock_item_id ? db.stock_items.find((s) => s.id === material.stock_item_id) : null;
  const reserved = material?.stock_item_id ? T.reservations.filter((r) => r.stock_item_id === material.stock_item_id && r.status === "reserved" && r.job_id !== prep.jobId).reduce((a, r) => a + Number(r.quantity), 0) : 0;
  const job: JobRow | undefined = T.jobs.find((j) => j.id === prep.jobId);

  if (!S.project) return <div className="t-page"><Empty title="No project open" hint="Open or create a project in MANAGE, design it, then prepare it here."><Btn tone="primary" onClick={() => go("manage")}>Go to MANAGE</Btn></Empty></div>;
  if (!machines.length) return <div className="t-page"><Empty title="No machines" hint="An administrator adds machines in ADMINISTRATION → Machines." /></div>;

  const layout = (pl: Placement[], un = 0) => { setPrep((p) => ({ ...p, placements: pl, copies: pl.length })); setUnplaced(un); setSelPl(null); };
  const doArray = () => layout(arrayPlacements(doc, arr.rows, arr.cols, arr.gapX, arr.gapY, [prep.margin, prep.margin]));
  const doNest = () => { const r = nestRects(doc, arr.count, sheet ?? { w: caps!.bedW, h: caps!.bedH }, prep.margin, prep.spacing, arr.rotate); layout(r.placements, r.unplaced); };
  const setOp = (op: OpType, patch: Partial<OpParams>) => setPrep((p) => ({ ...p, ops: { ...p.ops, [op]: { ...(p.ops[op] ?? blank(caps?.dpi[0] ?? 0)), ...patch } } }));
  const saveJob = async (): Promise<string | null> => {
    if (!machine) return null;
    setBusy(true);
    try {
      const v = await S.save(`Job: ${prep.placements.length} × on ${machine.name}`, true);
      if (!v) throw new Error(S.saveError ?? "The design could not be saved");
      const row = { project_id: S.project!.id, revision: v, machine_id: machine.id, material_id: material?.id ?? null, status: errors.length ? "draft" : "ready", placements: prep.placements, ops: jobOps, kerf: prep.kerf,
        common_line: prep.commonLine, test: prep.test, copies: prep.placements.length, sheets: prep.sheets, estimate_s: est ? Math.round(est.seconds * 10) / 10 : null, validation: issues.map(({ level, code, msg, ids }) => ({ level, code, msg, ids })), mo_job_id: prep.moJobId };
      let id = prep.jobId;
      if (job && (job.status === "draft" || job.status === "ready")) { const { error } = await T.sb.from("trotan_jobs").update(row).eq("id", job.id); if (error) throw new Error(error.message); }
      else { const { data, error } = await T.sb.from("trotan_jobs").insert(row).select("id").single(); if (error) throw new Error(error.message); id = (data as { id: string }).id; setPrep((p) => ({ ...p, jobId: id })); }
      await T.refresh("jobs"); toast(errors.length ? "Saved as draft — fix the errors to queue it" : "Job saved and ready", errors.length ? "info" : "ok");
      return id;
    } catch (e) { toast(errText(e), "error"); return null; } finally { setBusy(false); }
  };
  const queue = async () => { const id = await saveJob(); if (!id || errors.length) return; setBusy(true); try { await T.rpc("trotan_queue", { p_job: id }); await T.refresh(); toast("Queued for production", "ok"); go("produce"); } catch (e) { toast(errText(e), "error"); } finally { setBusy(false); } };

  return (
    <div className="t-prep" data-testid="prepare">
      <div className="t-prep-l">
        <section>
          <h4>Machine</h4>
          <Sel label="Machine" value={machine?.id ?? ""} testid="prep-machine" onChange={(v) => setPrep((p) => ({ ...p, machineId: v }))} options={machines.map((m) => ({ value: m.id, label: `${m.name}${m.adapter === "virtual" ? " — simulation" : " — no validated interface"}` }))} />
          {caps && <p className="t-note">{caps.bedW} × {caps.bedH} mm · {caps.laserType.toUpperCase()} {caps.maxPowerW} W · up to {caps.maxSpeed} mm/s</p>}
          <h4>Material</h4>
          <Sel label="Material" value={material?.id ?? ""} testid="prep-material" onChange={(v) => setPrep((p) => ({ ...p, materialId: v || null }))}
            options={[{ value: "", label: "Choose…" }, ...materials.map((m) => ({ value: m.id, label: `${m.name}${machine?.prohibited.includes(m.id) ? " — PROHIBITED" : ""}`, disabled: machine?.prohibited.includes(m.id) }))]} />
          {material && <p className="t-note">{material.thickness_mm ? `${material.thickness_mm} mm · ` : ""}{sheet ? `sheet ${sheet.w} × ${sheet.h} mm` : "no sheet size"}{stock ? ` · KORTANA: ${stock.quantity - reserved} ${stock.unit} free${reserved ? ` (${reserved} reserved)` : ""}` : " · not linked to KORTANA stock"}</p>}
          <div className="t-grid2">
            <Num label="Sheets" value={prep.sheets} min={0} step={0.5} onCommit={(v) => setPrep((p) => ({ ...p, sheets: v }))} testid="prep-sheets" />
            <Num label="Margin" unit="mm" value={prep.margin} min={0} onCommit={(v) => setPrep((p) => ({ ...p, margin: v }))} />
          </div>
        </section>
        <section>
          <h4>Operations</h4>
          {!ops.length && <p className="t-note">The design has nothing to process. Give layers an operation in DESIGN.</p>}
          {ops.map((op) => {
            const list = profilesFor(op), m = matchOf(op), p = prep.ops[op], isManual = manual.has(op) || (!m && !!p);
            const errs = p && caps ? checkParams(op, p, caps) : [];
            return (
              <div key={op} className="t-op" data-testid={`op-${op}`}>
                <div className="t-row"><b>{OP_LABEL[op]}</b>{m ? <Pill tone={m.status === "approved" ? "ok" : "warn"}>{m.status === "approved" ? `Approved v${m.version}` : `${m.status} v${m.version}`}</Pill> : <Pill tone="warn">{p ? "Manual — unverified" : "No settings"}</Pill>}</div>
                <Sel label="Settings" value={m ? m.id : isManual ? "manual" : ""} testid={`op-src-${op}`}
                  onChange={(v) => { if (v === "manual") { setManual((s) => new Set(s).add(op)); setOp(op, {}); } else if (v) { const pf = list.find((x) => x.id === v)!; setManual((s) => { const n = new Set(s); n.delete(op); return n; }); setPrep((pp) => ({ ...pp, ops: { ...pp.ops, [op]: { ...blank(caps?.dpi[0] ?? 0), ...pf.params } } })); } }}
                  options={[...(m || isManual ? [] : [{ value: "", label: "Choose…" }]), ...list.map((x) => ({ value: x.id, label: `v${x.version} — ${x.status}${x.status === "approved" ? " ✓" : ""}` })), { value: "manual", label: "Manual (unverified)" }]} />
                {prep.test && doc.layers.some((l) => l.op === op && l.params?.power != null) && <p className="t-note">Material test: each square's own power and speed replace the values below; the rest (passes, focus, air…) apply to all squares.</p>}
                {!list.some((x) => x.status === "approved") && !prep.test && <p className="t-note warn">No approved settings for {OP_LABEL[op].toLowerCase()} on this material and machine. TROTAN never suggests power or speed — run a material test and have an authorised operator approve the result.</p>}
                {p && <div className="t-grid2">
                  <Num label="Power" unit={UNITS.power} value={p.power} min={0} max={100} disabled={!isManual} onCommit={(v) => setOp(op, { power: v })} />
                  <Num label="Speed" unit={UNITS.speed} value={p.speed} min={0} disabled={!isManual} onCommit={(v) => setOp(op, { speed: v })} />
                  <Num label="Passes" unit={UNITS.passes} value={p.passes} min={1} step={1} digits={0} disabled={!isManual} onCommit={(v) => setOp(op, { passes: Math.round(v) })} />
                  <Num label="Focus" unit={UNITS.focus} value={p.focus} disabled={!isManual} onCommit={(v) => setOp(op, { focus: v })} />
                  {caps?.freq && <Num label="Frequency" unit={UNITS.freq} value={p.freq} disabled={!isManual} onCommit={(v) => setOp(op, { freq: v })} />}
                  {op === "raster" && <Sel label="Resolution" value={String(p.dpi)} disabled={!isManual} onChange={(v) => setOp(op, { dpi: Number(v) })} options={(caps?.dpi ?? []).map((d) => ({ value: String(d), label: `${d} DPI (${lineSpacing(d).toFixed(3)} mm)` }))} />}
                  {caps?.airAssist && <Check on={p.air} disabled={!isManual} onChange={(v) => setOp(op, { air: v })} label="Air assist" />}
                </div>}
                {errs.map((e, i) => <p key={i} className="t-note err">{e.msg}</p>)}
              </div>
            );
          })}
          <div className="t-grid2">
            <Num label="Kerf" unit="mm" value={prep.kerf} min={0} max={4.99} step={0.01} digits={3} onCommit={(v) => setPrep((p) => ({ ...p, kerf: v }))} testid="prep-kerf" />
            <Check on={prep.commonLine} onChange={(v) => setPrep((p) => ({ ...p, commonLine: v }))} label="Common-line cutting" />
          </div>
          <p className="t-note">Kerf moves cut lines outwards on outlines and inwards on holes by half the kerf. Common-line removes shared edges between touching copies so they are cut once.</p>
          {canApprove && <Check on={prep.test} onChange={(v) => setPrep((p) => ({ ...p, test: v }))} label="Material test job (may use unapproved settings)" />}
        </section>
        <section>
          <h4>Copies on the bed</h4>
          <div className="t-seg"><button type="button" className={mode === "nest" ? "on" : ""} onClick={() => setMode("nest")}>Nest</button><button type="button" className={mode === "array" ? "on" : ""} onClick={() => setMode("array")}>Array</button></div>
          {mode === "nest" ? <>
            <div className="t-grid2"><Num label="Copies" value={arr.count} min={1} max={5000} step={1} digits={0} onCommit={(v) => setArr({ ...arr, count: Math.round(v) })} testid="nest-count" /><Num label="Spacing" unit="mm" value={prep.spacing} min={0} onCommit={(v) => setPrep((p) => ({ ...p, spacing: v }))} /></div>
            <Check on={arr.rotate} onChange={(v) => setArr({ ...arr, rotate: v })} label="Allow 90° rotation" />
            <Btn small onClick={doNest} testid="nest-btn">Nest on {sheet ? "sheet" : "bed"}</Btn>
            <p className="t-note">Rectangle nesting by bounding box (fast and predictable). Shapes are not interlocked.</p>
          </> : <>
            <div className="t-grid2"><Num label="Rows" value={arr.rows} min={1} max={200} step={1} digits={0} onCommit={(v) => setArr({ ...arr, rows: Math.round(v) })} /><Num label="Columns" value={arr.cols} min={1} max={200} step={1} digits={0} onCommit={(v) => setArr({ ...arr, cols: Math.round(v) })} />
              <Num label="Gap X" unit="mm" value={arr.gapX} onCommit={(v) => setArr({ ...arr, gapX: v })} /><Num label="Gap Y" unit="mm" value={arr.gapY} onCommit={(v) => setArr({ ...arr, gapY: v })} /></div>
            <Btn small onClick={doArray}>Make array</Btn>
          </>}
          {unplaced > 0 && <p className="t-note warn">{unplaced} cop{unplaced === 1 ? "y does" : "ies do"} not fit — use another sheet or fewer copies.</p>}
          <p className="t-note">{prep.placements.length} cop{prep.placements.length === 1 ? "y" : "ies"} placed. Drag copies on the bed to move them.{selPl && <> <button type="button" className="t-link" onClick={() => layout(prep.placements.filter((p) => p.id !== selPl))}>Remove selected copy</button></>}</p>
        </section>
      </div>
      <div className="t-prep-c">
        <Workbed testid="workbed" dark={dark} doc={doc} placements={prep.placements} bed={{ w: caps?.bedW ?? 600, h: caps?.bedH ?? 400 }} sheet={sheet} margin={prep.margin}
          toolpath={showPath ? tp : null} highlight={highlight} selected={selPl} onSelect={setSelPl}
          onMove={(id, dx, dy, commit) => { if (!commit) return; setPrep((p) => ({ ...p, placements: p.placements.map((q) => (q.id === id ? { ...q, m: [q.m[0], q.m[1], q.m[2], q.m[3], q.m[4] + dx, q.m[5] + dy] } : q)) })); }} />
        <div className="t-bed-bar"><Check on={showPath} onChange={setShowPath} label="Show toolpath (order: raster → marks → scores → cuts, holes first)" testid="show-path" /></div>
      </div>
      <div className="t-prep-r">
        <section>
          <h4>Estimate</h4>
          {est ? <div className="t-est" data-testid="estimate"><b>{fmtTime(est.seconds)}</b><Pill tone="info" title="Calculated from lengths, speeds and acceleration; it becomes accurate only after comparing with real runs">estimate</Pill>
            <ul>{Object.entries(est.byOp).map(([k, s]) => <li key={k}>{OP_LABEL[k as OpType]}: {fmtTime(s)}</li>)}<li>Travel: {fmtTime(est.travel)}</li><li>Cut length: {(est.cutLength / 1000).toFixed(2)} m</li></ul></div> : <p className="t-note">Set every operation's speed to see an estimate.</p>}
          {usage && <p className="t-note">Parts use {usage.pct.toFixed(1)}% of the sheet ({(usage.parts / 100).toFixed(1)} cm²).</p>}
        </section>
        <section>
          <h4>Validation {errors.length ? <Pill tone="err">{errors.length} error{errors.length === 1 ? "" : "s"}</Pill> : <Pill tone="ok">no errors</Pill>}</h4>
          <div className="t-issues" data-testid="validation">
            {issues.map((i, k) => <div key={k} className={`t-issue ${i.level}`}>{i.msg}</div>)}
            {!issues.length && <p className="t-ok">Ready.</p>}
          </div>
        </section>
        <section>
          <h4>Job</h4>
          {job && <p className="t-note">{job.number} · {job.status} · design v{job.revision}</p>}
          <Sel label="SK Factory job (MO)" value={prep.moJobId ?? ""} onChange={(v) => setPrep((p) => ({ ...p, moJobId: v || null }))} options={[{ value: "", label: "Not linked" }, ...db.jobs.filter((j) => j.status !== "done" || j.id === prep.moJobId).slice(0, 300).map((j) => ({ value: j.id, label: `${j.code} — ${j.title}` }))]} />
          <div className="t-row">
            <Btn disabled={!canPrep || busy} onClick={saveJob} testid="save-job" title={canPrep ? "Saves a design revision and the job" : "Your role cannot prepare jobs"}>Save job</Btn>
            <Btn tone="primary" disabled={!canPrep || busy || errors.length > 0} onClick={queue} testid="queue-job" title={errors.length ? "Fix the validation errors first" : "Reserves the material in KORTANA (no stock is deducted until the job is finished)"}>Queue</Btn>
          </div>
          {!canPrep && <p className="t-note">Your role can view preparation but not save or queue jobs.</p>}
          <p className="t-note">Queuing reserves material in KORTANA. Stock is only consumed when production is recorded as finished.</p>
        </section>
        {machine && <section>
          <h4>Machine file &amp; job sheet</h4>
          <ExportPanel doc={doc} placements={prep.placements} tp={tp} ops={jobOps} machine={machine} material={material} test={prep.test} job={job?.number ?? "New job"} project={S.project.name}
            revision={job?.revision ?? null} copies={prep.placements.length} sheets={prep.sheets} kerf={prep.kerf} commonLine={prep.commonLine} estimate={est?.seconds ?? null} moJobId={prep.moJobId}
            disabled={errors.length ? "Fix the validation errors first — the file and sheet are only for jobs that pass every check." : null} />
        </section>}
      </div>
    </div>
  );
}
