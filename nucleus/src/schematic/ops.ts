// Schematic editing operations. Pure: every function returns a new Project.
import type { Label, Part, Project, Pt, Wire } from "../core/types";
import { device } from "../library/devices";
import { eq, onSeg, pinsOf, segs } from "../core/geom";
import { uid } from "../core/project";

const touch = (pr: Project): Project => ({ ...pr, modified: new Date().toISOString() });
/** Lowest free number for a prefix: R1, R2… (gaps are reused). */
export function nextRef(pr: Project, prefix: string, taken = new Set(pr.parts.map((p) => p.ref))): string {
  for (let i = 1; ; i++) if (!taken.has(`${prefix}${i}`)) return `${prefix}${i}`;
}
export function addPart(pr: Project, devId: string, sheet: string, at: Pt, rot: Part["rot"] = 0, mirror = false): { pr: Project; id: string } {
  const d = device(devId);
  const p: Part = { id: uid("c"), ref: nextRef(pr, d.prefix), device: d.id, sheet, at, rot, mirror, props: { ...d.defaults } };
  if (d.interactive === "switch") p.state = { closed: false };
  if (d.interactive === "pot") p.state = { position: 0.5 };
  return { pr: touch({ ...pr, parts: [...pr.parts, p] }), id: p.id };
}
/** Re-number references per prefix in reading order (top-to-bottom, left-to-right). */
export function annotate(pr: Project, all = false): Project {
  const order = [...pr.parts].sort((a, b) => a.sheet.localeCompare(b.sheet) || a.at[1] - b.at[1] || a.at[0] - b.at[0]);
  const taken = new Set<string>(); const keep = new Set<string>();
  if (!all) for (const p of order) if (/^[A-Za-z]+\d+$/.test(p.ref) && !taken.has(p.ref)) { taken.add(p.ref); keep.add(p.id); } // first holder keeps a duplicated reference
  const next = new Map<string, string>();
  for (const p of order) { if (keep.has(p.id)) continue; const r = nextRef(pr, device(p.device).prefix, taken); taken.add(r); next.set(p.id, r); }
  return touch({ ...pr, parts: pr.parts.map((p) => (next.has(p.id) ? { ...p, ref: next.get(p.id)! } : p)) });
}
/** Remove zero-length segments and merge collinear runs. */
export function normalize(pts: Pt[]): Pt[] {
  const o: Pt[] = [];
  for (const p of pts) { if (o.length && eq(o[o.length - 1], p)) continue; o.push([p[0], p[1]]); }
  for (let i = o.length - 2; i >= 1; i--) { const [a, b, c] = [o[i - 1], o[i], o[i + 1]]; if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) o.splice(i, 1); }
  return o;
}
export function addWire(pr: Project, sheet: string, pts: Pt[]): { pr: Project; id: string | null } {
  const n = normalize(pts); if (n.length < 2) return { pr, id: null };
  const w: Wire = { id: uid("w"), sheet, pts: n };
  return { pr: touch({ ...pr, wires: [...pr.wires, w] }), id: w.id };
}
/** Move a wire end to `to`, keeping the wire orthogonal by adding an elbow. */
function dragEnd(w: Wire, which: 0 | 1, to: Pt): Wire {
  const pts = which === 0 ? [...w.pts].reverse() : [...w.pts];
  const n = pts[pts.length - 2], e = pts[pts.length - 1];
  const horizontal = n[1] === e[1];
  pts[pts.length - 1] = to;
  if (to[0] !== n[0] && to[1] !== n[1]) pts.splice(pts.length - 1, 0, horizontal ? [to[0], n[1]] : [n[0], to[1]]);
  const out = normalize(pts);
  return { ...w, pts: which === 0 ? out.reverse() : out };
}
/** Apply a change to parts; wire ends that sat on their pins follow (rubber-banding). Selected wires move whole. */
function withRubberBand(pr: Project, ids: Set<string>, change: (p: Part) => Part, moveWires: Set<string>, dx = 0, dy = 0): Project {
  const before = new Map<string, Pt>(); // "x,y|sheet" of every moving pin → new position
  const moved = pr.parts.map((p) => {
    if (!ids.has(p.id)) return p;
    const np = change(p);
    const a = pinsOf(p), b = pinsOf(np);
    a.forEach((pin, i) => before.set(`${p.sheet}|${pin.at[0]},${pin.at[1]}`, b[i].at));
    return np;
  });
  const wires = pr.wires.map((w) => {
    if (moveWires.has(w.id)) return { ...w, pts: w.pts.map(([x, y]) => [x + dx, y + dy] as Pt) };
    let out = w;
    const e0 = before.get(`${w.sheet}|${w.pts[0][0]},${w.pts[0][1]}`), e1 = before.get(`${w.sheet}|${w.pts[w.pts.length - 1][0]},${w.pts[w.pts.length - 1][1]}`);
    if (e0) out = dragEnd(out, 0, e0);
    if (e1) out = dragEnd(out, 1, e1);
    return out;
  }).filter((w) => w.pts.length >= 2);
  return touch({ ...pr, parts: moved, wires });
}
export function moveItems(pr: Project, sel: Set<string>, dx: number, dy: number): Project {
  const labels = pr.labels.map((l) => (sel.has(l.id) ? { ...l, at: [l.at[0] + dx, l.at[1] + dy] as Pt } : l));
  const probes = pr.probes.map((l) => (sel.has(l.id) ? { ...l, at: [l.at[0] + dx, l.at[1] + dy] as Pt } : l));
  const notes = pr.notes.map((l) => (sel.has(l.id) ? { ...l, at: [l.at[0] + dx, l.at[1] + dy] as Pt } : l));
  const wiresSel = new Set(pr.wires.filter((w) => sel.has(w.id)).map((w) => w.id));
  return withRubberBand({ ...pr, labels, probes, notes }, sel, (p) => ({ ...p, at: [p.at[0] + dx, p.at[1] + dy] }), wiresSel, dx, dy);
}
export const rotateParts = (pr: Project, sel: Set<string>, ccw = true) =>
  withRubberBand({ ...pr, labels: pr.labels.map((l) => (sel.has(l.id) ? { ...l, rot: (((l.rot + (ccw ? 90 : 270)) % 360) as Label["rot"]) } : l)) }, sel, (p) => ({ ...p, rot: (((p.rot + (ccw ? 90 : 270)) % 360) as Part["rot"]) }), new Set());
