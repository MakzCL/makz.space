// TROTAN data layer: its own tables, read through the shared Supabase client (same sign-in), with
// live updates. Design documents are only loaded when a project is opened.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Backend } from "../lib/backend";
import { useStore } from "../lib/store";
import type { Doc, OpType } from "./geom/core";
import type { Issue, MachineCaps, OpParams, Placement } from "./geom/laser";

export type Section = "manage" | "design" | "prepare" | "produce" | "admin" | "approve";
export const SECTIONS: Section[] = ["manage", "design", "prepare", "produce", "admin", "approve"];
export interface ProjectRow { id: string; number: string; name: string; customer: string; notes: string; tags: string[]; template: boolean; mo_job_id: string | null; version: number; archived: boolean; created_by: string | null; created_at: string; updated_by: string | null; updated_at: string }
export interface MachineRow { id: string; name: string; adapter: "virtual" | "none"; manufacturer: string; model: string; caps: MachineCaps; prohibited: string[]; status: "idle" | "busy" | "offline"; active: boolean; notes: string; created_at: string }
export interface MaterialRow { id: string; name: string; category: string; supplier: string; thickness_mm: number | null; sheet_w: number | null; sheet_h: number | null; stock_item_id: string | null; notes: string; archived: boolean; created_at: string }
export type ProfileStatus = "untested" | "testing" | "approved" | "retired";
export interface ProfileRow { id: string; material_id: string; machine_id: string; operation: Exclude<OpType, "none">; version: number; params: OpParams; status: ProfileStatus; approved_by: string | null; approved_at: string | null; notes: string; created_by: string | null; created_at: string }
export type JobStatus = "draft" | "ready" | "queued" | "running" | "done" | "failed" | "cancelled";
export interface JobRow { id: string; number: string; project_id: string; revision: number; machine_id: string; material_id: string | null; status: JobStatus; placements: Placement[]; ops: Partial<Record<OpType, OpParams>>; kerf: number; common_line: boolean; test: boolean; copies: number; sheets: number; estimate_s: number | null; validation: Issue[]; mo_job_id: string | null; position: number; qty_good: number | null; qty_scrap: number | null; actual_s: number | null; operator: string | null; error: string | null; queued_at: string | null; started_at: string | null; finished_at: string | null; created_by: string | null; created_at: string; updated_at: string }
export interface RunRow { id: string; job_id: string; machine_id: string; adapter: string; status: "running" | "done" | "failed" | "aborted"; started_by: string | null; started_at: string; finished_at: string | null; seconds: number | null; good: number | null; scrap: number | null; sheets_used: number | null; waste_sheets: number | null; notes: string; checks: { name: string; ok: boolean }[] }
export interface ReservationRow { id: string; job_id: string; stock_item_id: string; quantity: number; status: "reserved" | "consumed" | "released"; consumed: number | null; created_at: string; closed_at: string | null }
export interface AccessRow { role: string; sections: Section[] }

interface TState { mine: Section[]; projects: ProjectRow[]; machines: MachineRow[]; materials: MaterialRow[]; profiles: ProfileRow[]; jobs: JobRow[]; runs: RunRow[]; reservations: ReservationRow[]; access: AccessRow[]; ready: boolean; error: string | null }
const PROJECT_COLS = "id,number,name,customer,notes,tags,template,mo_job_id,version,archived,created_by,created_at,updated_by,updated_at";
const TABLES = { projects: ["trotan_projects", PROJECT_COLS], machines: ["trotan_machines", "*"], materials: ["trotan_materials", "*"], profiles: ["trotan_profiles", "*"], jobs: ["trotan_jobs", "*"], runs: ["trotan_runs", "*"], reservations: ["trotan_reservations", "*"], access: ["trotan_access", "role,sections"] } as const;
type Key = keyof typeof TABLES;

export const sbOf = (b: Backend) => (b as unknown as { sb: SupabaseClient }).sb;
export function errText(e: unknown) { return (e as { message?: string })?.message ?? String(e); }

interface Ctx extends TState {
  sb: SupabaseClient;
  refresh: (k?: Key) => Promise<void>;
  can: (s: Section) => boolean;
  rpc: <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>;
  loadDoc: (id: string) => Promise<{ row: ProjectRow; doc: Doc }>;
  revisions: (id: string) => Promise<{ version: number; note: string; created_by: string | null; created_at: string }[]>;
  revisionDoc: (id: string, version: number) => Promise<Doc>;
}
const C = createContext<Ctx | null>(null);
export const useT = () => { const c = useContext(C); if (!c) throw new Error("TrotanProvider missing"); return c; };

