// CorelDRAW drawing (read by @sk/formats readCdr) → TROTAN objects and layers.
// Colours become layers the same way as SVG import: outline colour → a "Line" layer (cut by default),
// fill-only shapes → a "Fill" layer (raster by default). Groups are kept. Only page 1 is imported;
// the review dialog lists what was skipped before anything is added.
import { I, uid, type Layer, type Mat, type Obj, type OpType, type SubPath } from "./core";
import type { ImportResult } from "./svg";
import type { CdrDocument, CdrNode } from "../../../../packages/sk-formats/src/cdr.ts";
import { cdrRelease } from "../../../../packages/sk-formats/src/detect.ts";

const SKIP_TEXT: Record<string, string> = {
  "artistic text": "artistic text objects (convert text to curves in CorelDRAW before saving)",
  "paragraph text": "paragraph text objects (convert text to curves in CorelDRAW before saving)",
  bitmaps: "bitmaps (export them as PNG and import separately)",
  "embedded OLE objects": "embedded OLE objects (spreadsheets, charts and the like)",
};

export function cdrToImport(doc: CdrDocument): ImportResult {
  const warnings: string[] = [];
  const page = doc.pages[0];
  if (!page) throw new Error("The CorelDRAW file has no page with drawable objects.");
  if (doc.pages.length > 1) warnings.push(`The file has ${doc.pages.length} pages; page 1 was imported.`);
  const layers = new Map<string, Layer>();
  const layerFor = (color: string | null, filled: boolean): Layer => {
    const key = color ? `${color}|${filled ? "f" : "s"}` : "none";
    let l = layers.get(key);
    if (!l) {
      l = color
        ? { id: uid("L"), name: `${filled ? "Fill" : "Line"} ${color}`, color, visible: true, locked: false, op: (filled ? "raster" : "cut") as OpType }
        : { id: uid("L"), name: "No outline or fill", color: "#9aa0a6", visible: true, locked: false, op: "none" };
      layers.set(key, l);
    }
    return l;
  };
  let unfilledGradients = 0, transparent = 0, spot = 0;
  const conv = (n: CdrNode): Obj | null => {
    if (n.kind === "group") {
      const children = n.children.map(conv).filter((o): o is Obj => !!o);
      if (!children.length) return null;
      if (children.length === 1) return children[0];
      return { id: uid(), layer: children[0].layer, kind: "group", m: [...I] as Mat, children };
    }
    const stroke = n.outline?.color.hex ?? null;
    const fill = n.fill ? (n.fill.type === "solid" && n.fill.color ? n.fill.color.hex : "#808080") : null;
    if (n.fill && n.fill.type !== "solid") unfilledGradients++;
    if (n.opacity < 1) transparent++;
    if (n.fill?.color?.approx === "spot-palette-unresolved" || n.outline?.color.approx === "spot-palette-unresolved") spot++;
    const filled = !stroke && !!fill;
    const l = layerFor(stroke ?? fill, filled);
    const paths: SubPath[] = n.paths.map((p) => ({ start: p.start, closed: p.closed, segs: p.segs.map((g) => (g.k === "L" ? { k: "L" as const, p: g.p } : { k: "C" as const, c1: g.c1, c2: g.c2, p: g.p })) }));
    return { id: uid(), layer: l.id, kind: "path", m: [...I] as Mat, paths, name: n.source };
  };
  const objects: Obj[] = [];
  for (const layer of page.layers) for (const n of layer.objects) { const o = conv(n); if (o) objects.push(o); }
  for (const [what, count] of Object.entries(doc.skipped)) warnings.push(`Skipped ${count} × ${SKIP_TEXT[what] ?? what}.`);
  if (unfilledGradients) warnings.push(`${unfilledGradients} shape(s) have gradient, pattern or texture fills; their outlines were imported and they were placed on a grey fill layer.`);
  if (spot) warnings.push(`${spot} shape(s) use spot (palette) colours, which need the palette's licence to convert; they were placed on a grey layer.`);
  if (transparent) warnings.push(`${transparent} shape(s) have transparency; TROTAN imports them as opaque.`);
  for (const w of doc.warnings) if (!w.startsWith("Text is not imported")) warnings.push(w);
  if (!objects.length) warnings.push("No drawable geometry was found.");
  return { objects, layers: [...layers.values()], width: page.width, height: page.height, warnings: [`Read as ${cdrRelease(Math.floor(doc.version / 100))} (${doc.container === "zip" ? "ZIP container" : "RIFF"}).`, ...warnings] };
}
