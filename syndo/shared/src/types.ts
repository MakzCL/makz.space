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
  /** Boosting (any active boost subscription). */
  premium?: boolean;
  /** Staff of this SEND instance. */
  staff?: boolean;
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
  locale?: string;
  has_passkey?: boolean;
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
  /** Emoji shown instead of the # / speaker icon (unicode, or "<:name:id>"). */
  icon_emoji?: string | null;
  recipients?: User[];
  /** Threads: archived/locked state, message count, applied forum tags. */
  thread?: ThreadMeta | null;
  /** Forum/media channels: tags and defaults. */
  available_tags?: ForumTag[];
  default_sort?: 0 | 1;
  default_layout?: 0 | 1 | 2;
  default_reaction?: string | null;
  require_tag?: boolean;
  /** Voice channels: the short status line shown under the channel. */
  voice_status?: string | null;
  /** Computed for the requesting user (server-side); clients must not trust it for enforcement. */
  my_permissions?: string;
}

export interface ThreadMeta { archived: boolean; locked: boolean; invitable: boolean; auto_archive_minutes: number; archived_at: string | null; last_activity_at: string | null; message_count: number; member_count?: number; applied_tags: string[]; me?: boolean; starter?: Message | null }
export interface ForumTag { id: string; name: string; emoji: string | null; moderated: boolean }

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
  /** Hasn't finished rules screening / onboarding yet. */
  pending?: boolean;
  /** Boosting this server since. */
  premium_since?: string | null;
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
  /** Boost level 0–3 and number of boosts. */
  premium_tier?: number;
  premium_count?: number;
  discovery_category?: string | null;
  discovery_keywords?: string[];
  /** Stage instances currently live in this server. */
  stage_instances?: StageInstance[];
}

export interface StageInstance { channel_id: string; guild_id: string; topic: string; started_by: string | null; created_at: string }

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
  /** 1 published, 2 is a crosspost, 4 embeds suppressed, 32 has thread, 4096 silent. */
  flags?: number;
  embeds?: Embed[];
  poll?: Poll | null;
  /** A forwarded message (copy at the time of forwarding). */
  snapshot?: MessageSnapshot | null;
  /** Crossposts: where the message was published from. */
  source?: { guild_id: string; guild_name: string; channel_id: string; channel_name: string; message_id: string } | null;
  /** Thread started from this message. */
  thread?: { id: string; name: string; message_count: number; last_activity_at: string | null; archived: boolean } | null;
  webhook_id?: string | null;
  application_id?: string | null;
  /** Slash command that produced this message. */
  interaction?: { name: string; user: User } | null;
  components?: MessageComponent[];
  /** false when the reply didn't ping the replied-to author. */
  mention_author?: boolean;
}

export const MessageFlags = { CROSSPOSTED: 1, IS_CROSSPOST: 2, SUPPRESS_EMBEDS: 4, HAS_THREAD: 32, SILENT: 4096 } as const;

export interface Embed {
  type: "link" | "video" | "image" | "rich" | "gifv";
  url?: string | null;
  title?: string | null;
  description?: string | null;
  site_name?: string | null;
  color?: string | null;
  author?: { name: string; url?: string | null; icon_url?: string | null } | null;
  thumbnail?: { url: string; width?: number | null; height?: number | null } | null;
  image?: { url: string; width?: number | null; height?: number | null } | null;
  video?: { url: string; width?: number | null; height?: number | null; embed?: string | null } | null;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string; icon_url?: string | null } | null;
  timestamp?: string | null;
}

export interface Poll {
  question: string;
  answers: { id: number; text: string; emoji: string | null; votes: number; me: boolean }[];
  allow_multiselect: boolean;
  expires_at: string;
  finalized: boolean;
  total_votes: number;
}

export interface MessageSnapshot { content: string; attachments: Attachment[]; embeds: Embed[]; stickers: Sticker[]; created_at: string; edited_at: string | null; origin: { guild_id: string | null; channel_id: string; message_id: string; channel_name: string | null } }

export interface MessageComponent { type: 1 | 2 | 3; components?: MessageComponent[]; style?: 1 | 2 | 3 | 4 | 5; label?: string; emoji?: string | null; custom_id?: string; url?: string; disabled?: boolean; placeholder?: string; options?: { label: string; value: string; description?: string | null; emoji?: string | null }[]; min_values?: number; max_values?: number }

export interface GuildEvent {
  id: string; guild_id: string; channel_id: string | null; creator: User | null; name: string; description: string | null;
  entity_type: 1 | 2 | 3; location: string | null; start_at: string; end_at: string | null; status: 1 | 2 | 3 | 4;
  image: string | null; recurrence: string | null; user_count: number; me: boolean; created_at: string;
}
export const EventStatus = { SCHEDULED: 1, ACTIVE: 2, COMPLETED: 3, CANCELED: 4 } as const;

