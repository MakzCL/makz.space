// CADRA drawing model and command engine. Commands are async scripts that ask for points, distances, selections and
// options; input comes from typed text (AutoCAD-style coordinates) or from the pointer. The same engine runs in the
// app and in tests (tests feed scripted input).
import { add, ang, bbox, deg, dimGeometry, dist, eid, findSnap, fmt, intersections, mirrorAcross, norm, offsetEnt, polar, rad, rotateAbout, scaleAbout, sub, transformEnt, translate, trimEnt, distTo, type Box, type Ent, type SnapKind, type V } from "./geom";

export interface Layer { name: string; color: string; visible: boolean; locked: boolean }
export interface Drawing { format: "cadra"; version: 1; units: "mm" | "in"; layers: Layer[]; current: string; ents: Ent[] }
export const newDrawing = (): Drawing => ({ format: "cadra", version: 1, units: "mm", current: "0",
  layers: [{ name: "0", color: "#ffffff", visible: true, locked: false }, { name: "Dimensions", color: "#5ec8ff", visible: true, locked: false }, { name: "Hidden", color: "#f5c85c", visible: true, locked: false }], ents: [] });

export type Input = { k: "point"; p: V } | { k: "text"; s: string; cursor?: V } | { k: "enter" } | { k: "esc" } | { k: "pick"; id: string; p: V };
type Want = { kind: "point" | "dist" | "select" | "text" | "option" | "angle"; prompt: string; base?: V; options?: string[] };
class Cancel extends Error {}

export interface Settings { ortho: boolean; snap: boolean; grid: number; osnap: boolean; osnapKinds: Set<SnapKind> }
export const defaultSettings = (): Settings => ({ ortho: false, snap: false, grid: 10, osnap: true, osnapKinds: new Set<SnapKind>(["end", "mid", "center", "quad", "int", "perp"]) });

export class Session {
  d: Drawing; sel = new Set<string>(); last: V | null = null; lastPick: V | null = null; offDist = 10; s = defaultSettings();
  log: string[] = []; prompt = "Command:"; want: Want | null = null; preview: Ent[] = []; running: string | null = null;
  private past: Drawing[] = []; private future: Drawing[] = []; private wait: ((i: Input) => void) | null = null; private queue: Input[] = [];
  onChange: () => void = () => {};
  constructor(d?: Drawing) { this.d = d ?? newDrawing(); }

  // ---------- history ----------
  commit(fn: (d: Drawing) => void) { this.past.push(structuredClone(this.d)); if (this.past.length > 200) this.past.shift(); this.future = []; const nd = structuredClone(this.d); fn(nd); this.d = nd; this.onChange(); }
  undo() { const p = this.past.pop(); if (!p) return this.say("Nothing to undo"); this.future.push(this.d); this.d = p; this.sel.clear(); this.say("Undo"); this.onChange(); }
  redo() { const f = this.future.pop(); if (!f) return this.say("Nothing to redo"); this.past.push(this.d); this.d = f; this.say("Redo"); this.onChange(); }
  get canUndo() { return this.past.length > 0; }
  say(s: string) { this.log.push(s); if (this.log.length > 300) this.log.shift(); this.onChange(); }
  addEnts(es: Ent[]) { this.commit((d) => { d.ents.push(...es); }); }
  layerOf(name: string) { return this.d.layers.find((l) => l.name === name); }
  editable(e: Ent) { const l = this.layerOf(e.layer); return !!l && l.visible && !l.locked; }

