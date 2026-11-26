-- Servers can show a boost progress bar (level and boost count) under their banner.
alter table guilds add column if not exists show_boost_bar boolean not null default false;
