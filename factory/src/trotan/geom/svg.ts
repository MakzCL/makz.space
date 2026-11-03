// SVG import and export. Import keeps real dimensions (mm, cm, in, pt, pc, px at 96/in), applies
// nested transforms, converts every SVG shape (and arcs) into editable paths, embeds raster images
// and reports everything it could not convert. A tiny XML parser keeps this usable outside the browser.
import { I, apply, clonePaths, ellipsePaths, flatten, leaves, localPaths, mul, parsePathData, pathData, polygonPaths, rectPaths, transformPaths, uid, type Doc, type Layer, type Mat, type Obj, type OpType, type SubPath, type Vec } from "./core";

/* ------------------------------------------------------------------- XML -- */
export interface XNode { tag: string; attrs: Record<string, string>; children: XNode[]; text: string }
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
export function parseXml(src: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { stack[stack.length - 1].text += decode(src.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) { const e = src.indexOf("-->", lt); if (e < 0) throw new Error("Unclosed comment"); i = e + 3; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const e = src.indexOf("]]>", lt); if (e < 0) throw new Error("Unclosed CDATA"); stack[stack.length - 1].text += src.slice(lt + 9, e); i = e + 3; continue; }
    if (src[lt + 1] === "?" || src[lt + 1] === "!") { const e = src.indexOf(">", lt); if (e < 0) throw new Error("Broken XML declaration"); i = e + 1; continue; }
    const gt = findTagEnd(src, lt);
    if (gt < 0) throw new Error("Unclosed tag — the file is incomplete or not SVG");
    const body = src.slice(lt + 1, gt);
    if (body[0] === "/") {
      const name = body.slice(1).trim();
      while (stack.length > 1 && stack[stack.length - 1].tag !== name) stack.pop();
      if (stack.length > 1) stack.pop();
    } else {
      const self = body.endsWith("/");
      const m = /^([^\s/>]+)/.exec(body); if (!m) throw new Error("Malformed tag");
      const node: XNode = { tag: m[1], attrs: {}, children: [], text: "" };
      const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a: RegExpExecArray | null;
      const rest = body.slice(m[1].length);
      while ((a = re.exec(rest))) node.attrs[a[1]] = decode(a[3] ?? a[4] ?? "");
      stack[stack.length - 1].children.push(node);
      if (!self) stack.push(node);
    }
    i = gt + 1;
  }
  return root;
}
function findTagEnd(s: string, from: number) {
  let q: string | null = null;
  for (let i = from + 1; i < s.length; i++) { const c = s[i]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") return i; }
  return -1;
}
const local = (t: string) => t.includes(":") ? t.split(":").pop()! : t;

/* ----------------------------------------------------------------- units -- */
const PER_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, "": 25.4 / 96 };
export function lengthMm(v: string | undefined): { mm: number; unit: string } | null {
  if (!v) return null;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|%)?\s*$/i.exec(v);
  if (!m) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "%") return null;
  return { mm: Number(m[1]) * PER_MM[unit], unit };
}
const nums = (s: string) => (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
export function parseTransform(s: string | undefined): Mat {
  let m: Mat = [...I] as Mat;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = nums(r[2]); let t: Mat = [...I] as Mat;
    switch (r[1]) {
      case "matrix": if (a.length === 6) t = a as Mat; break;
      case "translate": t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]; break;
      case "scale": t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case "rotate": { const ang = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(ang), sn = Math.sin(ang), cx = a[1] ?? 0, cy = a[2] ?? 0; t = [c, sn, -sn, c, cx - c * cx + sn * cy, cy - sn * cx - c * cy]; break; }
      case "skewX": t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case "skewY": t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, t);
  }
  return m;
}
function style(n: XNode, inherited: Record<string, string>): Record<string, string> {
  const st = { ...inherited };
  for (const k of ["stroke", "fill", "display", "visibility", "opacity", "stroke-width"]) if (n.attrs[k] !== undefined) st[k] = n.attrs[k];
  for (const part of (n.attrs.style ?? "").split(";")) { const [k, v] = part.split(":").map((x) => x?.trim()); if (k && v) st[k] = v; }
  return st;
}
const NAMED: Record<string, string> = { black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", lime: "#00ff00", yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff", gray: "#808080", grey: "#808080", orange: "#ffa500" };
export function normColor(c: string | undefined): string | null {
  if (!c) return null; c = c.trim().toLowerCase();
  if (c === "none" || c === "transparent" || c.startsWith("url(")) return null;
  if (NAMED[c]) return NAMED[c];
  if (/^#[0-9a-f]{3}$/.test(c)) return "#" + c.slice(1).split("").map((x) => x + x).join("");
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const m = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c);
  if (m) return "#" + [m[1], m[2], m[3]].map((v) => Math.min(255, +v).toString(16).padStart(2, "0")).join("");
  return "#000000";
}

/* ---------------------------------------------------------------- import -- */
export interface ImportResult { objects: Obj[]; layers: Layer[]; width: number; height: number; warnings: string[] }
export function importSvg(src: string, opts: { maxObjects?: number } = {}): ImportResult {
  let root: XNode;
  try { root = parseXml(src); } catch (e) { throw new Error(`Not a valid SVG file: ${(e as Error).message}`); }
  const svg = findFirst(root, "svg");
  if (!svg) throw new Error("Not an SVG file (no <svg> element)");
  const warnings: string[] = [];
  const vb = nums(svg.attrs.viewBox ?? svg.attrs.viewbox ?? "");
  const wA = lengthMm(svg.attrs.width), hA = lengthMm(svg.attrs.height);
  let width: number, height: number, base: Mat;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    width = wA?.mm ?? vb[2] * PER_MM.px; height = hA?.mm ?? vb[3] * PER_MM.px;
    if (!wA && !hA) warnings.push("The file has no physical size; 96 px per inch was assumed (as browsers and Inkscape do).");
    if (wA && !hA) height = (vb[3] / vb[2]) * width;
    if (hA && !wA) width = (vb[2] / vb[3]) * height;
    const sx = width / vb[2], sy = height / vb[3];
    if (Math.abs(sx - sy) / Math.max(sx, sy) > 1e-3) warnings.push("viewBox and size have different aspect ratios — the drawing was stretched as the file says.");
    base = [sx, 0, 0, sy, -vb[0] * sx, -vb[1] * sy];
  } else {
    width = wA?.mm ?? 210; height = hA?.mm ?? 297;
    if (!wA || !hA) warnings.push("No viewBox or size — user units were taken as px at 96 per inch.");
    base = [PER_MM.px, 0, 0, PER_MM.px, 0, 0];
    if (wA && wA.unit && wA.unit !== "px") base = [PER_MM.px, 0, 0, PER_MM.px, 0, 0];
  }
  const ids = new Map<string, XNode>();
  (function idx(n: XNode) { if (n.attrs.id) ids.set(n.attrs.id, n); n.children.forEach(idx); })(svg);
  const layerByColor = new Map<string, Layer>();
  const layerFor = (color: string, filled: boolean): Layer => {
    const key = `${color}|${filled ? "f" : "s"}`;
    let l = layerByColor.get(key);
    if (!l) { l = { id: uid("L"), name: `${filled ? "Fill" : "Line"} ${color}`, color, visible: true, locked: false, op: (filled ? "raster" : "cut") as OpType }; layerByColor.set(key, l); }
    return l;
  };
  const objects: Obj[] = [];
  const skipped = new Map<string, number>();
  const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1);
  const max = opts.maxObjects ?? 200000;
  const walk = (n: XNode, m: Mat, st: Record<string, string>, depth: number) => {
    if (depth > 64) { skip("too deeply nested elements"); return; }
    const tag = local(n.tag);
    const s = style(n, st);
    if (s.display === "none") return;
    const mm = mul(m, parseTransform(n.attrs.transform));
    const a = (k: string) => Number(n.attrs[k] ?? 0);
    const add = (paths: SubPath[]) => {
      if (!paths.length) return;
      if (objects.length >= max) { skip("objects over the limit"); return; }
      const stroke = normColor(s.stroke), fill = normColor(s.fill ?? "#000000");
      const filled = !stroke && !!fill;
      const l = layerFor(stroke ?? fill ?? "#000000", filled);
      objects.push({ id: uid(), layer: l.id, kind: "path", m: [...I] as Mat, paths: transformPaths(paths, mm), name: n.attrs.id });
    };
    switch (tag) {
      case "svg": if (n !== svg) { skip("nested <svg>"); } break;
      case "g": case "a": case "switch": break;
      case "defs": case "metadata": case "title": case "desc": case "clipPath": case "mask": case "pattern": case "linearGradient": case "radialGradient": case "marker": case "symbol": case "filter": case "sodipodi:namedview": return;
      case "style": skip("CSS <style> rules (inline styles are used)"); return;
      case "path": try { add(parsePathData(n.attrs.d ?? "")); } catch { skip("paths with invalid data"); } return;
      case "rect": { const w = a("width"), h = a("height"); if (w <= 0 || h <= 0) return; const r = Number(n.attrs.rx ?? n.attrs.ry ?? 0); add(transformPaths(rectPaths(w, h, r), [1, 0, 0, 1, a("x"), a("y")])); return; }
      case "circle": { const r = a("r"); if (r <= 0) return; add(transformPaths(ellipsePaths(r, r), [1, 0, 0, 1, a("cx"), a("cy")])); return; }
      case "ellipse": { const rx = a("rx"), ry = a("ry"); if (rx <= 0 || ry <= 0) return; add(transformPaths(ellipsePaths(rx, ry), [1, 0, 0, 1, a("cx"), a("cy")])); return; }
      case "line": add([{ start: [a("x1"), a("y1")], segs: [{ k: "L", p: [a("x2"), a("y2")] }], closed: false }]); return;
      case "polyline": case "polygon": {
        const v = nums(n.attrs.points ?? ""); if (v.length < 4) return;
        const pts: Vec[] = []; for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
        const closed = tag === "polygon";
        add([{ start: pts[0], closed, segs: [...pts.slice(1), ...(closed ? [pts[0]] : [])].map((p) => ({ k: "L" as const, p })) }]);
        return;
      }
      case "image": {
        const href = n.attrs.href ?? n.attrs["xlink:href"] ?? "";
        const w = a("width"), h = a("height");
        if (!href.startsWith("data:image/")) { skip("linked (not embedded) images"); return; }
        if (w <= 0 || h <= 0) { skip("images without a size"); return; }
        const l = layerFor("#2f6bff", true);
        objects.push({ id: uid(), layer: l.id, kind: "image", src: href, w, h, pxW: 0, pxH: 0, m: mul(mm, [1, 0, 0, 1, a("x"), a("y")]) });
        return;
      }
      case "use": {
        const ref = (n.attrs.href ?? n.attrs["xlink:href"] ?? "").replace(/^#/, ""); const tgt = ids.get(ref);
        if (!tgt) { skip("<use> pointing at missing elements"); return; }
        walk(tgt, mul(mm, [1, 0, 0, 1, a("x"), a("y")]), s, depth + 1); return;
      }
      case "text": case "tspan": skip("text elements (convert text to outlines/paths before export)"); return;
      default: if (depth > 0) skip(`<${tag}> elements`);
    }
    for (const c of n.children) walk(c, mm, s, depth + 1);
  };
  walk(svg, base, {}, 0);
  for (const [what, n] of skipped) warnings.push(`Skipped ${n} × ${what}.`);
  if (!objects.length) warnings.push("No drawable geometry was found.");
  return { objects, layers: [...layerByColor.values()], width, height, warnings };
}
function findFirst(n: XNode, tag: string): XNode | null { if (local(n.tag) === tag) return n; for (const c of n.children) { const f = findFirst(c, tag); if (f) return f; } return null; }

