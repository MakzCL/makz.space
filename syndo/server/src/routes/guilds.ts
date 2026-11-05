import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ALL_PERMISSIONS, ChannelType, DEFAULT_EVERYONE, MessageType, P, channelPermissions, has, isVoiceType, outranks, topPosition,
  type MemberLike, type RoleLike,
} from "@syndo/shared";
import { config } from "../config.ts";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { randomCode } from "../crypto.ts";
import { ApiError, bad, conflict, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { dropVoice, onlineMembers, presenceOf, toGuild, toUser, voiceStates } from "../gateway.ts";
import { removeFromRoom, restrictPublishing } from "../media.ts";
import { getChannel, guildPermData, loadMember, overwritesFor, permsFor, requireChannel, requireGuild } from "../perms.ts";
import { guildFor } from "../ready.ts";
import { USER_COLS, channelOut, mediaUrl, roleOut, userOut } from "../serialize.ts";
import * as storage from "../storage.ts";
import { readImage } from "../uploads.ts";
import { validateProfileTheme } from "@syndo/shared";
import { createSystemMessage } from "./messages.ts";

const ID = z.string().regex(/^\d{1,20}$/);
const PERMS = z.union([z.string().regex(/^\d{1,20}$/), z.number().int().nonnegative()]).transform((v) => BigInt(v) & ALL_PERMISSIONS);
const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export async function audit(guildId: string, userId: string | null, action: string, targetId: string | null, changes?: unknown, reason?: string | null) {
  await q("insert into audit_log(id, guild_id, user_id, action, target_id, changes, reason) values ($1,$2,$3,$4,$5,$6,$7)",
    [newId(), guildId, userId, action, targetId, changes ? JSON.stringify(changes) : null, reason ?? null]);
}

/**
 * After anything that can change who sees what (roles, overwrites, member
 * roles, timeouts): re-send each online member their view of the guild, and
 * enforce voice access — anyone who lost CONNECT is removed from the media
 * room, anyone who lost SPEAK/VIDEO loses the right to publish.
 */
export async function resyncGuild(guildId: string, only?: string[]) {
  const users = only ?? (await onlineMembers(guildId));
  for (const u of users) {
    const g = await guildFor(u, guildId);
    if (g) toUser(u, "GUILD_SYNC", g);
  }
  for (const v of voiceStates()) {
    if (v.guild_id !== guildId || (only && !only.includes(v.user_id))) continue;
    const ch = await getChannel(v.channel_id);
    const p = ch ? await permsFor(v.user_id, ch) : 0n;
    if (!has(p, P.VIEW_CHANNEL) || !has(p, P.CONNECT)) { await dropVoice(v.user_id); await removeFromRoom(v.channel_id, v.user_id); }
    else {
      const m = await q1<any>("select mute from members where guild_id = $1 and user_id = $2", [guildId, v.user_id]);
      await restrictPublishing(v.channel_id, v.user_id, has(p, P.SPEAK) && !m?.mute, has(p, P.VIDEO));
    }
  }
}

async function memberOut(guildId: string, userId: string) {
  const r = await q1<any>(
    `select m.nick, m.joined_at, m.communication_disabled_until, m.mute, m.deaf, m.avatar_key as m_avatar_key, m.bio as m_bio, m.banner_key as m_banner_key, m.pronouns as m_pronouns, m.profile_theme as m_profile_theme, m.custom_status as m_custom_status, ${USER_COLS}, coalesce((select array_agg(role_id::text) from member_roles mr where mr.guild_id = m.guild_id and mr.user_id = m.user_id), '{}') as roles
       from members m join users u on u.id = m.user_id where m.guild_id = $1 and m.user_id = $2`, [guildId, userId]);
  return r && {
    guild_id: guildId, user: userOut(r), nick: r.nick, roles: r.roles, joined_at: r.joined_at,
    communication_disabled_until: r.communication_disabled_until, mute: r.mute, deaf: r.deaf,
    guild_avatar: mediaUrl(r.m_avatar_key), guild_bio: r.m_bio, presence: presenceOf(userId), ...serverProfile(r),
  };
}

/** Server-specific profile fields. null = the member uses their global value. */
export const serverProfile = (r: any) => ({
  guild_banner: mediaUrl(r.m_banner_key), guild_pronouns: r.m_pronouns ?? null, guild_profile_theme: r.m_profile_theme ?? null, guild_status: r.m_custom_status ?? null,
});

/** Add a member (invite accept / create). Throws if banned or limits hit. */
export async function addMember(guildId: string, userId: string) {
  if (await q1("select 1 from bans where guild_id = $1 and user_id = $2", [guildId, userId])) throw forbidden("You're banned from this server.");
  if (await q1("select 1 from members where guild_id = $1 and user_id = $2", [guildId, userId])) return false;
  const count = await q1<any>("select count(*)::int as n from members where user_id = $1", [userId]);
  if (count.n >= config.limits.max_guilds_per_user) throw bad(`You can be in up to ${config.limits.max_guilds_per_user} servers on this instance.`, "guild_limit");
  const size = await q1<any>("select count(*)::int as n from members where guild_id = $1", [guildId]);
  if (size.n >= config.limits.max_members_per_guild) throw bad("This server is full.", "guild_full");
  await q("insert into members(guild_id, user_id) values ($1,$2)", [guildId, userId]);
  const g = await q1<any>("select system_channel_id from guilds where id = $1", [guildId]);
  const m = await memberOut(guildId, userId);
  await toGuild(guildId, "GUILD_MEMBER_ADD", m);
  const full = await guildFor(userId, guildId);
  toUser(userId, "GUILD_CREATE", full);
  if (g?.system_channel_id) await createSystemMessage(g.system_channel_id, guildId, userId, MessageType.MEMBER_JOIN, "");
  return true;
}

async function removeMember(guildId: string, userId: string) {
  await q("delete from members where guild_id = $1 and user_id = $2", [guildId, userId]);
  toUser(userId, "GUILD_DELETE", { id: guildId });
  await toGuild(guildId, "GUILD_MEMBER_REMOVE", { guild_id: guildId, user_id: userId });
  const v = voiceStates().find((x) => x.user_id === userId && x.guild_id === guildId);
  if (v) { await dropVoice(userId); await removeFromRoom(v.channel_id, userId); }
}

/** Ensure actor can manage `roleIds` (all strictly below their top role, unless owner). */
function canManageRoles(guild: { owner_id: string }, actor: MemberLike, roles: RoleLike[], roleIds: string[]) {
  if (actor.user_id === guild.owner_id) return true;
  const top = topPosition(actor, roles);
  const byId = new Map(roles.map((r) => [r.id, r]));
  return roleIds.every((id) => (byId.get(id)?.position ?? Infinity) < top);
}

async function createChannelRow(c: any, guildId: string, b: { name: string; type: number; parent_id?: string | null; topic?: string | null; position?: number }, overwrites?: { target_id: string; target_type: 0 | 1; allow: bigint; deny: bigint }[]) {
  const id = newId();
  let synced = true;
  let ows = overwrites;
  if (b.parent_id && !ows) {
    ows = (await c.query("select target_id::text, target_type, allow, deny from permission_overwrites where channel_id = $1", [b.parent_id])).rows;
  } else if (ows) synced = false;
  const pos = b.position ?? ((await c.query("select coalesce(max(position), -1) + 1 as p from channels where guild_id = $1", [guildId])).rows[0].p);
  await c.query(
    `insert into channels(id, guild_id, type, name, topic, parent_id, position, permission_synced, bitrate) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, guildId, b.type, b.name, b.topic ?? null, b.parent_id ?? null, pos, synced, isVoiceType(b.type) ? 96000 : 0]);
  for (const o of ows ?? []) {
    await c.query("insert into permission_overwrites(channel_id, target_id, target_type, allow, deny) values ($1,$2,$3,$4,$5)", [id, o.target_id, o.target_type, String(o.allow), String(o.deny)]);
  }
  return id;
}

/** Channel names are kept as typed (spaces, capitals, emoji); only invisible/control characters are removed. */
function channelName(type: number, name: string, allowEmpty = false) {
  const n = name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, 100);
  // A category with a banner may go without a title (the art is its label).
  if (!n && allowEmpty && type === ChannelType.CATEGORY) return "";
  if (!n) throw bad("Give the channel a name.");
  return n;
}

export async function guildRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /* --------------------------------------------------------- guilds -- */
  app.post("/api/guilds", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const b = z.object({ name: z.string().trim().min(2).max(100), template: z.enum(["default", "friends", "study", "gaming", "blank"]).default("default") }).parse(req.body);
    const me = uid(req);
    const count = await q1<any>("select count(*)::int as n from members where user_id = $1", [me]);
    if (count.n >= config.limits.max_guilds_per_user) throw bad(`You can be in up to ${config.limits.max_guilds_per_user} servers on this instance.`);
    const gid = newId();
    await tx(async (c) => {
      await c.query("insert into guilds(id, name, owner_id) values ($1,$2,$3)", [gid, b.name, me]);
      await c.query("insert into roles(id, guild_id, name, permissions, position) values ($1,$1,'@everyone',$2,0)", [gid, String(DEFAULT_EVERYONE)]);
      await c.query("insert into members(guild_id, user_id) values ($1,$2)", [gid, me]);
      const T = TEMPLATES[b.template];
      let system: string | null = null;
      for (const cat of T) {
        const catId = cat.name ? await createChannelRow(c, gid, { name: cat.name, type: ChannelType.CATEGORY }) : null;
        for (const ch of cat.channels) {
          const id = await createChannelRow(c, gid, { name: ch.name, type: ch.type, parent_id: catId, topic: ch.topic });
          if (!system && ch.type === ChannelType.TEXT) system = id;
        }
      }
      await c.query("update guilds set system_channel_id = $2 where id = $1", [gid, system]);
    });
    await audit(gid, me, "guild_create", gid, { name: b.name });
    const g = await guildFor(me, gid);
    toUser(me, "GUILD_CREATE", g);
    return g;
  });

  app.get<{ Params: { id: string } }>("/api/guilds/:id", async (req) => {
    await requireGuild(uid(req), req.params.id);
    return guildFor(uid(req), req.params.id);
  });

  app.patch<{ Params: { id: string } }>("/api/guilds/:id", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const b = z.object({
      name: z.string().trim().min(2).max(100).optional(),
      description: z.string().max(300).nullable().optional(),
      system_channel_id: ID.nullable().optional(),
      afk_channel_id: ID.nullable().optional(),
      afk_timeout: z.number().int().min(60).max(3600).optional(),
      rules_channel_id: ID.nullable().optional(),
      vanity_code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,32}$/).nullable().optional(),
      tag: z.string().regex(/^[A-Za-z0-9]{2,4}$/).nullable().optional(),
      verification_level: z.number().int().min(0).max(4).optional(),
      discoverable: z.boolean().optional(),
    }).strict().parse(req.body);
    for (const k of ["system_channel_id", "afk_channel_id", "rules_channel_id"] as const) {
      if (b[k]) {
        const ch = await q1<any>("select type from channels where id = $1 and guild_id = $2", [b[k], guild.id]);
        if (!ch) throw bad("That channel isn't in this server.");
        if (k === "afk_channel_id" && ch.type !== ChannelType.VOICE) throw bad("The AFK channel must be a voice channel.");
      }
    }
    if (b.vanity_code) {
      const taken = await q1("select 1 from guilds where vanity_code = $1 and id <> $2 union select 1 from invites where lower(code) = $1", [b.vanity_code, guild.id]);
      if (taken) throw conflict("That invite link is taken.", "vanity_taken");
    }
    const entries = Object.entries(b).filter(([, v]) => v !== undefined);
    if (entries.length) {
      await q(`update guilds set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [guild.id, ...entries.map(([, v]) => v)]);
      await audit(guild.id, uid(req), "guild_update", guild.id, Object.fromEntries(entries));
    }
    await resyncGuild(guild.id);
    return guildFor(uid(req), guild.id);
  });

  for (const kind of ["icon", "banner"] as const) {
    app.post<{ Params: { id: string } }>(`/api/guilds/:id/${kind}`, async (req) => {
      const { guild } = await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
      const img = await readImage(req, config.maxAvatarBytes);
      const key = `guild-${kind}s/${guild.id}/${newId()}.${img.ext}`;
      await storage.put(key, img.buf);
      await q(`update guilds set ${kind}_key = $2 where id = $1`, [guild.id, key]);
      if (guild[`${kind}_key`]) await storage.remove(guild[`${kind}_key`]).catch(() => {});
      await audit(guild.id, uid(req), `guild_${kind}_update`, guild.id);
      await resyncGuild(guild.id);
      return { url: mediaUrl(key), animated: img.animated };
    });
  }

  app.delete<{ Params: { id: string } }>("/api/guilds/:id", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id);
    if (guild.owner_id !== uid(req)) throw forbidden("Only the owner can delete a server.");
    const users = await onlineMembers(guild.id);
    for (const v of voiceStates().filter((v) => v.guild_id === guild.id)) { await dropVoice(v.user_id); await removeFromRoom(v.channel_id, v.user_id); }
    await q("delete from guilds where id = $1", [guild.id]);
    await storage.removePrefix(`att/g${guild.id}`).catch(() => {});
    for (const prefix of ["emoji", "sounds", "channel-banners", "stickers"]) await storage.removePrefix(`${prefix}/${guild.id}/`).catch(() => {});
    for (const u of users) toUser(u, "GUILD_DELETE", { id: guild.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/guilds/:id/transfer", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id);
    if (guild.owner_id !== uid(req)) throw forbidden("Only the owner can transfer ownership.");
    const { user_id } = z.object({ user_id: ID }).parse(req.body);
    if (!(await loadMember(guild.id, user_id))) throw bad("The new owner must be a member.");
    await q("update guilds set owner_id = $2 where id = $1", [guild.id, user_id]);
    await audit(guild.id, uid(req), "guild_transfer", user_id);
    await resyncGuild(guild.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/guilds/:id/members/@me", async (req) => {
    const { guild } = await requireGuild(uid(req), req.params.id);
    if (guild.owner_id === uid(req)) throw bad("Transfer ownership or delete the server before leaving.", "owner_cannot_leave");
    await removeMember(guild.id, uid(req));
    return { ok: true };
  });

  /* -------------------------------------------------------- members -- */
  app.get<{ Params: { id: string }; Querystring: { q?: string; limit?: string; after?: string } }>("/api/guilds/:id/members", async (req) => {
    await requireGuild(uid(req), req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 1000) || 1000, 1), 1000);
    const search = req.query.q?.trim().toLowerCase().slice(0, 32) || null;
    const rows = await q<any>(
      `select m.nick, m.joined_at, m.communication_disabled_until, m.mute, m.deaf, m.avatar_key as m_avatar_key, m.bio as m_bio, m.banner_key as m_banner_key, m.pronouns as m_pronouns, m.profile_theme as m_profile_theme, m.custom_status as m_custom_status, ${USER_COLS}, coalesce((select array_agg(role_id::text) from member_roles mr where mr.guild_id = m.guild_id and mr.user_id = m.user_id), '{}') as roles
         from members m join users u on u.id = m.user_id
        where m.guild_id = $1 and ($2::text is null or u.username ilike $2 || '%' or lower(coalesce(m.nick, u.display_name, '')) like '%' || $2 || '%')
          and ($3::bigint is null or m.user_id > $3)
        order by m.user_id limit $4`, [req.params.id, search, req.query.after && /^\d+$/.test(req.query.after) ? req.query.after : null, limit]);
    return rows.map((r) => ({
      guild_id: req.params.id, user: userOut(r), nick: r.nick, roles: r.roles, joined_at: r.joined_at,
      communication_disabled_until: r.communication_disabled_until, mute: r.mute, deaf: r.deaf,
      guild_avatar: mediaUrl(r.m_avatar_key), guild_bio: r.m_bio, presence: presenceOf(r.id), ...serverProfile(r),
    }));
  });

  app.patch<{ Params: { id: string; uid: string } }>("/api/guilds/:id/members/:uid", async (req) => {
    const me = uid(req);
    const target = req.params.uid === "@me" ? me : req.params.uid;
    const ctx = await requireGuild(me, req.params.id);
    const tm = await loadMember(req.params.id, target);
    if (!tm) throw notFound("Member");
    const b = z.object({
      nick: z.string().trim().max(32).nullable().optional(),
      roles: z.array(ID).max(250).optional(),
      communication_disabled_until: z.string().datetime().nullable().optional(),
      mute: z.boolean().optional(),
      deaf: z.boolean().optional(),
      channel_id: ID.nullable().optional(),
      bio: z.string().max(400).nullable().optional(),
      pronouns: z.string().max(40).nullable().optional(),
      profile_theme: z.unknown().optional(),
      custom_status: z.object({ text: z.string().max(128), emoji: z.string().max(64).nullable().optional() }).nullable().optional(),
      reason: z.string().max(512).optional(),
    }).strict().parse(req.body);
    const self = target === me;
    const ranks = self || outranks(ctx.guild, ctx.member, tm, ctx.roles);
    const changes: Record<string, unknown> = {};
    if (b.nick !== undefined) {
      if (self ? !has(ctx.perms, P.CHANGE_NICKNAME) && !has(ctx.perms, P.MANAGE_NICKNAMES) : !has(ctx.perms, P.MANAGE_NICKNAMES) || !ranks) throw forbidden();
      await q("update members set nick = $3 where guild_id = $1 and user_id = $2", [ctx.guild.id, target, b.nick || null]);
      changes.nick = b.nick;
    }
    if (b.bio !== undefined || b.pronouns !== undefined || b.profile_theme !== undefined || b.custom_status !== undefined) {
      if (!self) throw forbidden("Only you can edit your server profile.");
      let theme: unknown = undefined;
      if (b.profile_theme !== undefined) {
        if (b.profile_theme === null) theme = null;
        else {
          const r = validateProfileTheme(b.profile_theme);
          const errs = r.issues.filter((i) => i.level === "error");
          if (errs.length) throw bad(`profile_theme.${errs[0]!.path} ${errs[0]!.message}`);
          theme = r.value;
        }
      }
      // Each field: undefined = leave, null/"" = use global value.
      await q(`update members set
                 bio = case when $3::boolean then $4 else bio end, pronouns = case when $5::boolean then $6 else pronouns end,
                 profile_theme = case when $7::boolean then $8::jsonb else profile_theme end, custom_status = case when $9::boolean then $10::jsonb else custom_status end
               where guild_id = $1 and user_id = $2`,
        [ctx.guild.id, target, b.bio !== undefined, b.bio || null, b.pronouns !== undefined, b.pronouns || null,
          theme !== undefined, theme ? JSON.stringify(theme) : null, b.custom_status !== undefined, b.custom_status ? JSON.stringify(b.custom_status) : null]);
    }
    if (b.roles) {
      if (!has(ctx.perms, P.MANAGE_ROLES)) throw forbidden();
      if (!self && !ranks) throw forbidden("You can only change roles of members below you.");
      const valid = new Set(ctx.roles.map((r) => r.id));
      const next = [...new Set(b.roles)].filter((r) => r !== ctx.guild.id);
      if (next.some((r) => !valid.has(r))) throw bad("Unknown role.");
      const added = next.filter((r) => !tm.roles.includes(r)), removed = tm.roles.filter((r) => !next.includes(r));
      if (!canManageRoles(ctx.guild, ctx.member, ctx.roles, [...added, ...removed])) throw forbidden("You can only assign roles below your highest role.");
      await tx(async (c) => {
        await c.query("delete from member_roles where guild_id = $1 and user_id = $2", [ctx.guild.id, target]);
        for (const r of next) await c.query("insert into member_roles(guild_id, user_id, role_id) values ($1,$2,$3)", [ctx.guild.id, target, r]);
      });
      changes.roles = { added, removed };
    }
    if (b.communication_disabled_until !== undefined) {
      if (self || !has(ctx.perms, P.MODERATE_MEMBERS) || !ranks) throw forbidden();
      const until = b.communication_disabled_until ? new Date(b.communication_disabled_until) : null;
      if (until && (until.getTime() - Date.now() > 28 * 86400e3)) throw bad("Timeouts can last up to 28 days.");
      const tdata = await guildPermData(ctx.guild.id);
      if (until && tdata && has(channelPermissions(tdata.guild, tm, tdata.roles, []), P.ADMINISTRATOR)) throw forbidden("Administrators can't be timed out.");
      await q("update members set communication_disabled_until = $3 where guild_id = $1 and user_id = $2", [ctx.guild.id, target, until]);
      changes.timeout = until;
    }
    if (b.mute !== undefined || b.deaf !== undefined) {
      if (b.mute !== undefined && !has(ctx.perms, P.MUTE_MEMBERS)) throw forbidden();
      if (b.deaf !== undefined && !has(ctx.perms, P.DEAFEN_MEMBERS)) throw forbidden();
      if (!ranks && !self) throw forbidden();
      await q("update members set mute = coalesce($3, mute), deaf = coalesce($4, deaf) where guild_id = $1 and user_id = $2", [ctx.guild.id, target, b.mute ?? null, b.deaf ?? null]);
      changes.mute = b.mute; changes.deaf = b.deaf;
      const v = voiceStates().find((x) => x.user_id === target && x.guild_id === ctx.guild.id);
      if (v) {
        const { setVoice } = await import("../gateway.ts");
        await setVoice(target, v.session_id, { ...v });
        const ch = await getChannel(v.channel_id);
        const p = ch ? await permsFor(target, ch) : 0n;
        await restrictPublishing(v.channel_id, target, has(p, P.SPEAK) && !(b.mute ?? false), has(p, P.VIDEO));
      }
    }
    if (b.channel_id !== undefined) {
      if (!has(ctx.perms, P.MOVE_MEMBERS) && !self) throw forbidden();
      const v = voiceStates().find((x) => x.user_id === target && x.guild_id === ctx.guild.id);
      if (!v) throw bad("That member isn't in a voice channel.");
      if (b.channel_id === null) { await dropVoice(target); await removeFromRoom(v.channel_id, target); }
      else {
        const dest = await getChannel(b.channel_id);
        if (!dest || dest.guild_id !== ctx.guild.id || !isVoiceType(dest.type)) throw bad("Pick a voice channel in this server.");
        if (!has(await permsFor(target, dest), P.CONNECT)) throw bad("They can't connect to that channel.");
        toUser(target, "VOICE_MOVE", { channel_id: dest.id });
      }
      changes.voice = b.channel_id;
    }
    if (!self || b.roles) await audit(ctx.guild.id, me, "member_update", target, changes, b.reason);
    const m = await memberOut(ctx.guild.id, target);
    await toGuild(ctx.guild.id, "GUILD_MEMBER_UPDATE", m);
    if (b.roles || b.communication_disabled_until !== undefined) await resyncGuild(ctx.guild.id, [target]);
    return m;
  });

  /** Server-specific avatar / banner (static or animated). DELETE = use the global one. */
  for (const kind of ["avatar", "banner"] as const) {
    app.post<{ Params: { id: string } }>(`/api/guilds/:id/members/@me/${kind}`, async (req) => {
      const ctx = await requireGuild(uid(req), req.params.id);
      const img = await readImage(req, config.maxAvatarBytes);
      const key = `member-${kind}s/${uid(req)}/${newId()}.${img.ext}`;
      await storage.put(key, img.buf);
      const old = await q1<any>(`select ${kind}_key as k from members where guild_id = $1 and user_id = $2`, [ctx.guild.id, uid(req)]);
      await q(`update members set ${kind}_key = $3 where guild_id = $1 and user_id = $2`, [ctx.guild.id, uid(req), key]);
      if (old?.k) await storage.remove(old.k).catch(() => {});
      await toGuild(ctx.guild.id, "GUILD_MEMBER_UPDATE", await memberOut(ctx.guild.id, uid(req)));
      return { url: mediaUrl(key), animated: img.animated };
    });
    app.delete<{ Params: { id: string } }>(`/api/guilds/:id/members/@me/${kind}`, async (req) => {
      const ctx = await requireGuild(uid(req), req.params.id);
      const old = await q1<any>(`select ${kind}_key as k from members where guild_id = $1 and user_id = $2`, [ctx.guild.id, uid(req)]);
      await q(`update members set ${kind}_key = null where guild_id = $1 and user_id = $2`, [ctx.guild.id, uid(req)]);
      if (old?.k) await storage.remove(old.k).catch(() => {});
      await toGuild(ctx.guild.id, "GUILD_MEMBER_UPDATE", await memberOut(ctx.guild.id, uid(req)));
      return { ok: true };
    });
  }

  app.delete<{ Params: { id: string; uid: string }; Querystring: { reason?: string } }>("/api/guilds/:id/members/:uid", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.KICK_MEMBERS);
    const tm = await loadMember(ctx.guild.id, req.params.uid);
    if (!tm) throw notFound("Member");
    if (!outranks(ctx.guild, ctx.member, tm, ctx.roles)) throw forbidden("You can only kick members below you.");
    await removeMember(ctx.guild.id, req.params.uid);
    await audit(ctx.guild.id, uid(req), "member_kick", req.params.uid, null, req.query.reason);
    return { ok: true };
  });

  /* ----------------------------------------------------------- bans -- */
  app.get<{ Params: { id: string } }>("/api/guilds/:id/bans", async (req) => {
    await requireGuild(uid(req), req.params.id, P.BAN_MEMBERS);
    const rows = await q<any>(`select b.reason, b.created_at, ${USER_COLS} from bans b join users u on u.id = b.user_id where b.guild_id = $1 order by b.created_at desc`, [req.params.id]);
    return rows.map((r) => ({ user: userOut(r), reason: r.reason, created_at: r.created_at }));
  });

  app.put<{ Params: { id: string; uid: string } }>("/api/guilds/:id/bans/:uid", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.BAN_MEMBERS);
    const b = z.object({ reason: z.string().max(512).optional(), delete_message_seconds: z.number().int().min(0).max(604800).default(0) }).parse(req.body ?? {});
    const target = req.params.uid;
    if (!(await q1("select 1 from users where id = $1", [target]))) throw notFound("User");
    const tm = await loadMember(ctx.guild.id, target);
    if (target === uid(req)) throw bad("You can't ban yourself.");
    if (tm && !outranks(ctx.guild, ctx.member, tm, ctx.roles)) throw forbidden("You can only ban members below you.");
    if (target === ctx.guild.owner_id) throw forbidden();
    await q("insert into bans(guild_id, user_id, reason, moderator_id) values ($1,$2,$3,$4) on conflict do nothing", [ctx.guild.id, target, b.reason ?? null, uid(req)]);
    if (tm) await removeMember(ctx.guild.id, target);
    if (b.delete_message_seconds > 0) {
      const del = await q<any>(
        `update messages set deleted_at = now(), content = '' where guild_id = $1 and author_id = $2 and deleted_at is null and created_at > now() - make_interval(secs => $3) returning id::text, channel_id::text`,
        [ctx.guild.id, target, b.delete_message_seconds]);
      const byCh = new Map<string, string[]>();
      for (const d of del) byCh.set(d.channel_id, [...(byCh.get(d.channel_id) ?? []), d.id]);
      const { toChannel } = await import("../gateway.ts");
      for (const [cid, ids] of byCh) { const ch = await getChannel(cid); if (ch) await toChannel(ch, "MESSAGE_DELETE_BULK", { channel_id: cid, ids }); }
    }
    await audit(ctx.guild.id, uid(req), "member_ban", target, { delete_message_seconds: b.delete_message_seconds }, b.reason);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; uid: string } }>("/api/guilds/:id/bans/:uid", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.BAN_MEMBERS);
    const r = await q1("delete from bans where guild_id = $1 and user_id = $2 returning 1", [ctx.guild.id, req.params.uid]);
    if (!r) throw notFound("Ban");
    await audit(ctx.guild.id, uid(req), "member_unban", req.params.uid);
    return { ok: true };
  });

  /* ---------------------------------------------------------- roles -- */
  const ROLE = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    color: HEX.nullable().optional(),
    color2: HEX.nullable().optional(),
    permissions: PERMS.optional(),
    hoist: z.boolean().optional(),
    mentionable: z.boolean().optional(),
  }).strict();

  app.post<{ Params: { id: string } }>("/api/guilds/:id/roles", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_ROLES);
    const b = ROLE.parse(req.body ?? {});
    const perms = b.permissions ?? 0n;
    if ((perms & ~ctx.perms) !== 0n) throw forbidden("You can't grant permissions you don't have.");
    const count = await q1<any>("select count(*)::int as n from roles where guild_id = $1", [ctx.guild.id]);
    if (count.n >= 250) throw bad("Servers can have up to 250 roles.");
    const id = newId();
    // New roles go directly above @everyone; existing ones shift up.
    await tx(async (c) => {
      await c.query("update roles set position = position + 1 where guild_id = $1 and position >= 1", [ctx.guild.id]);
      await c.query("insert into roles(id, guild_id, name, color, color2, permissions, position, hoist, mentionable) values ($1,$2,$3,$4,$5,$6,1,$7,$8)",
        [id, ctx.guild.id, b.name ?? "new role", b.color ?? null, b.color2 ?? null, String(perms), b.hoist ?? false, b.mentionable ?? false]);
    });
    await audit(ctx.guild.id, uid(req), "role_create", id, { ...b, permissions: String(perms) });
    await resyncGuild(ctx.guild.id);
    return roleOut(await q1("select * from roles where id = $1", [id]));
  });

  app.patch<{ Params: { id: string; rid: string } }>("/api/guilds/:id/roles/:rid", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_ROLES);
    const role = ctx.roles.find((r) => r.id === req.params.rid);
    if (!role) throw notFound("Role");
    const isOwner = ctx.guild.owner_id === uid(req);
    if (!isOwner && role.id !== ctx.guild.id && role.position >= topPosition(ctx.member, ctx.roles)) throw forbidden("You can only edit roles below your highest role.");
    const b = ROLE.parse(req.body ?? {});
    if (role.id === ctx.guild.id && b.name) throw bad("@everyone can't be renamed.");
    if (b.permissions !== undefined && !isOwner && ((b.permissions ^ BigInt(role.permissions)) & ~ctx.perms) !== 0n) throw forbidden("You can't change permissions you don't have.");
    const entries = Object.entries({ ...b, permissions: b.permissions !== undefined ? String(b.permissions) : undefined }).filter(([, v]) => v !== undefined);
    if (entries.length) await q(`update roles set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [role.id, ...entries.map(([, v]) => v)]);
    await audit(ctx.guild.id, uid(req), "role_update", role.id, Object.fromEntries(entries));
    await resyncGuild(ctx.guild.id);
    return roleOut(await q1("select * from roles where id = $1", [role.id]));
  });

  /** Reorder: body [{id, position}]. Only roles below the actor's top may move, and only below it. */
  app.patch<{ Params: { id: string } }>("/api/guilds/:id/roles", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_ROLES);
    const list = z.array(z.object({ id: ID, position: z.number().int().min(1) })).max(250).parse(req.body);
    const isOwner = ctx.guild.owner_id === uid(req);
    const top = topPosition(ctx.member, ctx.roles);
    for (const it of list) {
      const r = ctx.roles.find((x) => x.id === it.id);
      if (!r || r.id === ctx.guild.id) throw bad("Unknown role.");
      if (!isOwner && (r.position >= top || it.position >= top)) throw forbidden("You can only move roles below your highest role.");
    }
    await tx(async (c) => { for (const it of list) await c.query("update roles set position = $2 where id = $1", [it.id, it.position]); });
    // Normalise to 1..n preserving the requested order.
    await q(`with o as (select id, row_number() over (order by position, id) as p from roles where guild_id = $1 and id <> $1) update roles r set position = o.p from o where r.id = o.id`, [ctx.guild.id]);
    await audit(ctx.guild.id, uid(req), "role_reorder", null, list);
    await resyncGuild(ctx.guild.id);
    return (await q("select * from roles where guild_id = $1 order by position", [ctx.guild.id])).map(roleOut);
  });

  app.delete<{ Params: { id: string; rid: string } }>("/api/guilds/:id/roles/:rid", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_ROLES);
    const role = ctx.roles.find((r) => r.id === req.params.rid);
    if (!role) throw notFound("Role");
    if (role.id === ctx.guild.id) throw bad("@everyone can't be deleted.");
    if (ctx.guild.owner_id !== uid(req) && role.position >= topPosition(ctx.member, ctx.roles)) throw forbidden();
    await q("delete from roles where id = $1", [role.id]);
    await q("delete from permission_overwrites where target_id = $1 and target_type = 0", [role.id]);
    await audit(ctx.guild.id, uid(req), "role_delete", role.id);
    await resyncGuild(ctx.guild.id);
    return { ok: true };
  });

  /* ------------------------------------------------------- channels -- */
  app.post<{ Params: { id: string } }>("/api/guilds/:id/channels", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_CHANNELS);
    const b = z.object({
      name: z.string().max(100),
      type: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(5), z.literal(13), z.literal(15), z.literal(16)]),
      parent_id: ID.nullable().optional(),
      topic: z.string().max(1024).nullable().optional(),
      private: z.boolean().optional(),
    }).parse(req.body);
    if (b.parent_id) {
      const parent = await q1<any>("select type from channels where id = $1 and guild_id = $2", [b.parent_id, ctx.guild.id]);
      if (!parent || parent.type !== ChannelType.CATEGORY) throw bad("Parent must be a category in this server.");
      if (b.type === ChannelType.CATEGORY) throw bad("Categories can't be nested.");
    }
    const count = await q1<any>("select count(*)::int as n from channels where guild_id = $1", [ctx.guild.id]);
    if (count.n >= 500) throw bad("Servers can have up to 500 channels.");
    // Private channel: deny @everyone VIEW, allow the creator explicitly so they keep access.
    const ows = b.private ? [
      { target_id: ctx.guild.id, target_type: 0 as const, allow: 0n, deny: P.VIEW_CHANNEL },
      { target_id: uid(req), target_type: 1 as const, allow: P.VIEW_CHANNEL | P.MANAGE_CHANNELS | P.MANAGE_ROLES, deny: 0n },
    ] : undefined;
    const id = await tx((c) => createChannelRow(c, ctx.guild.id, { name: channelName(b.type, b.name), type: b.type, parent_id: b.parent_id, topic: b.topic }, ows));
    await audit(ctx.guild.id, uid(req), "channel_create", id, b);
    await resyncGuild(ctx.guild.id);
    const ch = await getChannel(id);
    return channelOut(ch, (await overwritesFor([id])).get(id));
  });

  /** Reorder / re-parent: body [{id, position, parent_id?, lock_permissions?}]. */
  app.patch<{ Params: { id: string } }>("/api/guilds/:id/channels", async (req) => {
    const ctx = await requireGuild(uid(req), req.params.id, P.MANAGE_CHANNELS);
    const list = z.array(z.object({ id: ID, position: z.number().int().min(0), parent_id: ID.nullable().optional(), lock_permissions: z.boolean().optional() })).max(500).parse(req.body);
    await tx(async (c) => {
      for (const it of list) {
        const ch = (await c.query("select * from channels where id = $1 and guild_id = $2", [it.id, ctx.guild.id])).rows[0];
        if (!ch) throw bad("Unknown channel.");
        if (it.parent_id) {
          const p = (await c.query("select type from channels where id = $1 and guild_id = $2", [it.parent_id, ctx.guild.id])).rows[0];
          if (!p || p.type !== ChannelType.CATEGORY || ch.type === ChannelType.CATEGORY) throw bad("Invalid parent.");
        }
        await c.query("update channels set position = $2, parent_id = case when $3::boolean then $4::bigint else parent_id end where id = $1", [it.id, it.position, it.parent_id !== undefined, it.parent_id ?? null]);
        if (it.lock_permissions && it.parent_id) await syncFromParent(c, it.id, it.parent_id);
      }
    });
    await audit(ctx.guild.id, uid(req), "channel_reorder", null, list);
    await resyncGuild(ctx.guild.id);
    return { ok: true };
  });

  async function syncFromParent(c: any, channelId: string, parentId: string) {
    await c.query("delete from permission_overwrites where channel_id = $1", [channelId]);
    await c.query("insert into permission_overwrites(channel_id, target_id, target_type, allow, deny) select $1, target_id, target_type, allow, deny from permission_overwrites where channel_id = $2", [channelId, parentId]);
    await c.query("update channels set permission_synced = true where id = $1", [channelId]);
  }

  app.patch<{ Params: { cid: string } }>("/api/channels/:cid", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid);
    if (!channel.guild_id) return (await import("./dms.ts")).patchGroupDm(req, channel);
    const { perms } = await requireChannel(uid(req), channel.id, P.MANAGE_CHANNELS);
    void perms;
    const b = z.object({
      name: z.string().max(100).optional(),
      topic: z.string().max(1024).nullable().optional(),
      nsfw: z.boolean().optional(),
      rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
      bitrate: z.number().int().min(8000).max(config.limits.max_voice_bitrate_kbps * 1000).optional(),
      user_limit: z.number().int().min(0).max(99).optional(),
      parent_id: ID.nullable().optional(),
      position: z.number().int().min(0).optional(),
    }).strict().parse(req.body);
    const upd: Record<string, unknown> = { ...b };
    if (b.name !== undefined) upd.name = channelName(channel.type, b.name, !!(channel as any).banner_key);
    if (b.parent_id) {
      const p = await q1<any>("select type from channels where id = $1 and guild_id = $2", [b.parent_id, channel.guild_id]);
      if (!p || p.type !== ChannelType.CATEGORY || channel.type === ChannelType.CATEGORY) throw bad("Invalid parent.");
    }
    const entries = Object.entries(upd).filter(([, v]) => v !== undefined);
    if (entries.length) await q(`update channels set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [channel.id, ...entries.map(([, v]) => v)]);
    await audit(channel.guild_id, uid(req), "channel_update", channel.id, b);
    await resyncGuild(channel.guild_id);
    return channelOut(await getChannel(channel.id), (await overwritesFor([channel.id])).get(channel.id));
  });

  app.delete<{ Params: { cid: string } }>("/api/channels/:cid", async (req) => {
    const ch = await getChannel(req.params.cid);
    if (ch && !ch.guild_id) return (await import("./dms.ts")).leaveGroupDm(req, ch);
    const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_CHANNELS);
    for (const v of voiceStates().filter((v) => v.channel_id === channel.id)) { await dropVoice(v.user_id); await removeFromRoom(channel.id, v.user_id); }
    await q("delete from channels where id = $1", [channel.id]);
    await q("update guilds set system_channel_id = case when system_channel_id = $1 then null else system_channel_id end, afk_channel_id = case when afk_channel_id = $1 then null else afk_channel_id end, rules_channel_id = case when rules_channel_id = $1 then null else rules_channel_id end where id = $2", [channel.id, channel.guild_id]);
    await storage.removePrefix(`att/g${channel.guild_id}/c${channel.id}`).catch(() => {});
    await audit(channel.guild_id!, uid(req), "channel_delete", channel.id, { name: channel.name });
    await resyncGuild(channel.guild_id!);
    return { ok: true };
  });

  /** Set an overwrite. Category changes propagate to synced children. */
  app.put<{ Params: { cid: string; tid: string } }>("/api/channels/:cid/permissions/:tid", async (req) => {
    const { channel, perms } = await requireChannel(uid(req), req.params.cid, P.MANAGE_ROLES);
    if (!channel.guild_id) throw bad("Not a server channel.");
    const b = z.object({ type: z.union([z.literal(0), z.literal(1)]), allow: PERMS, deny: PERMS }).parse(req.body);
    const ctx = await requireGuild(uid(req), channel.guild_id);
    if (!has(ctx.perms, P.ADMINISTRATOR) && ((b.allow | b.deny) & ~perms) !== 0n) throw forbidden("You can't allow or deny permissions you don't have here.");
    if (b.type === 0 && !ctx.roles.some((r) => r.id === req.params.tid)) throw bad("Unknown role.");
    if (b.type === 1 && !(await loadMember(channel.guild_id, req.params.tid))) throw bad("Unknown member.");
    await tx(async (c) => {
      await c.query(`insert into permission_overwrites(channel_id, target_id, target_type, allow, deny) values ($1,$2,$3,$4,$5)
                     on conflict (channel_id, target_id) do update set target_type = excluded.target_type, allow = excluded.allow, deny = excluded.deny`,
        [channel.id, req.params.tid, b.type, String(b.allow), String(b.deny)]);
      await afterOverwriteChange(c, channel);
    });
    await audit(channel.guild_id, uid(req), "overwrite_update", channel.id, { target: req.params.tid, ...b, allow: String(b.allow), deny: String(b.deny) });
    await resyncGuild(channel.guild_id);
    return { ok: true };
  });

  app.delete<{ Params: { cid: string; tid: string } }>("/api/channels/:cid/permissions/:tid", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_ROLES);
    if (!channel.guild_id) throw bad("Not a server channel.");
    await tx(async (c) => {
      await c.query("delete from permission_overwrites where channel_id = $1 and target_id = $2", [channel.id, req.params.tid]);
      await afterOverwriteChange(c, channel);
    });
    await audit(channel.guild_id, uid(req), "overwrite_delete", channel.id, { target: req.params.tid });
    await resyncGuild(channel.guild_id);
    return { ok: true };
  });

  /** Explicitly re-sync a channel with its category. */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/sync-permissions", async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_ROLES);
    if (!channel.parent_id) throw bad("This channel isn't in a category.");
    await tx((c) => syncFromParent(c, channel.id, channel.parent_id!));
    await audit(channel.guild_id!, uid(req), "overwrite_sync", channel.id);
    await resyncGuild(channel.guild_id!);
    return { ok: true };
  });

  async function afterOverwriteChange(c: any, channel: any) {
    if (channel.type === ChannelType.CATEGORY) {
      const kids = (await c.query("select id from channels where parent_id = $1 and permission_synced", [channel.id])).rows;
      for (const k of kids) await syncFromParent(c, k.id, channel.id);
    } else if (channel.parent_id) {
      await c.query("update channels set permission_synced = false where id = $1", [channel.id]);
    }
  }

  /* -------------------------------------------------------- invites -- */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/invites", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.CREATE_INVITE);
    if (!channel.guild_id) throw bad("Invites are for server channels.");
    const b = z.object({ max_age: z.number().int().min(0).max(30 * 86400).default(7 * 86400), max_uses: z.number().int().min(0).max(1000).default(0) }).parse(req.body ?? {});
    const code = randomCode(8);
    await q("insert into invites(code, guild_id, channel_id, inviter_id, max_uses, expires_at) values ($1,$2,$3,$4,$5, case when $6::int = 0 then null else now() + make_interval(secs => $6) end)",
      [code, channel.guild_id, channel.id, uid(req), b.max_uses, b.max_age]);
    await audit(channel.guild_id, uid(req), "invite_create", null, { code, ...b });
    return inviteOut(code);
  });

  app.get<{ Params: { id: string } }>("/api/guilds/:id/invites", async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_GUILD);
    const rows = await q<any>("select code from invites where guild_id = $1 and revoked_at is null and (expires_at is null or expires_at > now()) order by created_at desc", [req.params.id]);
    return Promise.all(rows.map((r) => inviteOut(r.code)));
  });

  app.get<{ Params: { id: string }; Querystring: { before?: string; action?: string; user_id?: string } }>("/api/guilds/:id/audit-log", async (req) => {
    await requireGuild(uid(req), req.params.id, P.VIEW_AUDIT_LOG);
    const rows = await q<any>(
      `select a.id::text, a.action, a.target_id::text, a.changes, a.reason, a.created_at, ${USER_COLS}
         from audit_log a left join users u on u.id = a.user_id
        where a.guild_id = $1 and ($2::bigint is null or a.id < $2) and ($3::text is null or a.action = $3) and ($4::bigint is null or a.user_id = $4)
        order by a.id desc limit 100`,
      [req.params.id, req.query.before ?? null, req.query.action ?? null, req.query.user_id ?? null]);
    return rows.map((r) => ({ id: r.id, action: r.action, target_id: r.target_id, changes: r.changes, reason: r.reason, created_at: r.created_at, user: r.username ? userOut(r) : null }));
  });
}

