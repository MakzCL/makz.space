import { checkSticker, stickerOut } from "./expressions.ts";
import { PREFIX, validateDmWire } from "./encryption.ts";
import type { FastifyInstance } from "fastify";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { ChannelType, boostPerks, MENTION_ROLE, MENTION_USER, MessageType, P, has, isTextLike, type Message } from "@send/shared";
import { config } from "../config.ts";
import { pool, q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { ApiError, bad, forbidden, notFound, tooMany } from "../errors.ts";
import { newId } from "../ids.ts";
import { isOnline, toChannel, toUser } from "../gateway.ts";
import { getChannel, guildPermData, permsFor, requireChannel, viewers, type ChanRow } from "../perms.ts";
import { mediaUrl, prefixedCols, prefixedUser } from "../serialize.ts";
import * as storage from "../storage.ts";
import { embedOut, linksIn, previewFor } from "../unfurl.ts";
import { checkAutomod } from "./automod.ts";
import { notifyMessage } from "../notify.ts";
import { trackStat } from "./insights.ts";
import { safeName } from "../uploads.ts";
import { DIRECT_READ_FROM, LARGE_MAX, PART_SIZE, checkTicket, issueTicket, signedRead } from "../largeUpload.ts";

const ID = z.string().regex(/^\d{1,20}$/);

const attUrl = (a: any) => `/api/attachments/${a.id}/${encodeURIComponent(a.filename)}`;

/** Turn message rows into wire messages: authors, attachments, reactions (with `me` for the viewer) and reply previews. */
export async function hydrate(rows: any[], viewerId: string | null): Promise<Message[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const atts = await q<any>("select * from attachments where message_id = any($1::bigint[]) order by id", [ids]);
  const reacts = await q<any>(
    `select message_id::text, emoji, count(*)::int as count, bool_or(user_id = $2) as me, min(created_at) as first
       from reactions where message_id = any($1::bigint[]) group by message_id, emoji order by first`, [ids, viewerId ?? "0"]);
  const stickerIds = rows.map((r) => r.sticker_id).filter(Boolean);
  const stickers = stickerIds.length ? await q<any>("select * from guild_stickers where id = any($1::bigint[])", [stickerIds]) : [];
  const pollRows = await q<any>("select * from polls where message_id = any($1::bigint[])", [ids]);
  const votes = pollRows.length ? await q<any>(
    `select message_id::text, answer_id, count(*)::int as n, bool_or(user_id = $2) as me from poll_votes where message_id = any($1::bigint[]) group by message_id, answer_id`,
    [pollRows.map((p) => p.message_id), viewerId ?? "0"]) : [];
  const threadIds = rows.map((r) => r.thread_id).filter(Boolean);
  const threads = threadIds.length ? await q<any>("select id::text, name, message_count, last_activity_at, archived from channels where id = any($1::bigint[])", [threadIds]) : [];
  const ixUsers = rows.map((r) => r.interaction?.user_id).filter(Boolean);
  const ixRows = ixUsers.length ? await q<any>(`select ${prefixedCols("u", "a_")} from users u where u.id = any($1::bigint[])`, [ixUsers]) : [];
  const replyIds = rows.map((r) => r.reply_to_id).filter(Boolean);
  const replies = replyIds.length ? await q<any>(
    `select m.id::text, m.content, m.deleted_at, (select count(*)::int from attachments x where x.message_id = m.id) as att_n, ${prefixedCols("u", "a_")} from messages m left join users u on u.id = m.author_id where m.id = any($1::bigint[])`, [replyIds]) : [];
  const pollOut = (r: any) => {
    const p = pollRows.find((x) => String(x.message_id) === String(r.id));
    if (!p) return null;
    const answers = (p.answers as any[]).map((a) => {
      const v = votes.find((x) => x.message_id === String(r.id) && x.answer_id === a.id);
      return { id: a.id, text: a.text, emoji: a.emoji ?? null, votes: v?.n ?? 0, me: !!v?.me };
    });
    return { question: p.question, answers, allow_multiselect: p.allow_multiselect, expires_at: p.expires_at, finalized: p.finalized || new Date(p.expires_at).getTime() <= Date.now(), total_votes: answers.reduce((n, a) => n + a.votes, 0) };
  };
  return rows.map((r) => {
    const rep = r.reply_to_id ? replies.find((x) => x.id === String(r.reply_to_id)) : null;
    return {
      id: r.id, channel_id: r.channel_id, guild_id: r.guild_id, author: prefixedUser(r, "a_") ?? { id: "0", username: "unknown", display_name: "Unknown", avatar: null, banner: null, bio: "", pronouns: "", accent_color: null, profile_theme: null },
      member_nick: r.member_nick ?? null,
      member: r.guild_id && (r.member_avatar_key || r.member_profile_theme) ? { avatar: mediaUrl(r.member_avatar_key), profile_theme: r.member_profile_theme ?? null } : null,
      content: r.deleted_at ? "" : r.content, type: r.type, created_at: r.created_at, edited_at: r.edited_at, pinned: r.pinned,
      reply_to: r.reply_to_id ? (rep ? { id: rep.id, author: prefixedUser(rep, "a_"), content: rep.deleted_at ? "" : (String(rep.content).startsWith(PREFIX) ? String(rep.content) : String(rep.content).slice(0, 200)), deleted: !!rep.deleted_at, attachments: rep.deleted_at ? 0 : Number(rep.att_n ?? 0) } : { id: String(r.reply_to_id), author: null, content: "", deleted: true }) : null,
      mentions: (r.mentions ?? []).map(String), mention_roles: (r.mention_roles ?? []).map(String), mention_everyone: r.mention_everyone,
      attachments: atts.filter((a) => a.message_id === r.id).map((a) => ({
        id: a.id, filename: a.filename, content_type: a.content_type, size: Number(a.size), url: attUrl(a), width: a.width, height: a.height, duration: a.duration, waveform: a.waveform,
      })),
      reactions: reacts.filter((x) => x.message_id === r.id).map((x) => ({ emoji: x.emoji, count: x.count, me: !!x.me })),
      nonce: r.nonce ?? null,
      stickers: r.sticker_id && !r.deleted_at ? stickers.filter((s) => String(s.id) === String(r.sticker_id)).map(stickerOut) : [],
      flags: r.flags ?? 0,
      embeds: r.deleted_at || ((r.flags ?? 0) & 4) ? [] : ((r.embeds ?? []) as any[]).map(embedOut),
      poll: r.deleted_at ? null : pollOut(r),
      snapshot: r.snapshot && !r.deleted_at ? { ...r.snapshot, embeds: (r.snapshot.embeds ?? []).map(embedOut) } : null,
      source: r.source ?? null,
      thread: r.thread_id ? (threads.find((t) => t.id === String(r.thread_id)) ?? null) : null,
      webhook_id: r.webhook_id ? String(r.webhook_id) : null,
      application_id: r.application_id ? String(r.application_id) : null,
      interaction: r.interaction ? { name: r.interaction.name, deferred: !!r.interaction.deferred, user: prefixedUser(ixRows.find((x) => x.a_id === String(r.interaction.user_id)) ?? {}, "a_") ?? null } as any : null,
      components: r.components ?? [],
      mention_author: r.mention_author !== false,
      ...(r.webhook_id ? { author: { ...(prefixedUser(r, "a_") ?? { id: String(r.webhook_id), username: "webhook", bio: "", pronouns: "", accent_color: null, profile_theme: null, banner: null }), id: String(r.webhook_id), username: r.webhook_name ?? "Webhook", display_name: r.webhook_name ?? "Webhook", avatar: r.webhook_avatar ?? null, bot: true } } : {}),
    };
  });
}

const SELECT = `select m.*, ${prefixedCols("u", "a_")}, mem.nick as member_nick, mem.avatar_key as member_avatar_key, mem.profile_theme as member_profile_theme
  from messages m left join users u on u.id = m.author_id left join members mem on mem.guild_id = m.guild_id and mem.user_id = m.author_id`;

export async function messageById(id: string, viewer: string | null) {
  const rows = await q(`${SELECT} where m.id = $1`, [id]);
  return (await hydrate(rows, viewer))[0] ?? null;
}

/** Messages authored by the system (joins, renames…). */
export async function createSystemMessage(channelId: string, guildId: string | null, authorId: string, type: number, content: string, mentions: string[] = []) {
  const id = newId();
  await q("insert into messages(id, channel_id, guild_id, author_id, content, type, mentions) values ($1,$2,$3,$4,$5,$6,$7)", [id, channelId, guildId, authorId, content, type, mentions]);
  await q("update channels set last_message_id = $2 where id = $1", [channelId, id]);
  const ch = await getChannel(channelId);
  const msg = await messageById(id, null);
  if (ch) await toChannel(ch, "MESSAGE_CREATE", msg);
  return msg;
}

/** End a poll: freeze it, post the result, update it everywhere. */
export async function finalizePoll(messageId: string) {
  const p = await q1<any>("update polls set finalized = true where message_id = $1 and not finalized returning *", [messageId]);
  if (!p) return;
  const m = await q1<any>("select channel_id::text, guild_id::text, author_id::text from messages where id = $1", [messageId]);
  const ch = m && await getChannel(m.channel_id);
  if (!ch) return;
  const msg = await messageById(messageId, null);
  if (msg) { const { reactions: _r, ...rest } = msg; await toChannel(ch, "MESSAGE_UPDATE", rest); }
  const counts = await q<any>("select answer_id, count(*)::int as n from poll_votes where message_id = $1 group by answer_id order by n desc", [messageId]);
  const total = counts.reduce((n, c) => n + c.n, 0);
  const top = counts[0] ? (p.answers as any[]).find((a) => a.id === counts[0].answer_id) : null;
  const sys = await createSystemMessage(ch.id, ch.guild_id, m.author_id, MessageType.POLL_RESULT,
    JSON.stringify({ poll_message_id: String(messageId), question: p.question, winner: top?.text ?? null, winner_votes: counts[0]?.n ?? 0, total_votes: total }));
  void sys;
}

function parseMentions(content: string) {
  const users = [...new Set([...content.matchAll(MENTION_USER)].map((m) => m[1]!))].slice(0, 100);
  const roles = [...new Set([...content.matchAll(MENTION_ROLE)].map((m) => m[1]!))].slice(0, 50);
  const everyone = /(^|[^`\w])@(everyone|here)\b/.test(content);
  return { users, roles, everyone };
}

/** Emoji: a short unicode sequence, or a custom emoji reference "name:id". */
function validEmoji(e: string) {
  if (/^[a-zA-Z0-9_]{2,32}:\d{1,20}$/.test(e)) return true;
  if (e.length > 32 || /[\s\u0000-\u001f<>]/.test(e)) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|[#*0-9]️?⃣/u.test(e);
}

export async function messageRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get<{ Params: { cid: string }; Querystring: { before?: string; after?: string; around?: string; limit?: string } }>("/api/channels/:cid/messages", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.READ_MESSAGE_HISTORY);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 100);
    const { before, after, around } = req.query;
    for (const v of [before, after, around]) if (v && !/^\d{1,20}$/.test(v)) throw bad("Invalid cursor.");
    let rows: any[];
    if (around) {
      const half = Math.floor(limit / 2);
      const older = await q(`${SELECT} where m.channel_id = $1 and m.id <= $2 and m.deleted_at is null order by m.id desc limit $3`, [channel.id, around, half + 1]);
      const newer = await q(`${SELECT} where m.channel_id = $1 and m.id > $2 and m.deleted_at is null order by m.id asc limit $3`, [channel.id, around, limit - half - 1]);
      rows = [...newer.reverse(), ...older];
    } else if (after) {
      rows = (await q(`${SELECT} where m.channel_id = $1 and m.id > $2 and m.deleted_at is null order by m.id asc limit $3`, [channel.id, after, limit])).reverse();
    } else {
      rows = await q(`${SELECT} where m.channel_id = $1 and ($2::bigint is null or m.id < $2) and m.deleted_at is null order by m.id desc limit $3`, [channel.id, before ?? null, limit]);
    }
    return hydrate(rows, uid(req)); // newest first
  });

  app.get<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/messages/:mid", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.READ_MESSAGE_HISTORY);
    const m = await messageById(req.params.mid, uid(req));
    if (!m || m.channel_id !== channel.id) throw notFound("Message");
    return m;
  });

  app.post<{ Params: { cid: string } }>("/api/channels/:cid/messages", { config: { rateLimit: { max: 30, timeWindow: "10 seconds" } } }, async (req) => {
    const me = uid(req);
    const b = z.object({
      content: z.string().max(500000).default(""),
      nonce: z.string().max(64).optional(),
      reply_to: ID.optional(),
      attachment_ids: z.array(ID).max(10).default([]),
      sticker_ids: z.array(ID).max(1).default([]),
      silent: z.boolean().optional(),
      mention_author: z.boolean().default(true),
      flags: z.number().int().min(0).max(4096).default(0),
      poll: z.object({
        question: z.string().trim().min(1).max(300),
        answers: z.array(z.object({ text: z.string().trim().min(1).max(55), emoji: z.string().max(64).nullish() })).min(2).max(10),
        duration_hours: z.number().int().min(1).max(768).default(24),
        allow_multiselect: z.boolean().default(false),
      }).optional(),
      forward: z.object({ message_id: ID, channel_id: ID }).optional(),
    }).parse(req.body);
    const content = b.content.replace(/\s+$/, "");
    if (!content.trim() && !b.attachment_ids.length && !b.sticker_ids.length && !b.poll && !b.forward) throw bad("Messages can't be empty.");
    const ch0 = await getChannel(req.params.cid);
    const isThread = ch0 && (ch0.type === ChannelType.PUBLIC_THREAD || ch0.type === ChannelType.PRIVATE_THREAD);
    const { channel, perms } = await requireChannel(me, req.params.cid, P.VIEW_CHANNEL);
    await validateDmWire(content, channel, me);
    if (!isTextLike(channel.type)) throw bad("You can't send messages here.");
    if (!has(perms, isThread ? P.SEND_MESSAGES_IN_THREADS : P.SEND_MESSAGES)) {
      if (channel.type === ChannelType.DM) throw forbidden("You can't send messages to this person.");
      throw forbidden("You can't send messages in this channel.");
    }
    if (config.requireVerifiedEmail && !req.session!.email_verified) throw forbidden("Verify your email to send messages.");
    if (b.attachment_ids.length && !has(perms, P.ATTACH_FILES)) throw forbidden("You can't attach files here.");
    if (b.poll && channel.guild_id && !has(perms, P.SEND_POLLS)) throw forbidden("You can't create polls here.");
    if (isThread && (channel as any).locked && !has(perms, P.MANAGE_THREADS)) throw forbidden("This thread is locked.");
    if (channel.guild_id) {
      const m = await q1<any>("select communication_disabled_until from members where guild_id = $1 and user_id = $2", [channel.guild_id, me]);
      if (m?.communication_disabled_until && new Date(m.communication_disabled_until).getTime() > Date.now() && !has(perms, P.ADMINISTRATOR)) throw forbidden("You're timed out in this server.");
    }
    let snapshot: any = null;
    if (b.forward) {
      const { channel: src } = await requireChannel(me, b.forward.channel_id, P.READ_MESSAGE_HISTORY);
      const orig = await messageById(b.forward.message_id, me);
      if (!orig || orig.channel_id !== src.id) throw notFound("Message");
      if (String(orig.content).startsWith(PREFIX)) throw bad("Encrypted messages can't be forwarded.");
      const base = orig.snapshot ?? orig;
      const rawEmbeds = (await q1<any>("select embeds from messages where id = $1", [orig.id]))?.embeds ?? [];
      snapshot = { content: base.content, attachments: base.attachments, embeds: orig.snapshot ? (orig.snapshot.embeds ?? []) : rawEmbeds, stickers: base.stickers ?? [], created_at: base.created_at, edited_at: base.edited_at,
        origin: orig.snapshot?.origin ?? { guild_id: src.guild_id, channel_id: src.id, message_id: orig.id, channel_name: src.name } };
    }
    const sticker = b.sticker_ids[0] ? await checkSticker(me, channel, perms, b.sticker_ids[0]) : null;

    // Idempotency: a retried send with the same nonce returns the original.
    if (b.nonce) {
      const dup = await q1<any>("select id::text from messages where author_id = $1 and channel_id = $2 and nonce = $3", [me, channel.id, b.nonce]);
      if (dup) return messageById(dup.id, me);
    }
    if (channel.rate_limit_per_user > 0 && !has(perms, P.BYPASS_SLOWMODE) && !has(perms, P.MANAGE_MESSAGES) && !has(perms, P.MANAGE_CHANNELS)) {
      const last = await q1<any>("select created_at from messages where channel_id = $1 and author_id = $2 and type in (0, 19) and deleted_at is null order by id desc limit 1", [channel.id, me]);
      const wait = last ? channel.rate_limit_per_user * 1000 - (Date.now() - new Date(last.created_at).getTime()) : 0;
      if (wait > 0) throw tooMany(`Slow mode is on. You can send another message in ${Math.ceil(wait / 1000)}s.`, Math.ceil(wait / 1000));
    }
    let replyTo: string | null = null, replyAuthor: string | null = null;
    if (b.reply_to) {
      const r = await q1<any>("select id::text, channel_id::text, author_id::text from messages where id = $1 and deleted_at is null", [b.reply_to]);
      if (!r || r.channel_id !== channel.id) throw bad("You can only reply to messages in this channel.");
      replyTo = r.id; replyAuthor = r.author_id;
    }
    const mentions = parseMentions(content);
    // Replies ping the person replied to unless "@ off" was chosen.
    if (replyAuthor && replyAuthor !== me && b.mention_author && !mentions.users.includes(replyAuthor)) mentions.users.push(replyAuthor);
    const automod = channel.guild_id ? await checkAutomod(channel, me, perms, content, mentions.users.length + mentions.roles.length) : null;
    if (automod?.blocked) throw new ApiError(400, "automod_blocked", automod.message ?? "Your message was blocked by this server's AutoMod.");
    const everyone = mentions.everyone && has(perms, P.MENTION_EVERYONE);
    let roleMentions: string[] = [];
    if (channel.guild_id && mentions.roles.length) {
      const roles = await q<any>("select id::text, mentionable from roles where guild_id = $1 and id = any($2::bigint[])", [channel.guild_id, mentions.roles]);
      roleMentions = roles.filter((r) => r.mentionable || has(perms, P.MENTION_EVERYONE)).map((r) => r.id);
    }
    const id = newId();
    try {
      await tx(async (c) => {
        await c.query(
          `insert into messages(id, channel_id, guild_id, author_id, content, type, reply_to_id, nonce, mention_everyone, mentions, mention_roles, sticker_id, flags, snapshot, mention_author)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [id, channel.id, channel.guild_id, me, content, replyTo ? MessageType.REPLY : MessageType.DEFAULT, replyTo, b.nonce ?? null, everyone, mentions.users, roleMentions, sticker?.id ?? null,
           (b.flags & 4) | (b.silent ? 4096 : 0), snapshot ? JSON.stringify(snapshot) : null, b.mention_author]);
        if (b.poll) {
          await c.query("insert into polls(message_id, question, answers, allow_multiselect, expires_at) values ($1,$2,$3,$4, now() + make_interval(hours => $5))",
            [id, b.poll.question, JSON.stringify(b.poll.answers.map((a, i) => ({ id: i + 1, text: a.text, emoji: a.emoji ?? null }))), b.poll.allow_multiselect, b.poll.duration_hours]);
        }
        if (isThread) await c.query("update channels set message_count = message_count + 1, last_activity_at = now(), archived = false, archived_at = null where id = $1", [channel.id]);
        if (isThread) await c.query("insert into thread_members(channel_id, user_id) values ($1,$2) on conflict do nothing", [channel.id, me]);
        if (b.attachment_ids.length) {
          const r = await c.query("update attachments set message_id = $1 where id = any($2::bigint[]) and uploader_id = $3 and channel_id = $4 and message_id is null and filename <> '' returning id", [id, b.attachment_ids, me, channel.id]);
          if (r.rowCount !== b.attachment_ids.length) throw bad("One of the attachments is missing or already used. Try uploading it again.");
        }
        await c.query("update channels set last_message_id = $2 where id = $1", [channel.id, id]);
        await c.query(`insert into read_states(user_id, channel_id, last_read_id, mention_count) values ($1,$2,$3,0)
                       on conflict (user_id, channel_id) do update set last_read_id = excluded.last_read_id, mention_count = 0`, [me, channel.id, id]);
      });
    } catch (e: any) {
      if (e?.code === "23505" && b.nonce) { // concurrent duplicate
        const dup = await q1<any>("select id::text from messages where author_id = $1 and channel_id = $2 and nonce = $3", [me, channel.id, b.nonce]);
        if (dup) return messageById(dup.id, me);
      }
      throw e;
    }
    const msg = (await messageById(id, me))!;
    await bumpMentions(channel, msg, me, everyone, mentions.users, roleMentions, !!b.silent);
    // Reopen a closed 1:1 DM for the recipient.
    await toChannel(channel, "MESSAGE_CREATE", msg);
    if (isThread && ch0?.parent_id) {
      const parent = await getChannel(ch0.parent_id);
      if (parent) await toChannel(parent, "THREAD_UPDATE", { id: channel.id, parent_id: parent.id, guild_id: channel.guild_id, message_count: ((channel as any).message_count ?? 0) + 1, last_activity_at: new Date().toISOString(), archived: false });
    }
    if (channel.guild_id) trackStat(channel.guild_id, "message", me).catch(() => {});
    if (automod?.alerts.length) automod.report(msg).catch((e) => console.error("[automod]", e));
    notifyMessage(channel, msg, { author: me, everyone, users: mentions.users, roles: roleMentions, silent: !!b.silent }).catch((e) => console.error("[push]", e));
    if (!(b.flags & 4) && has(perms, P.EMBED_LINKS)) unfurlLater(channel, id, content);
    return msg;
  });

  /** Fetch link previews after the message is out, then update it everywhere. */
  function unfurlLater(channel: ChanRow, id: string, content: string) {
    if (!content || content.startsWith(PREFIX)) return;
    const links = linksIn(content);
    if (!links.length) { void q("update messages set embeds = null where id = $1 and embeds is not null", [id]); return; }
    (async () => {
      const embeds = (await Promise.all(links.map((l) => previewFor(l).catch(() => null)))).filter(Boolean);
      await q("update messages set embeds = $2 where id = $1", [id, embeds.length ? JSON.stringify(embeds) : null]);
      const msg = await messageById(id, null);
      if (msg) { const { reactions: _r, ...rest } = msg; await toChannel(channel, "MESSAGE_UPDATE", rest); }
    })().catch((e) => console.error("[unfurl]", e));
  }

  /* --------------------------------------------------------- polls -- */
  app.put<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/polls/:mid/votes", async (req) => {
    const me = uid(req);
    const { channel } = await requireChannel(me, req.params.cid, P.READ_MESSAGE_HISTORY);
    const { answer_ids } = z.object({ answer_ids: z.array(z.number().int().min(1).max(10)).max(10) }).parse(req.body);
    const p = await q1<any>("select p.* from polls p join messages m on m.id = p.message_id where p.message_id = $1 and m.channel_id = $2 and m.deleted_at is null", [req.params.mid, channel.id]);
    if (!p) throw notFound("Poll");
    if (p.finalized || new Date(p.expires_at).getTime() <= Date.now()) throw bad("This poll has ended.");
    const valid = new Set((p.answers as any[]).map((a) => a.id));
    const chosen = [...new Set(answer_ids)].filter((a) => valid.has(a));
    if (!p.allow_multiselect && chosen.length > 1) throw bad("Pick one answer.");
    await tx(async (c) => {
      await c.query("delete from poll_votes where message_id = $1 and user_id = $2", [p.message_id, me]);
      for (const a of chosen) await c.query("insert into poll_votes(message_id, answer_id, user_id) values ($1,$2,$3)", [p.message_id, a, me]);
    });
    const counts = await q<any>("select answer_id, count(*)::int as n from poll_votes where message_id = $1 group by answer_id", [p.message_id]);
    await toChannel(channel, "POLL_VOTES", { channel_id: channel.id, message_id: String(p.message_id), counts, user_id: me, answer_ids: chosen });
    return messageById(req.params.mid, me);
  });
  app.post<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/polls/:mid/expire", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid, P.READ_MESSAGE_HISTORY);
    const m = await q1<any>("select author_id::text from messages where id = $1 and channel_id = $2", [req.params.mid, channel.id]);
    if (!m) throw notFound("Poll");
    if (m.author_id !== me && !(channel.guild_id && has(perms, P.MANAGE_MESSAGES))) throw forbidden("Only the person who made the poll can end it.");
    await finalizePoll(req.params.mid);
    return messageById(req.params.mid, me);
  });
  app.get<{ Params: { cid: string; mid: string; aid: string } }>("/api/channels/:cid/polls/:mid/answers/:aid", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.READ_MESSAGE_HISTORY);
    const rows = await q<any>(`select ${prefixedCols("u", "a_")} from poll_votes v join users u on u.id = v.user_id join messages m on m.id = v.message_id
      where v.message_id = $1 and m.channel_id = $2 and v.answer_id = $3 order by v.created_at limit 100`, [req.params.mid, channel.id, Number(req.params.aid) || 0]);
    return rows.map((r) => prefixedUser(r, "a_"));
  });

  /* -------------------------------------------- embeds & suppression -- */
  app.patch<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/messages/:mid/flags", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid);
    const m = await q1<any>("select author_id::text, flags from messages where id = $1 and channel_id = $2 and deleted_at is null", [req.params.mid, channel.id]);
    if (!m) throw notFound("Message");
    if (m.author_id !== me && !(channel.guild_id && has(perms, P.MANAGE_MESSAGES))) throw forbidden();
    const { suppress_embeds } = z.object({ suppress_embeds: z.boolean() }).parse(req.body);
    await q("update messages set flags = case when $2 then flags | 4 else flags & ~4 end where id = $1", [req.params.mid, suppress_embeds]);
    const msg = (await messageById(req.params.mid, me))!;
    const { reactions: _r, ...rest } = msg;
    await toChannel(channel, "MESSAGE_UPDATE", rest);
    return msg;
  });

  /* ---------------------------------------------------------- inbox -- */
  /** Recent messages that mention me (directly, by role, or @everyone/@here) in servers I can read. */
  app.get<{ Querystring: { before?: string; guild_id?: string; everyone?: string; roles?: string } }>("/api/users/@me/mentions", async (req) => {
    const me = uid(req);
    const before = req.query.before && /^\d{1,20}$/.test(req.query.before) ? req.query.before : null;
    const guild = req.query.guild_id && /^\d{1,20}$/.test(req.query.guild_id) ? req.query.guild_id : null;
    const withEveryone = req.query.everyone !== "0", withRoles = req.query.roles !== "0";
    const rows = await q<any>(`${SELECT}
      where m.deleted_at is null and m.author_id <> $1 and ($2::bigint is null or m.id < $2) and ($3::bigint is null or m.guild_id = $3)
        and m.created_at > now() - interval '30 days'
        and ($1 = any(m.mentions)
          or ($4 and m.mention_everyone and m.guild_id in (select guild_id from members where user_id = $1))
          or ($5 and m.mention_roles && (select coalesce(array_agg(role_id), '{}') from member_roles where user_id = $1)))
      order by m.id desc limit 60`, [me, before, guild, withEveryone, withRoles]);
    const out: any[] = [];
    const cache = new Map<string, boolean>();
    for (const r of rows) {
      const cid = String(r.channel_id);
      if (!cache.has(cid)) { const ch = await getChannel(cid); cache.set(cid, !!ch && has(await permsFor(me, ch), P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY)); }
      if (cache.get(cid)) out.push(r);
      if (out.length >= 25) break;
    }
    return hydrate(out, me);
  });

  async function bumpMentions(channel: ChanRow, msg: Message, author: string, everyone: boolean, users: string[], roles: string[], silent: boolean) {
    if (silent) return;
    let targets: string[] = [...users];
    if (channel.guild_id && (everyone || roles.length)) {
      const rows = everyone
        ? await q<any>("select user_id::text from members where guild_id = $1", [channel.guild_id])
        : await q<any>("select distinct user_id::text from member_roles where guild_id = $1 and role_id = any($2::bigint[])", [channel.guild_id, roles]);
      targets.push(...rows.map((r) => r.user_id));
    } else if (!channel.guild_id) {
      // In DMs every recipient is "mentioned" for unread badges.
      targets.push(...(await q<any>("select user_id::text from channel_recipients where channel_id = $1", [channel.id])).map((r) => r.user_id));
    }
    targets = [...new Set(targets)].filter((u) => u !== author);
    if (!targets.length) return;
    const allowed = [...(await viewers(channel, targets)).keys()];
    if (!allowed.length) return;
    await q(`insert into read_states(user_id, channel_id, last_read_id, mention_count)
             select u, $2, null, 1 from unnest($1::bigint[]) as u
             on conflict (user_id, channel_id) do update set mention_count = read_states.mention_count + 1`, [allowed, channel.id]);
    for (const u of allowed) if (isOnline(u)) toUser(u, "MENTION", { channel_id: channel.id, guild_id: channel.guild_id, message_id: msg.id });
  }

  app.patch<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/messages/:mid", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid);
    const m = await q1<any>("select * from messages where id = $1 and channel_id = $2 and deleted_at is null", [req.params.mid, channel.id]);
    if (!m) throw notFound("Message");
    if (m.author_id !== me) throw forbidden("You can only edit your own messages.");
    if (!has(perms, P.SEND_MESSAGES) && !has(perms, P.SEND_MESSAGES_IN_THREADS)) throw forbidden();
    const { content } = z.object({ content: z.string().max(500000) }).parse(req.body);
    await validateDmWire(content, channel, me);
    const hasAtt = await q1("select 1 from attachments where message_id = $1", [m.id]);
    if (!content.trim() && !hasAtt) throw bad("Messages can't be empty: delete it instead.");
    const mentions = parseMentions(content);
    await q("update messages set content = $2, edited_at = now(), mentions = $3, mention_everyone = mention_everyone and $4 where id = $1", [m.id, content, mentions.users, mentions.everyone]);
    const msg = (await messageById(m.id, me))!;
    const { reactions: _r, ...withoutReactions } = msg;
    await toChannel(channel, "MESSAGE_UPDATE", withoutReactions);
    if (!((m.flags ?? 0) & 4)) unfurlLater(channel, m.id, content);
    return msg;
  });

  app.delete<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/messages/:mid", async (req) => {
    const me = uid(req);
    const { channel, perms } = await requireChannel(me, req.params.cid);
    const m = await q1<any>("select * from messages where id = $1 and channel_id = $2 and deleted_at is null", [req.params.mid, channel.id]);
    if (!m) throw notFound("Message");
    const mod = !!channel.guild_id && has(perms, P.MANAGE_MESSAGES);
    if (m.author_id !== me && !mod) throw forbidden("You can only delete your own messages.");
    await deleteMessages(channel, [m.id]);
    if (m.author_id !== me && channel.guild_id) {
      const { audit } = await import("./guilds.ts");
      await audit(channel.guild_id, me, "message_delete", m.author_id, { channel_id: channel.id, message_id: m.id });
    }
    return { ok: true };
  });

  /** Bulk delete (moderators): up to 100 messages from the last 14 days. */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/messages/bulk-delete", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_MESSAGES);
    if (!channel.guild_id) throw bad("Bulk delete is for server channels.");
    const { ids } = z.object({ ids: z.array(ID).min(2).max(100) }).parse(req.body);
    const rows = await q<any>("select id::text from messages where channel_id = $1 and id = any($2::bigint[]) and deleted_at is null and created_at > now() - interval '14 days'", [channel.id, ids]);
    await deleteMessages(channel, rows.map((r) => r.id));
    const { audit } = await import("./guilds.ts");
    await audit(channel.guild_id, uid(req), "message_bulk_delete", channel.id, { count: rows.length });
    return { deleted: rows.length };
  });

  async function deleteMessages(channel: ChanRow, ids: string[]) {
    if (!ids.length) return;
    const atts = await q<any>("select storage_key from attachments where message_id = any($1::bigint[])", [ids]);
    await tx(async (c) => {
      await c.query("update messages set deleted_at = now(), content = '', pinned = false where id = any($1::bigint[])", [ids]);
      await c.query("delete from attachments where message_id = any($1::bigint[])", [ids]);
      await c.query("delete from reactions where message_id = any($1::bigint[])", [ids]);
      await c.query("delete from saved_messages where message_id = any($1::bigint[])", [ids]);
    });
    for (const a of atts) await storage.remove(a.storage_key).catch(() => {});
    if (ids.length === 1) await toChannel(channel, "MESSAGE_DELETE", { id: ids[0], channel_id: channel.id });
    else await toChannel(channel, "MESSAGE_DELETE_BULK", { ids, channel_id: channel.id });
  }

  /* ------------------------------------------------------- reactions -- */
  app.put<{ Params: { cid: string; mid: string; emoji: string } }>("/api/channels/:cid/messages/:mid/reactions/:emoji/@me", { config: { rateLimit: { max: 30, timeWindow: "10 seconds" } } }, async (req) => {
    const me = uid(req);
    const emoji = decodeURIComponent(req.params.emoji);
    if (!validEmoji(emoji)) throw bad("That isn't a valid emoji.");
    const { channel, perms } = await requireChannel(me, req.params.cid, P.READ_MESSAGE_HISTORY);
    const m = await q1<any>("select id from messages where id = $1 and channel_id = $2 and deleted_at is null", [req.params.mid, channel.id]);
    if (!m) throw notFound("Message");
    const existing = await q1("select 1 from reactions where message_id = $1 and emoji = $2 limit 1", [m.id, emoji]);
    if (!existing && !has(perms, P.ADD_REACTIONS)) throw forbidden("You can't add new reactions here.");
    if (channel.type === ChannelType.DM && !has(perms, P.SEND_MESSAGES)) throw forbidden();
    const distinct = await q1<any>("select count(distinct emoji)::int as n from reactions where message_id = $1", [m.id]);
    if (!existing && distinct.n >= 20) throw bad("A message can have up to 20 different reactions.");
    const ins = await q1("insert into reactions(message_id, user_id, emoji) values ($1,$2,$3) on conflict do nothing returning 1", [m.id, me, emoji]);
    if (ins) await toChannel(channel, "MESSAGE_REACTION_ADD", { channel_id: channel.id, message_id: m.id, user_id: me, emoji });
    return { ok: true };
  });

  app.delete<{ Params: { cid: string; mid: string; emoji: string; who: string } }>("/api/channels/:cid/messages/:mid/reactions/:emoji/:who", async (req) => {
    const me = uid(req);
    const emoji = decodeURIComponent(req.params.emoji);
    const target = req.params.who === "@me" ? me : req.params.who;
    const { channel, perms } = await requireChannel(me, req.params.cid, P.READ_MESSAGE_HISTORY);
    if (target !== me && !(channel.guild_id && has(perms, P.MANAGE_MESSAGES))) throw forbidden();
    const del = await q1("delete from reactions where message_id = $1 and user_id = $2 and emoji = $3 returning 1", [req.params.mid, target, emoji]);
    if (del) await toChannel(channel, "MESSAGE_REACTION_REMOVE", { channel_id: channel.id, message_id: req.params.mid, user_id: target, emoji });
    return { ok: true };
  });

  app.get<{ Params: { cid: string; mid: string; emoji: string } }>("/api/channels/:cid/messages/:mid/reactions/:emoji", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.READ_MESSAGE_HISTORY);
    const rows = await q<any>(`select ${prefixedCols("u", "a_")} from reactions r join users u on u.id = r.user_id join messages m on m.id = r.message_id
      where r.message_id = $1 and m.channel_id = $2 and r.emoji = $3 order by r.created_at limit 100`, [req.params.mid, channel.id, decodeURIComponent(req.params.emoji)]);
    return rows.map((r) => prefixedUser(r, "a_"));
  });

  /* ------------------------------------------------------------ pins -- */
  app.get<{ Params: { cid: string } }>("/api/channels/:cid/pins", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.READ_MESSAGE_HISTORY);
    return hydrate(await q(`${SELECT} where m.channel_id = $1 and m.pinned and m.deleted_at is null order by m.id desc limit 50`, [channel.id]), uid(req));
  });
  for (const pin of [true, false]) {
    app[pin ? "put" : "delete"]<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/pins/:mid", async (req) => {
      const { channel, perms } = await requireChannel(uid(req), req.params.cid, P.READ_MESSAGE_HISTORY);
      if (channel.guild_id && !has(perms, P.MANAGE_MESSAGES)) throw forbidden("You need Manage Messages to pin.");
      if (!channel.guild_id && !has(perms, P.SEND_MESSAGES)) throw forbidden();
      if (pin) {
        const n = await q1<any>("select count(*)::int as n from messages where channel_id = $1 and pinned", [channel.id]);
        if (n.n >= 50) throw bad("A channel can have up to 50 pins.");
      }
      const r = await q1("update messages set pinned = $3 where id = $1 and channel_id = $2 and deleted_at is null returning id", [req.params.mid, channel.id, pin]);
      if (!r) throw notFound("Message");
      const msg = await messageById(req.params.mid, null);
      const { reactions: _r, ...rest } = msg!;
      await toChannel(channel, "MESSAGE_UPDATE", rest);
      if (pin) await createSystemMessage(channel.id, channel.guild_id, uid(req), MessageType.PINNED, "", []);
      return { ok: true };
    });
  }

  /* --------------------------------------------------- typing & read -- */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/typing", { config: { rateLimit: { max: 20, timeWindow: "10 seconds" } } }, async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.SEND_MESSAGES);
    await toChannel(channel, "TYPING_START", { channel_id: channel.id, guild_id: channel.guild_id, user_id: uid(req), at: Date.now() }, { except: uid(req) });
    return { ok: true };
  });

  app.post<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/messages/:mid/ack", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid);
    const r = await q1<any>(
      `insert into read_states(user_id, channel_id, last_read_id, mention_count) values ($1,$2,$3,0)
       on conflict (user_id, channel_id) do update set last_read_id = greatest(coalesce(read_states.last_read_id, 0), excluded.last_read_id), mention_count = 0
       returning last_read_id::text`, [uid(req), channel.id, req.params.mid]);
    toUser(uid(req), "MESSAGE_ACK", { channel_id: channel.id, last_read_id: r.last_read_id, mention_count: 0 });
    return { ok: true };
  });

  /** Mark unread from a message (sets read position just before it). */
  app.post<{ Params: { cid: string; mid: string } }>("/api/channels/:cid/messages/:mid/unread", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid);
    const prev = (BigInt(req.params.mid) - 1n).toString();
    await q(`insert into read_states(user_id, channel_id, last_read_id, mention_count) values ($1,$2,$3,0)
             on conflict (user_id, channel_id) do update set last_read_id = $3`, [uid(req), channel.id, prev]);
    toUser(uid(req), "MESSAGE_ACK", { channel_id: channel.id, last_read_id: prev, mention_count: 0 });
    return { ok: true };
  });

  /* ---------------------------------------------------------- saved -- */
  app.get("/api/users/@me/saved", async (req) => {
    const rows = await q<any>(`${SELECT} join saved_messages s on s.message_id = m.id and s.user_id = $1 where m.deleted_at is null order by s.created_at desc limit 200`, [uid(req)]);
    // Only messages the user can still read — losing access hides saved copies too.
    const visible: any[] = [];
    for (const r of rows) {
      const ch = await getChannel(r.channel_id);
      if (ch && has(await permsFor(uid(req), ch), P.READ_MESSAGE_HISTORY)) visible.push(r);
    }
    return hydrate(visible, uid(req));
  });
  app.put<{ Params: { mid: string } }>("/api/users/@me/saved/:mid", async (req) => {
    const m = await q1<any>("select channel_id::text from messages where id = $1 and deleted_at is null", [req.params.mid]);
    if (!m) throw notFound("Message");
    await requireChannel(uid(req), m.channel_id, P.READ_MESSAGE_HISTORY);
    await q("insert into saved_messages(user_id, message_id) values ($1,$2) on conflict do nothing", [uid(req), req.params.mid]);
    toUser(uid(req), "SAVED_UPDATE", { message_id: req.params.mid, saved: true });
    return { ok: true };
  });
  app.delete<{ Params: { mid: string } }>("/api/users/@me/saved/:mid", async (req) => {
    await q("delete from saved_messages where user_id = $1 and message_id = $2", [uid(req), req.params.mid]);
    toUser(uid(req), "SAVED_UPDATE", { message_id: req.params.mid, saved: false });
    return { ok: true };
  });

  /* --------------------------------------------------------- search -- */
  app.get<{ Querystring: { q?: string; guild_id?: string; channel_id?: string; author_id?: string; before?: string; after?: string; has?: string; mentions?: string; offset?: string } }>("/api/search", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const me = uid(req);
    const s = req.query;
    for (const k of ["guild_id", "channel_id", "author_id", "mentions"] as const) if (s[k] && !/^\d{1,20}$/.test(s[k]!)) throw bad("Invalid filter.");
    // 1. Which channels may this user search? Computed with the same permission code as everything else.
    let candidates: ChanRow[];
    if (s.channel_id) {
      const ch = await getChannel(s.channel_id);
      candidates = ch ? [ch] : [];
    } else if (s.guild_id) {
      candidates = await q<ChanRow>("select * from channels where guild_id = $1 and type <> 4", [s.guild_id]);
    } else {
      candidates = await q<ChanRow>("select c.* from channels c join channel_recipients r on r.channel_id = c.id where r.user_id = $1 and c.type in (1,3)", [me]);
    }
    const allowed: string[] = [];
    if (s.guild_id && candidates.length) {
      const data = await guildPermData(s.guild_id);
      if (data) for (const ch of candidates) if (has(await permsFor(me, ch), P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY)) allowed.push(ch.id);
    } else {
      for (const ch of candidates) if (has(await permsFor(me, ch), P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY)) allowed.push(ch.id);
    }
    if (!allowed.length) return { total: 0, messages: [] };
    // 2. Query only inside those channels.
    const where: string[] = ["m.channel_id = any($1::bigint[])", "m.deleted_at is null"];
    const vals: unknown[] = [allowed];
    const add = (cond: string, v: unknown) => { vals.push(v); where.push(cond.replace("?", `$${vals.length}`)); };
    const text = s.q?.trim().slice(0, 200);
    if (text) {
      vals.push(text, text.replace(/[%_\\]/g, "\\$&"));
      where.push(`(m.tsv @@ websearch_to_tsquery('simple', $${vals.length - 1}) or m.content ilike '%' || $${vals.length} || '%')`);
    }
    if (s.author_id) add("m.author_id = ?", s.author_id);
    if (s.mentions) add("? = any(m.mentions)", s.mentions);
    if (s.before) add("m.created_at < ?", new Date(s.before).toISOString());
    if (s.after) add("m.created_at > ?", new Date(s.after).toISOString());
    if (s.has === "link") where.push("m.content ~* 'https?://'");
    else if (s.has === "file") where.push("exists (select 1 from attachments a where a.message_id = m.id)");
    else if (s.has === "image" || s.has === "video" || s.has === "audio") add("exists (select 1 from attachments a where a.message_id = m.id and a.content_type like ? || '/%')", s.has);
    else if (s.has === "pinned") where.push("m.pinned");
    if (!text && where.length === 2) throw bad("Type something to search for, or add a filter.");
    const offset = Math.min(Math.max(Number(s.offset ?? 0) || 0, 0), 5000);
    const total = await q1<any>(`select count(*)::int as n from messages m where ${where.join(" and ")}`, vals);
    const rows = await q(`${SELECT} where ${where.join(" and ")} order by m.id desc limit 25 offset ${offset}`, vals);
    return { total: total.n, messages: await hydrate(rows, me) };
  });

  /* ---------------------------------------------------- attachments -- */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/attachments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const me = uid(req);
    const { channel } = await requireChannel(me, req.params.cid, P.ATTACH_FILES);
    // Boosted servers allow bigger uploads.
    const tier = channel.guild_id ? (await q1<any>("select premium_tier from guilds where id = $1", [channel.guild_id]))?.premium_tier ?? 0 : 0;
    const maxBytes = Math.max(config.limits.max_upload_bytes, boostPerks(tier).upload_mb * 1048576);
    const file = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
    if (!file) throw bad("Attach a file.");
    const fields = file.fields as Record<string, any>;
    const field = (k: string) => (fields[k] && "value" in fields[k] ? String(fields[k].value) : undefined);
    if (!channel.guild_id && config.requireDmE2ee && (field("encrypted") !== "1" || file.filename !== "encrypted.send")) throw bad("Direct-message attachments must be encrypted before upload.");
    const id = newId();
    const name = safeName(file.filename || "file");
    const key = `att/${channel.guild_id ? `g${channel.guild_id}` : "dm"}/c${channel.id}/${id}`;
    let size: number;
    try { size = await storage.put(key, file.file, maxBytes); }
    catch (e: any) {
      if (e?.code === "too_large" || file.file.truncated) throw new ApiError(413, "too_large", `Files can be up to ${Math.round(maxBytes / 1048576)} MB here.`);
      throw e;
    }
    if (file.file.truncated) { await storage.remove(key); throw new ApiError(413, "too_large", `Files can be up to ${Math.round(maxBytes / 1048576)} MB here.`); }
    // Trust the bytes, not the client's claimed type.
    const head = await new Promise<Buffer>((res, rej) => { const chunks: Buffer[] = []; storage.open(key, { start: 0, end: 4100 }).on("data", (c) => chunks.push(c as Buffer)).on("end", () => res(Buffer.concat(chunks))).on("error", rej); });
    const sniff = await fileTypeFromBuffer(head);
    let type = sniff?.mime ?? (/^text\/plain/.test(file.mimetype) && !head.includes(0) ? "text/plain" : "application/octet-stream");
    // A voice message in a WebM/MP4 container sniffs as video; keep it audio when it is one.
    if (/^video\/(webm|mp4)$/.test(type) && (/^audio\//.test(file.mimetype) || field("waveform"))) type = type.replace("video/", "audio/");
    if (!channel.guild_id && field("encrypted") === "1") type = "application/octet-stream";
    if (type === "image/svg+xml") type = "application/octet-stream"; // never render uploaded SVG
    const num = (v: string | undefined, max: number) => (v && /^\d+(\.\d+)?$/.test(v) ? Math.min(Number(v), max) : null);
    await q(`insert into attachments(id, channel_id, uploader_id, filename, content_type, size, storage_key, width, height, duration, waveform)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, channel.id, me, name, type, size, key, num(field("width"), 20000), num(field("height"), 20000), num(field("duration"), 86400), (field("waveform") ?? "").slice(0, 400) || null]);
    return { id, filename: name, content_type: type, size, url: attUrl({ id, filename: name }) };
  });

  /* Big files: ask for a ticket, send the pieces straight to storage, then finish here. */
  const uploadLimit = async (channel: ChanRow) => {
    const tier = channel.guild_id ? (await q1<any>("select premium_tier from guilds where id = $1", [channel.guild_id]))?.premium_tier ?? 0 : 0;
    return Math.min(LARGE_MAX, Math.max(config.limits.max_upload_bytes, boostPerks(tier).upload_mb * 1048576));
  };
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/attachments/large", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const me = uid(req);
    const { channel } = await requireChannel(me, req.params.cid, P.ATTACH_FILES);
    const { size } = z.object({ size: z.number().int().positive() }).parse(req.body);
    if (!channel.guild_id && config.requireDmE2ee) throw bad("Direct-message attachments must be encrypted before upload.");
    const maxBytes = await uploadLimit(channel);
    if (size > maxBytes) throw new ApiError(413, "too_large", `Files can be up to ${Math.round(maxBytes / 1048576)} MB here.`);
    const id = newId();
    const key = `att/${channel.guild_id ? `g${channel.guild_id}` : "dm"}/c${channel.id}/${id}`;
    // An unfinished row (empty filename): if the upload is abandoned, the nightly cleanup removes it and its file.
    await q("insert into attachments(id, channel_id, uploader_id, filename, content_type, size, storage_key) values ($1,$2,$3,'','application/octet-stream',$4,$5)", [id, channel.id, me, size, key]);
    return { id, ticket: issueTicket(key, size), part_size: PART_SIZE, endpoint: "/api/uploads/large" };
  });
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/attachments/large/finish", async (req) => {
    const me = uid(req);
    const { channel } = await requireChannel(me, req.params.cid, P.ATTACH_FILES);
    const body = z.object({ ticket: z.object({ key: z.string(), size: z.number(), exp: z.number(), sig: z.string() }), filename: z.string().max(255),
      width: z.number().optional(), height: z.number().optional(), duration: z.number().optional(), waveform: z.string().max(400).optional() }).parse(req.body);
    const t = checkTicket(body.ticket);
    const prefix = `att/${channel.guild_id ? `g${channel.guild_id}` : "dm"}/c${channel.id}/`;
    const id = t.key.slice(prefix.length);
    if (!t.key.startsWith(prefix) || !/^\d{1,20}$/.test(id)) throw bad("This upload isn't valid.");
    const size = await storage.size(t.key).catch(() => -1);
    if (size !== t.size) throw bad("The upload didn't arrive complete. Try again.");
    const head = await new Promise<Buffer>((res, rej) => { const chunks: Buffer[] = []; storage.open(t.key, { start: 0, end: 4100 }).on("data", (c) => chunks.push(c as Buffer)).on("end", () => res(Buffer.concat(chunks))).on("error", rej); });
    const sniff = await fileTypeFromBuffer(head);
    let type = sniff?.mime ?? (!head.includes(0) && /\.(txt|md|log|csv)$/i.test(body.filename) ? "text/plain" : "application/octet-stream");
    if (/^video\/(webm|mp4)$/.test(type) && (body.waveform || /^voice-message\./.test(body.filename ?? ""))) type = type.replace("video/", "audio/");
    if (type === "image/svg+xml") type = "application/octet-stream";
    const name = safeName(body.filename || "file");
    const num = (v: number | undefined, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : null);
    const done = await q1(`update attachments set filename = $4, content_type = $5, width = $6, height = $7, duration = $8, waveform = $9
             where id = $1 and channel_id = $2 and uploader_id = $3 and filename = '' and message_id is null returning id`,
      [id, channel.id, me, name, type, num(body.width, 20000), num(body.height, 20000), num(body.duration, 86400), body.waveform || null]);
    if (!done) throw bad("This upload was already used.");
    return { id, filename: name, content_type: type, size, url: attUrl({ id, filename: name }) };
  });

  app.delete<{ Params: { aid: string } }>("/api/attachments/:aid", async (req) => {
    const a = await q1<any>("delete from attachments where id = $1 and uploader_id = $2 and message_id is null returning storage_key", [req.params.aid, uid(req)]);
    if (a) await storage.remove(a.storage_key).catch(() => {});
    return { ok: true };
  });
}

/** Images/videos in link previews, fetched through the server (signed URLs only). */
export async function embedMediaRoute(app: FastifyInstance) {
  const { checkProxySig, safeFetch } = await import("../unfurl.ts");
  app.get<{ Querystring: { u?: string; s?: string } }>("/api/embed-media", async (req, reply) => {
    const u = String(req.query.u ?? ""), sig = String(req.query.s ?? "");
    if (!u || !checkProxySig(u, sig)) throw notFound("File");
    let r;
    try { r = await safeFetch(u, { maxBytes: 15 * 1024 * 1024, accept: "image/*,video/*" }); } catch { throw notFound("File"); }
    const type = r.type.split(";")[0]!.trim().toLowerCase();
    if (r.status !== 200 || !/^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm))$/.test(type)) throw notFound("File");
    reply.header("content-type", type);
    reply.header("cache-control", "public, max-age=86400");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(r.body);
  });

  /** GIF search through GIPHY or Klipy. The key stays on the server. */
  app.get<{ Querystring: { q?: string; pos?: string } }>("/api/gifs", { preHandler: requireUser, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const key = process.env.SEND_GIF_KEY, provider = config.gifProvider;
    if (!key || !provider) throw new ApiError(503, "gifs_unavailable", "GIF search isn't set up on this server yet.");
    const text = String(req.query.q ?? "").trim().slice(0, 100);
    const pos = String(req.query.pos ?? "").slice(0, 100);
    if (provider === "giphy") return giphySearch(key, text, pos);
    if (provider !== "klipy") {
      // Google closed the public Tenor API on 30 June 2026.
      throw new ApiError(503, "gifs_unavailable", "GIF search isn't set up correctly on this server (use GIPHY or Klipy).");
    }
    const { safeFetch: get } = await import("../unfurl.ts");
    const page = Math.max(1, Number(pos) || 1);
    const url = text ? `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search?q=${encodeURIComponent(text)}&per_page=30&page=${page}&customer_id=${uid(req)}`
      : `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/trending?per_page=30&page=${page}&customer_id=${uid(req)}`;
    const j = JSON.parse((await get(url, { accept: "application/json", maxBytes: 2_000_000 })).body.toString("utf8"));
    const list = j.data?.data ?? [];
    return { next: j.data?.has_next ? String(page + 1) : null, results: list.map((g: any) => ({ id: String(g.id), title: g.title ?? "", url: g.file?.hd?.gif?.url, preview: g.file?.sm?.gif?.url ?? g.file?.xs?.gif?.url, gif: g.file?.hd?.gif?.url ?? g.file?.md?.gif?.url, mp4: g.file?.hd?.mp4?.url ?? null, width: g.file?.hd?.gif?.width ?? null, height: g.file?.hd?.gif?.height ?? null })) };
  });
}

/*
 * GIPHY. A beta key allows about 100 calls an hour for the whole server, so results are cached and
 * shared by everyone: trending for 30 minutes, searches for 6 hours. Upstream calls are counted per
 * rolling hour; near the limit, old cached results are served and new searches wait.
 */
type GifPage = { next: string | null; results: unknown[] };
const gifCache = new Map<string, { at: number; page: GifPage }>();
const giphyCalls: number[] = [];
const GIPHY_HOURLY = Number(process.env.SEND_GIF_HOURLY_LIMIT ?? 90);
export async function giphySearch(key: string, text: string, pos: string): Promise<GifPage> {
  const offset = Math.max(0, Math.min(4999, Number(pos) || 0));
  const cacheKey = `${text.toLowerCase()}|${offset}`;
  const hit = gifCache.get(cacheKey), now = Date.now();
  const ttl = text ? 6 * 3600_000 : 30 * 60_000;
  if (hit && now - hit.at < ttl) return hit.page;
  while (giphyCalls.length && now - giphyCalls[0]! > 3600_000) giphyCalls.shift();
  if (giphyCalls.length >= GIPHY_HOURLY) {
    if (hit) return hit.page;
    throw new ApiError(429, "gifs_busy", "Lots of people are searching GIFs right now. Try again in a few minutes, or pick from your favourites.");
  }
  giphyCalls.push(now);
  const { safeFetch: get } = await import("../unfurl.ts");
  const qs = new URLSearchParams({ api_key: key, limit: "30", offset: String(offset), rating: "pg-13", bundle: "messaging_non_clips", ...(text ? { q: text, lang: "en" } : {}) });
  const r = await get(`https://api.giphy.com/v1/gifs/${text ? "search" : "trending"}?${qs}`, { accept: "application/json", maxBytes: 2_000_000 });
  if (r.status === 429) { if (hit) return hit.page; throw new ApiError(429, "gifs_busy", "GIF search is busy. Try again in a few minutes."); }
  if (r.status !== 200) throw new ApiError(502, "gifs_failed", "GIF search didn't respond. Try again in a moment.");
  const j = JSON.parse(r.body.toString("utf8"));
  const p = j.pagination ?? {};
  const nextOffset = (p.offset ?? offset) + (p.count ?? 0);
  const page: GifPage = {
    next: p.count && nextOffset < Math.min(p.total_count ?? 0, 4999) ? String(nextOffset) : null,
    results: (j.data ?? []).map((g: any) => {
      const im = g.images ?? {}, send = im.downsized_medium?.url || im.original?.url;
      return { id: String(g.id), title: g.title ?? "", url: send, preview: im.fixed_width_downsampled?.url || im.fixed_width?.url || send, gif: send,
        mp4: im.original_mp4?.mp4 ?? im.original?.mp4 ?? null, width: Number(im.downsized_medium?.width ?? im.original?.width) || null, height: Number(im.downsized_medium?.height ?? im.original?.height) || null };
    }).filter((g: any) => g.url),
  };
  gifCache.set(cacheKey, { at: now, page });
  if (gifCache.size > 1000) gifCache.delete(gifCache.keys().next().value!);
  return page;
}

/** Attachment download — permission-checked on every request; no public URLs. */
export async function attachmentDownloadRoute(app: FastifyInstance) {
  app.get<{ Params: { aid: string; name: string } }>("/api/attachments/:aid/:name", { preHandler: requireUser }, async (req, reply) => {
    if (!/^\d{1,20}$/.test(req.params.aid)) throw notFound("File");
    const a = await q1<any>("select a.*, m.deleted_at from attachments a left join messages m on m.id = a.message_id where a.id = $1", [req.params.aid]);
    if (!a || a.deleted_at || !a.filename) throw notFound("File");
    if (a.message_id) await requireChannel(uid(req), a.channel_id, P.READ_MESSAGE_HISTORY);
    else if (a.uploader_id !== uid(req)) throw notFound("File");
    const inline = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|ogg|wav|webm|mp4|x-m4a|aac|flac))$/.test(a.content_type);
    const total = Number(a.size);
    reply.header("content-type", a.content_type);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    reply.header("cache-control", "private, max-age=3600");
    reply.header("accept-ranges", "bytes");
    const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`;
    reply.header("content-disposition", disposition);
    // Big files: hand the browser a short-lived signed link and let storage serve the bytes directly.
    if (total >= DIRECT_READ_FROM) return reply.code(302).header("location", signedRead(a.storage_key, a.content_type, disposition)).header("cache-control", "private, max-age=3000").send();
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && total > 0) {
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start > end || start >= total) { reply.code(416).header("content-range", `bytes */${total}`); return ""; }
      reply.code(206).header("content-range", `bytes ${start}-${end}/${total}`).header("content-length", end - start + 1);
      return reply.send(storage.open(a.storage_key, { start, end }));
    }
    reply.header("content-length", total);
    return reply.send(storage.open(a.storage_key));
  });
}

export { pool };
