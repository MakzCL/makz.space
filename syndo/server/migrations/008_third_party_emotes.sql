-- 7TV / BTTV emotes per server: on/off and an optional linked set ({ enabled, seventv_set, twitch_id, label }).
alter table guilds add column if not exists third_party_emotes jsonb not null default '{"enabled": true}';
