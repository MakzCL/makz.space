/**
 * SEND permission model.
 *
 * Permissions are a 64-bit bitfield (BigInt in code, decimal string on the
 * wire). The same functions run on the server — where they are authoritative
 * for every HTTP request, gateway dispatch, file download, search result and
 * media token — and in the client, where they only decide what to show.
 *
 * Resolution order for a member in a channel:
 *   1. Server owner → everything.
 *   2. Base = @everyone role | every role the member holds.
 *   3. ADMINISTRATOR in base → everything.
 *   4. Channel overwrites: @everyone, then all role overwrites combined, then
 *      the member's own overwrite. Each step removes `deny` then adds `allow`.
 *   5. No VIEW_CHANNEL → nothing at all in that channel.
 *   6. A timed-out member keeps only VIEW_CHANNEL + READ_MESSAGE_HISTORY.
 */
export const P = {
  VIEW_CHANNEL: 1n << 0n,
  SEND_MESSAGES: 1n << 1n,
  READ_MESSAGE_HISTORY: 1n << 2n,
  EMBED_LINKS: 1n << 3n,
  ATTACH_FILES: 1n << 4n,
  ADD_REACTIONS: 1n << 5n,
  MENTION_EVERYONE: 1n << 6n,
  MANAGE_MESSAGES: 1n << 7n,
  MANAGE_CHANNELS: 1n << 8n,
  MANAGE_ROLES: 1n << 9n,
  MANAGE_GUILD: 1n << 10n,
  KICK_MEMBERS: 1n << 11n,
  BAN_MEMBERS: 1n << 12n,
  ADMINISTRATOR: 1n << 13n,
  CREATE_INVITE: 1n << 14n,
  CHANGE_NICKNAME: 1n << 15n,
  MANAGE_NICKNAMES: 1n << 16n,
  MANAGE_EXPRESSIONS: 1n << 17n,
  VIEW_AUDIT_LOG: 1n << 18n,
  MODERATE_MEMBERS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  VIDEO: 1n << 22n,
  MUTE_MEMBERS: 1n << 23n,
  DEAFEN_MEMBERS: 1n << 24n,
  MOVE_MEMBERS: 1n << 25n,
  USE_VAD: 1n << 26n,
  PRIORITY_SPEAKER: 1n << 27n,
  SEND_MESSAGES_IN_THREADS: 1n << 28n,
  CREATE_PUBLIC_THREADS: 1n << 29n,
  CREATE_PRIVATE_THREADS: 1n << 30n,
  MANAGE_THREADS: 1n << 31n,
  USE_EXTERNAL_EMOJIS: 1n << 32n,
  USE_SOUNDBOARD: 1n << 33n,
  MANAGE_WEBHOOKS: 1n << 34n,
  MANAGE_EVENTS: 1n << 35n,
  REQUEST_TO_SPEAK: 1n << 36n,
  USE_APPLICATION_COMMANDS: 1n << 37n,
  SEND_VOICE_MESSAGES: 1n << 38n,
  SEND_POLLS: 1n << 39n,
  BYPASS_SLOWMODE: 1n << 40n,
} as const;

export type PermName = keyof typeof P;
export const ALL_PERMISSIONS = Object.values(P).reduce((a, b) => a | b, 0n);

