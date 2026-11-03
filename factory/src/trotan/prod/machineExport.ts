// Export a prepared job for a machine that TROTAN does not control: the whole bed (every copy, kerf and
// common-line already applied, in cutting order) as SVG/DXF in millimetres, one colour per layer, plus
// a printable job sheet that lists the settings for each colour. The operator loads the file into the
// machine's own software, enters the settings from the sheet and starts the job on the machine.
import { leaves, mul, OP_LABEL, opOf, type Doc, type Layer, type Mat, type Obj, type OpType, type Vec } from "../geom/core";
import { exportDxf } from "../geom/dxf";
import { exportSvg } from "../geom/svg";
import { UNITS, lineSpacing, type OpParams, type Placement, type Toolpath } from "../geom/laser";
import { download, safeName } from "../editor/io";
import { processedPng } from "../editor/rasterPreview";

/** The bed as a document in bed coordinates. Vector work comes from the toolpath (pass 1); raster work keeps its shapes/images. */
export function bedDoc(doc: Doc, placements: Placement[], tp: Toolpath, bed: { w: number; h: number }, opts: { vectorOnly?: boolean } = {}): Doc {
  const objects: Obj[] = []; let n = 0;
  const layerFor = new Map(doc.layers.map((l) => [l.id, l]));
  if (!opts.vectorOnly) for (const pl of placements) for (const { o, m, top } of leaves(doc.objects.filter((x) => !x.hidden))) {
    const op = o.op ?? top.op ?? opOf(doc, top.kind === "group" ? o : top);
    if (op !== "raster" && o.kind !== "image") continue;
    if (op === "none") continue;
    const { id: _id, ...rest } = o; void _id;
    objects.push({ ...(rest as Obj), id: `r${n++}`, layer: top.kind === "group" ? o.layer : top.layer, m: mul(pl.m, m) as Mat } as Obj);
  }
  for (const it of tp.items) {
    if ("box" in it || it.pass !== 1) continue;
    const layer = layerFor.has(it.layer) ? it.layer : doc.layers.find((l) => l.op === it.op)?.id ?? doc.layers[0].id;
    const pts = it.pts;
    objects.push({ id: `v${n++}`, layer, kind: "path", m: [1, 0, 0, 1, 0, 0], paths: [{ start: [...pts[0]] as Vec, closed: it.closed, segs: [...pts.slice(1), ...(it.closed ? [pts[0]] : [])].map((p) => ({ k: "L" as const, p: [...p] as Vec })) }] });
  }
  const used = new Set(objects.map((o) => o.layer));
  return { format: "trotan", version: 1, units: "mm", width: bed.w, height: bed.h, guides: [], layers: doc.layers.filter((l) => used.has(l.id)), objects };
}

