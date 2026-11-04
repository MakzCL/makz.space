import type { FastifyInstance } from "fastify";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { ChannelType, P, validateGlobal, validateScope, validateThemeDoc, validateThemePartial } from "@syndo/shared";
import { config } from "../config.ts";
import { q, q1 } from "../db.ts";
import { requireUser, uid } from "../auth.ts";
import { ApiError, bad, conflict, forbidden, notFound } from "../errors.ts";
import { newId } from "../ids.ts";
import { toChannel, toUser } from "../gateway.ts";
import { getChannel, requireChannel, requireGuild } from "../perms.ts";
import * as storage from "../storage.ts";
import { imageSize, IMAGE_TYPES } from "../uploads.ts";

/**
 * Personal appearance: preferences per scope, presets and a private asset library.
 * Everything here is private to its owner. Nothing in this module is ever
 * included in a public profile, member list or message payload.
 */
const MAX_WALLPAPER = Number(process.env.SYNDO_MAX_WALLPAPER_MB ?? 25) * 1024 * 1024;
const QUOTA = Number(process.env.SYNDO_APPEARANCE_QUOTA_MB ?? 300) * 1024 * 1024;
const VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const ID = z.string().regex(/^\d{1,20}$/);
const issuesError = (issues: { path: string; message: string; level: string }[]) => {
  const errs = issues.filter((i) => i.level === "error");
  if (errs.length) throw Object.assign(bad(`Invalid appearance settings: ${errs.slice(0, 3).map((e) => `${e.path || "root"} ${e.message}`).join("; ")}`, "invalid_theme"), { issues: errs });
};

const assetOut = (a: any, refs?: string[]) => ({
  id: `a${a.id}`, kind: a.kind, mime: a.mime, size: Number(a.size), width: a.width, height: a.height, animated: a.animated, name: a.name,
  favorite: a.favorite, created_at: a.created_at, url: `/api/appearance/assets/${a.id}`, ...(refs ? { references: refs } : {}),
});

/** Where an asset id is referenced by the owner's prefs and presets ("still in use" protection). */
async function references(userId: string, assetId: string): Promise<string[]> {
  const needle = `%"a${assetId}"%`;
  const prefs = await q<any>("select scope, scope_id::text from appearance_prefs where user_id = $1 and data::text like $2", [userId, needle]);
  const presets = await q<any>("select id::text, name from theme_presets where user_id = $1 and data::text like $2", [userId, needle]);
  const shared = await q<any>("select id::text from conversation_themes where proposer_id = $1 and status = 'open' and data::text like $2", [userId, needle]);
  return [
    ...prefs.map((p) => (p.scope === "global" ? "Global appearance" : p.scope === "guild" ? `Server ${p.scope_id}` : `Conversation/channel ${p.scope_id}`)),
    ...presets.map((p) => `Preset “${p.name}”`), ...shared.map(() => "Shared conversation theme"),
  ];
}

async function assertAssetsOwned(userId: string, data: unknown) {
  const ids = [...new Set([...JSON.stringify(data ?? {}).matchAll(/"a(\d{1,20})"/g)].map((m) => m[1]!))];
  if (!ids.length) return;
  const rows = await q<any>("select id::text from appearance_assets where user_id = $1 and id = any($2::bigint[])", [userId, ids]);
  const owned = new Set(rows.map((r) => r.id));
  const missing = ids.filter((i) => !owned.has(i));
  if (missing.length) throw bad(`Unknown or someone else's asset: a${missing[0]}. Upload it to your library first.`, "asset_not_owned");
}

async function saveScope(userId: string, scope: string, scopeId: string, data: unknown, rev: number | undefined) {
  const cur = await q1<any>("select rev from appearance_prefs where user_id = $1 and scope = $2 and scope_id = $3", [userId, scope, scopeId]);
  // Conflict handling: a client that edited an older revision is told, and receives the current one to merge.
  if (rev !== undefined && cur && cur.rev !== rev) {
    const now = await q1<any>("select data, rev, updated_at from appearance_prefs where user_id = $1 and scope = $2 and scope_id = $3", [userId, scope, scopeId]);
    throw Object.assign(conflict("These settings were changed on another device. Your view has been refreshed — review and save again.", "rev_conflict"), { current: now });
  }
  const r = await q1<any>(
    `insert into appearance_prefs(user_id, scope, scope_id, data) values ($1,$2,$3,$4)
     on conflict (user_id, scope, scope_id) do update set data = excluded.data, rev = appearance_prefs.rev + 1, updated_at = now()
     returning rev, updated_at`, [userId, scope, scopeId, JSON.stringify(data)]);
  toUser(userId, "APPEARANCE_UPDATE", { scope, scope_id: scopeId, data, rev: r.rev, updated_at: r.updated_at });
  return { rev: r.rev, updated_at: r.updated_at };
}

