import { useMemo } from "react";
import { useToast } from "../components/Toast";
import { t } from "./i18n";
import { blip, buzz } from "./prefs";
import { useStore } from "./store";
import type { AbsenceKind, BomLine, Invite, Issue, Job, JobLinkRole, JobStatus, PoLine, Product, Profile, PurchaseOrder, Station, StockItem, Supplier } from "./types";

const nowIso = () => new Date().toISOString();

export function useMine() {
  const { db, me } = useStore();
  return useMemo(() => {
    const shift = db.shifts.find((s) => s.user_id === me.id && !s.clock_out) ?? null;
    const brk = shift ? db.breaks.find((b) => b.shift_id === shift.id && !b.ended_at) ?? null : null;
    const part = db.participants.find((p) => p.user_id === me.id && !p.left_at) ?? null;
    const session = part ? db.work_sessions.find((s) => s.id === part.session_id) ?? null : null;
    const job = part ? db.jobs.find((j) => j.id === part.job_id) ?? null : null;
    const invites = db.invites.filter((i) => i.to_user === me.id && i.status === "pending");
    return { shift, brk, part, session, job, invites };
  }, [db, me.id]);
}

/** Who is on the clock right now, and what they are doing. */
export function usePresence() {
  const { db } = useStore();
  return useMemo(() => {
    const m = new Map<string, { state: "working" | "break" | "on" | "off"; jobId?: string; since?: string }>();
    for (const p of db.profiles) m.set(p.id, { state: "off" });
    for (const s of db.shifts) if (!s.clock_out) m.set(s.user_id, { state: "on", since: s.clock_in });
    for (const pt of db.participants) if (!pt.left_at && m.get(pt.user_id)?.state !== "off")
      m.set(pt.user_id, { state: "working", jobId: pt.job_id, since: pt.joined_at });
    for (const b of db.breaks) if (!b.ended_at) m.set(b.user_id, { state: "break", since: b.started_at });
    return m;
  }, [db]);
}

