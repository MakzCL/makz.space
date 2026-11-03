// "Run on a machine with its own software": bed file (SVG/DXF) + printable job sheet with settings per colour.
import { useMemo } from "react";
import { useToast } from "../../components/Toast";
import { useStore } from "../../lib/store";
import type { Doc, OpType } from "../geom/core";
import type { OpParams, Placement, Toolpath } from "../geom/laser";
import { exportSvg } from "../geom/svg";
import { errText, fmtTime, useT, type MachineRow, type MaterialRow } from "../data";
import { Btn } from "../ui";
import { sameParams } from "./sameParams";
import { bedDoc, colourClashes, downloadBed, jobSheetHtml, openJobSheet, sheetRows } from "./machineExport";

export function ExportPanel(p: { doc: Doc; placements: Placement[]; tp: Toolpath | null; ops: Partial<Record<OpType, OpParams>>; machine: MachineRow; material: MaterialRow | null;
  test: boolean; job: string; project: string; revision: number | null; copies: number; sheets: number; kerf: number; commonLine: boolean; estimate: number | null; moJobId: string | null; disabled?: string | null }) {
  const T = useT(); const toast = useToast(); const { db, me } = useStore();
  const source = (op: OpType) => {
    const pf = p.material && T.profiles.find((x) => x.material_id === p.material!.id && x.machine_id === p.machine.id && x.operation === op && sameParams(op, x.params, p.ops[op]));
    if (!pf) return p.test ? "Test (unapproved)" : "NOT APPROVED";
    const by = pf.approved_by ? db.profiles.find((x) => x.id === pf.approved_by)?.full_name : null;
    return `${pf.status === "approved" ? "Approved" : pf.status} v${pf.version}${by ? ` · ${by}` : ""}${pf.approved_at ? ` · ${new Date(pf.approved_at).toLocaleDateString("en-GB")}` : ""}`;
  };
  const rows = useMemo(() => sheetRows(p.doc, p.ops, source, p.test), [p.doc, p.ops, p.test, T.profiles]); // eslint-disable-line react-hooks/exhaustive-deps
  const clashes = useMemo(() => colourClashes(rows), [rows]);
  const bed = { w: p.machine.caps.bedW, h: p.machine.caps.bedH };
  const ready = !!p.tp && p.placements.length > 0 && !p.disabled;
  const sheet = () => {
    if (!p.tp) return;
    try {
      const svg = exportSvg(bedDoc(p.doc, p.placements, p.tp, bed));
      const mo = p.moJobId ? db.jobs.find((j) => j.id === p.moJobId) : null;
      openJobSheet(jobSheetHtml({ sheetSize: p.material?.sheet_w && p.material?.sheet_h ? { w: Number(p.material.sheet_w), h: Number(p.material.sheet_h) } : null, job: p.job, project: p.project, revision: p.revision, machine: `${p.machine.name}${p.machine.manufacturer ? ` (${p.machine.manufacturer} ${p.machine.model})` : ""}`, material: p.material?.name ?? "—",
        sheet: p.material?.sheet_w && p.material?.sheet_h ? `${p.material.sheet_w} × ${p.material.sheet_h} mm${p.material.thickness_mm ? `, ${p.material.thickness_mm} mm thick` : ""}` : "—",
        copies: p.copies, sheets: p.sheets, kerf: p.kerf, commonLine: p.commonLine, estimate: fmtTime(p.estimate), test: p.test, mo: mo ? `${mo.code} — ${mo.title}` : null, printedBy: me.full_name }, rows, svg, clashes));
    } catch (e) { toast(errText(e), "error"); }
  };
  const file = (k: "svg" | "dxf") => { if (!p.tp) return; try { downloadBed(p.doc, p.placements, p.tp, bed, `${p.job}-${p.project}`, k); } catch (e) { toast(errText(e), "error"); } };
  return (
    <div className="t-export" data-testid="machine-export">
      <p className="t-note">For a machine run with its own software: download the bed file (every copy, in cutting order, in mm, one colour per layer) and print the job sheet with the settings for each colour.</p>
      {clashes.map((c, i) => <p key={i} className="t-note err">Colour clash — {c}. Give each layer its own colour in DESIGN.</p>)}
      {rows.some((r) => !r.params) && <p className="t-note warn">Some operations have no settings yet.</p>}
      <div className="t-row">
        <Btn small disabled={!ready} onClick={() => file("svg")} title={p.disabled ?? "SVG with engraving fills and cut lines"} testid="export-svg">Bed SVG</Btn>
        <Btn small disabled={!ready} onClick={() => file("dxf")} title={p.disabled ?? "DXF R12, vector work only (cuts, scores, marks)"}>Bed DXF</Btn>
        <Btn small tone="primary" disabled={!ready} onClick={sheet} title={p.disabled ?? "Opens a printable sheet in a new tab"} testid="job-sheet">Job sheet</Btn>
      </div>
      {p.disabled && <p className="t-note">{p.disabled}</p>}
    </div>
  );
}
