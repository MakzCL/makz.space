/* Phase 5b — barcode scanning (WH-04/05/06/08, MFG-18).
 * Scanned codes resolve to an item (its barcode, else its SKU), a batch/serial, a bin label,
 * an MO, a PO, a sales order or a transfer. Labels are Code-128 (Code set B). */
import { useEffect, useRef } from "react";
import type { DB, Job, Lot, Order, PurchaseOrder, StockItem, StockTransfer } from "./types";

export type ScanHit =
  | { kind: "item"; item: StockItem }
  | { kind: "lot"; lot: Lot; item: StockItem | undefined }
  | { kind: "bin"; location: string | null; bin: string }
  | { kind: "job"; job: Job }
  | { kind: "po"; po: PurchaseOrder }
  | { kind: "order"; order: Order }
  | { kind: "transfer"; transfer: StockTransfer }
  | { kind: "unknown"; code: string };

/** Barcode scanning and labels. Off: Skalarki works with metal and electronics and does not scan (switch back on here). */
export const SCANNING = false;

/** Bin labels encode as BIN:<bin> (the location is wherever you are working). */
export const BIN_PREFIX = "BIN:";

export function resolveCode(db: DB, raw: string): ScanHit {
  const code = raw.trim();
  const lc = code.toLowerCase();
  if (!code) return { kind: "unknown", code };
  if (code.toUpperCase().startsWith(BIN_PREFIX)) return { kind: "bin", location: null, bin: code.slice(BIN_PREFIX.length).trim() };
  const items = db.stock_items.filter((s) => !s.archived);
  const byBarcode = items.find((s) => s.barcode && s.barcode.toLowerCase() === lc);
  if (byBarcode) return { kind: "item", item: byBarcode };
  const bySku = items.find((s) => s.sku.toLowerCase() === lc);
  if (bySku) return { kind: "item", item: bySku };
  const lot = db.lots.find((l) => l.code.toLowerCase() === lc);
  if (lot) return { kind: "lot", lot, item: db.stock_items.find((s) => s.id === lot.item_id) };
  const job = db.jobs.find((j) => j.code.toLowerCase() === lc || `mo-${j.code.replace(/^#/, "").replace(/^SO-/i, "")}`.toLowerCase() === lc);
  if (job) return { kind: "job", job };
  const po = db.purchase_orders.find((p) => p.number.toLowerCase() === lc);
  if (po) return { kind: "po", po };
  const order = db.orders.find((o) => o.order_number.toLowerCase() === lc);
  if (order) return { kind: "order", order };
  const tr = db.stock_transfers.find((x) => x.number.toLowerCase() === lc);
  if (tr) return { kind: "transfer", transfer: tr };
  // supplier part numbers point at the item
  const ref = db.item_suppliers.find((r) => r.supplier_sku && r.supplier_sku.toLowerCase() === lc);
  const refItem = ref && items.find((s) => s.id === ref.item_id);
  if (refItem) return { kind: "item", item: refItem };
  return { kind: "unknown", code };
}

/** The item a hit refers to (an item, or the item of a batch/serial). */
export const hitItem = (h: ScanHit) => h.kind === "item" ? h.item : h.kind === "lot" ? h.item ?? null : null;

/* ------------------------------------------------------------- Code 128 -- */
// Bar/space widths for symbols 0..106 (Code 128 standard table).
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104, STOP = 106;

/** Code-128 B symbol values (with check digit) for printable ASCII text. */
export function code128Values(text: string): number[] {
  const vals = [START_B];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Character not allowed in a barcode: ${ch}`);
    vals.push(c - 32);
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, STOP);
  return vals;
}

/** SVG markup for a Code-128 barcode (module = narrowest bar width in px). */
export function code128Svg(text: string, { module = 2, height = 60, quiet = 10 } = {}): string {
  const widths = code128Values(text).map((v) => PATTERNS[v]).join("");
  let x = quiet * module, rects = "";
  [...widths].forEach((w, i) => {
    const px = Number(w) * module;
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${px}" height="${height}"/>`;
    x += px;
  });
  const W = x + quiet * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" shape-rendering="crispEdges"><rect width="${W}" height="${height}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

/** Barcode text for an item label: its own barcode if set, else the SKU. */
export const itemCode = (s: StockItem) => (s.barcode || s.sku).trim();

export interface Label { code: string; title: string; sub?: string }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Opens a print-ready sheet of labels (50 × 25 mm, one per page for label printers). */
export function printLabels(labels: Label[], copies = 1) {
  const w = window.open("", "_blank", "width=480,height=640");
  if (!w) return false;
  const body = labels.flatMap((l) => Array.from({ length: copies }, () => l)).map((l) => {
    let bars = "";
    try { bars = code128Svg(l.code, { module: 2, height: 64 }); } catch { bars = `<b>${esc(l.code)}</b>`; }
    return `<section><div class="t">${esc(l.title)}</div>${l.sub ? `<div class="s">${esc(l.sub)}</div>` : ""}<div class="b">${bars}</div><div class="c">${esc(l.code)}</div></section>`;
  }).join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    @page{size:50mm 25mm;margin:0} *{box-sizing:border-box} body{margin:0;font-family:system-ui,sans-serif}
    section{width:50mm;height:25mm;padding:1.2mm 2mm;page-break-after:always;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden}
    .t{font-size:8pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.s{font-size:6pt;color:#333;white-space:nowrap;overflow:hidden}
    .b{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}.b svg{max-width:100%;height:100%}.c{font:600 7pt ui-monospace,monospace;text-align:center;letter-spacing:.06em}
    @media screen{body{background:#eee;padding:12px}section{background:#fff;margin:0 auto 10px;box-shadow:0 1px 4px rgba(0,0,0,.2)}}
  </style></head><body>${body}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
  return true;
}

/* -------------------------------------------------- hardware scanners -- */
/** Handheld/USB/Bluetooth scanners type the code fast and press Enter. While `enabled`, codes
 * typed outside a text field are caught here; scans into a focused field behave as typing.
 * Only the most recently enabled listener receives a code (an open task beats the header). */
const wedgeStack: symbol[] = [];
export function useWedgeScanner(onCode: (code: string) => void, enabled = true) {
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    if (!enabled) return;
    const me = Symbol("wedge");
    wedgeStack.push(me);
    let buf = "", last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (wedgeStack[wedgeStack.length - 1] !== me) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const now = performance.now();
      if (now - last > 60) buf = "";
      last = now;
      if (e.key === "Enter") { if (buf.length >= 3) { e.preventDefault(); cb.current(buf); } buf = ""; return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buf += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); const i = wedgeStack.indexOf(me); if (i >= 0) wedgeStack.splice(i, 1); };
  }, [enabled]);
}

/** Short confirmation feedback: vibration on phones, a beep everywhere. */
export function scanFeedback(ok: boolean) {
  try { navigator.vibrate?.(ok ? 30 : [60, 40, 60]); } catch { /* not supported */ }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC(); const o = ac.createOscillator(); const g = ac.createGain();
    o.frequency.value = ok ? 1650 : 220; o.type = ok ? "sine" : "square"; g.gain.value = 0.08;
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => ac.close();
  } catch { /* no audio */ }
}
