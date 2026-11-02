-- =========================================================================
-- Skalarki Electronics — Factory app schema
-- Run once in Supabase → SQL Editor (or `psql -f schema.sql`).
--
-- Roles (gateways): boss · manager · office · assistant · operator
-- Nobody gets in on their own: the boss makes one invite link per person
-- (every link uses the team PIN 101010) and the link sets their role.
-- Accounts made without a link wait for an admin to approve them.
-- Bootstrap the first boss with a boss link inserted from the SQL editor
-- (see README).
-- =========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types ---
do $$ begin
  create type public.staff_role as enum ('boss','manager','office','assistant','operator');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- profiles ---
create sequence if not exists public.employee_seq start 1;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'New starter',
  employee_code text not null unique
    default 'OP-' || lpad(nextval('public.employee_seq')::text, 3, '0'),
  role public.staff_role not null default 'operator',
  avatar_url text,
  holiday_allowance int not null default 28,
  created_at timestamptz not null default now()
);
-- Pending accounts (signed up without an invite link) wait for an admin.
-- Existing rows become active; new rows default to pending.
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles alter column active set default false;

-- Role helpers. SECURITY DEFINER so policies can read profiles without
-- recursing into the profiles policies themselves.
create or replace function public.my_role() returns public.staff_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('boss','manager'), false)
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('boss','manager','office'), false)
$$;

-- New auth user → pending operator profile. An invite link activates it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    'operator', false
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the boss may change roles / allowances. SQL editor (no auth.uid()) is trusted.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_setting('app.join_redeem', true) = 'on' then return new; end if;
  if (new.active is distinct from old.active) and not public.is_admin() then
    raise exception 'Only boss, manager or office can approve accounts';
  end if;
  if (new.role is distinct from old.role) and public.my_role() <> 'boss' then
    raise exception 'Only the boss can change roles';
  end if;
  if (new.holiday_allowance is distinct from old.holiday_allowance) and not public.is_admin() then
    raise exception 'Only boss, manager or office can change holiday allowance';
  end if;
  if (new.employee_code is distinct from old.employee_code) and not public.is_admin() then
    raise exception 'Only boss, manager or office can change employee codes';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- --------------------------------------------------------------- shifts ---
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists shifts_user_idx on public.shifts (user_id, clock_in desc);

create table if not exists public.breaks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists breaks_shift_idx on public.breaks (shift_id);

-- ----------------------------------------------------------------- jobs ---
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  title text not null,
  description text not null default '',
  customer text not null default '',
  priority int not null default 3 check (priority between 1 and 5),
  status text not null default 'open'
    check (status in ('open','in_progress','paused','blocked','done')),
  assignees uuid[] not null default '{}',
  estimate_minutes int,
  quantity int,
  due_date date,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- A work session = one continuous stretch of work on a job (may be a team).
create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  started_by uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ws_job_idx on public.work_sessions (job_id);

-- Everyone who worked inside a session, and for how long.
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.work_sessions(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists part_session_idx on public.participants (session_id);
create index if not exists part_user_idx on public.participants (user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.work_sessions(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- other ---
create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  reported_by uuid not null references public.profiles(id) on delete cascade,
  category text not null default 'other',
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  location text not null default '',
  unit text not null default 'pcs',
  quantity int not null default 0,
  min_quantity int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('sick','day_off','holiday')),
  start_date date not null,
  end_date date not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.join_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  pin text not null check (pin ~ '^[0-9]{4,8}$'),
  role public.staff_role not null default 'operator',
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0,
  failed int not null default 0,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ RLS ---
alter table public.profiles      enable row level security;
alter table public.shifts        enable row level security;
alter table public.breaks        enable row level security;
alter table public.jobs          enable row level security;
alter table public.work_sessions enable row level security;
alter table public.participants  enable row level security;
alter table public.invites       enable row level security;
alter table public.issues        enable row level security;
alter table public.stock_items   enable row level security;
alter table public.absences      enable row level security;
alter table public.announcements enable row level security;
alter table public.join_links    enable row level security;

-- Helper: am I (or was I) in this work session?
create or replace function public.in_session(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.participants p where p.session_id = sid and p.user_id = auth.uid())
      or exists (select 1 from public.work_sessions s where s.id = sid and s.started_by = auth.uid())
$$;

create or replace function public.on_job(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.jobs j where j.id = jid and auth.uid() = any(j.assignees))
      or exists (select 1 from public.participants p where p.job_id = jid and p.user_id = auth.uid())
      or exists (select 1 from public.invites i where i.job_id = jid and i.to_user = auth.uid() and i.status in ('pending','accepted'))
$$;

-- Wipe old policies so the file can be re-run.
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy "staff read profiles" on public.profiles for select to authenticated using (true);
create policy "edit own or admin edits" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "boss removes staff" on public.profiles for delete to authenticated using (public.my_role() = 'boss');

-- shifts / breaks
create policy "own or admin read shifts" on public.shifts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- Everyone sees who is currently on shift (presence), not history.
create policy "presence" on public.shifts for select to authenticated using (clock_out is null);
create policy "clock in self" on public.shifts for insert to authenticated with check (user_id = auth.uid());
create policy "clock out self or admin" on public.shifts for update to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "admin deletes shifts" on public.shifts for delete to authenticated using (public.is_admin());

create policy "own or admin read breaks" on public.breaks for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or ended_at is null);
create policy "break self" on public.breaks for insert to authenticated with check (user_id = auth.uid());
create policy "end break self or admin" on public.breaks for update to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- jobs
create policy "staff read jobs" on public.jobs for select to authenticated using (true);
create policy "leads create jobs" on public.jobs for insert to authenticated with check (public.is_lead());
create policy "leads or crew update jobs" on public.jobs for update to authenticated
  using (public.is_lead() or public.on_job(id));
create policy "leads delete jobs" on public.jobs for delete to authenticated using (public.is_lead());

-- work sessions / participants / invites
create policy "staff read sessions" on public.work_sessions for select to authenticated using (true);
create policy "start session on my job" on public.work_sessions for insert to authenticated
  with check (started_by = auth.uid() and (public.on_job(job_id) or public.is_lead()));
create policy "crew updates session" on public.work_sessions for update to authenticated
  using (public.in_session(id) or public.is_lead());

create policy "staff read participants" on public.participants for select to authenticated using (true);
create policy "join session" on public.participants for insert to authenticated
  with check (user_id = auth.uid() and (public.in_session(session_id)
    or exists (select 1 from public.invites i where i.session_id = participants.session_id
               and i.to_user = auth.uid() and i.status in ('pending','accepted'))));
create policy "crew updates participants" on public.participants for update to authenticated
  using (user_id = auth.uid() or public.in_session(session_id) or public.is_lead());

create policy "read my invites" on public.invites for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid() or public.is_lead());
create policy "invite from my session" on public.invites for insert to authenticated
  with check (from_user = auth.uid() and public.in_session(session_id));
create policy "answer or cancel invite" on public.invites for update to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

-- issues
create policy "staff read issues" on public.issues for select to authenticated using (true);
create policy "report issue" on public.issues for insert to authenticated with check (reported_by = auth.uid());
create policy "triage issue" on public.issues for update to authenticated
  using (reported_by = auth.uid() or public.is_admin());

-- stock
create policy "staff read stock" on public.stock_items for select to authenticated using (true);
-- (write policies for stock_items are in the Inventory section)

-- absences
create policy "own or admin read absences" on public.absences for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "request absence" on public.absences for insert to authenticated with check (user_id = auth.uid());
create policy "cancel own or decide" on public.absences for update to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- announcements
create policy "staff read news" on public.announcements for select to authenticated using (true);
create policy "admins post news" on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and public.is_admin());
create policy "admins edit news" on public.announcements for update to authenticated using (public.is_admin());
create policy "admins delete news" on public.announcements for delete to authenticated using (public.is_admin());

-- invite links: the boss sees and revokes; creation goes through create_join_link()
alter table public.join_links alter column created_by drop not null;
create policy "boss reads links" on public.join_links for select to authenticated using (public.my_role() = 'boss');
create policy "boss revokes links" on public.join_links for update to authenticated using (public.my_role() = 'boss');

-- Pending accounts see nothing but their own profile. RESTRICTIVE policies are
-- AND-ed with the permissive ones above.
do $$
declare t text;
begin
  foreach t in array array['shifts','breaks','jobs','work_sessions','participants','invites','issues',
                           'stock_items','absences','announcements','join_links'] loop
    execute format('create policy "active staff only" on public.%I as restrictive for all to authenticated using (public.is_active()) with check (public.is_active())', t);
  end loop;
end $$;
create policy "active staff only" on public.profiles as restrictive for select to authenticated
  using (public.is_active() or id = auth.uid());

-- ---------------------------------------------------------- invite links ---
create or replace function public.link_state(l public.join_links) returns text
language sql stable as $$
  select case
    when l.id is null then 'not_found'
    when l.revoked then 'revoked'
    when l.expires_at < now() then 'expired'
    when l.max_uses is not null and l.uses >= l.max_uses then 'used_up'
    when l.failed >= 10 then 'locked'
    else 'ok' end
$$;

-- Every invite link uses the same team PIN.
create or replace function public.join_pin() returns text language sql immutable as $$ select '101010' $$;

create or replace function public.create_join_link(p_role public.staff_role, p_pin text, p_hours int, p_max_uses int)
returns public.join_links
language plpgsql security definer set search_path = public, extensions as $$
declare
  r public.join_links;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text := '';
  b bytea := gen_random_bytes(8);
begin
  -- p_pin is ignored: every link uses the team PIN.
  if public.my_role() is distinct from 'boss' or not public.is_active() then raise exception 'Only the boss can create invite links'; end if;
  for i in 0..7 loop c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
  insert into public.join_links (code, pin, role, created_by, expires_at, max_uses)
  values (c, public.join_pin(), p_role, auth.uid(), now() + make_interval(hours => greatest(1, least(p_hours, 24 * 90))), p_max_uses)
  returning * into r;
  return r;
end $$;

-- Public: what is this link? (no PIN, no secrets)
create or replace function public.join_link_info(p_code text)
returns table (valid boolean, reason text, role public.staff_role, inviter text)
language plpgsql stable security definer set search_path = public as $$
declare l public.join_links;
begin
  select * into l from public.join_links where code = upper(trim(p_code));
  return query select public.link_state(l) = 'ok', public.link_state(l), coalesce(l.role, 'operator'),
    coalesce((select split_part(full_name, ' ', 1) from public.profiles where id = l.created_by), '');
