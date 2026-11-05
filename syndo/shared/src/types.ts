import type { ProfileTheme } from "./theme.ts";
/** Wire types shared by the Syndo server and clients. IDs are decimal strings (64-bit, time-ordered). */

export const ChannelType = {
  TEXT: 0,
  DM: 1,
  VOICE: 2,
  GROUP_DM: 3,
  CATEGORY: 4,
  ANNOUNCEMENT: 5,
  PUBLIC_THREAD: 11,
  PRIVATE_THREAD: 12,
  STAGE: 13,
  FORUM: 15,
  MEDIA: 16,
} as const;
export type ChannelTypeId = (typeof ChannelType)[keyof typeof ChannelType];

export const isVoiceType = (t: number) => t === ChannelType.VOICE || t === ChannelType.STAGE;
export const isDmType = (t: number) => t === ChannelType.DM || t === ChannelType.GROUP_DM;
export const isTextLike = (t: number) =>
  t === ChannelType.TEXT || t === ChannelType.ANNOUNCEMENT || t === ChannelType.DM || t === ChannelType.GROUP_DM ||
  t === ChannelType.PUBLIC_THREAD || t === ChannelType.PRIVATE_THREAD || t === ChannelType.VOICE;

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

export interface User {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  banner: string | null;
  bio: string;
  pronouns: string;
  accent_color: string | null;
  profile_theme: ProfileTheme | null;
  bot?: boolean;
}


export interface SelfUser extends User {
  email: string;
  email_verified: boolean;
  mfa_enabled: boolean;
  status: PresenceStatus;
  custom_status: { text: string; emoji?: string | null; expires_at?: string | null } | null;
  privacy: PrivacySettings;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface PrivacySettings {
  /** Who may send me a friend request. */
  friend_requests: "everyone" | "friends_of_friends" | "server_members" | "nobody";
  /** Allow DMs from people I share a server with who are not my friends. */
  dms_from_server_members: boolean;
  /** Show mutual servers / friends on my profile to others. */
  show_mutuals: boolean;
}

export const DEFAULT_PRIVACY: PrivacySettings = { friend_requests: "everyone", dms_from_server_members: true, show_mutuals: true };

export const RelationshipType = { FRIEND: 1, BLOCKED: 2, INCOMING: 3, OUTGOING: 4 } as const;
export interface Relationship { id: string; type: 1 | 2 | 3 | 4; user: User; since: string }

export interface Role {
  id: string;
  guild_id: string;
  name: string;
  color: string | null;
  color2: string | null;
  permissions: string;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  icon: string | null;
}

export interface Overwrite { target_id: string; target_type: 0 | 1; allow: string; deny: string }

export interface Channel {
  id: string;
  type: number;
  guild_id: string | null;
  name: string | null;
  topic: string | null;
  position: number;
  parent_id: string | null;
  nsfw: boolean;
  rate_limit_per_user: number;
  bitrate: number;
  user_limit: number;
  permission_overwrites: Overwrite[];
  permission_synced: boolean;
  last_message_id: string | null;
  owner_id?: string | null;
  icon?: string | null;
  /** Banner art (categories show it instead of their name). */
  banner?: string | null;
  recipients?: User[];
  /** Computed for the requesting user (server-side); clients must not trust it for enforcement. */
  my_permissions?: string;
}

export interface Member {
  guild_id: string;
  user: User;
  nick: string | null;
  roles: string[];
  joined_at: string;
  communication_disabled_until: string | null;
  mute: boolean;
  deaf: boolean;
  guild_avatar: string | null;
  guild_bio: string | null;
  /** Server-specific public profile. null = uses the global value. */
  guild_banner?: string | null;
  guild_pronouns?: string | null;
  guild_profile_theme?: ProfileTheme | null;
  guild_status?: { text: string; emoji?: string | null } | null;
}

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  description: string | null;
  owner_id: string;
  system_channel_id: string | null;
  afk_channel_id: string | null;
  afk_timeout: number;
  vanity_code: string | null;
  tag: string | null;
  rules_channel_id: string | null;
  verification_level: number;
  discoverable: boolean;
  created_at: string;
  roles: Role[];
  channels: Channel[];
  /** Custom emoji uploaded to this server. */
  emojis?: Emoji[];
  /** Soundboard sounds uploaded to this server. */
  sounds?: SoundboardSound[];
  /** Stickers uploaded to this server. */
  stickers?: Sticker[];
  member_count: number;
  me: Member;
}

