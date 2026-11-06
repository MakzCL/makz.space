import {
  ChannelType, DM_PERMISSIONS, P, basePermissions, channelPermissions, has, isDmType,
  type GuildLike, type MemberLike, type OverwriteLike, type RoleLike,
} from "@syndo/shared";
import { q, q1 } from "./db.ts";
import { forbidden, notFound } from "./errors.ts";

/**
 * Server-side, authoritative permission checks. Every HTTP handler, gateway
 * fan-out, attachment download, search query and media token goes through
 * these functions. Nothing trusts the client's idea of its permissions.
 */
export interface ChanRow {
  id: string; guild_id: string | null; type: number; parent_id: string | null; owner_id: string | null; name: string | null;
  rate_limit_per_user: number; user_limit: number; bitrate: number; permission_synced: boolean; last_message_id: string | null;
  [k: string]: any;
}

export async function getChannel(id: string): Promise<ChanRow | null> {
  return q1<ChanRow>("select * from channels where id = $1", [id]);
}

export async function guildPermData(guildId: string): Promise<{ guild: GuildLike & { [k: string]: any }; roles: RoleLike[] } | null> {
  const guild = await q1("select * from guilds where id = $1", [guildId]);
  if (!guild) return null;
  const roles = await q<RoleLike>("select id, permissions::text as permissions, position from roles where guild_id = $1", [guildId]);
  return { guild, roles };
}

export async function loadMember(guildId: string, userId: string): Promise<(MemberLike & { [k: string]: any }) | null> {
  const m = await q1(
    `select m.*, coalesce(array_agg(mr.role_id::text) filter (where mr.role_id is not null), '{}') as roles
       from members m left join member_roles mr on mr.guild_id = m.guild_id and mr.user_id = m.user_id
      where m.guild_id = $1 and m.user_id = $2 group by m.guild_id, m.user_id`, [guildId, userId]);
  return m as any;
}

export async function loadMembers(guildId: string, userIds: string[]): Promise<Map<string, MemberLike>> {
  if (!userIds.length) return new Map();
  const rows = await q<any>(
    `select m.user_id::text, m.communication_disabled_until, coalesce(array_agg(mr.role_id::text) filter (where mr.role_id is not null), '{}') as roles
       from members m left join member_roles mr on mr.guild_id = m.guild_id and mr.user_id = m.user_id
      where m.guild_id = $1 and m.user_id = any($2::bigint[]) group by m.guild_id, m.user_id`, [guildId, userIds]);
  return new Map(rows.map((r) => [r.user_id, r]));
}

export async function overwritesFor(channelIds: string[]): Promise<Map<string, OverwriteLike[]>> {
  const out = new Map<string, OverwriteLike[]>(channelIds.map((id) => [id, []]));
  if (!channelIds.length) return out;
  const rows = await q<any>("select channel_id::text, target_id::text, target_type, allow::text, deny::text from permission_overwrites where channel_id = any($1::bigint[])", [channelIds]);
  for (const r of rows) out.get(r.channel_id)!.push(r);
  return out;
}

/** The channel whose overwrites govern `ch` (threads inherit their parent's). */
const governing = async (ch: ChanRow): Promise<ChanRow> =>
  (ch.type === ChannelType.PUBLIC_THREAD || ch.type === ChannelType.PRIVATE_THREAD) && ch.parent_id ? (await getChannel(ch.parent_id)) ?? ch : ch;

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  return !!(await q1("select 1 from relationships where type = 2 and ((user_id = $1 and other_id = $2) or (user_id = $2 and other_id = $1))", [a, b]));
}

async function dmPerms(userId: string, ch: ChanRow): Promise<bigint> {
  const rec = await q<{ user_id: string }>("select user_id::text from channel_recipients where channel_id = $1", [ch.id]);
  if (!rec.some((r) => r.user_id === userId)) return 0n;
  if (ch.type === ChannelType.DM) {
    const other = rec.find((r) => r.user_id !== userId);
    if (other && (await isBlockedBetween(userId, other.user_id))) {
      // History stays readable; nothing new can be sent or started.
      return P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
    }
  }
  return DM_PERMISSIONS;
}

/** Effective permissions of `userId` in channel `ch` (0n = cannot see it). */
export async function permsFor(userId: string, ch: ChanRow): Promise<bigint> {
  if (isDmType(ch.type)) return dmPerms(userId, ch);
  if (!ch.guild_id) return 0n;
  const data = await guildPermData(ch.guild_id);
  if (!data) return 0n;
  const member = await loadMember(ch.guild_id, userId);
  if (!member) return 0n;
  const gov = await governing(ch);
  const ows = (await overwritesFor([gov.id])).get(gov.id)!;
  let perms = channelPermissions(data.guild, member, data.roles, ows);
  if (ch.type === ChannelType.PRIVATE_THREAD && !has(perms, P.MANAGE_THREADS)) {
    const inThread = await q1("select 1 from channel_recipients where channel_id = $1 and user_id = $2", [ch.id, userId]);
    if (!inThread) perms = 0n;
  }
  return perms;
}

/** Load a channel and require permissions. Invisible channels are reported as missing, never as forbidden. */
export async function requireChannel(userId: string, channelId: string, needed: bigint = P.VIEW_CHANNEL) {
  const channel = await getChannel(channelId);
  if (!channel) throw notFound("Channel");
  const perms = await permsFor(userId, channel);
  if (!has(perms, P.VIEW_CHANNEL)) throw notFound("Channel");
  if (!has(perms, needed)) throw forbidden();
  return { channel, perms };
}

export async function requireGuild(userId: string, guildId: string, needed: bigint = 0n) {
  const data = await guildPermData(guildId);
  if (!data) throw notFound("Server");
  const member = await loadMember(guildId, userId);
  if (!member) throw notFound("Server");
  const perms = basePermissions(data.guild, member, data.roles);
  if (needed && !has(perms, needed)) throw forbidden();
  return { ...data, member, perms };
}

/**
 * Batch: which of `userIds` can see channel `ch`, and with what permissions.
 * Used for real-time fan-out so a message is only ever delivered to people
 * who could fetch it over HTTP.
 */
export async function viewers(ch: ChanRow, userIds: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  if (!userIds.length) return out;
  if (isDmType(ch.type)) {
    for (const uid of userIds) { const p = await dmPerms(uid, ch); if (p) out.set(uid, p); }
    return out;
  }
  if (!ch.guild_id) return out;
  const data = await guildPermData(ch.guild_id);
  if (!data) return out;
  const gov = await governing(ch);
  const ows = (await overwritesFor([gov.id])).get(gov.id)!;
  const members = await loadMembers(ch.guild_id, userIds);
  let threadMembers: Set<string> | null = null;
  if (ch.type === ChannelType.PRIVATE_THREAD) {
    threadMembers = new Set((await q<{ user_id: string }>("select user_id::text from channel_recipients where channel_id = $1", [ch.id])).map((r) => r.user_id));
  }
  for (const [uid, m] of members) {
    let p = channelPermissions(data.guild, m, data.roles, ows);
    if (threadMembers && !threadMembers.has(uid) && !has(p, P.MANAGE_THREADS)) p = 0n;
    if (has(p, P.VIEW_CHANNEL)) out.set(uid, p);
  }
  return out;
}
