import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MessageType, boostLevelFor } from "@send/shared";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { config } from "../config.ts";
import { randomCode } from "../crypto.ts";
import { ApiError, bad, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { prefixedCols, prefixedUser } from "../serialize.ts";

/**
 * Server Boosts.
 *  - Paid: Stripe Checkout (monthly subscription, each subscription = 2 boosts per unit bought).
 *    Needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID; without them checkout says so.
 *  - Free: instance staff grant boosts to anyone (for a time or forever), or create codes.
 *    "free" codes give boosts without paying; "discount" codes take a percentage off checkout
 *    (100% = free through Stripe as well).
 * Each boost is a slot the user puts on a server. Level = how many active boosts a server has.
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const STRIPE_PRICE = process.env.STRIPE_PRICE_ID ?? "";
export const stripeReady = () => !!(STRIPE_KEY && STRIPE_PRICE);
const SLOTS_PER_UNIT = 2;
const ID = z.string().regex(/^\d{1,20}$/);

async function stripe(path: string, params: Record<string, string> = {}, method: "POST" | "GET" = "POST") {
  const body = new URLSearchParams(params).toString();
  const r = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && body ? `?${body}` : ""}`, {
    method, headers: { authorization: `Bearer ${STRIPE_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2024-06-20" },
    body: method === "POST" ? body : undefined, signal: AbortSignal.timeout(15000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(502, "payment_error", j?.error?.message ?? "The payment service didn't answer.");
  return j;
}

/** Recount a server's boosts and update its level (and its boosters' "since"). */
export async function recomputeGuild(guildId: string) {
  const before = await q1<any>("select premium_count, premium_tier, system_channel_id from guilds where id = $1", [guildId]);
  if (!before) return;
  const n = await q1<any>(`select count(*)::int as n from guild_boosts b join premium_subscriptions s on s.id = b.subscription_id
    where b.guild_id = $1 and s.status = 'active' and (s.current_period_end is null or s.current_period_end > now())`, [guildId]);
  const tier = boostLevelFor(n.n);
  await q("update guilds set premium_count = $2, premium_tier = $3 where id = $1", [guildId, n.n, tier]);
  await q(`update members m set premium_since = case when exists (select 1 from guild_boosts b join premium_subscriptions s on s.id = b.subscription_id
      where b.guild_id = m.guild_id and b.user_id = m.user_id and s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()))
      then coalesce(m.premium_since, now()) else null end where m.guild_id = $1`, [guildId]);
  if (tier !== before.premium_tier || n.n !== before.premium_count) {
    const { resyncGuild } = await import("./guilds.ts");
    await resyncGuild(guildId);
  }
  return { count: n.n, tier, levelUp: tier > before.premium_tier, channel: before.system_channel_id };
}

async function activeSubs(userId: string) {
  return q<any>(`select * from premium_subscriptions where user_id = $1 and status in ('active', 'past_due') and (current_period_end is null or current_period_end > now()) order by created_at`, [userId]);
}
/** Make sure a subscription has exactly `slots` boost rows. */
async function ensureSlots(c: any, subId: string, userId: string, slots: number) {
  const have = (await c.query("select count(*)::int as n from guild_boosts where subscription_id = $1", [subId])).rows[0].n;
  for (let i = have; i < slots; i++) await c.query("insert into guild_boosts(id, subscription_id, user_id) values ($1,$2,$3)", [newId(), subId, userId]);
  if (have > slots) await c.query("delete from guild_boosts where id in (select id from guild_boosts where subscription_id = $1 order by guild_id nulls first limit $2)", [subId, have - slots]);
}
async function endSubscription(subId: string, status: "canceled" | "past_due") {
  const guilds = await q<any>("select distinct guild_id::text from guild_boosts where subscription_id = $1 and guild_id is not null", [subId]);
  await q("update premium_subscriptions set status = $2 where id = $1", [subId, status]);
  for (const g of guilds) await recomputeGuild(g.guild_id);
}

/** Expire time-limited grants and codes (maintenance job). */
export async function expirePremium() {
  const rows = await q<any>("select id::text from premium_subscriptions where status = 'active' and current_period_end is not null and current_period_end < now() and provider in ('grant', 'code')");
  for (const r of rows) await endSubscription(r.id, "canceled");
}

async function requireStaff(req: FastifyRequest) {
  const u = await q1<any>("select staff from users where id = $1", [uid(req)]);
  const env = (process.env.SEND_STAFF_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!u?.staff && !env.includes(uid(req))) throw forbidden("Staff only.");
}

export async function premiumRoutes(app: FastifyInstance) {
  /* --------------------------------------------------- Stripe webhook (raw body) -- */
  await app.register(async (hook) => {
    hook.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    hook.post("/api/stripe/webhook", async (req) => {
      if (!STRIPE_WEBHOOK) throw notFound("Webhook");
      const raw = req.body as Buffer;
      const sig = String(req.headers["stripe-signature"] ?? "");
      const t = /t=(\d+)/.exec(sig)?.[1];
      const v1 = [...sig.matchAll(/v1=([0-9a-f]+)/g)].map((m) => m[1]!);
      if (!t || !v1.length || Math.abs(Date.now() / 1000 - Number(t)) > 600) throw bad("Bad signature.");
      const want = createHmac("sha256", STRIPE_WEBHOOK).update(`${t}.${raw.toString("utf8")}`).digest("hex");
      if (!v1.some((v) => v.length === want.length && timingSafeEqual(Buffer.from(v), Buffer.from(want)))) throw bad("Bad signature.");
      const ev = JSON.parse(raw.toString("utf8"));
      const obj = ev.data?.object ?? {};
      if (ev.type === "checkout.session.completed" && obj.mode === "subscription") {
        const userId = String(obj.metadata?.user_id ?? obj.client_reference_id ?? "");
        const units = Math.max(1, Math.min(10, Number(obj.metadata?.units ?? 1)));
        if (!/^\d+$/.test(userId)) return { ok: true };
        const sub = await stripe(`subscriptions/${obj.subscription}`, {}, "GET");
        const id = newId();
        await tx(async (c) => {
          const ins = await c.query(`insert into premium_subscriptions(id, user_id, provider, provider_ref, slots, status, current_period_end) values ($1,$2,'stripe',$3,$4,'active', to_timestamp($5))
            on conflict (provider, provider_ref) where provider_ref is not null do update set status = 'active', current_period_end = excluded.current_period_end returning id::text`,
            [id, userId, obj.subscription, units * SLOTS_PER_UNIT, sub.current_period_end ?? Math.floor(Date.now() / 1000) + 31 * 86400]);
          await ensureSlots(c, ins.rows[0].id, userId, units * SLOTS_PER_UNIT);
        });
        const { toUser } = await import("../gateway.ts");
        toUser(userId, "PREMIUM_UPDATE", {});
        if (obj.metadata?.code) await q("update premium_codes set uses = uses + 1 where code = $1", [obj.metadata.code]).catch(() => {});
      } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") {
        const s = await q1<any>("select id::text, user_id::text from premium_subscriptions where provider = 'stripe' and provider_ref = $1", [obj.id]);
        if (s) {
          if (ev.type === "customer.subscription.deleted" || obj.status === "canceled" || obj.status === "unpaid") await endSubscription(s.id, "canceled");
          else {
            await q("update premium_subscriptions set status = $2, current_period_end = to_timestamp($3) where id = $1", [s.id, obj.status === "past_due" ? "past_due" : "active", obj.current_period_end]);
            for (const g of await q<any>("select distinct guild_id::text from guild_boosts where subscription_id = $1 and guild_id is not null", [s.id])) await recomputeGuild(g.guild_id);
          }
          const { toUser } = await import("../gateway.ts");
          toUser(s.user_id, "PREMIUM_UPDATE", {});
        }
      }
      return { received: true };
    });
  });

  await app.register(async (r) => {
    r.addHook("preHandler", requireUser);

    r.get("/api/premium", async (req) => {
      const me = uid(req);
      const subs = await q<any>("select id::text, provider, slots, status, current_period_end, created_at, note from premium_subscriptions where user_id = $1 order by created_at desc", [me]);
      const boosts = await q<any>(`select b.id::text, b.subscription_id::text, b.guild_id::text, b.applied_at, b.cooldown_until, g.name as guild_name, s.status, s.current_period_end
        from guild_boosts b join premium_subscriptions s on s.id = b.subscription_id left join guilds g on g.id = b.guild_id
        where b.user_id = $1 and s.status in ('active','past_due') and (s.current_period_end is null or s.current_period_end > now()) order by b.id`, [me]);
      return { checkout_available: stripeReady(), slots_per_purchase: SLOTS_PER_UNIT, subscriptions: subs, boosts, staff: !!(await q1<any>("select staff from users where id = $1", [me]))?.staff };
    });

    /** Start a Stripe checkout (optionally with a discount code). */
    r.post("/api/premium/checkout", async (req) => {
      const me = uid(req);
      const b = z.object({ units: z.number().int().min(1).max(10).default(1), code: z.string().trim().max(40).optional() }).parse(req.body ?? {});
      let coupon: string | null = null, codeRow: any = null;
      if (b.code) {
        codeRow = await validCode(b.code, me);
        if (codeRow.kind === "free") throw bad("That code gives free boosts: use Redeem instead.");
      }
      if (!stripeReady()) throw new ApiError(503, "payments_unavailable", "Paid boosts aren't set up on this server yet. A free code from the team works without payment.");
      if (codeRow) {
        coupon = `send-${String(codeRow.code).toLowerCase()}`;
        await stripe(`coupons/${coupon}`, {}, "GET").catch(() => stripe("coupons", { id: coupon!, percent_off: String(codeRow.percent_off ?? 100), duration: codeRow.duration_days ? "repeating" : "forever", ...(codeRow.duration_days ? { duration_in_months: String(Math.max(1, Math.round(codeRow.duration_days / 30))) } : {}) }));
      }
      const s = await stripe("checkout/sessions", {
        mode: "subscription", "line_items[0][price]": STRIPE_PRICE, "line_items[0][quantity]": String(b.units),
        success_url: `${config.publicUrl}/settings/boosts?status=success`, cancel_url: `${config.publicUrl}/settings/boosts?status=cancel`,
        client_reference_id: me, "metadata[user_id]": me, "metadata[units]": String(b.units), "subscription_data[metadata][user_id]": me,
        ...(coupon ? { "discounts[0][coupon]": coupon, "metadata[code]": String(codeRow.code) } : { allow_promotion_codes: "true" }),
      });
      return { url: s.url };
    });

    r.post("/api/premium/portal", async (req) => {
      if (!stripeReady()) throw new ApiError(503, "payments_unavailable", "Paid boosts aren't set up on this server yet.");
      const sub = await q1<any>("select provider_ref from premium_subscriptions where user_id = $1 and provider = 'stripe' order by created_at desc limit 1", [uid(req)]);
      if (!sub) throw bad("You don't have a paid subscription.");
      const s = await stripe(`subscriptions/${sub.provider_ref}`, {}, "GET");
      const p = await stripe("billing_portal/sessions", { customer: s.customer, return_url: `${config.publicUrl}/settings/boosts` });
      return { url: p.url };
    });

    async function validCode(code: string, me: string) {
      const c = await q1<any>("select * from premium_codes where code = $1", [code]);
      if (!c || (c.expires_at && new Date(c.expires_at) < new Date()) || (c.max_uses > 0 && c.uses >= c.max_uses)) throw bad("That code isn't valid.");
      if (await q1("select 1 from premium_code_redemptions where code = $1 and user_id = $2", [c.code, me])) throw bad("You've already used that code.");
      return c;
    }

    /** Redeem a free code (developer / giveaway codes): boosts without payment. */
    r.post("/api/premium/redeem", async (req) => {
      const me = uid(req);
      const { code } = z.object({ code: z.string().trim().min(4).max(40) }).parse(req.body);
      const c = await validCode(code, me);
      if (c.kind !== "free") throw bad("That's a discount code: use it at checkout.");
      const id = newId();
      await tx(async (cx) => {
        const u = await cx.query("update premium_codes set uses = uses + 1 where code = $1 and (max_uses = 0 or uses < max_uses) returning 1", [c.code]);
        if (!u.rowCount) throw bad("That code has been used up.");
        await cx.query("insert into premium_code_redemptions(code, user_id) values ($1,$2)", [c.code, me]);
        await cx.query(`insert into premium_subscriptions(id, user_id, provider, provider_ref, slots, status, current_period_end, note)
          values ($1,$2,'code',null,$3,'active', case when $4::int is null then null else now() + make_interval(days => $4) end, $5)`, [id, me, c.slots, c.duration_days ?? null, `Code ${c.code}`]);
        await ensureSlots(cx, id, me, c.slots);
      });
      return { ok: true, slots: c.slots, days: c.duration_days ?? null };
    });

    /** Put a boost on a server, or take it off (moving a boost has a 7-day cooldown). */
    r.put<{ Params: { bid: string } }>("/api/premium/boosts/:bid", async (req) => {
      const me = uid(req);
      const { guild_id } = z.object({ guild_id: ID }).parse(req.body);
      const b = await q1<any>(`select b.* from guild_boosts b join premium_subscriptions s on s.id = b.subscription_id where b.id = $1 and b.user_id = $2 and s.status = 'active'`, [req.params.bid, me]);
      if (!b) throw notFound("Boost");
      if (!(await q1("select 1 from members where guild_id = $1 and user_id = $2", [guild_id, me]))) throw bad("Join the server first.");
      if (b.cooldown_until && new Date(b.cooldown_until) > new Date()) throw bad(`This boost can be moved again on ${new Date(b.cooldown_until).toDateString()}.`);
      const prev = b.guild_id ? String(b.guild_id) : null;
      await q("update guild_boosts set guild_id = $2, applied_at = now(), cooldown_until = case when $3::bigint is not null then now() + interval '7 days' else null end where id = $1", [b.id, guild_id, prev]);
      if (prev && prev !== guild_id) await recomputeGuild(prev);
      const res = await recomputeGuild(guild_id);
      if (res?.channel) {
        const { createSystemMessage } = await import("./messages.ts");
        await createSystemMessage(res.channel, guild_id, me, res.levelUp ? MessageType.BOOST_TIER : MessageType.BOOST, String(res.tier));
      }
      return { ok: true, premium_count: res?.count, premium_tier: res?.tier };
    });
    r.delete<{ Params: { bid: string } }>("/api/premium/boosts/:bid", async (req) => {
      const b = await q1<any>("select * from guild_boosts where id = $1 and user_id = $2", [req.params.bid, uid(req)]);
      if (!b) throw notFound("Boost");
      if (!b.guild_id) return { ok: true };
      await q("update guild_boosts set guild_id = null, applied_at = null, cooldown_until = now() + interval '7 days' where id = $1", [b.id]);
      await recomputeGuild(String(b.guild_id));
      return { ok: true };
    });

    /** Who boosts a server (members see this in the server's boost panel). */
    r.get<{ Params: { id: string } }>("/api/guilds/:id/boosts", async (req) => {
      if (!(await q1("select 1 from members where guild_id = $1 and user_id = $2", [req.params.id, uid(req)]))) throw notFound("Server");
      const rows = await q<any>(`select ${prefixedCols("u", "a_")}, count(*)::int as boosts, min(b.applied_at) as since from guild_boosts b join premium_subscriptions s on s.id = b.subscription_id
        join users u on u.id = b.user_id where b.guild_id = $1 and s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()) group by u.id order by since`, [req.params.id]);
      return rows.map((r) => ({ user: prefixedUser(r, "a_"), boosts: r.boosts, since: r.since }));
    });

    /* ------------------------------------------------------------------ staff -- */
    r.get("/api/staff/premium", async (req) => {
      await requireStaff(req);
      const grants = await q<any>(`select s.id::text, s.provider, s.slots, s.status, s.current_period_end, s.note, s.created_at, ${prefixedCols("u", "a_")}
        from premium_subscriptions s join users u on u.id = s.user_id where s.provider in ('grant','code') order by s.created_at desc limit 200`);
      const codes = await q<any>("select code, kind, percent_off, slots, duration_days, max_uses, uses, note, expires_at, created_at from premium_codes order by created_at desc limit 200");
      return { grants: grants.map((g) => ({ ...g, user: prefixedUser(g, "a_") })), codes, checkout_available: stripeReady() };
    });
    r.post("/api/staff/grants", async (req) => {
      await requireStaff(req);
      const b = z.object({ user: z.string().trim().min(1).max(40), slots: z.number().int().min(1).max(100).default(2), days: z.number().int().min(1).max(3650).nullable().default(null), note: z.string().max(200).optional() }).parse(req.body);
      const u = await q1<any>("select id::text from users where (id::text = $1 or username = lower($1)) and deleted_at is null and not bot", [b.user.replace(/^@/, "")]);
      if (!u) throw notFound("User");
      const id = newId();
      await tx(async (c) => {
        await c.query(`insert into premium_subscriptions(id, user_id, provider, slots, status, current_period_end, granted_by, note) values ($1,$2,'grant',$3,'active', case when $4::int is null then null else now() + make_interval(days => $4) end, $5, $6)`,
          [id, u.id, b.slots, b.days, uid(req), b.note ?? null]);
        await ensureSlots(c, id, u.id, b.slots);
      });
      const { toUser } = await import("../gateway.ts");
      toUser(u.id, "PREMIUM_UPDATE", {});
      return { ok: true, id };
    });
    r.delete<{ Params: { id: string } }>("/api/staff/grants/:id", async (req) => {
      await requireStaff(req);
      const s = await q1<any>("select id::text, user_id::text from premium_subscriptions where id = $1 and provider in ('grant','code')", [req.params.id]);
      if (!s) throw notFound("Grant");
      await endSubscription(s.id, "canceled");
      const { toUser } = await import("../gateway.ts");
      toUser(s.user_id, "PREMIUM_UPDATE", {});
      return { ok: true };
    });
    r.post("/api/staff/codes", async (req) => {
      await requireStaff(req);
      const b = z.object({
        code: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/).optional(), kind: z.enum(["free", "discount"]), percent_off: z.number().int().min(1).max(100).optional(),
        slots: z.number().int().min(1).max(100).default(2), duration_days: z.number().int().min(1).max(3650).nullable().default(null), max_uses: z.number().int().min(0).max(100000).default(1),
        expires_at: z.string().datetime({ offset: true }).nullable().optional(), note: z.string().max(200).optional(),
      }).parse(req.body);
      if (b.kind === "discount" && !b.percent_off) throw bad("Set how much the code takes off.");
      const code = b.code ?? `SEND-${randomCode(4)}-${randomCode(4)}`.toUpperCase();
      await q(`insert into premium_codes(code, kind, percent_off, slots, duration_days, max_uses, note, created_by, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [code, b.kind, b.kind === "discount" ? b.percent_off : null, b.slots, b.duration_days, b.max_uses, b.note ?? null, uid(req), b.expires_at ?? null]).catch((e) => { if (e?.code === "23505") throw bad("That code already exists."); throw e; });
      return { code };
    });
    r.delete<{ Params: { code: string } }>("/api/staff/codes/:code", async (req) => {
      await requireStaff(req);
      await q("delete from premium_codes where code = $1", [req.params.code]);
      return { ok: true };
    });
  });
}