const OWNER = new Set(["boss", "developer"]);
export function TrotanProvider({ children }: { children: ReactNode }) {
  const { backend, me } = useStore();
  const sb = useMemo(() => sbOf(backend), [backend]);
  const [st, setSt] = useState<TState>({ mine: [], projects: [], machines: [], materials: [], profiles: [], jobs: [], runs: [], reservations: [], access: [], ready: false, error: null });
  const load = useCallback(async (k: Key) => {
    const [t, cols] = TABLES[k];
    let q = sb.from(t).select(cols);
    if (k === "jobs" || k === "runs") q = q.order(k === "runs" ? "started_at" : "created_at", { ascending: false }).limit(2000); // trotan_runs has no created_at
    const { data, error } = await q;
    if (error) throw error;
    setSt((s) => ({ ...s, [k]: data ?? [] }));
  }, [sb]);
  const loadMine = useCallback(async () => {
    const { data, error } = await sb.rpc("trotan_my_sections");
    if (error) throw error;
    setSt((s) => ({ ...s, mine: (data ?? []) as Section[] }));
  }, [sb]);
  const refresh = useCallback(async (k?: Key) => {
    try { await Promise.all([...(k ? [k] : (Object.keys(TABLES) as Key[])).map(load), ...(!k || k === "access" ? [loadMine()] : [])]); setSt((s) => ({ ...s, ready: true, error: null })); }
    catch (e) { setSt((s) => ({ ...s, ready: true, error: errText(e) })); }
  }, [load, loadMine]);
  useEffect(() => { refresh(); }, [refresh]);
  // live updates from other people and machines
  const pend = useRef(new Set<Key>()); const timer = useRef<number | null>(null);
  useEffect(() => {
    const ch = sb.channel("trotan-live");
    const byTable = { ...Object.fromEntries((Object.keys(TABLES) as Key[]).map((k) => [TABLES[k][0], k])), trotan_person_access: "access" } as Record<string, Key>;
    ch.on("postgres_changes", { event: "*", schema: "public" }, (p: { table: string }) => {
      const k = byTable[p.table]; if (!k) return;
      pend.current.add(k);
      if (timer.current) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { const ks = [...pend.current]; pend.current.clear(); ks.forEach((x) => refresh(x)); }, 250);
    });
    ch.subscribe();
    return () => { sb.removeChannel(ch); };
  }, [sb, refresh]);
  // what this person may do, as the server decides it (role + personal setting); the server re-checks every action
  const can = useCallback((s: Section) => !!me.active && (OWNER.has(me.role) || st.mine.includes(s)), [me, st.mine]);
  const rpc = useCallback(async <T,>(fn: string, args: Record<string, unknown>) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data as T; }, [sb]);
  const loadDoc = useCallback(async (id: string) => {
    const { data, error } = await sb.from("trotan_projects").select(`${PROJECT_COLS},doc`).eq("id", id).single();
    if (error) throw new Error(error.message);
    const { doc, ...row } = data as ProjectRow & { doc: Doc };
    return { row: row as ProjectRow, doc };
  }, [sb]);
  const revisions = useCallback(async (id: string) => {
    const { data, error } = await sb.from("trotan_revisions").select("version,note,created_by,created_at").eq("project_id", id).order("version", { ascending: false });
    if (error) throw new Error(error.message); return data ?? [];
  }, [sb]);
  const revisionDoc = useCallback(async (id: string, version: number) => {
    const { data, error } = await sb.from("trotan_revisions").select("doc").eq("project_id", id).eq("version", version).single();
    if (error) throw new Error(error.message); return (data as { doc: Doc }).doc;
  }, [sb]);
  const v = useMemo<Ctx>(() => ({ ...st, sb, refresh, can, rpc, loadDoc, revisions, revisionDoc }), [st, sb, refresh, can, rpc, loadDoc, revisions, revisionDoc]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

export const fmtTime = (s: number | null | undefined) => {
  if (s == null || !Number.isFinite(s)) return "—";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${x} s` : `${x} s`;
};
export const fmtMm = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en-GB", { maximumFractionDigits: d });
