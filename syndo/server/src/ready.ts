import { guildExpressions } from "./routes/expressions.ts";
import { P, basePermissions, channelPermissions, has, type Guild } from "@syndo/shared";
import { config } from "./config.ts";
import { q, q1 } from "./db.ts";
import { USER_COLS, channelOut, mediaUrl, prefixedCols, prefixedUser, roleOut, selfOut, userOut } from "./serialize.ts";
import { loadMember, overwritesFor } from "./perms.ts";

/** A guild as one member sees it: only channels they can view, each with their computed permissions. */
export async function guildFor(userId: string, guildId: string): Promise<Guild | null> {
  const g = await q1<any>("select g.*, (select count(*)::int from members where guild_id = g.id) as member_count from guilds g where id = $1", [guildId]);
  if (!g) return null;
  const member = await loadMember(guildId, userId);
  if (!member) return null;
  const roles = await q<any>("select * from roles where guild_id = $1 order by position", [guildId]);
  const roleLike = roles.map((r) => ({ id: r.id, permissions: String(r.permissions), position: r.position }));
  const chans = await q<any>("select * from channels where guild_id = $1 and type not in (11,12) order by position, id", [guildId]);
  const ows = await overwritesFor(chans.map((c) => c.id));
  const base = basePermissions(g, member, roleLike);
  const channels = chans
    .map((c) => {
      const p = channelPermissions(g, member, roleLike, ows.get(c.id)!);
      return { c, p };
    })
    .filter(({ p }) => has(p, P.VIEW_CHANNEL))
    .map(({ c, p }) => channelOut(c, has(base, P.MANAGE_ROLES) || has(p, P.MANAGE_ROLES) ? ows.get(c.id) : [], { my_permissions: p.toString() }));
  const [u, expressions] = await Promise.all([q1<any>(`select ${USER_COLS} from users u where id = $1`, [userId]), guildExpressions(guildId)]);
  return {
    id: g.id, name: g.name, icon: mediaUrl(g.icon_key), banner: mediaUrl(g.banner_key), description: g.description,
    owner_id: g.owner_id, system_channel_id: g.system_channel_id, afk_channel_id: g.afk_channel_id, afk_timeout: g.afk_timeout,
    vanity_code: g.vanity_code, tag: g.tag, rules_channel_id: g.rules_channel_id, verification_level: g.verification_level,
    discoverable: g.discoverable, created_at: g.created_at, member_count: g.member_count,
    roles: roles.map(roleOut),
    channels,
    emojis: expressions.emojis,
    sounds: expressions.sounds,
    stickers: expressions.stickers,
    me: {
      guild_id: g.id, user: userOut(u), nick: member.nick, roles: member.roles, joined_at: member.joined_at,
      communication_disabled_until: member.communication_disabled_until ?? null, mute: member.mute, deaf: member.deaf,
      guild_avatar: mediaUrl(member.avatar_key), guild_bio: member.bio ?? null,
      guild_banner: mediaUrl(member.banner_key), guild_pronouns: member.pronouns ?? null, guild_profile_theme: member.profile_theme ?? null, guild_status: member.custom_status ?? null,
    },
  };
}

export async function privateChannelsFor(userId: string) {
  const chans = await q<any>(
    `select c.* from channels c join channel_recipients r on r.channel_id = c.id
      where r.user_id = $1 and c.type in (1,3) order by coalesce(c.last_message_id, c.id) desc`, [userId]);
  if (!chans.length) return [];
  const recips = await q<any>(
    `select r.channel_id::text, ${prefixedCols("u", "u_")} from channel_recipients r join users u on u.id = r.user_id
      where r.channel_id = any($1::bigint[]) and r.user_id <> $2`, [chans.map((c) => c.id), userId]);
  return chans.map((c) => channelOut(c, [], { recipients: recips.filter((r) => r.channel_id === c.id).map((r) => prefixedUser(r, "u_")!) }));
}

export async function relationshipsFor(userId: string) {
  const rows = await q<any>(
    `select r.type, r.created_at, ${prefixedCols("u", "u_")} from relationships r join users u on u.id = r.other_id where r.user_id = $1`, [userId]);
  return rows.map((r) => ({ id: r.u_id, type: r.type, since: r.created_at, user: prefixedUser(r, "u_")! }));
}

export async function buildReady(userId: string, sessionId: string, presences: Record<string, string>, voiceStates: unknown[]) {
  const me = await q1<any>("select * from users where id = $1", [userId]);
  const gids = await q<{ guild_id: string }>("select guild_id::text from members where user_id = $1 order by joined_at", [userId]);
  const guilds = (await Promise.all(gids.map((g) => guildFor(userId, g.guild_id)))).filter(Boolean);
  const read_states = await q<any>("select channel_id::text, last_read_id::text as last_read_id, mention_count from read_states where user_id = $1", [userId]);
  return {
    session_id: sessionId,
    user: selfOut(me),
    guilds,
    private_channels: await privateChannelsFor(userId),
    relationships: await relationshipsFor(userId),
    read_states,
    presences,
    voice_states: voiceStates,
    limits: config.limits,
  };
}