/* ------------------------------------------------------ public invites -- */
export async function inviteOut(code: string) {
  const r = await q1<any>(
    `select i.*, g.name, g.icon_key, g.banner_key, g.description, g.vanity_code, (select count(*)::int from members where guild_id = g.id) as member_count,
            ${USER_COLS}
       from invites i join guilds g on g.id = i.guild_id left join users u on u.id = i.inviter_id where i.code = $1`, [code]);
  if (!r) return null;
  return {
    code: r.code, channel_id: r.channel_id, uses: r.uses, max_uses: r.max_uses, expires_at: r.expires_at, created_at: r.created_at,
    guild: { id: r.guild_id, name: r.name, icon: mediaUrl(r.icon_key), banner: mediaUrl(r.banner_key), description: r.description, member_count: r.member_count },
    inviter: r.username ? userOut(r) : null,
  };
}

async function resolveInvite(code: string) {
  const vanity = await q1<any>("select id::text, name, icon_key, banner_key, description, (select count(*)::int from members where guild_id = guilds.id) as member_count from guilds where vanity_code = $1", [code.toLowerCase()]);
  if (vanity) return { vanity: true as const, guild_id: vanity.id, out: { code, channel_id: null, uses: 0, max_uses: 0, expires_at: null, created_at: null, inviter: null, guild: { id: vanity.id, name: vanity.name, icon: mediaUrl(vanity.icon_key), banner: mediaUrl(vanity.banner_key), description: vanity.description, member_count: vanity.member_count } } };
  const inv = await q1<any>("select * from invites where code = $1 and revoked_at is null and (expires_at is null or expires_at > now()) and (max_uses = 0 or uses < max_uses)", [code]);
  if (!inv) return null;
  return { vanity: false as const, guild_id: inv.guild_id as string, out: await inviteOut(code) };
}

