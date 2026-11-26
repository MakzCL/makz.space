-- Sparks: SEND's in-app currency, earned from challenges and spent on Server Boosts (a boost lasts a year).
alter table users add column if not exists referred_by bigint references users(id) on delete set null;

alter table premium_subscriptions drop constraint if exists premium_subscriptions_provider_check;
alter table premium_subscriptions add constraint premium_subscriptions_provider_check check (provider in ('stripe', 'grant', 'code', 'sparks'));

create table if not exists spark_ledger (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  amount integer not null check (amount <> 0 and amount between -100000 and 100000),
  reason text not null check (reason in ('challenge', 'boost', 'grant')),
  ref text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, ref)
);
create index if not exists spark_ledger_user on spark_ledger(user_id);

-- Minute counters for challenges measured over time (calls, screen sharing).
create table if not exists challenge_progress (
  user_id bigint not null references users(id) on delete cascade,
  season text not null,
  key text not null,
  progress integer not null default 0,
  primary key (user_id, season, key)
);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'syndo_runtime') then
    grant select, insert, update, delete on spark_ledger, challenge_progress to syndo_runtime;
  end if;
end $$;
