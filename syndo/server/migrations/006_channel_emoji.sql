-- An emoji that stands in for a channel's # / speaker icon (unicode, or a custom emoji as <:name:id>).
alter table channels add column if not exists icon_emoji text check (icon_emoji is null or char_length(icon_emoji) <= 64);