export function useActions() {
  const { backend: B, db, me, refresh, person } = useStore();
  const toast = useToast();
  const mine = useMine();

  return useMemo(() => {
    const fail = (e: unknown) => {
      buzz([30, 40, 30]);
      toast(e instanceof Error ? t(e.message) : t("Something went wrong"), "error");
      throw e;
    };
    const ok = (msg: string, tone: "ok" | "info" = "ok") => { buzz(14); blip(tone === "ok" ? 990 : 660); toast(msg, tone); };

    async function clockIn(silent = false) {
      if (mine.shift) return mine.shift;
      try {
        const s = await B.insert("shifts", { user_id: me.id, clock_in: nowIso(), clock_out: null });
        await refresh("shifts");
        if (!silent) ok(t("Clocked in — have a good shift"));
        return s;
      } catch (e) { return fail(e); }
    }

    async function endSessionIfEmpty(sessionId: string, jobId: string, exceptMe: boolean) {
      const others = db.participants.filter((p) => p.session_id === sessionId && !p.left_at && (!exceptMe || p.user_id !== me.id));
      if (others.length === 0) {
        await B.update("work_sessions", sessionId, { ended_at: nowIso() });
        const job = db.jobs.find((j) => j.id === jobId);
        if (job && job.status === "in_progress") await B.update("jobs", jobId, { status: "paused" });
        for (const i of db.invites.filter((x) => x.session_id === sessionId && x.status === "pending"))
          await B.update("invites", i.id, { status: "cancelled" });
      }
    }

    async function leaveSession(quiet = false) {
      if (!mine.part || !mine.session) return;
      try {
        await B.update("participants", mine.part.id, { left_at: nowIso() });
        await endSessionIfEmpty(mine.session.id, mine.part.job_id, true);
        await Promise.all([refresh("participants"), refresh("work_sessions"), refresh("jobs"), refresh("invites")]);
        if (!quiet) ok(t("You left the job — your time is saved"), "info");
      } catch (e) { fail(e); }
    }

    async function clockOut() {
      if (!mine.shift) return;
      try {
        if (mine.brk) await B.update("breaks", mine.brk.id, { ended_at: nowIso() });
        if (mine.part) await leaveSession(true);
        await B.update("shifts", mine.shift.id, { clock_out: nowIso() });
        await Promise.all([refresh("shifts"), refresh("breaks")]);
        ok(t("Clocked out — see you next time"));
      } catch (e) { fail(e); }
    }

    async function toggleBreak() {
      if (!mine.shift) return;
      try {
        if (mine.brk) {
          await B.update("breaks", mine.brk.id, { ended_at: nowIso() });
          ok(t("Welcome back"), "info");
        } else {
          await B.insert("breaks", { shift_id: mine.shift.id, user_id: me.id, started_at: nowIso(), ended_at: null });
          ok(t("Enjoy your break"), "info");
        }
        await refresh("breaks");
      } catch (e) { fail(e); }
    }

    async function startJob(job: Job) {
      try {
        if (!mine.shift) await clockIn(true);
        if (mine.brk) await B.update("breaks", mine.brk.id, { ended_at: nowIso() });
        if (mine.part) await leaveSession(true);
        const live = db.work_sessions.find((s) => s.job_id === job.id && !s.ended_at);
        if (live) {
          await B.insert("participants", { session_id: live.id, job_id: job.id, user_id: me.id, joined_at: nowIso(), left_at: null });
        } else {
          const ws = await B.insert("work_sessions", { job_id: job.id, started_by: me.id, started_at: nowIso(), ended_at: null });
          await B.insert("participants", { session_id: ws.id, job_id: job.id, user_id: me.id, joined_at: nowIso(), left_at: null });
        }
        await B.update("jobs", job.id, {
          status: "in_progress",
          assignees: job.assignees.includes(me.id) ? job.assignees : [...job.assignees, me.id],
        });
        await refresh();
        ok(t("{code} started — timer running", { code: job.code }));
      } catch (e) { fail(e); }
    }

    async function stopJob(job: Job, outcome: Exclude<JobStatus, "open" | "in_progress">) {
      const live = db.work_sessions.find((s) => s.job_id === job.id && !s.ended_at);
      try {
        const ts = nowIso();
        if (live) {
          for (const p of db.participants.filter((x) => x.session_id === live.id && !x.left_at))
            await B.update("participants", p.id, { left_at: ts });
          await B.update("work_sessions", live.id, { ended_at: ts });
          for (const i of db.invites.filter((x) => x.session_id === live.id && x.status === "pending"))
            await B.update("invites", i.id, { status: "cancelled" });
        }
        // A routed (Shopify) job finishing at one station moves on to the next one.
        if (outcome === "done" && job.route?.length) {
          const r = await B.completeStage(job.id);
          await refresh();
          buzz([20, 60, 20, 60, 40]); blip(1320, 0.15);
          const next = db.stations.find((s) => s.id === job.route[job.stage + 1]);
          toast(r === "done" || !next ? t("{code} complete — nice work", { code: job.code }) : t("{code} done here — passed to {station}", { code: job.code, station: next.name }), "ok");
          return;
        }
        await B.update("jobs", job.id, { status: outcome, completed_at: outcome === "done" ? ts : null });
        await refresh();
        if (outcome === "done") { buzz([20, 60, 20, 60, 40]); toast(t("{code} complete — nice work", { code: job.code }), "ok"); blip(1320, 0.15); }
        else ok(t(outcome === "paused" ? "{code} paused" : "{code} marked blocked", { code: job.code }), "info");
      } catch (e) { fail(e); }
    }

    async function invite(to: Profile[]) {
      if (!mine.session || !mine.part) return;
      try {
        for (const p of to) {
          const dup = db.invites.some((i) => i.session_id === mine.session!.id && i.to_user === p.id && i.status === "pending");
          if (!dup) await B.insert("invites", {
            session_id: mine.session.id, job_id: mine.part.job_id, from_user: me.id, to_user: p.id, status: "pending",
          });
        }
        await refresh("invites");
        ok(to.length === 1 ? t("Invite sent to {name}", { name: to[0]!.full_name.split(" ")[0]! }) : t("{n} invites sent", { n: to.length }));
      } catch (e) { fail(e); }
    }

    async function cancelInvite(i: Invite) {
      try { await B.update("invites", i.id, { status: "cancelled" }); await refresh("invites"); } catch (e) { fail(e); }
    }

    async function respond(inv: Invite, accept: boolean) {
      try {
        const session = db.work_sessions.find((s) => s.id === inv.session_id);
        if (accept && (!session || session.ended_at)) {
          await B.update("invites", inv.id, { status: "cancelled" });
          await refresh("invites");
          toast(t("That job has already stopped"), "info");
          return;
        }
        if (accept) {
          if (!mine.shift) await clockIn(true);
          if (mine.brk) await B.update("breaks", mine.brk.id, { ended_at: nowIso() });
          if (mine.part) await leaveSession(true);
          await B.insert("participants", { session_id: inv.session_id, job_id: inv.job_id, user_id: me.id, joined_at: nowIso(), left_at: null });
          const job = db.jobs.find((j) => j.id === inv.job_id);
          if (job && !job.assignees.includes(me.id)) await B.update("jobs", job.id, { assignees: [...job.assignees, me.id] });
        }
        await B.update("invites", inv.id, { status: accept ? "accepted" : "declined" });
        await refresh();
        if (accept) ok(t("Joined {name} — team timer running", { name: person(inv.from_user)?.full_name.split(" ")[0] ?? "" }));
        else toast(t("Invite declined"), "info");
      } catch (e) { fail(e); }
    }

    const crewOf = (stationId: string | undefined) => db.station_members.filter((m) => m.station_id === stationId).map((m) => m.user_id);

    async function saveJob(job: Partial<Job> & { id?: string }) {
      try {
        const old = job.id ? db.jobs.find((j) => j.id === job.id) : undefined;
        // A new or changed route starts again at its first station, with that station's crew.
        if (job.route && (!old || job.route.join() !== old.route.join())) {
          const first = job.route[0];
          job = { ...job, stage: 0, station_id: first ?? null, assignees: [...new Set([...(job.assignees ?? []), ...crewOf(first)])] };
          if (old && old.status === "done" && first) job.status = "open";
        }
        if (job.id) await B.update("jobs", job.id, job);
        else {
          const n = db.jobs.reduce((m, j) => Math.max(m, j.code.startsWith("SK-") ? parseInt(j.code.slice(3)) || 0 : 0), 2400) + 1;
          await B.insert("jobs", { code: `SK-${n}`, status: "open", assignees: [], description: "", customer: "", priority: 3, created_by: me.id, ...job });
        }
        await refresh("jobs");
        ok(t(job.id ? "Job updated" : "Job created"));
      } catch (e) { fail(e); }
    }
    async function deleteJob(job: Job) {
      try { await B.remove("jobs", job.id); await refresh(); ok(t("{code} deleted", { code: job.code }), "info"); } catch (e) { fail(e); }
    }
    async function sendBack(job: Job) {
      try {
        const st = await B.rpc<string>("previous_stage", { p_job: job.id });
        await Promise.all([refresh("jobs"), refresh("job_steps")]);
        ok(t("Sent back to {station}", { station: st }), "info");
      } catch (e) { fail(e); }
    }
    async function reopenJob(job: Job) {
      try { await B.update("jobs", job.id, { status: "open", completed_at: null }); await refresh("jobs"); ok(t("{code} reopened", { code: job.code }), "info"); } catch (e) { fail(e); }
    }

    async function reportIssue(i: Pick<Issue, "job_id" | "category" | "severity" | "title" | "description">, blockJob: boolean) {
      try {
        await B.insert("issues", { ...i, reported_by: me.id, status: "open", resolved_by: null });
        if (blockJob && i.job_id) {
          const job = db.jobs.find((j) => j.id === i.job_id);
          if (job) await stopJob(job, "blocked");
        }
        await refresh("issues");
        ok(t("Issue reported — the team has been notified"));
      } catch (e) { fail(e); }
    }
    async function setIssue(i: Issue, status: Issue["status"]) {
      try {
        await B.update("issues", i.id, { status, resolved_by: status === "resolved" ? me.id : null });
        if (status === "resolved" && i.job_id) {
          const job = db.jobs.find((j) => j.id === i.job_id);
          const stillOpen = db.issues.some((x) => x.id !== i.id && x.job_id === i.job_id && x.status !== "resolved");
          if (job?.status === "blocked" && !stillOpen) await B.update("jobs", job.id, { status: "paused" });
        }
        await refresh("issues"); await refresh("jobs");
        ok(t(status === "resolved" ? "Issue resolved" : "Issue acknowledged"), "info");
      } catch (e) { fail(e); }
    }

    const stockRefresh = () => Promise.all([refresh("stock_items"), refresh("stock_movements"), refresh("stock_levels")]);
    // key: one per user intent — a retried or double-clicked request books once (server op_keys).
    async function adjustStock(item: StockItem, delta: number, note = "", key: string = opKey(), location: string | null = null) {
      try { await B.rpc("adjust_stock", { p_item: item.id, p_delta: delta, p_note: note, p_key: key, p_location: location }); await stockRefresh(); buzz(8); }
      catch (e) { fail(e); }
    }
    async function countStock(item: StockItem, counted: number, note = "", location: string | null = null) {
      try { await B.rpc("count_stock", { p_item: item.id, p_counted: counted, p_note: note, p_location: location }); await stockRefresh(); ok(t("Count saved")); }
      catch (e) { fail(e); }
    }
    async function saveStock(item: Partial<StockItem>, opening?: { qty: number; cost: number | null }) {
      try {
        const { quantity: _q, avg_cost: _c, ...details } = item;
        void _q; void _c;
        let id = item.id;
        if (id) await B.update("stock_items", id, { ...details, updated_by: me.id, updated_at: nowIso() });
        else id = (await B.insert("stock_items", { ...details, quantity: 0, updated_by: me.id, updated_at: nowIso() })).id;
        if (opening && (opening.qty || opening.cost !== null)) await B.rpc("opening_stock", { p_item: id, p_qty: opening.qty, p_cost: opening.cost });
        await stockRefresh();
        ok(t(item.id ? "Item saved" : "Item added"));
        return id;
      } catch (e) { return fail(e); }
    }
    async function importRows(kind: "items" | "bom", rows: Record<string, string>[]) {
      let n = 0;
      try {
        for (let i = 0; i < rows.length; i += 200)
          n += await B.rpc<number>(kind === "items" ? "import_items" : "import_bom", { p_rows: rows.slice(i, i + 200) });
        await Promise.all([stockRefresh(), refresh("suppliers"), refresh("bom_lines")]);
        ok(t("{n} rows imported", { n }));
        return n;
      } catch (e) { return fail(e); }
    }
    async function saveBomLine(l: Partial<BomLine>) {
      try {
        if (l.id) await B.update("bom_lines", l.id, l); else await B.insert("bom_lines", l);
        await refresh("bom_lines");
      } catch (e) { fail(e); }
    }
    async function removeBomLine(id: string) {
      try { await B.remove("bom_lines", id); await refresh("bom_lines"); } catch (e) { fail(e); }
    }
    async function saveSupplier(sup: Partial<Supplier>) {
      try {
        const r = sup.id ? await B.update("suppliers", sup.id, sup) : await B.insert("suppliers", sup);
        await refresh("suppliers"); ok(t("Supplier saved")); return r.id;
      } catch (e) { return fail(e); }
    }
    async function savePo(po: Partial<PurchaseOrder>, lines?: Partial<PoLine>[]) {
      try {
        const r = po.id ? await B.update("purchase_orders", po.id, po) : await B.insert("purchase_orders", { status: "draft", created_by: me.id, ...po });
        if (lines) for (const l of lines) {
          if (l.id) await B.update("po_lines", l.id, l); else await B.insert("po_lines", { ...l, po_id: r.id });
        }
        await Promise.all([refresh("purchase_orders"), refresh("po_lines")]);
        return r;
      } catch (e) { return fail(e); }
    }
    async function removePoLine(id: string) {
      try { await B.remove("po_lines", id); await refresh("po_lines"); } catch (e) { fail(e); }
    }
    async function receive(line: PoLine, qty: number, key: string = opKey(), over = false) {
      try {
        const r = await B.rpc<string>("receive_po_line", { p_line: line.id, p_qty: qty, p_key: key, p_over: over });
        await Promise.all([stockRefresh(), refresh("po_lines"), refresh("purchase_orders")]);
        ok(t(r === "received" ? "Delivery received — PO complete" : "Delivery received"));
        return true;
      } catch (e) { fail(e); return false; }
    }
    async function reverseReceipt(line: PoLine, qty: number, key: string = opKey()) {
      try {
        await B.rpc<string>("reverse_po_receipt", { p_line: line.id, p_qty: qty, p_key: key });
        await Promise.all([stockRefresh(), refresh("po_lines"), refresh("purchase_orders")]);
        ok(t("Receipt reversed — stock taken back out"), "info");
        return true;
      } catch (e) { fail(e); return false; }
    }

    async function requestAbsence(kind: AbsenceKind, start_date: string, end_date: string, note: string) {
      try {
        await B.insert("absences", { user_id: me.id, kind, start_date, end_date, note, status: "pending", decided_by: null });
        await refresh("absences");
        ok(t(kind === "sick" ? "Get well soon — your manager has been told" : "Request sent for approval"));
      } catch (e) { fail(e); }
    }
    async function decideAbsence(id: string, status: "approved" | "rejected" | "cancelled") {
      try {
        await B.update("absences", id, { status, decided_by: status === "cancelled" ? null : me.id });
        await refresh("absences");
        ok(t(status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Request cancelled"), "info");
      } catch (e) { fail(e); }
    }

    async function post(body: string, pinned: boolean) {
      try { await B.insert("announcements", { author_id: me.id, body, pinned }); await refresh("announcements"); ok(t("Posted to everyone")); }
      catch (e) { fail(e); }
    }
    async function unpost(id: string) {
      try { await B.remove("announcements", id); await refresh("announcements"); } catch (e) { fail(e); }
    }

    async function setStationMember(stationId: string, userId: string, on: boolean) {
      try {
        const row = db.station_members.find((m) => m.station_id === stationId && m.user_id === userId);
        if (on && !row) await B.insert("station_members", { station_id: stationId, user_id: userId });
        if (!on && row) await B.remove("station_members", row.id);
        await Promise.all([refresh("station_members"), refresh("jobs")]);
        buzz(8);
      } catch (e) { fail(e); }
    }
    async function saveStation(s: Partial<Station>) {
      try {
        if (s.id) await B.update("stations", s.id, s);
        else await B.insert("stations", { name: s.name ?? "", sort: (db.stations.reduce((m, x) => Math.max(m, x.sort), 0) + 1), in_default: true, ...s });
        await refresh("stations");
      } catch (e) { fail(e); }
    }
    async function moveStation(s: Station, dir: -1 | 1) {
      const list = [...db.stations].sort((x, y) => x.sort - y.sort);
      const i = list.findIndex((x) => x.id === s.id), j = i + dir;
      if (j < 0 || j >= list.length) return;
      try {
        await B.update("stations", list[i]!.id, { sort: list[j]!.sort === list[i]!.sort ? list[i]!.sort + dir : list[j]!.sort });
        await B.update("stations", list[j]!.id, { sort: list[i]!.sort });
        await refresh("stations");
      } catch (e) { fail(e); }
    }
    async function deleteStation(s: Station) {
      try { await B.remove("stations", s.id); await refresh(); ok(t("Station removed"), "info"); } catch (e) { fail(e); }
    }
    async function saveProduct(p: Partial<Product>) {
      try {
        if (p.id) await B.update("products", p.id, p);
        else await B.insert("products", { name: "", route: [], estimate_minutes: null, ...p });
        await refresh("products");
        ok(t("Product saved"));
      } catch (e) { fail(e); }
    }
    async function deleteProduct(p: Product) {
      try { await B.remove("products", p.id); await refresh("products"); ok(t("Product removed"), "info"); } catch (e) { fail(e); }
    }

    async function updateProfile(id: string, patch: Partial<Profile>) {
      try { await B.update("profiles", id, patch); await refresh("profiles"); ok(t("Saved")); } catch (e) { fail(e); }
    }
    async function uploadAvatar(blob: Blob) {
      try {
        const url = await B.uploadAvatar(me.id, blob);
        await B.update("profiles", me.id, { avatar_url: url });
        await refresh("profiles");
        ok(t("New photo saved"));
      } catch (e) { fail(e); }
    }
    /** Admin: end someone's open shift now (and any break still running). */
    async function endShiftFor(shift: { id: string; user_id: string }) {
      try {
        const at = nowIso();
        for (const br of db.breaks.filter((x) => x.shift_id === shift.id && !x.ended_at)) await B.update("breaks", br.id, { ended_at: at });
        await B.update("shifts", shift.id, { clock_out: at });
        await Promise.all([refresh("shifts"), refresh("breaks")]); ok(t("Shift ended"));
      } catch (e) { fail(e); }
    }
    /** Admin: add a shift someone forgot to clock. */
    async function addShiftFor(userId: string, clockIn: string, clockOut: string) {
      try { await B.insert("shifts", { user_id: userId, clock_in: clockIn, clock_out: clockOut }); await refresh("shifts"); ok(t("Shift added")); } catch (e) { fail(e); }
    }
    async function editShift(id: string, patch: { clock_in?: string; clock_out?: string | null }) {
      try { await B.update("shifts", id, patch); await refresh("shifts"); ok(t("Shift corrected")); } catch (e) { fail(e); }
    }

    async function createJoinLink(role: JobLinkRole, pin: string, hours: number, maxUses: number | null) {
      try { const l = await B.createJoinLink(role, pin, hours, maxUses); await refresh("join_links"); ok(t("Invite link ready")); return l; }
      catch (e) { return fail(e); }
    }
    async function revokeJoinLink(id: string) {
      try { await B.update("join_links", id, { revoked: true }); await refresh("join_links"); ok(t("Link switched off"), "info"); } catch (e) { fail(e); }
    }
    async function approve(p: Profile) {
      try { await B.update("profiles", p.id, { active: true }); await refresh("profiles"); ok(t("{name} can now use the app", { name: p.full_name.split(" ")[0]! })); } catch (e) { fail(e); }
    }
    async function removeMember(p: Profile) {
      try { await B.remove("profiles", p.id); await refresh("profiles"); ok(t("Account removed"), "info"); } catch (e) { fail(e); }
    }

    return {
      createJoinLink, revokeJoinLink, approve, removeMember,
      clockIn, clockOut, toggleBreak, startJob, stopJob, leaveSession, invite, cancelInvite, respond,
      saveJob, deleteJob, reopenJob, sendBack, reportIssue, setIssue, adjustStock, countStock, saveStock, importRows,
      saveBomLine, removeBomLine, saveSupplier, savePo, removePoLine, receive, reverseReceipt, requestAbsence,
      decideAbsence, post, unpost, updateProfile, uploadAvatar, editShift, endShiftFor, addShiftFor,
      setStationMember, saveStation, moveStation, deleteStation, saveProduct, deleteProduct,
    };
  }, [B, db, me.id, mine, refresh, person, toast]);
}

/** Stations in route order, with quick lookups. */
export function useStations() {
  const { db } = useStore();
  return useMemo(() => {
    const list = [...db.stations].sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
    const byId = new Map(list.map((s) => [s.id, s]));
    const crew = (id: string) => db.station_members.filter((m) => m.station_id === id).map((m) => m.user_id);
    const of = (userId: string) => db.station_members.filter((m) => m.user_id === userId).map((m) => m.station_id);
    return { list, byId, name: (id: string | null | undefined) => (id ? byId.get(id)?.name ?? "" : ""), crew, of };
  }, [db.stations, db.station_members]);
}

/** Idempotency key for one user action (see claim_op in schema.sql). */
export const opKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
