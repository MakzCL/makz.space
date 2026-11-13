import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { config } from "../config.ts";
import { bad, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { ensureSlots } from "./premium.ts";

/**
 * Sparks: earned by finishing challenges, spent on Server Boosts. Each challenge pays enough for one boost,
 * and a boost bought with Sparks lasts a year. Challenges run in yearly seasons; a new season brings new ones.
 */
export const SPARKS_PER_BOOST = 100;
export const SEASON = { id: "2026", starts: "2026-11-13T00:00:00Z", ends: "2027-11-13T00:00:00Z" };
const seasonLive = () => { const t = Date.now(); return t >= Date.parse(SEASON.starts) && t < Date.parse(SEASON.ends); };

interface Challenge { key: string; title: string; detail: string; goal: number; unit: string; progress: (me: string) => Promise<number> }
const minutes = (key: string) => async (me: string) => (await q1<any>("select progress from challenge_progress where user_id = $1 and season = $2 and key = $3", [me, SEASON.id, key]))?.progress ?? 0;
const CHALLENGES: Challenge[] = [
  { key: "invite", title: "Invite 3 friends to SEND", detail: "Share your invite link. A friend counts once they've joined with it and sent 5 messages.", goal: 3, unit: "friends",
    progress: async (me) => (await q1<any>(`select count(*)::int as n from users u where u.referred_by = $1 and u.deleted_at is null and u.created_at >= $2
      and (select count(*) from (select 1 from messages m where m.author_id = u.id and m.deleted_at is null limit 5) x) >= 5`, [me, SEASON.starts]))?.n ?? 0 },
  { key: "bigcall", title: "Join a call with 5 or more people", detail: "Stay in a voice call with at least 5 people for 10 minutes.", goal: 10, unit: "minutes", progress: minutes("bigcall") },
  { key: "golive", title: "Go live for 15 minutes", detail: "Share your screen in a call with someone else watching.", goal: 15, unit: "minutes", progress: minutes("golive") },
  { key: "messages", title: "Send 100 messages", detail: "In servers, groups or direct messages, this season.", goal: 100, unit: "messages",
    progress: async (me) => (await q1<any>("select count(*)::int as n from (select 1 from messages where author_id = $1 and deleted_at is null and created_at >= $2 limit 100) x", [me, SEASON.starts]))?.n ?? 0 },
  { key: "community", title: "Grow a server to 10 members", detail: "Any server you own counts, you included.", goal: 10, unit: "members",
    progress: async (me) => (await q1<any>("select coalesce(max(n), 0)::int as n from (select count(*) as n from members m join guilds g on g.id = m.guild_id where g.owner_id = $1 group by g.id) x", [me]))?.n ?? 0 },
  { key: "profile", title: "Make your profile yours", detail: "Add an avatar, a banner and a bio.", goal: 3, unit: "done",
    progress: async (me) => { const u = await q1<any>("select avatar_key, banner_key, bio from users where id = $1", [me]); return u ? [u.avatar_key, u.banner_key, (u.bio ?? "").trim()].filter(Boolean).length : 0; } },
];

const balanceOf = async (me: string, c?: any) => {
  const sql = "select coalesce(sum(amount), 0)::int as n from spark_ledger where user_id = $1";
  return c ? (await c.query(sql, [me])).rows[0].n as number : (await q1<any>(sql, [me]))?.n ?? 0;
};

/** Every minute: count time in big calls and time spent sharing a screen to others. */
export async function tickChallenges() {
  if (!seasonLive()) return;
  const { voiceStates } = await import("../gateway.ts");
  const byChannel = new Map<string, any[]>();
  for (const v of voiceStates()) { const l = byChannel.get(v.channel_id) ?? []; l.push(v); byChannel.set(v.channel_id, l); }
  const bump = async (users: string[], key: string, cap: number) => {
    if (!users.length) return;
    await q(`insert into challenge_progress(user_id, season, key, progress) select unnest($1::bigint[]), $2, $3, 1
             on conflict (user_id, season, key) do update set progress = least(challenge_progress.progress + 1, $4)`, [users, SEASON.id, key, cap]);
  };
  for (const list of byChannel.values()) {
    if (list.length >= 5) await bump(list.map((v) => v.user_id), "bigcall", 10);
    if (list.length >= 2) await bump(list.filter((v) => v.self_stream).map((v) => v.user_id), "golive", 15);
  }
}

export async function sparksRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/sparks", async (req) => {
    const me = uid(req);
    const claimed = new Set((await q<any>("select ref from spark_ledger where user_id = $1 and reason = 'challenge'", [me])).map((r) => r.ref));
    const u = await q1<any>("select username from users where id = $1", [me]);
    const challenges = await Promise.all(CHALLENGES.map(async (c) => ({
      key: c.key, title: c.title, detail: c.detail, goal: c.goal, unit: c.unit, reward: SPARKS_PER_BOOST,
      progress: Math.min(c.goal, await c.progress(me)), claimed: claimed.has(`${SEASON.id}:${c.key}`),
    })));
    return { balance: await balanceOf(me), per_boost: SPARKS_PER_BOOST, season: { id: SEASON.id, ends: SEASON.ends, live: seasonLive() }, challenges,
      invite_link: `${config.publicUrl}/register?ref=${encodeURIComponent(u?.username ?? "")}` };
  });

  app.post<{ Params: { key: string } }>("/api/sparks/claim/:key", async (req) => {
    const me = uid(req);
    const c = CHALLENGES.find((x) => x.key === req.params.key);
    if (!c) throw notFound("Challenge");
    if (!seasonLive()) throw bad("This season has ended. New challenges are coming.");
    if ((await c.progress(me)) < c.goal) throw bad("That challenge isn't finished yet.");
    const ins = await q1("insert into spark_ledger(id, user_id, amount, reason, ref) values ($1,$2,$3,'challenge',$4) on conflict do nothing returning 1",
      [newId(), me, SPARKS_PER_BOOST, `${SEASON.id}:${c.key}`]);
    if (!ins) throw bad("You've already claimed this one.");
    const { toUser } = await import("../gateway.ts");
    toUser(me, "SPARKS_UPDATE", {});
    return { ok: true, balance: await balanceOf(me) };
  });

  /** Spend Sparks on boosts: each lasts a year from today. */
  app.post("/api/sparks/boosts", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const me = uid(req);
    const { count } = z.object({ count: z.number().int().min(1).max(20) }).parse(req.body);
    const cost = count * SPARKS_PER_BOOST;
    await tx(async (c) => {
      await c.query("select pg_advisory_xact_lock(hashtext('sparks:' || $1::text))", [me]);
      if ((await balanceOf(me, c)) < cost) throw bad(`You need ${cost} Sparks for ${count === 1 ? "a boost" : `${count} boosts`}.`);
      const sub = newId();
      await c.query("insert into spark_ledger(id, user_id, amount, reason, ref) values ($1,$2,$3,'boost',$4)", [newId(), me, -cost, sub]);
      await c.query(`insert into premium_subscriptions(id, user_id, provider, slots, status, current_period_end, note)
                     values ($1,$2,'sparks',$3,'active', now() + interval '365 days', 'Bought with Sparks')`, [sub, me, count]);
      await ensureSlots(c, sub, me, count);
    });
    const { toUser } = await import("../gateway.ts");
    toUser(me, "PREMIUM_UPDATE", {}); toUser(me, "SPARKS_UPDATE", {});
    return { ok: true, balance: await balanceOf(me) };
  });
}
