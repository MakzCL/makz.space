import { readdir, readFile } from "node:fs/promises";
import { pool } from "./db.ts";

/** Applies migrations/NNN_*.sql in order, each in its own transaction, recording them in schema_migrations. */
export async function migrate(log = console.log) {
  await pool.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const dir = new URL("../migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const done = new Set((await pool.query("select name from schema_migrations")).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(new URL(f, dir), "utf8");
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(sql);
      await c.query("insert into schema_migrations(name) values ($1)", [f]);
      await c.query("commit");
      log(`applied ${f}`);
    } catch (e) {
      await c.query("rollback");
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    } finally { c.release(); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