/** Human labels and grouping for role / overwrite editors. */
export const PERMISSION_INFO: { group: string; items: { key: PermName; label: string; help: string }[] }[] = [
  {
    group: "General",
    items: [
      { key: "VIEW_CHANNEL", label: "View channels", help: "See channels and read what is posted in them." },
      { key: "MANAGE_CHANNELS", label: "Manage channels", help: "Create, edit and delete channels." },
      { key: "MANAGE_ROLES", label: "Manage roles", help: "Create and edit roles below their own highest role." },
      { key: "MANAGE_EXPRESSIONS", label: "Manage emoji, stickers & sounds", help: "Upload and remove custom emoji, stickers and soundboard sounds." },
      { key: "VIEW_AUDIT_LOG", label: "View audit log", help: "See the record of administrative actions." },
      { key: "MANAGE_WEBHOOKS", label: "Manage webhooks", help: "Create and delete webhooks." },
      { key: "MANAGE_GUILD", label: "Manage server", help: "Change the server's name, icon and settings." },
    ],
  },
  {
    group: "Membership",
    items: [
      { key: "CREATE_INVITE", label: "Create invites", help: "Invite new people." },
      { key: "CHANGE_NICKNAME", label: "Change own nickname", help: "" },
      { key: "MANAGE_NICKNAMES", label: "Manage nicknames", help: "Change other members' nicknames." },
      { key: "KICK_MEMBERS", label: "Kick members", help: "Remove members (they can rejoin with an invite)." },
      { key: "BAN_MEMBERS", label: "Ban members", help: "Remove members permanently." },
      { key: "MODERATE_MEMBERS", label: "Time out members", help: "Temporarily stop members from talking." },
    ],
  },
  {
    group: "Text",
    items: [
      { key: "SEND_MESSAGES", label: "Send messages", help: "" },
      { key: "SEND_MESSAGES_IN_THREADS", label: "Send messages in threads", help: "" },
      { key: "CREATE_PUBLIC_THREADS", label: "Create public threads", help: "" },
      { key: "CREATE_PRIVATE_THREADS", label: "Create private threads", help: "" },
      { key: "EMBED_LINKS", label: "Embed links", help: "Links show previews." },
      { key: "ATTACH_FILES", label: "Attach files", help: "" },
      { key: "ADD_REACTIONS", label: "Add reactions", help: "" },
      { key: "USE_EXTERNAL_EMOJIS", label: "Use emoji from other servers", help: "" },
      { key: "MENTION_EVERYONE", label: "Mention @everyone, @here and all roles", help: "" },
      { key: "MANAGE_MESSAGES", label: "Manage messages", help: "Delete and pin other people's messages." },
      { key: "MANAGE_THREADS", label: "Manage threads", help: "" },
      { key: "READ_MESSAGE_HISTORY", label: "Read message history", help: "" },
      { key: "SEND_VOICE_MESSAGES", label: "Send voice messages", help: "" },
      { key: "SEND_POLLS", label: "Create polls", help: "" },
      { key: "USE_APPLICATION_COMMANDS", label: "Use app commands", help: "" },
      { key: "BYPASS_SLOWMODE", label: "Bypass slow mode", help: "" },
    ],
  },
  {
    group: "Voice & video",
    items: [
      { key: "CONNECT", label: "Connect", help: "Join voice channels." },
      { key: "SPEAK", label: "Speak", help: "" },
      { key: "VIDEO", label: "Video & screen share", help: "Turn on camera and share screens." },
      { key: "USE_VAD", label: "Use voice activity", help: "Without it, push-to-talk is required." },
      { key: "PRIORITY_SPEAKER", label: "Priority speaker", help: "" },
      { key: "USE_SOUNDBOARD", label: "Use soundboard", help: "" },
      { key: "MUTE_MEMBERS", label: "Mute members", help: "" },
      { key: "DEAFEN_MEMBERS", label: "Deafen members", help: "" },
      { key: "MOVE_MEMBERS", label: "Move members", help: "Move or disconnect members between voice channels." },
      { key: "REQUEST_TO_SPEAK", label: "Request to speak", help: "In stage channels." },
      { key: "MANAGE_EVENTS", label: "Manage events", help: "" },
    ],
  },
  {
    group: "Advanced",
    items: [{ key: "ADMINISTRATOR", label: "Administrator", help: "Every permission, in every channel. Grant carefully." }],
  },
];

