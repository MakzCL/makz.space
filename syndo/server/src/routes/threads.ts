import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ChannelType, MessageType, P, has, type Channel } from "@send/shared";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { bad, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { toChannel, toUser } from "../gateway.ts";
import { getChannel, permsFor, requireChannel, type ChanRow } from "../perms.ts";
import { channelOut, prefixedCols, prefixedUser } from "../serialize.ts";
import { createSystemMessage, hydrate, messageById } from "./messages.ts";

/**
 * Threads (public 11 / private 12) under text, announcement, forum and media channels.
 * A forum/media post is a public thread whose first message is the post.
 * Threads inherit their parent's permission overwrites; private threads are visible to
 * their members and to people with Manage Threads.
 */

const ID = z.string().regex(/^\d{1,20}$/);
const THREAD_PARENTS: number[] = [ChannelType.TEXT, ChannelType.ANNOUNCEMENT, ChannelType.FORUM, ChannelType.MEDIA];
const isThread = (t: number) => t === ChannelType.PUBLIC_THREAD || t === ChannelType.PRIVATE_THREAD;
const isForum = (t: number) => t === ChannelType.FORUM || t === ChannelType.MEDIA;

export async function threadOut(row: any, viewer: string | null): Promise<Channel> {
  const [count, me] = await Promise.all([
    q1<any>("select count(*)::int as n from thread_members where channel_id = $1", [row.id]),
    viewer ? q1("select 1 from thread_members where channel_id = $1 and user_id = $2", [row.id, viewer]) : null,
  ]);
  return channelOut({ ...row, member_count: count?.n ?? 0, me: !!me });
}

/** Active (and, on request, archived) threads under a parent the viewer can see. */
async function listThreads(viewer: string, parent: ChanRow, archived: boolean, before: string | null, limit = 50) {
  const rows = await q<any>(`select * from channels where parent_id = $1 and type in (11, 12) and archived = $2
      and ($3::timestamptz is null or coalesce(last_activity_at, created_at) < $3)
      order by coalesce(last_activity_at, created_at) desc limit $4`, [parent.id, archived, before, limit + 1]);
  const out: Channel[] = [];
  for (const r of rows.slice(0, limit)) if (has(await permsFor(viewer, r), P.VIEW_CHANNEL)) out.push(await threadOut(r, viewer));
  return { threads: out, has_more: rows.length > limit };
}

async function announce(thread: ChanRow, event: "THREAD_CREATE" | "THREAD_UPDATE" | "THREAD_DELETE") {
  const parent = thread.parent_id ? await getChannel(thread.parent_id) : null;
  if (!parent) return;
  if (event === "THREAD_DELETE") return toChannel(parent, event, { id: thread.id, parent_id: parent.id, guild_id: thread.guild_id });
  const fresh = (await getChannel(thread.id))!;
  // The thread's own audience (private threads: members and moderators only).
  await toChannel(fresh, event, await threadOut(fresh, null));
}

/** Auto-archive threads with no activity for their chosen duration (maintenance job). */
export async function archiveIdleThreads() {
  const rows = await q<any>(`update channels set archived = true, archived_at = now() where type in (11, 12) and not archived
      and coalesce(last_activity_at, created_at) < now() - make_interval(mins => auto_archive_minutes) returning *`);
  for (const r of rows) await announce(r, "THREAD_UPDATE").catch(() => {});
  return rows.length;
}

export async function threadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  // A voice channel's status clears when the last person leaves.
  const { onVoiceChange, voiceStates } = await import("../gateway.ts");
  onVoiceChange(async (_uid, prev) => {
    if (!prev?.channel_id || voiceStates().some((v) => v.channel_id === prev.channel_id)) return;
    const ch = await q1<any>("update channels set voice_status = null where id = $1 and voice_status is not null returning *", [prev.channel_id]);
    if (ch) await toChannel(ch, "VOICE_CHANNEL_STATUS_UPDATE", { id: ch.id, guild_id: ch.guild_id, status: null, user_id: null });
  });

  /** Start a thread (optionally from a message), or a forum/media post. */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/threads", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const me = uid(req);
    const { channel: parent, perms } = await requireChannel(me, req.params.cid);
    if (!THREAD_PARENTS.includes(parent.type) || !parent.guild_id) throw bad("Threads can't be made here.");
    const b = z.object({
      name: z.string().trim().min(1).max(100),
      type: z.union([z.literal(11), z.literal(12)]).default(11),
      auto_archive_minutes: z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)]).default(4320),
      invitable: z.boolean().default(true),
      message_id: ID.optional(),
      applied_tags: z.array(ID).max(5).default([]),
      rate_limit_per_user: z.number().int().min(0).max(21600).default(0),
      message: z.object({ content: z.string().max(4000).default(""), attachment_ids: z.array(ID).max(10).default([]), sticker_ids: z.array(ID).max(1).default([]) }).optional(),
    }).parse(req.body);
    const forum = isForum(parent.type);
    if (forum) {
      if (!has(perms, P.SEND_MESSAGES)) throw forbidden("You can't post in this forum.");
      if (!b.message || (!b.message.content.trim() && !b.message.attachment_ids.length)) throw bad("Write something for your post.");
      if (parent.type === ChannelType.MEDIA && !b.message.attachment_ids.length) throw bad("Media posts need an image or video.");
      const tags: any[] = parent.available_tags ?? [];
      const valid = new Set(tags.map((t) => String(t.id)));
      if (b.applied_tags.some((t) => !valid.has(t))) throw bad("Unknown tag.");
      if (parent.require_tag && !b.applied_tags.length) throw bad("Pick at least one tag for your post.");
      const moderated = new Set(tags.filter((t) => t.moderated).map((t) => String(t.id)));
      if (b.applied_tags.some((t) => moderated.has(t)) && !has(perms, P.MANAGE_THREADS)) throw forbidden("Only moderators can use that tag.");
      b.type = 11;
    } else if (!has(perms, b.type === 12 ? P.CREATE_PRIVATE_THREADS : P.CREATE_PUBLIC_THREADS)) throw forbidden("You can't create threads here.");
    if (b.type === 12 && b.message_id) throw bad("Private threads can't start from a message.");
    let starter: any = null;
    if (b.message_id) {
      starter = await q1<any>("select id::text, thread_id from messages where id = $1 and channel_id = $2 and deleted_at is null", [b.message_id, parent.id]);
      if (!starter) throw notFound("Message");
      if (starter.thread_id) throw bad("That message already has a thread.");
    }
    const id = newId();
    await tx(async (c) => {
      await c.query(`insert into channels(id, guild_id, type, name, parent_id, owner_id, position, auto_archive_minutes, invitable, applied_tags, rate_limit_per_user, last_activity_at, permission_synced)
        values ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10, now(), true)`, [id, parent.guild_id, b.type, b.name, parent.id, me, b.auto_archive_minutes, b.invitable, b.applied_tags, b.rate_limit_per_user]);
      await c.query("insert into thread_members(channel_id, user_id) values ($1,$2)", [id, me]);
      if (starter) await c.query("update messages set thread_id = $2, flags = flags | 32 where id = $1", [starter.id, id]);
    });
    const thread = (await getChannel(id))!;
    if (forum && b.message) {
      // The post itself is the thread's first message.
      const mid = newId();
      await tx(async (c) => {
        await c.query("insert into messages(id, channel_id, guild_id, author_id, content, type, sticker_id) values ($1,$2,$3,$4,$5,0,$6)", [mid, id, parent.guild_id, me, b.message!.content, b.message!.sticker_ids[0] ?? null]);
        if (b.message!.attachment_ids.length) {
          const r = await c.query("update attachments set message_id = $1, channel_id = $2 where id = any($3::bigint[]) and uploader_id = $4 and channel_id = $5 and message_id is null and filename <> '' returning id", [mid, id, b.message!.attachment_ids, me, parent.id]);
          if (r.rowCount !== b.message!.attachment_ids.length) throw bad("One of the attachments is missing. Try uploading it again.");
        }
        await c.query("update channels set last_message_id = $2, message_count = 1 where id = $1", [id, mid]);
      });
      if (parent.default_reaction) await q("insert into reactions(message_id, user_id, emoji) values ($1,$2,$3) on conflict do nothing", [mid, me, parent.default_reaction]).catch(() => {});
    } else if (starter) {
      const msg = await messageById(starter.id, null);
      if (msg) { const { reactions: _r, ...rest } = msg; await toChannel(parent, "MESSAGE_UPDATE", rest); }
      await createSystemMessage(parent.id, parent.guild_id, me, MessageType.THREAD_CREATED, b.name, []).then((m) => q("update messages set thread_id = $2 where id = $1", [m!.id, id]));
    } else if (b.type === 11) {
      await createSystemMessage(parent.id, parent.guild_id, me, MessageType.THREAD_CREATED, b.name, []).then((m) => q("update messages set thread_id = $2 where id = $1", [m!.id, id]));
    }
    await announce(thread, "THREAD_CREATE");
    toUser(me, "THREAD_MEMBERS_UPDATE", { id, added: [me], removed: [] });
    return threadOut(await getChannel(id), me);
  });

  app.get<{ Params: { cid: string }; Querystring: { archived?: string; before?: string } }>("/api/channels/:cid/threads", async (req) => {
    const me = uid(req);
    const { channel } = await requireChannel(me, req.params.cid, P.READ_MESSAGE_HISTORY);
    const before = req.query.before ? new Date(req.query.before).toISOString() : null;
    const res = await listThreads(me, channel, req.query.archived === "1", before);
    if (isForum(channel.type)) {
      // Forum list shows each post's first message (text, first image) and reaction counts.
      const ids = res.threads.map((t) => t.id);
      const firsts = ids.length ? await q<any>(`select distinct on (m.channel_id) m.*, ${prefixedCols("u", "a_")} from messages m left join users u on u.id = m.author_id
        where m.channel_id = any($1::bigint[]) and m.deleted_at is null order by m.channel_id, m.id asc`, [ids]) : [];
      const hydrated = await hydrate(firsts, me);
      for (const t of res.threads) (t.thread as any).starter = hydrated.find((m) => m.channel_id === t.id) ?? null;
    }
    return res;
  });

  /** All active threads in a server I can see (sidebar under each channel). */
  app.get<{ Params: { id: string } }>("/api/guilds/:id/threads/active", async (req) => {
    const me = uid(req);
    if (!(await q1("select 1 from members where guild_id = $1 and user_id = $2", [req.params.id, me]))) throw notFound("Server");
    const rows = await q<any>("select * from channels where guild_id = $1 and type in (11, 12) and not archived order by coalesce(last_activity_at, created_at) desc limit 300", [req.params.id]);
    const out: Channel[] = [];
    for (const r of rows) if (has(await permsFor(me, r), P.VIEW_CHANNEL)) out.push(await threadOut(r, me));
    return out;
  });

  app.patch<{ Params: { cid: string } }>("/api/channels/:cid/thread", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid);
    if (!isThread(channel.type)) throw bad("Not a thread.");
    const b = z.object({
      name: z.string().trim().min(1).max(100).optional(),
      archived: z.boolean().optional(),
      locked: z.boolean().optional(),
      invitable: z.boolean().optional(),
      auto_archive_minutes: z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)]).optional(),
      applied_tags: z.array(ID).max(5).optional(),
      rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
    }).strict().parse(req.body);
    const mod = has(perms, P.MANAGE_THREADS);
    const owner = channel.owner_id === me;
    if ((b.locked !== undefined || b.invitable !== undefined || b.rate_limit_per_user !== undefined) && !mod) throw forbidden("You need Manage Threads.");
    if ((b.name !== undefined || b.auto_archive_minutes !== undefined || b.applied_tags !== undefined) && !mod && !owner) throw forbidden("Only the thread's creator or a moderator can change that.");
    if (b.archived === false && channel.locked && !mod) throw forbidden("This thread is locked.");
    if (b.archived !== undefined && !mod && !owner && !has(perms, P.SEND_MESSAGES_IN_THREADS)) throw forbidden();
    if (b.applied_tags) {
      const parent = await getChannel(channel.parent_id!);
      const valid = new Set(((parent?.available_tags ?? []) as any[]).map((t) => String(t.id)));
      if (b.applied_tags.some((t) => !valid.has(t))) throw bad("Unknown tag.");
    }
    const upd: Record<string, unknown> = { ...b };
    if (b.archived !== undefined) upd.archived_at = b.archived ? new Date().toISOString() : null;
    if (b.archived === false) upd.last_activity_at = new Date().toISOString();
    const entries = Object.entries(upd).filter(([, v]) => v !== undefined);
    if (entries.length) await q(`update channels set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [channel.id, ...entries.map(([, v]) => v)]);
    const fresh = (await getChannel(channel.id))!;
    await announce(fresh, "THREAD_UPDATE");
    return threadOut(fresh, me);
  });

  app.delete<{ Params: { cid: string } }>("/api/channels/:cid/thread", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid);
    if (!isThread(channel.type)) throw bad("Not a thread.");
    if (!has(perms, P.MANAGE_THREADS)) throw forbidden("You need Manage Threads.");
    await q("update messages set thread_id = null, flags = flags & ~32 where thread_id = $1", [channel.id]);
    await announce(channel, "THREAD_DELETE");
    await q("delete from channels where id = $1", [channel.id]);
    const { audit } = await import("./guilds.ts");
    await audit(channel.guild_id!, me, "thread_delete", channel.id, { name: channel.name });
    return { ok: true };
  });

  /* ---------------------------------------------------------- members -- */
  app.get<{ Params: { cid: string } }>("/api/channels/:cid/thread-members", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid);
    if (!isThread(channel.type)) throw bad("Not a thread.");
    const rows = await q<any>(`select ${prefixedCols("u", "a_")}, t.joined_at from thread_members t join users u on u.id = t.user_id where t.channel_id = $1 order by t.joined_at limit 200`, [channel.id]);
    return rows.map((r) => ({ user: prefixedUser(r, "a_"), joined_at: r.joined_at }));
  });
  app.put<{ Params: { cid: string; uid: string } }>("/api/channels/:cid/thread-members/:uid", async (req) => {
    const me = uid(req);
    const target = req.params.uid === "@me" ? me : req.params.uid;
    const { channel, perms } = await requireChannel(me, req.params.cid);
    if (!isThread(channel.type)) throw bad("Not a thread.");
    if (target !== me) {
      if (channel.type === ChannelType.PRIVATE_THREAD && !channel.invitable && !has(perms, P.MANAGE_THREADS) && channel.owner_id !== me) throw forbidden("Only moderators can add people to this thread.");
      if (!(await q1("select 1 from thread_members where channel_id = $1 and user_id = $2", [channel.id, me])) && !has(perms, P.MANAGE_THREADS)) throw forbidden("Join the thread first.");
      // The person must be able to see the parent channel.
      const parent = (await getChannel(channel.parent_id!))!;
      if (!has(await permsFor(target, parent), P.VIEW_CHANNEL)) throw bad("They can't see this channel.");
    }
    if (channel.archived && !channel.locked) await q("update channels set archived = false, archived_at = null, last_activity_at = now() where id = $1", [channel.id]);
    const ins = await q1("insert into thread_members(channel_id, user_id) values ($1,$2) on conflict do nothing returning 1", [channel.id, target]);
    if (ins) {
      toUser(target, "THREAD_MEMBERS_UPDATE", { id: channel.id, added: [target], removed: [] });
      if (channel.type === ChannelType.PRIVATE_THREAD) toUser(target, "THREAD_CREATE", await threadOut(await getChannel(channel.id), target));
      if (target !== me) await createSystemMessage(channel.id, channel.guild_id, me, MessageType.RECIPIENT_ADD, "", [target]);
    }
    return { ok: true };
  });
  app.delete<{ Params: { cid: string; uid: string } }>("/api/channels/:cid/thread-members/:uid", async (req) => {
    const me = uid(req);
    const target = req.params.uid === "@me" ? me : req.params.uid;
    const { channel, perms } = await requireChannel(me, req.params.cid);
    if (!isThread(channel.type)) throw bad("Not a thread.");
    if (target !== me && !has(perms, P.MANAGE_THREADS) && channel.owner_id !== me) throw forbidden();
    const del = await q1("delete from thread_members where channel_id = $1 and user_id = $2 returning 1", [channel.id, target]);
    if (del) {
      toUser(target, "THREAD_MEMBERS_UPDATE", { id: channel.id, added: [], removed: [target] });
      if (channel.type === ChannelType.PRIVATE_THREAD && !has(await permsFor(target, channel), P.VIEW_CHANNEL)) toUser(target, "THREAD_DELETE", { id: channel.id, parent_id: channel.parent_id, guild_id: channel.guild_id });
    }
    return { ok: true };
  });

  /* ---------------------------------------------- forum & voice settings -- */
  app.patch<{ Params: { cid: string } }>("/api/channels/:cid/forum", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_CHANNELS);
    if (!isForum(channel.type)) throw bad("Not a forum or media channel.");
    const b = z.object({
      available_tags: z.array(z.object({ id: ID.optional(), name: z.string().trim().min(1).max(20), emoji: z.string().max(64).nullish(), moderated: z.boolean().default(false) })).max(20).optional(),
      default_sort: z.union([z.literal(0), z.literal(1)]).optional(),
      default_layout: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
      default_reaction: z.string().max(64).nullable().optional(),
      require_tag: z.boolean().optional(),
    }).strict().parse(req.body);
    const upd: Record<string, unknown> = { ...b };
    if (b.available_tags) upd.available_tags = JSON.stringify(b.available_tags.map((t) => ({ id: t.id ?? newId(), name: t.name, emoji: t.emoji ?? null, moderated: t.moderated })));
    const entries = Object.entries(upd).filter(([, v]) => v !== undefined);
    if (entries.length) await q(`update channels set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [channel.id, ...entries.map(([, v]) => v)]);
    const { resyncGuild } = await import("./guilds.ts");
    await resyncGuild(channel.guild_id!);
    return channelOut(await getChannel(channel.id));
  });

  /** Voice channel status: the short line under a voice channel (anyone connected with Set Voice Status = Manage Channels or Connect+Speak). */
  app.put<{ Params: { cid: string } }>("/api/channels/:cid/voice-status", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid, P.CONNECT);
    if (channel.type !== ChannelType.VOICE) throw bad("Not a voice channel.");
    const { voiceStateOf } = await import("../gateway.ts");
    const inIt = voiceStateOf(me)?.channel_id === channel.id;
    if (!inIt && !has(perms, P.MANAGE_CHANNELS)) throw forbidden("Join the channel to set its status.");
    const { status } = z.object({ status: z.string().max(500).nullable() }).parse(req.body);
    const text = status?.replace(/[\p{Cc}]/gu, "").trim() || null;
    await q("update channels set voice_status = $2 where id = $1", [channel.id, text]);
    await toChannel(channel, "VOICE_CHANNEL_STATUS_UPDATE", { id: channel.id, guild_id: channel.guild_id, status: text, user_id: me });
    return { ok: true };
  });
}
