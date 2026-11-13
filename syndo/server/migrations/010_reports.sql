-- User reports (Online Safety Act / app store requirement): anyone can report a message, user or server.
create table if not exists reports (
  id bigint primary key,
  reporter_id bigint references users(id) on delete set null,
  target_type text not null check (target_type in ('message', 'user', 'guild')),
  target_id bigint not null,
  channel_id bigint,
  guild_id bigint,
  reason text not null,
  details text not null default '',
  -- What the reporter saw (for end-to-end encrypted messages this is the only copy we ever get).
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'reviewing', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists reports_status_idx on reports (status, created_at desc);
