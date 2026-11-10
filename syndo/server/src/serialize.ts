import { DEFAULT_PRIVACY, type Channel, type Role, type SelfUser, type User } from "@syndo/shared";

export const mediaUrl = (key: string | null | undefined) => (key ? `/api/media/${key}` : null);

/** Columns needed to build a public User; use with alias `u`. */
export const USER_COLS = `u.id, u.username, u.display_name, u.avatar_key, u.banner_key, u.bio, u.pronouns, u.accent_color, u.profile_theme, u.bot`;

export function userOut(r: any): User {
  return {
    id: r.id,
    username: r.username,
    display_name: r.display_name ?? null,
    avatar: mediaUrl(r.avatar_key),
    banner: mediaUrl(r.banner_key),
    bio: r.bio ?? "",
    pronouns: r.pronouns ?? "",
    accent_color: r.accent_color ?? null,
    profile_theme: r.profile_theme ?? null,
    bot: !!r.bot,
  };
}

/** A user embedded under a prefix, e.g. author_id/author_username… from a join. */
export function prefixedUser(r: any, p: string): User | null {
  if (!r[`${p}id`]) return null;
  return userOut({
    id: r[`${p}id`], username: r[`${p}username`], display_name: r[`${p}display_name`], avatar_key: r[`${p}avatar_key`],
    banner_key: r[`${p}banner_key`], bio: r[`${p}bio`], pronouns: r[`${p}pronouns`], accent_color: r[`${p}accent_color`],
    profile_theme: r[`${p}profile_theme`], bot: r[`${p}bot`],
  });
}
export const prefixedCols = (alias: string, p: string) =>
  ["id", "username", "display_name", "avatar_key", "banner_key", "bio", "pronouns", "accent_color", "profile_theme", "bot"]
    .map((c) => `${alias}.${c} as ${p}${c}`).join(", ");

export function selfOut(r: any): SelfUser {
  return {
    ...userOut(r),
    email: r.email,
    email_verified: !!r.email_verified_at,
    mfa_enabled: !!r.mfa_enabled,
    status: r.status,
    custom_status: r.custom_status ?? null,
    privacy: { ...DEFAULT_PRIVACY, ...(r.privacy ?? {}) },
    settings: r.settings ?? {},
    created_at: r.created_at,
    locale: r.locale ?? "en",
    staff: !!r.staff,
  };
}

export function roleOut(r: any): Role {
  return {
    id: r.id, guild_id: r.guild_id, name: r.name, color: r.color, color2: r.color2, permissions: String(r.permissions),
    position: r.position, hoist: r.hoist, mentionable: r.mentionable, icon: mediaUrl(r.icon_key),
  };
}

export function channelOut(r: any, overwrites: any[] = [], extra: Partial<Channel> = {}): Channel {
  return {
    id: r.id, type: r.type, guild_id: r.guild_id, name: r.name, topic: r.topic, position: r.position, parent_id: r.parent_id,
    nsfw: r.nsfw, rate_limit_per_user: r.rate_limit_per_user, bitrate: r.bitrate, user_limit: r.user_limit,
    permission_synced: r.permission_synced, last_message_id: r.last_message_id, owner_id: r.owner_id ?? null,
    icon: mediaUrl(r.icon_key),
    banner: mediaUrl(r.banner_key),
    icon_emoji: r.icon_emoji ?? null,
    ...(r.type === 11 || r.type === 12 ? { thread: {
      archived: !!r.archived, locked: !!r.locked, invitable: r.invitable !== false, auto_archive_minutes: r.auto_archive_minutes ?? 4320,
      archived_at: r.archived_at ?? null, last_activity_at: r.last_activity_at ?? null, message_count: r.message_count ?? 0,
      applied_tags: (r.applied_tags ?? []).map(String), member_count: r.member_count ?? undefined, me: r.me ?? undefined,
    } } : {}),
    ...(r.type === 15 || r.type === 16 ? { available_tags: r.available_tags ?? [], default_sort: r.default_sort ?? 0, default_layout: r.default_layout ?? 0, default_reaction: r.default_reaction ?? null, require_tag: !!r.require_tag } : {}),
    ...(r.type === 2 || r.type === 13 ? { voice_status: r.voice_status ?? null } : {}),
    permission_overwrites: overwrites.map((o) => ({ target_id: String(o.target_id), target_type: o.target_type, allow: String(o.allow), deny: String(o.deny) })),
    ...extra,
  };
}