/** Default permissions for @everyone in a new server. */
export const DEFAULT_EVERYONE =
  P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY | P.EMBED_LINKS | P.ATTACH_FILES | P.ADD_REACTIONS |
  P.CREATE_INVITE | P.CHANGE_NICKNAME | P.CONNECT | P.SPEAK | P.VIDEO | P.USE_VAD | P.USE_EXTERNAL_EMOJIS |
  P.SEND_MESSAGES_IN_THREADS | P.CREATE_PUBLIC_THREADS | P.CREATE_PRIVATE_THREADS | P.USE_SOUNDBOARD |
  P.REQUEST_TO_SPEAK | P.USE_APPLICATION_COMMANDS | P.SEND_VOICE_MESSAGES | P.SEND_POLLS;

/** Everything a direct message / group DM participant can do. */
export const DM_PERMISSIONS =
  P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY | P.EMBED_LINKS | P.ATTACH_FILES | P.ADD_REACTIONS |
  P.CONNECT | P.SPEAK | P.VIDEO | P.USE_VAD | P.USE_EXTERNAL_EMOJIS | P.SEND_VOICE_MESSAGES | P.SEND_POLLS |
  P.USE_SOUNDBOARD;

export const has = (perms: bigint, flag: bigint) => (perms & flag) === flag;

export interface RoleLike { id: string; permissions: string | bigint; position: number }
export interface OverwriteLike { target_id: string; target_type: 0 | 1; allow: string | bigint; deny: string | bigint }
export interface MemberLike { user_id: string; roles: string[]; communication_disabled_until?: string | null }
export interface GuildLike { id: string; owner_id: string }

const big = (v: string | bigint) => (typeof v === "bigint" ? v : BigInt(v));

export function basePermissions(guild: GuildLike, member: MemberLike, roles: RoleLike[]): bigint {
  if (member.user_id === guild.owner_id) return ALL_PERMISSIONS;
  const byId = new Map(roles.map((r) => [r.id, r]));
  let perms = big(byId.get(guild.id)?.permissions ?? 0n); // @everyone role shares the guild id
  for (const rid of member.roles) {
    const r = byId.get(rid);
    if (r) perms |= big(r.permissions);
  }
  if (has(perms, P.ADMINISTRATOR)) return ALL_PERMISSIONS;
  return perms;
}

export function channelPermissions(
  guild: GuildLike,
  member: MemberLike,
  roles: RoleLike[],
  overwrites: OverwriteLike[],
  now = Date.now(),
): bigint {
  const base = basePermissions(guild, member, roles);
  if (has(base, P.ADMINISTRATOR)) return ALL_PERMISSIONS;
  let perms = base;
  const everyone = overwrites.find((o) => o.target_type === 0 && o.target_id === guild.id);
  if (everyone) perms = (perms & ~big(everyone.deny)) | big(everyone.allow);
  let allow = 0n, deny = 0n;
  const mine = new Set(member.roles);
  for (const o of overwrites) {
    if (o.target_type === 0 && mine.has(o.target_id)) { allow |= big(o.allow); deny |= big(o.deny); }
  }
  perms = (perms & ~deny) | allow;
  const own = overwrites.find((o) => o.target_type === 1 && o.target_id === member.user_id);
  if (own) perms = (perms & ~big(own.deny)) | big(own.allow);
  if (!has(perms, P.VIEW_CHANNEL)) return 0n;
  if (member.communication_disabled_until && new Date(member.communication_disabled_until).getTime() > now) {
    perms &= P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
  }
  return perms;
}

/** Highest role position the member holds (@everyone is 0). */
export function topPosition(member: MemberLike, roles: RoleLike[]): number {
  const byId = new Map(roles.map((r) => [r.id, r]));
  return member.roles.reduce((m, id) => Math.max(m, byId.get(id)?.position ?? 0), 0);
}

/** Can `actor` act on `target` (kick, ban, timeout, edit roles)? Owner always wins; otherwise strictly higher top role. */
export function outranks(guild: GuildLike, actor: MemberLike, target: MemberLike, roles: RoleLike[]): boolean {
  if (target.user_id === guild.owner_id) return false;
  if (actor.user_id === guild.owner_id) return true;
  return topPosition(actor, roles) > topPosition(target, roles);
}

export const serializePerms = (p: bigint) => p.toString();
