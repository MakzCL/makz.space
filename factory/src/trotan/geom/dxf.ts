// DXF import (via dxf-parser, MIT) and export (AutoCAD R12 ASCII, read by every CAD/laser tool).
// DXF has y pointing up; TROTAN has y down, so y is mirrored about the drawing's height.
import DxfParser from "dxf-parser";
import { I, arcToCubics, boxOfPaths, flatten, leaves, localPaths, transformPaths, uid, type Doc, type Layer, type Mat, type Obj, type Seg, type SubPath, type Vec } from "./core";

const UNITS: Record<number, { mm: number; name: string }> = { 1: { mm: 25.4, name: "inches" }, 2: { mm: 304.8, name: "feet" }, 4: { mm: 1, name: "mm" }, 5: { mm: 10, name: "cm" }, 6: { mm: 1000, name: "m" }, 8: { mm: 0.0000254, name: "micro-inches" }, 9: { mm: 0.0254, name: "mils" }, 10: { mm: 914.4, name: "yards" }, 14: { mm: 100, name: "decimetres" } };
export interface DxfResult { objects: Obj[]; layers: Layer[]; width: number; height: number; warnings: string[] }

/* eslint-disable @typescript-eslint/no-explicit-any */
export function importDxf(src: string): DxfResult {
  let dxf: any;
  try { dxf = new DxfParser().parseSync(src); } catch (e) { throw new Error(`Not a readable DXF file: ${(e as Error).message}`); }
  if (!dxf || !Array.isArray(dxf.entities)) throw new Error("Not a readable DXF file (no ENTITIES section)");
  const warnings: string[] = [];
  const code = dxf.header?.$INSUNITS ?? 0;
  const u = UNITS[code];
  if (!u) warnings.push(code === 0 ? "The DXF has no unit set — millimetres were assumed." : `Unknown DXF unit code ${code} — millimetres were assumed.`);
  const k = u?.mm ?? 1;
  const skipped = new Map<string, number>();
  const skip = (t: string) => skipped.set(t, (skipped.get(t) ?? 0) + 1);
  const raw: { layer: string; paths: SubPath[] }[] = [];
  const toPaths = (e: any, m: Mat): SubPath[] => {
    const P = (v: any): Vec => [v.x * m[0] + v.y * m[2] + m[4], v.x * m[1] + v.y * m[3] + m[5]];
    switch (e.type) {
      case "LINE": return [{ start: P(e.vertices[0]), segs: [{ k: "L", p: P(e.vertices[1]) }], closed: false }];
      case "LWPOLYLINE": case "POLYLINE": {
        const vs = (e.vertices ?? []).filter((v: any) => Number.isFinite(v.x)); if (vs.length < 2) return [];
        const closed = !!(e.shape || e.closed);
        const segs: Seg[] = []; const n = closed ? vs.length : vs.length - 1;
        for (let i = 0; i < n; i++) {
          const a = vs[i], b = vs[(i + 1) % vs.length], bulge = a.bulge ?? 0;
          if (Math.abs(bulge) > 1e-9) {
            const pa = P(a), pb = P(b), chord = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
            const ang = 4 * Math.atan(Math.abs(bulge)), r = chord / (2 * Math.sin(ang / 2));
            const det = m[0] * m[3] - m[1] * m[2];
            segs.push(...arcToCubics(pa, r, r, 0, ang > Math.PI, (bulge > 0) === (det > 0), pb));
          } else segs.push({ k: "L", p: P(b) });
        }
        return [{ start: P(vs[0]), segs, closed }];
      }
      case "CIRCLE": case "ARC": {
        const c = e.center, r = e.radius;
        const a0 = e.type === "CIRCLE" ? 0 : e.startAngle, a1 = e.type === "CIRCLE" ? 2 * Math.PI : e.endAngle;
        let sweep = a1 - a0; if (sweep <= 0) sweep += 2 * Math.PI;
        const pts = Math.max(4, Math.ceil(sweep / (Math.PI / 2)));
        const pt = (t: number) => P({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
        const segs: Seg[] = []; let prev = pt(a0);
        const det = m[0] * m[3] - m[1] * m[2];
        for (let i = 1; i <= pts; i++) { const t = a0 + (sweep * i) / pts, q = pt(t); segs.push(...arcToCubics(prev, r * Math.hypot(m[0], m[1]), r * Math.hypot(m[2], m[3]), 0, false, det > 0, q)); prev = q; }
        return [{ start: pt(a0), segs, closed: e.type === "CIRCLE" }];
      }
      case "ELLIPSE": {
        const c = e.center, maj = e.majorAxisEndPoint, ratio = e.axisRatio;
        const a0 = e.startAngle ?? 0; let a1 = e.endAngle ?? 2 * Math.PI; if (a1 <= a0) a1 += 2 * Math.PI;
        const pts: Vec[] = []; const n = 96;
        for (let i = 0; i <= n; i++) { const t = a0 + ((a1 - a0) * i) / n; pts.push(P({ x: c.x + maj.x * Math.cos(t) - maj.y * ratio * Math.sin(t), y: c.y + maj.y * Math.cos(t) + maj.x * ratio * Math.sin(t) })); }
        const full = Math.abs(a1 - a0 - 2 * Math.PI) < 1e-6;
        return [{ start: pts[0], segs: pts.slice(1).map((p) => ({ k: "L" as const, p })), closed: full }];
      }
      case "SPLINE": {
        const pts = (e.fitPoints?.length ? e.fitPoints : e.controlPoints ?? []).map(P);
        if (pts.length < 2) return [];
        if (!e.fitPoints?.length) skip("splines approximated through their control points");
        return [{ start: pts[0], segs: pts.slice(1).map((p: Vec) => ({ k: "L" as const, p })), closed: !!e.closed }];
      }
      default: skip(`${e.type} entities`); return [];
    }
  };
  const run = (ents: any[], m: Mat, depth: number) => {
    for (const e of ents) {
      if (e.type === "INSERT") {
        const blk = dxf.blocks?.[e.name]; if (!blk || depth > 16) { skip("block references"); continue; }
        const ang = ((e.rotation ?? 0) * Math.PI) / 180, sx = e.xScale ?? 1, sy = e.yScale ?? 1, c = Math.cos(ang), s = Math.sin(ang);
        const t: Mat = [c * sx, s * sx, -s * sy, c * sy, e.position.x, e.position.y];
        const bp = blk.position ?? { x: 0, y: 0 };
        const tm: Mat = [m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1], m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3], m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5]];
        run(blk.entities ?? [], [tm[0], tm[1], tm[2], tm[3], tm[4] - (tm[0] * bp.x + tm[2] * bp.y), tm[5] - (tm[1] * bp.x + tm[3] * bp.y)], depth + 1);
        continue;
      }
      if (e.type === "TEXT" || e.type === "MTEXT") { skip("text entities (explode text to outlines in CAD first)"); continue; }
      if (e.type === "DIMENSION" || e.type === "HATCH" || e.type === "SOLID" || e.type === "POINT") { skip(`${e.type} entities`); continue; }
      const ps = toPaths(e, m); if (ps.length) raw.push({ layer: e.layer ?? "0", paths: ps });
    }
  };
  run(dxf.entities, [k, 0, 0, k, 0, 0], 0);
  for (const [t, n] of skipped) warnings.push(`Skipped ${n} × ${t}.`);
  if (!raw.length) { warnings.push("No drawable geometry was found."); return { objects: [], layers: [], width: 100, height: 100, warnings }; }
  const box = boxOfPaths(raw.flatMap((r) => r.paths))!;
  const flip: Mat = [1, 0, 0, -1, -box.x, box.y + box.h]; // y-up → y-down, move to origin
  const layers = new Map<string, Layer>();
  const COLORS = ["#ff3b30", "#2f6bff", "#21b573", "#ff9f0a", "#bf5af2", "#00c7be"];
  const objects: Obj[] = raw.map((r) => {
    let l = layers.get(r.layer);
    if (!l) { l = { id: uid("L"), name: `DXF ${r.layer}`, color: COLORS[layers.size % COLORS.length], visible: true, locked: false, op: "cut" }; layers.set(r.layer, l); }
    return { id: uid(), layer: l.id, kind: "path", m: [...I] as Mat, paths: transformPaths(r.paths, flip) };
  });
  return { objects, layers: [...layers.values()], width: Math.max(1, box.w), height: Math.max(1, box.h), warnings };
}

