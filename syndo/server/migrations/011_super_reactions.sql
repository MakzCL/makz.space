-- Super reactions: a reaction can be a normal one or a "burst" (animated) one; both can exist for the same emoji.
alter table reactions add column if not exists burst boolean not null default false;
alter table reactions drop constraint if exists reactions_pkey;
alter table reactions add primary key (message_id, user_id, emoji, burst);