export async function inviteRoutes(app: FastifyInstance) {
  /** Preview works signed-out so invite links can show a landing page. */
  app.get<{ Params: { code: string } }>("/api/invites/:code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    if (!/^[A-Za-z0-9-]{3,32}$/.test(req.params.code)) throw notFound("Invite");
    const r = await resolveInvite(req.params.code);
    if (!r) throw new ApiError(404, "invite_invalid", "This invite is invalid or has expired.");
    return r.out;
  });

  app.post<{ Params: { code: string } }>("/api/invites/:code", { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req) => {
    if (!/^[A-Za-z0-9-]{3,32}$/.test(req.params.code)) throw notFound("Invite");
    if (config.requireVerifiedEmail && !req.session!.email_verified) throw forbidden("Verify your email before joining servers.");
    const r = await resolveInvite(req.params.code);
    if (!r) throw new ApiError(404, "invite_invalid", "This invite is invalid or has expired.");
    const already = await q1("select 1 from members where guild_id = $1 and user_id = $2", [r.guild_id, uid(req)]);
    if (!already) {
      if (await q1("select 1 from bans where guild_id = $1 and user_id = $2", [r.guild_id, uid(req)])) throw forbidden("You're banned from this server.");
      if (!r.vanity) {
        // Atomic use count: two people racing for the last use can't both get in.
        const ok = await q1("update invites set uses = uses + 1 where code = $1 and revoked_at is null and (expires_at is null or expires_at > now()) and (max_uses = 0 or uses < max_uses) returning 1", [req.params.code]);
        if (!ok) throw new ApiError(404, "invite_invalid", "This invite is invalid or has expired.");
      }
      await addMember(r.guild_id, uid(req));
    }
    return { guild_id: r.guild_id, joined: !already };
  });

  app.delete<{ Params: { code: string } }>("/api/invites/:code", { preHandler: requireUser }, async (req) => {
    const inv = await q1<any>("select * from invites where code = $1 and revoked_at is null", [req.params.code]);
    if (!inv) throw notFound("Invite");
    if (inv.inviter_id !== uid(req)) await requireGuild(uid(req), inv.guild_id, P.MANAGE_GUILD);
    else await requireGuild(uid(req), inv.guild_id);
    await q("update invites set revoked_at = now() where code = $1", [inv.code]);
    await audit(inv.guild_id, uid(req), "invite_delete", null, { code: inv.code });
    return { ok: true };
  });
}