/** R12 ASCII DXF in millimetres; curves are flattened to 0.01 mm; one DXF layer per TROTAN layer. */
export function exportDxf(doc: Doc, tol = 0.01): string {
  const out: string[] = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(doc.layers.length)];
  const lname = (l: Layer) => l.name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 31) || "0";
  doc.layers.forEach((l, i) => out.push("0", "LAYER", "2", lname(l), "70", "0", "62", String((i % 7) + 1), "6", "CONTINUOUS"));
  out.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  const H = doc.height, n = (v: number) => (Math.round(v * 10000) / 10000).toString();
  for (const { o, m, top } of leaves(doc.objects.filter((x) => !x.hidden))) {
    if (o.kind === "image") continue;
    const l = doc.layers.find((x) => x.id === (o.layer ?? top.layer)) ?? doc.layers[0];
    for (const pl of flatten(transformPaths(localPaths(o), m), tol)) {
      if (pl.pts.length < 2) continue;
      out.push("0", "POLYLINE", "8", lname(l), "66", "1", "70", pl.closed ? "1" : "0");
      for (const p of pl.pts) out.push("0", "VERTEX", "8", lname(l), "10", n(p[0]), "20", n(H - p[1]), "30", "0");
      out.push("0", "SEQEND");
    }
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n") + "\n";
}
