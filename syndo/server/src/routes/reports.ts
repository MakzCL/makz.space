import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { newId } from "../ids.ts";
import { sendMail } from "../mail.ts";

/**
 * Reports: any signed-in person can report a message, a user or a server. Reports are stored for review by MAKZ Labs
 * and, when SEND_REPORTS_EMAIL is set and email is configured, also emailed to the safety inbox.
 * Required by the UK Online Safety Act and by the Apple and Google store rules for user-generated content.
 */
export const REPORT_REASONS = ["spam", "harassment", "hate", "violence", "self_harm", "child_safety", "sexual", "illegal", "impersonation", "copyright", "privacy", "other"] as const;

export async function reportRoutes(app: FastifyInstance) {
  app.post("/api/reports", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => {
    await requireUser(req);
    const b = z.object({
      target_type: z.enum(["message", "user", "guild"]),
      target_id: z.string().regex(/^\d{1,20}$/),
      channel_id: z.string().regex(/^\d{1,20}$/).nullish(),
      guild_id: z.string().regex(/^\d{1,20}$/).nullish(),
      reason: z.enum(REPORT_REASONS),
      details: z.string().max(2000).default(""),
      evidence: z.object({ content: z.string().max(4000).optional(), author_id: z.string().max(20).optional(), author_name: z.string().max(100).optional(), attachments: z.array(z.string().max(500)).max(10).optional() }).default({}),
    }).parse(req.body);
    const id = newId();
    await q(`insert into reports (id, reporter_id, target_type, target_id, channel_id, guild_id, reason, details, evidence) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, uid(req), b.target_type, b.target_id, b.channel_id ?? null, b.guild_id ?? null, b.reason, b.details, JSON.stringify(b.evidence)]);
    const to = process.env.SEND_REPORTS_EMAIL || "send@makz.space";
    if (to) sendMail(to, `SEND report ${id}: ${b.reason} (${b.target_type})`, [
      `Report ${id} from user ${uid(req)}`, `Target: ${b.target_type} ${b.target_id}${b.channel_id ? ` in channel ${b.channel_id}` : ""}${b.guild_id ? ` in server ${b.guild_id}` : ""}`,
      `Reason: ${b.reason}`, b.details ? `Details: ${b.details}` : "", b.evidence.content ? `Reported content: ${b.evidence.content}` : "",
    ].filter(Boolean)).catch(() => {});
    return { id, received: true };
  });
}
