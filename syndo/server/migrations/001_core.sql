-- Syndo core schema: accounts, sessions, relationships, servers, roles,
-- channels, overwrites, messages, attachments, reactions, read state,
-- invites, bans, audit log. IDs are 64-bit time-ordered integers generated
-- by the application (see src/ids.ts).

create extension if not exists citext;

create table users (
  id bigint primary key,
  username citext not null unique check (username ~ '^[a-z0-9_.]{2,32}$'),
  email citext unique,
  email_verified_at timestamptz,
  password_hash text,
  display_name text check (char_length(display_name) <= 32),
  avatar_key text,
  banner_key text,
  bio text not null default '' check (char_length(bio) <= 400),
  pronouns text not null default '' check (char_length(pronouns) <= 40),
  accent_color text check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  profile_theme jsonb,
  status text not null default 'online' check (status in ('online','idle','dnd','invisible')),
  custom_status jsonb,
  privacy jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  mfa_secret text,
  mfa_enabled boolean not null default false,
  bot boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table sessions (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text,
  mfa_pending boolean not null default false,
  revoked_at timestamptz
);
create index sessions_user on sessions(user_id) where revoked_at is null;

create table email_tokens (
  token_hash bytea primary key,
  user_id bigint not null references users(id) on delete cascade,
  kind text not null check (kind in ('verify','reset')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table mfa_recovery_codes (
  user_id bigint not null references users(id) on delete cascade,
  code_hash bytea not null,
  used_at timestamptz,
  primary key (user_id, code_hash)
);

-- Development / test outbox. Every email is recorded here; in production a
-- transport also delivers it. Rows older than 7 days are purged by the job runner.
create table mail_outbox (
  id bigserial primary key,
  to_address text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);

-- One row per direction. type: 1 friend, 2 blocked, 3 incoming request, 4 outgoing request.
create table relationships (
  user_id bigint not null references users(id) on delete cascade,
  other_id bigint not null references users(id) on delete cascade,
  type smallint not null check (type in (1,2,3,4)),
  created_at timestamptz not null default now(),
  primary key (user_id, other_id),
  check (user_id <> other_id)
);
create index relationships_other on relationships(other_id);

create table guilds (
  id bigint primary key,
  name text not null check (char_length(name) between 2 and 100),
  icon_key text,
  banner_key text,
  description text check (char_length(description) <= 300),
  owner_id bigint not null references users(id),
  system_channel_id bigint,
  afk_channel_id bigint,
  afk_timeout int not null default 300 check (afk_timeout between 60 and 3600),
  rules_channel_id bigint,
  vanity_code citext unique check (vanity_code ~ '^[a-z0-9-]{3,32}$'),
  tag text check (tag ~ '^[A-Za-z0-9]{2,4}$'),
  verification_level smallint not null default 0 check (verification_level between 0 and 4),
  discoverable boolean not null default false,
  created_at timestamptz not null default now()
);

create table roles (
  id bigint primary key,
  guild_id bigint not null references guilds(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  color2 text check (color2 ~ '^#[0-9a-fA-F]{6}$'),
  permissions bigint not null default 0,
  position int not null default 0,
  hoist boolean not null default false,
  mentionable boolean not null default false,
  icon_key text,
  created_at timestamptz not null default now()
);
create index roles_guild on roles(guild_id);

create table members (
  guild_id bigint not null references guilds(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  nick text check (char_length(nick) <= 32),
  joined_at timestamptz not null default now(),
  communication_disabled_until timestamptz,
  mute boolean not null default false,
  deaf boolean not null default false,
  avatar_key text,
  bio text check (char_length(bio) <= 400),
  primary key (guild_id, user_id)
);
create index members_user on members(user_id);

create table member_roles (
  guild_id bigint not null,
  user_id bigint not null,
  role_id bigint not null references roles(id) on delete cascade,
  primary key (guild_id, user_id, role_id),
  foreign key (guild_id, user_id) references members(guild_id, user_id) on delete cascade
);

create table bans (
  guild_id bigint not null references guilds(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  reason text,
  moderator_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create table channels (
  id bigint primary key,
  guild_id bigint references guilds(id) on delete cascade,
  type smallint not null,
  name text check (char_length(name) <= 100),
  topic text check (char_length(topic) <= 1024),
  position int not null default 0,
  parent_id bigint references channels(id) on delete set null,
  nsfw boolean not null default false,
  rate_limit_per_user int not null default 0 check (rate_limit_per_user between 0 and 21600),
  bitrate int not null default 96000,
  user_limit int not null default 0 check (user_limit between 0 and 99),
  owner_id bigint references users(id) on delete set null,
  icon_key text,
  permission_synced boolean not null default true,
  last_message_id bigint,
  created_at timestamptz not null default now()
);
create index channels_guild on channels(guild_id);

-- Participants of DMs and group DMs.
create table channel_recipients (
  channel_id bigint not null references channels(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_recipients_user on channel_recipients(user_id);
-- At most one 1:1 DM per pair, keyed by the ordered pair.
create table dm_pairs (
  low_id bigint not null references users(id) on delete cascade,
  high_id bigint not null references users(id) on delete cascade,
  channel_id bigint not null references channels(id) on delete cascade,
  primary key (low_id, high_id),
  check (low_id < high_id)
);

create table permission_overwrites (
  channel_id bigint not null references channels(id) on delete cascade,
  target_id bigint not null,
  target_type smallint not null check (target_type in (0,1)),
  allow bigint not null default 0,
  deny bigint not null default 0,
  primary key (channel_id, target_id)
);

create table messages (
  id bigint primary key,
  channel_id bigint not null references channels(id) on delete cascade,
  guild_id bigint references guilds(id) on delete cascade,
  author_id bigint references users(id) on delete set null,
  content text not null default '',
  type smallint not null default 0,
  reply_to_id bigint,
  edited_at timestamptz,
  deleted_at timestamptz,
  pinned boolean not null default false,
  nonce text,
  mention_everyone boolean not null default false,
  mentions bigint[] not null default '{}',
  mention_roles bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  tsv tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored
);
create index messages_channel on messages(channel_id, id desc) where deleted_at is null;
create index messages_tsv on messages using gin(tsv);
create index messages_author on messages(author_id);
create index messages_channel_author on messages(channel_id, author_id, id desc);
create unique index messages_nonce on messages(author_id, channel_id, nonce) where nonce is not null;

create table attachments (
  id bigint primary key,
  message_id bigint references messages(id) on delete cascade,
  channel_id bigint not null references channels(id) on delete cascade,
  uploader_id bigint references users(id) on delete set null,
  filename text not null,
  content_type text not null,
  size bigint not null,
  storage_key text not null,
  width int,
  height int,
  duration real,
  waveform text,
  created_at timestamptz not null default now()
);
create index attachments_message on attachments(message_id);
create index attachments_pending on attachments(created_at) where message_id is null;

create table reactions (
  message_id bigint not null references messages(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 64),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table read_states (
  user_id bigint not null references users(id) on delete cascade,
  channel_id bigint not null references channels(id) on delete cascade,
  last_read_id bigint,
  mention_count int not null default 0,
  primary key (user_id, channel_id)
);

create table saved_messages (
  user_id bigint not null references users(id) on delete cascade,
  message_id bigint not null references messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create table invites (
  code text primary key check (code ~ '^[A-Za-z0-9]{6,16}$'),
  guild_id bigint not null references guilds(id) on delete cascade,
  channel_id bigint references channels(id) on delete set null,
  inviter_id bigint references users(id) on delete set null,
  max_uses int not null default 0,
  uses int not null default 0,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_guild on invites(guild_id);

create table audit_log (
  id bigint primary key,
  guild_id bigint not null references guilds(id) on delete cascade,
  user_id bigint references users(id) on delete set null,
  action text not null,
  target_id bigint,
  changes jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index audit_log_guild on audit_log(guild_id, id desc);

-- Simple durable job queue (claimed with SKIP LOCKED).
create table jobs (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  locked_until timestamptz,
  last_error text,
  done_at timestamptz
);
create index jobs_ready on jobs(run_at) where done_at is null;