  // ---------- input ----------
  feed(i: Input) { if (this.wait) { const w = this.wait; this.wait = null; w(i); } else this.queue.push(i); }
  private next(w: Want): Promise<Input> { this.want = w; this.prompt = w.prompt; this.onChange(); const q = this.queue.shift(); if (q) return Promise.resolve(q); return new Promise((r) => (this.wait = r)); }
  /** Typed coordinates: x,y | @dx,dy | @d<angle | <angle (lock) | d (direct distance toward the cursor). */
  parsePoint(s: string, base: V | null, cursor?: V): V | null {
    const t = s.trim().replace(/\s+/g, ""); let m;
    if ((m = /^(@)?(-?[\d.]+),(-?[\d.]+)$/.exec(t))) { const p: V = [+m[2], +m[3]]; return m[1] ? (base ? add(base, p) : null) : p; }
    if ((m = /^@(-?[\d.]+)<(-?[\d.]+)$/.exec(t))) return base ? polar(base, +m[1], rad(+m[2])) : null;
    if ((m = /^(-?[\d.]+)<(-?[\d.]+)$/.exec(t))) return polar([0, 0], +m[1], rad(+m[2]));
    if ((m = /^(-?[\d.]+)$/.exec(t)) && base && cursor) { let dir = sub(cursor, base); if (this.s.ortho) dir = Math.abs(dir[0]) > Math.abs(dir[1]) ? [Math.sign(dir[0]) || 1, 0] : [0, Math.sign(dir[1]) || 1]; return add(base, ang2v(norm(dir), +m[1])); }
    return null;
  }
  /** Pointer position after ortho / object snap / grid snap. */
  constrain(p: V, base: V | null, tol: number): { p: V; snap: string | null } {
    if (this.s.osnap) { const sn = findSnap(this.d.ents.filter((e) => this.layerOf(e.layer)?.visible), p, tol, this.s.osnapKinds, base ?? undefined); if (sn) return { p: sn.p, snap: sn.kind }; }
    let q = p;
    if (this.s.snap) q = [Math.round(q[0] / this.s.grid) * this.s.grid, Math.round(q[1] / this.s.grid) * this.s.grid];
    if (this.s.ortho && base) { const d = sub(q, base); q = Math.abs(d[0]) >= Math.abs(d[1]) ? [q[0], base[1]] : [base[0], q[1]]; }
    return { p: q, snap: null };
  }
  async point(prompt: string, base: V | null = this.last, opts?: string[]): Promise<V | string | null> {
    for (;;) {
      const i = await this.next({ kind: "point", prompt, base: base ?? undefined, options: opts });
      if (i.k === "esc") throw new Cancel(); if (i.k === "enter") return null;
      if (i.k === "point" || i.k === "pick") return i.p;
      const o = opts?.find((x) => x.toLowerCase().startsWith(i.s.trim().toLowerCase()) && i.s.trim()); if (o) return o;
      const p = this.parsePoint(i.s, base, i.cursor); if (p) return p; this.say(`Invalid point: ${i.s}. Use x,y  @dx,dy  @dist<angle  or a distance.`);
    }
  }
  async pt(prompt: string, base: V | null = this.last): Promise<V | null> { const r = await this.point(prompt, base); return typeof r === "string" ? null : r; }
  async num(prompt: string, base?: V, def?: number): Promise<number | null> {
    for (;;) {
      const i = await this.next({ kind: "dist", prompt: def !== undefined ? `${prompt} <${fmt(def)}>:` : `${prompt}:`, base });
      if (i.k === "esc") throw new Cancel(); if (i.k === "enter") return def ?? null;
      if (i.k === "point" || i.k === "pick") { if (base) return dist(base, i.p); const p2 = await this.pt("Second point:", i.p); if (!p2) return null; return dist(i.p, p2); }
      const v = parseFloat(i.s); if (Number.isFinite(v)) return v; this.say(`Requires a number: ${i.s}`);
    }
  }
  /** A distance (typed number or picked point measured from base) or one of the options. */
  async distOr(prompt: string, base: V, opts: string[]): Promise<number | string | null> {
    for (;;) {
      const i = await this.next({ kind: "dist", prompt, base, options: opts });
      if (i.k === "esc") throw new Cancel(); if (i.k === "enter") return null;
      if (i.k === "point" || i.k === "pick") return dist(base, i.p);
      const o = opts.find((x) => x.toLowerCase().startsWith(i.s.trim().toLowerCase()) && i.s.trim()); if (o) return o;
      const v = parseFloat(i.s); if (Number.isFinite(v) && v > 0) return v; const p = this.parsePoint(i.s, base, i.cursor); if (p) return dist(base, p); this.say(`Requires a distance, a point or ${opts.join("/")}: ${i.s}`);
    }
  }
  async angle(prompt: string, base: V, def = 0): Promise<number | null> {
    for (;;) {
      const i = await this.next({ kind: "angle", prompt: `${prompt} <${fmt(def)}>:`, base });
      if (i.k === "esc") throw new Cancel(); if (i.k === "enter") return rad(def);
      if (i.k === "point" || i.k === "pick") return ang(sub(i.p, base));
      const v = parseFloat(i.s); if (Number.isFinite(v)) return rad(v); this.say(`Requires an angle in degrees: ${i.s}`);
    }
  }
  async textIn(prompt: string): Promise<string | null> { const i = await this.next({ kind: "text", prompt }); if (i.k === "esc") throw new Cancel(); return i.k === "text" ? i.s : null; }
  async option(prompt: string, options: string[], def: string): Promise<string> {
    for (;;) { const i = await this.next({ kind: "option", prompt: `${prompt} [${options.join("/")}] <${def}>:`, options }); if (i.k === "esc") throw new Cancel(); if (i.k !== "text") return def;
      const o = options.find((x) => x.toLowerCase().startsWith(i.s.trim().toLowerCase()) && i.s.trim()); if (o) return o; this.say(`Choose ${options.join(", ")}`); }
  }
  /** Use the current selection, or pick objects until Enter. */
  async select(prompt = "Select objects:"): Promise<Ent[]> {
    if (this.sel.size) { const es = this.d.ents.filter((e) => this.sel.has(e.id) && this.editable(e)); this.sel.clear(); return es; }
    const picked = new Set<string>();
    for (;;) {
      const i = await this.next({ kind: "select", prompt: picked.size ? `${prompt} ${picked.size} found` : prompt });
      if (i.k === "esc") throw new Cancel(); if (i.k === "enter" || (i.k === "text" && !i.s.trim())) break;
      if (i.k === "pick") { const e = this.d.ents.find((x) => x.id === i.id); if (e && this.editable(e)) picked.add(e.id); else if (e) this.say("Object is on a locked or hidden layer"); }
      else if (i.k === "text" && /^all$/i.test(i.s.trim())) this.d.ents.filter((e) => this.editable(e)).forEach((e) => picked.add(e.id));
      this.sel = new Set(picked); this.onChange();
    }
    this.sel.clear(); return this.d.ents.filter((e) => picked.has(e.id));
  }
  async pickOne(prompt: string): Promise<Ent | null> {
    for (;;) { const i = await this.next({ kind: "select", prompt }); if (i.k === "esc") throw new Cancel(); if (i.k === "enter") return null;
      if (i.k === "pick") { const e = this.d.ents.find((x) => x.id === i.id); if (e && this.editable(e)) { this.lastPick = i.p; return e; } } }
  }

