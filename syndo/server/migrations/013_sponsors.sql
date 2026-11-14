-- Monthly sponsorships of SEND's developer, paid through Stripe (amount chosen by the sponsor).
create table if not exists sponsorships (
  id bigint primary key,
  user_id bigint not null references users(id) on delete cascade,
  stripe_subscription text unique,
  stripe_customer text,
  amount_pence integer not null check (amount_pence between 100 and 50000),
  currency text not null default 'gbp',
  status text not null check (status in ('active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  show_badge boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists sponsorships_user on sponsorships(user_id);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'syndo_runtime') then
    grant select, insert, update, delete on sponsorships to syndo_runtime;
  end if;
end $$;
