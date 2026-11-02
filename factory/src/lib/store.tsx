import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Backend } from "./backend";
import { TABLES, type DB, type Profile, type TableName } from "./types";

const EMPTY: DB = {
  profiles: [], shifts: [], breaks: [], jobs: [], work_sessions: [], participants: [], invites: [],
  issues: [], stock_items: [], absences: [], announcements: [], join_links: [],
  stations: [], station_members: [], products: [], orders: [], job_steps: [],
};

interface Ctx {
  backend: Backend;
  db: DB;
  me: Profile;
  ready: boolean;
  refresh: (t?: TableName) => Promise<void>;
  /** Optimistic local patch while the server catches up. */
  patch: <T extends TableName>(t: T, fn: (rows: DB[T]) => DB[T]) => void;
  person: (id: string | null | undefined) => Profile | undefined;
}

const StoreCtx = createContext<Ctx | null>(null);

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("StoreProvider missing");
  return c;
}

export function StoreProvider({ backend, userId, children, onMissingProfile }: {
  backend: Backend; userId: string; children: ReactNode; onMissingProfile: () => void;
}) {
  const [db, setDb] = useState<DB>(EMPTY);
  const [ready, setReady] = useState(false);
  const pending = useRef(new Set<TableName>());
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async (t?: TableName) => {
    const list = t ? [t] : TABLES;
    const results = await Promise.all(list.map((x) => backend.list(x).catch(() => null)));
    setDb((prev) => {
      const next = { ...prev };
      list.forEach((x, i) => { if (results[i]) (next as Record<string, unknown>)[x] = results[i]; });
      return next;
    });
  }, [backend]);

  useEffect(() => {
    let alive = true;
    refresh().then(() => alive && setReady(true));
    const off = backend.subscribe((t) => {
      // Coalesce bursts of changes into one fetch per table.
      pending.current.add(t);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const ts = [...pending.current]; pending.current.clear();
        ts.forEach((x) => refresh(x));
      }, 120);
    });
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; off(); document.removeEventListener("visibilitychange", onFocus); };
  }, [backend, refresh]);

  const patch = useCallback(<T extends TableName>(t: T, fn: (rows: DB[T]) => DB[T]) => {
    setDb((prev) => ({ ...prev, [t]: fn(prev[t]) }));
  }, []);

  const byId = useMemo(() => new Map(db.profiles.map((p) => [p.id, p])), [db.profiles]);
  const me = byId.get(userId);

  useEffect(() => { if (ready && !me) onMissingProfile(); }, [ready, me, onMissingProfile]);

  const value = useMemo<Ctx | null>(() => me ? ({
    backend, db, me, ready, refresh, patch, person: (id) => (id ? byId.get(id) : undefined),
  }) : null, [backend, db, me, ready, refresh, patch, byId]);

  if (!value) return <>{children}</>;
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useHasStore() { return useContext(StoreCtx) !== null; }

/** Ticks every `ms` so live timers re-render. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return now;
}
