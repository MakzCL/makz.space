-- Server expressions: custom emoji and soundboard sounds; banners for categories (and other channels).

create table guild_emojis (
  id bigint primary key,
  guild_id bigint not null references guilds(id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9_]{2,32}$'),
  animated boolean not null default false,
  storage_key text not null,
  creator_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (guild_id, name)
);
create index guild_emojis_guild on guild_emojis(guild_id);

create table guild_sounds (
  id bigint primary key,
  guild_id bigint not null references guilds(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  emoji text check (emoji is null or char_length(emoji) <= 64),
  volume real not null default 1 check (volume >= 0 and volume <= 1),
  storage_key text not null,
  duration_ms int not null check (duration_ms between 1 and 5200),
  creator_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index guild_sounds_guild on guild_sounds(guild_id);

alter table channels add column if not exists banner_key text;

-- Hosted deployments run the API as a restricted role; give it the new tables.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'syndo_runtime') then
    grant select, insert, update, delete on guild_emojis, guild_sounds to syndo_runtime;
  end if;
end $$;