export interface Attachment {
  encryption?: { key: string; nonce: string };
  id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  waveform: string | null;
}

export interface Reaction { emoji: string; count: number; me: boolean }

export interface Message {
  id: string;
  channel_id: string;
  guild_id: string | null;
  author: User;
  member_nick?: string | null;
  /** Author's server profile in this server (null fields = global). */
  member?: { avatar: string | null; profile_theme: ProfileTheme | null } | null;
  content: string;
  _encrypted?: boolean;
  _encryptionError?: boolean;
  type: number;
  created_at: string;
  edited_at: string | null;
  pinned: boolean;
  reply_to: { id: string; author: User | null; content: string; deleted: boolean } | null;
  mentions: string[];
  mention_roles: string[];
  mention_everyone: boolean;
  attachments: Attachment[];
  reactions: Reaction[];
  nonce?: string | null;
  /** A sticker sent as (or with) this message. */
  stickers?: Sticker[];
}

export const MessageType = { DEFAULT: 0, REPLY: 19, MEMBER_JOIN: 7, CALL: 3, PINNED: 6, GROUP_RENAME: 4, RECIPIENT_ADD: 1, RECIPIENT_REMOVE: 2 } as const;

export interface ReadState { channel_id: string; last_read_id: string | null; mention_count: number }

export interface Invite {
  code: string;
  guild: { id: string; name: string; icon: string | null; banner: string | null; description: string | null; member_count: number };
  channel_id: string | null;
  inviter: User | null;
  uses: number;
  max_uses: number;
  expires_at: string | null;
  created_at: string;
}

export interface SessionInfo { id: string; current: boolean; created_at: string; last_used_at: string; ip: string | null; user_agent: string | null }

export interface VoiceState {
  user_id: string;
  channel_id: string;
  guild_id: string | null;
  self_mute: boolean;
  self_deaf: boolean;
  server_mute: boolean;
  server_deaf: boolean;
  self_video: boolean;
  self_stream: boolean;
}

/** Operator-configurable limits, published to clients so nothing is hidden. Same for every user — there are no tiers. */
export interface InstanceLimits {
  max_upload_bytes: number;
  max_message_length: number;
  max_guilds_per_user: number;
  max_members_per_guild: number;
  max_group_dm_recipients: number;
  max_emoji_per_guild: number;
  max_voice_bitrate_kbps: number;
  max_stream_height: number;
  max_stream_fps: number;
  max_stream_bitrate_kbps: number;
  media_enabled: boolean;
  gif_provider: string | null;
}

/** Gateway envelope. `s` is a per-connection sequence for gap detection. */
export interface GatewayFrame<T = unknown> { op: "dispatch" | "hello" | "heartbeat_ack" | "error"; t?: string; s?: number; d?: T }

export const MENTION_USER = /<@!?(\d{1,20})>/g;
export const MENTION_ROLE = /<@&(\d{1,20})>/g;
export const MENTION_CHANNEL = /<#(\d{1,20})>/g;

export interface Emoji { id: string; guild_id: string; name: string; animated: boolean; url: string; creator_id: string | null }
export interface SoundboardSound { id: string; guild_id: string; name: string; emoji: string | null; volume: number; url: string; duration_ms: number; creator_id: string | null }
/** `<:name:id>` / `<a:name:id>` in message text; reactions use "name:id". */
export const CUSTOM_EMOJI_RE = /<(a?):([A-Za-z0-9_]{2,32}):(\d{1,20})>/g;
export const emojiUrl = (id: string) => `/api/emojis/${id}`;
export interface Sticker { id: string; guild_id: string; name: string; description: string | null; tags: string | null; format: "png" | "apng" | "gif" | "webp"; url: string; creator_id: string | null }
export const stickerUrl = (id: string) => `/api/stickers/${id}`;
export const EXPRESSION_LIMITS = { emojis: 100, sounds: 48, stickers: 30, emojiBytes: 512 * 1024, soundBytes: 512 * 1024, stickerBytes: 512 * 1024, soundMs: 5200 } as const;
