import { createContext, useContext } from "react";
import type { DB, StockMovement } from "./types";

/** A business document a stock movement came from (INV-04 drill-through). */
export interface DocTarget { kind: "po" | "order" | "job"; id: string; label: string }

const Ctx = createContext<((d: DocTarget) => void) | null>(null);
/** Kortana provides this so references open the document; elsewhere they stay plain text. */
export const DocLinkProvider = Ctx.Provider;
export const useDocLink = () => useContext(Ctx);

/** Which document booked this movement: the stored source first, else the reference text (older entries). */
export function docOf(db: DB, m: StockMovement): DocTarget | null {
  const po = (id: string | undefined) => { const p = db.purchase_orders.find((x) => x.id === id); return p ? { kind: "po" as const, id: p.id, label: p.number } : null; };
  const order = (id: string | undefined) => { const o = db.orders.find((x) => x.id === id); return o ? { kind: "order" as const, id: o.id, label: o.order_number } : null; };
  const job = (id: string | null | undefined) => { const j = db.jobs.find((x) => x.id === id); return j ? { kind: "job" as const, id: j.id, label: j.code } : null; };
  if (m.source_type === "po_line") return po(db.po_lines.find((l) => l.id === m.source_id)?.po_id);
  if (m.source_type === "order_line") return order(db.order_lines.find((l) => l.id === m.source_id)?.order_id);
  if (m.source_type === "return") return order(db.order_returns.find((r) => r.id === m.source_id)?.order_id);
  if (m.source_type === "job" || m.job_id) return job(m.job_id ?? m.source_id);
  if (!m.ref) return null;
  return po(db.purchase_orders.find((p) => p.number === m.ref)?.id)
    ?? order(db.orders.find((o) => o.order_number === m.ref)?.id)
    ?? job(db.jobs.find((j) => j.code === m.ref)?.id);
}