export interface AutomodRule {
  id: string; guild_id: string; name: string; enabled: boolean; trigger_type: 1 | 3 | 4 | 5 | 6;
  trigger_meta: { keywords?: string[]; regex?: string[]; allow?: string[]; presets?: ("profanity" | "sexual" | "slurs")[]; mention_limit?: number; raid_protection?: boolean };
  actions: { type: 1 | 2 | 3; channel_id?: string; duration_seconds?: number; message?: string }[];
  exempt_roles: string[]; exempt_channels: string[];
}

export interface Onboarding {
  enabled: boolean;
  default_channel_ids: string[];
  prompts: { id: string; title: string; single_select: boolean; required: boolean; options: { id: string; title: string; description: string | null; emoji: string | null; role_ids: string[]; channel_ids: string[] }[] }[];
  welcome: { description: string; channels: { channel_id: string; description: string; emoji: string | null }[] } | null;
  screening: { enabled: boolean; description: string; rules: string[] } | null;
}

export interface Application {
  id: string; name: string; description: string; icon: string | null; bot: User | null; owner_id: string;
  public: boolean; listed: boolean; interactions_url: string | null; tags: string[]; install_count: number; activity_url: string | null;
}
export interface ApplicationCommand {
  id: string; application_id: string; guild_id: string | null; type: 1 | 2 | 3; name: string; description: string;
  options: CommandOption[]; default_member_permissions: string | null; dm_permission: boolean; app?: { id: string; name: string; icon: string | null };
}
export interface CommandOption { type: number; name: string; description: string; required?: boolean; choices?: { name: string; value: string | number }[]; options?: CommandOption[]; min_value?: number; max_value?: number; autocomplete?: boolean }
export const CommandOptionType = { SUB_COMMAND: 1, SUB_COMMAND_GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 } as const;

export interface Webhook { id: string; guild_id: string | null; channel_id: string; name: string; avatar: string | null; type: 1 | 2 | 3; creator: User | null; url?: string; source_channel?: { id: string; name: string; guild_name: string } | null; created_at: string }

export interface NotificationSetting { scope_id: string; scope_kind: 0 | 1 | 2; level: 0 | 1 | 2 | null; muted: boolean; muted_until: string | null; suppress_everyone: boolean; suppress_roles: boolean; hide_muted: boolean; mobile_push: boolean }

export interface Connection { type: string; id: string; name: string; verified: boolean; visible: boolean; show_activity: boolean; url?: string | null }
export interface Activity { type: 0 | 1 | 2 | 3 | 5; name: string; details?: string | null; state?: string | null; started_at?: number | null; url?: string | null; application_id?: string | null }

/** Server boost levels: boosts needed and what each level unlocks. */
export const BOOST_LEVELS = [
  { level: 0, boosts: 0, upload_mb: 25, emoji: 100, stickers: 30, sounds: 48, bitrate_kbps: 96, stream: "720p30", animated_icon: false, banner: false, vanity: false, role_icons: false },
  { level: 1, boosts: 2, upload_mb: 50, emoji: 150, stickers: 45, sounds: 60, bitrate_kbps: 128, stream: "1080p60", animated_icon: true, banner: false, vanity: false, role_icons: false },
  { level: 2, boosts: 7, upload_mb: 100, emoji: 200, stickers: 60, sounds: 72, bitrate_kbps: 256, stream: "1440p60", animated_icon: true, banner: true, vanity: false, role_icons: true },
  { level: 3, boosts: 14, upload_mb: 250, emoji: 250, stickers: 90, sounds: 96, bitrate_kbps: 384, stream: "4K60", animated_icon: true, banner: true, vanity: true, role_icons: true },
] as const;
export const boostLevelFor = (count: number) => [...BOOST_LEVELS].reverse().find((l) => count >= l.boosts)!.level;

export const MessageType = {
  DEFAULT: 0, RECIPIENT_ADD: 1, RECIPIENT_REMOVE: 2, CALL: 3, GROUP_RENAME: 4, PINNED: 6, MEMBER_JOIN: 7, BOOST: 8, BOOST_TIER: 9,
  CHANNEL_FOLLOW_ADD: 12, THREAD_CREATED: 18, REPLY: 19, CHAT_INPUT_COMMAND: 20, THREAD_STARTER: 21, AUTOMOD_ACTION: 24,
  STAGE_START: 27, STAGE_END: 28, STAGE_SPEAKER: 29, STAGE_TOPIC: 31, POLL_RESULT: 46,
} as const;

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
  /** Stage: in the audience (true) or a speaker (false); when they asked to speak. */
  suppress?: boolean;
  request_to_speak_at?: string | null;
  /** Watching / playing an activity in this channel. */
  activity_id?: string | null;
  /** Who it is (so clients can show the name/picture without loading the member list). */
  user?: User | null;
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
