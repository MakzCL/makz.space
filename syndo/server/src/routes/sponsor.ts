import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { q, q1 } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { config } from "../config.ts";
import { bad, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { checkoutTaxParams, stripe } from "./premium.ts";

/**
 * Sponsor the developer: a monthly Stripe subscription for an amount the sponsor picks (£1, £5, £10 or custom).
 * Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (the same webhook as Boosts). Sponsors get a badge they can hide.
 */
const READY = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
const NAME = process.env.SEND_SPONSOR_NAME || "makz";
export const SPONSOR = { presets: [100, 500, 1000], min: 100, max: 50000, currency: "gbp" } as const;

const ACTIVE = "status in ('active', 'past_due') and (current_period_end is null or current_period_end > now() - interval '3 days')";
export const isSponsor = async (userId: string) =>
  !!(await q1(`select 1 from sponsorships where user_id = $1 and show_badge and ${ACTIVE} limit 1`, [userId]));

async function upsertFromSubscription(sub: any, userId: string) {
  const amount = Number(sub.items?.data?.[0]?.price?.unit_amount ?? 0);
  const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status === "past_due" ? "past_due" : "canceled";
  await q(`insert into sponsorships(id, user_id, stripe_subscription, stripe_customer, amount_pence, status, current_period_end, ended_at)
           values ($1,$2,$3,$4,$5,$6, to_timestamp($7), case when $6 = 'canceled' then now() end)
           on conflict (stripe_subscription) do update set amount_pence = excluded.amount_pence, status = excluded.status,
             current_period_end = excluded.current_period_end, ended_at = case when excluded.status = 'canceled' then coalesce(sponsorships.ended_at, now()) else null end`,
    [newId(), userId, sub.id, String(sub.customer ?? ""), Math.min(SPONSOR.max, Math.max(SPONSOR.min, amount || SPONSOR.min)), status, sub.current_period_end ?? null]);
  const { toUser } = await import("../gateway.ts");
  toUser(userId, "SPONSOR_UPDATE", {});
}

/** Called from the Stripe webhook; returns true when the event was a sponsorship's. */
export async function handleSponsorEvent(ev: any): Promise<boolean> {
  const obj = ev.data?.object ?? {};
  if (ev.type === "checkout.session.completed" && obj.metadata?.kind === "sponsor") {
    const userId = String(obj.metadata.user_id ?? obj.client_reference_id ?? "");
    if (/^\d+$/.test(userId) && obj.subscription) await upsertFromSubscription(await stripe(`subscriptions/${obj.subscription}`, {}, "GET"), userId);
    return true;
  }
  if ((ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted") && obj.metadata?.kind === "sponsor") {
    const userId = String(obj.metadata.user_id ?? "");
    if (/^\d+$/.test(userId)) await upsertFromSubscription(ev.type === "customer.subscription.deleted" ? { ...obj, status: "canceled" } : obj, userId);
    return true;
  }
  return false;
}

export async function sponsorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/sponsor", async (req) => {
    const mine = await q1<any>(`select amount_pence, currency, status, current_period_end, show_badge, started_at from sponsorships
      where user_id = $1 and ${ACTIVE} order by started_at desc limit 1`, [uid(req)]);
    return { available: READY(), recipient: NAME, ...SPONSOR, mine: mine ?? null };
  });

  app.post("/api/sponsor/checkout", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    if (!READY()) throw bad("Sponsoring isn't set up yet.");
    const me = uid(req);
    const { amount_pence } = z.object({ amount_pence: z.number().int().min(SPONSOR.min).max(SPONSOR.max) }).parse(req.body);
    if (await q1(`select 1 from sponsorships where user_id = $1 and ${ACTIVE}`, [me])) throw bad("You're already a sponsor. Use Manage to change the amount or cancel.");
    const back = `${config.publicUrl}/channels/@me`;
    const s = await stripe("checkout/sessions", {
      mode: "subscription", client_reference_id: me, ...checkoutTaxParams(),
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": SPONSOR.currency,
      "line_items[0][price_data][unit_amount]": String(amount_pence),
      "line_items[0][price_data][recurring][interval]": "month",
      "line_items[0][price_data][product_data][name]": `Sponsor ${NAME} on SEND`,
      "line_items[0][price_data][product_data][description]": "A monthly gift that keeps SEND free, with no ads. Comes with a Sponsor badge.",
      "line_items[0][price_data][product_data][images][0]": "https://send.makz.space/assets/sponsor.png",
      // Look like SEND: dark background, SEND pink buttons, rounded corners, the S icon.
      "branding_settings[display_name]": "SEND",
      "branding_settings[background_color]": "#0B1020",
      "branding_settings[button_color]": "#FF5C8A",
      "branding_settings[border_style]": "rounded",
      "branding_settings[font_family]": "inter",
      "branding_settings[icon][type]": "url",
      "branding_settings[icon][url]": "https://send.makz.space/assets/send-icon-512.png",
      "custom_text[submit][message]": "Thank you for supporting SEND. You can cancel any time in Settings, Sponsor.",
      // Always charge in pounds (Stripe's currency conversion adds about 4% for the sponsor).
      "adaptive_pricing[enabled]": "false",
      "metadata[kind]": "sponsor", "metadata[user_id]": me,
      "subscription_data[metadata][kind]": "sponsor", "subscription_data[metadata][user_id]": me,
      success_url: `${back}?sponsor=thanks`, cancel_url: `${back}?sponsor=cancelled`,
    });
    return { url: s.url };
  });

  /** Stripe's billing page: change card, change amount (via cancel and re-sponsor) or cancel. */
  app.post("/api/sponsor/portal", async (req) => {
    if (!READY()) throw bad("Sponsoring isn't set up yet.");
    const row = await q1<any>("select stripe_customer from sponsorships where user_id = $1 and stripe_customer <> '' order by started_at desc limit 1", [uid(req)]);
    if (!row) throw notFound("Sponsorship");
    const p = await stripe("billing_portal/sessions", { customer: row.stripe_customer, return_url: `${config.publicUrl}/channels/@me?sponsor=manage` });
    return { url: p.url };
  });

  app.patch("/api/sponsor", async (req) => {
    const { show_badge } = z.object({ show_badge: z.boolean() }).parse(req.body);
    await q(`update sponsorships set show_badge = $2 where user_id = $1`, [uid(req), show_badge]);
    return { ok: true };
  });
}