export async function appearanceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/api/appearance", async (req) => {
    const me = uid(req);
    const prefs = await q<any>("select scope, scope_id::text, data, rev, updated_at from appearance_prefs where user_id = $1", [me]);
    const presets = await q<any>("select id::text, name, data, created_at, updated_at from theme_presets where user_id = $1 order by updated_at desc", [me]);
    const usage = await q1<any>("select coalesce(sum(size), 0)::bigint as used, count(*)::int as count from appearance_assets where user_id = $1", [me]);
    const shared = await q<any>(
      `select t.id::text, t.channel_id::text, t.proposer_id::text, t.data, t.created_at,
              (select accepted from conversation_theme_votes v where v.theme_id = t.id and v.user_id = $1) as my_vote
         from conversation_themes t join channel_recipients r on r.channel_id = t.channel_id and r.user_id = $1 where t.status = 'open'`, [me]);
    return { prefs, presets, shared, storage: { used: Number(usage.used), count: usage.count, quota: QUOTA, max_file: MAX_WALLPAPER } };
  });

  app.put("/api/appearance/global", async (req) => {
    const b = z.object({ data: z.unknown(), rev: z.number().int().optional() }).parse(req.body);
    const { value, issues } = validateGlobal(b.data);
    issuesError(issues);
    await assertAssetsOwned(uid(req), value);
    return { ...(await saveScope(uid(req), "global", "0", value, b.rev)), data: value, warnings: issues };
  });

  for (const scope of ["guild", "channel"] as const) {
    app.put<{ Params: { id: string } }>(`/api/appearance/${scope}/:id`, async (req) => {
      if (scope === "guild") await requireGuild(uid(req), req.params.id); else await requireChannel(uid(req), req.params.id);
      const b = z.object({ data: z.unknown(), rev: z.number().int().optional() }).parse(req.body);
      const { value, issues } = validateScope(b.data);
      issuesError(issues);
      await assertAssetsOwned(uid(req), value);
      return { ...(await saveScope(uid(req), scope, req.params.id, value, b.rev)), data: value, warnings: issues };
    });
    app.delete<{ Params: { id: string } }>(`/api/appearance/${scope}/:id`, async (req) => {
      await q("delete from appearance_prefs where user_id = $1 and scope = $2 and scope_id = $3", [uid(req), scope, req.params.id]);
      toUser(uid(req), "APPEARANCE_UPDATE", { scope, scope_id: req.params.id, data: null, rev: 0 });
      return { ok: true };
    });
  }

  /* --------------------------------------------------------- presets -- */
  app.post("/api/appearance/presets", async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(64), data: z.unknown() }).parse(req.body);
    const { doc, issues } = validateThemeDoc(b.data);
    if (!doc) issuesError(issues);
    issuesError(issues);
    await assertAssetsOwned(uid(req), doc);
    const n = await q1<any>("select count(*)::int as n from theme_presets where user_id = $1", [uid(req)]);
    if (n.n >= 100) throw bad("You can keep up to 100 presets.");
    const id = newId();
    doc!.meta.name = b.name;
    await q("insert into theme_presets(id, user_id, name, data) values ($1,$2,$3,$4)", [id, uid(req), b.name, JSON.stringify(doc)]);
    toUser(uid(req), "PRESETS_UPDATE", {});
    return { id, name: b.name, data: doc, warnings: issues };
  });
  app.patch<{ Params: { id: string } }>("/api/appearance/presets/:id", async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(64).optional(), data: z.unknown().optional() }).parse(req.body);
    const cur = await q1<any>("select * from theme_presets where id = $1 and user_id = $2", [req.params.id, uid(req)]);
    if (!cur) throw notFound("Preset");
    let data = cur.data;
    if (b.data !== undefined) {
      const r = validateThemeDoc(b.data);
      if (!r.doc) issuesError(r.issues);
      issuesError(r.issues);
      await assertAssetsOwned(uid(req), r.doc);
      data = r.doc;
    }
    if (b.name) data.meta.name = b.name;
    await q("update theme_presets set name = coalesce($3, name), data = $4, updated_at = now() where id = $1 and user_id = $2", [req.params.id, uid(req), b.name ?? null, JSON.stringify(data)]);
    toUser(uid(req), "PRESETS_UPDATE", {});
    return { id: req.params.id, name: b.name ?? cur.name, data };
  });
  app.delete<{ Params: { id: string } }>("/api/appearance/presets/:id", async (req) => {
    const r = await q1("delete from theme_presets where id = $1 and user_id = $2 returning 1", [req.params.id, uid(req)]);
    if (!r) throw notFound("Preset");
    toUser(uid(req), "PRESETS_UPDATE", {});
    return { ok: true };
  });

  /** Validate a theme file without saving it (import preview). */
  app.post("/api/appearance/validate", async (req) => {
    const { doc, issues } = validateThemeDoc((req.body as any)?.data);
    return { ok: !!doc && !issues.some((i) => i.level === "error"), doc, issues };
  });

  /* ---------------------------------------------------------- assets -- */
  app.get("/api/appearance/assets", async (req) => {
    const rows = await q<any>("select * from appearance_assets where user_id = $1 order by favorite desc, created_at desc", [uid(req)]);
    return Promise.all(rows.map(async (a) => assetOut(a, await references(uid(req), a.id))));
  });

  async function ingest(req: any, replaceId?: string) {
    const me = uid(req);
    const file = await req.file({ limits: { fileSize: MAX_WALLPAPER, files: 1 } });
    if (!file) throw bad("Attach an image or video.");
    const buf: Buffer = await file.toBuffer().catch(() => { throw new ApiError(413, "too_large", `Backgrounds can be up to ${MAX_WALLPAPER / 1048576} MB.`); });
    if (file.file.truncated) throw new ApiError(413, "too_large", `Backgrounds can be up to ${MAX_WALLPAPER / 1048576} MB.`);
    const t = await fileTypeFromBuffer(buf);
    if (!t || (!IMAGE_TYPES.has(t.mime) && !VIDEO_TYPES.has(t.mime))) throw bad("Use PNG, JPEG, GIF, WebP, AVIF, MP4 or WebM. SVG and other formats aren't accepted for safety.", "bad_type");
    const used = await q1<any>("select coalesce(sum(size), 0)::bigint as used from appearance_assets where user_id = $1 and ($2::bigint is null or id <> $2)", [me, replaceId ?? null]);
    if (Number(used.used) + buf.length > QUOTA) throw new ApiError(413, "quota", `Your background library is full (${Math.round(QUOTA / 1048576)} MB). Delete unused items first.`);
    const kind = VIDEO_TYPES.has(t.mime) ? "video" : "image";
    const dims = kind === "image" ? imageSize(buf, t.mime) : { width: null, height: null };
    const animated = kind === "video" || (t.mime === "image/gif" && buf.indexOf(Buffer.from("NETSCAPE2.0")) > 0) || (t.mime === "image/webp" && buf.toString("ascii", 12, 16) === "VP8X" && (buf[20]! & 0x02) !== 0) || (t.mime === "image/png" && buf.indexOf(Buffer.from("acTL")) > 0);
    const name = String(file.filename ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 80);
    return { buf, mime: t.mime, ext: t.ext, kind, dims, animated, name };
  }

  app.post("/api/appearance/assets", async (req) => {
    const f = await ingest(req);
    const id = newId();
    const key = `appearance/${uid(req)}/${id}.${f.ext}`;
    await storage.put(key, f.buf);
    await q("insert into appearance_assets(id, user_id, kind, mime, size, storage_key, width, height, animated, name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [id, uid(req), f.kind, f.mime, f.buf.length, key, f.dims.width, f.dims.height, f.animated, f.name]);
    return assetOut(await q1("select * from appearance_assets where id = $1", [id]), []);
  });

  /** Replace an asset's file in place: everything referencing it updates. */
  app.put<{ Params: { id: string } }>("/api/appearance/assets/:id", async (req) => {
    const cur = await q1<any>("select * from appearance_assets where id = $1 and user_id = $2", [req.params.id, uid(req)]);
    if (!cur) throw notFound("Asset");
    const f = await ingest(req, cur.id);
    const key = `appearance/${uid(req)}/${newId()}.${f.ext}`;
    await storage.put(key, f.buf);
    await q("update appearance_assets set kind = $2, mime = $3, size = $4, storage_key = $5, width = $6, height = $7, animated = $8 where id = $1",
      [cur.id, f.kind, f.mime, f.buf.length, key, f.dims.width, f.dims.height, f.animated]);
    await storage.remove(cur.storage_key).catch(() => {});
    return assetOut(await q1("select * from appearance_assets where id = $1", [cur.id]));
  });

  app.patch<{ Params: { id: string } }>("/api/appearance/assets/:id", async (req) => {
    const b = z.object({ favorite: z.boolean().optional(), name: z.string().max(80).optional() }).parse(req.body);
    const r = await q1<any>("update appearance_assets set favorite = coalesce($3, favorite), name = coalesce($4, name) where id = $1 and user_id = $2 returning *", [req.params.id, uid(req), b.favorite ?? null, b.name ?? null]);
    if (!r) throw notFound("Asset");
    return assetOut(r);
  });

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>("/api/appearance/assets/:id", async (req) => {
    const a = await q1<any>("select * from appearance_assets where id = $1 and user_id = $2", [req.params.id, uid(req)]);
    if (!a) throw notFound("Asset");
    const refs = await references(uid(req), a.id);
    if (refs.length && req.query.force !== "1") throw Object.assign(conflict(`Still used by: ${refs.join(", ")}. Delete anyway? Those places will fall back to their colours.`, "asset_in_use"), { references: refs });
    await q("delete from appearance_assets where id = $1", [a.id]);
    await storage.remove(a.storage_key).catch(() => {});
    return { ok: true };
  });

  /** Delete every asset not referenced anywhere. */
  app.post("/api/appearance/assets/cleanup", async (req) => {
    const rows = await q<any>("select * from appearance_assets where user_id = $1", [uid(req)]);
    let removed = 0, freed = 0;
    for (const a of rows) {
      if ((await references(uid(req), a.id)).length || a.favorite) continue;
      await q("delete from appearance_assets where id = $1", [a.id]);
      await storage.remove(a.storage_key).catch(() => {});
      removed++; freed += Number(a.size);
    }
    return { removed, freed };
  });

  /* ------------------------------------------- shared conversation themes -- */
  app.post<{ Params: { cid: string } }>("/api/channels/:cid/theme-proposals", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
    const { channel } = await requireChannel(uid(req), req.params.cid, P.SEND_MESSAGES);
    if (channel.type !== ChannelType.DM && channel.type !== ChannelType.GROUP_DM) throw bad("Shared themes are for DMs and group DMs.");
    const { value, issues } = validateScope({ overrides: (req.body as any)?.data ?? {} });
    issuesError(issues);
    await assertAssetsOwned(uid(req), value);
    await q("update conversation_themes set status = 'withdrawn' where channel_id = $1 and proposer_id = $2 and status = 'open'", [channel.id, uid(req)]);
    const id = newId();
    await q("insert into conversation_themes(id, channel_id, proposer_id, data) values ($1,$2,$3,$4)", [id, channel.id, uid(req), JSON.stringify(value.overrides)]);
    await q("insert into conversation_theme_votes(theme_id, user_id, accepted) values ($1,$2,true)", [id, uid(req)]);
    await toChannel(channel, "CONVERSATION_THEME_UPDATE", { channel_id: channel.id });
    return { id };
  });
  for (const action of ["accept", "decline"] as const) {
    app.post<{ Params: { id: string } }>(`/api/theme-proposals/:id/${action}`, async (req) => {
      const t = await q1<any>("select * from conversation_themes where id = $1 and status = 'open'", [req.params.id]);
      if (!t) throw notFound("Proposal");
      const { channel } = await requireChannel(uid(req), t.channel_id);
      await q(`insert into conversation_theme_votes(theme_id, user_id, accepted) values ($1,$2,$3)
               on conflict (theme_id, user_id) do update set accepted = excluded.accepted`, [t.id, uid(req), action === "accept"]);
      await toChannel(channel, "CONVERSATION_THEME_UPDATE", { channel_id: channel.id });
      return { ok: true };
    });
  }
  app.delete<{ Params: { id: string } }>("/api/theme-proposals/:id", async (req) => {
    const t = await q1<any>("select * from conversation_themes where id = $1 and proposer_id = $2 and status = 'open'", [req.params.id, uid(req)]);
    if (!t) throw notFound("Proposal");
    await q("update conversation_themes set status = 'withdrawn' where id = $1", [t.id]);
    const ch = await getChannel(t.channel_id);
    if (ch) await toChannel(ch, "CONVERSATION_THEME_UPDATE", { channel_id: ch.id });
    return { ok: true };
  });
}

