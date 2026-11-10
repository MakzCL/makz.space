import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { P } from "@syndo/shared";
import { requireUser, uid } from "../auth.ts";
import { q, q1 } from "../db.ts";
import { ApiError, bad, notFound } from "../errors.ts";
import { requireGuild } from "../perms.ts";
import * as storage from "../storage.ts";
import { safeFetch } from "../unfurl.ts";

/**
 * 7TV and BTTV emotes. The global sets are built in; a server can link a channel's set and turn emotes off.
 * Messages carry `<7tv:name:id>` / `<bttv:name:id>`, so an emote keeps showing after a set changes. Images are
 * fetched once, cached in storage and served from here — viewers never contact 7TV or BTTV themselves.
 */
export interface Emote { id: string; name: string; animated: boolean; provider: "7tv" | "bttv" }
export interface EmoteSettings { enabled: boolean; seventv_set?: string | null; twitch_id?: string | null; label?: string | null }

const NAME = /^[A-Za-z0-9_]{2,32}$/;
const ID = { "7tv": /^[0-9A-HJKMNP-TV-Z]{26}$|^[a-f0-9]{24}$/i, bttv: /^[a-f0-9]{24}$/i } as const;
// 7TV content flags we leave out: sexual content and "disallowed on Twitch".
const HIDDEN_7TV = 65536 | 16777216;