end $$;

-- Public: is this PIN right? Wrong guesses count; 10 locks the link.
create or replace function public.check_join_pin(p_code text, p_pin text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l public.join_links;
begin
  select * into l from public.join_links where code = upper(trim(p_code)) for update;
  if public.link_state(l) <> 'ok' then return false; end if;
  if l.pin <> p_pin then
    update public.join_links set failed = failed + 1 where id = l.id;
    return false;
  end if;
  return true;
end $$;

-- Signed-in pending account: link + PIN → active with the link's role.
-- Returns 'ok' | 'wrong_pin' | 'invalid' (no exception, so failed guesses stick).
drop function if exists public.redeem_join_link(text, text);
create or replace function public.redeem_join_link(p_code text, p_pin text) returns text
language plpgsql security definer set search_path = public as $$
declare l public.join_links;
begin
  if auth.uid() is null then return 'invalid'; end if;
  select * into l from public.join_links where code = upper(trim(p_code)) for update;
  if public.link_state(l) <> 'ok' then return 'invalid'; end if;
  if l.pin <> p_pin then
    update public.join_links set failed = failed + 1 where id = l.id;
    return 'wrong_pin';
  end if;
  perform set_config('app.join_redeem', 'on', true);
  update public.profiles set active = true, role = l.role where id = auth.uid() and not active;
  perform set_config('app.join_redeem', 'off', true);
  update public.join_links set uses = uses + 1 where id = l.id;
  return 'ok';
end $$;

revoke all on function public.create_join_link(public.staff_role, text, int, int) from public, anon;
revoke all on function public.redeem_join_link(text, text) from public, anon;
grant execute on function public.create_join_link(public.staff_role, text, int, int) to authenticated;
grant execute on function public.redeem_join_link(text, text) to authenticated;
grant execute on function public.join_link_info(text) to anon, authenticated;
grant execute on function public.check_join_pin(text, text) to anon, authenticated;

-- ------------------------------------------------------------- realtime ---
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','shifts','breaks','jobs','work_sessions','participants',
                             'invites','issues','stock_items','absences','announcements','join_links'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;

-- -------------------------------------------------------------- avatars ---
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
      on conflict (id) do nothing;

    drop policy if exists "avatar read" on storage.objects;
    drop policy if exists "avatar write own" on storage.objects;
    drop policy if exists "avatar update own" on storage.objects;
    create policy "avatar read" on storage.objects for select using (bucket_id = 'avatars');
    create policy "avatar write own" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
    create policy "avatar update own" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- =========================================================================
-- Production flow: Shopify orders → jobs that move station to station
--   stations        Metal works → Panel fitting → Quality check → Packing …
--   station_members who works at each station (jobs auto-assign to them)
--   products        Shopify SKU → route (ordered list of stations)
--   orders          one row per Shopify order (number, customer, ship-to)
--   jobs            one per order line; route/stage/station_id track progress
--   job_steps       who completed each station and when
-- =========================================================================
create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort int not null default 0,
  in_default boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.station_members (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (station_id, user_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null default '',
  route uuid[] not null default '{}',
  estimate_minutes int,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  shopify_id bigint unique,
  order_number text not null,
  customer text not null default '',
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  ship_to text not null default '',
  shipping_method text not null default '',
  note text not null default '',
  ordered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.jobs add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.jobs add column if not exists sku text;
alter table public.jobs add column if not exists route uuid[] not null default '{}';
alter table public.jobs add column if not exists stage int not null default 0;
alter table public.jobs add column if not exists station_id uuid references public.stations(id) on delete set null;
alter table public.jobs add column if not exists shopify_line_id bigint unique;
alter table public.jobs add column if not exists unit_price numeric(12,2);
alter table public.orders add column if not exists total_price numeric(12,2);
alter table public.orders add column if not exists currency text not null default 'GBP';

create table if not exists public.job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  station_id uuid references public.stations(id) on delete set null,
  stage int not null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists job_steps_job_idx on public.job_steps (job_id);
create index if not exists jobs_station_idx on public.jobs (station_id) where status <> 'done';

alter table public.stations        enable row level security;
alter table public.station_members enable row level security;
alter table public.products        enable row level security;
alter table public.orders          enable row level security;
alter table public.job_steps       enable row level security;

drop policy if exists "staff read stations" on public.stations;
drop policy if exists "leads edit stations" on public.stations;
drop policy if exists "staff read station members" on public.station_members;
drop policy if exists "leads edit station members" on public.station_members;
drop policy if exists "staff read products" on public.products;
drop policy if exists "leads edit products" on public.products;
drop policy if exists "staff read orders" on public.orders;
drop policy if exists "leads edit orders" on public.orders;
drop policy if exists "staff read job steps" on public.job_steps;
drop policy if exists "active staff only" on public.stations;
drop policy if exists "active staff only" on public.station_members;
drop policy if exists "active staff only" on public.products;
drop policy if exists "active staff only" on public.orders;
drop policy if exists "active staff only" on public.job_steps;

create policy "staff read stations" on public.stations for select to authenticated using (true);
create policy "leads edit stations" on public.stations for all to authenticated using (public.is_lead()) with check (public.is_lead());
create policy "staff read station members" on public.station_members for select to authenticated using (true);
create policy "leads edit station members" on public.station_members for all to authenticated using (public.is_lead()) with check (public.is_lead());
create policy "staff read products" on public.products for select to authenticated using (true);
create policy "leads edit products" on public.products for all to authenticated using (public.is_lead()) with check (public.is_lead());
create policy "staff read orders" on public.orders for select to authenticated using (true);
create policy "leads edit orders" on public.orders for all to authenticated using (public.is_lead()) with check (public.is_lead());
-- job_steps are written only by complete_stage()
create policy "staff read job steps" on public.job_steps for select to authenticated using (true);
do $$
declare t text;
begin
  foreach t in array array['stations','station_members','products','orders','job_steps'] loop
    execute format('create policy "active staff only" on public.%I as restrictive for all to authenticated using (public.is_active()) with check (public.is_active())', t);
  end loop;
end $$;

-- Everyone who works at a station.
create or replace function public.station_assignees(st uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id order by m.created_at), '{}') from public.station_members m where m.station_id = st
$$;

-- Route used for products nobody has set up yet: every default station in order.
create or replace function public.default_route() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id order by sort, created_at), '{}') from public.stations where in_default
$$;

-- People joining/leaving a station pick up/drop the open jobs waiting there.
create or replace function public.sync_station_jobs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.jobs set assignees = array_append(assignees, new.user_id)
      where station_id = new.station_id and status <> 'done' and not (new.user_id = any(assignees));
    return new;
  else
    update public.jobs set assignees = array_remove(assignees, old.user_id)
      where station_id = old.station_id and status <> 'done';
    return old;
  end if;
end $$;
drop trigger if exists sync_station_jobs on public.station_members;
create trigger sync_station_jobs after insert or delete on public.station_members
  for each row execute function public.sync_station_jobs();