/* ---------------------------------------------------------------- export -- */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const mStr = (m: Mat) => `matrix(${m.map((v) => +v.toFixed(6)).join(" ")})`;
/** Real-size SVG (mm). One group per layer; text is exported as outlines; images stay embedded. */
export function exportSvg(doc: Doc, opts: { only?: Set<string> } = {}): string {
  const parts: string[] = [];
  for (const l of doc.layers) {
    const items = leaves(doc.objects.filter((o) => (!opts.only || opts.only.has(o.id)) && !o.hidden)).filter((x) => (x.o.layer === l.id || x.top.layer === l.id));
    if (!items.length) continue;
    const body = items.map(({ o, m }) => o.kind === "image"
      ? `<image href="${esc(o.src)}" width="${o.w}" height="${o.h}" transform="${mStr(m)}" preserveAspectRatio="none"/>`
      : `<path d="${pathData(transformPaths(localPaths(o), m))}"/>`).join("\n    ");
    parts.push(`  <g id="${esc(l.id)}" data-name="${esc(l.name)}" data-operation="${l.op}" fill="none" stroke="${l.color}" stroke-width="0.1">\n    ${body}\n  </g>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}mm" height="${doc.height}mm" viewBox="0 0 ${doc.width} ${doc.height}">\n${parts.join("\n")}\n</svg>\n`;
}
export { apply, clonePaths, flatten, polygonPaths };
