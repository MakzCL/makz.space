// In-browser-test backend: a small PostgREST/RPC stand-in for the TROTAN e2e test. It mirrors the
// server rules the UI depends on (status machine, approval, reservation, idempotent finish). The real
// rules are tested against PostgreSQL in supabase/tests/schema.test.sql.
import { randomUUID } from "node:crypto";

export const REF = "duuvhofvfdnlkcewdtuf";
export const OWNER = "11111111-0000-0000-0000-000000000001", OPERATOR = "11111111-0000-0000-0000-000000000002";
const now = () => new Date().toISOString();
export function seed() {
  const ply = { id: randomUUID(), sku: "MAT-PLY3", name: "Plywood 3 mm sheet 400×300", kind: "material", category: "Sheet", location: "", unit: "sheet", quantity: 10, min_quantity: 0, archived: false, created_at: now() };
  const vm = { id: randomUUID(), name: "Virtual CO2 laser 600×400", adapter: "virtual", manufacturer: "TROTAN", model: "Simulator", status: "idle", active: true, notes: "", prohibited: [], created_at: now(),
    caps: { bedW: 600, bedH: 400, laserType: "co2", maxPowerW: 60, maxSpeed: 1000, maxRasterSpeed: 1000, accel: 10000, travelSpeed: 800, ops: ["cut", "score", "vengrave", "raster", "mark"], freq: null, dpi: [254, 333, 500], focus: { min: -5, max: 5 }, airAssist: true, maxPasses: 20 } };
  const pvc = { id: randomUUID(), name: "PVC / vinyl", category: "Prohibited", supplier: "", thickness_mm: null, sheet_w: null, sheet_h: null, stock_item_id: null, notes: "Releases chlorine gas", archived: false, created_at: now() };
  vm.prohibited = [pvc.id];
  return {
    profiles: [{ id: OWNER, full_name: "Test Owner", role: "boss", active: true, created_at: now(), status: "available" }, { id: OPERATOR, full_name: "Test Operator", role: "operator", active: true, created_at: now(), status: "available" }],
    stock_items: [ply], jobs: [{ id: randomUUID(), code: "MO-0042", title: "Display panels", customer: "Acme", status: "todo", priority: 2, assignees: [], route: [], stage: 0, created_at: now() }],
    trotan_access: [{ role: "manager", sections: ["manage", "design", "prepare", "produce", "admin", "approve"] }, { role: "operator", sections: ["manage", "produce"] }, { role: "office", sections: ["manage", "design", "prepare", "produce"] }],
    trotan_projects: [], trotan_revisions: [], trotan_machines: [vm], trotan_profiles: [], trotan_tests: [], trotan_jobs: [], trotan_runs: [], trotan_reservations: [], audit_log: [], stock_movements: [],
    trotan_materials: [{ id: randomUUID(), name: "Plywood 3 mm", category: "Plywood", supplier: "", thickness_mm: 3, sheet_w: 400, sheet_h: 300, stock_item_id: ply.id, notes: "", archived: false, created_at: now() }, pvc],
  };
}
const fail = (msg) => { const e = new Error(msg); e.pg = true; throw e; };
const KEYS = ["power", "speed", "freq", "passes", "focus", "dpi", "air"];
export function rpcs(D, who) {
  const ops = new Map();
  const once = (k, fn) => { if (k && ops.has(k)) return ops.get(k); const r = fn(); if (k) ops.set(k, r); return r; };
  const ALL = ["manage", "design", "prepare", "produce", "admin", "approve"];
  const this_ = {
    my_costs: ({ p_table }) => { const col = { stock_items: "avg_cost", stock_movements: "unit_cost", po_lines: "unit_cost", item_suppliers: "unit_cost", stations: "cost_per_hour", product_operations: "fixed_cost" }[p_table]; return col ? Object.fromEntries((D[p_table] ?? []).map((r) => [r.id, r[col] ?? null])) : null; },
    my_sessions: () => (D.sessions ?? []).filter((x) => x.user === who()).map(({ user, ...x }) => x),
    end_my_session: ({ p_id }) => { const i = (D.sessions ?? []).findIndex((x) => x.id === p_id && x.user === who()); if (i < 0) return false; D.sessions.splice(i, 1); return true; },
    trotan_my_sections: () => { const pr = D.profiles.find((x) => x.id === who()); if (!pr?.active) return []; if (["boss", "developer"].includes(pr.role)) return ALL;
      return D.trotan_person_access?.find((x) => x.profile_id === pr.id)?.sections ?? D.trotan_access.find((a) => a.role === pr.role)?.sections ?? []; },
    trotan_save: ({ p_project, p_base, p_doc, p_note, p_revision }) => {
      const p = D.trotan_projects.find((x) => x.id === p_project) ?? fail("Project not found");
      if (p.version !== p_base) fail(`Someone else saved this project (now version ${p.version}) — reload to see their changes`);
      if (p_doc?.format !== "trotan" || p_doc?.units !== "mm") fail("Not a valid TROTAN design");
      p.version += 1; p.doc = p_doc; p.updated_at = now();
      if (p_revision) D.trotan_revisions.push({ id: randomUUID(), project_id: p.id, version: p.version, doc: p_doc, note: p_note ?? "", created_by: who(), created_at: now() });
      return p.version;
    },
    trotan_set_profile_status: ({ p_id, p_status }) => {
      const pf = D.trotan_profiles.find((x) => x.id === p_id) ?? fail("Settings not found");
      if (p_status === "approved") for (const o of D.trotan_profiles) if (o !== pf && o.status === "approved" && o.material_id === pf.material_id && o.machine_id === pf.machine_id && o.operation === pf.operation) o.status = "retired";
      Object.assign(pf, { status: p_status }, p_status === "approved" ? { approved_by: who(), approved_at: now() } : {}); return null;
    },
    trotan_queue: ({ p_job }) => {
      const j = D.trotan_jobs.find((x) => x.id === p_job) ?? fail("Job not found");
      if (j.status !== "ready") fail(`Only a ready (validated) job can be queued — it is ${j.status}`);
      if ((j.validation ?? []).some((v) => v.level === "error")) fail("The job still has validation errors");
      if (!D.trotan_revisions.some((r) => r.project_id === j.project_id && r.version === j.revision)) fail("Save a revision of the design before queuing");
      const mt = D.trotan_materials.find((m) => m.id === j.material_id) ?? fail("Choose a material");
      if (!j.test) for (const op of Object.keys(j.ops)) {
        if (!D.trotan_profiles.some((p) => p.material_id === j.material_id && p.machine_id === j.machine_id && p.operation === op && p.status === "approved" && KEYS.every((k) => (k === "dpi" && op !== "raster") || (j.ops[op][k] ?? null) === (p.params[k] ?? null)))) fail(`No approved settings for ${op}`);
      }
      if (mt.stock_item_id && j.sheets > 0) {
        const s = D.stock_items.find((x) => x.id === mt.stock_item_id);
        const held = D.trotan_reservations.filter((r) => r.stock_item_id === s.id && r.status === "reserved" && r.job_id !== j.id).reduce((a, r) => a + r.quantity, 0);
        if (s.quantity - held < j.sheets) fail(`Not enough ${mt.name} in KORTANA`);
        D.trotan_reservations = D.trotan_reservations.filter((r) => r.job_id !== j.id);
        D.trotan_reservations.push({ id: randomUUID(), job_id: j.id, stock_item_id: s.id, quantity: j.sheets, status: "reserved", consumed: null, created_at: now(), closed_at: null });
      }
      Object.assign(j, { status: "queued", queued_at: now(), position: Math.max(0, ...D.trotan_jobs.filter((x) => x.status === "queued").map((x) => x.position)) + 1 });
      return "queued";
    },
    trotan_start: ({ p_job, p_checks, p_key }) => once(p_key, () => {
      const j = D.trotan_jobs.find((x) => x.id === p_job) ?? fail("Job not found");
      if (j.status !== "queued") fail("Only a queued job can start");
      const m = D.trotan_machines.find((x) => x.id === j.machine_id);
      if (m.status !== "idle") fail("Machine busy");
      if (!Array.isArray(p_checks) || !p_checks.length || p_checks.some((c) => c.ok !== true)) fail("Confirm every pre-run check first");
      if (m.adapter !== "virtual") fail("No validated interface");
      const r = { id: randomUUID(), job_id: j.id, machine_id: m.id, adapter: m.adapter, status: "running", started_by: who(), started_at: now(), finished_at: null, seconds: null, good: null, scrap: null, sheets_used: null, waste_sheets: null, notes: "", checks: p_checks, created_at: now() };
      D.trotan_runs.push(r); m.status = "busy"; Object.assign(j, { status: "running", started_at: now(), operator: who() }); return r.id;
    }),
    trotan_record_external: ({ p_job, p_checks, p_status, p_good, p_scrap, p_seconds, p_sheets, p_notes, p_key }) => once(p_key, () => {
      const j = D.trotan_jobs.find((x) => x.id === p_job) ?? fail("Job not found");
      if (j.status !== "queued") fail("Only a queued job can be recorded");
      const m = D.trotan_machines.find((x) => x.id === j.machine_id);
      if (m.adapter !== "none") fail("Run simulated machines from TROTAN");
      if (!Array.isArray(p_checks) || !p_checks.length || p_checks.some((c) => c.ok !== true)) fail("Confirm every check first");
      const r = { id: randomUUID(), job_id: j.id, machine_id: m.id, adapter: "none", status: "running", started_by: who(), started_at: now(), checks: p_checks, created_at: now() };
      D.trotan_runs.push(r); j.status = "running";
      return this_.trotan_finish({ p_run: r.id, p_status, p_good, p_scrap, p_seconds, p_sheets, p_notes });
    }),
    trotan_finish: ({ p_run, p_status, p_good, p_scrap, p_seconds, p_sheets, p_notes, p_key }) => once(p_key, () => {
      const r = D.trotan_runs.find((x) => x.id === p_run) ?? fail("Run not found");
      if (r.status !== "running") return r.status;
      const j = D.trotan_jobs.find((x) => x.id === r.job_id);
      const used = p_status === "done" ? (p_sheets ?? j.sheets) : (p_sheets ?? 0);
      Object.assign(r, { status: p_status, finished_at: now(), seconds: p_seconds, good: p_good, scrap: p_scrap, sheets_used: used, notes: p_notes ?? "" });
      D.trotan_machines.find((x) => x.id === r.machine_id).status = "idle";
      Object.assign(j, { status: p_status === "done" ? "done" : "failed", finished_at: now(), actual_s: p_seconds, qty_good: p_good, qty_scrap: p_scrap, error: p_status === "done" ? null : p_notes || p_status });
      const res = D.trotan_reservations.find((x) => x.job_id === j.id);
      if (res && res.status === "reserved") {
        if (used > 0) { const s = D.stock_items.find((x) => x.id === res.stock_item_id); s.quantity -= used; D.stock_movements.push({ id: randomUUID(), item_id: s.id, delta: -used, reason: "consume", source_type: "trotan_job", source_id: j.id, created_at: now() }); }
        Object.assign(res, { status: p_status === "done" || used > 0 ? "consumed" : "released", consumed: used, closed_at: now() });
      }
      return p_status;
    }),
  };
  return this_;
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** Signed-in browser context whose Supabase traffic is served from D. */
export async function context(browser, D, { user = OWNER, w = 1440, h = 900, dsf = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, serviceWorkers: "block", acceptDownloads: true });
  const exp = Math.floor(Date.now() / 1000) + 36000;
  const tok = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: user, exp, role: "authenticated", aud: "authenticated" }) + ".sig";
  const sess = { access_token: tok, refresh_token: "r", expires_at: exp, expires_in: 36000, token_type: "bearer", user: { id: user, aud: "authenticated", role: "authenticated", email: "t@x.test", app_metadata: {}, user_metadata: {} } };
  await ctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem("skf-perms-v1", "done"); sessionStorage.setItem("skf-splashed", "1"); sessionStorage.setItem("trotan-splashed", "1"); }, [`sb-${REF}-auth-token`, JSON.stringify(sess)]);
  const R = rpcs(D, () => user);
  await ctx.route("https://api.fontshare.com/**", (r) => r.abort());
  await ctx.route(`https://${REF}.supabase.co/**`, async (r) => {
    const req = r.request(), u = new URL(req.url()), method = req.method();
    const send = (x, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(x) });
    if (u.pathname.startsWith("/auth/v1/user")) return send(sess.user);
    if (u.pathname.startsWith("/auth/v1/logout")) { const sc = u.searchParams.get("scope") ?? "global"; (D.logouts ??= []).push(sc); if (sc === "others") D.sessions = (D.sessions ?? []).filter((x) => x.current || x.user !== user); return r.fulfill({ status: 204, body: "" }); }
    if (u.pathname.startsWith("/auth/")) return send({});
    const rpc = u.pathname.match(/\/rest\/v1\/rpc\/(\w+)/);
    if (rpc) { let a = {}; try { a = req.postDataJSON() ?? {}; } catch { /* none */ } const f = R[rpc[1]]; try { return send(f ? f(a) ?? null : null); } catch (e) { return send({ message: e.message, code: "P0001" }, 400); } }
    const m = u.pathname.match(/\/rest\/v1\/(\w+)/); if (!m) return send({});
    const tbl = (D[m[1]] = D[m[1]] || []);
    const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
    const filters = [...u.searchParams.entries()].filter(([k]) => !["select", "order", "limit", "on_conflict", "columns"].includes(k));
    const match = (row) => filters.every(([k, v]) => { const [op, ...rest] = v.split("."); const val = rest.join("."); if (op === "eq") return String(row[k]) === val; if (op === "like") return new RegExp("^" + val.replace(/[%*]/g, ".*") + "$").test(String(row[k])); return true; });
    let body = null; try { body = req.postDataJSON(); } catch { /* none */ }
    if (method === "POST") {
      const upsert = (req.headers()["prefer"] || "").includes("resolution=merge");
      const rows = (Array.isArray(body) ? body : [body]).map((x) => {
        if (upsert && m[1] === "trotan_access") { const ex = tbl.find((t) => t.role === x.role); if (ex) return Object.assign(ex, x); }
        const row = { id: randomUUID(), created_at: now(), updated_at: now(), ...x };
        if (m[1] === "orders") Object.assign(row, { status: "open", delivery: "not_shipped", production: "not_started", prices_include_tax: false, total_price: null, custom: {}, currency: "GBP", source: "manual", order_number: x.order_number || `SO-${String(tbl.length + 1).padStart(4, "0")}`, ...x });
        if (m[1] === "trotan_projects") Object.assign(row, { number: `TP-${String(tbl.length + 1).padStart(4, "0")}`, version: 1, archived: false, template: false, tags: [], customer: "", notes: "", mo_job_id: null, created_by: user, ...x });
        if (m[1] === "trotan_jobs") Object.assign(row, { number: `TJ-${String(tbl.length + 1).padStart(4, "0")}`, position: 0, qty_good: null, qty_scrap: null, actual_s: null, operator: null, error: null, created_by: user, ...x });
        if (m[1] === "trotan_profiles") { if (x.status === "approved") throw Object.assign(new Error("New settings cannot start as approved"), { pg: true }); Object.assign(row, { status: "untested", approved_by: null, approved_at: null, notes: "", ...x }); }
        tbl.push(row); return row;
      });
      return send(single ? rows[0] : rows, 201);
    }
    if (method === "PATCH") {
      const hit = tbl.filter(match);
      for (const row of hit) {
        if (m[1] === "trotan_jobs" && body.status && body.status !== row.status) {
          const ok = { draft: ["ready", "cancelled"], ready: ["draft", "cancelled"], queued: ["ready", "cancelled"], failed: ["ready", "cancelled"] }[row.status]?.includes(body.status);
          if (!ok) return send({ message: `A job cannot go from ${row.status} to ${body.status} here` }, 400);
          if (row.status === "queued") for (const res of D.trotan_reservations) if (res.job_id === row.id && res.status === "reserved") res.status = "released";
        }
        if (m[1] === "trotan_profiles" && row.status === "approved") return send({ message: "Approved settings are locked — save a new version" }, 400);
        Object.assign(row, body, { updated_at: now() });
      }
      return send(single ? hit[0] ?? null : hit);
    }
    if (method === "DELETE") { const keep = tbl.filter((x) => !match(x)); D[m[1]] = keep; return send([]); }
    const rows = tbl.filter(match);
    if (single) return rows.length ? send(rows[0]) : send({ message: "not found" }, 406);
    return send(rows);
  });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
