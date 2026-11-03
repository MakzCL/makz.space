import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.ts";

pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz → ISO string

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL ?? 20), connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
pool.on("error", (error) => console.error("[database pool]", error.message));

/** Per-request database timing, reported in the Server-Timing header so slow paths are measurable from the client. */
export const dbTiming = new AsyncLocalStorage<{ n: number; ms: number }>();
const rawQuery = pg.Client.prototype.query as any;
(pg.Client.prototype as any).query = function (this: unknown, ...args: any[]) {
  const t = dbTiming.getStore(); const r = rawQuery.apply(this, args);
  if (!t || !r || typeof r.then !== "function") return r;
  const s = performance.now();
  return r.finally(() => { t.n++; t.ms += performance.now() - s; });
};

export type Q = { query: pg.Pool["query"] } | pg.PoolClient;

export async function q<T = any>(text: string, params: unknown[] = [], c: Q = pool): Promise<T[]> {
  const r = await c.query(text, params as any[]);
  return r.rows as T[];
}
export async function q1<T = any>(text: string, params: unknown[] = [], c: Q = pool): Promise<T | null> {
  return (await q<T>(text, params, c))[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
