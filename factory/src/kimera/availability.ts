import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Cell } from "./status";

/** Server-side allocation (availability() in schema.sql) — the one answer everyone sees. */
export interface LineAvail { status: "in_stock" | "expected" | "not_available"; reserved: number; expected: number; short: number; date: string | null; why: string; kind: "line" | "transfer" }
export interface MoAvail { status: LineAvail["status"]; date: string | null; short: { item_id: string; short: number; why: string }[] }
export interface Avail { lines: Record<string, LineAvail>; mos: Record<string, MoAvail>; items: Record<string, { on_hand: number; reserved: number; available: number }>; at: string }

/** Re-asks the server whenever orders, stock, POs, MOs or transfers change (debounced). */
export function useAvailability(): Avail | null {
  const { db, backend: B } = useStore();
  const [av, setAv] = useState<Avail | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const tm = setTimeout(async () => {
      try { const r = await B.rpc<Avail>("availability", {}); if (n === seq.current) setAv(r); } catch { /* fall back to the in-app estimate */ }
    }, 250);
    return () => clearTimeout(tm);
  }, [B, db.orders, db.order_lines, db.stock_levels, db.jobs, db.po_lines, db.purchase_orders, db.stock_transfers, db.transfer_lines, db.bom_lines]);
  return av;
}

const LABEL = { in_stock: "In stock", expected: "Expected", not_available: "Not available" } as const;
const TONE = { in_stock: "ok", expected: "warn", not_available: "bad" } as const;

export const lineCell = (a: LineAvail, canMake: boolean): Cell =>
  ({ label: LABEL[a.status], tone: TONE[a.status], date: a.status === "expected" ? a.date : null, why: a.why, action: a.status === "not_available" && canMake ? "make" : undefined });

export const moCell = (a: MoAvail, names: Map<string, string>): Cell => ({
  label: LABEL[a.status], tone: TONE[a.status], date: a.status === "expected" ? a.date : null,
  why: a.short.length ? a.short.map((s) => `${names.get(s.item_id) ?? ""}: ${s.why}`).join("\n") : a.status === "expected" ? "Waiting for expected supply" : "All ingredients reserved",
});