/** Asset download: owner, or a participant of a conversation where an open shared theme references it. */
export async function appearanceAssetRoute(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/api/appearance/assets/:id", { preHandler: requireUser }, async (req, reply) => {
    if (!/^\d{1,20}$/.test(req.params.id)) throw notFound("File");
    const a = await q1<any>("select * from appearance_assets where id = $1", [req.params.id]);
    if (!a) throw notFound("File");
    if (a.user_id !== uid(req)) {
      const shared = await q1(
        `select 1 from conversation_themes t join channel_recipients r on r.channel_id = t.channel_id and r.user_id = $2
          where t.proposer_id = $3 and t.status = 'open' and t.data::text like $1 limit 1`, [`%"a${a.id}"%`, uid(req), a.user_id]);
      if (!shared) throw notFound("File");
    }
    // Assets are immutable per id, so the id is a perfect validator. Revalidating on every use keeps loads cheap (304)
    // while making deletion and revoked sharing take effect immediately instead of after a day in the browser cache.
    const etag = `"a${a.id}"`;
    reply.header("cache-control", "private, no-cache");
    reply.header("etag", etag);
    reply.header("x-content-type-options", "nosniff");
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    reply.header("content-type", a.mime);
    reply.header("content-security-policy", "default-src 'none'; sandbox");
    reply.header("content-length", Number(a.size));
    return reply.send(storage.open(a.storage_key));
  });
  void config; void forbidden; void validateThemePartial;
}