/** JSON from a provider. Tests point SYNDO_EMOTE_FIXTURES at saved responses instead of the network. */
async function getJson(url: string): Promise<any> {
  const fx = process.env.SYNDO_EMOTE_FIXTURES;
  if (fx) {
    const name = url.replace(/^https:\/\//, "").replace(/[^a-z0-9]+/gi, "_");
    try { return JSON.parse(await readFile(`${fx}/${name}.json`, "utf8")); } catch { throw new ApiError(404, "not_found", "That emote set wasn't found."); }
  }
  const r = await safeFetch(url, { maxBytes: 8 * 1024 * 1024, accept: "application/json" }).catch(() => null);
  if (!r || r.status === 404) throw new ApiError(404, "not_found", "That emote set wasn't found.");
  if (r.status !== 200) throw new ApiError(502, "provider_error", "7TV or BTTV didn't answer. Try again in a moment.");
  try { return JSON.parse(r.body.toString("utf8")); } catch { throw new ApiError(502, "provider_error", "7TV or BTTV sent something unexpected."); }
}

export function from7tv(set: any): Emote[] {
  const out: Emote[] = [];
  for (const e of set?.emotes ?? []) {
    const flags = Number(e?.data?.flags ?? 0);
    if (!NAME.test(e?.name ?? "") || !ID["7tv"].test(e?.id ?? "") || flags & HIDDEN_7TV || e?.data?.listed === false && flags & HIDDEN_7TV) continue;
    out.push({ id: e.id, name: e.name, animated: !!e?.data?.animated, provider: "7tv" });
  }
  return out;
}
export function fromBttv(list: any[]): Emote[] {
  return (list ?? []).filter((e) => NAME.test(e?.code ?? "") && ID.bttv.test(e?.id ?? "")).map((e) => ({ id: e.id, name: e.code, animated: !!e.animated, provider: "bttv" as const }));
}

/* Small in-memory caches: globals for 6 hours, server sets for 30 minutes. */
const cache = new Map<string, { at: number; value: Emote[] }>();
async function cached(key: string, ttl: number, load: () => Promise<Emote[]>): Promise<Emote[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  try { const value = await load(); cache.set(key, { at: Date.now(), value }); return value; }
  catch (e) { if (hit) return hit.value; throw e; } // keep serving the last good copy if a provider is down
}
const globals = () => cached("global", 6 * 3600_000, async () => {
  const [s, b] = await Promise.all([getJson("https://7tv.io/v3/emote-sets/global").then(from7tv).catch(() => []), getJson("https://api.betterttv.net/3/cached/emotes/global").then(fromBttv).catch(() => [])]);
  return [...s, ...b];
});
async function linked(s: EmoteSettings): Promise<Emote[]> {
  if (!s.seventv_set && !s.twitch_id) return [];
  return cached(`set:${s.seventv_set}:${s.twitch_id}`, 30 * 60_000, async () => {
    const [a, b] = await Promise.all([
      s.seventv_set ? getJson(`https://7tv.io/v3/emote-sets/${s.seventv_set}`).then(from7tv).catch(() => []) : Promise.resolve([]),
      s.twitch_id ? getJson(`https://api.betterttv.net/3/cached/users/twitch/${s.twitch_id}`).then((u) => fromBttv([...(u?.channelEmotes ?? []), ...(u?.sharedEmotes ?? [])])).catch(() => []) : Promise.resolve([]),
    ]);
    return [...a, ...b];
  });
}

/** Work out what a pasted link or ID points at. */
export async function resolveSource(raw: string): Promise<Pick<EmoteSettings, "seventv_set" | "twitch_id" | "label">> {
  const v = raw.trim();
  let m = v.match(/7tv\.app\/emote-sets\/([0-9A-Za-z]{24,26})/);
  if (m) { const set = await getJson(`https://7tv.io/v3/emote-sets/${m[1]}`); return { seventv_set: set.id ?? m[1], twitch_id: null, label: set.name ?? "7TV set" }; }
  m = v.match(/7tv\.app\/users\/([0-9A-Za-z]{24,26})/);
  if (m) {
    const user = await getJson(`https://7tv.io/v3/users/${m[1]}`);
    const tw = (user.connections ?? []).find((c: any) => c.platform === "TWITCH");
    const set = tw?.emote_set_id ?? (user.connections ?? [])[0]?.emote_set_id ?? null;
    if (!set && !tw) throw bad("That 7TV profile has no emote set yet.");
    return { seventv_set: set, twitch_id: tw?.id ?? null, label: user.display_name ?? user.username ?? "7TV" };
  }
  if (/^\d{1,12}$/.test(v)) {
    const u = await getJson(`https://7tv.io/v3/users/twitch/${v}`).catch(() => null);
    return { seventv_set: u?.emote_set?.id ?? u?.emote_set_id ?? null, twitch_id: v, label: u?.display_name ?? u?.username ?? `Twitch ${v}` };
  }
  throw bad("Paste a 7TV profile or emote-set link (7tv.app/…), or a Twitch user ID.");
}

const settingsOf = async (guildId: string): Promise<EmoteSettings> =>
  ((await q1<any>("select third_party_emotes from guilds where id = $1", [guildId]))?.third_party_emotes ?? { enabled: true }) as EmoteSettings;

export async function emoteRoutes(app: FastifyInstance) {
  /** Built-in sets, available everywhere (DMs included). */
  app.get("/api/emotes/global", { preHandler: requireUser }, async () => ({ emotes: await globals() }));

  /** What a server offers: whether emotes are on, plus its linked set. */
  app.get<{ Params: { id: string } }>("/api/guilds/:id/emotes", { preHandler: requireUser }, async (req) => {
    await requireGuild(uid(req), req.params.id);
    const s = await settingsOf(req.params.id);
    return { settings: s, emotes: s.enabled === false ? [] : await linked(s).catch(() => []) };
  });

  app.patch<{ Params: { id: string } }>("/api/guilds/:id/emotes", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    await requireGuild(uid(req), req.params.id, P.MANAGE_EXPRESSIONS);
    const b = z.object({ enabled: z.boolean().optional(), source: z.string().max(300).nullable().optional() }).parse(req.body);
    const s = { ...(await settingsOf(req.params.id)) };
    if (b.enabled !== undefined) s.enabled = b.enabled;
    if (b.source === null || b.source === "") Object.assign(s, { seventv_set: null, twitch_id: null, label: null });
    else if (b.source) Object.assign(s, await resolveSource(b.source));
    await q("update guilds set third_party_emotes = $2 where id = $1", [req.params.id, JSON.stringify(s)]);
    return { settings: s, emotes: s.enabled === false ? [] : await linked(s).catch(() => []) };
  });

  /** Emote images, cached in storage after the first fetch. Public: they're public on 7TV/BTTV too. */
  app.get<{ Params: { provider: string; id: string } }>("/api/emotes/img/:provider/:id", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    const provider = req.params.provider as "7tv" | "bttv", id = req.params.id;
    if (!(provider in ID) || !ID[provider].test(id)) throw notFound("Emote");
    const key = `emotes/${provider}/${id.toLowerCase()}`;
    let type = "image/webp";
    const known = await storage.size(key).catch(() => -1);
    if (known < 0) {
      if (process.env.SYNDO_EMOTE_FIXTURES) throw notFound("Emote");
      const url = provider === "7tv" ? `https://cdn.7tv.app/emote/${id}/2x.webp` : `https://cdn.betterttv.net/emote/${id}/2x.webp`;
      const r = await safeFetch(url, { maxBytes: 4 * 1024 * 1024, accept: "image/webp,image/*" }).catch(() => null);
      if (!r || r.status !== 200 || !/^image\/(webp|png|gif|avif)/.test(r.type)) throw notFound("Emote");
      type = r.type.split(";")[0]!;
      await storage.put(key, r.body);
    } else if (provider === "bttv") type = "image/webp";
    reply.header("content-type", type).header("cache-control", "public, max-age=2592000, immutable").header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox");
    return reply.send(storage.open(key));
  });
}
