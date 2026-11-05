import { checkSticker, stickerOut } from "./expressions.ts";
import { PREFIX, validateDmWire } from "./encryption.ts";
import type { FastifyInstance } from "fastify";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { ChannelType, MENTION_ROLE, MENTION_USER, MessageType, P, has, isTextLike, type Message } from "@syndo/shared";
import { config } from "../config.ts";
import { pool, q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { ApiError, bad, forbidden, notFound, tooMany } from "../errors.ts";
import { newId } from "../ids.ts";
import { isOnline, toChannel, toUser } from "../gateway.ts";
import { getChannel, guildPermData, permsFor, requireChannel, viewers, type ChanRow } from "../perms.ts";
import { mediaUrl, prefixedCols, prefixedUser } from "../serialize.ts";
import * as storage from "../storage.ts";
import { safeName } from "../uploads.ts";

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
  const replyIds = rows.map((r) => r.reply_to_id).filter(Boolean);
  const replies = replyIds.length ? await q<any>(
    `select m.id::text, m.content, m.deleted_at, ${prefixedCols("u", "a_")} from messages m left join users u on u.id = m.author_id where m.id = any($1::bigint[])`, [replyIds]) : [];
  return rows.map((r) => {
    const rep = r.reply_to_id ? replies.find((x) => x.id === String(r.reply_to_id)) : null;
    return {
      id: r.id, channel_id: r.channel_id, guild_id: r.guild_id, author: prefixedUser(r, "a_") ?? { id: "0", username: "unknown", display_name: "Unknown", avatar: null, banner: null, bio: "", pronouns: "", accent_color: null, profile_theme: null },
      member_nick: r.member_nick ?? null,
      member: r.guild_id && (r.member_avatar_key || r.member_profile_theme) ? { avatar: mediaUrl(r.member_avatar_key), profile_theme: r.member_profile_theme ?? null } : null,
      content: r.deleted_at ? "" : r.content, type: r.type, created_at: r.created_at, edited_at: r.edited_at, pinned: r.pinned,
      reply_to: r.reply_to_id ? (rep ? { id: rep.id, author: prefixedUser(rep, "a_"), content: rep.deleted_at ? "" : (String(rep.content).startsWith(PREFIX) ? String(rep.content) : String(rep.content).slice(0, 200)), deleted: !!rep.deleted_at } : { id: String(r.reply_to_id), author: null, content: "", deleted: true }) : null,
      mentions: (r.mentions ?? []).map(String), mention_roles: (r.mention_roles ?? []).map(String), mention_everyone: r.mention_everyone,
      attachments: atts.filter((a) => a.message_id === r.id).map((a) => ({
        id: a.id, filename: a.filename, content_type: a.content_type, size: Number(a.size), url: attUrl(a), width: a.width, height: a.height, duration: a.duration, waveform: a.waveform,
      })),
      reactions: reacts.filter((x) => x.message_id === r.id).map((x) => ({ emoji: x.emoji, count: x.count, me: !!x.me })),
      nonce: r.nonce ?? null,
      stickers: r.sticker_id && !r.deleted_at ? stickers.filter((s) => String(s.id) === String(r.sticker_id)).map(stickerOut) : [],
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
    }).parse(req.body);
    const content = b.content.replace(/\s+$/, "");
    if (!content.trim() && !b.attachment_ids.length && !b.sticker_ids.length) throw bad("Messages can't be empty.");
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
    let replyTo: string | null = null;
    if (b.reply_to) {
      const r = await q1<any>("select id::text, channel_id::text, author_id::text from messages where id = $1 and deleted_at is null", [b.reply_to]);
      if (!r || r.channel_id !== channel.id) throw bad("You can only reply to messages in this channel.");
      replyTo = r.id;
    }
    const mentions = parseMentions(content);
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
          `insert into messages(id, channel_id, guild_id, author_id, content, type, reply_to_id, nonce, mention_everyone, mentions, mention_roles, sticker_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [id, channel.id, channel.guild_id, me, content, replyTo ? MessageType.REPLY : MessageType.DEFAULT, replyTo, b.nonce ?? null, everyone, mentions.users, roleMentions, sticker?.id ?? null]);
        if (b.attachment_ids.length) {
          const r = await c.query("update attachments set message_id = $1 where id = any($2::bigint[]) and uploader_id = $3 and channel_id = $4 and message_id is null returning id", [id, b.attachment_ids, me, channel.id]);
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
    return msg;
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
    if (!content.trim() && !hasAtt) throw bad("Messages can't be empty — delete it instead.");
    const mentions = parseMentions(content);
    await q("update messages set content = $2, edited_at = now(), mentions = $3, mention_everyone = mention_everyone and $4 where id = $1", [m.id, content, mentions.users, mentions.everyone]);
    const msg = (await messageById(m.id, me))!;
    const { reactions: _r, ...withoutReactions } = msg;
    await toChannel(channel, "MESSAGE_UPDATE", withoutReactions);
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
    const file = await req.file({ limits: { fileSize: config.limits.max_upload_bytes, files: 1 } });
    if (!file) throw bad("Attach a file.");
    const fields = file.fields as Record<string, any>;
    const field = (k: string) => (fields[k] && "value" in fields[k] ? String(fields[k].value) : undefined);
    if (!channel.guild_id && config.requireDmE2ee && (field("encrypted") !== "1" || file.filename !== "encrypted.send")) throw bad("Direct-message attachments must be encrypted before upload.");
    const id = newId();
    const name = safeName(file.filename || "file");
    const key = `att/${channel.guild_id ? `g${channel.guild_id}` : "dm"}/c${channel.id}/${id}`;
    let size: number;
    try { size = await storage.put(key, file.file, config.limits.max_upload_bytes); }
    catch (e: any) {
      if (e?.code === "too_large" || file.file.truncated) throw new ApiError(413, "too_large", `Files can be up to ${Math.round(config.limits.max_upload_bytes / 1048576)} MB on this server.`);
      throw e;
    }
    if (file.file.truncated) { await storage.remove(key); throw new ApiError(413, "too_large", `Files can be up to ${Math.round(config.limits.max_upload_bytes / 1048576)} MB on this server.`); }
    // Trust the bytes, not the client's claimed type.
    const head = await new Promise<Buffer>((res, rej) => { const chunks: Buffer[] = []; storage.open(key, { start: 0, end: 4100 }).on("data", (c) => chunks.push(c as Buffer)).on("end", () => res(Buffer.concat(chunks))).on("error", rej); });
    const sniff = await fileTypeFromBuffer(head);
    let type = sniff?.mime ?? (/^text\/plain/.test(file.mimetype) && !head.includes(0) ? "text/plain" : "application/octet-stream");
    if (!channel.guild_id && field("encrypted") === "1") type = "application/octet-stream";
    if (type === "image/svg+xml") type = "application/octet-stream"; // never render uploaded SVG
    const num = (v: string | undefined, max: number) => (v && /^\d+(\.\d+)?$/.test(v) ? Math.min(Number(v), max) : null);
    await q(`insert into attachments(id, channel_id, uploader_id, filename, content_type, size, storage_key, width, height, duration, waveform)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, channel.id, me, name, type, size, key, num(field("width"), 20000), num(field("height"), 20000), num(field("duration"), 86400), (field("waveform") ?? "").slice(0, 400) || null]);
    return { id, filename: name, content_type: type, size, url: attUrl({ id, filename: name }) };
  });

  app.delete<{ Params: { aid: string } }>("/api/attachments/:aid", async (req) => {
    const a = await q1<any>("delete from attachments where id = $1 and uploader_id = $2 and message_id is null returning storage_key", [req.params.aid, uid(req)]);
    if (a) await storage.remove(a.storage_key).catch(() => {});
    return { ok: true };
  });
}

/** Attachment download — permission-checked on every request; no public URLs. */
export async function attachmentDownloadRoute(app: FastifyInstance) {
  app.get<{ Params: { aid: string; name: string } }>("/api/attachments/:aid/:name", { preHandler: requireUser }, async (req, reply) => {
    if (!/^\d{1,20}$/.test(req.params.aid)) throw notFound("File");
    const a = await q1<any>("select a.*, m.deleted_at from attachments a left join messages m on m.id = a.message_id where a.id = $1", [req.params.aid]);
    if (!a || a.deleted_at) throw notFound("File");
    if (a.message_id) await requireChannel(uid(req), a.channel_id, P.READ_MESSAGE_HISTORY);
    else if (a.uploader_id !== uid(req)) throw notFound("File");
    const inline = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|ogg|wav|webm|mp4|x-m4a|aac|flac))$/.test(a.content_type);
    const total = Number(a.size);
    reply.header("content-type", a.content_type);
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    reply.header("cache-control", "private, max-age=3600");
    reply.header("accept-ranges", "bytes");
    reply.header("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
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
