import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { MENTION_ROLE, MENTION_USER, P, has, type Application, type ApplicationCommand, type Webhook } from "@send/shared";
import { q, q1, tx } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { randomToken, sha256 } from "../crypto.ts";
import { ApiError, bad, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { isOnline, toChannel, toUser } from "../gateway.ts";
import { getChannel, permsFor, requireChannel, requireGuild } from "../perms.ts";
import { USER_COLS, mediaUrl, prefixedCols, prefixedUser, userOut } from "../serialize.ts";
import { saveImage } from "../uploads.ts";
import { proxied, safePost } from "../unfurl.ts";
import { messageById } from "./messages.ts";

/**
 * Apps & bots, slash commands, interactions, webhooks and the App Directory.
 *
 * - An application owns a bot user. Its token is a long-lived session for that user, so a bot
 *   uses the same REST API and gateway as everyone else (Authorization: Bearer <token>,
 *   or the gateway "identify" frame). Bots only see what their role allows.
 * - Slash commands are registered per app (global) or per server. Using one creates an
 *   interaction: POSTed to the app's interactions URL (HMAC-signed) or sent to the bot over
 *   the gateway (INTERACTION_CREATE). The app answers through the callback endpoint.
 * - Webhooks post into one channel with a secret URL; channel-follow webhooks are created by
 *   announcement following (stage.ts).
 */

const ID = z.string().regex(/^\d{1,20}$/);
const NAME = z.string().trim().min(2).max(32);

async function appOut(r: any): Promise<Application> {
  const bot = r.bot_user_id ? await q1<any>(`select ${USER_COLS} from users u where id = $1`, [r.bot_user_id]) : null;
  return { id: String(r.id), name: r.name, description: r.description, icon: mediaUrl(r.icon_key), bot: bot ? userOut(bot) : null, owner_id: String(r.owner_id), public: r.public, listed: r.listed, interactions_url: r.interactions_url ?? null, tags: r.tags ?? [], install_count: r.install_count ?? 0, activity_url: r.activity_url ?? null };
}
const cmdOut = (r: any, app?: any): ApplicationCommand => ({
  id: String(r.id), application_id: String(r.application_id), guild_id: r.guild_id ? String(r.guild_id) : null, type: r.type, name: r.name, description: r.description,
  options: r.options ?? [], default_member_permissions: r.default_member_permissions != null ? String(r.default_member_permissions) : null, dm_permission: r.dm_permission,
  ...(app ? { app: { id: String(app.id), name: app.name, icon: mediaUrl(app.icon_key) } } : {}),
});

/** The app a request acts for: its owner (cookie session) or its bot (token). */
async function ownedApp(req: FastifyRequest, appId: string) {
  const a = await q1<any>("select * from applications where id = $1", [appId]);
  if (!a) throw notFound("Application");
  const me = uid(req);
  if (String(a.owner_id) !== me && String(a.bot_user_id) !== me) throw notFound("Application");
  return a;
}

const OPTION: z.ZodType<any> = z.lazy(() => z.object({
  type: z.number().int().min(1).max(11),
  name: z.string().regex(/^[-_\p{Ll}\p{N}]{1,32}$/u, "Option names are lowercase, 1 to 32 characters."),
  description: z.string().min(1).max(100),
  required: z.boolean().optional(),
  choices: z.array(z.object({ name: z.string().min(1).max(100), value: z.union([z.string().max(100), z.number()]) })).max(25).optional(),
  options: z.array(OPTION).max(25).optional(),
  min_value: z.number().optional(), max_value: z.number().optional(), autocomplete: z.boolean().optional(),
}));
const COMMAND = z.object({
  type: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  name: z.string().min(1).max(32),
  description: z.string().max(100).default(""),
  options: z.array(OPTION).max(25).default([]),
  default_member_permissions: z.string().regex(/^\d{1,20}$/).nullable().optional(),
  dm_permission: z.boolean().default(true),
}).superRefine((c, ctx) => {
  if (c.type === 1 && !/^[-_\p{Ll}\p{N}]{1,32}$/u.test(c.name)) ctx.addIssue({ code: "custom", message: "Slash command names are lowercase letters, numbers, - and _." });
  if (c.type === 1 && !c.description) ctx.addIssue({ code: "custom", message: "Slash commands need a description." });
});

/* ------------------------------------------------------------- interactions -- */
interface Reply { type: number; data?: { content?: string; embeds?: any[]; components?: any[]; flags?: number; allowed_mentions?: any; choices?: any[] } }

/** Post (or update) the message an app answered with. */
async function applyReply(ix: any, reply: Reply) {
  const app = await q1<any>("select * from applications where id = $1", [ix.application_id]);
  if (!app) return null;
  const ch = await getChannel(String(ix.channel_id));
  if (!ch) return null;
  const data = reply.data ?? {};
  const content = String(data.content ?? "").slice(0, 4000);
  const embeds = Array.isArray(data.embeds) ? data.embeds.slice(0, 10) : [];
  const components = Array.isArray(data.components) ? data.components.slice(0, 5) : [];
  const ephemeral = ((data.flags ?? 0) & 64) !== 0;
  if (reply.type === 1) return null; // pong
  if (reply.type === 8) { toUser(String(ix.user_id), "INTERACTION_AUTOCOMPLETE", { id: String(ix.id), choices: (data.choices ?? []).slice(0, 25) }); return null; }
  if (reply.type === 7 && ix.data?.message_id) {
    // Update the message the component was on.
    await q("update messages set content = $2, embeds = $3, components = $4, edited_at = now() where id = $1 and application_id = $5", [ix.data.message_id, content, JSON.stringify(embeds), JSON.stringify(components), ix.application_id]);
    const msg = await messageById(String(ix.data.message_id), null);
    if (msg) { const { reactions: _r, ...rest } = msg; await toChannel(ch, "MESSAGE_UPDATE", rest); }
    return msg;
  }
  if (reply.type === 6) { toUser(String(ix.user_id), "INTERACTION_SUCCESS", { id: String(ix.id) }); return null; }
  const interaction = { name: ix.data?.name ?? "", user_id: String(ix.user_id) };
  if (ephemeral) {
    // Only the person who used the command sees it; it isn't stored.
    const fake = { id: newId(), channel_id: String(ch.id), guild_id: ch.guild_id, author: userOut(await q1<any>(`select ${USER_COLS} from users u where id = $1`, [app.bot_user_id])), content, type: 20, created_at: new Date().toISOString(), edited_at: null, pinned: false, reply_to: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], flags: 64, embeds, components, application_id: String(app.id), interaction: { name: interaction.name, user: null }, ephemeral: true };
    toUser(String(ix.user_id), "MESSAGE_CREATE", fake);
    return fake;
  }
  const deferred = reply.type === 5;
  const id = newId();
  const users = [...content.matchAll(MENTION_USER)].map((m) => m[1]!).slice(0, 50);
  const roles = [...content.matchAll(MENTION_ROLE)].map((m) => m[1]!).slice(0, 20);
  await tx(async (c) => {
    await c.query(`insert into messages(id, channel_id, guild_id, author_id, content, type, mentions, mention_roles, embeds, components, application_id, interaction)
      values ($1,$2,$3,$4,$5,20,$6,$7,$8,$9,$10,$11)`, [id, ch.id, ch.guild_id, app.bot_user_id, deferred ? "" : content, users, roles, JSON.stringify(deferred ? [] : embeds), JSON.stringify(deferred ? [] : components), app.id, JSON.stringify({ ...interaction, deferred })]);
    await c.query("update channels set last_message_id = $2 where id = $1", [ch.id, id]);
    await c.query("update interactions set responded = true, message_id = $2 where id = $1", [ix.id, id]);
  });
  const msg = await messageById(id, null);
  if (msg) await toChannel(ch, "MESSAGE_CREATE", msg);
  return msg;
}

