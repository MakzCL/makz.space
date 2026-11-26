-- Native push for the Android (Firebase Cloud Messaging) and iOS (Apple Push Notification service) apps.
create table if not exists device_push_tokens (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  token text not null unique check (char_length(token) <= 4096),
  sandbox boolean not null default false,
  app_version text check (char_length(app_version) <= 40),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists device_push_tokens_user on device_push_tokens(user_id);

-- The app's database role needs these (010 forgot reports, so in-app reports failed in production).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'syndo_runtime') then
    grant select, insert, update, delete on device_push_tokens, reports to syndo_runtime;
  end if;
end $$;