/* ------------------------------------------------------------- templates -- */
type Tpl = { name: string | null; channels: { name: string; type: number; topic?: string }[] }[];
const TEMPLATES: Record<string, Tpl> = {
  default: [
    { name: "Text Channels", channels: [{ name: "general", type: ChannelType.TEXT, topic: "Say hello!" }] },
    { name: "Voice Channels", channels: [{ name: "General", type: ChannelType.VOICE }] },
  ],
  friends: [
    { name: "Hang out", channels: [{ name: "general", type: ChannelType.TEXT }, { name: "photos", type: ChannelType.TEXT }, { name: "plans", type: ChannelType.TEXT }] },
    { name: "Voice", channels: [{ name: "Lounge", type: ChannelType.VOICE }, { name: "Movie night", type: ChannelType.VOICE }] },
  ],
  study: [
    { name: "Info", channels: [{ name: "welcome", type: ChannelType.TEXT }, { name: "notes", type: ChannelType.TEXT }] },
    { name: "Study", channels: [{ name: "help", type: ChannelType.TEXT }, { name: "session-planning", type: ChannelType.TEXT }, { name: "Study room", type: ChannelType.VOICE }, { name: "Quiet room", type: ChannelType.VOICE }] },
  ],
  gaming: [
    { name: "Info", channels: [{ name: "welcome", type: ChannelType.TEXT }, { name: "announcements", type: ChannelType.ANNOUNCEMENT }] },
    { name: "Chat", channels: [{ name: "general", type: ChannelType.TEXT }, { name: "clips", type: ChannelType.TEXT }, { name: "looking-for-group", type: ChannelType.TEXT }] },
    { name: "Voice", channels: [{ name: "Squad 1", type: ChannelType.VOICE }, { name: "Squad 2", type: ChannelType.VOICE }, { name: "Streams", type: ChannelType.VOICE }] },
  ],
  blank: [{ name: null, channels: [{ name: "general", type: ChannelType.TEXT }] }],
};
