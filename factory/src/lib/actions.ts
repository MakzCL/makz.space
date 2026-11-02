import { useMemo } from "react";
import { useToast } from "../components/Toast";
import { blip, buzz } from "./prefs";
import { useStore } from "./store";
import type { AbsenceKind, Invite, Issue, Job, JobStatus, Profile, StockItem } from "./types";

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
      toast(e instanceof Error ? e.message : "Something went wrong", "error");
      throw e;
    };
    const ok = (msg: string, tone: "ok" | "info" = "ok") => { buzz(14); blip(tone === "ok" ? 990 : 660); toast(msg, tone); };

    async function clockIn(silent = false) {
      if (mine.shift) return mine.shift;
      try {
        const s = await B.insert("shifts", { user_id: me.id, clock_in: nowIso(), clock_out: null });
        await refresh("shifts");
        if (!silent) ok("Clocked in — have a great shift");
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
        if (!quiet) ok("You left the job — time saved", "info");
      } catch (e) { fail(e); }
    }

    async function clockOut() {
      if (!mine.shift) return;
      try {
        if (mine.brk) await B.update("breaks", mine.brk.id, { ended_at: nowIso() });
        if (mine.part) await leaveSession(true);
        await B.update("shifts", mine.shift.id, { clock_out: nowIso() });
        await Promise.all([refresh("shifts"), refresh("breaks")]);
        ok("Clocked out — see you next time 👋");
      } catch (e) { fail(e); }
    }

    async function toggleBreak() {
      if (!mine.shift) return;
      try {
        if (mine.brk) {
          await B.update("breaks", mine.brk.id, { ended_at: nowIso() });
          ok("Welcome back", "info");
        } else {
          await B.insert("breaks", { shift_id: mine.shift.id, user_id: me.id, started_at: nowIso(), ended_at: null });
          ok("Enjoy your break ☕", "info");
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
        ok(`${job.code} started — timer running`);
      } catch (e) { fail(e); }
    }

    async function stopJob(job: Job, outcome: Exclude<JobStatus, "open" | "in_progress">) {
      const live = db.work_sessions.find((s) => s.job_id === job.id && !s.ended_at);
      try {
        const t = nowIso();
        if (live) {
          for (const p of db.participants.filter((x) => x.session_id === live.id && !x.left_at))
            await B.update("participants", p.id, { left_at: t });
          await B.update("work_sessions", live.id, { ended_at: t });
          for (const i of db.invites.filter((x) => x.session_id === live.id && x.status === "pending"))
            await B.update("invites", i.id, { status: "cancelled" });
        }
        await B.update("jobs", job.id, { status: outcome, completed_at: outcome === "done" ? t : null });
        await refresh();
        if (outcome === "done") { buzz([20, 60, 20, 60, 40]); toast(`${job.code} complete — nice work! 🎉`, "ok"); blip(1320, 0.15); }
        else ok(outcome === "paused" ? `${job.code} paused` : `${job.code} marked blocked`, "info");
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
        ok(to.length === 1 ? `Invite sent to ${to[0]!.full_name.split(" ")[0]}` : `${to.length} invites sent`);
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
          toast("That job has already stopped", "info");
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
        if (accept) ok(`Joined ${person(inv.from_user)?.full_name.split(" ")[0] ?? "the team"} — team timer running 🤝`);
        else toast("Invite declined", "info");
      } catch (e) { fail(e); }
    }

    async function saveJob(job: Partial<Job> & { id?: string }) {
      try {
        if (job.id) await B.update("jobs", job.id, job);
        else {
          const n = db.jobs.reduce((m, j) => Math.max(m, parseInt(j.code.replace(/\D/g, "")) || 0), 2400) + 1;
          await B.insert("jobs", { code: `SK-${n}`, status: "open", assignees: [], description: "", customer: "", priority: 3, created_by: me.id, ...job });
        }
        await refresh("jobs");
        ok(job.id ? "Job updated" : "Job created");
      } catch (e) { fail(e); }
    }
    async function deleteJob(job: Job) {
      try { await B.remove("jobs", job.id); await refresh(); ok(`${job.code} deleted`, "info"); } catch (e) { fail(e); }
    }
    async function reopenJob(job: Job) {
      try { await B.update("jobs", job.id, { status: "open", completed_at: null }); await refresh("jobs"); ok(`${job.code} reopened`, "info"); } catch (e) { fail(e); }
    }

    async function reportIssue(i: Pick<Issue, "job_id" | "category" | "severity" | "title" | "description">, blockJob: boolean) {
      try {
        await B.insert("issues", { ...i, reported_by: me.id, status: "open", resolved_by: null });
        if (blockJob && i.job_id) {
          const job = db.jobs.find((j) => j.id === i.job_id);
          if (job) await stopJob(job, "blocked");
        }
        await refresh("issues");
        ok("Issue reported — the team has been notified");
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
        ok(status === "resolved" ? "Issue resolved ✓" : "Issue acknowledged", "info");
      } catch (e) { fail(e); }
    }

    async function adjustStock(item: StockItem, delta: number) {
      try {
        await B.update("stock_items", item.id, { quantity: Math.max(0, item.quantity + delta), updated_by: me.id, updated_at: nowIso() });
        await refresh("stock_items");
        buzz(8);
      } catch (e) { fail(e); }
    }
    async function saveStock(item: Partial<StockItem>) {
      try {
        if (item.id) await B.update("stock_items", item.id, { ...item, updated_by: me.id, updated_at: nowIso() });
        else await B.insert("stock_items", { ...item, updated_by: me.id, updated_at: nowIso() });
        await refresh("stock_items");
        ok(item.id ? "Stock updated" : "Item added");
      } catch (e) { fail(e); }
    }

    async function requestAbsence(kind: AbsenceKind, start_date: string, end_date: string, note: string) {
      try {
        await B.insert("absences", { user_id: me.id, kind, start_date, end_date, note, status: "pending", decided_by: null });
        await refresh("absences");
        ok(kind === "sick" ? "Get well soon — your manager has been told" : "Request sent for approval");
      } catch (e) { fail(e); }
    }
    async function decideAbsence(id: string, status: "approved" | "rejected" | "cancelled") {
      try {
        await B.update("absences", id, { status, decided_by: status === "cancelled" ? null : me.id });
        await refresh("absences");
        ok(status === "approved" ? "Approved ✓" : status === "rejected" ? "Rejected" : "Request cancelled", "info");
      } catch (e) { fail(e); }
    }

    async function post(body: string, pinned: boolean) {
      try { await B.insert("announcements", { author_id: me.id, body, pinned }); await refresh("announcements"); ok("Posted to everyone 📣"); }
      catch (e) { fail(e); }
    }
    async function unpost(id: string) {
      try { await B.remove("announcements", id); await refresh("announcements"); } catch (e) { fail(e); }
    }

    async function updateProfile(id: string, patch: Partial<Profile>) {
      try { await B.update("profiles", id, patch); await refresh("profiles"); ok("Saved"); } catch (e) { fail(e); }
    }
    async function uploadAvatar(blob: Blob) {
      try {
        const url = await B.uploadAvatar(me.id, blob);
        await B.update("profiles", me.id, { avatar_url: url });
        await refresh("profiles");
        ok("Looking good! New photo saved 📸");
      } catch (e) { fail(e); }
    }
    async function editShift(id: string, patch: { clock_in?: string; clock_out?: string | null }) {
      try { await B.update("shifts", id, patch); await refresh("shifts"); ok("Shift corrected"); } catch (e) { fail(e); }
    }

    return {
      clockIn, clockOut, toggleBreak, startJob, stopJob, leaveSession, invite, cancelInvite, respond,
      saveJob, deleteJob, reopenJob, reportIssue, setIssue, adjustStock, saveStock, requestAbsence,
      decideAbsence, post, unpost, updateProfile, uploadAvatar, editShift,
    };
  }, [B, db, me.id, mine, refresh, person, toast]);
}
