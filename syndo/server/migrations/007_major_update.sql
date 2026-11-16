-- SEND major update: threads & forums, stage, announcement follows, polls, link previews, forwards,
-- events, AutoMod, onboarding, insights, webhooks, apps/bots/commands, boosts, connections,
-- push, passkeys, QR login, notification settings, voice channel status, languages.

/* ------------------------------------------------------- channels -- */
alter table channels
  add column if not exists archived boolean not null default false,
  add column if not exists locked boolean not null default false,
  add column if not exists invitable boolean not null default true,
  add column if not exists auto_archive_minutes int not null default 4320 check (auto_archive_minutes in (60, 1440, 4320, 10080)),
  add column if not exists archived_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists message_count int not null default 0,
  add column if not exists applied_tags bigint[] not null default '{}',
  add column if not exists available_tags jsonb not null default '[]',
  add column if not exists default_sort smallint not null default 0 check (default_sort in (0, 1)),
  add column if not exists default_layout smallint not null default 0 check (default_layout in (0, 1, 2)),
  add column if not exists default_reaction text check (default_reaction is null or char_length(default_reaction) <= 64),
  add column if not exists require_tag boolean not null default false,
  add column if not exists voice_status text check (voice_status is null or char_length(voice_status) <= 500);
create index if not exists channels_parent on channels(parent_id) where parent_id is not null;

