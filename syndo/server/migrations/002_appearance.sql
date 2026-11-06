-- Syndo appearance system: personal preferences per scope, saved presets,
-- a private asset library, explicitly-accepted shared conversation themes,
-- and server-specific public profiles.

-- Personal appearance. Private to its owner; never part of any profile response.
-- scope: 'global' (scope_id 0), 'guild' (guild id), 'channel' (channel or DM id).
create table appearance_prefs (
  user_id bigint not null references users(id) on delete cascade,
  scope text not null check (scope in ('global', 'guild', 'channel')),
  scope_id bigint not null default 0,
  data jsonb not null,
  rev int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, scope_id)
);

create table theme_presets (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index theme_presets_user on theme_presets(user_id);

-- Wallpapers and panel images. Owner-only unless referenced by a shared
-- conversation theme in a conversation the viewer belongs to.
create table appearance_assets (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  mime text not null,
  size bigint not null,
  storage_key text not null,
  width int,
  height int,
  animated boolean not null default false,
  name text not null default '',
  favorite boolean not null default false,
  created_at timestamptz not null default now()
);
create index appearance_assets_user on appearance_assets(user_id);

-- Shared conversation themes: a proposal is visible to participants, but only
-- applies for a participant who explicitly accepted it. Personal overrides still win.
create table conversation_themes (
  id bigint primary key,
  channel_id bigint not null references channels(id) on delete cascade,
  proposer_id bigint references users(id) on delete set null,
  data jsonb not null,
  status text not null default 'open' check (status in ('open', 'withdrawn')),
  created_at timestamptz not null default now()
);
create index conversation_themes_channel on conversation_themes(channel_id);
create table conversation_theme_votes (
  theme_id bigint not null references conversation_themes(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  accepted boolean not null,
  primary key (theme_id, user_id)
);

-- Server-specific public profile. NULL = use the global value.
alter table members
  add column banner_key text,
  add column pronouns text check (char_length(pronouns) <= 40),
  add column profile_theme jsonb,
  add column custom_status jsonb;
