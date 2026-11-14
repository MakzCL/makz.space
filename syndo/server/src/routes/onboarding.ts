import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { P, type Onboarding } from "@send/shared";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { bad, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { onlineMembers, toGuild } from "../gateway.ts";
import { requireGuild } from "../perms.ts";
import { mediaUrl } from "../serialize.ts";

/**
 * Onboarding (rules screening, a welcome screen, and questions that hand out roles)
 * and Server Discovery (a public directory of servers that opted in).
 */

const ID = z.string().regex(/^\d{1,20}$/);
export const DISCOVERY_CATEGORIES = ["gaming", "music", "education", "science", "entertainment", "creative", "technology", "anime", "sports", "community", "language", "other"] as const;

const ONBOARDING = z.object({
  enabled: z.boolean(),
  default_channel_ids: z.array(ID).max(50).default([]),
  prompts: z.array(z.object({
    id: z.string().max(20).optional(),
    title: z.string().trim().min(1).max(100),
    single_select: z.boolean().default(false),
    required: z.boolean().default(false),
    options: z.array(z.object({ id: z.string().max(20).optional(), title: z.string().trim().min(1).max(50), description: z.string().max(100).nullish(), emoji: z.string().max(64).nullish(), role_ids: z.array(ID).max(10).default([]), channel_ids: z.array(ID).max(20).default([]) })).min(1).max(25),
  })).max(15).default([]),
  welcome: z.object({ description: z.string().max(300), channels: z.array(z.object({ channel_id: ID, description: z.string().max(60), emoji: z.string().max(64).nullish() })).max(5) }).nullable().default(null),
  screening: z.object({ enabled: z.boolean(), description: z.string().max(300).default(""), rules: z.array(z.string().trim().min(1).max(300)).max(16) }).nullable().default(null),
});

const out = (r: any): Onboarding => ({
  enabled: !!r?.enabled, default_channel_ids: (r?.default_channel_ids ?? []).map(String), prompts: r?.prompts ?? [], welcome: r?.welcome ?? null, screening: r?.screening ?? null,
});

export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { id: string } }>("/api/guilds/:id/onboarding", async (req) => {
    await requireGuild(uid(req), req.params.id);
    return out(await q1<any>("select * from guild_onboarding where guild_id = $1", [req.params.id]));
  });

  app.put<{ Params: { id: string } }>("/api/guilds/:id/onboarding", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const b = ONBOARDING.parse(req.body);
    const roleIds = new Set(ctx.roles.map((r) => r.id));
    for (const p of b.prompts) for (const o of p.options) if (o.role_ids.some((r) => !roleIds.has(r) || r === ctx.guild.id)) throw bad("One of the roles doesn't exist.");
    const prompts = b.prompts.map((p) => ({ ...p, id: p.id ?? newId(), options: p.options.map((o) => ({ ...o, id: o.id ?? newId(), description: o.description ?? null, emoji: o.emoji ?? null })) }));
    if (b.enabled && b.default_channel_ids.length < 1 && !prompts.length) throw bad("Pick at least one default channel or add a question.");
    await q(`insert into guild_onboarding(guild_id, enabled, default_channel_ids, prompts, welcome, screening, updated_at) values ($1,$2,$3,$4,$5,$6, now())
      on conflict (guild_id) do update set enabled = excluded.enabled, default_channel_ids = excluded.default_channel_ids, prompts = excluded.prompts, welcome = excluded.welcome, screening = excluded.screening, updated_at = now()`,
      [ctx.guild.id, b.enabled, b.default_channel_ids, JSON.stringify(prompts), b.welcome ? JSON.stringify(b.welcome) : null, b.screening ? JSON.stringify(b.screening) : null]);
    const { audit } = await import("./guilds.ts");
    await audit(ctx.guild.id, uid(req), "onboarding_update", ctx.guild.id);
    const o = out(await q1<any>("select * from guild_onboarding where guild_id = $1", [ctx.guild.id]));
    await toGuild(ctx.guild.id, "GUILD_ONBOARDING_UPDATE", { guild_id: ctx.guild.id, onboarding: o });
    return o;
  });

  /** A member accepts the rules and answers the questions; they get the chosen roles. */
  app.post<{ Params: { id: string } }>("/api/guilds/:id/onboarding/complete", async (req) => {
    const me = uid(req);
    const ctx = await requireGuild(me, req.params.id);
    const b = z.object({ accept_rules: z.boolean().default(false), answers: z.record(z.string(), z.array(z.string().max(20)).max(25)).default({}) }).parse(req.body);
    const o = out(await q1<any>("select * from guild_onboarding where guild_id = $1", [ctx.guild.id]));
    if (o.screening?.enabled && !b.accept_rules && (ctx.member as any).pending) throw bad("Accept the rules to continue.");
    const roles = new Set<string>();
    for (const p of o.prompts) {
      const picked = (b.answers[p.id] ?? []).filter((id) => p.options.some((x) => x.id === id));
      if (p.required && o.enabled && !picked.length) throw bad(`Answer “${p.title}”.`);
      if (p.single_select && picked.length > 1) throw bad(`Pick one answer for “${p.title}”.`);
      for (const id of picked) for (const r of p.options.find((x) => x.id === id)!.role_ids) roles.add(r);
    }
    const valid = new Set(ctx.roles.map((r) => r.id));
    await tx(async (c) => {
      await c.query("update members set pending = false, onboarded_at = now() where guild_id = $1 and user_id = $2", [ctx.guild.id, me]);
      for (const r of roles) if (valid.has(r) && r !== ctx.guild.id) await c.query("insert into member_roles(guild_id, user_id, role_id) values ($1,$2,$3) on conflict do nothing", [ctx.guild.id, me, r]);
    });
    const { memberOut, resyncGuild } = await import("./guilds.ts");
    await toGuild(ctx.guild.id, "GUILD_MEMBER_UPDATE", await memberOut(ctx.guild.id, me));
    await resyncGuild(ctx.guild.id, [me]);
    return { ok: true, roles: [...roles] };
  });

  /* ------------------------------------------------------ discovery -- */
  app.patch<{ Params: { id: string } }>("/api/guilds/:id/discovery", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const b = z.object({
      discoverable: z.boolean().optional(),
      category: z.enum(DISCOVERY_CATEGORIES).nullable().optional(),
      keywords: z.array(z.string().trim().toLowerCase().min(2).max(30)).max(10).optional(),
    }).parse(req.body);
    if (b.discoverable) {
      const g = await q1<any>("select description, (select count(*)::int from members where guild_id = $1) as n from guilds where id = $1", [ctx.guild.id]);
      if (!g?.description || g.description.length < 10) throw bad("Add a server description (Overview) before listing it in Discovery.");
      if (g.n < 3) throw bad("A server needs at least 3 members to be listed in Discovery.");
    }
    await q("update guilds set discoverable = coalesce($2, discoverable), discovery_category = case when $3::boolean then $4 else discovery_category end, discovery_keywords = coalesce($5, discovery_keywords) where id = $1",
      [ctx.guild.id, b.discoverable ?? null, b.category !== undefined, b.category ?? null, b.keywords ?? null]);
    const { resyncGuild } = await import("./guilds.ts");
    await resyncGuild(ctx.guild.id);
    return { ok: true };
  });

  app.get<{ Querystring: { q?: string; category?: string; offset?: string } }>("/api/discovery", async (req) => {
    const text = (req.query.q ?? "").trim().slice(0, 60);
    const cat = DISCOVERY_CATEGORIES.includes(req.query.category as any) ? req.query.category : null;
    const offset = Math.min(Math.max(Number(req.query.offset ?? 0) || 0, 0), 1000);
    const rows = await q<any>(`select g.id::text, g.name, g.icon_key, g.banner_key, g.description, g.discovery_category, g.discovery_keywords, g.vanity_code, g.premium_tier, g.tag,
        (select count(*)::int from members m where m.guild_id = g.id) as member_count,
        exists (select 1 from members m where m.guild_id = g.id and m.user_id = $4) as joined
      from guilds g where g.discoverable
        and ($1 = '' or g.name ilike '%' || $1 || '%' or g.description ilike '%' || $1 || '%' or $1 = any(g.discovery_keywords))
        and ($2::text is null or g.discovery_category = $2)
      order by member_count desc, g.id limit 24 offset $3`, [text, cat, offset, uid(req)]);
    const online = await Promise.all(rows.map((r) => onlineMembers(r.id).then((x) => x.length)));
    return rows.map((r, i) => ({
      id: r.id, name: r.name, icon: mediaUrl(r.icon_key), banner: mediaUrl(r.banner_key), description: r.description, category: r.discovery_category,
      keywords: r.discovery_keywords, member_count: r.member_count, online_count: online[i], premium_tier: r.premium_tier, tag: r.tag, joined: r.joined,
    }));
  });

  app.post<{ Params: { id: string } }>("/api/discovery/:id/join", async (req) => {
    const g = await q1<any>("select id::text from guilds where id = $1 and discoverable", [req.params.id]);
    if (!g) throw notFound("Server");
    const { addMember } = await import("./guilds.ts");
    await addMember(g.id, uid(req));
    return { ok: true, guild_id: g.id };
  });
}
