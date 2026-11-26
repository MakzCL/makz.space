import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MessageType, P, has, type AutomodRule } from "@send/shared";
import { q, q1 } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { bad, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { getChannel, loadMember, requireGuild, type ChanRow } from "../perms.ts";
import { toGuild } from "../gateway.ts";

/**
 * AutoMod: per-server rules checked before a message is stored.
 *  - keyword (1): words/phrases with * wildcards, optional regex, allow-list
 *  - spam (3): the same message sent again and again
 *  - keyword preset (4): built-in lists (profanity, sexual content, slurs)
 *  - mention spam (5): too many unique mentions in one message
 * Actions: 1 block the message (optional custom reply), 2 send an alert to a channel, 3 time the author out.
 * Admins and people with Manage Server are never filtered; rules can exempt roles and channels.
 */

const PRESETS: Record<string, string[]> = {
  profanity: ["fuck*", "*fucking*", "shit*", "bullshit", "bitch*", "asshole*", "bastard*", "cunt*", "dickhead*", "motherfuck*", "wanker*", "twat*", "piss off", "dumbass*", "jackass*"],
  sexual: ["porn*", "*porno*", "nude*", "nudes", "blowjob*", "handjob*", "dildo*", "cum*shot*", "*hentai*", "onlyfans", "sext*", "xxx", "boobs", "tits", "pussy*", "cock*", "penis*", "vagina*"],
  slurs: ["nigg*", "fagg*", "fag", "retard*", "tranny*", "kike*", "spic", "spics", "chink*", "wetback*", "gook*", "dyke*", "coon", "coons"],
};

const ruleCache = new Map<string, { at: number; rules: any[] }>();
const recent = new Map<string, { text: string; times: number[] }>();

async function rulesFor(guildId: string) {
  const c = ruleCache.get(guildId);
  if (c && Date.now() - c.at < 30_000) return c.rules;
  const rules = await q<any>("select * from automod_rules where guild_id = $1 and enabled", [guildId]);
  ruleCache.set(guildId, { at: Date.now(), rules });
  return rules;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Discord-style keyword: "word" whole word, "*word" suffix, "word*" prefix, "*word*" anywhere. */
export function keywordRegex(k: string): RegExp | null {
  const t = k.trim().toLowerCase();
  if (!t || t.length > 60) return null;
  const start = t.startsWith("*"), end = t.endsWith("*");
  const core = esc(t.replace(/^\*|\*$/g, "")).replace(/\\\*/g, "\\S*");
  if (!core) return null;
  return new RegExp(`${start ? "" : "(?<![\\p{L}\\p{N}])"}${core}${end ? "" : "(?![\\p{L}\\p{N}])"}`, "iu");
}
/** User regexes: short, and without nested quantifiers (no catastrophic backtracking). */
export function safeRegex(src: string): RegExp | null {
  if (src.length > 120 || /\([^)]*[+*][^)]*\)[+*{]/.test(src) || /\\[1-9]/.test(src)) return null;
  try { return new RegExp(src, "iu"); } catch { return null; }
}

export function matchKeywords(content: string, rule: { trigger_meta: AutomodRule["trigger_meta"]; trigger_type: number }): string | null {
  const text = content.normalize("NFKC");
  const allow = (rule.trigger_meta.allow ?? []).map(keywordRegex).filter(Boolean) as RegExp[];
  const words = rule.trigger_type === 4 ? (rule.trigger_meta.presets ?? []).flatMap((p) => PRESETS[p] ?? []) : (rule.trigger_meta.keywords ?? []);
  for (const k of words) {
    const re = keywordRegex(k);
    const m = re?.exec(text);
    if (m && !allow.some((a) => a.test(m[0]))) return m[0];
  }
  for (const r of rule.trigger_meta.regex ?? []) {
    const m = safeRegex(r)?.exec(text);
    if (m && !allow.some((a) => a.test(m[0]))) return m[0];
  }
  return null;
}

export async function checkAutomod(channel: ChanRow, userId: string, perms: bigint, content: string, mentionCount: number) {
  const result = { blocked: false, message: null as string | null, alerts: [] as { rule: any; matched: string; action: any }[], report: async (_m?: unknown) => {} };
  if (!channel.guild_id || has(perms, P.ADMINISTRATOR) || has(perms, P.MANAGE_GUILD)) return result;
  const rules = await rulesFor(channel.guild_id);
  if (!rules.length) return result;
  const member = await loadMember(channel.guild_id, userId);
  const roles = new Set(member?.roles ?? []);
  const parentId = channel.parent_id ? String(channel.parent_id) : null;
  const key = `${channel.guild_id}:${userId}`;
  const now = Date.now();
  const rec = recent.get(key);
  const norm = content.trim().toLowerCase();
  const repeats = rec && rec.text === norm ? rec.times.filter((t) => now - t < 30_000).length : 0;
  if (norm) recent.set(key, { text: norm, times: rec && rec.text === norm ? [...rec.times.filter((t) => now - t < 30_000), now] : [now] });
  if (recent.size > 20_000) recent.clear();
  const hits: { rule: any; matched: string }[] = [];
  for (const rule of rules) {
    if ((rule.exempt_roles ?? []).some((r: any) => roles.has(String(r)))) continue;
    if ((rule.exempt_channels ?? []).some((c: any) => String(c) === String(channel.id) || String(c) === parentId)) continue;
    let matched: string | null = null;
    if (rule.trigger_type === 1 || rule.trigger_type === 4) matched = content ? matchKeywords(content, rule) : null;
    else if (rule.trigger_type === 5) matched = mentionCount > Math.max(1, Number(rule.trigger_meta?.mention_limit ?? 20)) ? `${mentionCount} mentions` : null;
    else if (rule.trigger_type === 3) matched = norm.length > 0 && repeats >= 3 ? "repeated message" : null;
    if (matched) hits.push({ rule, matched });
  }
  for (const h of hits) for (const a of h.rule.actions ?? []) {
    if (a.type === 1) { result.blocked = true; result.message ??= a.message || null; }
    else result.alerts.push({ ...h, action: a });
  }
  result.report = async () => {
    for (const al of result.alerts) {
      if (al.action.type === 2 && al.action.channel_id) {
        const ch = await getChannel(String(al.action.channel_id));
        if (ch && ch.guild_id === channel.guild_id) {
          const { createSystemMessage } = await import("./messages.ts");
          await createSystemMessage(ch.id, ch.guild_id, userId, MessageType.AUTOMOD_ACTION,
            JSON.stringify({ rule: al.rule.name, matched: al.matched, channel_id: channel.id, content: content.slice(0, 1500), blocked: result.blocked }));
        }
      }
      if (al.action.type === 3) {
        const secs = Math.min(Math.max(Number(al.action.duration_seconds ?? 60), 60), 28 * 86400);
        await q("update members set communication_disabled_until = now() + make_interval(secs => $3) where guild_id = $1 and user_id = $2", [channel.guild_id, userId, secs]);
        const { memberOut } = await import("./guilds.ts");
        await toGuild(channel.guild_id!, "GUILD_MEMBER_UPDATE", await memberOut(channel.guild_id!, userId));
      }
    }
  };
  // Alerts are sent even when the message was blocked (moderators see what was stopped).
  if (result.blocked) await result.report();
  return result;
}

const RULE = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  trigger_type: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5)]),
  trigger_meta: z.object({
    keywords: z.array(z.string().trim().min(1).max(60)).max(1000).optional(),
    regex: z.array(z.string().min(1).max(120)).max(10).optional(),
    allow: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
    presets: z.array(z.enum(["profanity", "sexual", "slurs"])).max(3).optional(),
    mention_limit: z.number().int().min(1).max(50).optional(),
  }).default({}),
  actions: z.array(z.object({ type: z.union([z.literal(1), z.literal(2), z.literal(3)]), channel_id: z.string().regex(/^\d{1,20}$/).optional(), duration_seconds: z.number().int().min(60).max(28 * 86400).optional(), message: z.string().max(150).optional() })).min(1).max(3),
  exempt_roles: z.array(z.string().regex(/^\d{1,20}$/)).max(20).default([]),
  exempt_channels: z.array(z.string().regex(/^\d{1,20}$/)).max(50).default([]),
});