-- The crew at the current station is done → record it and pass the job on.
-- Returns 'next' (moved to the next station) or 'done' (last station finished).
create or replace function public.complete_stage(p_job uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  j public.jobs;
  nxt int;
begin
  if not public.is_active() then raise exception 'Not allowed'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status = 'done' then return 'done'; end if;
  if not (public.is_lead() or auth.uid() = any(j.assignees)
          or exists (select 1 from public.station_members m where m.station_id = j.station_id and m.user_id = auth.uid())) then
    raise exception 'This job is not at your station';
  end if;
  insert into public.job_steps (job_id, station_id, stage, completed_by) values (j.id, j.station_id, j.stage, auth.uid());
  nxt := j.stage + 1;
  if nxt >= coalesce(array_length(j.route, 1), 0) then
    update public.jobs set status = 'done', completed_at = now() where id = j.id;
    return 'done';
  end if;
  update public.jobs set stage = nxt, station_id = j.route[nxt + 1], status = 'open', completed_at = null,
    assignees = public.station_assignees(j.route[nxt + 1])
  where id = j.id;
  return 'next';
end $$;

-- Shopify order JSON (orders/create webhook) → order + one job per line item.
-- Safe to call twice for the same order: nothing is duplicated.
create or replace function public.ingest_shopify_order(o jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  addr jsonb := coalesce(nullif(o->'shipping_address', 'null'::jsonb), nullif(o->'billing_address', 'null'::jsonb), '{}'::jsonb);
  cust text;
  oid uuid;
  li jsonb;
  p public.products;
  r uuid[];
  lines int;
  idx int := 0;
  made int := 0;
  props text;
  jid uuid;
  oname text := coalesce(nullif(o->>'name', ''), '#' || (o->>'order_number'), '#' || (o->>'id'));
begin
  cust := coalesce(nullif(trim(concat_ws(' ', addr->>'first_name', addr->>'last_name')), ''),
                   nullif(trim(concat_ws(' ', o->'customer'->>'first_name', o->'customer'->>'last_name')), ''),
                   nullif(o->>'email', ''), '');
  insert into public.orders (shopify_id, order_number, customer, company, email, phone, ship_to, shipping_method, note, ordered_at, total_price, currency)
  values ((o->>'id')::bigint, oname, cust, coalesce(addr->>'company', ''), coalesce(o->>'email', ''),
          coalesce(nullif(addr->>'phone', ''), nullif(o->>'phone', ''), ''),
          concat_ws(', ', nullif(addr->>'address1', ''), nullif(addr->>'address2', ''), nullif(addr->>'city', ''),
                    nullif(addr->>'province', ''), nullif(addr->>'zip', ''), nullif(addr->>'country', '')),
          coalesce((select string_agg(s->>'title', ', ') from jsonb_array_elements(coalesce(o->'shipping_lines', '[]'::jsonb)) s), ''),
          coalesce(o->>'note', ''), (o->>'created_at')::timestamptz,
          case when o->>'total_price' ~ '^[0-9]+(\.[0-9]+)?$' then (o->>'total_price')::numeric end, coalesce(nullif(o->>'currency', ''), 'GBP'))
  on conflict (shopify_id) do update set customer = excluded.customer, company = excluded.company, email = excluded.email,
    phone = excluded.phone, ship_to = excluded.ship_to, shipping_method = excluded.shipping_method, note = excluded.note,
    total_price = coalesce(excluded.total_price, orders.total_price), currency = excluded.currency
  returning id into oid;

  select count(*) into lines from jsonb_array_elements(coalesce(o->'line_items', '[]'::jsonb)) x
   where coalesce((x->>'gift_card')::boolean, false) = false;

  for li in select * from jsonb_array_elements(coalesce(o->'line_items', '[]'::jsonb)) loop
    continue when coalesce((li->>'gift_card')::boolean, false);
    idx := idx + 1;
    p := null;
    if nullif(trim(li->>'sku'), '') is not null then
      select * into p from public.products where sku = trim(li->>'sku');
      if p.id is null then
        insert into public.products (sku, name, route) values (trim(li->>'sku'), coalesce(li->>'title', ''), public.default_route())
        on conflict (sku) do nothing;
        select * into p from public.products where sku = trim(li->>'sku');
      end if;
    end if;
    r := case when coalesce(array_length(p.route, 1), 0) > 0 then p.route else public.default_route() end;
    select string_agg((pr->>'name') || ': ' || (pr->>'value'), E'\n') into props
      from jsonb_array_elements(coalesce(li->'properties', '[]'::jsonb)) pr where left(pr->>'name', 1) <> '_';
    insert into public.jobs (code, title, description, customer, priority, status, assignees, quantity,
                             estimate_minutes, order_id, sku, route, stage, station_id, shopify_line_id, unit_price)
    values (case when lines > 1 then oname || '-' || idx else oname end,
            concat_ws(' - ', li->>'title', nullif(replace(li->>'variant_title', ' / ', ' - '), '')),
            concat_ws(E'\n', props, nullif(o->>'note', '')),
            cust, 3, 'open', public.station_assignees(r[1]), coalesce((li->>'quantity')::int, 1),
            p.estimate_minutes, oid, nullif(trim(li->>'sku'), ''), r, 0, r[1], (li->>'id')::bigint,
            case when li->>'price' ~ '^[0-9]+(\.[0-9]+)?$' then (li->>'price')::numeric end)
    on conflict (shopify_line_id) do nothing
    returning id into jid;
    if jid is not null then made := made + 1; end if;
    jid := null;
  end loop;
  return made;
end $$;

-- Boss/manager: send a job back to the previous station (e.g. failed QC).
create or replace function public.previous_stage(p_job uuid) returns text
language plpgsql security definer set search_path = public as $$
declare j public.jobs; prv int;
begin
  if not public.is_lead() or not public.is_active() then raise exception 'Only the boss or a manager can send a job back'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if coalesce(array_length(j.route, 1), 0) = 0 then raise exception 'This job has no stations'; end if;
  -- A finished job goes back to its last station; otherwise one station back.
  prv := case when j.status = 'done' then array_length(j.route, 1) - 1 else j.stage - 1 end;
  if prv < 0 then raise exception 'Already at the first station'; end if;
  update public.jobs set stage = prv, station_id = j.route[prv + 1], status = 'open', completed_at = null,
    assignees = public.station_assignees(j.route[prv + 1])
  where id = j.id;
  return (select name from public.stations where id = j.route[prv + 1]);
end $$;
revoke all on function public.previous_stage(uuid) from public, anon;
grant execute on function public.previous_stage(uuid) to authenticated;

revoke all on function public.ingest_shopify_order(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ingest_shopify_order(jsonb) to service_role;
  end if;
end $$;
revoke all on function public.complete_stage(uuid) from public, anon;
grant execute on function public.complete_stage(uuid) to authenticated;

-- Starter stations (only on a fresh database).
insert into public.stations (name, sort)
select v.name, v.sort from (values ('Metal works', 1), ('Panel fitting', 2), ('Quality check', 3), ('Packing', 4)) v(name, sort)
where not exists (select 1 from public.stations);

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['stations','station_members','products','orders','job_steps'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;

-- =========================================================================
-- Inventory (replaces Katana): items, recipes (BOMs), suppliers, purchase
-- orders and a full stock history. Desktop only in the app.
--   stock_items      products + materials; quantity = in stock
--   bom_lines        product → materials it uses (per 1 unit)
--   suppliers        who we buy from
--   purchase_orders  + po_lines; receiving books stock in at cost
--   stock_movements  every change to quantity (who, when, why)
-- Stock only changes through the functions below, so history is complete.
-- =========================================================================
drop trigger if exists replenish_on_change on public.stock_items; -- recreated further down
alter table public.stock_items alter column quantity type numeric(14,3);
alter table public.stock_items alter column min_quantity type numeric(14,3);
alter table public.stock_items add column if not exists kind text not null default 'material' check (kind in ('material','product','part'));
alter table public.stock_items add column if not exists category text not null default '';
alter table public.stock_items add column if not exists avg_cost numeric(14,4) not null default 0;
alter table public.stock_items add column if not exists sale_price numeric(14,2);
alter table public.stock_items add column if not exists supplier_id uuid;
alter table public.stock_items add column if not exists supplier_code text not null default '';
alter table public.stock_items add column if not exists lead_days int;
alter table public.stock_items add column if not exists notes text not null default '';
alter table public.stock_items add column if not exists archived boolean not null default false;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  currency text not null default 'GBP',
  notes text not null default '',
  created_at timestamptz not null default now()
);
do $$ begin
  alter table public.stock_items add constraint stock_items_supplier_fk foreign key (supplier_id) references public.suppliers(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.stock_items(id) on delete cascade,
  material_id uuid not null references public.stock_items(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (product_id, material_id),
  check (product_id <> material_id)
);

create sequence if not exists public.po_seq start 1;
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default 'PO-' || lpad(nextval('public.po_seq')::text, 4, '0'),
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','ordered','partial','received','cancelled')),
  expected_date date,
  ordered_at timestamptz,
  received_at timestamptz,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.po_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  received numeric(14,3) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  delta numeric(14,3) not null,
  after numeric(14,3) not null,
  reason text not null check (reason in ('adjust','count','receive','consume','produce','import','opening')),
  ref text not null default '',
  note text not null default '',
  unit_cost numeric(14,4),
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stock_movements_item_idx on public.stock_movements (item_id, created_at desc);

alter table public.jobs add column if not exists stock_booked boolean not null default false;

alter table public.suppliers       enable row level security;
alter table public.bom_lines       enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_lines        enable row level security;
alter table public.stock_movements enable row level security;

create or replace function public.is_stock_keeper() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('boss','manager','office','assistant'), false) and public.is_active()
$$;

drop policy if exists "keepers add or edit items" on public.stock_items;
drop policy if exists "keepers edit items" on public.stock_items;
drop policy if exists "leads delete items" on public.stock_items;
-- Item details are editable; quantity/avg_cost only move through the functions (see guard below).
create policy "keepers add or edit items" on public.stock_items for insert to authenticated with check (public.is_stock_keeper());
create policy "keepers edit items" on public.stock_items for update to authenticated using (public.is_stock_keeper());
create policy "leads delete items" on public.stock_items for delete to authenticated using (public.is_lead());

do $$
declare t text;
begin
  foreach t in array array['suppliers','bom_lines','purchase_orders','po_lines','stock_movements'] loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('drop policy if exists "keepers write" on public.%I', t);
    execute format('drop policy if exists "active staff only" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (true)', t);
    execute format('create policy "active staff only" on public.%I as restrictive for all to authenticated using (public.is_active()) with check (public.is_active())', t);
    if t <> 'stock_movements' then
      execute format('create policy "keepers write" on public.%I for all to authenticated using (public.is_stock_keeper()) with check (public.is_stock_keeper())', t);
    end if;
  end loop;
end $$;

-- Quantity and average cost can only change inside the stock functions.
create or replace function public.guard_stock_qty() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_setting('app.stock_move', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.quantity <> 0 then raise exception 'Use opening stock to set a new item''s quantity'; end if;
  elsif new.quantity is distinct from old.quantity or new.avg_cost is distinct from old.avg_cost then
    raise exception 'Stock levels change through adjustments, counts, receiving and jobs';
  end if;
  return new;
end $$;
drop trigger if exists guard_stock_qty on public.stock_items;
create trigger guard_stock_qty before insert or update on public.stock_items
  for each row execute function public.guard_stock_qty();

-- Core: move stock and log it. Receiving at a cost updates the average cost.
create or replace function public.move_stock(p_item uuid, p_delta numeric, p_reason text, p_ref text default '', p_note text default '', p_cost numeric default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s public.stock_items;
  q numeric;
begin
  select * into s from public.stock_items where id = p_item for update;
  if s.id is null then raise exception 'Item not found'; end if;
  q := s.quantity + p_delta;
  perform set_config('app.stock_move', 'on', true);
  update public.stock_items set quantity = q,
    avg_cost = case when p_cost is not null and p_delta > 0 and q > 0
                    then round((greatest(s.quantity, 0) * s.avg_cost + p_delta * p_cost) / (greatest(s.quantity, 0) + p_delta), 4)
                    when p_cost is not null and s.quantity <= 0 then p_cost
                    else s.avg_cost end,
    updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
  where id = s.id;
  perform set_config('app.stock_move', 'off', true);
  insert into public.stock_movements (item_id, delta, after, reason, ref, note, unit_cost, user_id)
  values (s.id, p_delta, q, p_reason, coalesce(p_ref, ''), coalesce(p_note, ''), p_cost, auth.uid());
  return q;
end $$;
revoke all on function public.move_stock(uuid, numeric, text, text, text, numeric) from public, anon, authenticated;

-- App: book stock in/out by hand.
create or replace function public.adjust_stock(p_item uuid, p_delta numeric, p_note text default '') returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change stock'; end if;
  if p_delta = 0 then raise exception 'Nothing to change'; end if;
  return public.move_stock(p_item, p_delta, 'adjust', '', p_note);
end $$;

-- App: stocktake — set what is physically there.
create or replace function public.count_stock(p_item uuid, p_counted numeric, p_note text default '') returns numeric
language plpgsql security definer set search_path = public as $$
declare cur numeric;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change stock'; end if;
  if p_counted < 0 then raise exception 'A count cannot be negative'; end if;
  select quantity into cur from public.stock_items where id = p_item;
  return public.move_stock(p_item, p_counted - cur, 'count', '', p_note);
end $$;

-- App: opening stock for new / imported items (also sets the cost).
create or replace function public.opening_stock(p_item uuid, p_qty numeric, p_cost numeric default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare cur numeric;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change stock'; end if;
  select quantity into cur from public.stock_items where id = p_item;
  if p_qty = cur and p_cost is null then return cur; end if;
  perform set_config('app.stock_move', 'on', true);
  if p_cost is not null then update public.stock_items set avg_cost = p_cost where id = p_item; end if;
  perform set_config('app.stock_move', 'off', true);
  return public.move_stock(p_item, p_qty - cur, 'import', 'Katana import', '');
end $$;

-- App: receive a delivery against a purchase order line.
create or replace function public.receive_po_line(p_line uuid, p_qty numeric) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.po_lines;
  po public.purchase_orders;
  open_left numeric;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can receive deliveries'; end if;
  if p_qty <= 0 then raise exception 'Receive at least one'; end if;
  select * into l from public.po_lines where id = p_line for update;
  select * into po from public.purchase_orders where id = l.po_id for update;
  if po.status in ('cancelled','received') then raise exception 'This purchase order is closed'; end if;
  update public.po_lines set received = received + p_qty where id = l.id;
  perform public.move_stock(l.item_id, p_qty, 'receive', po.number, '', l.unit_cost);
  select coalesce(sum(greatest(quantity - received, 0)), 0) into open_left from public.po_lines where po_id = po.id;
  update public.purchase_orders set status = case when open_left = 0 then 'received' else 'partial' end,
    received_at = case when open_left = 0 then now() else received_at end,
    ordered_at = coalesce(ordered_at, now())
  where id = po.id;
  return case when open_left = 0 then 'received' else 'partial' end;
end $$;

-- A finished job uses up its recipe: materials × job quantity.
-- Make-to-stock jobs (not from a customer order) also add the product to stock.
create or replace function public.book_job_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prod public.stock_items;
  b record;
  qty numeric := coalesce(new.quantity, 1);
begin
  if new.status <> 'done' or old.status = 'done' or new.stock_booked or new.sku is null then return new; end if;
  select * into prod from public.stock_items where sku = new.sku and kind <> 'material' limit 1;
  if prod.id is null then select * into prod from public.stock_items where sku = new.sku limit 1; end if;
  if prod.id is null then return new; end if;
  for b in select material_id, quantity from public.bom_lines where product_id = prod.id loop
    perform public.move_stock(b.material_id, -(b.quantity * qty), 'consume', new.code, '');
  end loop;
  if new.order_id is null then
    perform public.move_stock(prod.id, qty, 'produce', new.code, '');
  end if;
  new.stock_booked := true;
  return new;
end $$;
drop trigger if exists book_job_stock on public.jobs;
create trigger book_job_stock before update of status on public.jobs
  for each row execute function public.book_job_stock();

-- Bulk import (Katana CSV exports). Rows are matched on SKU, so re-importing updates.
-- items: [{sku,name,kind,category,unit,location,quantity,min_quantity,avg_cost,sale_price,supplier,supplier_code,lead_days}]
create or replace function public.import_items(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  sid uuid;
  iid uuid;
  n int := 0;
  num text := '^-?[0-9]+(\.[0-9]+)?$';
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can import stock'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when nullif(trim(r->>'sku'), '') is null;
    sid := null;
    if nullif(trim(r->>'supplier'), '') is not null then
      select id into sid from public.suppliers where lower(name) = lower(trim(r->>'supplier')) limit 1;
      if sid is null then insert into public.suppliers (name) values (trim(r->>'supplier')) returning id into sid; end if;
    end if;
    perform set_config('app.stock_move', 'on', true);
    insert into public.stock_items (sku, name, kind, category, unit, location, min_quantity, sale_price, supplier_id, supplier_code, lead_days, quantity, updated_at)
    values (trim(r->>'sku'), coalesce(nullif(trim(r->>'name'), ''), trim(r->>'sku')),
            case when lower(r->>'kind') in ('product','material','part') then lower(r->>'kind') else 'material' end,
            coalesce(r->>'category', ''), coalesce(nullif(r->>'unit', ''), 'pcs'), coalesce(r->>'location', ''),
            case when r->>'min_quantity' ~ num then (r->>'min_quantity')::numeric else 0 end,
            case when r->>'sale_price' ~ num then (r->>'sale_price')::numeric end,
            sid, coalesce(r->>'supplier_code', ''),
            case when r->>'lead_days' ~ '^[0-9]+$' then (r->>'lead_days')::int end, 0, now())
    on conflict (sku) do update set
      name = coalesce(nullif(trim(excluded.name), ''), stock_items.name),
      kind = case when r ? 'kind' then excluded.kind else stock_items.kind end,
      category = case when r ? 'category' then excluded.category else stock_items.category end,
      unit = case when r ? 'unit' then excluded.unit else stock_items.unit end,
      location = case when r ? 'location' then excluded.location else stock_items.location end,
      min_quantity = case when r ? 'min_quantity' then excluded.min_quantity else stock_items.min_quantity end,
      sale_price = coalesce(excluded.sale_price, stock_items.sale_price),
      supplier_id = coalesce(excluded.supplier_id, stock_items.supplier_id),
      supplier_code = case when r ? 'supplier_code' then excluded.supplier_code else stock_items.supplier_code end,
      lead_days = coalesce(excluded.lead_days, stock_items.lead_days),
      archived = false
    returning id into iid;
    if r->>'avg_cost' ~ num then update public.stock_items set avg_cost = (r->>'avg_cost')::numeric where id = iid; end if;
    perform set_config('app.stock_move', 'off', true);
    if r->>'quantity' ~ num then
      perform public.move_stock(iid, (r->>'quantity')::numeric - (select quantity from public.stock_items where id = iid), 'import', 'Katana import', '');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- recipes: [{product_sku, material_sku, quantity}] — replaces each listed product's recipe.
create or replace function public.import_bom(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  pid uuid;
  mid uuid;
  n int := 0;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can import recipes'; end if;
  delete from public.bom_lines where product_id in (
    select s.id from public.stock_items s where s.sku in (select trim(x->>'product_sku') from jsonb_array_elements(p_rows) x));
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into pid from public.stock_items where sku = trim(r->>'product_sku');
    select id into mid from public.stock_items where sku = trim(r->>'material_sku');
    continue when pid is null or mid is null or pid = mid or not (r->>'quantity' ~ '^[0-9]+(\.[0-9]+)?$') or (r->>'quantity')::numeric <= 0;
    insert into public.bom_lines (product_id, material_id, quantity) values (pid, mid, (r->>'quantity')::numeric)
    on conflict (product_id, material_id) do update set quantity = bom_lines.quantity + excluded.quantity;
    update public.stock_items set kind = 'product' where id = pid and kind = 'material';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.import_items(jsonb) from public, anon;
revoke all on function public.import_bom(jsonb) from public, anon;
grant execute on function public.import_items(jsonb) to authenticated;
grant execute on function public.import_bom(jsonb) to authenticated;

revoke all on function public.adjust_stock(uuid, numeric, text) from public, anon;
revoke all on function public.count_stock(uuid, numeric, text) from public, anon;
revoke all on function public.opening_stock(uuid, numeric, numeric) from public, anon;
revoke all on function public.receive_po_line(uuid, numeric) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text) to authenticated;
grant execute on function public.count_stock(uuid, numeric, text) to authenticated;
grant execute on function public.opening_stock(uuid, numeric, numeric) to authenticated;
grant execute on function public.receive_po_line(uuid, numeric) to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['suppliers','bom_lines','purchase_orders','po_lines','stock_movements'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;

-- =========================================================================
-- Comms (Teams-style): notifications + phone push, chat, calls, calendar
-- =========================================================================
-- Presence: status the person picks (Teams-style) and when they were last here.
alter table public.profiles add column if not exists status text not null default 'available'
  check (status in ('available','busy','dnd','away'));
alter table public.profiles add column if not exists status_note text not null default '';
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- Small key/value settings used by triggers (e.g. the project URL for push).
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security; -- no policies: server-side only

-- ----------------------------------------------------------- notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,               -- news | job_new | job_given | invite | message | call | meeting | reminder
  title text not null,
  body text not null default '',
  link jsonb not null default '{}', -- {tab, job_id, conversation_id, call_id, event_id}
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
-- Server-only: the VAPID key pair the push function creates on first use.
create table if not exists public.push_keys (id int primary key default 1 check (id = 1), public_key text not null, private_key text not null);
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_keys          enable row level security; -- no policies: service role only

-- Anyone signed in may read the public push key (it is public by design).
create or replace function public.vapid_public_key() returns text
language sql stable security definer set search_path = public as $$ select public_key from public.push_keys where id = 1 $$;

-- Create a notification (and hand it to the push sender if configured).
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare nid uuid; url text;
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then return; end if;
  insert into public.notifications (user_id, kind, title, body, link) values (p_user, p_kind, p_title, left(coalesce(p_body, ''), 300), coalesce(p_link, '{}'))
  returning id into nid;
  select value into url from public.app_settings where key = 'push_url';
  if url is not null and exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from public.push_subscriptions where user_id = p_user) then
    perform net.http_post(url := url, body := jsonb_build_object('id', nid), headers := '{"Content-Type":"application/json"}'::jsonb);
  end if;
end $$;
revoke all on function public.notify(uuid, text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.first_name(p uuid) returns text
language sql stable security definer set search_path = public as $$ select coalesce(split_part(full_name, ' ', 1), '') from public.profiles where id = p $$;

-- Noticeboard post → everyone
create or replace function public.notify_news() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select id from public.profiles where active and id <> new.author_id loop
    perform public.notify(u, 'news', public.first_name(new.author_id) || ' posted on the noticeboard', new.body, '{"tab":"home"}');
  end loop;
  return new;
end $$;
drop trigger if exists notify_news on public.announcements;
create trigger notify_news after insert on public.announcements for each row execute function public.notify_news();

-- New job → its crew; job given to new people (assignment or station move) → them
create or replace function public.notify_jobs() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; st text;
begin
  select name into st from public.stations where id = new.station_id;
  if tg_op = 'INSERT' then
    foreach u in array coalesce(new.assignees, '{}') loop
      continue when u = auth.uid();
      perform public.notify(u, 'job_new', 'New job ' || new.code, new.title || coalesce(' · ' || st, ''), jsonb_build_object('tab', 'jobs', 'job_id', new.id));
    end loop;
    if new.order_id is not null then
      for u in select id from public.profiles where active and role in ('boss','manager') and not (id = any(coalesce(new.assignees, '{}'))) loop
        perform public.notify(u, 'job_new', 'New order ' || new.code, new.title || ' ×' || coalesce(new.quantity, 1), jsonb_build_object('tab', 'jobs', 'job_id', new.id));
      end loop;
    end if;
  elsif new.status <> 'done' then
    foreach u in array coalesce(new.assignees, '{}') loop
      continue when u = any(coalesce(old.assignees, '{}')) or u = auth.uid();
      perform public.notify(u, 'job_given',
        case when new.station_id is distinct from old.station_id and st is not null then new.code || ' is at ' || st || ' — your turn' else 'Job ' || new.code || ' given to you' end,
        new.title, jsonb_build_object('tab', 'jobs', 'job_id', new.id));
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists notify_jobs on public.jobs;
create trigger notify_jobs after insert or update of assignees on public.jobs for each row execute function public.notify_jobs();

-- Team job invite → the invited person
create or replace function public.notify_invite() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.to_user, 'invite', public.first_name(new.from_user) || ' wants your help',
    (select code || ' · ' || title from public.jobs where id = new.job_id), jsonb_build_object('tab', 'home', 'job_id', new.job_id));
  return new;
end $$;
drop trigger if exists notify_invite on public.invites;
create trigger notify_invite after insert on public.invites for each row execute function public.notify_invite();

-- ------------------------------------------------------------------- chat
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group','channel')),
  name text not null default '',
  topic text not null default '',
  direct_key text unique,           -- "<uuid>:<uuid>" (sorted) for 1:1 chats
  created_by uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);
create index if not exists conv_members_user_idx on public.conversation_members (user_id);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'text' check (kind in ('text','system','call')),
  body text not null default '',
  attachments jsonb not null default '[]',  -- [{path,name,type,size,w,h}]
  reply_to uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at desc);
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table public.conversations        enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages             enable row level security;
alter table public.message_reactions    enable row level security;

create or replace function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = c and user_id = auth.uid())
$$;
create or replace function public.is_conv_owner(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = c and user_id = auth.uid() and role = 'owner')
$$;
create or replace function public.can_see_conv(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(c) or exists (select 1 from public.conversations where id = c and kind = 'channel')
$$;

-- 1:1 chat with someone (created on first use).
create or replace function public.open_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare k text; cid uuid;
begin
  if not public.is_active() then raise exception 'Not allowed'; end if;
  if p_other = auth.uid() then raise exception 'Pick someone else'; end if;
  k := least(auth.uid()::text, p_other::text) || ':' || greatest(auth.uid()::text, p_other::text);
  select id into cid from public.conversations where direct_key = k;
  if cid is null then
    insert into public.conversations (kind, direct_key, created_by) values ('direct', k, auth.uid()) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, auth.uid()), (cid, p_other) on conflict do nothing;
  end if;
  return cid;
end $$;

-- Group chat or channel; the creator owns it.
create or replace function public.create_conversation(p_kind text, p_name text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; u uuid;
begin
  if not public.is_active() then raise exception 'Not allowed'; end if;
  if p_kind not in ('group','channel') then raise exception 'Unknown chat type'; end if;
  if p_kind = 'channel' then raise exception 'Channels are turned off — start a group chat instead'; end if;
  insert into public.conversations (kind, name, created_by) values (p_kind, coalesce(nullif(trim(p_name), ''), 'Group'), auth.uid()) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, role) values (cid, auth.uid(), 'owner');
  foreach u in array coalesce(p_members, '{}') loop
    insert into public.conversation_members (conversation_id, user_id) values (cid, u) on conflict do nothing;
  end loop;
  insert into public.messages (conversation_id, sender_id, kind, body) values (cid, auth.uid(), 'system', 'created ' || case when p_kind = 'channel' then 'the channel' else 'the group' end);
  return cid;
end $$;

drop policy if exists "see my chats and channels" on public.conversations;
drop policy if exists "owners rename" on public.conversations;
create policy "see my chats and channels" on public.conversations for select to authenticated using (kind = 'channel' or public.is_member(id));
create policy "owners rename" on public.conversations for update to authenticated
  using (public.is_conv_owner(id) or (kind = 'channel' and public.is_admin()));

drop policy if exists "see members" on public.conversation_members;
drop policy if exists "join channel or add to my group" on public.conversation_members;
drop policy if exists "update own membership" on public.conversation_members;
drop policy if exists "leave or remove" on public.conversation_members;
create policy "see members" on public.conversation_members for select to authenticated using (public.can_see_conv(conversation_id));
create policy "join channel or add to my group" on public.conversation_members for insert to authenticated with check (
  (user_id = auth.uid() and exists (select 1 from public.conversations c where c.id = conversation_id and c.kind = 'channel'))
  or (public.is_member(conversation_id) and exists (select 1 from public.conversations c where c.id = conversation_id and c.kind = 'group')));
create policy "update own membership" on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "leave or remove" on public.conversation_members for delete to authenticated using (user_id = auth.uid() or public.is_conv_owner(conversation_id));

drop policy if exists "read messages" on public.messages;
drop policy if exists "post messages" on public.messages;
drop policy if exists "edit own messages" on public.messages;
create policy "read messages" on public.messages for select to authenticated using (public.can_see_conv(conversation_id));
create policy "post messages" on public.messages for insert to authenticated with check (sender_id = auth.uid() and kind <> 'system' and public.is_member(conversation_id));
create policy "edit own messages" on public.messages for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());

drop policy if exists "read reactions" on public.message_reactions;
drop policy if exists "react" on public.message_reactions;
drop policy if exists "unreact" on public.message_reactions;
create policy "read reactions" on public.message_reactions for select to authenticated using (public.can_see_conv(conversation_id));
create policy "react" on public.message_reactions for insert to authenticated with check (user_id = auth.uid() and public.can_see_conv(conversation_id));
create policy "unreact" on public.message_reactions for delete to authenticated using (user_id = auth.uid());

-- New message → bump the chat, mark it read for the sender, notify the others.
create or replace function public.on_message() returns trigger language plpgsql security definer set search_path = public as $$
declare m record; c public.conversations; title text; preview text;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id returning * into c;
  if new.sender_id is not null then
    update public.conversation_members set last_read_at = new.created_at where conversation_id = new.conversation_id and user_id = new.sender_id;
  end if;
  if new.kind <> 'text' then return new; end if;
  preview := coalesce(nullif(left(new.body, 140), ''), case when jsonb_array_length(new.attachments) > 0 then
    case when new.attachments->0->>'type' like 'image/%' then '📷 Photo' when new.attachments->0->>'type' like 'video/%' then '🎬 Video' else '📎 File' end else '' end);
  title := case when c.kind = 'direct' then public.first_name(new.sender_id) else coalesce(nullif(c.name, ''), 'Group') || ' · ' || public.first_name(new.sender_id) end;
  for m in select user_id from public.conversation_members where conversation_id = new.conversation_id and user_id <> coalesce(new.sender_id, '00000000-0000-0000-0000-000000000000'::uuid) and not muted loop
    perform public.notify(m.user_id, 'message', title, preview, jsonb_build_object('tab', 'chat', 'conversation_id', new.conversation_id));
  end loop;
  return new;
end $$;
drop trigger if exists on_message on public.messages;
create trigger on_message after insert on public.messages for each row execute function public.on_message();

-- Messages: only the body can be edited; "delete" blanks it.
create or replace function public.guard_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.conversation_id <> old.conversation_id or new.sender_id is distinct from old.sender_id or new.kind <> old.kind or new.created_at <> old.created_at then
    raise exception 'Only the text of a message can change';
  end if;
  if new.deleted_at is not null then new.body := ''; new.attachments := '[]'; end if;
  if new.body is distinct from old.body and new.deleted_at is null then new.edited_at := now(); end if;
  return new;
end $$;
drop trigger if exists guard_message on public.messages;
create trigger guard_message before update on public.messages for each row execute function public.guard_message();

-- ------------------------------------------------------------------ calls
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  location text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  online boolean not null default true,
  organizer_id uuid references public.profiles(id) on delete set null,
  reminded boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);
create table if not exists public.event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null default 'pending' check (response in ('pending','accepted','tentative','declined')),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  started_by uuid references public.profiles(id) on delete set null,
  kind text not null default 'video' check (kind in ('voice','video')),
  status text not null default 'ringing' check (status in ('ringing','active','ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.call_participants (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.events            enable row level security;
alter table public.event_attendees   enable row level security;
alter table public.calls             enable row level security;
alter table public.call_participants enable row level security;

create or replace function public.in_event(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events where id = e and organizer_id = auth.uid())
      or exists (select 1 from public.event_attendees where event_id = e and user_id = auth.uid())
$$;
create or replace function public.in_call(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.calls k where k.id = c and (
    (k.conversation_id is not null and public.can_see_conv(k.conversation_id)) or (k.event_id is not null and public.in_event(k.event_id)) or k.started_by = auth.uid()))
$$;

drop policy if exists "see my events" on public.events;
drop policy if exists "create events" on public.events;
drop policy if exists "organiser edits" on public.events;
drop policy if exists "organiser deletes" on public.events;
create policy "see my events" on public.events for select to authenticated using (organizer_id = auth.uid() or public.in_event(id));
create policy "create events" on public.events for insert to authenticated with check (organizer_id = auth.uid());
create policy "organiser edits" on public.events for update to authenticated using (organizer_id = auth.uid());
create policy "organiser deletes" on public.events for delete to authenticated using (organizer_id = auth.uid());

drop policy if exists "see attendees" on public.event_attendees;
drop policy if exists "organiser invites" on public.event_attendees;
drop policy if exists "answer invite" on public.event_attendees;
drop policy if exists "organiser removes" on public.event_attendees;
create policy "see attendees" on public.event_attendees for select to authenticated using (public.in_event(event_id));
create policy "organiser invites" on public.event_attendees for insert to authenticated
  with check (exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid()));
create policy "answer invite" on public.event_attendees for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "organiser removes" on public.event_attendees for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.events e where e.id = event_id and e.organizer_id = auth.uid()));

drop policy if exists "see calls" on public.calls;
drop policy if exists "start calls" on public.calls;
drop policy if exists "update calls" on public.calls;
-- Check the row's own columns (looking it up by id fails during INSERT ... RETURNING).
create policy "see calls" on public.calls for select to authenticated using (started_by = auth.uid()
  or (conversation_id is not null and public.can_see_conv(conversation_id)) or (event_id is not null and public.in_event(event_id)));
create policy "start calls" on public.calls for insert to authenticated with check (started_by = auth.uid()
  and ((conversation_id is not null and public.is_member(conversation_id)) or (event_id is not null and public.in_event(event_id))));
create policy "update calls" on public.calls for update to authenticated using (started_by = auth.uid()
  or (conversation_id is not null and public.can_see_conv(conversation_id)) or (event_id is not null and public.in_event(event_id)));

drop policy if exists "see participants" on public.call_participants;
drop policy if exists "join call" on public.call_participants;
drop policy if exists "leave call" on public.call_participants;
create policy "see participants" on public.call_participants for select to authenticated using (public.in_call(call_id));
create policy "join call" on public.call_participants for insert to authenticated with check (user_id = auth.uid() and public.in_call(call_id));
create policy "leave call" on public.call_participants for update to authenticated using (user_id = auth.uid());

-- Call started → ring everyone in the chat / meeting and drop a card in the chat.
create or replace function public.on_call() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; who text := public.first_name(new.started_by); ev public.events;
begin
  if tg_op = 'INSERT' then
    if new.conversation_id is not null then
      insert into public.messages (conversation_id, sender_id, kind, body, attachments)
        values (new.conversation_id, new.started_by, 'call', new.kind, jsonb_build_array(jsonb_build_object('call_id', new.id)));
      for u in select user_id from public.conversation_members where conversation_id = new.conversation_id and user_id <> new.started_by loop
        perform public.notify(u, 'call', case when new.kind = 'voice' then '📞 ' else '🎥 ' end || who || ' is calling',
          'Tap to answer', jsonb_build_object('tab', 'chat', 'conversation_id', new.conversation_id, 'call_id', new.id));
      end loop;
    elsif new.event_id is not null then
      select * into ev from public.events where id = new.event_id;
      for u in select user_id from public.event_attendees where event_id = new.event_id and user_id <> new.started_by and response <> 'declined'
               union select ev.organizer_id where ev.organizer_id <> new.started_by loop
        perform public.notify(u, 'call', 'Meeting started: ' || ev.title, who || ' has joined', jsonb_build_object('tab', 'chat', 'event_id', ev.id, 'call_id', new.id));
      end loop;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists on_call on public.calls;
create trigger on_call after insert on public.calls for each row execute function public.on_call();

-- Last one out ends the call.
create or replace function public.leave_call(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.call_participants set left_at = now() where call_id = p_call and user_id = auth.uid() and left_at is null;
  if not exists (select 1 from public.call_participants where call_id = p_call and left_at is null) then
    update public.calls set status = 'ended', ended_at = now() where id = p_call and status <> 'ended';
  end if;
end $$;
create or replace function public.join_call(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.in_call(p_call) then raise exception 'Not invited to this call'; end if;
  if not exists (select 1 from public.call_participants where call_id = p_call and user_id = auth.uid() and left_at is null) then
    insert into public.call_participants (call_id, user_id) values (p_call, auth.uid());
  end if;
  update public.calls set status = 'active', ended_at = null where id = p_call and status <> 'active';
end $$;

-- Meeting invite → attendee
create or replace function public.on_attendee() returns trigger language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  select * into e from public.events where id = new.event_id;
  if new.user_id <> e.organizer_id then
    perform public.notify(new.user_id, 'meeting', public.first_name(e.organizer_id) || ' invited you: ' || e.title,
      to_char(e.starts_at at time zone 'Europe/London', 'Dy DD Mon, HH24:MI'), jsonb_build_object('tab', 'calendar', 'event_id', e.id));
  end if;
  return new;
end $$;
drop trigger if exists on_attendee on public.event_attendees;
create trigger on_attendee after insert on public.event_attendees for each row execute function public.on_attendee();

-- Called every minute (pg_cron): 10-minute meeting reminders.
create or replace function public.send_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare e public.events; u uuid; n int := 0;
begin
  for e in select * from public.events where not reminded and not all_day and starts_at between now() and now() + interval '10 minutes' for update skip locked loop
    for u in select user_id from public.event_attendees where event_id = e.id and response <> 'declined' union select e.organizer_id loop
      perform public.notify(u, 'reminder', 'Starting soon: ' || e.title, to_char(e.starts_at at time zone 'Europe/London', 'HH24:MI') || case when e.online then ' · online meeting' else coalesce(' · ' || nullif(e.location, ''), '') end,
        jsonb_build_object('tab', 'calendar', 'event_id', e.id));
    end loop;
    update public.events set reminded = true where id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.send_reminders() from public, anon, authenticated;

-- Notifications / push / presence policies
drop policy if exists "own notifications" on public.notifications;
drop policy if exists "mark read" on public.notifications;
drop policy if exists "clear own" on public.notifications;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "mark read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "clear own" on public.notifications for delete to authenticated using (user_id = auth.uid());
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['notifications','push_subscriptions','conversations','conversation_members','messages','message_reactions',
                           'events','event_attendees','calls','call_participants'] loop
    execute format('drop policy if exists "active staff only" on public.%I', t);
    execute format('create policy "active staff only" on public.%I as restrictive for all to authenticated using (public.is_active()) with check (public.is_active())', t);
  end loop;
end $$;

revoke all on function public.open_direct(uuid) from public, anon;
revoke all on function public.create_conversation(text, text, uuid[]) from public, anon;
revoke all on function public.join_call(uuid) from public, anon;
revoke all on function public.leave_call(uuid) from public, anon;
grant execute on function public.open_direct(uuid) to authenticated;
grant execute on function public.create_conversation(text, text, uuid[]) to authenticated;
grant execute on function public.join_call(uuid) to authenticated;
grant execute on function public.leave_call(uuid) to authenticated;
grant execute on function public.vapid_public_key() to authenticated;

-- Private bucket for chat photos, videos and files: <conversation_id>/<file>
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit) values ('chat', 'chat', false, 52428800)
      on conflict (id) do update set public = false;
    drop policy if exists "chat files read" on storage.objects;
    drop policy if exists "chat files write" on storage.objects;
    create policy "chat files read" on storage.objects for select to authenticated
      using (bucket_id = 'chat' and public.can_see_conv(((storage.foldername(name))[1])::uuid));
    create policy "chat files write" on storage.objects for insert to authenticated
      with check (bucket_id = 'chat' and public.is_member(((storage.foldername(name))[1])::uuid));
  end if;
end $$;

-- No channels: chats are 1:1 and groups only (channels felt too much like Discord).

-- New starters land in every channel once their account is active.
create or replace function public.join_channels() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.active and (tg_op = 'INSERT' or not old.active) then
    insert into public.conversation_members (conversation_id, user_id)
    select id, new.id from public.conversations where kind = 'channel' on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists join_channels on public.profiles;
create trigger join_channels after insert or update of active on public.profiles for each row execute function public.join_channels();

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['notifications','conversations','conversation_members','messages','message_reactions',
                             'events','event_attendees','calls','call_participants'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null; end;
    end loop;
  end if;
end $$;

-- App crash reports (written by the app, read by admins/support only via SQL).
create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  message text not null default '',
  stack text not null default '',
  place text not null default '',
  url text not null default '',
  user_agent text not null default '',
  app_version text not null default '',
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;
drop policy if exists "report errors" on public.client_errors;
create policy "report errors" on public.client_errors for insert to anon, authenticated
  with check ((user_id is null or user_id = auth.uid()) and length(message) <= 500 and length(stack) <= 4000);

-- ============================================================================
-- Kimera (back office): sales orders + quotes, order lines, manufacturing
-- orders, delivery, and a ticket system on top of worker issues.
-- ============================================================================
create sequence if not exists public.so_seq start 90001;
create sequence if not exists public.qt_seq start 1001;
create sequence if not exists public.mo_seq start 1001;
create sequence if not exists public.tk_seq start 1;

alter table public.orders add column if not exists kind text not null default 'order' check (kind in ('quote','order'));
alter table public.orders add column if not exists status text not null default 'open' check (status in ('open','done','cancelled'));
alter table public.orders add column if not exists delivery text not null default 'not_shipped' check (delivery in ('not_shipped','packed','shipped','delivered'));
alter table public.orders add column if not exists delivery_deadline date;
alter table public.orders add column if not exists source text not null default 'manual' check (source in ('shopify','manual'));
alter table public.orders add column if not exists stock_out boolean not null default false;
alter table public.orders add column if not exists tracking text not null default '';
alter table public.orders add column if not exists packed_at timestamptz;
alter table public.orders add column if not exists shipped_at timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists created_by uuid references public.profiles(id) on delete set null;
update public.orders set source = 'shopify' where shopify_id is not null and source <> 'shopify';

-- New quotes / sales orders get their number here (Shopify orders bring their own).
create or replace function public.number_order() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(new.order_number, '') = '' then
    new.order_number := case when new.kind = 'quote' then 'QT-' || nextval('public.qt_seq') else 'SO-' || nextval('public.so_seq') end;
  end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists number_order on public.orders;
create trigger number_order before insert on public.orders for each row execute function public.number_order();

create table if not exists public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid references public.stock_items(id) on delete set null,
  sku text not null default '',
  name text not null default '',
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,2),
  sort int not null default 0,
  shopify_line_id bigint unique,
  created_at timestamptz not null default now()
);
create index if not exists order_lines_order_idx on public.order_lines (order_id);
alter table public.jobs add column if not exists order_line_id uuid references public.order_lines(id) on delete set null;
alter table public.order_lines enable row level security;
drop policy if exists "staff read order lines" on public.order_lines;
drop policy if exists "office edit order lines" on public.order_lines;
create policy "staff read order lines" on public.order_lines for select to authenticated using (true);
create policy "office edit order lines" on public.order_lines for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "leads edit orders" on public.orders;
drop policy if exists "office edit orders" on public.orders;
create policy "office edit orders" on public.orders for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Existing Shopify jobs → order lines (one per job), linked back.
do $$
declare j record; lid uuid;
begin
  for j in select * from public.jobs where order_id is not null and order_line_id is null order by created_at loop
    insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price, sort, shopify_line_id)
    values (j.order_id, (select id from public.stock_items where sku = j.sku order by (kind = 'material') limit 1),
            coalesce(j.sku, ''), j.title, coalesce(j.quantity, 1), j.unit_price,
            (select count(*) from public.order_lines where order_id = j.order_id), j.shopify_line_id)
    on conflict (shopify_line_id) do nothing
    returning id into lid;
    if lid is null and j.shopify_line_id is not null then select id into lid from public.order_lines where shopify_line_id = j.shopify_line_id; end if;
    update public.jobs set order_line_id = lid where id = j.id;
  end loop;