export interface SheetRow { layer: Layer; op: OpType; params: OpParams | null; source: string }
/** One row per used layer: the colour, operation and the exact settings to enter on the machine. */
export function sheetRows(doc: Doc, ops: Partial<Record<OpType, OpParams>>, source: (op: OpType) => string, test: boolean): SheetRow[] {
  const used = new Set<string>();
  for (const { o, top } of leaves(doc.objects.filter((x) => !x.hidden))) { const op = o.op ?? top.op ?? opOf(doc, top.kind === "group" ? o : top); if (op !== "none") used.add(`${top.kind === "group" ? o.layer : top.layer}|${op}`); }
  return [...used].map((k) => {
    const [lid, op] = k.split("|") as [string, OpType];
    const layer = doc.layers.find((l) => l.id === lid)!;
    const base = ops[op]; const params = base ? ({ ...base, ...(layer.params ?? {}) } as OpParams) : null;
    return { layer, op, params, source: layer.params && Object.keys(layer.params).length ? (test ? "Test square (unapproved)" : "Layer setting") : source(op) };
  }).filter((r) => r.layer).sort((a, b) => (a.op === b.op ? a.layer.name.localeCompare(b.layer.name) : a.op.localeCompare(b.op)));
}
/** Colours must be unique per settings, or the machine software cannot tell the layers apart. */
export function colourClashes(rows: SheetRow[]): string[] {
  const by = new Map<string, SheetRow[]>(); for (const r of rows) { const c = r.layer.color.toLowerCase(); by.set(c, [...(by.get(c) ?? []), r]); }
  const out: string[] = [];
  for (const [c, rs] of by) if (rs.length > 1 && new Set(rs.map((r) => JSON.stringify([r.op, r.params]))).size > 1) out.push(`${c}: ${rs.map((r) => r.layer.name).join(", ")} use the same colour with different settings`);
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export interface SheetInfo { sheetSize?: { w: number; h: number } | null; job: string; project: string; revision: number | null; machine: string; material: string; sheet: string; copies: number; sheets: number; kerf: number; commonLine: boolean; estimate: string; test: boolean; mo: string | null; printedBy: string }
export function jobSheetHtml(info: SheetInfo, rows: SheetRow[], svg: string, clashes: string[]): string {
  const p = (r: SheetRow, k: keyof OpParams, unit = "") => (r.params && r.params[k] != null && !(typeof r.params[k] === "number" && Number.isNaN(r.params[k] as number)) ? `${r.params[k]}${unit}` : "—");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(info.job)} · job sheet</title><style>
body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:18mm 14mm}h1{font-size:20px;margin:0}h2{font-size:13px;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.06em;color:#555}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px 6px;text-align:left;vertical-align:middle}th{background:#f2f2f2;font-size:11px}
.sw{display:inline-block;width:14px;height:14px;border:1px solid #333;vertical-align:middle;margin-right:6px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 14px}
.grid div b{display:block;font-size:10px;color:#666;font-weight:600;text-transform:uppercase}.warn{border:2px solid #c00;padding:8px;margin:10px 0;color:#900;font-weight:600}
.bed{margin-top:6px}.bed svg{width:100%;height:auto;display:block;overflow:visible}.bed path{vector-effect:non-scaling-stroke;stroke-width:1.3px}.chk li{margin:3px 0}.foot{margin-top:14px;font-size:10px;color:#666}
@media print{button{display:none}body{margin:10mm}}</style></head><body>
<button onclick="print()" style="float:right;padding:6px 14px">Print</button>
<h1>${esc(info.job)} — ${esc(info.project)}</h1>
<div class="grid" style="margin-top:8px"><div><b>Design</b>${info.revision != null ? `v${info.revision}` : "not saved as a job yet"}</div><div><b>Machine</b>${esc(info.machine)}</div><div><b>Material</b>${esc(info.material)}</div><div><b>Sheet</b>${esc(info.sheet)}</div>
<div><b>Copies</b>${info.copies}</div><div><b>Sheets</b>${info.sheets}</div><div><b>Kerf</b>${info.kerf ? `${info.kerf} mm (already applied in the file)` : "none"}</div><div><b>Common line</b>${info.commonLine ? "yes (already applied)" : "no"}</div>
<div><b>Time</b>${esc(info.estimate)} (estimate)</div><div><b>SK Factory job</b>${esc(info.mo ?? "—")}</div><div><b>Printed</b>${new Date().toLocaleString("en-GB")}</div><div><b>By</b>${esc(info.printedBy)}</div></div>
${info.test ? `<div class="warn">MATERIAL TEST — these settings are NOT approved. Run only under the supervision of an authorised operator.</div>` : ""}
${clashes.map((c) => `<div class="warn">Colour clash: ${esc(c)}. Change a layer colour in DESIGN before running.</div>`).join("")}
<h2>Settings per colour — enter these in the machine software</h2>
<table><thead><tr><th>Colour</th><th>Layer</th><th>Operation</th><th>Power ${UNITS.power}</th><th>Speed ${UNITS.speed}</th><th>Passes</th><th>Frequency ${UNITS.freq}</th><th>Focus ${UNITS.focus}</th><th>Air</th><th>Raster</th><th>Settings</th></tr></thead><tbody>
${rows.map((r) => `<tr><td><span class="sw" style="background:${esc(r.layer.color)}"></span>${esc(r.layer.color)}</td><td>${esc(r.layer.name)}</td><td>${OP_LABEL[r.op]}</td><td>${p(r, "power")}</td><td>${p(r, "speed")}</td><td>${p(r, "passes")}</td><td>${p(r, "freq")}</td><td>${p(r, "focus")}</td><td>${r.params ? (r.params.air ? "on" : "off") : "—"}</td><td>${r.op === "raster" && r.params ? `${r.params.dpi} DPI (${lineSpacing(r.params.dpi).toFixed(3)} mm)` : ""}</td><td>${esc(r.source)}</td></tr>`).join("")}
</tbody></table>
<p style="font-size:11px;color:#444">Order on the machine: raster engraving → marking → vector engraving → scoring → kiss cuts → cuts (holes before outlines). The file is already in this order.</p>
<h2>Bed layout (origin top-left, millimetres)</h2><div class="bed">${bedPreview(svg, info.sheetSize ?? null)}</div>
<h2>Before starting — at the machine</h2><ul class="chk"><li>☐ Material matches the job, is flat and placed at the origin</li><li>☐ Focus set for this material</li><li>☐ Extraction and air assist running</li><li>☐ Settings above entered for every colour</li><li>☐ Lid closed, area clear, someone stays at the machine</li></ul>
<p class="foot">TROTAN does not control this machine. Start the job with the machine's own software and start button, following its safety procedure. Record the result in TROTAN → Produce afterwards so the material is taken out of KORTANA.</p>
</body></html>`;
}
/** The exported SVG with the bed edge and the material sheet drawn underneath, for the printed sheet only. */
function bedPreview(svg: string, sheet: { w: number; h: number } | null) {
  const body = svg.replace(/^<\?xml[^>]*>\s*/, "");
  const under = `<rect x="0" y="0" width="100%" height="100%" fill="#fff" stroke="#888" stroke-width="0.6"/>${sheet ? `<rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" fill="#f4ead8" stroke="#b08a50" stroke-width="0.6"/>` : ""}`;
  return body.replace(/(<svg[^>]*>)/, `$1${under}`);
}
export function openJobSheet(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function downloadBed(doc: Doc, placements: Placement[], tp: Toolpath, bed: { w: number; h: number }, name: string, kind: "svg" | "dxf", rasterDpi = 333) {
  const d = bedDoc(doc, placements, tp, bed, { vectorOnly: kind === "dxf" });
  if (kind === "svg") d.objects = await processImages(d.objects, rasterDpi);
  if (kind === "svg") download(`${safeName(name)}-bed.svg`, exportSvg(d), "image/svg+xml"); else download(`${safeName(name)}-bed.dxf`, exportDxf(d), "application/dxf");
}

/** Images on raster layers are sent as the processed bitmap (dithered/greyscale at the engraving DPI), which is exactly what burns. */
export async function processImages(objs: Obj[], dpi: number): Promise<Obj[]> {
  return Promise.all(objs.map(async (o) => {
    if (o.kind !== "image") return o.kind === "group" ? { ...o, children: await processImages(o.children, dpi) } : o;
    const sx = Math.hypot(o.m[0], o.m[1]), sy = Math.hypot(o.m[2], o.m[3]);
    const { url, grey } = await processedPng(o.src, o.w * sx, o.h * sy, dpi, o.proc);
    return { ...o, src: url, pxW: grey.w, pxH: grey.h };
  }));
}
