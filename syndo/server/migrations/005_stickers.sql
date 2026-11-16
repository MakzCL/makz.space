-- Server stickers, and one sticker per message.
create table guild_stickers (
  id bigint primary key,
  guild_id bigint not null references guilds(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 30),
  description text check (description is null or char_length(description) <= 100),
  tags text check (tags is null or char_length(tags) <= 64),
  format text not null check (format in ('png', 'apng', 'gif', 'webp')),
  storage_key text not null,
  creator_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index guild_stickers_guild on guild_stickers(guild_id);
alter table messages add column if not exists sticker_id bigint references guild_stickers(id) on delete set null;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'syndo_runtime') then
    grant select, insert, update, delete on guild_stickers to syndo_runtime;
  end if;
end $$;