export const mirrorParts = (pr: Project, sel: Set<string>) => withRubberBand(pr, sel, (p) => ({ ...p, mirror: !p.mirror }), new Set());
export function deleteItems(pr: Project, sel: Set<string>): Project {
  return touch({ ...pr, parts: pr.parts.filter((p) => !sel.has(p.id)), wires: pr.wires.filter((w) => !sel.has(w.id)), labels: pr.labels.filter((l) => !sel.has(l.id)),
    notes: pr.notes.filter((n) => !sel.has(n.id)), probes: pr.probes.filter((n) => !sel.has(n.id)), instruments: pr.instruments });
}
export function setProps(pr: Project, id: string, patch: Partial<Part["props"]>, ref?: string): Project {
  return touch({ ...pr, parts: pr.parts.map((p) => (p.id === id ? { ...p, ref: ref ?? p.ref, props: Object.fromEntries(Object.entries({ ...p.props, ...patch }).filter(([, v]) => v !== undefined)) as Record<string, string> } : p)) });
}
export function setState(pr: Project, id: string, state: Part["state"]): Project {
  return touch({ ...pr, parts: pr.parts.map((p) => (p.id === id ? { ...p, state: { ...p.state, ...state } } : p)) });
}
export function addLabel(pr: Project, l: Omit<Label, "id">): { pr: Project; id: string } { const n = { ...l, id: uid("l") }; return { pr: touch({ ...pr, labels: [...pr.labels, n] }), id: n.id }; }
/** Copy items (parts get fresh references), offset by d. */
export function duplicate(pr: Project, sel: Set<string>, d: Pt): { pr: Project; ids: string[] } {
  const ids: string[] = []; let out = pr; const taken = new Set(pr.parts.map((p) => p.ref));
  const parts = pr.parts.filter((p) => sel.has(p.id)).map((p) => { const ref = nextRef(out, device(p.device).prefix, taken); taken.add(ref); const n = { ...structuredClone(p), id: uid("c"), ref, at: [p.at[0] + d[0], p.at[1] + d[1]] as Pt }; ids.push(n.id); return n; });
  const wires = pr.wires.filter((w) => sel.has(w.id)).map((w) => { const n = { ...w, id: uid("w"), pts: w.pts.map(([x, y]) => [x + d[0], y + d[1]] as Pt) }; ids.push(n.id); return n; });
  const labels = pr.labels.filter((l) => sel.has(l.id)).map((l) => { const n = { ...l, id: uid("l"), at: [l.at[0] + d[0], l.at[1] + d[1]] as Pt }; ids.push(n.id); return n; });
  out = touch({ ...pr, parts: [...pr.parts, ...parts], wires: [...pr.wires, ...wires], labels: [...pr.labels, ...labels] });
  return { pr: out, ids };
}
/** Split wires where a new wire end lands on their interior (keeps the drawing tidy; connectivity is the same). */
export function wireHit(pr: Project, sheet: string, p: Pt): string | null {
  for (const w of pr.wires) if (w.sheet === sheet && segs(w.pts).some(([a, b]) => onSeg(p, a, b))) return w.id;
  return null;
}
