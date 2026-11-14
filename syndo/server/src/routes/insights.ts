import type { FastifyInstance } from "fastify";
import { P } from "@send/shared";
import { q, q1 } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { requireGuild } from "../perms.ts";
import { bad } from "../errors.ts";
import { toGuild } from "../gateway.ts";

/** Daily counters for Server Insights. Cheap upserts; old rows are pruned by the maintenance job. */
export async function trackStat(guildId: string, kind: "message" | "join" | "leave" | "voice", userId?: string, amount = 1) {
  const col = kind === "message" ? "messages" : kind === "join" ? "joins" : kind === "leave" ? "leaves" : "voice_minutes";
  await q(`insert into guild_daily_stats(guild_id, day, ${col}) values ($1, current_date, $2)
           on conflict (guild_id, day) do update set ${col} = guild_daily_stats.${col} + $2`, [guildId, amount]);
  if (userId && (kind === "message" || kind === "voice")) {
    await q(`insert into guild_daily_active(guild_id, day, user_id, communicated) values ($1, current_date, $2, true)
             on conflict (guild_id, day, user_id) do nothing`, [guildId, userId]);
  }
}

export async function insightsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>("/api/guilds/:id/insights", async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const days = Math.min(Math.max(Number(req.query.days ?? 30) || 30, 7), 90);
    const series = await q<any>(`select d::date::text as day, coalesce(s.messages, 0) as messages, coalesce(s.joins, 0) as joins, coalesce(s.leaves, 0) as leaves,
        coalesce(s.voice_minutes, 0) as voice_minutes, (select count(*)::int from guild_daily_active a where a.guild_id = $1 and a.day = d::date) as active
      from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d
      left join guild_daily_stats s on s.guild_id = $1 and s.day = d::date order by d`, [req.params.id, days]);
    const channels = await q<any>(`select c.id::text, c.name, count(m.id)::int as messages from messages m join channels c on c.id = m.channel_id
      where m.guild_id = $1 and m.created_at > now() - make_interval(days => $2) and m.deleted_at is null and c.type in (0, 5, 2)
      group by c.id, c.name order by messages desc limit 10`, [req.params.id, days]);
    const members = await q1<any>(`select count(*)::int as total, count(*) filter (where joined_at > now() - make_interval(days => $2))::int as new from members where guild_id = $1`, [req.params.id, days]);
    const retained = await q1<any>(`select count(*)::int as n from members m where m.guild_id = $1 and m.joined_at between now() - make_interval(days => $2) and now() - interval '7 days'
      and exists (select 1 from guild_daily_active a where a.guild_id = m.guild_id and a.user_id = m.user_id and a.day >= (m.joined_at::date + 7))`, [req.params.id, days]);
    const joinedEarly = await q1<any>(`select count(*)::int as n from members where guild_id = $1 and joined_at between now() - make_interval(days => $2) and now() - interval '7 days'`, [req.params.id, days]);
    return {
      days, series, top_channels: channels, members: members.total, new_members: members.new,
      retention: joinedEarly.n ? Math.round((retained.n / joinedEarly.n) * 100) : null,
      totals: series.reduce((t: any, d: any) => ({ messages: t.messages + d.messages, joins: t.joins + d.joins, leaves: t.leaves + d.leaves, voice_minutes: t.voice_minutes + d.voice_minutes }), { messages: 0, joins: 0, leaves: 0, voice_minutes: 0 }),
    };
  });

  /** Prune: preview and remove members who haven't been active for N days and have no roles (optionally: with these roles). */
  const pruneWhere = `m.guild_id = $1 and m.user_id <> g.owner_id and m.joined_at < now() - make_interval(days => $2)
      and not exists (select 1 from guild_daily_active a where a.guild_id = m.guild_id and a.user_id = m.user_id and a.day > current_date - $2::int)
      and not exists (select 1 from messages x where x.guild_id = m.guild_id and x.author_id = m.user_id and x.created_at > now() - make_interval(days => $2))
      and not exists (select 1 from member_roles r where r.guild_id = m.guild_id and r.user_id = m.user_id and not (r.role_id = any($3::bigint[])))`;
  app.get<{ Params: { id: string }; Querystring: { days?: string; roles?: string } }>("/api/guilds/:id/prune", async (req) => {
    await requireGuild(uid(req), req.params.id, P.KICK_MEMBERS);
    const days = Number(req.query.days ?? 30);
    if (![1, 7, 30].includes(days) && !(days >= 1 && days <= 365)) throw bad("Pick a number of days.");
    const roles = (req.query.roles ?? "").split(",").filter((r) => /^\d{1,20}$/.test(r));
    const r = await q1<any>(`select count(*)::int as n from members m join guilds g on g.id = m.guild_id where ${pruneWhere}`, [req.params.id, days, roles]);
    return { pruned: r.n };
  });
  app.post<{ Params: { id: string } }>("/api/guilds/:id/prune", async (req) => {
    await requireGuild(uid(req), req.params.id, P.KICK_MEMBERS);
    const b = (req.body ?? {}) as { days?: number; roles?: string[] };
    const days = Math.min(Math.max(Number(b.days ?? 30) || 30, 1), 365);
    const roles = (b.roles ?? []).filter((r) => /^\d{1,20}$/.test(String(r)));
    const rows = await q<any>(`delete from members m using guilds g where g.id = m.guild_id and ${pruneWhere} returning m.user_id::text`, [req.params.id, days, roles]);
    const { dropVoice, toUser } = await import("../gateway.ts");
    for (const r of rows) {
      toUser(r.user_id, "GUILD_DELETE", { id: req.params.id });
      await dropVoice(r.user_id).catch(() => {});
      await toGuild(req.params.id, "GUILD_MEMBER_REMOVE", { guild_id: req.params.id, user_id: r.user_id });
    }
    if (rows.length) await trackStat(req.params.id, "leave", undefined, rows.length);
    const { audit } = await import("./guilds.ts");
    await audit(req.params.id, uid(req), "member_prune", null, { days, removed: rows.length });
    return { pruned: rows.length };
  });
}