end $$;

-- Stock leaves when an order ships.
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('adjust','count','receive','consume','produce','import','opening','ship'));

-- Manufacturing order: for a sales order line (make to order) or for stock.
create or replace function public.create_mo(p_sku text, p_title text, p_qty numeric, p_due date default null, p_line uuid default null, p_route uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.order_lines; o public.orders; r uuid[]; code text; jid uuid; idx int; n int; pr public.products;
begin
  if not public.is_admin() then raise exception 'Only the office team can plan production'; end if;
  if p_line is not null then
    select * into l from public.order_lines where id = p_line;
    if l.id is null then raise exception 'Order line not found'; end if;
    if exists (select 1 from public.jobs where order_line_id = l.id) then raise exception 'This line already has a manufacturing order'; end if;
    select * into o from public.orders where id = l.order_id;
    if o.kind = 'quote' then raise exception 'Turn the quote into a sales order first'; end if;
    select count(*), count(*) filter (where ol.sort < l.sort or (ol.sort = l.sort and ol.created_at <= l.created_at))
      into n, idx from public.order_lines ol where ol.order_id = o.id;
    code := case when n > 1 then o.order_number || '-' || idx else o.order_number end;
    p_sku := coalesce(nullif(p_sku, ''), nullif(l.sku, '')); p_title := coalesce(nullif(p_title, ''), l.name); p_qty := coalesce(p_qty, l.quantity);
    p_due := coalesce(p_due, o.delivery_deadline);
  else
    code := 'STK-' || nextval('public.mo_seq');
  end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
  select * into pr from public.products where sku = p_sku;
  r := case when coalesce(array_length(p_route, 1), 0) > 0 then p_route
            when coalesce(array_length(pr.route, 1), 0) > 0 then pr.route else public.default_route() end;
  insert into public.jobs (code, title, customer, priority, status, assignees, quantity, estimate_minutes, due_date, created_by,
                           order_id, order_line_id, sku, route, stage, station_id, unit_price)
  values (code, coalesce(nullif(p_title, ''), p_sku, 'Manufacturing order'), coalesce(o.customer, ''), 3, 'open', public.station_assignees(r[1]),
          ceil(p_qty)::int, pr.estimate_minutes, p_due, auth.uid(), o.id, l.id, nullif(p_sku, ''), r, 0, r[1], l.unit_price)
  returning id into jid;
  return jid;
end $$;
revoke all on function public.create_mo(text, text, numeric, date, uuid, uuid[]) from public, anon;
grant execute on function public.create_mo(text, text, numeric, date, uuid, uuid[]) to authenticated;

-- Pack / ship / deliver. Lines sold from stock (no manufacturing order) leave stock on ship.
create or replace function public.set_delivery(p_order uuid, p_state text) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders; l record; out_states text[] := array['shipped','delivered'];
begin
  if not public.is_admin() then raise exception 'Only the office team can change delivery'; end if;
  if p_state not in ('not_shipped','packed','shipped','delivered') then raise exception 'Unknown delivery state'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.kind = 'quote' then raise exception 'Quotes are not delivered'; end if;
  if p_state = any(out_states) and not o.stock_out then
    for l in select * from public.order_lines ol where ol.order_id = o.id and ol.item_id is not null
               and not exists (select 1 from public.jobs j where j.order_line_id = ol.id) loop
      perform public.move_stock(l.item_id, -l.quantity, 'ship', o.order_number, '');
    end loop;
    o.stock_out := true;
  elsif not (p_state = any(out_states)) and o.stock_out then
    for l in select * from public.order_lines ol where ol.order_id = o.id and ol.item_id is not null
               and not exists (select 1 from public.jobs j where j.order_line_id = ol.id) loop
      perform public.move_stock(l.item_id, l.quantity, 'ship', o.order_number, 'Shipment undone');
    end loop;
    o.stock_out := false;
  end if;
  update public.orders set delivery = p_state, stock_out = o.stock_out,
    packed_at = case when p_state = 'not_shipped' then null when p_state = 'packed' then coalesce(packed_at, now()) else coalesce(packed_at, now()) end,
    shipped_at = case when p_state = any(out_states) then coalesce(shipped_at, now()) else null end,
    delivered_at = case when p_state = 'delivered' then coalesce(delivered_at, now()) else null end,
    status = case when p_state = 'delivered' then 'done' when status = 'done' then 'open' else status end
  where id = o.id;
  return p_state;
end $$;
revoke all on function public.set_delivery(uuid, text) from public, anon;
grant execute on function public.set_delivery(uuid, text) to authenticated;

-- Quote → sales order (gets an SO number).
create or replace function public.convert_quote(p_order uuid) returns text
language plpgsql security definer set search_path = public as $$
declare num text;
begin
  if not public.is_admin() then raise exception 'Only the office team can do this'; end if;
  num := 'SO-' || nextval('public.so_seq');
  update public.orders set kind = 'order', order_number = num, status = 'open', ordered_at = coalesce(ordered_at, now())
   where id = p_order and kind = 'quote';
  if not found then raise exception 'Quote not found'; end if;
  return num;
end $$;
revoke all on function public.convert_quote(uuid) from public, anon;
grant execute on function public.convert_quote(uuid) to authenticated;

-- Shopify: also keep order lines (jobs link to them).
create or replace function public.ingest_shopify_order(o jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  addr jsonb := coalesce(nullif(o->'shipping_address', 'null'::jsonb), nullif(o->'billing_address', 'null'::jsonb), '{}'::jsonb);
  cust text; oid uuid; li jsonb; p public.products; r uuid[]; lines int; idx int := 0; made int := 0; props text; jid uuid; lid uuid;
  oname text := coalesce(nullif(o->>'name', ''), '#' || (o->>'order_number'), '#' || (o->>'id'));
begin
  cust := coalesce(nullif(trim(concat_ws(' ', addr->>'first_name', addr->>'last_name')), ''),
                   nullif(trim(concat_ws(' ', o->'customer'->>'first_name', o->'customer'->>'last_name')), ''),
                   nullif(o->>'email', ''), '');
  insert into public.orders (shopify_id, order_number, customer, company, email, phone, ship_to, shipping_method, note, ordered_at, total_price, currency, source, kind)
  values ((o->>'id')::bigint, oname, cust, coalesce(addr->>'company', ''), coalesce(o->>'email', ''),
          coalesce(nullif(addr->>'phone', ''), nullif(o->>'phone', ''), ''),
          concat_ws(', ', nullif(addr->>'address1', ''), nullif(addr->>'address2', ''), nullif(addr->>'city', ''),
                    nullif(addr->>'province', ''), nullif(addr->>'zip', ''), nullif(addr->>'country', '')),
          coalesce((select string_agg(s->>'title', ', ') from jsonb_array_elements(coalesce(o->'shipping_lines', '[]'::jsonb)) s), ''),
          coalesce(o->>'note', ''), (o->>'created_at')::timestamptz,
          case when o->>'total_price' ~ '^[0-9]+(\.[0-9]+)?$' then (o->>'total_price')::numeric end, coalesce(nullif(o->>'currency', ''), 'GBP'),
          'shopify', 'order')
  on conflict (shopify_id) do update set customer = excluded.customer, company = excluded.company, email = excluded.email,
    phone = excluded.phone, ship_to = excluded.ship_to, shipping_method = excluded.shipping_method, note = excluded.note,
    total_price = coalesce(excluded.total_price, orders.total_price), currency = excluded.currency
  returning id into oid;

  select count(*) into lines from jsonb_array_elements(coalesce(o->'line_items', '[]'::jsonb)) x
   where coalesce((x->>'gift_card')::boolean, false) = false;

  for li in select * from jsonb_array_elements(coalesce(o->'line_items', '[]'::jsonb)) loop
    continue when coalesce((li->>'gift_card')::boolean, false);
    idx := idx + 1;
    p := null;
    if nullif(trim(li->>'sku'), '') is not null then
      select * into p from public.products where sku = trim(li->>'sku');
      if p.id is null then
        insert into public.products (sku, name, route) values (trim(li->>'sku'), coalesce(li->>'title', ''), public.default_route())
        on conflict (sku) do nothing;
        select * into p from public.products where sku = trim(li->>'sku');
      end if;
    end if;
    lid := null;
    insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price, sort, shopify_line_id)
    values (oid, (select id from public.stock_items where sku = nullif(trim(li->>'sku'), '') order by (kind = 'material') limit 1),
            coalesce(trim(li->>'sku'), ''), concat_ws(' - ', li->>'title', nullif(replace(li->>'variant_title', ' / ', ' - '), '')),
            greatest(coalesce((li->>'quantity')::numeric, 1), 1), case when li->>'price' ~ '^[0-9]+(\.[0-9]+)?$' then (li->>'price')::numeric end,
            idx, (li->>'id')::bigint)
    on conflict (shopify_line_id) do nothing
    returning id into lid;
    if lid is null then select id into lid from public.order_lines where shopify_line_id = (li->>'id')::bigint; end if;
    r := case when coalesce(array_length(p.route, 1), 0) > 0 then p.route else public.default_route() end;
    select string_agg((pr->>'name') || ': ' || (pr->>'value'), E'\n') into props
      from jsonb_array_elements(coalesce(li->'properties', '[]'::jsonb)) pr where left(pr->>'name', 1) <> '_';
    insert into public.jobs (code, title, description, customer, priority, status, assignees, quantity,
                             estimate_minutes, order_id, order_line_id, sku, route, stage, station_id, shopify_line_id, unit_price)
    values (case when lines > 1 then oname || '-' || idx else oname end,
            concat_ws(' - ', li->>'title', nullif(replace(li->>'variant_title', ' / ', ' - '), '')),
            concat_ws(E'\n', props, nullif(o->>'note', '')),
            cust, 3, 'open', public.station_assignees(r[1]), coalesce((li->>'quantity')::int, 1),
            p.estimate_minutes, oid, lid, nullif(trim(li->>'sku'), ''), r, 0, r[1], (li->>'id')::bigint,
            case when li->>'price' ~ '^[0-9]+(\.[0-9]+)?$' then (li->>'price')::numeric end)
    on conflict (shopify_line_id) do nothing
    returning id into jid;
    if jid is not null then made := made + 1; end if;
    jid := null;
  end loop;
  return made;
end $$;
revoke all on function public.ingest_shopify_order(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_shopify_order(jsonb) to service_role;

-- Tickets: worker issues get a number, an owner, a thread and history.
alter table public.issues add column if not exists number int not null default nextval('public.tk_seq');
alter table public.issues add column if not exists assignee_id uuid references public.profiles(id) on delete set null;
alter table public.issues add column if not exists updated_at timestamptz not null default now();
alter table public.issues add column if not exists resolved_at timestamptz;
drop policy if exists "triage issue" on public.issues;
create policy "triage issue" on public.issues for update to authenticated
  using (reported_by = auth.uid() or assignee_id = auth.uid() or public.is_admin());

create table if not exists public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  kind text not null default 'comment' check (kind in ('comment','event')),
  created_at timestamptz not null default now()
);
create index if not exists issue_comments_issue_idx on public.issue_comments (issue_id, created_at);
alter table public.issue_comments enable row level security;
drop policy if exists "staff read ticket comments" on public.issue_comments;
drop policy if exists "add ticket comment" on public.issue_comments;
create policy "staff read ticket comments" on public.issue_comments for select to authenticated using (true);
create policy "add ticket comment" on public.issue_comments for insert to authenticated
  with check (author_id = auth.uid() and kind = 'comment' and exists (
    select 1 from public.issues i where i.id = issue_id and (i.reported_by = auth.uid() or i.assignee_id = auth.uid() or public.is_admin())));

create or replace function public.ticket_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := coalesce(public.first_name(auth.uid()), 'Someone'); tag text := 'TK-' || new.number || ' · ' || new.title;
  lbl jsonb := '{"open":"Open","acknowledged":"In progress","resolved":"Resolved"}';
begin
  new.updated_at := now();
  if new.status = 'resolved' and old.status <> 'resolved' then new.resolved_at := now(); new.resolved_by := coalesce(new.resolved_by, auth.uid());
  elsif new.status <> 'resolved' then new.resolved_at := null; end if;
  if new.status is distinct from old.status then
    insert into public.issue_comments (issue_id, author_id, body, kind) values (new.id, auth.uid(), 'status:' || new.status, 'event');
    if new.reported_by is distinct from auth.uid() then
      perform public.notify(new.reported_by, 'ticket', tag, who || ' set it to ' || coalesce(lbl->>new.status, new.status), '{"tab":"issues"}');
    end if;
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.issue_comments (issue_id, author_id, body, kind) values (new.id, auth.uid(), 'assign:' || coalesce(new.assignee_id::text, ''), 'event');
    if new.assignee_id is not null and new.assignee_id is distinct from auth.uid() then
      perform public.notify(new.assignee_id, 'ticket', 'Ticket given to you', tag, '{"tab":"issues"}');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ticket_changed on public.issues;
create trigger ticket_changed before update on public.issues for each row execute function public.ticket_changed();

create or replace function public.ticket_comment() returns trigger language plpgsql security definer set search_path = public as $$
declare i public.issues; u uuid;
begin
  if new.kind <> 'comment' then return new; end if;
  select * into i from public.issues where id = new.issue_id;
  for u in select distinct x from unnest(array[i.reported_by, i.assignee_id]) x where x is not null and x is distinct from new.author_id loop
    perform public.notify(u, 'ticket', 'TK-' || i.number || ' · ' || coalesce(public.first_name(new.author_id), 'Someone') || ' replied', new.body, '{"tab":"issues"}');
  end loop;
  return new;
end $$;
drop trigger if exists ticket_comment on public.issue_comments;
create trigger ticket_comment after insert on public.issue_comments for each row execute function public.ticket_comment();

-- New ticket → the office team (owner, managers, office).
create or replace function public.ticket_new() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  for u in select id from public.profiles where active and role in ('boss','manager','office') and id <> new.reported_by loop
    perform public.notify(u, 'ticket', 'New ticket TK-' || new.number || ' · ' || new.severity, public.first_name(new.reported_by) || ': ' || new.title, '{"tab":"issues"}');
  end loop;
  return new;
end $$;
drop trigger if exists ticket_new on public.issues;
create trigger ticket_new after insert on public.issues for each row execute function public.ticket_new();

do $$ begin
  alter publication supabase_realtime add table public.order_lines;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.issue_comments;
exception when others then null; end $$;
grant usage, select on sequence public.so_seq, public.qt_seq, public.mo_seq, public.tk_seq to authenticated;

-- Office plans production in Kimera: owner, managers and office manage jobs.
drop policy if exists "leads create jobs" on public.jobs;
drop policy if exists "leads or crew update jobs" on public.jobs;
drop policy if exists "leads delete jobs" on public.jobs;
drop policy if exists "office create jobs" on public.jobs;
drop policy if exists "office or crew update jobs" on public.jobs;
drop policy if exists "office delete jobs" on public.jobs;
create policy "office create jobs" on public.jobs for insert to authenticated with check (public.is_admin());
create policy "office or crew update jobs" on public.jobs for update to authenticated using (public.is_admin() or public.on_job(id));
create policy "office delete jobs" on public.jobs for delete to authenticated using (public.is_admin());

-- ============================================================================
-- Clock in / out reminders (UK time). The working day runs 02:00 → 02:00.
--   Clock in  05:59, 13:59 (Mon–Fri): people who are not clocked in and have
--             not had a shift yet today, and are not on approved leave.
--   Clock out 14:01, 22:01, 02:00: people still clocked in after 4+ hours.
-- Runs every minute from pg_cron; each reminder goes once per person.
-- ============================================================================
create table if not exists public.reminder_log (
  kind text not null,
  day date not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (kind, day, user_id)
);
alter table public.reminder_log enable row level security;

create or replace function public.shift_reminders(p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  lt timestamp := p_at at time zone 'Europe/London';
  hm text := to_char(lt, 'HH24:MI');
  wday date := (lt - interval '2 hours')::date;
  day_start timestamptz := (wday + time '02:00') at time zone 'Europe/London';
  u uuid; n int := 0;
begin
  if hm in ('05:59', '13:59') and extract(isodow from wday) <= 5 then
    for u in
      select p.id from public.profiles p
       where p.active and p.role <> 'boss'
         and (p.role in ('operator', 'assistant') or exists (select 1 from public.shifts s where s.user_id = p.id and s.clock_in > p_at - interval '30 days'))
         and not exists (select 1 from public.shifts s where s.user_id = p.id and (s.clock_out is null or s.clock_in >= day_start))
         and not exists (select 1 from public.absences a where a.user_id = p.id and a.status = 'approved' and wday between a.start_date and a.end_date)
    loop
      insert into public.reminder_log (kind, day, user_id) values ('in-' || hm, wday, u) on conflict do nothing;
      if found then
        perform public.notify(u, 'clock', 'Time to clock in', case when hm = '05:59' then 'Your shift starts at 6:00' else 'The afternoon shift starts at 14:00' end, '{"tab":"home"}');
        n := n + 1;
      end if;
    end loop;
  elsif hm in ('14:01', '22:01', '02:00') then
    for u in select distinct s.user_id from public.shifts s join public.profiles p on p.id = s.user_id
              where p.active and s.clock_out is null and s.clock_in < p_at - interval '4 hours' loop
      insert into public.reminder_log (kind, day, user_id) values ('out-' || hm, lt::date, u) on conflict do nothing;
      if found then
        perform public.notify(u, 'clock', 'Clock out?', 'Your shift has ended — clock out before you leave', '{"tab":"home"}');
        n := n + 1;
      end if;
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.shift_reminders(timestamptz) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'shift-reminders';
    perform cron.schedule('shift-reminders', '* * * * *', 'select public.shift_reminders()');
  end if;
end $$;

-- ============================================================================
-- Keep-in-stock builds: e.g. "always 1 pedestal frame ready upstairs".
-- When on-hand + already-in-production drops below make_min, a make-to-stock
-- manufacturing order (STK-…) is raised for the downstairs crew automatically.
-- ============================================================================
alter table public.stock_items add column if not exists make_min numeric(14,3) not null default 0 check (make_min >= 0);
alter table public.stock_items add column if not exists make_batch numeric(14,3) not null default 1 check (make_batch > 0);

create or replace function public.replenish(p_item uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare s public.stock_items; busy numeric; q numeric; r uuid[]; pr public.products; n int := 0;
begin
  for s in select * from public.stock_items where make_min > 0 and not archived and (p_item is null or id = p_item) loop
    select coalesce(sum(quantity), 0) into busy from public.jobs
     where sku = s.sku and order_id is null and status <> 'done';
    if s.quantity + busy >= s.make_min then continue; end if;
    q := greatest(s.make_batch, s.make_min - s.quantity - busy);
    select * into pr from public.products where sku = s.sku;
    r := case when coalesce(array_length(pr.route, 1), 0) > 0 then pr.route else public.default_route() end;
    insert into public.jobs (code, title, description, customer, priority, status, assignees, quantity, estimate_minutes,
                             sku, route, stage, station_id)
    values ('STK-' || nextval('public.mo_seq'), 'Restock: ' || s.name,
            'Keep ' || trim(to_char(s.make_min, 'FM999990.###')) || ' ready' || coalesce(' (' || nullif(s.location, '') || ')', '') || ' — raised automatically.',
            '', 3, 'open', public.station_assignees(r[1]), ceil(q)::int, pr.estimate_minutes, s.sku, r, 0, r[1]);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.replenish(uuid) from public, anon, authenticated;

create or replace function public.replenish_on_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.make_min > 0 then perform public.replenish(new.id); end if;
  return null;
end $$;
drop trigger if exists replenish_on_change on public.stock_items;
create trigger replenish_on_change after insert or update of quantity, make_min, make_batch, archived on public.stock_items
  for each row execute function public.replenish_on_change();