  // ---------- running commands ----------
  async run(cmdline: string) {
    const [word, ...rest] = cmdline.trim().split(/\s+/); const name = ALIASES[word.toUpperCase()] ?? word.toUpperCase();
    const c = COMMANDS[name]; if (!c) { this.say(`Unknown command "${word}". Type HELP for a list.`); return; }
    this.running = name; this.say(`Command: ${name}`); this.preview = [];
    try { await c(this, rest.join(" ")); } catch (e) { if (e instanceof Cancel) this.say("*Cancel*"); else this.say(`Error: ${(e as Error).message}`); }
    finally { this.running = null; this.want = null; this.prompt = "Command:"; this.preview = []; this.queue = []; this.onChange(); }
  }
  ent(e: NewEnt): Ent { return { id: eid(), layer: this.d.current, ...e } as Ent; }
}
type NewEnt = Ent extends infer E ? (E extends Ent ? Omit<E, "id" | "layer"> & { layer?: string } : never) : never;
const ang2v = (dir: V, d: number): V => [dir[0] * d, dir[1] * d];

type Cmd = (s: Session, args: string) => Promise<void>;
export const ALIASES: Record<string, string> = { L: "LINE", PL: "PLINE", C: "CIRCLE", A: "ARC", REC: "RECTANG", POL: "POLYGON", T: "TEXT", DT: "TEXT", DLI: "DIMLINEAR", DAL: "DIMALIGNED", DRA: "DIMRADIUS", DDI: "DIMDIAMETER",
  M: "MOVE", CO: "COPY", CP: "COPY", RO: "ROTATE", SC: "SCALE", MI: "MIRROR", O: "OFFSET", TR: "TRIM", E: "ERASE", H: "HATCH", X: "EXPLODE", LA: "LAYER", U: "UNDO", DI: "DIST", F: "FILLET" };
