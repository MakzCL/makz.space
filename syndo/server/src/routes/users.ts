import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_PRIVACY, RelationshipType, validateProfileTheme } from "@send/shared";
import { config } from "../config.ts";
import { q, q1, tx } from "../db.ts";
import { clearSessionCookies, requireUser, revokeSessions, uid } from "../auth.ts";
import { verifyPassword } from "../crypto.ts";
import { ApiError, bad, conflict, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { broadcastPresence, closeUser, isOnline, onlineUserIds, presenceOf, toUser, toUsers } from "../gateway.ts";
import { USER_COLS, mediaUrl, selfOut, userOut } from "../serialize.ts";
import * as storage from "../storage.ts";
import { readImage, shrinkImage, IMAGE_MAX } from "../uploads.ts";

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Public profile cosmetics are validated by the shared schema (no markup, no URLs, bounded values). */
const THEME = z.unknown().transform((v, ctx) => {
  const r = validateProfileTheme(v);
  const errs = r.issues.filter((i) => i.level === "error");
  if (errs.length) { ctx.addIssue({ code: "custom", message: `profile_theme.${errs[0]!.path} ${errs[0]!.message}` }); return z.NEVER; }
  return r.value;
});

async function audience(userId: string) {
  const online = onlineUserIds();
  if (!online.length) return [];
  return (await q<{ id: string }>(
    `select other_id::text as id from relationships where user_id = $1 and type in (1,3,4) and other_id = any($2::bigint[])
     union select m2.user_id::text from members m1 join members m2 on m2.guild_id = m1.guild_id where m1.user_id = $1 and m2.user_id = any($2::bigint[])`,
    [userId, online])).map((r) => r.id);
}

export async function publishUser(userId: string) {
  const row = await q1("select * from users where id = $1", [userId]);
  toUser(userId, "USER_UPDATE", selfOut(row));
  toUsers(await audience(userId), "USER_PUBLIC_UPDATE", userOut(row), userId);
}

async function rel(userId: string, otherId: string) {
  return (await q1<{ type: number }>("select type from relationships where user_id = $1 and other_id = $2", [userId, otherId]))?.type ?? 0;
}
async function relOut(userId: string, otherId: string) {
  const r = await q1<any>(`select r.type, r.created_at, ${USER_COLS} from relationships r join users u on u.id = r.other_id where r.user_id = $1 and r.other_id = $2`, [userId, otherId]);
  return r ? { id: otherId, type: r.type, since: r.created_at, user: userOut(r) } : null;
}
async function emitRel(userId: string, otherId: string) {
  const r = await relOut(userId, otherId);
  if (r) toUser(userId, "RELATIONSHIP_ADD", { ...r, presence: presenceOf(otherId) });
  else toUser(userId, "RELATIONSHIP_REMOVE", { id: otherId });
}

async function sharesGuild(a: string, b: string) {
  return !!(await q1("select 1 from members m1 join members m2 on m1.guild_id = m2.guild_id where m1.user_id = $1 and m2.user_id = $2 limit 1", [a, b]));
}
async function hasMutualFriend(a: string, b: string) {
  return !!(await q1("select 1 from relationships r1 join relationships r2 on r1.other_id = r2.other_id where r1.user_id = $1 and r2.user_id = $2 and r1.type = 1 and r2.type = 1 limit 1", [a, b]));
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/users/@me", async (req) => selfOut(await q1("select * from users where id = $1", [uid(req)])));

  app.patch("/api/users/@me", async (req) => {
    const b = z.object({
      username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{2,32}$/).optional(),
      display_name: z.string().trim().max(32).nullable().optional(),
      bio: z.string().max(400).optional(),
      pronouns: z.string().max(40).optional(),
      accent_color: HEX.nullable().optional(),
      profile_theme: THEME.optional(),
      custom_status: z.object({ text: z.string().max(128), emoji: z.string().max(64).nullable().optional(), expires_at: z.string().datetime().nullable().optional() }).nullable().optional(),
      privacy: z.object({
        friend_requests: z.enum(["everyone", "friends_of_friends", "server_members", "nobody"]).optional(),
        dms_from_server_members: z.boolean().optional(),
        show_mutuals: z.boolean().optional(),
      }).optional(),
      status: z.enum(["online", "idle", "dnd", "invisible"]).optional(),
      locale: z.enum(["en", "pl", "fr", "es", "de", "pt", "it", "nl", "ru", "uk", "ar", "tr"]).optional(),
    }).strict().parse(req.body);
    const sets: string[] = []; const vals: unknown[] = [uid(req)];
    const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if (b.username !== undefined) {
      const taken = await q1("select 1 from users where username = $1 and id <> $2", [b.username, uid(req)]);
      if (taken) throw conflict("That username is taken.", "username_taken");
      set("username", b.username);
    }
    if (b.display_name !== undefined) set("display_name", b.display_name || null);
    if (b.bio !== undefined) set("bio", b.bio);
    if (b.pronouns !== undefined) set("pronouns", b.pronouns);
    if (b.locale !== undefined) set("locale", b.locale);
    if (b.accent_color !== undefined) set("accent_color", b.accent_color);
    if (b.profile_theme !== undefined) set("profile_theme", b.profile_theme ? JSON.stringify(b.profile_theme) : null);
    if (b.custom_status !== undefined) set("custom_status", b.custom_status ? JSON.stringify(b.custom_status) : null);
    if (b.privacy) {
      const cur = await q1<any>("select privacy from users where id = $1", [uid(req)]);
      set("privacy", JSON.stringify({ ...DEFAULT_PRIVACY, ...(cur.privacy ?? {}), ...b.privacy }));
    }
    if (b.status) set("status", b.status);
    if (sets.length) await q(`update users set ${sets.join(", ")} where id = $1`, vals);
    if (b.status) { const { setStatus } = await import("../gateway.ts"); await setStatus(uid(req), b.status); }
    if (b.custom_status !== undefined) { const { setCustomStatus } = await import("../gateway.ts"); await setCustomStatus(uid(req), b.custom_status ?? null); }
    await publishUser(uid(req));
    return selfOut(await q1("select * from users where id = $1", [uid(req)]));
  });

  /** Client settings (appearance, notifications, folders…) — synced to every device. */
  app.patch("/api/users/@me/settings", async (req) => {
    const patch = z.record(z.string().max(64), z.unknown()).parse(req.body);
    const json = JSON.stringify(patch);
    if (json.length > 64_000) throw bad("Settings are too large.");
    const r = await q1<any>("update users set settings = settings || $2::jsonb where id = $1 returning settings", [uid(req), json]);
    toUser(uid(req), "USER_SETTINGS_UPDATE", r.settings);
    return r.settings;
  });

  for (const kind of ["avatar", "banner"] as const) {
    app.post(`/api/users/@me/${kind}`, async (req) => {
      const img = await shrinkImage(await readImage(req, config.maxAvatarBytes), kind === "banner" ? IMAGE_MAX.banner : IMAGE_MAX.avatar);
      const key = `${kind}s/${uid(req)}/${newId()}.${img.ext}`;
      await storage.put(key, img.buf);
      const old = await q1<any>(`select ${kind}_key as k from users where id = $1`, [uid(req)]);
      await q(`update users set ${kind}_key = $2 where id = $1`, [uid(req), key]);
      if (old?.k) await storage.remove(old.k).catch(() => {});
      await publishUser(uid(req));
      return { url: mediaUrl(key), animated: img.animated };
    });
    app.delete(`/api/users/@me/${kind}`, async (req) => {
      const old = await q1<any>(`select ${kind}_key as k from users where id = $1`, [uid(req)]);
      await q(`update users set ${kind}_key = null where id = $1`, [uid(req)]);
      if (old?.k) await storage.remove(old.k).catch(() => {});
      await publishUser(uid(req));
      return { ok: true };
    });
  }

  /** Profile card: public fields, relationship, and mutuals (subject to the target's privacy). */
  app.get<{ Params: { id: string }; Querystring: { guild_id?: string } }>("/api/users/:id/profile", async (req) => {
    const u = await q1<any>("select * from users where id = $1", [req.params.id]);
    if (!u) throw notFound("User");
    const me = uid(req);
    const showMutuals = me === u.id || ({ ...DEFAULT_PRIVACY, ...(u.privacy ?? {}) }).show_mutuals;
    const mutual_guilds = showMutuals ? await q<any>(
      `select g.id::text, g.name, g.icon_key, m2.nick from members m1 join members m2 on m1.guild_id = m2.guild_id join guilds g on g.id = m1.guild_id
        where m1.user_id = $1 and m2.user_id = $2`, [me, u.id]) : [];
    const mutual_friends = showMutuals ? await q<any>(
      `select ${USER_COLS} from relationships r1 join relationships r2 on r1.other_id = r2.other_id join users u on u.id = r1.other_id
        where r1.user_id = $1 and r2.user_id = $2 and r1.type = 1 and r2.type = 1 limit 50`, [me, u.id]) : [];
    let member = null;
    if (req.query.guild_id && /^\d+$/.test(req.query.guild_id)) {
      const shared = await q1("select 1 from members where guild_id = $1 and user_id = $2", [req.query.guild_id, me]);
      if (shared) member = await q1<any>("select nick, joined_at, avatar_key, banner_key, bio, pronouns, profile_theme, custom_status, (select array_agg(role_id::text) from member_roles where guild_id = $1 and user_id = $2) as roles from members where guild_id = $1 and user_id = $2", [req.query.guild_id, u.id]);
    }
    const { activityOf } = await import("../gateway.ts");
    const connections = await q<any>("select type, external_id, name, verified, metadata from user_connections where user_id = $1 and visible order by created_at", [u.id]);
    const premium = await q1<any>("select min(created_at) as since from premium_subscriptions where user_id = $1 and status = 'active' and (current_period_end is null or current_period_end > now())", [u.id]);
    return {
      user: userOut(u),
      created_at: u.created_at,
      connections: connections.map((c) => ({ type: c.type, id: c.external_id, name: c.name, verified: c.verified, url: c.metadata?.url ?? null })),
      activity: presenceOf(u.id) === "offline" ? null : activityOf(u.id),
      premium_since: premium?.since ?? null,
      staff: !!u.staff,
      custom_status: u.custom_status,
      presence: presenceOf(u.id),
      relationship: await rel(me, u.id),
      mutual_guilds: mutual_guilds.map((g) => ({ id: g.id, name: g.name, icon: mediaUrl(g.icon_key), nick: g.nick })),
      mutual_friends: mutual_friends.map(userOut),
      member: member && {
        nick: member.nick, joined_at: member.joined_at, avatar: mediaUrl(member.avatar_key), banner: mediaUrl(member.banner_key), bio: member.bio,
        pronouns: member.pronouns, profile_theme: member.profile_theme, custom_status: member.custom_status, roles: member.roles ?? [],
      },
    };
  });

  /* ------------------------------------------------------ relationships -- */
  app.get("/api/users/@me/relationships", async (req) => {
    const rows = await q<any>(`select r.type, r.created_at, ${USER_COLS} from relationships r join users u on u.id = r.other_id where r.user_id = $1`, [uid(req)]);
    return rows.map((r) => ({ id: r.id, type: r.type, since: r.created_at, user: userOut(r), presence: presenceOf(r.id) }));
  });

  app.post("/api/users/@me/relationships", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { username } = z.object({ username: z.string().trim().toLowerCase().max(32) }).parse(req.body);
    const me = uid(req);
    const target = await q1<any>("select id, privacy from users where username = $1 and deleted_at is null and bot = false", [username]);
    const generic = () => new ApiError(400, "request_failed", "Couldn't send a friend request. Check the username: it's case-insensitive.");
    if (!target || target.id === me) throw generic();
    const mine = await rel(me, target.id), theirs = await rel(target.id, me);
    if (mine === RelationshipType.BLOCKED) throw bad("You've blocked this person. Unblock them first.", "blocked");
    if (theirs === RelationshipType.BLOCKED) throw generic(); // never reveal a block
    if (mine === RelationshipType.FRIEND) throw conflict("You're already friends.");
    if (mine === RelationshipType.OUTGOING) throw conflict("You've already sent a request.");
    if (mine === RelationshipType.INCOMING) return accept(me, target.id);
    const privacy = { ...DEFAULT_PRIVACY, ...(target.privacy ?? {}) };
    const allowed = privacy.friend_requests === "everyone"
      || (privacy.friend_requests === "friends_of_friends" && (await hasMutualFriend(me, target.id)))
      || (privacy.friend_requests === "server_members" && ((await sharesGuild(me, target.id)) || (await hasMutualFriend(me, target.id))));
    if (!allowed) throw new ApiError(403, "privacy", "This person isn't accepting friend requests from you right now.");
    await tx(async (c) => {
      await c.query("insert into relationships(user_id, other_id, type) values ($1,$2,4) on conflict (user_id, other_id) do update set type = 4, created_at = now()", [me, target.id]);
      await c.query("insert into relationships(user_id, other_id, type) values ($2,$1,3) on conflict (user_id, other_id) do update set type = 3, created_at = now()", [me, target.id]);
    });
    await emitRel(me, target.id); await emitRel(target.id, me);
    return relOut(me, target.id);
  });

  async function accept(me: string, other: string) {
    await tx(async (c) => {
      await c.query("update relationships set type = 1, created_at = now() where user_id = $1 and other_id = $2", [me, other]);
      await c.query("update relationships set type = 1, created_at = now() where user_id = $2 and other_id = $1", [me, other]);
    });
    await emitRel(me, other); await emitRel(other, me);
    // Friends now see each other's presence.
    if (isOnline(me)) toUser(other, "PRESENCE_UPDATE", { user_id: me, status: presenceOf(me) });
    if (isOnline(other)) toUser(me, "PRESENCE_UPDATE", { user_id: other, status: presenceOf(other) });
    return relOut(me, other);
  }

  app.put<{ Params: { id: string } }>("/api/users/@me/relationships/:id", async (req) => {
    const { type } = z.object({ type: z.union([z.literal(1), z.literal(2)]) }).parse(req.body ?? { type: 1 });
    const me = uid(req), other = req.params.id;
    if (!/^\d+$/.test(other) || other === me) throw bad("Invalid user.");
    if (!(await q1("select 1 from users where id = $1", [other]))) throw notFound("User");
    if (type === 1) {
      if ((await rel(me, other)) !== RelationshipType.INCOMING) throw bad("There's no request to accept.");
      return accept(me, other);
    }
    // Block: end friendship and requests in both directions; keep their block of me if any.
    await tx(async (c) => {
      await c.query("delete from relationships where user_id = $2 and other_id = $1 and type <> 2", [me, other]);
      await c.query("insert into relationships(user_id, other_id, type) values ($1,$2,2) on conflict (user_id, other_id) do update set type = 2, created_at = now()", [me, other]);
    });
    await emitRel(me, other); await emitRel(other, me);
    // Leave any active 1:1 call between the two.
    const dm = await q1<any>("select channel_id::text from dm_pairs where low_id = least($1::bigint,$2::bigint) and high_id = greatest($1::bigint,$2::bigint)", [me, other]);
    if (dm) {
      const { voiceStateOf, dropVoice } = await import("../gateway.ts");
      for (const u of [me, other]) if (voiceStateOf(u)?.channel_id === dm.channel_id) await dropVoice(u);
    }
    return relOut(me, other);
  });

  app.delete<{ Params: { id: string } }>("/api/users/@me/relationships/:id", async (req) => {
    const me = uid(req), other = req.params.id;
    const mine = await rel(me, other);
    if (!mine) throw notFound("Relationship");
    await tx(async (c) => {
      await c.query("delete from relationships where user_id = $1 and other_id = $2", [me, other]);
      if (mine !== RelationshipType.BLOCKED) await c.query("delete from relationships where user_id = $2 and other_id = $1 and type <> 2", [me, other]);
    });
    await emitRel(me, other); await emitRel(other, me);
    return { ok: true };
  });

  /* ------------------------------------------------- export & deletion -- */
  app.get("/api/users/@me/export", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req, reply) => {
    const me = uid(req);
    const user = await q1<any>("select id, username, email, display_name, bio, pronouns, accent_color, profile_theme, custom_status, privacy, settings, created_at from users where id = $1", [me]);
    const data = {
      exported_at: new Date().toISOString(),
      user,
      sessions: await q("select id::text, created_at, last_used_at, ip, user_agent, revoked_at from sessions where user_id = $1", [me]),
      relationships: await q("select r.other_id::text, u.username, r.type, r.created_at from relationships r join users u on u.id = r.other_id where r.user_id = $1", [me]),
      memberships: await q("select g.id::text, g.name, m.nick, m.joined_at from members m join guilds g on g.id = m.guild_id where m.user_id = $1", [me]),
      messages: await q("select id::text, channel_id::text, guild_id::text, content, created_at, edited_at from messages where author_id = $1 and deleted_at is null order by id limit 200000", [me]),
      attachments: await q("select id::text, filename, content_type, size, created_at from attachments where uploader_id = $1", [me]),
      reactions: await q("select message_id::text, emoji, burst, created_at from reactions where user_id = $1", [me]),
    };
    reply.header("content-disposition", `attachment; filename="send-export-${me}.json"`);
    return data;
  });

  app.delete("/api/users/@me", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { password } = z.object({ password: z.string().max(256) }).parse(req.body);
    const me = uid(req);
    const u = await q1<any>("select password_hash from users where id = $1", [me]);
    if (!(await verifyPassword(password, u.password_hash))) throw new ApiError(401, "bad_credentials", "That password isn't right.");
    const owned = await q("select id from guilds where owner_id = $1", [me]);
    if (owned.length) throw forbidden(`You own ${owned.length} server(s). Transfer or delete them first.`);
    const keys = await q1<any>("select avatar_key, banner_key from users where id = $1", [me]);
    await tx(async (c) => {
      await c.query("delete from relationships where user_id = $1 or other_id = $1", [me]);
      await c.query("delete from members where user_id = $1", [me]);
      await c.query("delete from read_states where user_id = $1", [me]);
      await c.query("delete from saved_messages where user_id = $1", [me]);
      await c.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [me]);
      // Messages remain for conversation integrity but are no longer linked to a person.
      await c.query(
        `update users set username = 'deleted_' || substr(md5(id::text), 1, 12), email = null, password_hash = null, display_name = 'Deleted user',
           avatar_key = null, banner_key = null, bio = '', pronouns = '', accent_color = null, profile_theme = null, custom_status = null,
           settings = '{}', mfa_secret = null, mfa_enabled = false, deleted_at = now() where id = $1`, [me]);
    });
    for (const k of [keys.avatar_key, keys.banner_key]) if (k) await storage.remove(k).catch(() => {});
    await revokeSessions(me, null);
    await closeUser(me, "Account deleted");
    await broadcastPresence(me);
    clearSessionCookies(reply);
    return { ok: true };
  });
}
