-- Voice network per voice channel (Discord's "Region Override" slot): null = automatic (direct, peer-to-peer
-- with TURN relay), 'global' = Cloudflare's worldwide media network (everyone connects to their nearest location).
alter table channels add column if not exists rtc_region text;
