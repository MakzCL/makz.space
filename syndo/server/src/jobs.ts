import { q } from "./db.ts";
import * as storage from "./storage.ts";

/**
 * Background maintenance. Runs in-process on an interval; with several API
 * nodes only one should run it (SEND_JOBS=0 on the others). Durable,
 * retryable work goes through the `jobs` table (claimed with SKIP LOCKED).
 */
export async function runMaintenance() {
  // Uploads that never became part of a message.
  const stale = await q<{ id: string; storage_key: string }>(
    "delete from attachments where message_id is null and created_at < now() - interval '24 hours' returning id, storage_key");
  for (const a of stale) await storage.remove(a.storage_key).catch(() => {});
  await q("delete from sessions where (revoked_at is not null and revoked_at < now() - interval '30 days') or expires_at < now() - interval '30 days'");
  await q("delete from email_tokens where expires_at < now() - interval '7 days'");
  await q("delete from mail_outbox where created_at < now() - interval '7 days'");
  await q("update invites set revoked_at = now() where revoked_at is null and expires_at < now() - interval '7 days'");
  // Expired custom statuses.
  await q("update users set custom_status = null where custom_status ? 'expires_at' and custom_status->>'expires_at' is not null and (custom_status->>'expires_at')::timestamptz < now()");
  await q("delete from jobs where done_at < now() - interval '7 days'");
  // Major update: threads, polls, previews, stats, sign-in challenges, timed mutes, events.
  const { archiveIdleThreads } = await import("./routes/threads.ts");
  await archiveIdleThreads().catch((e) => console.error("[jobs threads]", e));
  const { finalizePoll } = await import("./routes/messages.ts");
  for (const p of await q<any>("select message_id::text from polls where not finalized and expires_at <= now() limit 200")) await finalizePoll(p.message_id).catch(() => {});
  await q("delete from link_previews where fetched_at < now() - interval '14 days'");
  await q("delete from guild_daily_active where day < current_date - 120");
  await q("delete from guild_daily_stats where day < current_date - 400");
  await q("delete from auth_challenges where expires_at < now() - interval '1 hour'");
  await q("delete from interactions where created_at < now() - interval '1 day'");
  await q("update notification_settings set muted = false, muted_until = null where muted and muted_until is not null and muted_until < now()");
  const { expirePremium } = await import("./routes/premium.ts");
  await expirePremium().catch((e) => console.error("[jobs premium]", e));
  const { runEventLifecycle } = await import("./routes/events.ts");
  await runEventLifecycle().catch((e) => console.error("[jobs events]", e));
  return { attachmentsRemoved: stale.length };
}

export function startJobs() {
  if (process.env.SEND_JOBS === "0") return;
  const t = setInterval(() => runMaintenance().catch((e) => console.error("[jobs]", e)), 60_000);
  t.unref();
}
