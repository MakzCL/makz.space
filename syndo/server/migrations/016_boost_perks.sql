-- Additional boost perks a server turns on once it has enough boosts (tag badge, animated role colours, server colour).
alter table guilds add column if not exists perks jsonb not null default '{}'::jsonb;
