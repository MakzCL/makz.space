import type { InstanceLimits } from "@syndo/shared";

const env = process.env;
const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);

/**
 * Every operator-tunable value lives here. Limits are identical for every
 * account — there are no tiers — and are published to clients via READY and
 * GET /api/instance so users can see them.
 */
export const config = {
  port: int(env.PORT, 3900),
  host: env.HOST ?? "0.0.0.0",
  /** Public origin of the web client (used in emails and the Origin check). */
  publicUrl: (env.SYNDO_PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, ""),
  /** Extra allowed origins (comma separated), e.g. a desktop shell. */
  extraOrigins: (env.SYNDO_EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  databaseUrl: env.DATABASE_URL ?? "postgres://syndo:syndo@localhost:5432/syndo",
  storageDir: env.SYNDO_STORAGE_DIR ?? new URL("../../data/storage", import.meta.url).pathname,
  storageOrigin: env.SYNDO_STORAGE_ORIGIN ?? null,
  storageToken: env.SYNDO_STORAGE_TOKEN ?? null,
  cookieSecure: env.SYNDO_COOKIE_SECURE === "1",
  sessionDays: int(env.SYNDO_SESSION_DAYS, 30),
  /** Require a verified email before sending messages / joining servers. */
  requireVerifiedEmail: false,
  requireDmE2ee: env.SYNDO_REQUIRE_DM_E2EE === "1" || env.NODE_ENV === "production",
  /** Expose GET /api/dev/mail (the outbox) — only for local development and tests. */
  devMail: env.SYNDO_DEV_MAIL === "1",
  smtp: env.SMTP_URL ?? null,
  mailFrom: env.SYNDO_MAIL_FROM ?? "SEND <no-reply@syndo.local>",
  sfu: { appId: env.SYNDO_SFU_APP_ID ?? null, secret: env.SYNDO_SFU_SECRET ?? null, turnKeyId: env.SYNDO_TURN_KEY_ID ?? null, turnKeyToken: env.SYNDO_TURN_KEY_TOKEN ?? null },
  livekit: {
    url: env.LIVEKIT_URL ?? null, // wss://media.example.com
    apiKey: env.LIVEKIT_API_KEY ?? null,
    apiSecret: env.LIVEKIT_API_SECRET ?? null,
  },
  gifProvider: env.SYNDO_GIF_PROVIDER ?? null,
  limits: {
    max_upload_bytes: int(env.SYNDO_MAX_UPLOAD_MB, 100) * 1024 * 1024,
    max_message_length: int(env.SYNDO_MAX_MESSAGE_LENGTH, 4000),
    max_guilds_per_user: int(env.SYNDO_MAX_GUILDS_PER_USER, 200),
    max_members_per_guild: int(env.SYNDO_MAX_MEMBERS_PER_GUILD, 25000),
    max_group_dm_recipients: int(env.SYNDO_MAX_GROUP_DM, 10),
    max_emoji_per_guild: int(env.SYNDO_MAX_EMOJI, 250),
    max_voice_bitrate_kbps: int(env.SYNDO_MAX_VOICE_KBPS, 510),
    max_stream_height: int(env.SYNDO_MAX_STREAM_HEIGHT, 2160),
    max_stream_fps: int(env.SYNDO_MAX_STREAM_FPS, 60),
    max_stream_bitrate_kbps: int(env.SYNDO_MAX_STREAM_KBPS, 20000),
    media_enabled: false,
    gif_provider: null,
  } satisfies InstanceLimits as InstanceLimits,
  maxAvatarBytes: int(env.SYNDO_MAX_AVATAR_MB, 10) * 1024 * 1024,
};
config.limits.media_enabled = !!(config.sfu.appId && config.sfu.secret) || !!(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret);
config.limits.gif_provider = config.gifProvider;

export const allowedOrigins = () => new Set([config.publicUrl, ...config.extraOrigins]);