async function deliverInteraction(app: any, ix: any, payload: any) {
  if (app.interactions_url) {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", app.interaction_secret).update(ts + body).digest("hex");
    try {
      const r = await safePost(app.interactions_url, body, { "x-send-signature": sig, "x-send-timestamp": ts }, 3000);
      if (r.status >= 200 && r.status < 300 && r.body) { await applyReply(ix, JSON.parse(r.body)); return true; }
    } catch (e) { console.error("[interaction url]", (e as Error).message); }
    return false;
  }
  if (!isOnline(String(app.bot_user_id))) return false;
  toUser(String(app.bot_user_id), "INTERACTION_CREATE", payload);
  return true;
}

export async function appRoutes(app: FastifyInstance) {
  /* ----------------------------------------------------- webhook execute (no login) -- */
  await app.register(async (pub) => {
    pub.post<{ Params: { wid: string; token: string }; Querystring: { wait?: string; thread_id?: string } }>("/api/webhooks/:wid/:token", { config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: (r: any) => `wh:${r.params.wid}` } } }, async (req) => {
      const w = await q1<any>("select * from webhooks where id = $1 and token_hash = $2 and type = 1", [req.params.wid, sha256(req.params.token)]);
      if (!w) throw notFound("Webhook");
      const b = z.object({
        content: z.string().max(4000).default(""),
        username: z.string().trim().min(1).max(80).optional(),
        avatar_url: z.string().url().max(500).optional(),
        embeds: z.array(z.object({
          title: z.string().max(256).optional(), description: z.string().max(4096).optional(), url: z.string().url().max(500).optional(), color: z.number().int().min(0).max(0xffffff).optional(),
          author: z.object({ name: z.string().max(256), url: z.string().url().optional(), icon_url: z.string().url().optional() }).optional(),
          thumbnail: z.object({ url: z.string().url() }).optional(), image: z.object({ url: z.string().url() }).optional(),
          fields: z.array(z.object({ name: z.string().max(256), value: z.string().max(1024), inline: z.boolean().optional() })).max(25).optional(),
          footer: z.object({ text: z.string().max(2048), icon_url: z.string().url().optional() }).optional(), timestamp: z.string().datetime({ offset: true }).optional(),
        })).max(10).default([]),
        allowed_mentions: z.object({ parse: z.array(z.enum(["users", "roles", "everyone"])).default([]) }).optional(),
      }).parse(req.body);
      if (!b.content.trim() && !b.embeds.length) throw bad("Webhook messages need content or an embed.");
      let channelId = String(w.channel_id);
      if (req.query.thread_id) {
        const t = await q1<any>("select id::text from channels where id = $1 and parent_id = $2 and type in (11,12)", [req.query.thread_id, w.channel_id]);
        if (!t) throw bad("Unknown thread.");
        channelId = t.id;
      }
      const ch = (await getChannel(channelId))!;
      const parse = new Set(b.allowed_mentions?.parse ?? ["users", "roles"]);
      const users = parse.has("users") ? [...b.content.matchAll(MENTION_USER)].map((m) => m[1]!).slice(0, 50) : [];
      const roles = parse.has("roles") ? [...b.content.matchAll(MENTION_ROLE)].map((m) => m[1]!).slice(0, 20) : [];
      const everyone = parse.has("everyone") && /(^|[^`\w])@(everyone|here)\b/.test(b.content);
      const embeds = b.embeds.map((e) => ({ type: "rich", title: e.title ?? null, description: e.description ?? null, url: e.url ?? null, color: e.color != null ? `#${e.color.toString(16).padStart(6, "0")}` : null,
        author: e.author ?? null, thumbnail: e.thumbnail ?? null, image: e.image ?? null, fields: e.fields ?? [], footer: e.footer ?? null, timestamp: e.timestamp ?? null }));
      const id = newId();
      await tx(async (c) => {
        await c.query(`insert into messages(id, channel_id, guild_id, author_id, content, type, webhook_id, webhook_name, webhook_avatar, embeds, mentions, mention_roles, mention_everyone)
          values ($1,$2,$3,null,$4,0,$5,$6,$7,$8,$9,$10,$11)`, [id, ch.id, ch.guild_id, b.content, w.id, b.username ?? w.name, b.avatar_url ? proxied(b.avatar_url) : mediaUrl(w.avatar_key), JSON.stringify(embeds), users, roles, everyone]);
        await c.query("update channels set last_message_id = $2 where id = $1", [ch.id, id]);
      });
      const msg = await messageById(id, null);
      await toChannel(ch, "MESSAGE_CREATE", msg);
      return req.query.wait === "true" ? msg : { ok: true };
    });
  });

  await app.register(async (r) => {
    r.addHook("preHandler", requireUser);

    /* ----------------------------------------------------------- applications -- */
    r.get("/api/applications", async (req) => Promise.all((await q<any>("select * from applications where owner_id = $1 order by created_at", [uid(req)])).map(appOut)));

    r.post("/api/applications", async (req) => {
      const me = uid(req);
      const b = z.object({ name: NAME, description: z.string().max(400).default("") }).parse(req.body);
      const n = await q1<any>("select count(*)::int as n from applications where owner_id = $1", [me]);
      if (n.n >= 25) throw bad("You can have up to 25 apps.");
      const appId = newId(), botId = newId();
      const base = b.name.toLowerCase().replace(/[^a-z0-9_.]+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 24) || "bot";
      await tx(async (c) => {
        await c.query("insert into users(id, username, display_name, bot) values ($1,$2,$3,true)", [botId, `${base}_${botId.slice(-6)}`, b.name]);
        await c.query("insert into applications(id, owner_id, bot_user_id, name, description, interaction_secret) values ($1,$2,$3,$4,$5,$6)", [appId, me, botId, b.name, b.description, randomToken(32)]);
      });
      return appOut(await q1<any>("select * from applications where id = $1", [appId]));
    });

    r.get<{ Params: { id: string } }>("/api/applications/:id", async (req) => appOut(await ownedApp(req, req.params.id)));

    r.patch<{ Params: { id: string } }>("/api/applications/:id", async (req) => {
      const a = await ownedApp(req, req.params.id);
      if (String(a.owner_id) !== uid(req)) throw forbidden();
      const b = z.object({
        name: NAME.optional(), description: z.string().max(400).optional(), public: z.boolean().optional(), listed: z.boolean().optional(),
        interactions_url: z.string().url().max(500).nullable().optional().refine((v) => !v || v.startsWith("https://"), "Use an https:// address."),
        tags: z.array(z.string().trim().toLowerCase().min(2).max(20)).max(5).optional(),
        activity_url: z.string().url().max(500).nullable().optional().refine((v) => !v || v.startsWith("https://"), "Use an https:// address."),
      }).parse(req.body);
      if (b.interactions_url) {
        // Verify the endpoint answers a signed PING with a PONG.
        const body = JSON.stringify({ type: 1, id: newId(), application_id: String(a.id) });
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = createHmac("sha256", a.interaction_secret).update(ts + body).digest("hex");
        const ok = await safePost(b.interactions_url, body, { "x-send-signature": sig, "x-send-timestamp": ts }).then((r) => r.status === 200 && JSON.parse(r.body)?.type === 1).catch(() => false);
        if (!ok) throw bad("That URL didn't answer the test PING with {\"type\":1}.");
      }
      const entries = Object.entries(b).filter(([, v]) => v !== undefined);
      if (entries.length) await q(`update applications set ${entries.map(([k], i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [a.id, ...entries.map(([, v]) => v)]);
      if (b.name) await q("update users set display_name = $2 where id = $1", [a.bot_user_id, b.name]);
      return appOut(await q1<any>("select * from applications where id = $1", [a.id]));
    });

    r.post<{ Params: { id: string } }>("/api/applications/:id/icon", async (req) => {
      const a = await ownedApp(req, req.params.id);
      const key = await saveImage(req, `avatars/${a.bot_user_id}`, 4 * 1024 * 1024);
      await q("update applications set icon_key = $2 where id = $1", [a.id, key]);
      await q("update users set avatar_key = $2 where id = $1", [a.bot_user_id, key]);
      return appOut(await q1<any>("select * from applications where id = $1", [a.id]));
    });

    r.delete<{ Params: { id: string } }>("/api/applications/:id", async (req) => {
      const a = await ownedApp(req, req.params.id);
      if (String(a.owner_id) !== uid(req)) throw forbidden();
      const { closeUser } = await import("../gateway.ts");
      await closeUser(String(a.bot_user_id), "App deleted").catch(() => {});
      await q("delete from users where id = $1", [a.bot_user_id]);
      await q("delete from applications where id = $1", [a.id]);
      return { ok: true };
    });

    /** New bot token (shown once). Old tokens stop working. */
    r.post<{ Params: { id: string } }>("/api/applications/:id/bot/reset-token", async (req) => {
      const a = await ownedApp(req, req.params.id);
      if (String(a.owner_id) !== uid(req)) throw forbidden();
      const token = `${Buffer.from(String(a.bot_user_id)).toString("base64url")}.${randomToken(32)}`;
      await tx(async (c) => {
        await c.query("update sessions set revoked_at = now() where user_id = $1 and revoked_at is null", [a.bot_user_id]);
        await c.query("insert into sessions(id, user_id, token_hash, expires_at, user_agent) values ($1,$2,$3, now() + interval '100 years', 'bot')", [newId(), a.bot_user_id, sha256(token)]);
      });
      const { closeUser } = await import("../gateway.ts");
      await closeUser(String(a.bot_user_id), "Token reset").catch(() => {});
      return { token };
    });
    r.post<{ Params: { id: string } }>("/api/applications/:id/reset-secret", async (req) => {
      const a = await ownedApp(req, req.params.id);
      if (String(a.owner_id) !== uid(req)) throw forbidden();
      const secret = randomToken(32);
      await q("update applications set interaction_secret = $2 where id = $1", [a.id, secret]);
      return { interaction_secret: secret };
    });

    /** Add an app's bot to a server, with a role holding the permissions it asked for. */
    r.post<{ Params: { id: string } }>("/api/applications/:id/install", async (req) => {
      const me = uid(req);
      const a = await q1<any>("select * from applications where id = $1", [req.params.id]);
      if (!a || (!a.public && String(a.owner_id) !== me)) throw notFound("Application");
      const b = z.object({ guild_id: ID, permissions: z.string().regex(/^\d{1,20}$/).default("0") }).parse(req.body);
      const ctx = await requireGuild(me, b.guild_id, P.MANAGE_GUILD);
      const wanted = BigInt(b.permissions);
      if (!has(ctx.perms, P.ADMINISTRATOR) && (wanted & ~ctx.perms) !== 0n) throw forbidden("You can't give an app permissions you don't have.");
      if (await q1("select 1 from members where guild_id = $1 and user_id = $2", [b.guild_id, a.bot_user_id])) throw bad("That app is already in this server.");
      const roleId = newId();
      await tx(async (c) => {
        await c.query("insert into members(guild_id, user_id) values ($1,$2)", [b.guild_id, a.bot_user_id]);
        const pos = (await c.query("select coalesce(max(position), 0) + 1 as p from roles where guild_id = $1", [b.guild_id])).rows[0].p;
        await c.query("insert into roles(id, guild_id, name, permissions, position, hoist) values ($1,$2,$3,$4,$5,false)", [roleId, b.guild_id, a.name.slice(0, 100), String(wanted), pos]);
        await c.query("insert into member_roles(guild_id, user_id, role_id) values ($1,$2,$3)", [b.guild_id, a.bot_user_id, roleId]);
        await c.query("update applications set install_count = install_count + 1 where id = $1", [a.id]);
      });
      const { audit, memberOut, resyncGuild } = await import("./guilds.ts");
      await audit(b.guild_id, me, "bot_add", String(a.bot_user_id), { app: a.name, permissions: b.permissions });
      const { toGuild } = await import("../gateway.ts");
      await toGuild(b.guild_id, "GUILD_MEMBER_ADD", await memberOut(b.guild_id, String(a.bot_user_id)));
      await resyncGuild(b.guild_id);
      const bot = await q1<any>(`select ${USER_COLS} from users u where id = $1`, [a.bot_user_id]);
      toUser(String(a.bot_user_id), "GUILD_CREATE", await (await import("../ready.ts")).guildFor(String(a.bot_user_id), b.guild_id));
      return { ok: true, bot: userOut(bot) };
    });

    /* --------------------------------------------------------------- directory -- */
    r.get<{ Querystring: { q?: string; tag?: string } }>("/api/directory", async (req) => {
      const text = (req.query.q ?? "").trim().slice(0, 60);
      const tag = (req.query.tag ?? "").trim().toLowerCase().slice(0, 20);
      const rows = await q<any>(`select * from applications where listed and public and ($1 = '' or name ilike '%' || $1 || '%' or description ilike '%' || $1 || '%')
        and ($2 = '' or $2 = any(tags)) order by install_count desc, created_at limit 50`, [text, tag]);
      return Promise.all(rows.map(appOut));
    });
    r.get<{ Params: { id: string } }>("/api/directory/:id", async (req) => {
      const a = await q1<any>("select * from applications where id = $1 and public", [req.params.id]);
      if (!a) throw notFound("Application");
      const cmds = await q<any>("select * from application_commands where application_id = $1 and guild_id is null order by name", [a.id]);
      return { ...(await appOut(a)), commands: cmds.map((c) => cmdOut(c)) };
    });

    /* ---------------------------------------------------------------- commands -- */
    for (const scoped of [false, true]) {
      const path = scoped ? "/api/applications/:id/guilds/:gid/commands" : "/api/applications/:id/commands";
      r.get<{ Params: { id: string; gid?: string } }>(path, async (req) => {
        const a = await ownedApp(req, req.params.id);
        return (await q<any>("select * from application_commands where application_id = $1 and guild_id is not distinct from $2 order by name", [a.id, req.params.gid ?? null])).map((c) => cmdOut(c));
      });
      /** Replace the whole set (what bots do at start-up). */
      r.put<{ Params: { id: string; gid?: string } }>(path, async (req) => {
        const a = await ownedApp(req, req.params.id);
        if (req.params.gid && !(await q1("select 1 from members where guild_id = $1 and user_id = $2", [req.params.gid, a.bot_user_id]))) throw bad("The app isn't in that server.");
        const list = z.array(COMMAND).max(100).parse(req.body);
        const names = new Set<string>();
        for (const c of list) { const k = `${c.type}:${c.name}`; if (names.has(k)) throw bad(`Duplicate command: ${c.name}`); names.add(k); }
        await tx(async (c) => {
          await c.query("delete from application_commands where application_id = $1 and guild_id is not distinct from $2", [a.id, req.params.gid ?? null]);
          for (const cmd of list) await c.query(`insert into application_commands(id, application_id, guild_id, type, name, description, options, default_member_permissions, dm_permission)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [newId(), a.id, req.params.gid ?? null, cmd.type, cmd.name, cmd.description, JSON.stringify(cmd.options), cmd.default_member_permissions ?? null, cmd.dm_permission]);
        });
        return (await q<any>("select * from application_commands where application_id = $1 and guild_id is not distinct from $2 order by name", [a.id, req.params.gid ?? null])).map((c) => cmdOut(c));
      });
    }

    /** Commands I can use in a server: from apps installed there, filtered by their default permissions. */
    r.get<{ Params: { id: string } }>("/api/guilds/:id/commands", async (req) => {
      const ctx = await requireGuild(uid(req), req.params.id);
      const rows = await q<any>(`select c.*, a.id as a_id, a.name as a_name, a.icon_key as a_icon_key from application_commands c join applications a on a.id = c.application_id
        where exists (select 1 from members m where m.guild_id = $1 and m.user_id = a.bot_user_id) and (c.guild_id is null or c.guild_id = $1)
        order by a.name, c.name limit 500`, [req.params.id]);
      return rows.filter((c) => c.default_member_permissions == null || has(ctx.perms, BigInt(c.default_member_permissions)))
        .map((c) => cmdOut(c, { id: c.a_id, name: c.a_name, icon_key: c.a_icon_key }));
    });

    /** Use a slash command / context-menu command, or press a button / pick from a menu. */
    r.post("/api/interactions", { config: { rateLimit: { max: 20, timeWindow: "10 seconds" } } }, async (req) => {
      const me = uid(req);
      const b = z.object({
        type: z.union([z.literal(2), z.literal(3), z.literal(4)]),
        application_id: ID,
        channel_id: ID,
        data: z.object({
          id: ID.optional(), name: z.string().max(32).optional(), type: z.number().int().optional(), options: z.array(z.any()).max(25).optional(), target_id: ID.optional(),
          custom_id: z.string().max(100).optional(), values: z.array(z.string().max(100)).max(25).optional(), message_id: ID.optional(),
        }),
      }).parse(req.body);
      const { channel, perms } = await requireChannel(me, b.channel_id);
      if (!has(perms, P.USE_APPLICATION_COMMANDS) && b.type === 2) throw forbidden("You can't use apps in this channel.");
      const a = await q1<any>("select * from applications where id = $1", [b.application_id]);
      if (!a) throw notFound("Application");
      if (channel.guild_id && !(await q1("select 1 from members where guild_id = $1 and user_id = $2", [channel.guild_id, a.bot_user_id]))) throw bad("That app isn't in this server.");
      if (b.type === 2 || b.type === 4) {
        const cmd = await q1<any>("select * from application_commands where application_id = $1 and name = $2 and (guild_id is null or guild_id = $3) order by guild_id nulls last limit 1", [a.id, b.data.name ?? "", channel.guild_id]);
        if (!cmd) throw notFound("Command");
        if (cmd.default_member_permissions != null && !has(perms, BigInt(cmd.default_member_permissions))) throw forbidden("You can't use that command.");
        b.data.id = String(cmd.id);
      } else if (b.data.message_id) {
        const m = await q1("select 1 from messages where id = $1 and channel_id = $2 and application_id = $3", [b.data.message_id, channel.id, a.id]);
        if (!m) throw notFound("Message");
      }
      const token = randomToken(24);
      const id = newId();
      await q("insert into interactions(id, application_id, type, guild_id, channel_id, user_id, data, token_hash) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, a.id, b.type, channel.guild_id, channel.id, me, JSON.stringify(b.data), sha256(token)]);
      const user = userOut(await q1<any>(`select ${USER_COLS} from users u where id = $1`, [me]));
      const payload = { id, token, type: b.type, application_id: String(a.id), guild_id: channel.guild_id, channel_id: channel.id, user, member_permissions: perms.toString(), data: b.data };
      const delivered = await deliverInteraction(a, { id, application_id: a.id, channel_id: channel.id, user_id: me, data: b.data }, payload);
      if (!delivered) throw new ApiError(502, "app_unavailable", `${a.name} didn't respond. It may be offline.`);
      return { id };
    });

    /** Bots answer an interaction (within 15 minutes). */
    r.post<{ Params: { iid: string; token: string } }>("/api/interactions/:iid/:token/callback", async (req) => {
      const ix = await q1<any>("select * from interactions where id = $1 and token_hash = $2 and created_at > now() - interval '15 minutes'", [req.params.iid, sha256(req.params.token)]);
      if (!ix) throw notFound("Interaction");
      const a = await q1<any>("select bot_user_id::text from applications where id = $1", [ix.application_id]);
      if (a?.bot_user_id !== uid(req)) throw forbidden();
      const reply = z.object({ type: z.number().int().min(1).max(9), data: z.any().optional() }).parse(req.body) as Reply;
      const msg = await applyReply(ix, reply);
      return msg ?? { ok: true };
    });
    /** Edit the reply (e.g. after a deferred "thinking…"). */
    r.patch<{ Params: { iid: string; token: string } }>("/api/interactions/:iid/:token/original", async (req) => {
      const ix = await q1<any>("select * from interactions where id = $1 and token_hash = $2 and created_at > now() - interval '15 minutes'", [req.params.iid, sha256(req.params.token)]);
      if (!ix?.message_id) throw notFound("Interaction");
      const a = await q1<any>("select bot_user_id::text from applications where id = $1", [ix.application_id]);
      if (a?.bot_user_id !== uid(req)) throw forbidden();
      const b = z.object({ content: z.string().max(4000).optional(), embeds: z.array(z.any()).max(10).optional(), components: z.array(z.any()).max(5).optional() }).parse(req.body);
      await q("update messages set content = coalesce($2, content), embeds = coalesce($3, embeds), components = coalesce($4, components), interaction = interaction - 'deferred', edited_at = case when (interaction ? 'deferred') then null else now() end where id = $1",
        [ix.message_id, b.content ?? null, b.embeds ? JSON.stringify(b.embeds) : null, b.components ? JSON.stringify(b.components) : null]);
      const ch = await getChannel(String(ix.channel_id));
      const msg = await messageById(String(ix.message_id), null);
      if (ch && msg) { const { reactions: _r, ...rest } = msg; await toChannel(ch, "MESSAGE_UPDATE", rest); }
      return msg;
    });

    /* ---------------------------------------------------------------- webhooks -- */
    const hookOut = async (w: any, token?: string): Promise<Webhook> => {
      const src = w.source_channel_id ? await q1<any>("select c.id::text, c.name, g.name as guild_name from channels c join guilds g on g.id = c.guild_id where c.id = $1", [w.source_channel_id]) : null;
      return { id: String(w.id), guild_id: w.guild_id ? String(w.guild_id) : null, channel_id: String(w.channel_id), name: w.name, avatar: mediaUrl(w.avatar_key), type: w.type, creator: prefixedUser(w, "a_"), created_at: w.created_at,
        ...(token ? { url: `/api/webhooks/${w.id}/${token}` } : {}), source_channel: src ? { id: src.id, name: src.name, guild_name: src.guild_name } : null };
    };
    const HOOKS = `select w.*, ${prefixedCols("u", "a_")} from webhooks w left join users u on u.id = w.creator_id`;

    r.get<{ Params: { cid: string } }>("/api/channels/:cid/webhooks", async (req) => {
      const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_WEBHOOKS);
      return Promise.all((await q<any>(`${HOOKS} where w.channel_id = $1 order by w.created_at`, [channel.id])).map((w) => hookOut(w)));
    });
    r.get<{ Params: { id: string } }>("/api/guilds/:id/webhooks", async (req) => {
      await requireGuild(uid(req), req.params.id, P.MANAGE_WEBHOOKS);
      return Promise.all((await q<any>(`${HOOKS} where w.guild_id = $1 order by w.created_at`, [req.params.id])).map((w) => hookOut(w)));
    });
    r.post<{ Params: { cid: string } }>("/api/channels/:cid/webhooks", async (req) => {
      const { channel } = await requireChannel(uid(req), req.params.cid, P.MANAGE_WEBHOOKS);
      if (!channel.guild_id) throw bad("Webhooks are for server channels.");
      const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
      const n = await q1<any>("select count(*)::int as n from webhooks where channel_id = $1", [channel.id]);
      if (n.n >= 15) throw bad("A channel can have up to 15 webhooks.");
      const id = newId(), token = randomToken(32);
      await q("insert into webhooks(id, guild_id, channel_id, creator_id, type, name, token_hash) values ($1,$2,$3,$4,1,$5,$6)", [id, channel.guild_id, channel.id, uid(req), name, sha256(token)]);
      const { audit } = await import("./guilds.ts");
      await audit(channel.guild_id, uid(req), "webhook_create", id, { name, channel_id: channel.id });
      return hookOut(await q1<any>(`${HOOKS} where w.id = $1`, [id]), token);
    });
    const hookForEdit = async (req: FastifyRequest, wid: string) => {
      const w = await q1<any>(`${HOOKS} where w.id = $1`, [wid]);
      if (!w) throw notFound("Webhook");
      await requireChannel(uid(req), String(w.channel_id), P.MANAGE_WEBHOOKS);
      return w;
    };
    r.patch<{ Params: { wid: string } }>("/api/webhooks/:wid", async (req) => {
      const w = await hookForEdit(req, req.params.wid);
      const b = z.object({ name: z.string().trim().min(1).max(80).optional(), channel_id: ID.optional() }).parse(req.body);
      if (b.channel_id) { const { channel } = await requireChannel(uid(req), b.channel_id, P.MANAGE_WEBHOOKS); if (channel.guild_id !== String(w.guild_id)) throw bad("Pick a channel in this server."); }
      await q("update webhooks set name = coalesce($2, name), channel_id = coalesce($3, channel_id) where id = $1", [w.id, b.name ?? null, b.channel_id ?? null]);
      return hookOut(await q1<any>(`${HOOKS} where w.id = $1`, [w.id]));
    });
    r.post<{ Params: { wid: string } }>("/api/webhooks/:wid/avatar", async (req) => {
      const w = await hookForEdit(req, req.params.wid);
      const key = await saveImage(req, `avatars/${w.id}`, 4 * 1024 * 1024);
      await q("update webhooks set avatar_key = $2 where id = $1", [w.id, key]);
      return hookOut(await q1<any>(`${HOOKS} where w.id = $1`, [w.id]));
    });
    r.post<{ Params: { wid: string } }>("/api/webhooks/:wid/reset-token", async (req) => {
      const w = await hookForEdit(req, req.params.wid);
      if (w.type !== 1) throw bad("Only incoming webhooks have a URL.");
      const token = randomToken(32);
      await q("update webhooks set token_hash = $2 where id = $1", [w.id, sha256(token)]);
      return hookOut(w, token);
    });
    r.delete<{ Params: { wid: string } }>("/api/webhooks/:wid", async (req) => {
      const w = await hookForEdit(req, req.params.wid);
      await q("delete from webhooks where id = $1", [w.id]);
      if (w.type === 2) await q("delete from channel_follows where source_channel_id = $1 and target_channel_id = $2", [w.source_channel_id, w.channel_id]);
      return { ok: true };
    });

    /* ------------------------------------------------------------- activities -- */
    /** Built-in activities plus apps that offer one (an https page shown in a sandboxed frame). */
    r.get("/api/activities", async () => {
      const apps = await q<any>("select * from applications where public and activity_url is not null and listed order by install_count desc limit 50");
      return {
        builtin: [
          { id: "watch", name: "Watch Together", description: "Watch YouTube videos together, in sync." },
          { id: "sketch", name: "Sketch Board", description: "Draw together on a shared board." },
          { id: "tictactoe", name: "Tic-Tac-Toe", description: "A quick game for two (everyone else can watch)." },
          { id: "trivia", name: "Quick Trivia", description: "Answer questions against the clock." },
        ],
        apps: await Promise.all(apps.map(appOut)),
      };
    });
  });
  void permsFor;
}
