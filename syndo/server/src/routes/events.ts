import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChannelType, EventStatus, P, has, type GuildEvent } from "@send/shared";
import { q, q1 } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { bad, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { toGuild, toUser } from "../gateway.ts";
import { getChannel, permsFor, requireGuild } from "../perms.ts";
import { mediaUrl, prefixedCols, prefixedUser } from "../serialize.ts";
import * as storage from "../storage.ts";

/**
 * Scheduled events: in a stage (1) or voice (2) channel, or somewhere else (3, with a location).
 * People mark themselves "Interested" and are notified when it starts. External events start and
 * end on their own; channel events are started by a host (or automatically 15 minutes late).
 * Recurring events make their next occurrence when one ends.
 */

const ID = z.string().regex(/^\d{1,20}$/);

async function eventsOut(rows: any[], viewer: string): Promise<GuildEvent[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const counts = await q<any>("select event_id::text, count(*)::int as n, bool_or(user_id = $2) as me from guild_event_users where event_id = any($1::bigint[]) group by event_id", [ids, viewer]);
  return rows.map((r) => {
    const c = counts.find((x) => x.event_id === String(r.id));
    return {
      id: String(r.id), guild_id: String(r.guild_id), channel_id: r.channel_id ? String(r.channel_id) : null, creator: prefixedUser(r, "a_"),
      name: r.name, description: r.description, entity_type: r.entity_type, location: r.location, start_at: r.start_at, end_at: r.end_at,
      status: r.status, image: mediaUrl(r.image_key), recurrence: r.recurrence, user_count: c?.n ?? 0, me: !!c?.me, created_at: r.created_at,
    };
  });
}
const SELECT = `select e.*, ${prefixedCols("u", "a_")} from guild_events e left join users u on u.id = e.creator_id`;

/** Events a member may see: channel events only if they can see the channel. */
async function visible(viewer: string, rows: any[]) {
  const out: any[] = [];
  for (const r of rows) {
    if (!r.channel_id) { out.push(r); continue; }
    const ch = await getChannel(String(r.channel_id));
    if (ch && has(await permsFor(viewer, ch), P.VIEW_CHANNEL)) out.push(r);
  }
  return out;
}

async function broadcast(guildId: string, row: any, t = "GUILD_EVENT_UPDATE") {
  const r = await q1<any>(`${SELECT} where e.id = $1`, [row.id]);
  if (!r) return toGuild(guildId, "GUILD_EVENT_DELETE", { id: String(row.id), guild_id: guildId });
  await toGuild(guildId, t, async (u: string) => (await visible(u, [r])).length ? (await eventsOut([r], u))[0] : null);
}

function nextOccurrence(start: Date, rec: string): Date {
  const d = new Date(start);
  if (rec === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (rec === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (rec === "biweekly") d.setUTCDate(d.getUTCDate() + 14);
  else if (rec === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

async function setStatus(row: any, status: number, by: string | null) {
  await q("update guild_events set status = $2 where id = $1", [row.id, status]);
  const guildId = String(row.guild_id);
  await broadcast(guildId, row);
  if (status === EventStatus.ACTIVE) {
    // Tell interested people it's starting.
    const users = (await q<any>("select user_id::text from guild_event_users where event_id = $1", [row.id])).map((r) => r.user_id);
    for (const u of users) toUser(u, "GUILD_EVENT_START", { id: String(row.id), guild_id: guildId, name: row.name, channel_id: row.channel_id ? String(row.channel_id) : null });
    const { sendPush } = await import("../notify.ts");
    const g = await q1<any>("select name from guilds where id = $1", [guildId]);
    await sendPush(users, JSON.stringify({ title: `${row.name} is starting`, body: g?.name ?? "", tag: `event-${row.id}`, url: row.channel_id ? `/channels/${guildId}/${row.channel_id}` : `/channels/${guildId}` })).catch(() => {});
  }
  if ((status === EventStatus.COMPLETED) && row.recurrence) {
    const start = nextOccurrence(new Date(row.start_at), row.recurrence);
    const len = row.end_at ? new Date(row.end_at).getTime() - new Date(row.start_at).getTime() : null;
    const id = newId();
    await q(`insert into guild_events(id, guild_id, channel_id, creator_id, name, description, entity_type, location, start_at, end_at, image_key, recurrence)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, row.guild_id, row.channel_id, row.creator_id, row.name, row.description, row.entity_type, row.location, start.toISOString(), len ? new Date(start.getTime() + len).toISOString() : null, row.image_key, row.recurrence]);
    await q("insert into guild_event_users(event_id, user_id) select $1, user_id from guild_event_users where event_id = $2 on conflict do nothing", [id, row.id]);
    await broadcast(guildId, { id }, "GUILD_EVENT_CREATE");
  }
  void by;
}

/** Start/stop events on time (maintenance job, every minute). */
export async function runEventLifecycle() {
  const due = await q<any>(`select * from guild_events where status = 1 and ((entity_type = 3 and start_at <= now()) or (entity_type in (1,2) and start_at <= now() - interval '15 minutes')) limit 100`);
  for (const r of due) await setStatus(r, EventStatus.ACTIVE, null);
  const over = await q<any>("select * from guild_events where status = 2 and end_at is not null and end_at <= now() limit 100");
  for (const r of over) await setStatus(r, EventStatus.COMPLETED, null);
  // Channel events with no end time finish 2 hours after nobody is in the channel — approximated as 12 h after start.
  const stale = await q<any>("select * from guild_events where status = 2 and end_at is null and start_at < now() - interval '12 hours' limit 100");
  for (const r of stale) await setStatus(r, EventStatus.COMPLETED, null);
  // Never-started channel events are cancelled after a day.
  const missed = await q<any>("select * from guild_events where status = 1 and start_at < now() - interval '1 day' limit 100");
  for (const r of missed) await setStatus(r, EventStatus.CANCELED, null);
}

const EVENT = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  entity_type: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  channel_id: ID.nullable().optional(),
  location: z.string().trim().max(100).nullable().optional(),
  start_at: z.string().datetime({ offset: true }),
  end_at: z.string().datetime({ offset: true }).nullable().optional(),
  recurrence: z.enum(["daily", "weekly", "biweekly", "monthly", "yearly"]).nullable().optional(),
});

export async function eventRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { id: string } }>("/api/guilds/:id/events", async (req) => {
    await requireGuild(uid(req), req.params.id);
    const rows = await q<any>(`${SELECT} where e.guild_id = $1 and e.status in (1, 2) order by e.start_at limit 100`, [req.params.id]);
    return eventsOut(await visible(uid(req), rows), uid(req));
  });

  app.post<{ Params: { id: string } }>("/api/guilds/:id/events", async (req) => {
    const me = uid(req);
    const ctx = await requireGuild(me, req.params.id);
    const b = EVENT.parse(req.body);
    await checkEvent(me, ctx, b);
    const n = await q1<any>("select count(*)::int as n from guild_events where guild_id = $1 and status in (1,2)", [req.params.id]);
    if (n.n >= 100) throw bad("A server can have up to 100 upcoming events.");
    const id = newId();
    await q(`insert into guild_events(id, guild_id, channel_id, creator_id, name, description, entity_type, location, start_at, end_at, recurrence)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, req.params.id, b.entity_type === 3 ? null : b.channel_id, me, b.name, b.description ?? null, b.entity_type, b.entity_type === 3 ? b.location : null, b.start_at, b.end_at ?? null, b.recurrence ?? null]);
    await q("insert into guild_event_users(event_id, user_id) values ($1,$2)", [id, me]);
    await broadcast(req.params.id, { id }, "GUILD_EVENT_CREATE");
    const { audit } = await import("./guilds.ts");
    await audit(req.params.id, me, "event_create", id, { name: b.name });
    return (await eventsOut([await q1<any>(`${SELECT} where e.id = $1`, [id])], me))[0];
  });

  async function checkEvent(me: string, ctx: Awaited<ReturnType<typeof requireGuild>>, b: Partial<z.infer<typeof EVENT>>) {
    if (b.entity_type === 3) {
      if (!b.location) throw bad("Add a location.");
      if (!b.end_at) throw bad("Somewhere-else events need an end time.");
      if (!has(ctx.perms, P.MANAGE_EVENTS)) throw forbidden("You need Manage Events.");
    } else if (b.entity_type) {
      if (!b.channel_id) throw bad("Pick a channel.");
      const ch = await getChannel(b.channel_id);
      if (!ch || ch.guild_id !== ctx.guild.id || (b.entity_type === 1 ? ch.type !== ChannelType.STAGE : ch.type !== ChannelType.VOICE)) throw bad(b.entity_type === 1 ? "Pick a stage channel." : "Pick a voice channel.");
      const p = await permsFor(me, ch);
      if (!has(p, P.MANAGE_EVENTS) && !has(ctx.perms, P.MANAGE_EVENTS)) throw forbidden("You need Manage Events.");
    }
    if (b.start_at && new Date(b.start_at).getTime() < Date.now() - 60_000) throw bad("Pick a start time in the future.");
    if (b.start_at && b.end_at && new Date(b.end_at) <= new Date(b.start_at)) throw bad("The end has to be after the start.");
  }

  app.patch<{ Params: { id: string; eid: string } }>("/api/guilds/:id/events/:eid", async (req) => {
    const me = uid(req);
    const ctx = await requireGuild(me, req.params.id);
    const cur = await q1<any>("select * from guild_events where id = $1 and guild_id = $2", [req.params.eid, req.params.id]);
    if (!cur) throw notFound("Event");
    if (!has(ctx.perms, P.MANAGE_EVENTS) && String(cur.creator_id) !== me) throw forbidden("You need Manage Events.");
    const b = EVENT.partial().extend({ status: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional() }).parse(req.body);
    if (b.status) {
      const ok = (cur.status === 1 && (b.status === 2 || b.status === 4)) || (cur.status === 2 && b.status === 3);
      if (!ok) throw bad("That event can't change to that state.");
      await setStatus(cur, b.status, me);
      return (await eventsOut([await q1<any>(`${SELECT} where e.id = $1`, [cur.id])], me))[0];
    }
    if (cur.status !== 1) throw bad("Only upcoming events can be edited.");
    const merged = { entity_type: cur.entity_type, channel_id: cur.channel_id ? String(cur.channel_id) : null, location: cur.location, end_at: cur.end_at, ...b };
    await checkEvent(me, ctx, { ...merged, start_at: b.start_at });
    await q(`update guild_events set name = $2, description = $3, entity_type = $4, channel_id = $5, location = $6, start_at = $7, end_at = $8, recurrence = $9 where id = $1`,
      [cur.id, b.name ?? cur.name, b.description === undefined ? cur.description : b.description, merged.entity_type, merged.entity_type === 3 ? null : merged.channel_id, merged.entity_type === 3 ? merged.location : null,
       b.start_at ?? cur.start_at, merged.end_at ?? null, b.recurrence === undefined ? cur.recurrence : b.recurrence]);
    await broadcast(req.params.id, cur);
    return (await eventsOut([await q1<any>(`${SELECT} where e.id = $1`, [cur.id])], me))[0];
  });

  app.delete<{ Params: { id: string; eid: string } }>("/api/guilds/:id/events/:eid", async (req) => {
    const me = uid(req);
    const ctx = await requireGuild(me, req.params.id);
    const cur = await q1<any>("select * from guild_events where id = $1 and guild_id = $2", [req.params.eid, req.params.id]);
    if (!cur) throw notFound("Event");
    if (!has(ctx.perms, P.MANAGE_EVENTS) && String(cur.creator_id) !== me) throw forbidden("You need Manage Events.");
    await q("delete from guild_events where id = $1", [cur.id]);
    if (cur.image_key) await storage.remove(cur.image_key).catch(() => {});
    await toGuild(req.params.id, "GUILD_EVENT_DELETE", { id: String(cur.id), guild_id: req.params.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string; eid: string } }>("/api/guilds/:id/events/:eid/image", async (req) => {
    const me = uid(req);
    const ctx = await requireGuild(me, req.params.id);
    const cur = await q1<any>("select * from guild_events where id = $1 and guild_id = $2", [req.params.eid, req.params.id]);
    if (!cur) throw notFound("Event");
    if (!has(ctx.perms, P.MANAGE_EVENTS) && String(cur.creator_id) !== me) throw forbidden();
    const { saveImage } = await import("../uploads.ts");
    const key = await saveImage(req, `guild-banners/${req.params.id}`, 4 * 1024 * 1024);
    await q("update guild_events set image_key = $2 where id = $1", [cur.id, key]);
    if (cur.image_key) await storage.remove(cur.image_key).catch(() => {});
    await broadcast(req.params.id, cur);
    return { image: mediaUrl(key) };
  });

  for (const on of [true, false]) {
    app[on ? "put" : "delete"]<{ Params: { id: string; eid: string } }>("/api/guilds/:id/events/:eid/users/@me", async (req) => {
      const me = uid(req);
      await requireGuild(me, req.params.id);
      const cur = await q1<any>("select * from guild_events where id = $1 and guild_id = $2 and status in (1,2)", [req.params.eid, req.params.id]);
      if (!cur || !(await visible(me, [cur])).length) throw notFound("Event");
      if (on) await q("insert into guild_event_users(event_id, user_id) values ($1,$2) on conflict do nothing", [cur.id, me]);
      else await q("delete from guild_event_users where event_id = $1 and user_id = $2", [cur.id, me]);
      await broadcast(req.params.id, cur);
      return { ok: true };
    });
  }
  app.get<{ Params: { id: string; eid: string } }>("/api/guilds/:id/events/:eid/users", async (req) => {
    await requireGuild(uid(req), req.params.id);
    const rows = await q<any>(`select ${prefixedCols("u", "a_")} from guild_event_users x join users u on u.id = x.user_id join guild_events e on e.id = x.event_id
      where x.event_id = $1 and e.guild_id = $2 order by x.created_at limit 100`, [req.params.eid, req.params.id]);
    return rows.map((r) => prefixedUser(r, "a_"));
  });
}