export const COMMANDS: Record<string, Cmd> = {
  async LINE(s) {
    let a = await s.pt("Specify first point:", null); if (!a) return; const first = a; let n = 0;
    for (;;) {
      s.last = a; const r = await s.point(n >= 2 ? "Specify next point or [Close/Undo]:" : "Specify next point or [Undo]:", a, n >= 2 ? ["Close", "Undo"] : ["Undo"]);
      if (r === null) return; if (r === "Close") { s.addEnts([s.ent({ t: "line", a, b: first })]); return; }
      if (r === "Undo") { if (n) { s.undo(); n--; const l = s.d.ents[s.d.ents.length - 1]; a = l?.t === "line" && n ? l.b : first; } continue; }
      s.addEnts([s.ent({ t: "line", a, b: r as V })]); a = r as V; n++;
    }
  },
  async PLINE(s) {
    const pts: V[] = []; const p0 = await s.pt("Specify start point:", null); if (!p0) return; pts.push(p0);
    for (;;) { s.last = pts[pts.length - 1]; const r = await s.point("Specify next point or [Close/Undo]:", s.last, ["Close", "Undo"]);
      if (r === null || r === "Close") { if (pts.length > 1) s.addEnts([s.ent({ t: "poly", pts, closed: r === "Close" })]); return; }
      if (r === "Undo") { if (pts.length > 1) pts.pop(); continue; } pts.push(r as V); s.preview = [s.ent({ t: "poly", pts: [...pts], closed: false })]; }
  },
  async CIRCLE(s) {
    const r0 = await s.point("Specify center point for circle or [2P]:", null, ["2P"]); if (!r0) return;
    if (r0 === "2P") { const a = await s.pt("Specify first end point of diameter:", null); if (!a) return; const b = await s.pt("Specify second end point of diameter:", a); if (!b) return; s.addEnts([s.ent({ t: "circle", c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r: dist(a, b) / 2 })]); return; }
    const c = r0 as V; s.last = c; const o = await s.distOr("Specify radius of circle or [Diameter]:", c, ["Diameter"]);
    let r: number | null;
    if (o === "Diameter") { const dd = await s.num("Specify diameter of circle", c); r = dd === null ? null : dd / 2; } else r = typeof o === "number" ? o : null;
    if (r && r > 0) s.addEnts([s.ent({ t: "circle", c, r })]);
  },
  async ARC(s) { // three points
    const a = await s.pt("Specify start point of arc:", null); if (!a) return; const b = await s.pt("Specify second point of arc:", a); if (!b) return; const e = await s.pt("Specify end point of arc:", b); if (!e) return;
    const arc = arc3(a, b, e); if (!arc) return s.say("The three points are in a line: no arc"); s.addEnts([s.ent({ t: "arc", ...arc })]);
  },
  async RECTANG(s) {
    const a = await s.pt("Specify first corner point:", null); if (!a) return; s.last = a; const b = await s.pt("Specify other corner point (or @width,height):", a); if (!b) return;
    s.addEnts([s.ent({ t: "poly", pts: [a, [b[0], a[1]], b, [a[0], b[1]]], closed: true })]);
  },
  async POLYGON(s) {
    const n = await s.num("Enter number of sides", undefined, 6); if (!n || n < 3 || n > 1024 || n % 1) return s.say("Requires a whole number from 3 to 1024");
    const c = await s.pt("Specify center of polygon:", null); if (!c) return; const r = await s.num("Specify radius of circle (inscribed)", c); if (!r) return;
    s.addEnts([s.ent({ t: "poly", pts: Array.from({ length: n }, (_, i) => polar(c, r, Math.PI / 2 + (2 * Math.PI * i) / n)), closed: true })]);
  },
  async TEXT(s) {
    const p = await s.pt("Specify start point of text:", null); if (!p) return; const h = await s.num("Specify height", p, 2.5); if (!h) return; const r = await s.angle("Specify rotation angle of text", p, 0); const t = await s.textIn("Enter text:"); if (!t) return;
    s.addEnts([s.ent({ t: "text", p, h, s: t, rot: r ?? 0 })]);
  },
  DIMLINEAR: (s) => dimCmd(s, "linear"), DIMALIGNED: (s) => dimCmd(s, "aligned"),
  DIMRADIUS: (s) => radDim(s, "radius"), DIMDIAMETER: (s) => radDim(s, "diameter"),
  async MOVE(s) { await xform(s, false, async (base) => { const t = await s.pt("Specify second point or displacement:", base); return t ? { f: translate(sub(t, base)) } : null; }); },
  async COPY(s) {
    const es = await s.select(); if (!es.length) return; const base = await s.pt("Specify base point:", null); if (!base) return;
    for (;;) { s.last = base; const t = await s.pt("Specify second point or <exit>:", base); if (!t) return; const f = translate(sub(t, base)); s.addEnts(es.map((e) => ({ ...transformEnt(e, f), id: eid() }))); }
  },
  async ROTATE(s) { await xform(s, false, async (base) => { const a = await s.angle("Specify rotation angle", base, 0); return a === null ? null : { f: rotateAbout(base, a), o: { rot: a } }; }); },
  async SCALE(s) { await xform(s, false, async (base) => { const k = await s.num("Specify scale factor", base); return k && k > 0 ? { f: scaleAbout(base, k), o: { k } } : null; }); },
  async MIRROR(s) {
    const es = await s.select(); if (!es.length) return; const a = await s.pt("Specify first point of mirror line:", null); if (!a) return; const b = await s.pt("Specify second point of mirror line:", a); if (!b) return;
    const keep = await s.option("Erase source objects?", ["Yes", "No"], "No"); const f = mirrorAcross(a, b);
    const out = es.map((e) => ({ ...transformEnt(e, f, { flip: true }), id: keep === "Yes" ? e.id : eid() }));
    s.commit((d) => { if (keep === "Yes") d.ents = d.ents.map((e) => out.find((o) => o.id === e.id) ?? e); else d.ents.push(...out); });
  },
  async OFFSET(s) {
    const d = await s.num("Specify offset distance", undefined, s.offDist); if (!d || d <= 0) return; s.offDist = d;
    for (;;) { const e = await s.pickOne("Select object to offset or <exit>:"); if (!e) return; const side = await s.pt("Specify point on side to offset:", null); if (!side) return;
      const o = offsetEnt(e, d, side); if (o) s.addEnts([o]); else s.say("Cannot offset that object"); }
  },
  async TRIM(s) {
    s.say("Current settings: cutting edges = all objects");
    for (;;) {
      const i = await s.pickOne("Select object to trim or <exit>:"); if (!i) return;
      const out = trimEnt(i, s.d.ents.filter((e) => e.id !== i.id && s.layerOf(e.layer)?.visible), s.lastPick ?? polarMid(i));
      if (!out) { s.say("No cutting edge crosses that object: nothing to trim"); continue; }
      s.commit((d) => { d.ents = d.ents.filter((e) => e.id !== i.id).concat(out); });
    }
  },
  async ERASE(s) { const es = await s.select(); if (!es.length) return; const ids = new Set(es.map((e) => e.id)); s.commit((d) => { d.ents = d.ents.filter((e) => !ids.has(e.id)); }); s.say(`${es.length} object(s) erased`); },
  async HATCH(s) {
    const e = await s.pickOne("Select a closed boundary (closed polyline, rectangle, polygon or circle):"); if (!e) return;
    const pts = e.t === "poly" && e.closed ? e.pts : e.t === "circle" ? Array.from({ length: 72 }, (_, i) => polar(e.c, e.r, (2 * Math.PI * i) / 72)) : null;
    if (!pts) return s.say("That boundary is not closed"); s.addEnts([s.ent({ t: "hatch", pts: [...pts] })]);
  },
  async EXPLODE(s) {
    const es = (await s.select()).filter((e) => e.t === "poly" || e.t === "dim"); if (!es.length) return s.say("Nothing that can be exploded");
    const ids = new Set(es.map((e) => e.id)); const out: Ent[] = [];
    for (const e of es) { if (e.t === "poly") { const P = e.pts; for (let i = 1; i < P.length; i++) out.push({ id: eid(), layer: e.layer, color: e.color, t: "line", a: P[i - 1], b: P[i] }); if (e.closed) out.push({ id: eid(), layer: e.layer, color: e.color, t: "line", a: P[P.length - 1], b: P[0] }); }
      else if (e.t === "dim") { const g = dimGeometry(e); g.lines.forEach(([a, b]) => out.push({ id: eid(), layer: e.layer, t: "line", a, b })); out.push({ id: eid(), layer: e.layer, t: "text", p: g.textAt, h: 2.5, s: g.text, rot: g.textRot }); } }
    s.commit((d) => { d.ents = d.ents.filter((e) => !ids.has(e.id)).concat(out); }); s.say(`${es.length} exploded into ${out.length} objects`);
  },
  async FILLET(s) { // radius 0 corner (join two lines at their intersection), the common drafting use
    const a = await s.pickOne("Select first line:"); if (!a || a.t !== "line") return; const b = await s.pickOne("Select second line:"); if (!b || b.t !== "line") return;
    const [x] = intersectLines(a.a, a.b, b.a, b.b); if (!x) return s.say("Lines are parallel");
    const keepFar = (l: typeof a): typeof a => (dist(l.a, x) > dist(l.b, x) ? { ...l, b: x } : { ...l, a: x });
    s.commit((d) => { d.ents = d.ents.map((e) => (e.id === a.id ? keepFar(a) : e.id === b.id ? keepFar(b) : e)); });
  },
  async LAYER(s, args) {
    const name = args.trim() || (await s.textIn(`Current layer "${s.d.current}". Enter layer name to make current (new names are created):`))?.trim(); if (!name) return;
    s.commit((d) => { if (!d.layers.some((l) => l.name === name)) d.layers.push({ name, color: PALETTE[d.layers.length % PALETTE.length], visible: true, locked: false }); d.current = name; }); s.say(`Current layer: ${name}`);
  },
  async DIST(s) { const a = await s.pt("Specify first point:", null); if (!a) return; const b = await s.pt("Specify second point:", a); if (!b) return; s.say(`Distance = ${fmt(dist(a, b), 4)},  Angle = ${fmt(deg(ang(sub(b, a))), 2)}°,  Delta X = ${fmt(b[0] - a[0], 4)},  Delta Y = ${fmt(b[1] - a[1], 4)}`); },
  async UNDO(s) { s.undo(); }, async REDO(s) { s.redo(); },
  async HELP(s) { s.say(`Commands: ${Object.keys(COMMANDS).sort().join(", ")}. Aliases: ${Object.entries(ALIASES).map(([k, v]) => `${k}=${v}`).join(" ")}`); },
};
const PALETTE = ["#ff5d4f", "#3fcf8e", "#5ec8ff", "#f5c85c", "#c9a2ff", "#ff9ad5", "#ffffff"];
const polarMid = (e: Ent): V => { const b = bbox(e); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
function intersectLines(a: V, b: V, c: V, d: V): V[] { return intersections({ id: "", layer: "", t: "line", a, b }, { id: "", layer: "", t: "line", a: c, b: d }).length ? intersections({ id: "", layer: "", t: "line", a, b }, { id: "", layer: "", t: "line", a: c, b: d }) : infX(a, b, c, d); }
function infX(a: V, b: V, c: V, d: V): V[] { const r = sub(b, a), q = sub(d, c), den = r[0] * q[1] - r[1] * q[0]; if (Math.abs(den) < 1e-12) return []; const u = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den; return [add(a, [r[0] * u, r[1] * u])]; }
/** Circle arc through three points (CCW from start to end via the middle point). */
export function arc3(a: V, b: V, c: V): { c: V; r: number; a0: number; a1: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])); if (Math.abs(d) < 1e-12) return null;
  const A = a[0] ** 2 + a[1] ** 2, B = b[0] ** 2 + b[1] ** 2, C = c[0] ** 2 + c[1] ** 2;
  const ctr: V = [(A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d, (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d];
  const t0 = ang(sub(a, ctr)), t1 = ang(sub(b, ctr)), t2 = ang(sub(c, ctr)); const ccw = d > 0; // orientation of a→b→c
  return ccw ? { c: ctr, r: dist(a, ctr), a0: t0, a1: t2 } : { c: ctr, r: dist(a, ctr), a0: t2, a1: t0 }; void t1;
}
async function xform(s: Session, _copy: boolean, get: (base: V) => Promise<{ f: (p: V) => V; o?: { rot?: number; k?: number } } | null>) {
  const es = await s.select(); if (!es.length) return; const base = await s.pt("Specify base point:", null); if (!base) return; s.last = base;
  const r = await get(base); if (!r) return; const ids = new Map(es.map((e) => [e.id, transformEnt(e, r.f, r.o)]));
  s.commit((d) => { d.ents = d.ents.map((e) => ids.get(e.id) ?? e); }); s.say(`${es.length} object(s) changed`);
}
async function dimCmd(s: Session, mode: "linear" | "aligned") {
  const p1 = await s.pt("Specify first extension line origin:", null); if (!p1) return; const p2 = await s.pt("Specify second extension line origin:", p1); if (!p2) return;
  const at = await s.pt("Specify dimension line location:", p2); if (!at) return;
  let kind: "aligned" | "horizontal" | "vertical" = "aligned";
  if (mode === "linear") { const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2; kind = Math.abs(at[1] - my) * Math.abs(p2[0] - p1[0] || 1e-9) >= Math.abs(at[0] - mx) * Math.abs(p2[1] - p1[1] || 1e-9) ? "horizontal" : "vertical"; }
  const lay = s.layerOf("Dimensions") ? "Dimensions" : s.d.current; const dm = s.ent({ t: "dim", kind, p1, p2, at, layer: lay }); s.addEnts([dm]); s.say(`Dimension text = ${dimGeometry(dm as never).text}`);
}
async function radDim(s: Session, kind: "radius" | "diameter") {
  const e = await s.pickOne("Select arc or circle:"); if (!e || (e.t !== "circle" && e.t !== "arc")) return s.say("Select an arc or a circle");
  const at = await s.pt("Specify dimension line location:", e.c); if (!at) return; const dir = ang(sub(at, e.c));
  const lay = s.layerOf("Dimensions") ? "Dimensions" : s.d.current; const dm = s.ent({ t: "dim", kind, p1: e.c, p2: polar(e.c, e.r, dir), at, layer: lay }); s.addEnts([dm]); s.say(`Dimension text = ${dimGeometry(dm as never).text}`);
}
export { distTo, type Box };