const ruleOut = (r: any): AutomodRule => ({ id: String(r.id), guild_id: String(r.guild_id), name: r.name, enabled: r.enabled, trigger_type: r.trigger_type, trigger_meta: r.trigger_meta ?? {}, actions: r.actions ?? [], exempt_roles: (r.exempt_roles ?? []).map(String), exempt_channels: (r.exempt_channels ?? []).map(String) });

export async function automodRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  app.get<{ Params: { id: string } }>("/api/guilds/:id/automod/rules", async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    return (await q<any>("select * from automod_rules where guild_id = $1 order by created_at", [req.params.id])).map(ruleOut);
  });
  app.post<{ Params: { id: string } }>("/api/guilds/:id/automod/rules", async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const b = RULE.parse(req.body);
    validate(b);
    const n = await q1<any>("select count(*)::int as n from automod_rules where guild_id = $1", [req.params.id]);
    if (n.n >= 20) throw bad("A server can have up to 20 AutoMod rules.");
    const r = await q1<any>(`insert into automod_rules(id, guild_id, name, enabled, trigger_type, trigger_meta, actions, exempt_roles, exempt_channels, creator_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [newId(), req.params.id, b.name, b.enabled, b.trigger_type, JSON.stringify(b.trigger_meta), JSON.stringify(b.actions), b.exempt_roles, b.exempt_channels, uid(req)]);
    ruleCache.delete(req.params.id);
    const { audit } = await import("./guilds.ts");
    await audit(req.params.id, uid(req), "automod_rule_create", r.id, { name: b.name });
    return ruleOut(r);
  });
  app.patch<{ Params: { id: string; rid: string } }>("/api/guilds/:id/automod/rules/:rid", async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const b = RULE.partial().parse(req.body);
    if (b.trigger_meta || b.actions) validate({ trigger_type: 1, trigger_meta: {}, actions: [{ type: 1 }], ...b } as any);
    const cur = await q1<any>("select * from automod_rules where id = $1 and guild_id = $2", [req.params.rid, req.params.id]);
    if (!cur) throw notFound("Rule");
    const r = await q1<any>(`update automod_rules set name = $3, enabled = $4, trigger_meta = $5, actions = $6, exempt_roles = $7, exempt_channels = $8 where id = $1 and guild_id = $2 returning *`,
      [req.params.rid, req.params.id, b.name ?? cur.name, b.enabled ?? cur.enabled, JSON.stringify(b.trigger_meta ?? cur.trigger_meta), JSON.stringify(b.actions ?? cur.actions), b.exempt_roles ?? cur.exempt_roles, b.exempt_channels ?? cur.exempt_channels]);
    ruleCache.delete(req.params.id);
    return ruleOut(r);
  });
  app.delete<{ Params: { id: string; rid: string } }>("/api/guilds/:id/automod/rules/:rid", async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    await q("delete from automod_rules where id = $1 and guild_id = $2", [req.params.rid, req.params.id]);
    ruleCache.delete(req.params.id);
    return { ok: true };
  });
  /** Try a message against the rules without sending it (the settings page's tester). */
  app.post<{ Params: { id: string } }>("/api/guilds/:id/automod/test", async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const { content } = z.object({ content: z.string().max(4000) }).parse(req.body);
    const rules = await q<any>("select * from automod_rules where guild_id = $1 and enabled and trigger_type in (1, 4)", [req.params.id]);
    return { matches: rules.map((r) => ({ rule: r.name, matched: matchKeywords(content, r) })).filter((m) => m.matched) };
  });
}

function validate(b: z.infer<typeof RULE>) {
  for (const r of b.trigger_meta.regex ?? []) if (!safeRegex(r)) throw bad(`This pattern isn't allowed: ${r.slice(0, 40)}`);
  if (b.trigger_type === 1 && !(b.trigger_meta.keywords?.length || b.trigger_meta.regex?.length)) throw bad("Add at least one word or pattern.");
  if (b.trigger_type === 4 && !b.trigger_meta.presets?.length) throw bad("Pick at least one list.");
  for (const a of b.actions) if (a.type === 2 && !a.channel_id) throw bad("Choose a channel for alerts.");
}