create table if not exists thread_members (
  channel_id bigint not null references channels(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index if not exists thread_members_user on thread_members(user_id);

create table if not exists stage_instances (
  channel_id bigint primary key references channels(id) on delete cascade,
  guild_id bigint not null references guilds(id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 120),
  started_by bigint references users(id) on delete set null,
  event_id bigint,
  created_at timestamptz not null default now()
);

create table if not exists channel_follows (
  source_channel_id bigint not null references channels(id) on delete cascade,
  target_channel_id bigint not null references channels(id) on delete cascade,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (source_channel_id, target_channel_id)
);
create index if not exists channel_follows_target on channel_follows(target_channel_id);

/* ------------------------------------------------------- messages -- */
-- flags: 1 published (crossposted), 2 is a crosspost, 4 embeds suppressed, 32 has thread, 4096 silent
alter table messages
  add column if not exists flags int not null default 0,
  add column if not exists embeds jsonb,
  add column if not exists snapshot jsonb,
  add column if not exists source jsonb,
  add column if not exists thread_id bigint,
  add column if not exists webhook_id bigint,
  add column if not exists webhook_name text check (webhook_name is null or char_length(webhook_name) <= 80),
  add column if not exists webhook_avatar text,
  add column if not exists application_id bigint,
  add column if not exists interaction jsonb,
  add column if not exists components jsonb,
  add column if not exists mention_author boolean not null default true;

create table if not exists polls (
  message_id bigint primary key references messages(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 300),
  answers jsonb not null,
  allow_multiselect boolean not null default false,
  expires_at timestamptz not null,
  finalized boolean not null default false
);
create index if not exists polls_open on polls(expires_at) where not finalized;
create table if not exists poll_votes (
  message_id bigint not null references polls(message_id) on delete cascade,
  answer_id smallint not null,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, answer_id, user_id)
);

create table if not exists link_previews (
  url text primary key,
  data jsonb,
  fetched_at timestamptz not null default now()
);

/* --------------------------------------------------------- guilds -- */
alter table guilds
  add column if not exists premium_tier smallint not null default 0,
  add column if not exists premium_count int not null default 0,
  add column if not exists discovery_category text,
  add column if not exists discovery_keywords text[] not null default '{}',
  add column if not exists locale text not null default 'en',
  add column if not exists splash_key text;

create table if not exists guild_events (
  id bigint primary key,
  guild_id bigint not null references guilds(id) on delete cascade,
  channel_id bigint references channels(id) on delete set null,
  creator_id bigint references users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  entity_type smallint not null check (entity_type in (1, 2, 3)),
  location text check (location is null or char_length(location) <= 100),
  start_at timestamptz not null,
  end_at timestamptz,
  status smallint not null default 1 check (status in (1, 2, 3, 4)),
  image_key text,
  recurrence text check (recurrence is null or recurrence in ('daily', 'weekly', 'biweekly', 'monthly', 'yearly')),
  created_at timestamptz not null default now()
);
create index if not exists guild_events_guild on guild_events(guild_id, start_at);
create table if not exists guild_event_users (
  event_id bigint not null references guild_events(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- trigger_type: 1 keyword, 3 spam, 4 keyword preset, 5 mention spam, 6 member profile
create table if not exists automod_rules (
  id bigint primary key,
  guild_id bigint not null references guilds(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  enabled boolean not null default true,
  trigger_type smallint not null check (trigger_type in (1, 3, 4, 5, 6)),
  trigger_meta jsonb not null default '{}',
  actions jsonb not null default '[]',
  exempt_roles bigint[] not null default '{}',
  exempt_channels bigint[] not null default '{}',
  creator_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists automod_rules_guild on automod_rules(guild_id);

create table if not exists guild_onboarding (
  guild_id bigint primary key references guilds(id) on delete cascade,
  enabled boolean not null default false,
  default_channel_ids bigint[] not null default '{}',
  prompts jsonb not null default '[]',
  welcome jsonb,
  screening jsonb,
  updated_at timestamptz not null default now()
);
alter table members
  add column if not exists pending boolean not null default false,
  add column if not exists onboarded_at timestamptz,
  add column if not exists premium_since timestamptz;

create table if not exists guild_daily_stats (
  guild_id bigint not null references guilds(id) on delete cascade,
  day date not null,
  messages int not null default 0,
  joins int not null default 0,
  leaves int not null default 0,
  voice_minutes int not null default 0,
  primary key (guild_id, day)
);
create table if not exists guild_daily_active (
  guild_id bigint not null references guilds(id) on delete cascade,
  day date not null,
  user_id bigint not null,
  communicated boolean not null default false,
  primary key (guild_id, day, user_id)
);

/* ------------------------------------------------ apps & webhooks -- */
create table if not exists applications (
  id bigint primary key,
  owner_id bigint not null references users(id) on delete cascade,
  bot_user_id bigint unique references users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 32),
  description text not null default '' check (char_length(description) <= 400),
  icon_key text,
  public boolean not null default true,
  listed boolean not null default false,
  interactions_url text check (interactions_url is null or char_length(interactions_url) <= 500),
  interaction_secret text not null,
  tags text[] not null default '{}',
  install_count int not null default 0,
  activity_url text check (activity_url is null or char_length(activity_url) <= 500),
  created_at timestamptz not null default now()
);
create table if not exists application_commands (
  id bigint primary key,
  application_id bigint not null references applications(id) on delete cascade,
  guild_id bigint references guilds(id) on delete cascade,
  type smallint not null default 1 check (type in (1, 2, 3)),
  name text not null check (char_length(name) between 1 and 32),
  description text not null default '' check (char_length(description) <= 100),
  options jsonb not null default '[]',
  default_member_permissions bigint,
  dm_permission boolean not null default true,
  nsfw boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists application_commands_unique on application_commands(application_id, coalesce(guild_id, 0), type, name);
create table if not exists interactions (
  id bigint primary key,
  application_id bigint not null references applications(id) on delete cascade,
  type smallint not null,
  guild_id bigint,
  channel_id bigint,
  user_id bigint not null,
  data jsonb not null default '{}',
  token_hash bytea not null unique,
  responded boolean not null default false,
  message_id bigint,
  created_at timestamptz not null default now()
);

-- type: 1 incoming, 2 channel follower, 3 application
create table if not exists webhooks (
  id bigint primary key,
  guild_id bigint references guilds(id) on delete cascade,
  channel_id bigint not null references channels(id) on delete cascade,
  creator_id bigint references users(id) on delete set null,
  application_id bigint references applications(id) on delete cascade,
  type smallint not null default 1 check (type in (1, 2, 3)),
  name text not null check (char_length(name) between 1 and 80),
  avatar_key text,
  token_hash bytea,
  source_channel_id bigint references channels(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists webhooks_channel on webhooks(channel_id);

/* --------------------------------------------------------- boosts -- */
alter table users
  add column if not exists staff boolean not null default false,
  add column if not exists locale text not null default 'en' check (char_length(locale) <= 10);

-- provider: stripe (paid), grant (given by staff), code (redeemed code)
create table if not exists premium_subscriptions (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'grant', 'code')),
  provider_ref text,
  slots int not null default 2 check (slots between 1 and 100),
  status text not null default 'active' check (status in ('active', 'canceled', 'past_due', 'pending')),
  current_period_end timestamptz,
  granted_by bigint references users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists premium_subscriptions_user on premium_subscriptions(user_id);
create unique index if not exists premium_subscriptions_ref on premium_subscriptions(provider, provider_ref) where provider_ref is not null;

create table if not exists guild_boosts (
  id bigint primary key,
  subscription_id bigint not null references premium_subscriptions(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  guild_id bigint references guilds(id) on delete set null,
  applied_at timestamptz,
  cooldown_until timestamptz
);
create index if not exists guild_boosts_guild on guild_boosts(guild_id) where guild_id is not null;

-- kind: free (no payment, boosts for duration_days or forever), discount (percent off checkout)
create table if not exists premium_codes (
  code citext primary key check (code ~ '^[A-Za-z0-9-]{4,40}$'),
  kind text not null check (kind in ('free', 'discount')),
  percent_off int check (percent_off is null or percent_off between 1 and 100),
  slots int not null default 2 check (slots between 1 and 100),
  duration_days int check (duration_days is null or duration_days between 1 and 3650),
  max_uses int not null default 1 check (max_uses between 0 and 100000),
  uses int not null default 0,
  note text,
  created_by bigint references users(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists premium_code_redemptions (
  code citext not null references premium_codes(code) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (code, user_id)
);

/* ------------------------------------------- profile & presence -- */
create table if not exists user_connections (
  user_id bigint not null references users(id) on delete cascade,
  type text not null check (type ~ '^[a-z]{2,20}$'),
  external_id text not null check (char_length(external_id) <= 100),
  name text not null check (char_length(name) <= 100),
  verified boolean not null default true,
  visible boolean not null default true,
  show_activity boolean not null default true,
  metadata jsonb not null default '{}',
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, type, external_id)
);

/* -------------------------------------------------- notifications -- */
-- scope_kind: 0 server, 1 channel, 2 direct messages (scope_id 0)
-- level: 0 all messages, 1 only @mentions, 2 nothing, null inherit
create table if not exists notification_settings (
  user_id bigint not null references users(id) on delete cascade,
  scope_id bigint not null,
  scope_kind smallint not null check (scope_kind in (0, 1, 2)),
  level smallint check (level is null or level in (0, 1, 2)),
  muted boolean not null default false,
  muted_until timestamptz,
  suppress_everyone boolean not null default false,
  suppress_roles boolean not null default false,
  hide_muted boolean not null default false,
  mobile_push boolean not null default true,
  primary key (user_id, scope_id)
);

create table if not exists push_subscriptions (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user on push_subscriptions(user_id);

/* -------------------------------------------------------- sign-in -- */
create table if not exists passkeys (
  id text primary key check (char_length(id) <= 400),
  user_id bigint not null references users(id) on delete cascade,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  name text not null default 'Passkey' check (char_length(name) <= 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists passkeys_user on passkeys(user_id);
create table if not exists auth_challenges (
  id text primary key,
  user_id bigint references users(id) on delete cascade,
  kind text not null check (kind in ('passkey_register', 'passkey_login', 'qr_login')),
  challenge text not null,
  status text not null default 'pending' check (status in ('pending', 'scanned', 'approved', 'cancelled', 'used')),
  data jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'syndo_runtime') then
    grant select, insert, update, delete on thread_members, stage_instances, channel_follows, polls, poll_votes, link_previews,
      guild_events, guild_event_users, automod_rules, guild_onboarding, guild_daily_stats, guild_daily_active,
      applications, application_commands, interactions, webhooks, premium_subscriptions, guild_boosts, premium_codes,
      premium_code_redemptions, user_connections, notification_settings, push_subscriptions, passkeys, auth_challenges to syndo_runtime;
  end if;
end $$;
