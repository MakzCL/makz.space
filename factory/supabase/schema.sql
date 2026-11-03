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
-- Developer: full owner access (same rights as Owner/'boss'), shown as its own role.
alter type public.staff_role add value if not exists 'developer' before 'boss';

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
  select coalesce(public.my_role() in ('developer','boss','manager'), false)
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('developer','boss','manager','office'), false)
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
  if (new.role is distinct from old.role) then
    if not public.is_admin() then raise exception 'Only the owner, managers or office can change roles'; end if;
    if new.id = auth.uid() then raise exception 'You cannot change your own role'; end if;
    if (new.role in ('boss','developer') or old.role in ('boss','developer')) and public.my_role() not in ('boss','developer') then
      raise exception 'Only the owner can give or take away Owner or Developer';
    end if;
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
create policy "boss removes staff" on public.profiles for delete to authenticated using (public.my_role() in ('boss','developer'));

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
create policy "boss reads links" on public.join_links for select to authenticated using (public.my_role() in ('boss','developer'));
create policy "boss revokes links" on public.join_links for update to authenticated using (public.my_role() in ('boss','developer'));

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
  if coalesce(public.my_role() not in ('boss','developer'), true) or not public.is_active() then raise exception 'Only the owner can create invite links'; end if;
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
  select coalesce(public.my_role() in ('developer','boss','manager','office','assistant'), false) and public.is_active()
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
            case when lower(r->>'kind') in ('product','material','part','service') then lower(r->>'kind') else 'material' end,
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
    if r ? 'notes' then update public.stock_items set notes = coalesce(r->>'notes', '') where id = iid; end if;
    if r ? 'barcode' then update public.stock_items set barcode = nullif(trim(r->>'barcode'), '') where id = iid; end if;
    if r->>'quantity' ~ num then
      perform public.move_stock(iid, (r->>'quantity')::numeric - (select quantity from public.stock_items where id = iid), 'import', 'Katana import', '');
    end if;
    -- Keep-ready rule last, so a build is only raised for what is really missing.
    if r->>'make_batch' ~ num and (r->>'make_batch')::numeric > 0 then update public.stock_items set make_batch = (r->>'make_batch')::numeric where id = iid; end if;
    if r->>'make_min' ~ num then update public.stock_items set make_min = greatest((r->>'make_min')::numeric, 0) where id = iid; end if;
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
      for u in select id from public.profiles where active and role in ('developer','boss','manager') and not (id = any(coalesce(new.assignees, '{}'))) loop
        perform public.notify(u, 'job_new', 'New order ' || new.code, new.title || ' ×' || trim_scale(coalesce(new.quantity, 1)::numeric), jsonb_build_object('tab', 'jobs', 'job_id', new.id));
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
-- Kortana (back office): sales orders + quotes, order lines, manufacturing
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
  for u in select id from public.profiles where active and role in ('developer','boss','manager','office') and id <> new.reported_by loop
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

-- Office plans production in Kortana: owner, managers and office manage jobs.
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
       where p.active and p.role not in ('boss','developer')
         and (p.role in ('operator', 'assistant', 'support') or exists (select 1 from public.shifts s where s.user_id = p.id and s.clock_in > p_at - interval '30 days'))
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

-- ============================================================================
-- Calls: a 1:1 call ends for both as soon as either person hangs up; anyone who
-- was rung but never joined gets a "Missed call" notification (push + Activity).
-- ============================================================================
create or replace function public.leave_call(p_call uuid) returns void
language plpgsql security definer set search_path = public as $$
declare k public.calls; direct boolean;
begin
  update public.call_participants set left_at = now() where call_id = p_call and user_id = auth.uid() and left_at is null;
  select * into k from public.calls where id = p_call;
  select c.kind = 'direct' into direct from public.conversations c where c.id = k.conversation_id;
  if coalesce(direct, false) or not exists (select 1 from public.call_participants where call_id = p_call and left_at is null) then
    update public.call_participants set left_at = now() where call_id = p_call and left_at is null;
    update public.calls set status = 'ended', ended_at = now() where id = p_call and status <> 'ended';
  end if;
end $$;
revoke all on function public.leave_call(uuid) from public, anon;
grant execute on function public.leave_call(uuid) to authenticated;

create or replace function public.missed_call() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid; who text := coalesce(public.first_name(new.started_by), 'Someone');
begin
  if new.status <> 'ended' or old.status = 'ended' or new.conversation_id is null then return new; end if;
  for u in select m.user_id from public.conversation_members m
            where m.conversation_id = new.conversation_id and m.user_id is distinct from new.started_by
              and not exists (select 1 from public.call_participants p where p.call_id = new.id and p.user_id = m.user_id) loop
    perform public.notify(u, 'missed_call', 'Missed ' || case when new.kind = 'voice' then 'call' else 'video call' end || ' from ' || who,
      'Tap to call back', jsonb_build_object('tab', 'chat', 'conversation_id', new.conversation_id));
  end loop;
  return new;
end $$;
drop trigger if exists missed_call on public.calls;
create trigger missed_call after update of status on public.calls for each row execute function public.missed_call();


-- ============================================================================
-- Support role (a position without admin rights) + admins add missed shifts.
-- ============================================================================
alter type public.staff_role add value if not exists 'support' before 'operator';
drop policy if exists "admin adds shifts" on public.shifts;
create policy "admin adds shifts" on public.shifts for insert to authenticated with check (public.is_admin());

-- ============================================================================
-- Kortana = Katana 1:1 for manufacturing stock:
--  * every movement booked by a manufacturing order carries its job_id
--  * finishing an MO consumes its recipe × quantity (sub-assemblies are their own
--    MOs: building the frame consumes screws/pieces and puts the frame on stock;
--    building the pedestal consumes the frame)
--  * reopening a finished MO reverses exactly what it booked (even if the recipe
--    changed since), so stock always matches reality
--  * the office can complete / reopen an MO from Kortana
-- ============================================================================
alter table public.stock_movements add column if not exists job_id uuid references public.jobs(id) on delete set null;
create index if not exists stock_movements_job_idx on public.stock_movements (job_id);

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
  insert into public.stock_movements (item_id, delta, after, reason, ref, note, unit_cost, user_id, job_id)
  values (s.id, p_delta, q, p_reason, coalesce(p_ref, ''), coalesce(p_note, ''), p_cost, auth.uid(),
          nullif(current_setting('app.stock_job', true), '')::uuid);
  return q;
end $$;
revoke all on function public.move_stock(uuid, numeric, text, text, text, numeric) from public, anon, authenticated;

create or replace function public.book_job_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prod public.stock_items;
  b record;
  m record;
  qty numeric := coalesce(new.quantity, 1);
begin
  -- Reopened: put back exactly what this MO booked (net per item, any number of cycles).
  if old.status = 'done' and new.status <> 'done' and old.stock_booked then
    perform set_config('app.stock_job', new.id::text, true);
    for m in select item_id, reason, sum(delta) as net from public.stock_movements
              where job_id = new.id and reason in ('consume', 'produce') group by item_id, reason having sum(delta) <> 0 loop
      perform public.move_stock(m.item_id, -m.net, m.reason, new.code, 'Reopened — reversed');
    end loop;
    perform set_config('app.stock_job', '', true);
    new.stock_booked := false;
    return new;
  end if;
  if new.status <> 'done' or old.status = 'done' or new.stock_booked or new.sku is null then return new; end if;
  select * into prod from public.stock_items where sku = new.sku and kind <> 'material' limit 1;
  if prod.id is null then select * into prod from public.stock_items where sku = new.sku limit 1; end if;
  if prod.id is null then return new; end if;
  perform set_config('app.stock_job', new.id::text, true);
  for b in select material_id, quantity from public.bom_lines where product_id = prod.id loop
    perform public.move_stock(b.material_id, -(b.quantity * qty), 'consume', new.code, '');
  end loop;
  if new.order_id is null then
    perform public.move_stock(prod.id, qty, 'produce', new.code, '');
  end if;
  perform set_config('app.stock_job', '', true);
  new.stock_booked := true;
  return new;
end $$;
drop trigger if exists book_job_stock on public.jobs;
create trigger book_job_stock before update of status on public.jobs
  for each row execute function public.book_job_stock();

-- Office: finish or reopen a manufacturing order from Kortana.
create or replace function public.complete_mo(p_job uuid) returns text
language plpgsql security definer set search_path = public as $$
declare j public.jobs;
begin
  if not public.is_admin() then raise exception 'Only the office team can complete manufacturing orders'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  if j.status = 'done' then return 'done'; end if;
  update public.work_sessions set ended_at = now() where job_id = j.id and ended_at is null;
  update public.participants set left_at = now() where job_id = j.id and left_at is null;
  update public.jobs set status = 'done', completed_at = now(),
    stage = greatest(coalesce(array_length(route, 1), 1) - 1, 0) where id = j.id;
  return 'done';
end $$;
create or replace function public.reopen_mo(p_job uuid) returns text
language plpgsql security definer set search_path = public as $$
declare j public.jobs;
begin
  if not public.is_admin() then raise exception 'Only the office team can reopen manufacturing orders'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  if j.status <> 'done' then return j.status; end if;
  update public.jobs set status = 'open', completed_at = null,
    station_id = case when coalesce(array_length(route, 1), 0) > 0 then route[stage + 1] else station_id end,
    assignees = case when coalesce(array_length(route, 1), 0) > 0 then public.station_assignees(route[stage + 1]) else assignees end
  where id = j.id;
  return 'open';
end $$;
revoke all on function public.complete_mo(uuid) from public, anon;
revoke all on function public.reopen_mo(uuid) from public, anon;
grant execute on function public.complete_mo(uuid) to authenticated;
grant execute on function public.reopen_mo(uuid) to authenticated;

-- ============================================================================
-- KORTANA phase 1 — ledger foundations (docs/kimera-coverage.md, defects D1–D7)
--  * company settings: base currency every cost and value is kept in
--  * service items (never stocked)
--  * the ledger keeps its history (no cascade delete), every movement records
--    the cost it moved at and the document it came from (source_type/source_id)
--  * manufacturing output is costed from the materials it consumed; make-to-order
--    output goes on stock and leaves again when the order line ships
--  * per-line shipping (partial fulfilment), undo and customer returns
--  * idempotency keys: a retried / double-clicked receive or adjustment books once
--  * purchase orders in a supplier currency carry an exchange rate to base
--  * fractional manufacturing quantities (no silent rounding up)
--  * audit log: who changed which business record, when, from → to
--  * posted stock is never deleted silently: reverse first
-- ============================================================================

-- ---------------------------------------------------------------- settings
create table if not exists public.company_settings (
  id int primary key default 1 check (id = 1),
  base_currency text not null default 'GBP' check (base_currency ~ '^[A-Z]{3}$'),
  default_lead_days int not null default 14 check (default_lead_days >= 0),
  updated_at timestamptz not null default now()
);
insert into public.company_settings (id) values (1) on conflict (id) do nothing;
alter table public.company_settings enable row level security;
drop policy if exists "staff read settings" on public.company_settings;
drop policy if exists "office edit settings" on public.company_settings;
create policy "staff read settings" on public.company_settings for select to authenticated using (true);
create policy "office edit settings" on public.company_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- service items
alter table public.stock_items drop constraint if exists stock_items_kind_check;
alter table public.stock_items add constraint stock_items_kind_check check (kind in ('material','product','part','service'));

-- ---------------------------------------------------------------- ledger
alter table public.stock_movements add column if not exists source_type text;
alter table public.stock_movements add column if not exists source_id uuid;
create index if not exists stock_movements_source_idx on public.stock_movements (source_type, source_id);
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('adjust','count','receive','consume','produce','import','opening','ship','return'));
-- D1: deleting an item must never erase its posted history.
alter table public.stock_movements drop constraint if exists stock_movements_item_id_fkey;
alter table public.stock_movements add constraint stock_movements_item_id_fkey
  foreign key (item_id) references public.stock_items(id) on delete restrict;

create or replace function public.guard_item_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.stock_movements where item_id = old.id) then
    raise exception 'This item has stock history — archive it instead of deleting it';
  end if;
  return old;
end $$;
drop trigger if exists guard_item_delete on public.stock_items;
create trigger guard_item_delete before delete on public.stock_items for each row execute function public.guard_item_delete();

-- Which document the next movements belong to (transaction-local).
create or replace function public.stock_source(p_type text, p_id uuid) returns void
language plpgsql set search_path = public as $$
begin
  perform set_config('app.stock_src_type', coalesce(p_type, ''), true);
  perform set_config('app.stock_src_id', coalesce(p_id::text, ''), true);
end $$;
revoke all on function public.stock_source(text, uuid) from public, anon, authenticated;

-- Core ledger write. Moving-average costing:
--  * in with a cost (receipt, production output, reversal of a consumption) → average moves
--  * out with an explicit cost (reversal of a receipt / output) → average is unwound exactly
--  * anything else moves at the current average, which it does not change
-- Every movement stores the unit cost it moved at, so value = Σ delta × unit_cost.
create or replace function public.move_stock(p_item uuid, p_delta numeric, p_reason text, p_ref text default '', p_note text default '', p_cost numeric default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s public.stock_items;
  q numeric;
  a numeric;
begin
  select * into s from public.stock_items where id = p_item for update;
  if s.id is null then raise exception 'Item not found'; end if;
  if s.kind = 'service' then raise exception 'Services are not kept in stock'; end if;
  q := s.quantity + p_delta;
  a := case
         when p_cost is null then s.avg_cost
         when p_delta > 0 and q > 0 then round((greatest(s.quantity, 0) * s.avg_cost + p_delta * p_cost) / (greatest(s.quantity, 0) + p_delta), 4)
         when p_delta > 0 then p_cost
         when p_delta < 0 and q > 0 and s.quantity > 0 then greatest(round((s.quantity * s.avg_cost + p_delta * p_cost) / q, 4), 0)
         else s.avg_cost end;
  perform set_config('app.stock_move', 'on', true);
  update public.stock_items set quantity = q, avg_cost = a,
    updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
  where id = s.id;
  perform set_config('app.stock_move', 'off', true);
  insert into public.stock_movements (item_id, delta, after, reason, ref, note, unit_cost, user_id, job_id, source_type, source_id)
  values (s.id, p_delta, q, p_reason, coalesce(p_ref, ''), coalesce(p_note, ''), coalesce(p_cost, s.avg_cost), auth.uid(),
          nullif(current_setting('app.stock_job', true), '')::uuid,
          nullif(current_setting('app.stock_src_type', true), ''),
          nullif(current_setting('app.stock_src_id', true), '')::uuid);
  return q;
end $$;
revoke all on function public.move_stock(uuid, numeric, text, text, text, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------- idempotency
create table if not exists public.op_keys (
  key text primary key,
  user_id uuid,
  result text,
  created_at timestamptz not null default now()
);
alter table public.op_keys enable row level security; -- no policies: functions only

-- Returns null the first time a key is seen (go ahead), else the earlier result.
-- A concurrent second call waits on the first one's row, then sees its result.
create or replace function public.claim_op(p_fn text, p_key text) returns text
language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if coalesce(p_key, '') = '' then return null; end if;
  insert into public.op_keys (key, user_id) values (p_fn || ':' || p_key, auth.uid()) on conflict (key) do nothing;
  if found then return null; end if;
  select coalesce(result, 'done') into r from public.op_keys where key = p_fn || ':' || p_key;
  return r;
end $$;
create or replace function public.finish_op(p_fn text, p_key text, p_result text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_key, '') <> '' then update public.op_keys set result = p_result where key = p_fn || ':' || p_key; end if;
  return p_result;
end $$;
revoke all on function public.claim_op(text, text) from public, anon, authenticated;
revoke all on function public.finish_op(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- adjustments
drop function if exists public.adjust_stock(uuid, numeric, text);
create or replace function public.adjust_stock(p_item uuid, p_delta numeric, p_note text default '', p_key text default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare prev text; q numeric;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change stock'; end if;
  if p_delta = 0 then raise exception 'Nothing to change'; end if;
  prev := public.claim_op('adjust_stock', p_key);
  if prev is not null then return prev::numeric; end if;
  perform public.stock_source('adjustment', null);
  q := public.move_stock(p_item, p_delta, 'adjust', '', p_note);
  perform public.finish_op('adjust_stock', p_key, q::text);
  return q;
end $$;
revoke all on function public.adjust_stock(uuid, numeric, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------- purchasing
alter table public.purchase_orders add column if not exists currency text check (currency ~ '^[A-Z]{3}$');
alter table public.purchase_orders add column if not exists fx_rate numeric(18,8) not null default 1 check (fx_rate > 0);
comment on column public.purchase_orders.fx_rate is 'Base-currency value of 1 unit of the PO currency, fixed when ordered';
alter table public.po_lines drop constraint if exists po_lines_received_check;
alter table public.po_lines add constraint po_lines_received_check check (received >= 0);

create or replace function public.guard_po_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'purchase_orders' and exists (select 1 from public.po_lines where po_id = old.id and received > 0) then
    raise exception 'Goods were received on this purchase order — reverse the receipt or cancel it instead';
  end if;
  if tg_table_name = 'po_lines' and old.received > 0 and exists (select 1 from public.purchase_orders where id = old.po_id) then
    raise exception 'This line has been received — reverse the receipt first';
  end if;
  return old;
end $$;
drop trigger if exists guard_po_delete on public.purchase_orders;
create trigger guard_po_delete before delete on public.purchase_orders for each row execute function public.guard_po_delete();
drop trigger if exists guard_po_line_delete on public.po_lines;
create trigger guard_po_line_delete before delete on public.po_lines for each row execute function public.guard_po_delete();

create or replace function public.po_status_after(p_po uuid) returns text
language plpgsql security definer set search_path = public as $$
declare open_left numeric; got numeric; st text;
begin
  select coalesce(sum(greatest(quantity - received, 0)), 0), coalesce(sum(received), 0) into open_left, got from public.po_lines where po_id = p_po;
  st := case when open_left = 0 then 'received' when got > 0 then 'partial' else 'ordered' end;
  update public.purchase_orders set status = st,
    received_at = case when st = 'received' then coalesce(received_at, now()) else null end,
    ordered_at = coalesce(ordered_at, now())
  where id = p_po;
  return st;
end $$;
revoke all on function public.po_status_after(uuid) from public, anon, authenticated;

drop function if exists public.receive_po_line(uuid, numeric);
create or replace function public.receive_po_line(p_line uuid, p_qty numeric, p_key text default null, p_over boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.po_lines;
  po public.purchase_orders;
  prev text; st text;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can receive deliveries'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Receive at least one'; end if;
  prev := public.claim_op('receive_po_line', p_key);
  if prev is not null then return prev; end if;
  select * into l from public.po_lines where id = p_line for update;
  if l.id is null then raise exception 'Purchase order line not found'; end if;
  select * into po from public.purchase_orders where id = l.po_id for update;
  if po.status = 'draft' then raise exception 'Mark the purchase order as ordered first'; end if;
  if po.status in ('cancelled','received') then raise exception 'This purchase order is closed'; end if;
  if l.received + p_qty > l.quantity and not p_over then
    raise exception 'That is more than ordered — % still to come', trim_scale(l.quantity - l.received);
  end if;
  update public.po_lines set received = received + p_qty where id = l.id;
  perform public.stock_source('po_line', l.id);
  perform public.move_stock(l.item_id, p_qty, 'receive', po.number, '', round(l.unit_cost * po.fx_rate, 4));
  st := public.po_status_after(po.id);
  return public.finish_op('receive_po_line', p_key, st);
end $$;
revoke all on function public.receive_po_line(uuid, numeric, text, boolean) from public, anon;
grant execute on function public.receive_po_line(uuid, numeric, text, boolean) to authenticated;

-- Wrong delivery booked: take it back out at the cost it came in at.
create or replace function public.reverse_po_receipt(p_line uuid, p_qty numeric, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare l public.po_lines; po public.purchase_orders; prev text; st text;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change receipts'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Reverse at least one'; end if;
  prev := public.claim_op('reverse_po_receipt', p_key);
  if prev is not null then return prev; end if;
  select * into l from public.po_lines where id = p_line for update;
  if l.id is null then raise exception 'Purchase order line not found'; end if;
  if p_qty > l.received then raise exception 'Only % was received on this line', trim_scale(l.received); end if;
  select * into po from public.purchase_orders where id = l.po_id for update;
  if po.status = 'cancelled' then raise exception 'This purchase order is cancelled'; end if;
  update public.po_lines set received = received - p_qty where id = l.id;
  perform public.stock_source('po_line', l.id);
  perform public.move_by_source_lots(l.item_id, -p_qty, 'receive', po.number, 'Receipt reversed', 'po_line', l.id, 'receive', round(l.unit_cost * po.fx_rate, 4));
  st := public.po_status_after(po.id);
  return public.finish_op('reverse_po_receipt', p_key, st);
end $$;
revoke all on function public.reverse_po_receipt(uuid, numeric, text) from public, anon;
grant execute on function public.reverse_po_receipt(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------- manufacturing
alter table public.jobs alter column quantity type numeric(14,3);
alter table public.jobs drop constraint if exists jobs_quantity_check;
alter table public.jobs add constraint jobs_quantity_check check (quantity is null or quantity > 0);

create or replace function public.guard_job_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.stock_booked then
    raise exception 'This manufacturing order has booked stock — reopen it first so its stock is reversed';
  end if;
  return old;
end $$;
drop trigger if exists guard_job_delete on public.jobs;
create trigger guard_job_delete before delete on public.jobs for each row execute function public.guard_job_delete();

-- Finishing an MO: consume recipe × quantity at the materials' average cost, then
-- put the output on stock (make-to-stock AND make-to-order) at the consumed cost
-- per unit. Reopening reverses exactly what was booked, at the cost it was booked at.
create or replace function public.book_job_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prod public.stock_items;
  b record;
  m record;
  qty numeric := coalesce(new.quantity, 1);
  has_bom boolean := false;
  total numeric;
begin
  if old.status = 'done' and new.status <> 'done' and old.stock_booked then
    perform set_config('app.stock_job', new.id::text, true);
    perform public.stock_source('job', new.id);
    for m in select item_id, reason, sum(delta) as net,
                    case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end as cost
               from public.stock_movements
              where job_id = new.id and reason in ('consume', 'produce') group by item_id, reason having sum(delta) <> 0
              order by reason desc loop  -- take the output back before returning materials
      perform public.move_stock(m.item_id, -m.net, m.reason, new.code, 'Reopened — reversed', m.cost);
    end loop;
    perform set_config('app.stock_job', '', true);
    new.stock_booked := false;
    return new;
  end if;
  if new.status <> 'done' or old.status = 'done' or new.stock_booked or new.sku is null then return new; end if;
  select * into prod from public.stock_items where sku = new.sku and kind not in ('material', 'service') limit 1;
  if prod.id is null then select * into prod from public.stock_items where sku = new.sku and kind <> 'service' limit 1; end if;
  if prod.id is null then return new; end if;
  perform set_config('app.stock_job', new.id::text, true);
  perform public.stock_source('job', new.id);
  for b in select bl.material_id, bl.quantity from public.bom_lines bl join public.stock_items si on si.id = bl.material_id
            where bl.product_id = prod.id and si.kind <> 'service' loop
    has_bom := true;
    perform public.move_stock(b.material_id, -(b.quantity * qty), 'consume', new.code, '');
  end loop;
  -- net cost of what this MO has consumed (earlier reopened cycles net to zero)
  select coalesce(sum(-delta * coalesce(unit_cost, 0)), 0) into total
    from public.stock_movements where job_id = new.id and reason = 'consume';
  perform public.move_stock(prod.id, qty, 'produce', new.code, '', case when has_bom then round(total / qty, 4) end);
  perform set_config('app.stock_job', '', true);
  new.stock_booked := true;
  return new;
end $$;
drop trigger if exists book_job_stock on public.jobs;
create trigger book_job_stock before update of status on public.jobs
  for each row execute function public.book_job_stock();

-- create_mo / replenish without rounding the quantity up.
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
    p_sku := coalesce(nullif(p_sku, ''), nullif(l.sku, '')); p_title := coalesce(nullif(p_title, ''), l.name);
    p_qty := coalesce(p_qty, l.quantity - l.shipped);
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
          p_qty, pr.estimate_minutes, p_due, auth.uid(), o.id, l.id, nullif(p_sku, ''), r, 0, r[1], l.unit_price)
  returning id into jid;
  return jid;
end $$;

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
            '', 3, 'open', public.station_assignees(r[1]), q, pr.estimate_minutes, s.sku, r, 0, r[1]);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.replenish(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- sales fulfilment
alter table public.order_lines add column if not exists shipped numeric(14,3) not null default 0;
alter table public.order_lines add column if not exists returned numeric(14,3) not null default 0;
-- Orders shipped under the old whole-order rule: their lines count as shipped.
update public.order_lines ol set shipped = ol.quantity
  from public.orders o where o.id = ol.order_id and o.stock_out and ol.shipped = 0;
-- …and their ship movements get linked to the line they came from.
update public.stock_movements m set source_type = 'order_line', source_id = ol.id
  from public.order_lines ol join public.orders o on o.id = ol.order_id
 where m.reason = 'ship' and m.source_id is null and m.ref = o.order_number and m.item_id = ol.item_id;
alter table public.order_lines drop constraint if exists order_lines_fulfil_check;
alter table public.order_lines add constraint order_lines_fulfil_check
  check (shipped >= 0 and returned >= 0 and returned <= shipped and shipped <= quantity);

alter table public.orders drop constraint if exists orders_delivery_check;
alter table public.orders add constraint orders_delivery_check
  check (delivery in ('not_shipped','packed','partially_shipped','shipped','delivered'));

create or replace function public.guard_order_change() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'orders' then
    if tg_op = 'DELETE' and exists (select 1 from public.order_lines where order_id = old.id and shipped > 0) then
      raise exception 'Goods were shipped on this order — undo the shipment or cancel it instead';
    end if;
    if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled'
       and exists (select 1 from public.order_lines where order_id = new.id and shipped - returned > 0) then
      raise exception 'Shipped goods are still with the customer — undo the shipment or book a return first';
    end if;
  elsif tg_op = 'DELETE' and old.shipped > 0 and exists (select 1 from public.orders where id = old.order_id) then
    raise exception 'This line has been shipped — undo the shipment first';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists guard_order_change on public.orders;
create trigger guard_order_change before update of status or delete on public.orders for each row execute function public.guard_order_change();
drop trigger if exists guard_order_line_delete on public.order_lines;
create trigger guard_order_line_delete before delete on public.order_lines for each row execute function public.guard_order_change();

-- Recompute an order's delivery state from its lines (after shipping / undo).
create or replace function public.order_delivery_after(p_order uuid, p_state text default null) returns text
language plpgsql security definer set search_path = public as $$
declare any_out boolean; all_out boolean; st text; o public.orders;
begin
  select * into o from public.orders where id = p_order;
  select coalesce(bool_or(shipped > 0), false), coalesce(bool_and(shipped >= quantity), false)
    into any_out, all_out from public.order_lines where order_id = p_order;
  st := case when all_out and p_state = 'delivered' then 'delivered'
             when all_out and any_out then case when o.delivery = 'delivered' and p_state is null then 'delivered' else 'shipped' end
             when any_out then 'partially_shipped'
             when p_state = 'packed' then 'packed'
             else 'not_shipped' end;
  if not exists (select 1 from public.order_lines where order_id = p_order) then st := coalesce(p_state, o.delivery); any_out := st in ('shipped','delivered'); end if;
  update public.orders set delivery = st, stock_out = any_out,
    packed_at = case when st = 'not_shipped' then null else coalesce(packed_at, now()) end,
    shipped_at = case when st in ('shipped','delivered') then coalesce(shipped_at, now()) when any_out then shipped_at else null end,
    delivered_at = case when st = 'delivered' then coalesce(delivered_at, now()) else null end,
    status = case when st = 'delivered' then 'done' when status = 'done' then 'open' else status end
  where id = p_order;
  return st;
end $$;
revoke all on function public.order_delivery_after(uuid, text) from public, anon, authenticated;

-- Ship order lines. p_lines = [{"line": uuid, "qty": n}]; null = everything still to ship.
-- Stocked lines leave stock at the current average cost; services just count as shipped.
create or replace function public.ship_lines(p_order uuid, p_lines jsonb default null, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; r jsonb; q numeric; prev text; kind text;
begin
  if not public.is_admin() then raise exception 'Only the office team can ship orders'; end if;
  prev := public.claim_op('ship_lines', p_key);
  if prev is not null then return prev; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.kind = 'quote' then raise exception 'Quotes are not delivered'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  for l in select * from public.order_lines where order_id = o.id order by sort, created_at for update loop
    if p_lines is null then q := l.quantity - l.shipped;
    else
      select x into r from jsonb_array_elements(p_lines) x where (x->>'line')::uuid = l.id;
      q := coalesce((r->>'qty')::numeric, 0);
    end if;
    continue when q = 0;
    if q < 0 then raise exception 'Ship a positive quantity'; end if;
    if l.shipped + q > l.quantity then
      raise exception '% — only % left to ship', coalesce(nullif(l.name, ''), l.sku), trim_scale(l.quantity - l.shipped);
    end if;
    select si.kind into kind from public.stock_items si where si.id = l.item_id;
    if l.item_id is not null and kind is distinct from 'service' then
      perform public.stock_source('order_line', l.id);
      perform public.move_stock(l.item_id, -q, 'ship', o.order_number, '');
    end if;
    update public.order_lines set shipped = shipped + q where id = l.id;
  end loop;
  return public.finish_op('ship_lines', p_key, public.order_delivery_after(o.id));
end $$;
revoke all on function public.ship_lines(uuid, jsonb, text) from public, anon;
grant execute on function public.ship_lines(uuid, jsonb, text) to authenticated;

-- Undo a shipment (booked by mistake): stock comes back at the cost it left at.
create or replace function public.unship_lines(p_order uuid, p_lines jsonb default null, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; r jsonb; q numeric; prev text; c numeric;
begin
  if not public.is_admin() then raise exception 'Only the office team can change shipments'; end if;
  prev := public.claim_op('unship_lines', p_key);
  if prev is not null then return prev; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  for l in select * from public.order_lines where order_id = o.id order by sort, created_at for update loop
    if p_lines is null then q := l.shipped - l.returned;
    else
      select x into r from jsonb_array_elements(p_lines) x where (x->>'line')::uuid = l.id;
      q := coalesce((r->>'qty')::numeric, 0);
    end if;
    continue when q = 0;
    if q < 0 or q > l.shipped - l.returned then
      raise exception '% — only % shipped and not returned', coalesce(nullif(l.name, ''), l.sku), trim_scale(l.shipped - l.returned);
    end if;
    select case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end into c
      from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason = 'ship' and delta < 0;
    if exists (select 1 from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason = 'ship') then
      perform public.stock_source('order_line', l.id);
      perform public.move_by_source_lots(l.item_id, q, 'ship', o.order_number, 'Shipment undone', 'order_line', l.id, 'ship', c);
    end if;
    update public.order_lines set shipped = shipped - q where id = l.id;
  end loop;
  return public.finish_op('unship_lines', p_key, public.order_delivery_after(o.id));
end $$;
revoke all on function public.unship_lines(uuid, jsonb, text) from public, anon;
grant execute on function public.unship_lines(uuid, jsonb, text) to authenticated;

-- Customer return. p_lines = [{"line": uuid, "qty": n, "restock": true|false}].
-- restock → back on stock at the cost it was shipped at; otherwise recorded as
-- returned but not resaleable (no stock change; scrap stays visible on the line).
create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_line_id uuid not null references public.order_lines(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  restock boolean not null,
  reason text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.order_returns enable row level security;
drop policy if exists "staff read returns" on public.order_returns;
create policy "staff read returns" on public.order_returns for select to authenticated using (true);

create or replace function public.return_lines(p_order uuid, p_lines jsonb, p_reason text default '', p_key text default null) returns int
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; r jsonb; q numeric; prev text; c numeric; n int := 0; rid uuid; kind text;
begin
  if not public.is_admin() then raise exception 'Only the office team can book returns'; end if;
  prev := public.claim_op('return_lines', p_key);
  if prev is not null then return prev::int; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.order_lines where id = (r->>'line')::uuid and order_id = o.id for update;
    if l.id is null then raise exception 'Order line not found'; end if;
    q := coalesce((r->>'qty')::numeric, 0);
    continue when q = 0;
    if q < 0 or q > l.shipped - l.returned then
      raise exception '% — only % can be returned', coalesce(nullif(l.name, ''), l.sku), trim_scale(l.shipped - l.returned);
    end if;
    insert into public.order_returns (order_id, order_line_id, quantity, restock, reason, created_by)
    values (o.id, l.id, q, coalesce((r->>'restock')::boolean, true), coalesce(p_reason, ''), auth.uid()) returning id into rid;
    select si.kind into kind from public.stock_items si where si.id = l.item_id;
    if coalesce((r->>'restock')::boolean, true) and l.item_id is not null and kind is distinct from 'service' then
      select case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end into c
        from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason = 'ship' and delta < 0;
      perform public.stock_source('return', rid);
      perform public.move_by_source_lots(l.item_id, q, 'return', o.order_number, coalesce(nullif(p_reason, ''), 'Customer return'), 'order_line', l.id, 'ship', c);
    end if;
    update public.order_lines set returned = returned + q where id = l.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nothing to return'; end if;
  perform public.finish_op('return_lines', p_key, n::text);
  return n;
end $$;
revoke all on function public.return_lines(uuid, jsonb, text, text) from public, anon;
grant execute on function public.return_lines(uuid, jsonb, text, text) to authenticated;

-- Delivery buttons keep working: shipped/delivered ship what is left, not shipped/packed undo.
create or replace function public.set_delivery(p_order uuid, p_state text) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  if not public.is_admin() then raise exception 'Only the office team can change delivery'; end if;
  if p_state not in ('not_shipped','packed','shipped','delivered') then raise exception 'Unknown delivery state'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.kind = 'quote' then raise exception 'Quotes are not delivered'; end if;
  if p_state in ('shipped','delivered') then
    if exists (select 1 from public.order_lines where order_id = o.id and shipped < quantity) then perform public.ship_lines(o.id, null); end if;
  elsif exists (select 1 from public.order_lines where order_id = o.id and shipped > 0) then
    if exists (select 1 from public.order_lines where order_id = o.id and returned > 0) then
      raise exception 'Part of this order was returned — undo shipments line by line';
    end if;
    perform public.unship_lines(o.id, null);
  end if;
  return public.order_delivery_after(o.id, p_state);
end $$;
revoke all on function public.set_delivery(uuid, text) from public, anon;
grant execute on function public.set_delivery(uuid, text) to authenticated;

-- ---------------------------------------------------------------- audit log
create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  table_name text not null,
  row_id text,
  action text not null check (action in ('insert','update','delete')),
  changes jsonb not null default '{}'
);
create index if not exists audit_log_row_idx on public.audit_log (table_name, row_id, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists "office reads audit" on public.audit_log;
create policy "office reads audit" on public.audit_log for select to authenticated using (public.is_admin());

-- Trigger args = column names not worth logging (noise or covered by the ledger).
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; d jsonb := '{}'; k text; skip text[] := coalesce(tg_argv, '{}'::text[]) || array['updated_at','updated_by'];
begin
  if tg_op = 'INSERT' then n := to_jsonb(new); d := n;
  elsif tg_op = 'DELETE' then o := to_jsonb(old); d := o;
  else
    o := to_jsonb(old); n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      continue when k = any(skip);
      if (o->k) is distinct from (n->k) then d := d || jsonb_build_object(k, jsonb_build_array(o->k, n->k)); end if;
    end loop;
    if d = '{}'::jsonb then return null; end if;
  end if;
  insert into public.audit_log (user_id, table_name, row_id, action, changes)
  values (auth.uid(), tg_table_name, coalesce(n->>'id', o->>'id'), lower(tg_op), d);
  return null;
end $$;

do $$
declare t text[];
begin
  foreach t slice 1 in array array[
    array['orders', ''], array['order_lines', ''], array['purchase_orders', ''], array['po_lines', ''],
    array['bom_lines', ''], array['suppliers', ''], array['company_settings', ''],
    array['stock_items', 'quantity,avg_cost'], array['jobs', 'assignees'],
    array['profiles', 'last_seen_at,status,status_note,avatar_url']] loop
    execute format('drop trigger if exists audit_row on public.%I', t[1]);
    if t[2] = '' then
      execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()', t[1]);
    else
      execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row(%s)',
                     t[1], (select string_agg(quote_literal(x), ',') from unnest(string_to_array(t[2], ',')) x));
    end if;
  end loop;
end $$;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['company_settings', 'order_returns'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ============================================================================
-- KORTANA phase 2 — master data (docs/kimera-coverage.md)
--  * customers with order history; every order is linked to one (CAT-04)
--  * tax rates; each order line keeps the rate it was sold at (CAT-07, SALES-02)
--  * barcodes and per-supplier item references with their own cost/lead time (CAT-05)
--  * import check: validates a file and shows what would change before anything is written (CAT-08, ADMIN-08)
--  * base currency is locked once stock has been costed in it
-- ============================================================================

-- ---------------------------------------------------------------- tax rates
create table if not exists public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate numeric(7,4) not null check (rate >= 0 and rate <= 1),
  is_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists tax_rates_one_default on public.tax_rates ((true)) where is_default;
insert into public.tax_rates (name, rate, is_default)
  select * from (values ('VAT 20%', 0.20, true), ('Zero-rated (export)', 0.00, false)) v(n, r, d)
  where not exists (select 1 from public.tax_rates);

-- ---------------------------------------------------------------- customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  tax_rate_id uuid references public.tax_rates(id) on delete set null,
  notes text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists customers_email_key on public.customers (lower(email)) where email <> '';
alter table public.orders add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists orders_customer_idx on public.orders (customer_id);
alter table public.orders add column if not exists prices_include_tax boolean not null default false;
alter table public.order_lines add column if not exists tax_rate numeric(7,4) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1));

-- Same person → same record: by e-mail, else by name + company.
create or replace function public.find_or_create_customer(p_name text, p_company text, p_email text, p_phone text, p_address text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; nm text := trim(coalesce(p_name, '')); em text := lower(trim(coalesce(p_email, '')));
begin
  if nm = '' and em = '' then return null; end if;
  if em <> '' then select id into cid from public.customers where lower(email) = em; end if;
  if cid is null and nm <> '' then
    select id into cid from public.customers
     where lower(name) = lower(nm) and lower(company) = lower(trim(coalesce(p_company, ''))) and (email = '' or em = '')
     order by created_at limit 1;
  end if;
  if cid is null then
    insert into public.customers (name, company, email, phone, address)
    values (coalesce(nullif(nm, ''), em), trim(coalesce(p_company, '')), em, trim(coalesce(p_phone, '')), trim(coalesce(p_address, '')))
    returning id into cid;
  end if;
  return cid;
end $$;
revoke all on function public.find_or_create_customer(text, text, text, text, text) from public, anon, authenticated;

-- Every new order (manual, quote, Shopify) is linked to a customer; picking a
-- customer fills the order's contact fields when they are empty.
create or replace function public.link_order_customer() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.customers;
begin
  if new.customer_id is null then
    new.customer_id := public.find_or_create_customer(new.customer, new.company, new.email, new.phone, new.ship_to);
  elsif tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id then
    select * into c from public.customers where id = new.customer_id;
    if tg_op = 'UPDATE' or coalesce(new.customer, '') = '' then
      new.customer := c.name; new.company := c.company; new.email := c.email; new.phone := c.phone;
      if coalesce(new.ship_to, '') = '' or tg_op = 'UPDATE' then new.ship_to := c.address; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists link_order_customer on public.orders;
create trigger link_order_customer before insert or update of customer_id on public.orders
  for each row execute function public.link_order_customer();

-- Existing orders → customers (oldest first, so the first spelling wins).
do $$
declare o record;
begin
  for o in select * from public.orders where customer_id is null and (coalesce(customer, '') <> '' or coalesce(email, '') <> '') order by created_at loop
    update public.orders set customer_id = public.find_or_create_customer(o.customer, o.company, o.email, o.phone, o.ship_to) where id = o.id;
  end loop;
end $$;

-- New order lines take the customer's tax rate, else the default rate. The rate is
-- copied onto the line, so later rate changes never rewrite old orders.
create or replace function public.order_line_tax() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tax_rate is null then
    select coalesce(
      (select t.rate from public.orders o join public.customers c on c.id = o.customer_id join public.tax_rates t on t.id = c.tax_rate_id where o.id = new.order_id),
      (select rate from public.tax_rates where is_default and not archived limit 1)) into new.tax_rate;
  end if;
  return new;
end $$;
drop trigger if exists order_line_tax on public.order_lines;
create trigger order_line_tax before insert on public.order_lines for each row execute function public.order_line_tax();

-- ---------------------------------------------------------------- barcodes + supplier refs
alter table public.stock_items add column if not exists barcode text;
create unique index if not exists stock_items_barcode_key on public.stock_items (barcode) where coalesce(barcode, '') <> '';

create table if not exists public.item_suppliers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_sku text not null default '',
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  lead_days int check (lead_days is null or lead_days >= 0),
  preferred boolean not null default false,
  created_at timestamptz not null default now(),
  unique (item_id, supplier_id)
);
insert into public.item_suppliers (item_id, supplier_id, supplier_sku, lead_days, preferred)
  select id, supplier_id, supplier_code, lead_days, true from public.stock_items where supplier_id is not null
  on conflict (item_id, supplier_id) do nothing;

-- ---------------------------------------------------------------- RLS
alter table public.tax_rates enable row level security;
alter table public.customers enable row level security;
alter table public.item_suppliers enable row level security;
do $$
declare t text;
begin
  foreach t in array array['tax_rates', 'customers', 'item_suppliers'] loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('drop policy if exists "office write" on public.%I', t);
    execute format('drop policy if exists "keepers write" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_active())', t);
    if t = 'item_suppliers' then
      execute format('create policy "keepers write" on public.%I for all to authenticated using (public.is_stock_keeper()) with check (public.is_stock_keeper())', t);
    else
      execute format('create policy "office write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
    execute format('drop trigger if exists audit_row on public.%I', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tax_rates', 'customers', 'item_suppliers'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------- base currency lock
create or replace function public.guard_base_currency() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.base_currency is distinct from old.base_currency
     and exists (select 1 from public.stock_movements where coalesce(unit_cost, 0) <> 0) then
    raise exception 'Stock is already valued in % — the base currency can no longer change', old.base_currency;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_base_currency on public.company_settings;
create trigger guard_base_currency before update on public.company_settings for each row execute function public.guard_base_currency();

-- ---------------------------------------------------------------- import check (dry run)
-- Returns one entry per row: {row, key, action: create|update|error, problems[], changes[]}.
-- Nothing is written. The app shows this before the import and only sends clean rows.
create or replace function public.check_import(p_kind text, p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb; i int := 0; out jsonb := '[]'::jsonb; probs text[]; chg text[]; s public.stock_items; k text; act text;
  num text := '^-?[0-9]+(\.[0-9]+)?$'; f text; seen text[] := '{}'; codes text[] := '{}'; pid uuid; mid uuid;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can import stock'; end if;
  if p_kind not in ('items', 'bom') then raise exception 'Unknown import kind'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    i := i + 1; probs := '{}'; chg := '{}';
    if p_kind = 'items' then
      k := nullif(trim(r->>'sku'), '');
      if k is null then probs := probs || 'SKU is missing'::text;
      elsif k = any(seen) then probs := probs || 'SKU appears more than once in the file'::text;
      end if;
      seen := seen || coalesce(k, '');
      foreach f in array array['quantity', 'avg_cost', 'sale_price', 'min_quantity', 'make_min', 'make_batch'] loop
        if nullif(trim(r->>f), '') is not null and not (trim(r->>f) ~ num) then probs := probs || format('%s "%s" is not a number', f, r->>f); end if;
      end loop;
      if nullif(trim(r->>'lead_days'), '') is not null and not (trim(r->>'lead_days') ~ '^[0-9]+$') then probs := probs || format('lead_days "%s" is not a whole number', r->>'lead_days'); end if;
      if nullif(trim(r->>'kind'), '') is not null and lower(trim(r->>'kind')) not in ('product','material','part','service') then
        probs := probs || format('type "%s" must be product, material, part or service', r->>'kind');
      end if;
      if nullif(trim(r->>'avg_cost'), '') ~ num and (r->>'avg_cost')::numeric < 0 then probs := probs || 'avg_cost cannot be negative'::text; end if;
      if nullif(trim(r->>'barcode'), '') is not null then
        if trim(r->>'barcode') = any(codes) then probs := probs || 'barcode appears more than once in the file'::text; end if;
        codes := codes || trim(r->>'barcode');
        if exists (select 1 from public.stock_items x where x.barcode = trim(r->>'barcode') and x.sku is distinct from k) then
          probs := probs || format('barcode %s already belongs to another item', trim(r->>'barcode'));
        end if;
      end if;
      select * into s from public.stock_items where sku = k;
      act := case when cardinality(probs) > 0 then 'error' when s.id is null then 'create' else 'update' end;
      if act = 'update' then
        if nullif(trim(r->>'name'), '') is not null and trim(r->>'name') <> s.name then chg := chg || format('name: %s → %s', s.name, trim(r->>'name')); end if;
        if trim(r->>'quantity') ~ num and (r->>'quantity')::numeric <> s.quantity then chg := chg || format('stock: %s → %s', trim_scale(s.quantity), trim(r->>'quantity')); end if;
        if trim(r->>'avg_cost') ~ num and (r->>'avg_cost')::numeric <> s.avg_cost then chg := chg || case when public.can_see_costs() then format('cost: %s → %s', trim_scale(s.avg_cost), trim(r->>'avg_cost')) else 'cost changes' end; end if;
        if trim(r->>'sale_price') ~ num and (r->>'sale_price')::numeric is distinct from s.sale_price then chg := chg || format('price: %s → %s', coalesce(trim_scale(s.sale_price)::text, '—'), trim(r->>'sale_price')); end if;
      elsif act = 'create' and trim(r->>'quantity') ~ num then chg := chg || format('opening stock %s', trim(r->>'quantity'));
      end if;
      out := out || jsonb_build_object('row', i, 'key', coalesce(k, ''), 'action', act, 'problems', to_jsonb(probs), 'changes', to_jsonb(chg));
    else
      select id into pid from public.stock_items where sku = trim(r->>'product_sku');
      select id into mid from public.stock_items where sku = trim(r->>'material_sku');
      if nullif(trim(r->>'product_sku'), '') is null then probs := probs || 'product SKU is missing'::text;
      elsif pid is null then probs := probs || format('product %s is not an item yet — import items first', trim(r->>'product_sku')); end if;
      if nullif(trim(r->>'material_sku'), '') is null then probs := probs || 'ingredient SKU is missing'::text;
      elsif mid is null then probs := probs || format('ingredient %s is not an item yet — import items first', trim(r->>'material_sku')); end if;
      if pid is not null and pid = mid then probs := probs || 'a product cannot contain itself'::text; end if;
      if not (coalesce(trim(r->>'quantity'), '') ~ '^[0-9]+(\.[0-9]+)?$') or (trim(r->>'quantity') ~ num and (r->>'quantity')::numeric <= 0) then
        probs := probs || format('quantity "%s" must be a number above 0', coalesce(r->>'quantity', ''));
      end if;
      act := case when cardinality(probs) > 0 then 'error' when exists (select 1 from public.bom_lines where product_id = pid) then 'update' else 'create' end;
      if act = 'update' and not (trim(r->>'product_sku') = any(seen)) then chg := chg || 'replaces this product''s current recipe'::text; end if;
      seen := seen || coalesce(trim(r->>'product_sku'), '');
      out := out || jsonb_build_object('row', i, 'key', coalesce(trim(r->>'product_sku'), '') || ' ← ' || coalesce(trim(r->>'material_sku'), ''),
                                       'action', act, 'problems', to_jsonb(probs), 'changes', to_jsonb(chg));
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.check_import(text, jsonb) from public, anon;
grant execute on function public.check_import(text, jsonb) to authenticated;

-- Activity (audit log) for Kortana → Settings, newest first, with who did it.
create or replace function public.recent_activity(p_table text default null, p_row text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the office team can see activity'; end if;
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select a.id, a.at, a.user_id, a.table_name, a.row_id, a.action, a.changes
      from public.audit_log a
     where (p_table is null or a.table_name = p_table) and (p_row is null or a.row_id = p_row)
     order by a.at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x), '[]'::jsonb);
end $$;
revoke all on function public.recent_activity(text, text, int) from public, anon;
grant execute on function public.recent_activity(text, text, int) to authenticated;

-- ============================================================================
-- Kortana section access (Settings → Access): the owner decides which Kortana
-- sections each role sees. Owner and Developer always see everything.
-- ============================================================================
create table if not exists public.kimera_access (
  role public.staff_role primary key,
  sections text[] not null default '{}'
    check (sections <@ array['sell','make','buy','stock','items','plan','tickets','insights','settings']::text[]),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.kimera_access (role, sections) values
  ('manager',   array['sell','make','buy','stock','items','plan','tickets','insights','settings']),
  ('office',    array['sell','make','buy','stock','items','plan','tickets','insights','settings']),
  ('assistant', array['sell','make','buy','stock','items','plan','tickets']),
  ('support',   array['sell','make','buy','stock','items','plan','tickets']),
  ('operator',  array[]::text[])
on conflict (role) do nothing;
alter table public.kimera_access enable row level security;
drop policy if exists "staff read access" on public.kimera_access;
drop policy if exists "owner sets access" on public.kimera_access;
create policy "staff read access" on public.kimera_access for select to authenticated using (public.is_active());
create policy "owner sets access" on public.kimera_access for all to authenticated
  using (public.my_role() in ('boss','developer')) with check (public.my_role() in ('boss','developer') and role not in ('boss','developer'));

create or replace function public.stamp_kimera_access() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_by := auth.uid(); new.updated_at := now(); return new; end $$;
drop trigger if exists stamp_kimera_access on public.kimera_access;
create trigger stamp_kimera_access before insert or update on public.kimera_access for each row execute function public.stamp_kimera_access();
drop trigger if exists audit_row on public.kimera_access;
create trigger audit_row after insert or update or delete on public.kimera_access for each row execute function public.audit_row();

-- Sections the signed-in person may open (owner-level: all).
create or replace function public.my_kimera_sections() returns text[]
language sql stable security definer set search_path = public as $$
  select case when public.my_role() in ('boss','developer') then array['sell','make','buy','stock','items','plan','tickets','insights','settings']
              else coalesce((select sections from public.kimera_access where role = public.my_role()), '{}') end
$$;
revoke all on function public.my_kimera_sections() from public, anon;
grant execute on function public.my_kimera_sections() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kimera_access') then
    alter publication supabase_realtime add table public.kimera_access;
  end if;
end $$;

create or replace function public.set_kimera_access(p_role public.staff_role, p_sections text[]) returns text[]
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role() not in ('boss','developer'), true) or not public.is_active() then
    raise exception 'Only the owner can change who sees what';
  end if;
  if p_role in ('boss','developer') then raise exception 'Owner and Developer always see everything'; end if;
  insert into public.kimera_access (role, sections) values (p_role, coalesce(p_sections, '{}'))
  on conflict (role) do update set sections = excluded.sections;
  return p_sections;
end $$;
revoke all on function public.set_kimera_access(public.staff_role, text[]) from public, anon;
grant execute on function public.set_kimera_access(public.staff_role, text[]) to authenticated;

-- ============================================================================
-- ADMIN-03 — costs & margins are only released to roles allowed to see them.
-- Cost columns are not readable through the API at all (column privileges);
-- my_costs() hands them to people whose role has the 'costs' permission
-- (Settings → Access). PO and supplier prices also go to roles with 'buy'.
-- ============================================================================
alter table public.kimera_access drop constraint if exists kimera_access_sections_check;
alter table public.kimera_access add constraint kimera_access_sections_check
  check (sections <@ array['sell','make','buy','stock','items','plan','tickets','insights','settings','costs']::text[]);
update public.kimera_access set sections = sections || array['costs']
 where role in ('manager','office') and not ('costs' = any(sections))
   and not exists (select 1 from public.audit_log where table_name = 'kimera_access' and changes ? 'sections' and action = 'update');

create or replace function public.my_kimera_sections() returns text[]
language sql stable security definer set search_path = public as $$
  select case when public.my_role() in ('boss','developer') then array['sell','make','buy','stock','items','plan','tickets','insights','settings','costs']
              else coalesce((select sections from public.kimera_access where role = public.my_role()), '{}') end
$$;

create or replace function public.can_see_costs() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and 'costs' = any(public.my_kimera_sections())
$$;

-- Re-applied at the end of every migration: hide these columns from API roles.
create or replace function public.apply_cost_privileges() returns void
language plpgsql security definer set search_path = public as $$
declare t record; cols text;
begin
  for t in select * from (values ('stock_items', array['avg_cost']), ('stock_movements', array['unit_cost']),
                                 ('po_lines', array['unit_cost']), ('item_suppliers', array['unit_cost'])) v(tbl, hidden) loop
    execute format('revoke select on public.%I from anon, authenticated', t.tbl);
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'public' and table_name = t.tbl and not (column_name = any(t.hidden));
    execute format('grant select (%s) on public.%I to authenticated', cols, t.tbl);
  end loop;
end $$;
revoke all on function public.apply_cost_privileges() from public, anon, authenticated;

-- {row id: cost} for one table, or null when this person may not see it.
create or replace function public.my_costs(p_table text, p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare buy boolean := 'buy' = any(public.my_kimera_sections()) and public.is_active();
begin
  if p_table = 'stock_items' and public.can_see_costs() then
    return (select coalesce(jsonb_object_agg(id, avg_cost), '{}') from public.stock_items);
  elsif p_table = 'stock_movements' and public.can_see_costs() then
    return (select coalesce(jsonb_object_agg(id, unit_cost), '{}') from public.stock_movements where p_since is null or created_at >= p_since);
  elsif p_table = 'po_lines' and (public.can_see_costs() or buy) then
    return (select coalesce(jsonb_object_agg(id, unit_cost), '{}') from public.po_lines);
  elsif p_table = 'item_suppliers' and (public.can_see_costs() or buy) then
    return (select coalesce(jsonb_object_agg(id, unit_cost), '{}') from public.item_suppliers);
  end if;
  return null;
end $$;
revoke all on function public.my_costs(text, timestamptz) from public, anon;
grant execute on function public.my_costs(text, timestamptz) to authenticated;

-- ============================================================================
-- KORTANA phase 3a — locations, per-location stock, bins, transfers
--  (INV-01, INV-05, INV-06, INV-07; scenario 6)
--  * one ledger: every movement now also records its location; stock_items.quantity
--    stays the company total and stock_levels holds the split per location
--  * a movement's location comes from its document (PO, sales order, MO,
--    transfer) or is given explicitly (adjust / count); otherwise the default
--  * transfers go A → "In transit" → B, so the company total never changes
--  * average cost stays per item (company-wide), not per location
-- ============================================================================
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'warehouse' check (kind in ('warehouse','production','partner','transit')),
  address text not null default '',
  is_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists locations_one_default on public.locations ((true)) where is_default;
create unique index if not exists locations_one_transit on public.locations ((true)) where kind = 'transit';
create unique index if not exists locations_name_key on public.locations (lower(name));
insert into public.locations (name, kind, is_default) select 'Skalarki', 'warehouse', true
  where not exists (select 1 from public.locations where is_default);
insert into public.locations (name, kind) select 'In transit', 'transit'
  where not exists (select 1 from public.locations where kind = 'transit');

create or replace function public.default_location() returns uuid
language sql stable security definer set search_path = public as $$ select id from public.locations where is_default limit 1 $$;
create or replace function public.transit_location() returns uuid
language sql stable security definer set search_path = public as $$ select id from public.locations where kind = 'transit' limit 1 $$;

create table if not exists public.stock_levels (
  item_id uuid not null references public.stock_items(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity numeric(14,3) not null default 0,
  bin text not null default '',
  updated_at timestamptz not null default now(),
  primary key (item_id, location_id)
);
create index if not exists stock_levels_location_idx on public.stock_levels (location_id);
alter table public.stock_movements add column if not exists location_id uuid references public.locations(id) on delete restrict;
create index if not exists stock_movements_location_idx on public.stock_movements (location_id, item_id);
alter table public.purchase_orders add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.orders add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.jobs add column if not exists location_id uuid references public.locations(id) on delete set null;
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('adjust','count','receive','consume','produce','import','opening','ship','return','transfer'));

-- Existing stock → the default location (the old free-text location becomes the bin there).
update public.stock_movements set location_id = public.default_location() where location_id is null;
insert into public.stock_levels (item_id, location_id, quantity, bin)
  select id, public.default_location(), quantity, coalesce(location, '') from public.stock_items
  on conflict (item_id, location_id) do nothing;

alter table public.locations enable row level security;
alter table public.stock_levels enable row level security;
drop policy if exists "staff read" on public.locations;
drop policy if exists "office write" on public.locations;
drop policy if exists "staff read" on public.stock_levels;
create policy "staff read" on public.locations for select to authenticated using (public.is_active());
create policy "office write" on public.locations for all to authenticated using (public.is_admin()) with check (public.is_admin() and kind <> 'transit');
create policy "staff read" on public.stock_levels for select to authenticated using (public.is_active());
-- stock_levels has no write policy: it only changes inside move_stock / set_bin.

-- Explicit location for the next movements (adjust, count, transfers).
create or replace function public.stock_location(p_loc uuid) returns void
language plpgsql set search_path = public as $$
begin perform set_config('app.stock_loc', coalesce(p_loc::text, ''), true); end $$;
revoke all on function public.stock_location(uuid) from public, anon, authenticated;

create or replace function public.move_stock(p_item uuid, p_delta numeric, p_reason text, p_ref text default '', p_note text default '', p_cost numeric default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s public.stock_items;
  q numeric;
  a numeric;
  loc uuid := nullif(current_setting('app.stock_loc', true), '')::uuid;
  st text := nullif(current_setting('app.stock_src_type', true), '');
  sid uuid := nullif(current_setting('app.stock_src_id', true), '')::uuid;
begin
  select * into s from public.stock_items where id = p_item for update;
  if s.id is null then raise exception 'Item not found'; end if;
  if s.kind = 'service' then raise exception 'Services are not kept in stock'; end if;
  -- where: explicit, else the document's location, else the default
  if loc is null then
    loc := case st
      when 'po_line' then (select p.location_id from public.po_lines l join public.purchase_orders p on p.id = l.po_id where l.id = sid)
      when 'order_line' then (select o.location_id from public.order_lines l join public.orders o on o.id = l.order_id where l.id = sid)
      when 'return' then (select o.location_id from public.order_returns r join public.orders o on o.id = r.order_id where r.id = sid)
      when 'job' then (select j.location_id from public.jobs j where j.id = sid)
      else null end;
  end if;
  loc := coalesce(loc, public.default_location());
  q := s.quantity + p_delta;
  a := case
         when p_cost is null then s.avg_cost
         when p_delta > 0 and q > 0 then round((greatest(s.quantity, 0) * s.avg_cost + p_delta * p_cost) / (greatest(s.quantity, 0) + p_delta), 4)
         when p_delta > 0 then p_cost
         when p_delta < 0 and q > 0 and s.quantity > 0 then greatest(round((s.quantity * s.avg_cost + p_delta * p_cost) / q, 4), 0)
         else s.avg_cost end;
  perform set_config('app.stock_move', 'on', true);
  update public.stock_items set quantity = q, avg_cost = a,
    updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
  where id = s.id;
  perform set_config('app.stock_move', 'off', true);
  insert into public.stock_levels (item_id, location_id, quantity) values (s.id, loc, p_delta)
  on conflict (item_id, location_id) do update set quantity = stock_levels.quantity + p_delta, updated_at = now();
  insert into public.stock_movements (item_id, delta, after, reason, ref, note, unit_cost, user_id, job_id, source_type, source_id, location_id)
  values (s.id, p_delta, q, p_reason, coalesce(p_ref, ''), coalesce(p_note, ''), coalesce(p_cost, s.avg_cost), auth.uid(),
          nullif(current_setting('app.stock_job', true), '')::uuid, st, sid, loc);
  return q;
end $$;
revoke all on function public.move_stock(uuid, numeric, text, text, text, numeric) from public, anon, authenticated;

-- Adjust / count at a location (default location when not given).
drop function if exists public.adjust_stock(uuid, numeric, text, text);
create or replace function public.adjust_stock(p_item uuid, p_delta numeric, p_note text default '', p_key text default null, p_location uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare prev text; q numeric;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change stock'; end if;
  if p_delta = 0 then raise exception 'Nothing to change'; end if;
  prev := public.claim_op('adjust_stock', p_key);
  if prev is not null then return prev::numeric; end if;
  perform public.stock_source('adjustment', null);
  perform public.stock_location(coalesce(p_location, public.default_location()));
  q := public.move_stock(p_item, p_delta, 'adjust', '', p_note);
  perform public.finish_op('adjust_stock', p_key, q::text);
  return q;
end $$;
revoke all on function public.adjust_stock(uuid, numeric, text, text, uuid) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text, text, uuid) to authenticated;

drop function if exists public.count_stock(uuid, numeric, text);
create or replace function public.count_stock(p_item uuid, p_counted numeric, p_note text default '', p_location uuid default null) returns numeric
language plpgsql security definer set search_path = public as $$
declare cur numeric; loc uuid := coalesce(p_location, public.default_location());
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change stock'; end if;
  if p_counted < 0 then raise exception 'A count cannot be negative'; end if;
  perform 1 from public.stock_items where id = p_item for update;
  select coalesce((select quantity from public.stock_levels where item_id = p_item and location_id = loc), 0) into cur;
  perform public.stock_source('count', null);
  perform public.stock_location(loc);
  perform public.move_stock(p_item, p_counted - cur, 'count', '', p_note);
  return p_counted;
end $$;
revoke all on function public.count_stock(uuid, numeric, text, uuid) from public, anon;
grant execute on function public.count_stock(uuid, numeric, text, uuid) to authenticated;

-- Bin (shelf / rack) of an item at a location.
create or replace function public.set_bin(p_item uuid, p_location uuid, p_bin text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change bins'; end if;
  insert into public.stock_levels (item_id, location_id, quantity, bin) values (p_item, p_location, 0, trim(coalesce(p_bin, '')))
  on conflict (item_id, location_id) do update set bin = excluded.bin, updated_at = now();
  if p_location = public.default_location() then
    update public.stock_items set location = trim(coalesce(p_bin, '')) where id = p_item;
  end if;
  return trim(coalesce(p_bin, ''));
end $$;
revoke all on function public.set_bin(uuid, uuid, text) from public, anon;
grant execute on function public.set_bin(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- transfers
create sequence if not exists public.tr_seq start 1;
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default 'TR-' || lpad(nextval('public.tr_seq')::text, 4, '0'),
  from_location uuid not null references public.locations(id) on delete restrict,
  to_location uuid not null references public.locations(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','in_transit','received','cancelled')),
  expected_date date,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  dispatched_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_location <> to_location)
);
create table if not exists public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  created_at timestamptz not null default now()
);
create index if not exists transfer_lines_transfer_idx on public.transfer_lines (transfer_id);
alter table public.stock_transfers enable row level security;
alter table public.transfer_lines enable row level security;
do $$
declare t text;
begin
  foreach t in array array['stock_transfers', 'transfer_lines', 'locations', 'stock_levels'] loop
    if t in ('stock_transfers', 'transfer_lines') then
      execute format('drop policy if exists "staff read" on public.%I', t);
      execute format('drop policy if exists "keepers write" on public.%I', t);
      execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_active())', t);
      execute format('create policy "keepers write" on public.%I for all to authenticated using (public.is_stock_keeper()) with check (public.is_stock_keeper())', t);
    end if;
    if t <> 'stock_levels' then
      execute format('drop trigger if exists audit_row on public.%I', t);
      execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    end if;
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Lines can only change while the transfer is a draft; posted transfers are reversed, not deleted.
create or replace function public.guard_transfer() returns trigger
language plpgsql set search_path = public as $$
declare st text;
begin
  if tg_table_name = 'transfer_lines' then
    select status into st from public.stock_transfers where id = coalesce(new.transfer_id, old.transfer_id);
    if st is not null and st <> 'draft' then raise exception 'This transfer has been dispatched — its lines are fixed'; end if;
  elsif tg_op = 'DELETE' and old.status <> 'draft' then
    raise exception 'Only draft transfers can be deleted — cancel it instead';
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and current_setting('app.transfer_post', true) is distinct from 'on' then
    raise exception 'Use Dispatch / Receive / Cancel to change a transfer';
  elsif tg_op = 'UPDATE' and old.status <> 'draft' and (new.from_location is distinct from old.from_location or new.to_location is distinct from old.to_location) then
    raise exception 'This transfer has been dispatched — its locations are fixed';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_transfer on public.stock_transfers;
create trigger guard_transfer before update or delete on public.stock_transfers for each row execute function public.guard_transfer();
drop trigger if exists guard_transfer_lines on public.transfer_lines;
create trigger guard_transfer_lines before insert or update or delete on public.transfer_lines for each row execute function public.guard_transfer();

create or replace function public.post_transfer(p_id uuid, p_action text, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare tr public.stock_transfers; l record; prev text; tl uuid := public.transit_location(); st text;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can move stock between locations'; end if;
  if p_action not in ('dispatch', 'receive', 'cancel') then raise exception 'Unknown transfer action'; end if;
  prev := public.claim_op('post_transfer', p_key);
  if prev is not null then return prev; end if;
  select * into tr from public.stock_transfers where id = p_id for update;
  if tr.id is null then raise exception 'Transfer not found'; end if;
  if p_action = 'dispatch' and tr.status <> 'draft' then raise exception 'Only a draft transfer can be dispatched'; end if;
  if p_action = 'receive' and tr.status <> 'in_transit' then raise exception 'Only a dispatched transfer can be received'; end if;
  if p_action = 'cancel' and tr.status not in ('draft', 'in_transit') then raise exception 'This transfer is already %', tr.status; end if;
  if p_action = 'dispatch' and not exists (select 1 from public.transfer_lines where transfer_id = tr.id) then raise exception 'Add items first'; end if;
  for l in select * from public.transfer_lines where transfer_id = tr.id order by created_at loop
    perform public.stock_source('transfer_line', l.id);
    if p_action = 'dispatch' then
      perform public.stock_location(tr.from_location); perform public.move_stock(l.item_id, -l.quantity, 'transfer', tr.number, 'Dispatched');
      perform public.stock_location(tl);              perform public.move_stock(l.item_id, l.quantity, 'transfer', tr.number, 'In transit');
    elsif p_action = 'receive' then
      perform public.stock_location(tl);              perform public.move_stock(l.item_id, -l.quantity, 'transfer', tr.number, 'Arrived');
      perform public.stock_location(tr.to_location);  perform public.move_stock(l.item_id, l.quantity, 'transfer', tr.number, 'Received');
    elsif tr.status = 'in_transit' then
      perform public.stock_location(tl);              perform public.move_stock(l.item_id, -l.quantity, 'transfer', tr.number, 'Cancelled — back');
      perform public.stock_location(tr.from_location); perform public.move_stock(l.item_id, l.quantity, 'transfer', tr.number, 'Cancelled — returned');
    end if;
  end loop;
  perform public.stock_location(null);
  st := case p_action when 'dispatch' then 'in_transit' when 'receive' then 'received' else 'cancelled' end;
  perform set_config('app.transfer_post', 'on', true);
  update public.stock_transfers set status = st,
    dispatched_at = case when p_action = 'dispatch' then now() else dispatched_at end,
    received_at = case when p_action = 'receive' then now() else received_at end
  where id = tr.id;
  perform set_config('app.transfer_post', 'off', true);
  return public.finish_op('post_transfer', p_key, st);
end $$;
revoke all on function public.post_transfer(uuid, text, text) from public, anon;
grant execute on function public.post_transfer(uuid, text, text) to authenticated;

-- ============================================================================
-- KORTANA phase 3b — priority ranks, server-side allocation, no over-shipping
--  (ALLOC-01..07, SALES-03/04, MFG-04; scenarios 2 and 13)
-- Policy (deterministic, recomputed on every call, same answer for everyone):
--  demand  = open sales lines not yet shipped (stocked items, no MO),
--            ingredients of unfinished MOs (recipe × qty), draft transfer lines;
--            a make-to-order line whose MO is done is pegged to that output first
--  order   = rank (lower first; MTO MOs use their sales order's rank),
--            then required date (none = last), then created time, then id
--  supply  = on hand at the demand's location first, then expected supply at that
--            location in date order: open PO lines, open MO output, transfers in transit
--  result  = per line/MO: In stock / Expected (date + source) / Not available,
--            with the reason and who holds the stock when it is short
-- ============================================================================
alter table public.orders add column if not exists rank numeric;
alter table public.jobs add column if not exists rank numeric;
update public.orders set rank = extract(epoch from coalesce(ordered_at, created_at)) where rank is null;
update public.jobs set rank = extract(epoch from created_at) where rank is null;
create or replace function public.default_rank() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.rank is null then
    new.rank := extract(epoch from coalesce((to_jsonb(new)->>'ordered_at')::timestamptz, new.created_at, now()));
  end if;
  return new;
end $$;
drop trigger if exists default_rank on public.orders;
create trigger default_rank before insert on public.orders for each row execute function public.default_rank();
drop trigger if exists default_rank on public.jobs;
create trigger default_rank before insert on public.jobs for each row execute function public.default_rank();

-- Move a sales order (or make-to-stock MO) to just before another one in the queue.
create or replace function public.set_rank(p_kind text, p_id uuid, p_before uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare tgt numeric; prev numeric; r numeric;
begin
  if not public.is_admin() then raise exception 'Only the office team can change priorities'; end if;
  if p_kind = 'order' then
    if p_before is null then select coalesce(max(rank), 0) + 1 into r from public.orders where kind = 'order' and status = 'open';
    else
      select rank into tgt from public.orders where id = p_before;
      if tgt is null then raise exception 'Order not found'; end if;
      select max(rank) into prev from public.orders where kind = 'order' and status = 'open' and rank < tgt and id <> p_id;
      r := case when prev is null then tgt - 1 else (prev + tgt) / 2 end;
    end if;
    update public.orders set rank = r where id = p_id;
  elsif p_kind = 'job' then
    if exists (select 1 from public.jobs where id = p_id and order_id is not null) then
      raise exception 'Make-to-order MOs follow their sales order — move the order instead';
    end if;
    if p_before is null then select coalesce(max(rank), 0) + 1 into r from public.jobs where status <> 'done';
    else
      select coalesce(j.rank, o.rank) into tgt from public.jobs j left join public.orders o on o.id = j.order_id where j.id = p_before;
      if tgt is null then raise exception 'Manufacturing order not found'; end if;
      select max(coalesce(j.rank, o.rank)) into prev from public.jobs j left join public.orders o on o.id = j.order_id
       where j.status <> 'done' and coalesce(j.rank, o.rank) < tgt and j.id <> p_id;
      r := case when prev is null then tgt - 1 else (prev + tgt) / 2 end;
    end if;
    update public.jobs set rank = r where id = p_id;
  else raise exception 'Unknown kind';
  end if;
  return r;
end $$;
revoke all on function public.set_rank(text, uuid, uuid) from public, anon;
grant execute on function public.set_rank(text, uuid, uuid) to authenticated;

create or replace function public.availability() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record; e record; need numeric; take numeric; got numeric; exp_qty numeric; exp_date date; exp_src text;
  holders text; tl uuid := public.transit_location(); dl uuid := public.default_location();
  lines jsonb := '{}'; ingr jsonb := '{}'; items jsonb := '{}'; st text; why text; nm text;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  create temp table if not exists av_supply (item_id uuid, location_id uuid, qty numeric, primary key (item_id, location_id)) on commit drop;
  create temp table if not exists av_expected (item_id uuid, location_id uuid, due date, src text, qty numeric, ord int) on commit drop;
  create temp table if not exists av_taken (item_id uuid, location_id uuid, who text, qty numeric, ord int) on commit drop;
  create temp table if not exists av_demand (kind text, ref_id uuid, owner_id uuid, label text, item_id uuid, location_id uuid,
    qty numeric, pegged boolean, rank numeric, due date, created timestamptz) on commit drop;
  truncate av_supply, av_expected, av_taken, av_demand;

  -- in transit and on the production floor (picked for an MO) is not free stock
  insert into av_supply select item_id, location_id, quantity from public.stock_levels
   where location_id not in (select id from public.locations where kind in ('transit', 'wip'));
  insert into av_expected
    select l.item_id, coalesce(p.location_id, dl), p.expected_date, p.number, l.quantity - l.received, 0
      from public.po_lines l join public.purchase_orders p on p.id = l.po_id
     where p.status in ('ordered', 'partial') and l.quantity > l.received
    union all
    select si.id, coalesce(j.location_id, dl), j.due_date, j.code, j.quantity - j.produced, 0
      from public.jobs j join lateral (select id from public.stock_items where sku = j.sku and kind not in ('material', 'service') order by created_at limit 1) si on true
     where j.status <> 'done' and not j.stock_booked and j.sku is not null and coalesce(j.quantity, 0) > j.produced
    union all
    select tl2.item_id, t.to_location, t.expected_date, t.number, tl2.quantity, 0
      from public.transfer_lines tl2 join public.stock_transfers t on t.id = tl2.transfer_id where t.status = 'in_transit';

  -- sales lines (stocked, not yet shipped). MTO lines with a finished MO are pegged to it.
  insert into av_demand
    select 'line', l.id, o.id, o.order_number, l.item_id, coalesce(o.location_id, dl), l.quantity - l.shipped,
           (j.id is not null and j.stock_booked), o.rank, o.delivery_deadline, o.created_at
      from public.order_lines l join public.orders o on o.id = l.order_id
      join public.stock_items si on si.id = l.item_id and si.kind <> 'service'
      left join public.jobs j on j.order_line_id = l.id
     where o.kind = 'order' and o.status = 'open' and l.quantity > l.shipped
       and (j.id is null or j.stock_booked);
  -- ingredients of unfinished MOs
  insert into av_demand
    -- still needed = recipe × (qty − already produced) − what is already picked for this MO
    select 'ingredient', j.id, j.id, j.code, b.material_id, coalesce(j.location_id, dl),
           greatest(b.quantity * (coalesce(j.quantity, 1) - j.produced) - coalesce(mm.picked - mm.used_from_wip - mm.returned, 0), 0),
           false, coalesce(o.rank, j.rank), j.due_date, j.created_at
      from public.jobs j
      join lateral (select id from public.stock_items where sku = j.sku and kind <> 'service' order by (kind = 'material'), created_at limit 1) p on true
      join public.bom_lines b on b.product_id = p.id
      join public.stock_items m on m.id = b.material_id and m.kind <> 'service'
      left join public.mo_materials mm on mm.job_id = j.id and mm.item_id = b.material_id
      left join public.orders o on o.id = j.order_id
     where j.status <> 'done' and not j.stock_booked and j.sku is not null;
  -- draft transfers reserve at their source
  insert into av_demand
    select 'transfer', tl2.id, t.id, t.number, tl2.item_id, t.from_location, tl2.quantity, false,
           extract(epoch from t.created_at), t.expected_date, t.created_at
      from public.transfer_lines tl2 join public.stock_transfers t on t.id = tl2.transfer_id where t.status = 'draft';

  for d in select * from av_demand order by pegged desc, rank nulls last, due nulls last, created, ref_id loop
    need := d.qty;
    select coalesce(qty, 0) into got from av_supply where item_id = d.item_id and location_id = d.location_id;
    got := coalesce(got, 0);
    take := least(greatest(got, 0), need);
    if take > 0 then
      update av_supply set qty = qty - take where item_id = d.item_id and location_id = d.location_id;
      insert into av_taken values (d.item_id, d.location_id, d.label, take, 0);
    end if;
    need := need - take;
    exp_qty := 0; exp_date := null; exp_src := null;
    for e in select ctid, * from av_expected where item_id = d.item_id and location_id = d.location_id and qty > 0
              order by due nulls last, src loop
      exit when need <= 0;
      got := least(e.qty, need);
      update av_expected set qty = qty - got where ctid = e.ctid;
      need := need - got; exp_qty := exp_qty + got; exp_date := e.due;
      exp_src := coalesce(exp_src || ', ', '') || e.src;
    end loop;
    if need > 0 then
      select string_agg(distinct who, ', ') into holders from (select who from av_taken where item_id = d.item_id and location_id = d.location_id and who <> d.label limit 4) h;
      select name into nm from public.locations where id = d.location_id;
      st := 'not_available';
      why := format('%s short at %s', trim_scale(need), nm)
          || case when holders is not null then format(' — on-hand stock is promised to %s (higher priority)', holders) else ' — none on hand or on order' end;
    elsif exp_qty > 0 then
      st := 'expected';
      why := format('%s reserved now, %s expected from %s', trim_scale(take), trim_scale(exp_qty), exp_src);
    else
      st := 'in_stock'; why := format('%s reserved from stock', trim_scale(take));
    end if;
    if d.kind in ('line', 'transfer') then
      lines := lines || jsonb_build_object(d.ref_id::text, jsonb_build_object('status', st, 'reserved', take, 'expected', exp_qty,
        'short', need, 'date', exp_date, 'why', why, 'kind', d.kind));
    else
      -- an MO is as available as its worst ingredient
      ingr := jsonb_set(ingr, array[d.ref_id::text], jsonb_build_object(
        'status', case when st = 'not_available' or ingr->d.ref_id::text->>'status' = 'not_available' then 'not_available'
                       when st = 'expected' or ingr->d.ref_id::text->>'status' = 'expected' then 'expected' else 'in_stock' end,
        'date', greatest((ingr->d.ref_id::text->>'date')::date, exp_date),
        'short', coalesce(ingr->d.ref_id::text->'short', '[]'::jsonb) || case when need > 0
             then jsonb_build_array(jsonb_build_object('item_id', d.item_id, 'short', need, 'why', why)) else '[]'::jsonb end), true);
    end if;
  end loop;

  select coalesce(jsonb_object_agg(item_id, jsonb_build_object('on_hand', on_hand, 'reserved', reserved, 'available', on_hand - reserved)), '{}') into items
    from (select s.item_id, sum(s.quantity) on_hand, coalesce((select sum(qty) from av_taken t where t.item_id = s.item_id), 0) reserved
            from public.stock_levels s where s.location_id not in (select id from public.locations where kind in ('transit', 'wip')) group by s.item_id) x;
  return jsonb_build_object('lines', lines, 'mos', ingr, 'items', items, 'at', now());
end $$;
revoke all on function public.availability() from public, anon;
grant execute on function public.availability() to authenticated;

-- Never ship or dispatch more than is physically at that location (scenario 13:
-- two people shipping the last unit at once — the item row lock serialises them,
-- the second one is refused).
create or replace function public.guard_overdraw() returns trigger
language plpgsql set search_path = public as $$
declare lvl numeric; nm text; it text;
begin
  if new.delta < 0 and (new.reason = 'ship'
      or (new.reason in ('transfer', 'pick') and new.location_id not in (select id from public.locations where kind in ('transit', 'wip')))) then
    select quantity into lvl from public.stock_levels where item_id = new.item_id and location_id = new.location_id;
    if coalesce(lvl, 0) < 0 then
      select name into nm from public.locations where id = new.location_id;
      select sku into it from public.stock_items where id = new.item_id;
      raise exception 'Not enough % at % — only % there', it, nm, trim_scale(coalesce(lvl, 0) - new.delta);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_overdraw on public.stock_movements;
create trigger guard_overdraw after insert on public.stock_movements for each row execute function public.guard_overdraw();

-- ============================================================================
-- KORTANA phase 4a — picking, partial completion, actual consumption,
-- unused materials (MFG-10..13, MFG-14 materials; scenario 5)
--  * pick: materials move from the MO's location to "Production floor (WIP)";
--    they stay company stock but are no longer free for other orders
--  * produce part of an MO: consumes recipe × qty (or the actual quantities
--    used) — picked material first, the rest from the shelf — and puts the
--    output on stock at the cost of what it consumed
--  * finishing (here or when the last station is done in the Factory app)
--    produces the rest and returns unused picked material to the shelf
--  * reopening reverses every consumption / output at the location it came from
-- ============================================================================
alter table public.locations drop constraint if exists locations_kind_check;
alter table public.locations add constraint locations_kind_check check (kind in ('warehouse','production','partner','transit','wip'));
create unique index if not exists locations_one_wip on public.locations ((true)) where kind = 'wip';
insert into public.locations (name, kind) select 'Production floor (WIP)', 'wip'
  where not exists (select 1 from public.locations where kind = 'wip');
create or replace function public.wip_location() returns uuid
language sql stable security definer set search_path = public as $$ select id from public.locations where kind = 'wip' limit 1 $$;
drop policy if exists "office write" on public.locations;
create policy "office write" on public.locations for all to authenticated using (public.is_admin()) with check (public.is_admin() and kind not in ('transit', 'wip'));

alter table public.jobs add column if not exists produced numeric(14,3) not null default 0 check (produced >= 0);
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('adjust','count','receive','consume','produce','import','opening','ship','return','transfer','pick'));

create table if not exists public.mo_materials (
  job_id uuid not null references public.jobs(id) on delete restrict,
  item_id uuid not null references public.stock_items(id) on delete restrict,
  picked numeric(14,3) not null default 0,
  used_from_wip numeric(14,3) not null default 0,
  returned numeric(14,3) not null default 0,
  primary key (job_id, item_id),
  check (picked >= 0 and used_from_wip >= 0 and returned >= 0 and used_from_wip + returned <= picked)
);
alter table public.mo_materials enable row level security;
drop policy if exists "staff read" on public.mo_materials;
create policy "staff read" on public.mo_materials for select to authenticated using (public.is_active());
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mo_materials') then
    alter publication supabase_realtime add table public.mo_materials;
  end if;
end $$;

-- Who may run the floor side of an MO: stock keepers, or the crew on that job.
create or replace function public.can_work_mo(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and (public.is_stock_keeper() or public.on_job(p_job))
$$;

-- Product row an MO makes (same rule as book_job_stock).
create or replace function public.mo_product(p_job uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.id from public.jobs j join public.stock_items s on s.sku = j.sku and s.kind not in ('material','service') where j.id = p_job order by s.created_at limit 1),
    (select s.id from public.jobs j join public.stock_items s on s.sku = j.sku and s.kind <> 'service' where j.id = p_job order by s.created_at limit 1))
$$;

-- Pick materials for an MO. p_lines = [{"item": uuid, "qty": n}]; null = everything still needed.
create or replace function public.pick_mo(p_job uuid, p_lines jsonb default null, p_key text default null) returns int
language plpgsql security definer set search_path = public as $$
declare j public.jobs; prev text; r record; n int := 0; loc uuid; w uuid := public.wip_location(); prod uuid;
begin
  if not public.can_work_mo(p_job) then raise exception 'Only stock keepers or the crew on this job can pick materials'; end if;
  prev := public.claim_op('pick_mo', p_key);
  if prev is not null then return prev::int; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  if j.status = 'done' then raise exception 'This manufacturing order is finished'; end if;
  loc := coalesce(j.location_id, public.default_location());
  prod := public.mo_product(j.id);
  for r in
    select x.item_id, x.qty from (
      select (e->>'item')::uuid item_id, (e->>'qty')::numeric qty from jsonb_array_elements(p_lines) e where p_lines is not null
      union all
      select b.material_id, greatest(b.quantity * (coalesce(j.quantity, 1) - j.produced) - coalesce(mm.picked - mm.used_from_wip - mm.returned, 0), 0)
        from public.bom_lines b join public.stock_items m on m.id = b.material_id and m.kind <> 'service'
        left join public.mo_materials mm on mm.job_id = j.id and mm.item_id = b.material_id
       where p_lines is null and b.product_id = prod) x
    where x.qty > 0 loop
    perform set_config('app.stock_job', j.id::text, true);
    perform public.stock_source('job', j.id);
    perform public.stock_location(loc); perform public.move_stock(r.item_id, -r.qty, 'pick', j.code, 'Picked');
    perform public.stock_location(w);   perform public.move_stock(r.item_id, r.qty, 'pick', j.code, 'On the production floor');
    insert into public.mo_materials (job_id, item_id, picked) values (j.id, r.item_id, r.qty)
    on conflict (job_id, item_id) do update set picked = mo_materials.picked + r.qty;
    n := n + 1;
  end loop;
  perform public.stock_location(null); perform set_config('app.stock_job', '', true);
  if n = 0 then raise exception 'Nothing left to pick'; end if;
  perform public.finish_op('pick_mo', p_key, n::text);
  return n;
end $$;
revoke all on function public.pick_mo(uuid, jsonb, text) from public, anon;
grant execute on function public.pick_mo(uuid, jsonb, text) to authenticated;

-- Put unused picked material back on the shelf. p_lines null = all of it.
create or replace function public.return_mo_materials_core(p_job uuid, p_lines jsonb default null) returns int
language plpgsql security definer set search_path = public as $$
declare j public.jobs; mm record; q numeric; n int := 0; loc uuid; w uuid := public.wip_location();
begin
  select * into j from public.jobs where id = p_job;
  loc := coalesce(j.location_id, public.default_location());
  for mm in select * from public.mo_materials where job_id = p_job for update loop
    q := mm.picked - mm.used_from_wip - mm.returned;
    if p_lines is not null then
      q := least(q, coalesce((select (e->>'qty')::numeric from jsonb_array_elements(p_lines) e where (e->>'item')::uuid = mm.item_id), 0));
    end if;
    continue when q <= 0;
    perform set_config('app.stock_job', j.id::text, true);
    perform public.stock_source('job', j.id);
    perform public.stock_location(w);   perform public.move_stock(mm.item_id, -q, 'pick', j.code, 'Unused — back to the shelf');
    perform public.stock_location(loc); perform public.move_stock(mm.item_id, q, 'pick', j.code, 'Unused — back to the shelf');
    update public.mo_materials set returned = returned + q where job_id = mm.job_id and item_id = mm.item_id;
    n := n + 1;
  end loop;
  perform public.stock_location(null); perform set_config('app.stock_job', '', true);
  return n;
end $$;
revoke all on function public.return_mo_materials_core(uuid, jsonb) from public, anon, authenticated;
create or replace function public.return_mo_materials(p_job uuid, p_lines jsonb default null, p_key text default null) returns int
language plpgsql security definer set search_path = public as $$
declare prev text; n int;
begin
  if not public.can_work_mo(p_job) then raise exception 'Only stock keepers or the crew on this job can return materials'; end if;
  prev := public.claim_op('return_mo_materials', p_key);
  if prev is not null then return prev::int; end if;
  perform 1 from public.jobs where id = p_job for update;
  n := public.return_mo_materials_core(p_job, p_lines);
  perform public.finish_op('return_mo_materials', p_key, n::text);
  return n;
end $$;
revoke all on function public.return_mo_materials(uuid, jsonb, text) from public, anon;
grant execute on function public.return_mo_materials(uuid, jsonb, text) to authenticated;

-- Core: produce p_qty of an MO. p_actual = {"<item id>": qty used} overrides the recipe.
-- Consumes picked (WIP) material first, then from the MO's location; output at consumed cost.
create or replace function public.produce_core(p_job uuid, p_qty numeric, p_actual jsonb default null, p_bump boolean default true) returns numeric
language plpgsql security definer set search_path = public as $$
declare j public.jobs; prod uuid; b record; need numeric; fromw numeric; avail numeric; total numeric := 0; c numeric;
        loc uuid; w uuid := public.wip_location(); has_bom boolean := false;
begin
  select * into j from public.jobs where id = p_job;
  prod := public.mo_product(j.id);
  if prod is null then return 0; end if;
  loc := coalesce(j.location_id, public.default_location());
  perform set_config('app.stock_job', j.id::text, true);
  perform public.stock_source('job', j.id);
  for b in
    select x.item_id, sum(x.qty) qty from (
      select bl.material_id item_id, bl.quantity * p_qty qty from public.bom_lines bl join public.stock_items m on m.id = bl.material_id and m.kind <> 'service'
       where bl.product_id = prod and (p_actual is null or not (p_actual ? bl.material_id::text))
      union all
      select (k)::uuid, (p_actual->>k)::numeric from jsonb_object_keys(coalesce(p_actual, '{}'::jsonb)) k) x
    group by x.item_id loop
    has_bom := true;
    need := b.qty;
    continue when need <= 0;
    select coalesce(picked - used_from_wip - returned, 0) into avail from public.mo_materials where job_id = j.id and item_id = b.item_id for update;
    fromw := least(greatest(coalesce(avail, 0), 0), need);
    select avg_cost into c from public.stock_items where id = b.item_id;
    total := total + need * coalesce(c, 0);
    if fromw > 0 then
      perform public.stock_location(w); perform public.move_stock(b.item_id, -fromw, 'consume', j.code, '');
      update public.mo_materials set used_from_wip = used_from_wip + fromw where job_id = j.id and item_id = b.item_id;
    end if;
    if need - fromw > 0 then
      perform public.stock_location(loc); perform public.move_stock(b.item_id, -(need - fromw), 'consume', j.code, '');
    end if;
  end loop;
  perform public.stock_location(loc);
  perform public.move_stock(prod, p_qty, 'produce', j.code, case when p_qty < coalesce(j.quantity, 1) - j.produced then 'Part completed' else '' end,
                            case when has_bom then round(total / p_qty, 4) end);
  perform public.stock_location(null); perform set_config('app.stock_job', '', true);
  if p_bump then update public.jobs set produced = produced + p_qty where id = j.id; end if; -- the finishing trigger sets it itself
  return p_qty;
end $$;
revoke all on function public.produce_core(uuid, numeric, jsonb, boolean) from public, anon, authenticated;

-- App: complete part (or the rest) of an MO.
create or replace function public.produce_mo(p_job uuid, p_qty numeric, p_actual jsonb default null, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare j public.jobs; prev text; left_qty numeric;
begin
  if not public.can_work_mo(p_job) then raise exception 'Only stock keepers or the crew on this job can book production'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Make at least one'; end if;
  prev := public.claim_op('produce_mo', p_key);
  if prev is not null then return prev; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  if j.status = 'done' then raise exception 'This manufacturing order is finished'; end if;
  left_qty := coalesce(j.quantity, 1) - j.produced;
  if p_qty > left_qty then raise exception 'Only % left to make on this order', trim_scale(left_qty); end if;
  if public.mo_product(j.id) is null then raise exception 'No stock item with SKU % — add it under Items first', j.sku; end if;
  perform public.produce_core(j.id, p_qty, p_actual);
  if p_qty = left_qty then
    -- finished: book it done without consuming again, then return what was not used
    perform public.return_mo_materials_core(j.id, null);
    update public.jobs set status = 'done', completed_at = now(), stock_booked = true,
      stage = greatest(coalesce(array_length(route, 1), 1) - 1, 0) where id = j.id;
    update public.work_sessions set ended_at = now() where job_id = j.id and ended_at is null;
    update public.participants set left_at = now() where job_id = j.id and left_at is null;
    return public.finish_op('produce_mo', p_key, 'done');
  end if;
  return public.finish_op('produce_mo', p_key, 'partial');
end $$;
revoke all on function public.produce_mo(uuid, numeric, jsonb, text) from public, anon;
grant execute on function public.produce_mo(uuid, numeric, jsonb, text) to authenticated;

-- Finishing / reopening an MO any other way (Factory app last station, Kortana Complete/Reopen).
create or replace function public.book_job_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record; rest numeric;
begin
  -- Reopened: reverse every consumption and output at the location it happened.
  if old.status = 'done' and new.status <> 'done' and old.stock_booked then
    perform set_config('app.stock_job', new.id::text, true);
    perform public.stock_source('job', new.id);
    for m in select item_id, reason, location_id, sum(delta) as net,
                    case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end as cost
               from public.stock_movements
              where job_id = new.id and reason in ('consume', 'produce') group by item_id, reason, location_id having sum(delta) <> 0
              order by reason desc loop
      perform public.stock_location(m.location_id);
      perform public.move_stock(m.item_id, -m.net, m.reason, new.code, 'Reopened — reversed', m.cost);
    end loop;
    perform public.stock_location(null);
    perform set_config('app.stock_job', '', true);
    update public.mo_materials set used_from_wip = 0 where job_id = new.id;
    new.stock_booked := false;
    new.produced := 0;
    return new;
  end if;
  if new.status <> 'done' or old.status = 'done' or new.stock_booked or new.sku is null then return new; end if;
  if public.mo_product(new.id) is null then return new; end if;
  rest := coalesce(new.quantity, 1) - coalesce(old.produced, 0);
  if rest > 0 then perform public.produce_core(new.id, rest, null, false); end if;
  perform public.return_mo_materials_core(new.id, null);
  new.produced := coalesce(new.quantity, 1);
  new.stock_booked := true;
  return new;
end $$;
drop trigger if exists book_job_stock on public.jobs;
create trigger book_job_stock before update of status on public.jobs
  for each row execute function public.book_job_stock();

-- ============================================================================
-- KORTANA phase 4b — operations, resource rates, manufacturing cost, deadlines
-- (MFG-06/08/09/14/15, REP-04)
--  * product_operations: the steps to make a product, each at a station
--    (resource) with setup minutes (once per MO), minutes per unit and a fixed cost
--  * stations.cost_per_hour: what an hour at that station costs
--  * company_settings.labour_rate / work_hours_per_day: actual labour cost from the
--    time people logged on the job in the Factory app, and the working day length
--  * mo_costs(): planned vs actual materials, operations and labour, minutes, and
--    an estimated finish date compared with the deadline. Only for "Costs & margins".
--  * operation and labour costs are reported per MO; stock is valued at material
--    cost (see open question 25)
-- ============================================================================
alter table public.stations add column if not exists cost_per_hour numeric(10,2) not null default 0 check (cost_per_hour >= 0);
alter table public.company_settings add column if not exists labour_rate numeric(10,2) not null default 0 check (labour_rate >= 0);
alter table public.company_settings add column if not exists work_hours_per_day numeric(4,2) not null default 8 check (work_hours_per_day > 0 and work_hours_per_day <= 24);

create table if not exists public.product_operations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.stock_items(id) on delete cascade,
  station_id uuid references public.stations(id) on delete set null,
  name text not null default '',
  setup_minutes numeric(10,2) not null default 0 check (setup_minutes >= 0),
  unit_minutes numeric(10,3) not null default 0 check (unit_minutes >= 0),
  fixed_cost numeric(12,2) not null default 0 check (fixed_cost >= 0),
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists product_operations_product_idx on public.product_operations (product_id, sort);
alter table public.product_operations enable row level security;
drop policy if exists "staff read" on public.product_operations;
drop policy if exists "office write" on public.product_operations;
create policy "staff read" on public.product_operations for select to authenticated using (public.is_active());
create policy "office write" on public.product_operations for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop trigger if exists audit_row on public.product_operations;
create trigger audit_row after insert or update or delete on public.product_operations for each row execute function public.audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_operations') then
    alter publication supabase_realtime add table public.product_operations;
  end if;
end $$;

create or replace function public.mo_costs(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  j public.jobs; prod uuid; qty numeric; cs public.company_settings;
  mat_plan numeric; mat_act numeric; ops jsonb; ops_cost numeric; ops_min numeric; hours numeric; labour numeric;
  left_min numeric; days int; finish date;
begin
  if not public.can_see_costs() then return null; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  select * into cs from public.company_settings where id = 1;
  prod := public.mo_product(j.id);
  qty := coalesce(j.quantity, 1);
  select coalesce(sum(b.quantity * qty * s.avg_cost), 0) into mat_plan
    from public.bom_lines b join public.stock_items s on s.id = b.material_id where b.product_id = prod;
  select coalesce(sum(-delta * coalesce(unit_cost, 0)), 0) into mat_act
    from public.stock_movements where job_id = j.id and reason = 'consume';
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(nullif(o.name, ''), st.name, 'Operation'), 'station', st.name,
           'minutes', o.setup_minutes + o.unit_minutes * qty,
           'cost', round((o.setup_minutes + o.unit_minutes * qty) / 60 * coalesce(st.cost_per_hour, 0) + o.fixed_cost, 2)) order by o.sort, o.created_at), '[]'),
         coalesce(sum(round((o.setup_minutes + o.unit_minutes * qty) / 60 * coalesce(st.cost_per_hour, 0) + o.fixed_cost, 2)), 0),
         coalesce(sum(o.setup_minutes + o.unit_minutes * qty), 0)
    into ops, ops_cost, ops_min
    from public.product_operations o left join public.stations st on st.id = o.station_id where o.product_id = prod;
  select coalesce(sum(extract(epoch from (coalesce(p.left_at, now()) - p.joined_at)) / 3600), 0) into hours
    from public.participants p where p.job_id = j.id;
  labour := round(hours * cs.labour_rate, 2);
  -- remaining operation time → working days → estimated finish (MFG-09)
  left_min := case when ops_min > 0 then ops_min * (qty - j.produced) / qty else coalesce(j.estimate_minutes, 0) * (qty - j.produced) end;
  days := case when j.status = 'done' or left_min <= 0 then 0 else ceil(left_min / (cs.work_hours_per_day * 60))::int end;
  finish := case when j.status = 'done' then j.completed_at::date else current_date + days end;
  return jsonb_build_object(
    'quantity', qty, 'produced', j.produced,
    'materials_planned', round(mat_plan, 2), 'materials_actual', round(mat_act, 2),
    'operations', ops, 'operations_planned', ops_cost, 'minutes_planned', ops_min,
    'labour_hours', round(hours, 2), 'labour_rate', cs.labour_rate, 'labour_actual', labour,
    'total_planned', round(mat_plan + ops_cost, 2), 'total_actual', round(mat_act + labour + (select coalesce(sum(fixed_cost), 0) from public.product_operations where product_id = prod), 2),
    'unit_planned', round((mat_plan + ops_cost) / qty, 4),
    'estimated_finish', finish, 'due', j.due_date, 'late', (j.due_date is not null and finish > j.due_date and j.status <> 'done'));
end $$;
revoke all on function public.mo_costs(uuid) from public, anon;
grant execute on function public.mo_costs(uuid) to authenticated;

-- Station hourly rates are costs too.
create or replace function public.apply_cost_privileges() returns void
language plpgsql security definer set search_path = public as $$
declare t record; cols text;
begin
  for t in select * from (values ('stock_items', array['avg_cost']), ('stock_movements', array['unit_cost']),
                                 ('po_lines', array['unit_cost']), ('item_suppliers', array['unit_cost']),
                                 ('stations', array['cost_per_hour']), ('product_operations', array['fixed_cost'])) v(tbl, hidden) loop
    execute format('revoke select on public.%I from anon, authenticated', t.tbl);
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'public' and table_name = t.tbl and not (column_name = any(t.hidden));
    execute format('grant select (%s) on public.%I to authenticated', cols, t.tbl);
  end loop;
end $$;
revoke all on function public.apply_cost_privileges() from public, anon, authenticated;

create or replace function public.my_costs(p_table text, p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare buy boolean := 'buy' = any(public.my_kimera_sections()) and public.is_active();
begin
  if p_table = 'stock_items' and public.can_see_costs() then
    return (select coalesce(jsonb_object_agg(id, avg_cost), '{}') from public.stock_items);
  elsif p_table = 'stock_movements' and public.can_see_costs() then
    return (select coalesce(jsonb_object_agg(id, unit_cost), '{}') from public.stock_movements where p_since is null or created_at >= p_since);
  elsif p_table = 'po_lines' and (public.can_see_costs() or buy) then
    return (select coalesce(jsonb_object_agg(id, unit_cost), '{}') from public.po_lines);
  elsif p_table = 'item_suppliers' and (public.can_see_costs() or buy) then
    return (select coalesce(jsonb_object_agg(id, unit_cost), '{}') from public.item_suppliers);
  elsif p_table = 'stations' and public.can_see_costs() then
    return (select coalesce(jsonb_object_agg(id, cost_per_hour), '{}') from public.stations);
  elsif p_table = 'product_operations' and public.can_see_costs() then
    return (select coalesce(jsonb_object_agg(id, fixed_cost), '{}') from public.product_operations);
  end if;
  return null;
end $$;
revoke all on function public.my_costs(text, timestamptz) from public, anon;
grant execute on function public.my_costs(text, timestamptz) to authenticated;

-- ============================================================================
-- KORTANA phase 4c — batches, serial numbers, expiry, traceability
-- (INV-10..13, BUY-04, MFG lot genealogy; scenario 7)
--  * stock_items.tracking: none | batch | serial
--  * a movement of a tracked item carries its lot; stock leaving without a named
--    lot is drawn first-expiry-first-out (then oldest) at that location
--  * receiving names the batch (default: the PO number) and its expiry; serial
--    items get one lot per piece
--  * production output gets a batch (the MO code) or serials, linked to every
--    material lot it consumed (lot_links) → trace_lot() walks both directions
--  * reversals (reopen, undo shipment, return, reverse receipt) go back into the
--    lot the stock came from
-- ============================================================================
alter table public.stock_items add column if not exists tracking text not null default 'none' check (tracking in ('none', 'batch', 'serial'));

create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id) on delete restrict,
  code text not null,
  expiry date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (item_id, code)
);
create table if not exists public.lot_levels (
  lot_id uuid not null references public.lots(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity numeric(14,3) not null default 0,
  primary key (lot_id, location_id)
);
create table if not exists public.lot_links (
  id uuid primary key default gen_random_uuid(),
  parent_lot uuid not null references public.lots(id) on delete restrict,  -- made
  child_lot uuid not null references public.lots(id) on delete restrict,   -- used to make it
  job_id uuid references public.jobs(id) on delete set null,
  quantity numeric(14,3) not null,
  created_at timestamptz not null default now()
);
create index if not exists lot_links_parent_idx on public.lot_links (parent_lot);
create index if not exists lot_links_child_idx on public.lot_links (child_lot);
alter table public.stock_movements add column if not exists lot_id uuid references public.lots(id) on delete restrict;
create index if not exists stock_movements_lot_idx on public.stock_movements (lot_id);
alter table public.lots enable row level security;
alter table public.lot_levels enable row level security;
alter table public.lot_links enable row level security;
do $$
declare t text;
begin
  foreach t in array array['lots', 'lot_levels', 'lot_links'] loop
    execute format('drop policy if exists "staff read" on public.%I', t);
    execute format('create policy "staff read" on public.%I for select to authenticated using (public.is_active())', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
drop policy if exists "keepers edit expiry" on public.lots;
create policy "keepers edit expiry" on public.lots for update to authenticated using (public.is_stock_keeper()) with check (public.is_stock_keeper());
drop trigger if exists audit_row on public.lots;
create trigger audit_row after insert or update or delete on public.lots for each row execute function public.audit_row();

-- Get or create a lot by code.
create or replace function public.lot_for(p_item uuid, p_code text, p_expiry date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare id uuid;
begin
  if coalesce(trim(p_code), '') = '' then return null; end if;
  insert into public.lots (item_id, code, expiry) values (p_item, trim(p_code), p_expiry)
  on conflict (item_id, code) do update set expiry = coalesce(excluded.expiry, lots.expiry)
  returning lots.id into id;
  return id;
end $$;
revoke all on function public.lot_for(uuid, text, date) from public, anon, authenticated;

create or replace function public.stock_lot(p_lot uuid) returns void
language plpgsql set search_path = public as $$
begin perform set_config('app.stock_lot', coalesce(p_lot::text, ''), true); end $$;
revoke all on function public.stock_lot(uuid) from public, anon, authenticated;

create or replace function public.move_stock(p_item uuid, p_delta numeric, p_reason text, p_ref text default '', p_note text default '', p_cost numeric default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s public.stock_items;
  q numeric;
  a numeric;
  loc uuid := nullif(current_setting('app.stock_loc', true), '')::uuid;
  st text := nullif(current_setting('app.stock_src_type', true), '');
  sid uuid := nullif(current_setting('app.stock_src_id', true), '')::uuid;
  lot uuid := nullif(current_setting('app.stock_lot', true), '')::uuid;
  oldloc text := current_setting('app.stock_loc', true);
  r record; left_qty numeric; take numeric;
begin
  select * into s from public.stock_items where id = p_item for update;
  if s.id is null then raise exception 'Item not found'; end if;
  if s.kind = 'service' then raise exception 'Services are not kept in stock'; end if;
  if loc is null then
    loc := case st
      when 'po_line' then (select p.location_id from public.po_lines l join public.purchase_orders p on p.id = l.po_id where l.id = sid)
      when 'order_line' then (select o.location_id from public.order_lines l join public.orders o on o.id = l.order_id where l.id = sid)
      when 'return' then (select o.location_id from public.order_returns r2 join public.orders o on o.id = r2.order_id where r2.id = sid)
      when 'job' then (select j.location_id from public.jobs j where j.id = sid)
      else null end;
  end if;
  loc := coalesce(loc, public.default_location());

  -- Tracked item leaving without a named lot: first-expiry-first-out, then the untracked rest.
  if lot is null and p_delta < 0 and s.tracking <> 'none' and current_setting('app.stock_nolot', true) is distinct from 'on' then
    left_qty := -p_delta;
    perform set_config('app.stock_loc', loc::text, true);
    for r in select ll.lot_id, ll.quantity from public.lot_levels ll join public.lots lo on lo.id = ll.lot_id
              where lo.item_id = s.id and ll.location_id = loc and ll.quantity > 0
              order by lo.expiry nulls last, lo.created_at, lo.code loop
      exit when left_qty <= 0;
      take := least(r.quantity, left_qty);
      perform public.stock_lot(r.lot_id);
      perform public.move_stock(p_item, -take, p_reason, p_ref, p_note, p_cost);
      left_qty := left_qty - take;
    end loop;
    perform public.stock_lot(null);
    if left_qty > 0 then
      perform set_config('app.stock_nolot', 'on', true);
      perform public.move_stock(p_item, -left_qty, p_reason, p_ref, p_note, p_cost);
      perform set_config('app.stock_nolot', 'off', true);
    end if;
    perform set_config('app.stock_loc', coalesce(oldloc, ''), true);
    return (select quantity from public.stock_items where id = p_item);
  end if;

  q := s.quantity + p_delta;
  a := case
         when p_cost is null then s.avg_cost
         when p_delta > 0 and q > 0 then round((greatest(s.quantity, 0) * s.avg_cost + p_delta * p_cost) / (greatest(s.quantity, 0) + p_delta), 4)
         when p_delta > 0 then p_cost
         when p_delta < 0 and q > 0 and s.quantity > 0 then greatest(round((s.quantity * s.avg_cost + p_delta * p_cost) / q, 4), 0)
         else s.avg_cost end;
  perform set_config('app.stock_move', 'on', true);
  update public.stock_items set quantity = q, avg_cost = a,
    updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
  where id = s.id;
  perform set_config('app.stock_move', 'off', true);
  insert into public.stock_levels (item_id, location_id, quantity) values (s.id, loc, p_delta)
  on conflict (item_id, location_id) do update set quantity = stock_levels.quantity + p_delta, updated_at = now();
  if lot is not null then
    insert into public.lot_levels (lot_id, location_id, quantity) values (lot, loc, p_delta)
    on conflict (lot_id, location_id) do update set quantity = lot_levels.quantity + p_delta;
  end if;
  insert into public.stock_movements (item_id, delta, after, reason, ref, note, unit_cost, user_id, job_id, source_type, source_id, location_id, lot_id)
  values (s.id, p_delta, q, p_reason, coalesce(p_ref, ''), coalesce(p_note, ''), coalesce(p_cost, s.avg_cost), auth.uid(),
          nullif(current_setting('app.stock_job', true), '')::uuid, st, sid, loc, lot);
  return q;
end $$;
revoke all on function public.move_stock(uuid, numeric, text, text, text, numeric) from public, anon, authenticated;

-- Reverse stock of one document back into (or out of) the lots it used.
--  p_delta > 0: puts back what left (lots with net outflow for that source); p_delta < 0: takes back what came in.
create or replace function public.move_by_source_lots(p_item uuid, p_delta numeric, p_reason text, p_ref text, p_note text,
  p_src_type text, p_src_id uuid, p_src_reason text, p_cost numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record; left_qty numeric := abs(p_delta); take numeric; sgn int := sign(p_delta);
begin
  perform public.stock_source(p_src_type, p_src_id);
  for r in select lot_id, location_id, -sgn * sum(delta) as avail from public.stock_movements
            where source_type = p_src_type and source_id = p_src_id and item_id = p_item and lot_id is not null
              and reason in (p_src_reason, p_reason)
            group by lot_id, location_id having -sgn * sum(delta) > 0
            order by max(created_at) desc loop
    exit when left_qty <= 0;
    take := least(r.avail, left_qty);
    perform public.stock_lot(r.lot_id);
    perform public.stock_location(r.location_id);
    perform public.move_stock(p_item, sgn * take, p_reason, p_ref, p_note, p_cost);
    left_qty := left_qty - take;
  end loop;
  perform public.stock_lot(null);
  -- Untracked remainder goes back where the original movement happened (e.g. a contractor's location).
  perform public.stock_location((select location_id from public.stock_movements where source_type = p_src_type and source_id = p_src_id
     and item_id = p_item and reason = p_src_reason order by created_at desc limit 1));
  if left_qty > 0 then perform public.move_stock(p_item, sgn * left_qty, p_reason, p_ref, p_note, p_cost); end if;
  perform public.stock_location(null);
end $$;
revoke all on function public.move_by_source_lots(uuid, numeric, text, text, text, text, uuid, text, numeric) from public, anon, authenticated;

-- Receiving names the batch (default: the PO number) and its expiry; serial items get one lot per piece.
drop function if exists public.receive_po_line(uuid, numeric, text, boolean);
create or replace function public.receive_po_line(p_line uuid, p_qty numeric, p_key text default null, p_over boolean default false,
  p_lot text default null, p_expiry date default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.po_lines; po public.purchase_orders; it public.stock_items;
  prev text; st text; cost numeric; i int; n int;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can receive deliveries'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Receive at least one'; end if;
  prev := public.claim_op('receive_po_line', p_key);
  if prev is not null then return prev; end if;
  select * into l from public.po_lines where id = p_line for update;
  if l.id is null then raise exception 'Purchase order line not found'; end if;
  select * into po from public.purchase_orders where id = l.po_id for update;
  if po.status = 'draft' then raise exception 'Mark the purchase order as ordered first'; end if;
  if po.status in ('cancelled','received') then raise exception 'This purchase order is closed'; end if;
  if l.received + p_qty > l.quantity and not p_over then
    raise exception 'That is more than ordered — % still to come', trim_scale(l.quantity - l.received);
  end if;
  select * into it from public.stock_items where id = l.item_id;
  update public.po_lines set received = received + p_qty where id = l.id;
  perform public.stock_source('po_line', l.id);
  cost := round(l.unit_cost * po.fx_rate, 4);
  if it.tracking = 'serial' then
    if p_qty <> trunc(p_qty) then raise exception 'Serial-numbered items are received in whole pieces'; end if;
    select count(*) into n from public.lots where item_id = it.id and code like coalesce(nullif(trim(p_lot), ''), po.number) || '-%';
    for i in 1..p_qty::int loop
      perform public.stock_lot(public.lot_for(it.id, coalesce(nullif(trim(p_lot), ''), po.number) || '-' || lpad((n + i)::text, 3, '0'), p_expiry));
      perform public.move_stock(l.item_id, 1, 'receive', po.number, '', cost);
    end loop;
  else
    if it.tracking = 'batch' then perform public.stock_lot(public.lot_for(it.id, coalesce(nullif(trim(p_lot), ''), po.number), p_expiry)); end if;
    perform public.move_stock(l.item_id, p_qty, 'receive', po.number, '', cost);
  end if;
  perform public.stock_lot(null);
  st := public.po_status_after(po.id);
  return public.finish_op('receive_po_line', p_key, st);
end $$;
revoke all on function public.receive_po_line(uuid, numeric, text, boolean, text, date) from public, anon;
grant execute on function public.receive_po_line(uuid, numeric, text, boolean, text, date) to authenticated;

-- Production with lots: output batch = the MO code (or one serial per piece), linked to the lots it consumed.
create or replace function public.produce_core(p_job uuid, p_qty numeric, p_actual jsonb default null, p_bump boolean default true) returns numeric
language plpgsql security definer set search_path = public as $$
declare j public.jobs; prod uuid; pit public.stock_items; b record; need numeric; fromw numeric; avail numeric; total numeric := 0; c numeric;
        loc uuid; w uuid := public.wip_location(); has_bom boolean := false; unit numeric; outl uuid; i int; n int; before jsonb;
begin
  select * into j from public.jobs where id = p_job;
  prod := public.mo_product(j.id);
  if prod is null then return 0; end if;
  select * into pit from public.stock_items where id = prod;
  loc := coalesce(j.location_id, public.default_location());
  perform set_config('app.stock_job', j.id::text, true);
  perform public.stock_source('job', j.id);
  -- lots this MO had consumed before this batch (to link only what this batch used)
  select coalesce(jsonb_object_agg(lot_id, used), '{}') into before from (select lot_id, -sum(delta) used from public.stock_movements
   where job_id = j.id and reason = 'consume' and lot_id is not null group by lot_id) x;
  for b in
    select x.item_id, sum(x.qty) qty from (
      select bl.material_id item_id, bl.quantity * p_qty qty from public.bom_lines bl join public.stock_items m on m.id = bl.material_id and m.kind <> 'service'
       where bl.product_id = prod and (p_actual is null or not (p_actual ? bl.material_id::text))
      union all
      select (k)::uuid, (p_actual->>k)::numeric from jsonb_object_keys(coalesce(p_actual, '{}'::jsonb)) k) x
    group by x.item_id loop
    has_bom := true;
    need := b.qty;
    continue when need <= 0;
    select coalesce(picked - used_from_wip - returned, 0) into avail from public.mo_materials where job_id = j.id and item_id = b.item_id for update;
    fromw := least(greatest(coalesce(avail, 0), 0), need);
    select avg_cost into c from public.stock_items where id = b.item_id;
    total := total + need * coalesce(c, 0);
    if fromw > 0 then
      perform public.stock_location(w); perform public.move_stock(b.item_id, -fromw, 'consume', j.code, '');
      update public.mo_materials set used_from_wip = used_from_wip + fromw where job_id = j.id and item_id = b.item_id;
    end if;
    if need - fromw > 0 then
      perform public.stock_location(loc); perform public.move_stock(b.item_id, -(need - fromw), 'consume', j.code, '');
    end if;
  end loop;
  unit := case when has_bom then round(total / p_qty, 4) end;
  perform public.stock_location(loc);
  if pit.tracking = 'serial' and p_qty = trunc(p_qty) then
    select count(*) into n from public.lots where item_id = prod and code like j.code || '-%';
    for i in 1..p_qty::int loop
      outl := public.lot_for(prod, j.code || '-' || lpad((n + i)::text, 3, '0'));
      perform public.stock_lot(outl);
      perform public.move_stock(prod, 1, 'produce', j.code, 'Serial ' || j.code || '-' || lpad((n + i)::text, 3, '0'), unit);
      insert into public.lot_links (parent_lot, child_lot, job_id, quantity)
        select outl, x.lot_id, j.id, x.used / p_qty from (select m.lot_id, -sum(m.delta) - coalesce((before->>m.lot_id::text)::numeric, 0) used
          from public.stock_movements m where m.job_id = j.id and m.reason = 'consume' and m.lot_id is not null group by m.lot_id) x where x.used > 0;
    end loop;
  else
    if pit.tracking <> 'none' then outl := public.lot_for(prod, j.code); perform public.stock_lot(outl); end if;
    perform public.move_stock(prod, p_qty, 'produce', j.code, case when p_qty < coalesce(j.quantity, 1) - j.produced then 'Part completed' else '' end, unit);
    if outl is not null then
      insert into public.lot_links (parent_lot, child_lot, job_id, quantity)
        select outl, x.lot_id, j.id, x.used from (select m.lot_id, -sum(m.delta) - coalesce((before->>m.lot_id::text)::numeric, 0) used
          from public.stock_movements m where m.job_id = j.id and m.reason = 'consume' and m.lot_id is not null group by m.lot_id) x where x.used > 0;
    end if;
  end if;
  perform public.stock_lot(null);
  perform public.stock_location(null); perform set_config('app.stock_job', '', true);
  if p_bump then update public.jobs set produced = produced + p_qty where id = j.id; end if;
  return p_qty;
end $$;
revoke all on function public.produce_core(uuid, numeric, jsonb, boolean) from public, anon, authenticated;

-- Reopen: reverse into the same lot and location; finished-goods lots of the MO are unlinked.
create or replace function public.book_job_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record; rest numeric;
begin
  if old.status = 'done' and new.status <> 'done' and old.stock_booked then
    perform set_config('app.stock_job', new.id::text, true);
    perform public.stock_source('job', new.id);
    for m in select item_id, reason, location_id, lot_id, sum(delta) as net,
                    case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end as cost
               from public.stock_movements
              where job_id = new.id and reason in ('consume', 'produce') group by item_id, reason, location_id, lot_id having sum(delta) <> 0
              order by reason desc loop
      perform public.stock_location(m.location_id);
      perform public.stock_lot(m.lot_id);
      perform set_config('app.stock_nolot', 'on', true);
      perform public.move_stock(m.item_id, -m.net, m.reason, new.code, 'Reopened — reversed', m.cost);
      perform set_config('app.stock_nolot', 'off', true);
    end loop;
    perform public.stock_lot(null);
    perform public.stock_location(null);
    perform set_config('app.stock_job', '', true);
    delete from public.lot_links where job_id = new.id;
    update public.mo_materials set used_from_wip = 0 where job_id = new.id;
    new.stock_booked := false;
    new.produced := 0;
    return new;
  end if;
  if new.status <> 'done' or old.status = 'done' or new.stock_booked or new.sku is null then return new; end if;
  if public.mo_product(new.id) is null then return new; end if;
  rest := coalesce(new.quantity, 1) - coalesce(old.produced, 0);
  if rest > 0 then perform public.produce_core(new.id, rest, null, false); end if;
  perform public.return_mo_materials_core(new.id, null);
  new.produced := coalesce(new.quantity, 1);
  new.stock_booked := true;
  return new;
end $$;
drop trigger if exists book_job_stock on public.jobs;
create trigger book_job_stock before update of status on public.jobs
  for each row execute function public.book_job_stock();

-- Trace a lot both ways (INV-13): where it came from, what it went into, who received it.
create or replace function public.trace_lot(p_lot uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare back jsonb; fwd jsonb; base jsonb;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  with recursive up(id, depth) as (
      select p_lot, 0 union select l.child_lot, up.depth + 1 from public.lot_links l join up on l.parent_lot = up.id where up.depth < 20),
    down(id, depth) as (
      select p_lot, 0 union select l.parent_lot, down.depth + 1 from public.lot_links l join down on l.child_lot = down.id where down.depth < 20)
  select
    (select coalesce(jsonb_agg(jsonb_build_object('lot', lo.code, 'lot_id', lo.id, 'sku', si.sku, 'name', si.name, 'depth', up.depth,
        'received', (select coalesce(jsonb_agg(jsonb_build_object('po', p.number, 'supplier', sp.name, 'at', m.created_at, 'qty', m.delta) order by m.created_at), '[]')
                       from public.stock_movements m join public.po_lines pl on pl.id = m.source_id join public.purchase_orders p on p.id = pl.po_id
                       left join public.suppliers sp on sp.id = p.supplier_id
                      where m.lot_id = lo.id and m.reason = 'receive' and m.delta > 0),
        'made_by', (select string_agg(distinct j.code, ', ') from public.lot_links l join public.jobs j on j.id = l.job_id where l.parent_lot = lo.id))
        order by up.depth, si.sku), '[]')
       from up join public.lots lo on lo.id = up.id join public.stock_items si on si.id = lo.item_id where up.depth > 0),
    (select coalesce(jsonb_agg(jsonb_build_object('lot', lo.code, 'lot_id', lo.id, 'sku', si.sku, 'name', si.name, 'depth', down.depth,
        'made_by', (select string_agg(distinct j.code, ', ') from public.lot_links l join public.jobs j on j.id = l.job_id where l.parent_lot = lo.id))
        order by down.depth, si.sku), '[]')
       from down join public.lots lo on lo.id = down.id join public.stock_items si on si.id = lo.item_id where down.depth > 0)
  into back, fwd;
  -- every customer shipment of this lot or anything made from it
  with recursive down(id, depth) as (
      select p_lot, 0 union select l.parent_lot, down.depth + 1 from public.lot_links l join down on l.child_lot = down.id where down.depth < 20)
  select jsonb_build_object(
    'lot', (select jsonb_build_object('code', lo.code, 'sku', si.sku, 'name', si.name, 'expiry', lo.expiry, 'tracking', si.tracking)
              from public.lots lo join public.stock_items si on si.id = lo.item_id where lo.id = p_lot),
    'on_hand', (select coalesce(jsonb_agg(jsonb_build_object('location', lc.name, 'qty', ll.quantity)), '[]')
                  from public.lot_levels ll join public.locations lc on lc.id = ll.location_id where ll.lot_id = p_lot and ll.quantity <> 0),
    'received', (select coalesce(jsonb_agg(jsonb_build_object('po', p.number, 'supplier', sp.name, 'at', m.created_at, 'qty', m.delta) order by m.created_at), '[]')
                   from public.stock_movements m join public.po_lines pl on pl.id = m.source_id join public.purchase_orders p on p.id = pl.po_id
                   left join public.suppliers sp on sp.id = p.supplier_id where m.lot_id = p_lot and m.reason = 'receive' and m.delta > 0),
    'shipped', (select coalesce(jsonb_agg(jsonb_build_object('order', o.order_number, 'order_id', o.id, 'customer', o.customer, 'company', o.company,
                    'lot', lo.code, 'sku', si.sku, 'at', m.created_at, 'qty', -m.delta) order by m.created_at), '[]')
                  from down join public.stock_movements m on m.lot_id = down.id and m.reason = 'ship' and m.delta < 0
                  join public.order_lines ol on ol.id = m.source_id join public.orders o on o.id = ol.order_id
                  join public.lots lo on lo.id = m.lot_id join public.stock_items si on si.id = lo.item_id)) into base;
  return base || jsonb_build_object('made_from', back, 'went_into', fwd);
end $$;
revoke all on function public.trace_lot(uuid) from public, anon;
grant execute on function public.trace_lot(uuid) to authenticated;

-- ============================================================================
-- Phase 4d — outsourced manufacturing (OUT-01..06).
-- A contract manufacturer is a supplier with a partner location that holds
-- our stock. An outsourced PO buys the finished product from them; each line
-- carries the materials they use (copied from the recipe, editable). We send
-- materials with an ordinary transfer; on receipt the materials are consumed
-- at the partner location and the product is costed at fee + materials.
-- ============================================================================
alter table public.locations add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.purchase_orders add column if not exists kind text not null default 'standard' check (kind in ('standard', 'outsourced'));
alter table public.purchase_orders add column if not exists partner_location_id uuid references public.locations(id) on delete restrict;
alter table public.purchase_orders drop constraint if exists purchase_orders_partner_check;
alter table public.purchase_orders add constraint purchase_orders_partner_check
  check (kind = 'standard' or status in ('draft', 'cancelled') or partner_location_id is not null);

create table if not exists public.po_materials (
  id uuid primary key default gen_random_uuid(),
  po_line_id uuid not null references public.po_lines(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete restrict,
  quantity_per numeric(14,4) not null check (quantity_per >= 0),
  consumed numeric(14,3) not null default 0,
  created_at timestamptz not null default now(),
  unique (po_line_id, item_id)
);
create index if not exists po_materials_line_idx on public.po_materials (po_line_id);
alter table public.po_materials enable row level security;
drop policy if exists "staff read" on public.po_materials;
drop policy if exists "keepers write" on public.po_materials;
create policy "staff read" on public.po_materials for select to authenticated using (public.is_active());
create policy "keepers write" on public.po_materials for all to authenticated using (public.is_stock_keeper()) with check (public.is_stock_keeper());
drop trigger if exists audit_row on public.po_materials;
create trigger audit_row after insert or update or delete on public.po_materials for each row execute function public.audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'po_materials') then
    alter publication supabase_realtime add table public.po_materials;
  end if;
end $$;

-- Materials can only be changed while nothing has been received on that line.
create or replace function public.guard_po_materials() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_setting('app.po_mat', true) = 'on' then return coalesce(new, old); end if;
  if exists (select 1 from public.po_lines where id = coalesce(new.po_line_id, old.po_line_id) and received > 0) then
    raise exception 'Part of this line has been received — its materials are fixed';
  end if;
  if tg_op = 'UPDATE' and new.consumed is distinct from old.consumed then raise exception 'Consumption is booked on receipt'; end if;
  if tg_op = 'INSERT' and new.consumed <> 0 then raise exception 'Consumption is booked on receipt'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_po_materials on public.po_materials;
create trigger guard_po_materials before insert or update or delete on public.po_materials for each row execute function public.guard_po_materials();

create or replace function public.fill_po_materials(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.po_materials (po_line_id, item_id, quantity_per)
  select l.id, b.material_id, b.quantity from public.po_lines l
    join public.bom_lines b on b.product_id = l.item_id
    join public.stock_items m on m.id = b.material_id and m.kind <> 'service'
   where l.id = p_line
  on conflict (po_line_id, item_id) do nothing;
end $$;
revoke all on function public.fill_po_materials(uuid) from public, anon, authenticated;

create or replace function public.po_outsourcing() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; l record;
begin
  if tg_table_name = 'po_lines' then
    select kind into k from public.purchase_orders where id = new.po_id;
    if k = 'outsourced' then perform public.fill_po_materials(new.id); end if;
    return new;
  end if;
  -- purchase_orders
  if (new.kind is distinct from old.kind or new.partner_location_id is distinct from old.partner_location_id)
     and exists (select 1 from public.po_lines where po_id = new.id and received > 0) then
    raise exception 'Something has been received on this PO — it can''t be switched';
  end if;
  if new.partner_location_id is not null and not exists (select 1 from public.locations where id = new.partner_location_id and kind = 'partner') then
    raise exception 'Pick a contractor (partner) location';
  end if;
  if new.kind = 'outsourced' and old.kind = 'standard' then
    for l in select id from public.po_lines where po_id = new.id loop perform public.fill_po_materials(l.id); end loop;
  elsif new.kind = 'standard' and old.kind = 'outsourced' then
    delete from public.po_materials where po_line_id in (select id from public.po_lines where po_id = new.id);
  end if;
  return new;
end $$;
drop trigger if exists po_outsourcing on public.po_lines;
create trigger po_outsourcing after insert on public.po_lines for each row execute function public.po_outsourcing();
drop trigger if exists po_outsourcing on public.purchase_orders;
create trigger po_outsourcing after update of kind, partner_location_id on public.purchase_orders for each row execute function public.po_outsourcing();

-- Receipt: outsourced lines consume their materials at the partner location.
create or replace function public.receive_po_line(p_line uuid, p_qty numeric, p_key text default null, p_over boolean default false,
  p_lot text default null, p_expiry date default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.po_lines; po public.purchase_orders; it public.stock_items; m record;
  prev text; st text; cost numeric; mat numeric := 0; i int; n int;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can receive deliveries'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Receive at least one'; end if;
  prev := public.claim_op('receive_po_line', p_key);
  if prev is not null then return prev; end if;
  select * into l from public.po_lines where id = p_line for update;
  if l.id is null then raise exception 'Purchase order line not found'; end if;
  select * into po from public.purchase_orders where id = l.po_id for update;
  if po.status = 'draft' then raise exception 'Mark the purchase order as ordered first'; end if;
  if po.status in ('cancelled','received') then raise exception 'This purchase order is closed'; end if;
  if l.received + p_qty > l.quantity and not p_over then
    raise exception 'That is more than ordered — % still to come', trim_scale(l.quantity - l.received);
  end if;
  select * into it from public.stock_items where id = l.item_id;
  update public.po_lines set received = received + p_qty where id = l.id;
  perform public.stock_source('po_line', l.id);
  if po.kind = 'outsourced' then
    perform set_config('app.po_mat', 'on', true);
    for m in select pm.*, s.avg_cost from public.po_materials pm join public.stock_items s on s.id = pm.item_id
              where pm.po_line_id = l.id and pm.quantity_per > 0 order by s.sku loop
      mat := mat + m.quantity_per * p_qty * m.avg_cost;
      perform public.stock_location(po.partner_location_id);
      perform public.move_stock(m.item_id, -(m.quantity_per * p_qty), 'consume', po.number, 'Used by contractor');
      update public.po_materials set consumed = consumed + m.quantity_per * p_qty where id = m.id;
    end loop;
    perform set_config('app.po_mat', 'off', true);
    perform public.stock_location(null);
  end if;
  cost := round(l.unit_cost * po.fx_rate + mat / p_qty, 4);
  if it.tracking = 'serial' then
    if p_qty <> trunc(p_qty) then raise exception 'Serial-numbered items are received in whole pieces'; end if;
    select count(*) into n from public.lots where item_id = it.id and code like coalesce(nullif(trim(p_lot), ''), po.number) || '-%';
    for i in 1..p_qty::int loop
      perform public.stock_lot(public.lot_for(it.id, coalesce(nullif(trim(p_lot), ''), po.number) || '-' || lpad((n + i)::text, 3, '0'), p_expiry));
      perform public.move_stock(l.item_id, 1, 'receive', po.number, '', cost);
    end loop;
  else
    if it.tracking = 'batch' then perform public.stock_lot(public.lot_for(it.id, coalesce(nullif(trim(p_lot), ''), po.number), p_expiry)); end if;
    perform public.move_stock(l.item_id, p_qty, 'receive', po.number, '', cost);
  end if;
  perform public.stock_lot(null);
  st := public.po_status_after(po.id);
  return public.finish_op('receive_po_line', p_key, st);
end $$;
revoke all on function public.receive_po_line(uuid, numeric, text, boolean, text, date) from public, anon;
grant execute on function public.receive_po_line(uuid, numeric, text, boolean, text, date) to authenticated;

-- Reversal: product back out at what it was booked at; materials back to the partner.
create or replace function public.reverse_po_receipt(p_line uuid, p_qty numeric, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare l public.po_lines; po public.purchase_orders; prev text; st text; c numeric; m record; q numeric;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can change receipts'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Reverse at least one'; end if;
  prev := public.claim_op('reverse_po_receipt', p_key);
  if prev is not null then return prev; end if;
  select * into l from public.po_lines where id = p_line for update;
  if l.id is null then raise exception 'Purchase order line not found'; end if;
  if p_qty > l.received then raise exception 'Only % was received on this line', trim_scale(l.received); end if;
  select * into po from public.purchase_orders where id = l.po_id for update;
  if po.status = 'cancelled' then raise exception 'This purchase order is cancelled'; end if;
  update public.po_lines set received = received - p_qty where id = l.id;
  select round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) into c from public.stock_movements
   where source_type = 'po_line' and source_id = l.id and reason = 'receive' and item_id = l.item_id and delta > 0;
  perform public.stock_source('po_line', l.id);
  perform public.move_by_source_lots(l.item_id, -p_qty, 'receive', po.number, 'Receipt reversed', 'po_line', l.id, 'receive',
    coalesce(c, round(l.unit_cost * po.fx_rate, 4)));
  if po.kind = 'outsourced' then
    perform set_config('app.po_mat', 'on', true);
    for m in select * from public.po_materials where po_line_id = l.id and consumed > 0 loop
      q := least(m.consumed, m.quantity_per * p_qty);
      continue when q <= 0;
      select round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) into c from public.stock_movements
       where source_type = 'po_line' and source_id = l.id and reason = 'consume' and item_id = m.item_id and delta < 0;
      perform public.move_by_source_lots(m.item_id, q, 'consume', po.number, 'Receipt reversed — back with contractor', 'po_line', l.id, 'consume', c);
      update public.po_materials set consumed = consumed - q where id = m.id;
    end loop;
    perform set_config('app.po_mat', 'off', true);
  end if;
  st := public.po_status_after(po.id);
  return public.finish_op('reverse_po_receipt', p_key, st);
end $$;

-- Draft transfer of whatever the contractor still needs (needed − already there − on the way).
create or replace function public.send_po_materials(p_po uuid, p_from uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; tid uuid; src uuid := coalesce(p_from, public.default_location()); n int;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can send materials'; end if;
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null or po.kind <> 'outsourced' then raise exception 'Not an outsourced purchase order'; end if;
  if po.partner_location_id is null then raise exception 'Pick the contractor location first'; end if;
  if po.status in ('cancelled', 'received') then raise exception 'This purchase order is closed'; end if;
  if src = po.partner_location_id then raise exception 'Send from one of your own locations'; end if;
  insert into public.stock_transfers (from_location, to_location, expected_date, notes)
  values (src, po.partner_location_id, po.expected_date, 'Materials for ' || po.number) returning id into tid;
  insert into public.transfer_lines (transfer_id, item_id, quantity)
  select tid, x.item_id, x.need from (
    select pm.item_id, sum(pm.quantity_per * greatest(l.quantity - l.received, 0))
           - coalesce((select quantity from public.stock_levels where item_id = pm.item_id and location_id = po.partner_location_id), 0)
           - coalesce((select sum(tl.quantity) from public.transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
                        where t.to_location = po.partner_location_id and t.status in ('draft', 'in_transit') and t.id <> tid and tl.item_id = pm.item_id), 0) as need
      from public.po_materials pm join public.po_lines l on l.id = pm.po_line_id where l.po_id = po.id group by pm.item_id) x
  where x.need > 0;
  get diagnostics n = row_count;
  if n = 0 then delete from public.stock_transfers where id = tid; raise exception 'The contractor already has (or is getting) everything this PO needs'; end if;
  return tid;
end $$;
revoke all on function public.send_po_materials(uuid, uuid) from public, anon;
grant execute on function public.send_po_materials(uuid, uuid) to authenticated;

-- Allocation also covers materials an outsourced PO needs at the contractor (shown under 'mos', keyed by PO id).
create or replace function public.availability() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record; e record; need numeric; take numeric; got numeric; exp_qty numeric; exp_date date; exp_src text;
  holders text; tl uuid := public.transit_location(); dl uuid := public.default_location();
  lines jsonb := '{}'; ingr jsonb := '{}'; items jsonb := '{}'; st text; why text; nm text;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  create temp table if not exists av_supply (item_id uuid, location_id uuid, qty numeric, primary key (item_id, location_id)) on commit drop;
  create temp table if not exists av_expected (item_id uuid, location_id uuid, due date, src text, qty numeric, ord int) on commit drop;
  create temp table if not exists av_taken (item_id uuid, location_id uuid, who text, qty numeric, ord int) on commit drop;
  create temp table if not exists av_demand (kind text, ref_id uuid, owner_id uuid, label text, item_id uuid, location_id uuid,
    qty numeric, pegged boolean, rank numeric, due date, created timestamptz) on commit drop;
  truncate av_supply, av_expected, av_taken, av_demand;

  -- in transit and on the production floor (picked for an MO) is not free stock
  insert into av_supply select item_id, location_id, quantity from public.stock_levels
   where location_id not in (select id from public.locations where kind in ('transit', 'wip'));
  insert into av_expected
    select l.item_id, coalesce(p.location_id, dl), p.expected_date, p.number, l.quantity - l.received, 0
      from public.po_lines l join public.purchase_orders p on p.id = l.po_id
     where p.status in ('ordered', 'partial') and l.quantity > l.received
    union all
    select si.id, coalesce(j.location_id, dl), j.due_date, j.code, j.quantity - j.produced, 0
      from public.jobs j join lateral (select id from public.stock_items where sku = j.sku and kind not in ('material', 'service') order by created_at limit 1) si on true
     where j.status <> 'done' and not j.stock_booked and j.sku is not null and coalesce(j.quantity, 0) > j.produced
    union all
    select tl2.item_id, t.to_location, t.expected_date, t.number, tl2.quantity, 0
      from public.transfer_lines tl2 join public.stock_transfers t on t.id = tl2.transfer_id where t.status = 'in_transit';

  -- sales lines (stocked, not yet shipped). MTO lines with a finished MO are pegged to it.
  insert into av_demand
    select 'line', l.id, o.id, o.order_number, l.item_id, coalesce(o.location_id, dl), l.quantity - l.shipped,
           (j.id is not null and j.stock_booked), o.rank, o.delivery_deadline, o.created_at
      from public.order_lines l join public.orders o on o.id = l.order_id
      join public.stock_items si on si.id = l.item_id and si.kind <> 'service'
      left join public.jobs j on j.order_line_id = l.id
     where o.kind = 'order' and o.status = 'open' and l.quantity > l.shipped
       and (j.id is null or j.stock_booked);
  -- ingredients of unfinished MOs
  insert into av_demand
    -- still needed = recipe × (qty − already produced) − what is already picked for this MO
    select 'ingredient', j.id, j.id, j.code, b.material_id, coalesce(j.location_id, dl),
           greatest(b.quantity * (coalesce(j.quantity, 1) - j.produced) - coalesce(mm.picked - mm.used_from_wip - mm.returned, 0), 0),
           false, coalesce(o.rank, j.rank), j.due_date, j.created_at
      from public.jobs j
      join lateral (select id from public.stock_items where sku = j.sku and kind <> 'service' order by (kind = 'material'), created_at limit 1) p on true
      join public.bom_lines b on b.product_id = p.id
      join public.stock_items m on m.id = b.material_id and m.kind <> 'service'
      left join public.mo_materials mm on mm.job_id = j.id and mm.item_id = b.material_id
      left join public.orders o on o.id = j.order_id
     where j.status <> 'done' and not j.stock_booked and j.sku is not null;
  -- materials an outsourced PO needs at the contractor
  insert into av_demand
    select 'ingredient', p.id, p.id, p.number, pm.item_id, p.partner_location_id,
           sum(pm.quantity_per * (l.quantity - l.received)), false, null, p.expected_date, p.created_at
      from public.purchase_orders p join public.po_lines l on l.po_id = p.id
      join public.po_materials pm on pm.po_line_id = l.id
     where p.kind = 'outsourced' and p.status in ('ordered', 'partial') and p.partner_location_id is not null and l.quantity > l.received
     group by p.id, pm.item_id;
  -- draft transfers reserve at their source
  insert into av_demand
    select 'transfer', tl2.id, t.id, t.number, tl2.item_id, t.from_location, tl2.quantity, false,
           extract(epoch from t.created_at), t.expected_date, t.created_at
      from public.transfer_lines tl2 join public.stock_transfers t on t.id = tl2.transfer_id where t.status = 'draft';

  for d in select * from av_demand order by pegged desc, rank nulls last, due nulls last, created, ref_id loop
    need := d.qty;
    select coalesce(qty, 0) into got from av_supply where item_id = d.item_id and location_id = d.location_id;
    got := coalesce(got, 0);
    take := least(greatest(got, 0), need);
    if take > 0 then
      update av_supply set qty = qty - take where item_id = d.item_id and location_id = d.location_id;
      insert into av_taken values (d.item_id, d.location_id, d.label, take, 0);
    end if;
    need := need - take;
    exp_qty := 0; exp_date := null; exp_src := null;
    for e in select ctid, * from av_expected where item_id = d.item_id and location_id = d.location_id and qty > 0
              order by due nulls last, src loop
      exit when need <= 0;
      got := least(e.qty, need);
      update av_expected set qty = qty - got where ctid = e.ctid;
      need := need - got; exp_qty := exp_qty + got; exp_date := e.due;
      exp_src := coalesce(exp_src || ', ', '') || e.src;
    end loop;
    if need > 0 then
      select string_agg(distinct who, ', ') into holders from (select who from av_taken where item_id = d.item_id and location_id = d.location_id and who <> d.label limit 4) h;
      select name into nm from public.locations where id = d.location_id;
      st := 'not_available';
      why := format('%s short at %s', trim_scale(need), nm)
          || case when holders is not null then format(' — on-hand stock is promised to %s (higher priority)', holders) else ' — none on hand or on order' end;
    elsif exp_qty > 0 then
      st := 'expected';
      why := format('%s reserved now, %s expected from %s', trim_scale(take), trim_scale(exp_qty), exp_src);
    else
      st := 'in_stock'; why := format('%s reserved from stock', trim_scale(take));
    end if;
    if d.kind in ('line', 'transfer') then
      lines := lines || jsonb_build_object(d.ref_id::text, jsonb_build_object('status', st, 'reserved', take, 'expected', exp_qty,
        'short', need, 'date', exp_date, 'why', why, 'kind', d.kind));
    else
      -- an MO is as available as its worst ingredient
      ingr := jsonb_set(ingr, array[d.ref_id::text], jsonb_build_object(
        'status', case when st = 'not_available' or ingr->d.ref_id::text->>'status' = 'not_available' then 'not_available'
                       when st = 'expected' or ingr->d.ref_id::text->>'status' = 'expected' then 'expected' else 'in_stock' end,
        'date', greatest((ingr->d.ref_id::text->>'date')::date, exp_date),
        'short', coalesce(ingr->d.ref_id::text->'short', '[]'::jsonb) || case when need > 0
             then jsonb_build_array(jsonb_build_object('item_id', d.item_id, 'short', need, 'why', why)) else '[]'::jsonb end), true);
    end if;
  end loop;

  select coalesce(jsonb_object_agg(item_id, jsonb_build_object('on_hand', on_hand, 'reserved', reserved, 'available', on_hand - reserved)), '{}') into items
    from (select s.item_id, sum(s.quantity) on_hand, coalesce((select sum(qty) from av_taken t where t.item_id = s.item_id), 0) reserved
            from public.stock_levels s where s.location_id not in (select id from public.locations where kind in ('transit', 'wip')) group by s.item_id) x;
  return jsonb_build_object('lines', lines, 'mos', ingr, 'items', items, 'at', now());
end $$;

-- ============================================================================
-- Removing staff. Removing someone keeps their history (shifts, jobs, stock
-- movements) but takes away all access at once; they can be restored.
--   Owner / Developer: anyone except themselves (the last Owner/Developer stays).
--   Manager / Office:  anyone except Owner and Developer.
--   Assistant:         Operators and Support.
-- ============================================================================
alter table public.profiles add column if not exists removed_at timestamptz;
alter table public.profiles add column if not exists removed_by uuid references public.profiles(id) on delete set null;

create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or current_setting('app.join_redeem', true) = 'on' or current_setting('app.staff_remove', true) = 'on' then return new; end if;
  if (new.removed_at is distinct from old.removed_at) or (new.removed_by is distinct from old.removed_by) then
    raise exception 'Use Remove / Restore to change this';
  end if;
  if (new.active is distinct from old.active) and not public.is_admin() then
    raise exception 'Only boss, manager or office can approve accounts';
  end if;
  if (new.role is distinct from old.role) then
    if not public.is_admin() then raise exception 'Only the owner, managers or office can change roles'; end if;
    if new.id = auth.uid() then raise exception 'You cannot change your own role'; end if;
    if (new.role in ('boss','developer') or old.role in ('boss','developer')) and public.my_role() not in ('boss','developer') then
      raise exception 'Only the owner can give or take away Owner or Developer';
    end if;
  end if;
  if (new.holiday_allowance is distinct from old.holiday_allowance) and not public.is_admin() then
    raise exception 'Only boss, manager or office can change holiday allowance';
  end if;
  if (new.employee_code is distinct from old.employee_code) and not public.is_admin() then
    raise exception 'Only boss, manager or office can change employee codes';
  end if;
  return new;
end $$;

create or replace function public.can_remove_staff(p_role public.staff_role) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active() and case public.my_role()
    when 'boss' then true when 'developer' then true
    when 'manager' then p_role not in ('boss', 'developer')
    when 'office' then p_role not in ('boss', 'developer')
    when 'assistant' then p_role in ('operator', 'support')
    else false end
$$;

create or replace function public.remove_staff(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'Person not found'; end if;
  if p.id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  if p.removed_at is not null then return 'removed'; end if;
  if not public.can_remove_staff(p.role) then raise exception 'Your role cannot remove a %', initcap(p.role::text); end if;
  if p.role in ('boss', 'developer') and not exists (
       select 1 from public.profiles where role in ('boss', 'developer') and active and removed_at is null and id <> p.id) then
    raise exception 'Kortana needs at least one Owner or Developer';
  end if;
  perform set_config('app.staff_remove', 'on', true);
  update public.profiles set active = false, removed_at = now(), removed_by = auth.uid() where id = p.id;
  perform set_config('app.staff_remove', 'off', true);
  update public.breaks set ended_at = now() where user_id = p.id and ended_at is null;
  update public.shifts set clock_out = now() where user_id = p.id and clock_out is null;
  update public.participants set left_at = now() where user_id = p.id and left_at is null;
  update public.work_sessions w set ended_at = now() where w.ended_at is null
     and not exists (select 1 from public.participants x where x.session_id = w.id and x.left_at is null)
     and exists (select 1 from public.participants x where x.session_id = w.id and x.user_id = p.id);
  update public.jobs set assignees = array_remove(assignees, p.id) where p.id = any(assignees) and status <> 'done';
  delete from public.station_members where user_id = p.id;
  begin  -- sign them out everywhere (their current token also stops working: they are no longer active)
    execute 'delete from auth.refresh_tokens where user_id = $1' using p.id::text;
  exception when others then null; end;
  return 'removed';
end $$;
revoke all on function public.remove_staff(uuid) from public, anon;
grant execute on function public.remove_staff(uuid) to authenticated;

create or replace function public.restore_staff(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'Person not found'; end if;
  if p.removed_at is null then return 'active'; end if;
  if not public.can_remove_staff(p.role) then raise exception 'Your role cannot restore a %', initcap(p.role::text); end if;
  perform set_config('app.staff_remove', 'on', true);
  update public.profiles set active = true, removed_at = null, removed_by = null where id = p.id;
  perform set_config('app.staff_remove', 'off', true);
  return 'active';
end $$;
revoke all on function public.restore_staff(uuid) from public, anon;
grant execute on function public.restore_staff(uuid) to authenticated;

-- ============================================================================
-- Phase 5a — warehouse tasks (WH-01/02/03/07/09).
-- Managers/office assign receiving, picking, shipping, transfers and counts to
-- warehouse staff; the assignee does the work from their phone (the work itself
-- goes through the normal receive / ship / transfer / count functions). Tasks
-- close themselves when the PO, order or transfer they belong to is finished.
-- ============================================================================
create sequence if not exists public.wt_seq;
create table if not exists public.wh_tasks (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default 'WT-' || lpad(nextval('public.wt_seq')::text, 4, '0'),
  kind text not null check (kind in ('receive', 'pick', 'ship', 'transfer', 'count')),
  source_id uuid,
  location_id uuid references public.locations(id) on delete set null,
  items uuid[] not null default '{}',
  assigned_to uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  due_date date,
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  check ((kind = 'count') = (source_id is null))
);
create unique index if not exists wh_tasks_one_open on public.wh_tasks (kind, source_id) where status in ('open', 'in_progress') and source_id is not null;
create index if not exists wh_tasks_assignee_idx on public.wh_tasks (assigned_to, status);
alter table public.wh_tasks enable row level security;
drop policy if exists "staff read" on public.wh_tasks;
drop policy if exists "office write" on public.wh_tasks;
create policy "staff read" on public.wh_tasks for select to authenticated using (public.is_active());
create policy "office write" on public.wh_tasks for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop trigger if exists audit_row on public.wh_tasks;
create trigger audit_row after insert or update or delete on public.wh_tasks for each row execute function public.audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'wh_tasks') then
    alter publication supabase_realtime add table public.wh_tasks;
  end if;
end $$;

-- The source must exist and match the kind; the assignee must be active warehouse-capable staff.
create or replace function public.guard_wh_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.staff_role;
begin
  if new.kind = 'receive' and not exists (select 1 from public.purchase_orders where id = new.source_id) then raise exception 'Pick a purchase order'; end if;
  if new.kind in ('pick', 'ship') and not exists (select 1 from public.orders where id = new.source_id and kind = 'order') then raise exception 'Pick a sales order'; end if;
  if new.kind = 'transfer' and not exists (select 1 from public.stock_transfers where id = new.source_id) then raise exception 'Pick a transfer'; end if;
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    select role into r from public.profiles where id = new.assigned_to and active and removed_at is null;
    if r is null then raise exception 'That person is not active'; end if;
    if r not in ('developer', 'boss', 'manager', 'office', 'assistant') then raise exception 'Warehouse tasks go to staff who may move stock (Assistant or above)'; end if;
  end if;
  if new.status is distinct from coalesce(old.status, 'open') and current_setting('app.wh_step', true) is distinct from 'on' and tg_op = 'UPDATE'
     and not (new.status = 'cancelled' and public.is_admin()) then
    raise exception 'Use Start / Done to change a task';
  end if;
  if new.location_id is null then
    new.location_id := case new.kind
      when 'receive' then (select location_id from public.purchase_orders where id = new.source_id)
      when 'pick' then (select location_id from public.orders where id = new.source_id)
      when 'ship' then (select location_id from public.orders where id = new.source_id)
      when 'transfer' then (select from_location from public.stock_transfers where id = new.source_id)
      else null end;
    new.location_id := coalesce(new.location_id, public.default_location());
  end if;
  return new;
end $$;
drop trigger if exists guard_wh_task on public.wh_tasks;
create trigger guard_wh_task before insert or update on public.wh_tasks for each row execute function public.guard_wh_task();

-- Start / done / reopen. The assignee or the office team.
create or replace function public.wh_task_step(p_id uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare w public.wh_tasks;
begin
  select * into w from public.wh_tasks where id = p_id for update;
  if w.id is null then raise exception 'Task not found'; end if;
  if not public.is_active() or not (public.is_admin() or w.assigned_to = auth.uid()) then raise exception 'This task is not assigned to you'; end if;
  perform set_config('app.wh_step', 'on', true);
  if p_action = 'start' then
    if w.status not in ('open', 'in_progress') then raise exception 'This task is closed'; end if;
    update public.wh_tasks set status = 'in_progress', started_at = coalesce(started_at, now()),
      assigned_to = coalesce(assigned_to, auth.uid()) where id = w.id;
  elsif p_action = 'done' then
    if w.status not in ('open', 'in_progress') then raise exception 'This task is closed'; end if;
    if w.kind = 'pick' and exists (select 1 from public.orders where id = w.source_id and delivery = 'not_shipped') then
      perform public.order_delivery_after(w.source_id, 'packed');
    end if;
    update public.wh_tasks set status = 'done', done_at = now(), done_by = auth.uid(), started_at = coalesce(started_at, now()) where id = w.id;
  elsif p_action = 'reopen' then
    if not public.is_admin() then raise exception 'Only the office team can reopen tasks'; end if;
    update public.wh_tasks set status = 'open', done_at = null, done_by = null where id = w.id;
  else raise exception 'Unknown action';
  end if;
  perform set_config('app.wh_step', 'off', true);
  return (select status from public.wh_tasks where id = w.id);
end $$;
revoke all on function public.wh_task_step(uuid, text) from public, anon;
grant execute on function public.wh_task_step(uuid, text) to authenticated;

-- Close tasks whose document is finished.
create or replace function public.wh_autoclose() returns trigger
language plpgsql security definer set search_path = public as $$
declare was text := current_setting('app.wh_step', true);
begin
  perform set_config('app.wh_step', 'on', true);
  -- (row fields differ per table, so each branch only touches its own table's columns)
  if tg_table_name in ('purchase_orders', 'stock_transfers') then
    if (to_jsonb(new)->>'status') in ('received', 'cancelled') then
      update public.wh_tasks set status = case when to_jsonb(new)->>'status' = 'received' then 'done' else 'cancelled' end, done_at = now(), done_by = auth.uid()
       where kind = case tg_table_name when 'purchase_orders' then 'receive' else 'transfer' end and source_id = new.id and status in ('open', 'in_progress');
    end if;
  elsif tg_table_name = 'orders' then
    if (to_jsonb(new)->>'delivery') in ('shipped', 'delivered') or (to_jsonb(new)->>'status') = 'cancelled' then
      update public.wh_tasks set status = case when to_jsonb(new)->>'status' = 'cancelled' then 'cancelled' else 'done' end, done_at = now(), done_by = auth.uid()
       where kind in ('pick', 'ship') and source_id = new.id and status in ('open', 'in_progress');
    end if;
  end if;
  perform set_config('app.wh_step', coalesce(was, ''), true);
  return new;
end $$;
drop trigger if exists wh_autoclose on public.purchase_orders;
create trigger wh_autoclose after update of status on public.purchase_orders for each row execute function public.wh_autoclose();
drop trigger if exists wh_autoclose on public.orders;
create trigger wh_autoclose after update of delivery, status on public.orders for each row execute function public.wh_autoclose();
drop trigger if exists wh_autoclose on public.stock_transfers;
create trigger wh_autoclose after update of status on public.stock_transfers for each row execute function public.wh_autoclose();

-- Is the caller assigned an open task of this kind for this document?
create or replace function public.my_wh_task(p_kinds text[], p_source uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_stock_keeper() and exists (select 1 from public.wh_tasks where source_id = p_source and kind = any(p_kinds)
    and assigned_to = auth.uid() and status in ('open', 'in_progress'))
$$;

-- Warehouse staff assigned to pick/ship an order may ship it.
create or replace function public.ship_lines(p_order uuid, p_lines jsonb default null, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; r jsonb; q numeric; prev text; kind text;
begin
  if not (public.is_admin() or public.my_wh_task(array['pick', 'ship'], p_order)) then raise exception 'Only the office team, or whoever is assigned to ship it, can ship orders'; end if;
  prev := public.claim_op('ship_lines', p_key);
  if prev is not null then return prev; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.kind = 'quote' then raise exception 'Quotes are not delivered'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  for l in select * from public.order_lines where order_id = o.id order by sort, created_at for update loop
    if p_lines is null then q := l.quantity - l.shipped;
    else
      select x into r from jsonb_array_elements(p_lines) x where (x->>'line')::uuid = l.id;
      q := coalesce((r->>'qty')::numeric, 0);
    end if;
    continue when q = 0;
    if q < 0 then raise exception 'Ship a positive quantity'; end if;
    if l.shipped + q > l.quantity then
      raise exception '% — only % left to ship', coalesce(nullif(l.name, ''), l.sku), trim_scale(l.quantity - l.shipped);
    end if;
    select si.kind into kind from public.stock_items si where si.id = l.item_id;
    if l.item_id is not null and kind is distinct from 'service' then
      perform public.stock_source('order_line', l.id);
      perform public.move_stock(l.item_id, -q, 'ship', o.order_number, '');
    end if;
    update public.order_lines set shipped = shipped + q where id = l.id;
  end loop;
  return public.finish_op('ship_lines', p_key, public.order_delivery_after(o.id));
end $$;
revoke all on function public.ship_lines(uuid, jsonb, text) from public, anon;
grant execute on function public.ship_lines(uuid, jsonb, text) to authenticated;

-- ============================================================================
-- Phase 6a — planning (PLAN-01..08).
-- plan_item(): week-by-week projected stock for one item (optionally at one
-- location): opening stock + receipts (POs incl. outsourced, open MOs, transfers
-- in transit) − demand (sales lines, MO ingredients, outsourced-PO materials,
-- draft transfers out) − forecast. Forecast per week = manual override if set,
-- else the automatic forecast: a weighted average of the last 12 weeks of
-- shipments (recent weeks count more). Forecast and booked sales are not added
-- twice: each week uses whichever is larger. A recommendation says when and how
-- much to buy or make so stock stays at or above the reorder point.
-- ============================================================================
create table if not exists public.forecast_overrides (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  period text not null check (period in ('week', 'month')),
  period_start date not null,
  quantity numeric(14,3) not null check (quantity >= 0),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((period = 'week' and extract(isodow from period_start) = 1) or (period = 'month' and extract(day from period_start) = 1))
);
create unique index if not exists forecast_overrides_key on public.forecast_overrides (item_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), period, period_start);
alter table public.forecast_overrides enable row level security;
drop policy if exists "staff read" on public.forecast_overrides;
drop policy if exists "office write" on public.forecast_overrides;
create policy "staff read" on public.forecast_overrides for select to authenticated using (public.is_active());
create policy "office write" on public.forecast_overrides for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop trigger if exists audit_row on public.forecast_overrides;
create trigger audit_row after insert or update or delete on public.forecast_overrides for each row execute function public.audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'forecast_overrides') then
    alter publication supabase_realtime add table public.forecast_overrides;
  end if;
end $$;

-- Weekly shipments of an item over the last p_weeks complete weeks (oldest first).
create or replace function public.demand_history(p_item uuid, p_location uuid default null, p_weeks int default 12) returns jsonb
language sql stable security definer set search_path = public as $$
  with w as (select (date_trunc('week', current_date)::date - 7 * g) as wk from generate_series(1, greatest(p_weeks, 1)) g)
  select coalesce(jsonb_agg(jsonb_build_object('week', w.wk, 'qty', coalesce(s.q, 0)) order by w.wk), '[]')
    from w left join (select date_trunc('week', created_at)::date wk, -sum(delta) q from public.stock_movements
                       where item_id = p_item and reason = 'ship' and (p_location is null or location_id = p_location)
                         and created_at >= date_trunc('week', current_date) - make_interval(weeks => greatest(p_weeks, 1))
                         and created_at < date_trunc('week', current_date) group by 1) s on s.wk = w.wk
$$;

create or replace function public.plan_item(p_item uuid, p_location uuid default null, p_weeks int default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it public.stock_items; w0 date := date_trunc('week', current_date)::date; hist jsonb; h jsonb;
  wsum numeric := 0; wtot numeric := 0; i int := 0; rate numeric := 0; first_ship timestamptz; enough boolean;
  opening numeric; bal numeric; weeks jsonb := '[]'; v_wk date; rec numeric; sales numeric; other numeric; fc numeric; fsrc text; use_dem numeric;
  low numeric; low_wk date; reorder numeric; lead int; rqty numeric; batch numeric; act text; loc_name text;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  select * into it from public.stock_items where id = p_item;
  if it.id is null then raise exception 'Item not found'; end if;
  p_weeks := least(greatest(p_weeks, 4), 52);
  -- automatic forecast: weighted average of the last 12 complete weeks (weights 1..12)
  hist := public.demand_history(p_item, p_location, 12);
  for h in select * from jsonb_array_elements(hist) loop
    i := i + 1; wsum := wsum + i * (h->>'qty')::numeric; wtot := wtot + i;
  end loop;
  select min(created_at) into first_ship from public.stock_movements where item_id = p_item and reason = 'ship' and (p_location is null or location_id = p_location);
  enough := first_ship is not null and first_ship <= now() - interval '4 weeks';
  rate := case when enough then round(wsum / nullif(wtot, 0), 3) else 0 end;
  -- opening stock (in transit and the production floor are not free stock)
  select coalesce(sum(quantity), 0) into opening from public.stock_levels sl join public.locations l on l.id = sl.location_id
   where sl.item_id = p_item and l.kind not in ('transit', 'wip') and (p_location is null or sl.location_id = p_location);
  create temp table if not exists pl_flow (wk date, kind text, qty numeric, ref text) on commit drop;
  truncate pl_flow;
  -- receipts
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(p.expected_date, current_date))::date), 'receipt', l.quantity - l.received, p.number
    from public.po_lines l join public.purchase_orders p on p.id = l.po_id
   where l.item_id = p_item and p.status in ('ordered', 'partial') and l.quantity > l.received
     and (p_location is null or coalesce(p.location_id, public.default_location()) = p_location);
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(j.due_date, current_date))::date), 'receipt', coalesce(j.quantity, 1) - j.produced, j.code
    from public.jobs j where j.sku = it.sku and it.kind not in ('material', 'service') and j.status <> 'done' and not j.stock_booked
     and coalesce(j.quantity, 1) > j.produced and (p_location is null or coalesce(j.location_id, public.default_location()) = p_location);
  if p_location is not null then
    insert into pl_flow select greatest(w0, date_trunc('week', coalesce(t.expected_date, current_date))::date), 'receipt', tl.quantity, t.number
      from public.transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
     where tl.item_id = p_item and t.status = 'in_transit' and t.to_location = p_location;
    insert into pl_flow select greatest(w0, date_trunc('week', coalesce(t.expected_date, current_date))::date), 'demand', tl.quantity, t.number
      from public.transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
     where tl.item_id = p_item and t.status = 'draft' and t.from_location = p_location;
  end if;
  -- demand: sales lines, MO ingredients, outsourced-PO materials
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(o.delivery_deadline, current_date))::date), 'sales', l.quantity - l.shipped, o.order_number
    from public.order_lines l join public.orders o on o.id = l.order_id
   where l.item_id = p_item and o.kind = 'order' and o.status = 'open' and l.quantity > l.shipped
     and (p_location is null or coalesce(o.location_id, public.default_location()) = p_location);
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(j.due_date, current_date))::date), 'demand',
         greatest(b.quantity * (coalesce(j.quantity, 1) - j.produced) - coalesce(mm.picked - mm.used_from_wip - mm.returned, 0), 0), j.code
    from public.jobs j
    join lateral (select id from public.stock_items where sku = j.sku and kind <> 'service' order by (kind = 'material'), created_at limit 1) p on true
    join public.bom_lines b on b.product_id = p.id and b.material_id = p_item
    left join public.mo_materials mm on mm.job_id = j.id and mm.item_id = p_item
   where j.status <> 'done' and not j.stock_booked and (p_location is null or coalesce(j.location_id, public.default_location()) = p_location);
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(p.expected_date, current_date))::date), 'demand', pm.quantity_per * (l.quantity - l.received), p.number
    from public.po_materials pm join public.po_lines l on l.id = pm.po_line_id join public.purchase_orders p on p.id = l.po_id
   where pm.item_id = p_item and p.kind = 'outsourced' and p.status in ('ordered', 'partial') and l.quantity > l.received
     and (p_location is null or p.partner_location_id = p_location);
  -- walk the weeks
  bal := opening; low := opening; low_wk := null; reorder := coalesce(it.min_quantity, 0);
  for i in 0 .. p_weeks - 1 loop
    v_wk := w0 + 7 * i;
    select coalesce(sum(qty) filter (where kind = 'receipt'), 0), coalesce(sum(qty) filter (where kind = 'sales'), 0), coalesce(sum(qty) filter (where kind = 'demand'), 0)
      into rec, sales, other from pl_flow where pl_flow.wk = v_wk;
    -- forecast: weekly override, else monthly override spread over its days, else automatic
    select quantity into fc from public.forecast_overrides fo where fo.item_id = p_item and fo.period = 'week' and fo.period_start = v_wk
       and fo.location_id is not distinct from p_location;
    if fc is not null then fsrc := 'manual';
    else
      select round(quantity * 7 / extract(day from (period_start + interval '1 month' - interval '1 day')), 3) into fc from public.forecast_overrides fo
       where fo.item_id = p_item and fo.period = 'month' and fo.period_start = date_trunc('month', v_wk + 3)::date and fo.location_id is not distinct from p_location;
      if fc is not null then fsrc := 'manual'; else fc := rate; fsrc := case when enough then 'auto' else 'none' end; end if;
    end if;
    -- the forecast stands for customer sales: booked sales use it up (whichever is larger counts)
    use_dem := greatest(sales, fc) + other;
    bal := bal + rec - use_dem;
    if bal < low or (low_wk is null and bal < reorder) then
      if bal < reorder and low_wk is null then low_wk := v_wk; end if;
      low := least(low, bal);
    end if;
    weeks := weeks || jsonb_build_object('week', v_wk, 'receipts', rec, 'orders', sales, 'other', other, 'forecast', fc, 'forecast_source', fsrc,
      'demand', use_dem, 'closing', round(bal, 3),
      'refs', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'qty', qty, 'ref', ref)), '[]') from pl_flow f where f.wk = v_wk));
  end loop;
  -- recommendation: bring the lowest point back up to the reorder point (rounded to the batch size)
  act := null; rqty := 0;
  if low_wk is not null then
    act := case when exists (select 1 from public.bom_lines where product_id = p_item) then 'make' else 'buy' end;
    batch := greatest(coalesce(nullif(it.make_batch, 0), 1), 1);
    rqty := ceil(greatest(reorder - low, 0.001) / batch) * batch;
    lead := coalesce(it.lead_days, (select default_lead_days from public.company_settings where id = 1), 7);
  end if;
  select name into loc_name from public.locations where id = p_location;
  return jsonb_build_object(
    'item', jsonb_build_object('id', it.id, 'sku', it.sku, 'name', it.name, 'unit', it.unit, 'reorder_point', reorder),
    'location', loc_name, 'opening', opening, 'weeks', weeks, 'history', hist,
    'forecast', jsonb_build_object('weekly', rate, 'enough_history', enough,
      'method', 'Weighted average of the last 12 complete weeks of shipments; the most recent week counts 12×, the oldest 1×. Needs at least 4 weeks of history. Manual overrides replace it for their week or month.'),
    'recommendation', case when act is null then null else jsonb_build_object('action', act, 'quantity', rqty, 'short_week', low_wk,
      'order_by', greatest(current_date, low_wk - lead), 'lead_days', lead, 'lowest', round(low, 3),
      'reason', format('Projected stock falls to %s in the week of %s (reorder point %s)', trim_scale(round(low, 3)), to_char(low_wk, 'DD Mon'), trim_scale(reorder))) end);
end $$;
revoke all on function public.plan_item(uuid, uuid, int) from public, anon;
grant execute on function public.plan_item(uuid, uuid, int) to authenticated;
revoke all on function public.demand_history(uuid, uuid, int) from public, anon;
grant execute on function public.demand_history(uuid, uuid, int) to authenticated;

-- Every stocked item with a recommendation or a shortage in the horizon (for the Plan screen).
create or replace function public.plan_overview(p_location uuid default null, p_weeks int default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; p jsonb; out jsonb := '[]';
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  for r in select id from public.stock_items where not archived and kind <> 'service' order by sku loop
    p := public.plan_item(r.id, p_location, p_weeks);
    if p->'recommendation' is not null and p->'recommendation' <> 'null'::jsonb then
      out := out || jsonb_build_object('item', p->'item', 'opening', p->'opening', 'recommendation', p->'recommendation',
        'forecast', p->'forecast'->'weekly', 'source', case when exists (select 1 from jsonb_array_elements(p->'weeks') x where x->>'forecast_source' = 'manual') then 'manual'
          when (p->'forecast'->>'enough_history')::boolean then 'auto' else 'none' end);
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.plan_overview(uuid, int) from public, anon;
grant execute on function public.plan_overview(uuid, int) to authenticated;

-- ============================================================================
-- Phase 6b — reports (REP-01..09). One entry point, report(kind, from, to,
-- group, location), computed straight from the ledger and the documents so the
-- numbers reconcile with the records they come from. Cost, margin and value
-- columns are null for roles without "Costs & margins" (PO prices: also "Buy").
-- Dates are inclusive days; amounts are in the base currency.
-- ============================================================================
create or replace function public.report(p_kind text, p_from date, p_to date, p_group text default null, p_location uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c boolean := public.can_see_costs();
  buy boolean := 'buy' = any(public.my_kimera_sections()) or public.can_see_costs();
  t0 timestamptz := p_from::timestamptz; t1 timestamptz := (p_to + 1)::timestamptz;
  rows jsonb; totals jsonb; rate numeric;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a valid date range'; end if;
  if 'insights' <> all(public.my_kimera_sections()) then raise exception 'Reports are not open for your role'; end if;

  if p_kind = 'sales' then
    -- revenue is recognised when goods ship (net of undo and returns); services when the order ships
    with s as (
      select m.item_id, o.id order_id, o.customer, coalesce(nullif(o.company, ''), o.customer) cust, date_trunc('month', m.created_at)::date mon,
             -m.delta qty, -m.delta * coalesce(ol.unit_price, 0) rev, -m.delta * m.unit_cost cogs
        from public.stock_movements m join public.order_lines ol on ol.id = m.source_id join public.orders o on o.id = ol.order_id
       where m.source_type = 'order_line' and m.reason in ('ship', 'return') and m.created_at >= t0 and m.created_at < t1
         and (p_location is null or m.location_id = p_location)
      union all
      select ol.item_id, o.id, o.customer, coalesce(nullif(o.company, ''), o.customer), date_trunc('month', o.shipped_at)::date, ol.shipped - ol.returned,
             (ol.shipped - ol.returned) * coalesce(ol.unit_price, 0), 0
        from public.order_lines ol join public.orders o on o.id = ol.order_id join public.stock_items si on si.id = ol.item_id and si.kind = 'service'
       where o.shipped_at >= t0 and o.shipped_at < t1 and p_location is null),
    g as (
      select case coalesce(p_group, 'product') when 'customer' then cust when 'month' then to_char(mon, 'YYYY-MM') else si.sku end as key,
             case coalesce(p_group, 'product') when 'customer' then cust when 'month' then to_char(mon, 'Mon YYYY') else si.name end as label,
             case coalesce(p_group, 'product') when 'product' then si.id::text else null end as item_id,
             sum(qty) qty, sum(rev) revenue, sum(cogs) cogs, count(distinct order_id) orders
        from s left join public.stock_items si on si.id = s.item_id group by 1, 2, 3)
    select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'item_id', item_id, 'qty', qty, 'orders', orders, 'revenue', round(revenue, 2),
             'cost', case when c then round(cogs, 2) end, 'margin', case when c then round(revenue - cogs, 2) end,
             'margin_pct', case when c and revenue <> 0 then round((revenue - cogs) / revenue * 100, 1) end) order by revenue desc, key), '[]'),
           jsonb_build_object('qty', coalesce(sum(qty), 0), 'revenue', round(coalesce(sum(revenue), 0), 2), 'cost', case when c then round(coalesce(sum(cogs), 0), 2) end,
             'margin', case when c then round(coalesce(sum(revenue - cogs), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'inventory' then
    with m as (select item_id, delta, created_at from public.stock_movements where (p_location is null or location_id = p_location)),
    g as (select si.id, si.sku, si.name, si.unit, si.avg_cost,
             coalesce(sum(m.delta) filter (where m.created_at < t0), 0) opening,
             coalesce(sum(m.delta) filter (where m.created_at >= t0 and m.created_at < t1 and m.delta > 0), 0) qin,
             coalesce(sum(m.delta) filter (where m.created_at >= t0 and m.created_at < t1 and m.delta < 0), 0) qout,
             coalesce(sum(m.delta) filter (where m.created_at < t1), 0) closing
        from public.stock_items si left join m on m.item_id = si.id where si.kind <> 'service' and not si.archived group by si.id)
    select coalesce(jsonb_agg(jsonb_build_object('key', sku, 'label', name, 'item_id', id, 'unit', unit, 'opening', opening, 'in', qin, 'out', -qout, 'closing', closing,
             'value', case when c then round(closing * avg_cost, 2) end) order by sku) filter (where opening <> 0 or qin <> 0 or qout <> 0 or closing <> 0), '[]'),
           jsonb_build_object('in', coalesce(sum(qin), 0), 'out', coalesce(-sum(qout), 0), 'value', case when c then round(coalesce(sum(closing * avg_cost), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'purchasing' then
    with p as (select p.*, (select sum(l.quantity * l.unit_cost * p.fx_rate) from public.po_lines l where l.po_id = p.id) ordered_value,
                      (select sum(l.received * l.unit_cost * p.fx_rate) from public.po_lines l where l.po_id = p.id) received_value
                 from public.purchase_orders p where p.ordered_at >= t0 and p.ordered_at < t1 and p.status <> 'cancelled'
                  and (p_location is null or coalesce(p.location_id, public.default_location()) = p_location)),
    g as (select coalesce(s.name, '—') sup, s.id sid, count(*) pos, sum(ordered_value) ordered, sum(received_value) received,
             count(*) filter (where p.status = 'received') done,
             count(*) filter (where p.status = 'received' and p.expected_date is not null and p.received_at::date <= p.expected_date) on_time,
             count(*) filter (where p.status = 'received' and p.expected_date is not null) with_date,
             round(avg(extract(epoch from p.received_at - p.ordered_at) / 86400) filter (where p.status = 'received'), 1) lead_days,
             count(*) filter (where p.kind = 'outsourced') outsourced
        from p left join public.suppliers s on s.id = p.supplier_id group by s.name, s.id)
    select coalesce(jsonb_agg(jsonb_build_object('key', sup, 'label', sup, 'supplier_id', sid, 'pos', pos, 'outsourced', outsourced,
             'ordered', case when buy then round(ordered, 2) end, 'received', case when buy then round(received, 2) end,
             'on_time_pct', case when with_date > 0 then round(on_time * 100.0 / with_date) end, 'lead_days', lead_days) order by ordered desc nulls last), '[]'),
           jsonb_build_object('pos', coalesce(sum(pos), 0), 'ordered', case when buy then round(coalesce(sum(ordered), 0), 2) end, 'received', case when buy then round(coalesce(sum(received), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'manufacturing' then
    select labour_rate into rate from public.company_settings where id = 1;
    with j as (select j.* from public.jobs j where j.status = 'done' and j.completed_at >= t0 and j.completed_at < t1 and j.sku is not null
                  and (p_location is null or coalesce(j.location_id, public.default_location()) = p_location)),
    g as (select j.id, j.code, j.title, j.sku, coalesce(j.quantity, 1) qty, j.completed_at,
             (select coalesce(sum(-m.delta * m.unit_cost), 0) from public.stock_movements m where m.job_id = j.id and m.reason = 'consume') mat,
             (select coalesce(sum(extract(epoch from (coalesce(pa.left_at, j.completed_at) - pa.joined_at)) / 3600), 0) from public.participants pa where pa.job_id = j.id) hours,
             (select coalesce(sum(b.quantity * s.avg_cost), 0) * coalesce(j.quantity, 1) from public.bom_lines b join public.stock_items s on s.id = b.material_id
               where b.product_id = public.mo_product(j.id)) planned
        from j)
    select coalesce(jsonb_agg(jsonb_build_object('key', code, 'label', title, 'job_id', id, 'sku', sku, 'qty', qty, 'done', completed_at, 'hours', round(hours, 2),
             'planned', case when c then round(planned, 2) end, 'materials', case when c then round(mat, 2) end, 'labour', case when c then round(hours * rate, 2) end,
             'total', case when c then round(mat + hours * rate, 2) end, 'unit', case when c then round((mat + hours * rate) / qty, 2) end,
             'variance', case when c then round(mat - planned, 2) end) order by completed_at desc), '[]'),
           jsonb_build_object('mos', count(*), 'qty', coalesce(sum(qty), 0), 'hours', round(coalesce(sum(hours), 0), 2),
             'materials', case when c then round(coalesce(sum(mat), 0), 2) end, 'labour', case when c then round(coalesce(sum(hours * rate), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'consumption' then
    with g as (select si.id, si.sku, si.name, si.unit, sum(-m.delta) qty, sum(-m.delta * m.unit_cost) val, count(distinct m.job_id) mos
                 from public.stock_movements m join public.stock_items si on si.id = m.item_id
                where m.reason = 'consume' and m.created_at >= t0 and m.created_at < t1 and (p_location is null or m.location_id = p_location)
                group by si.id having sum(m.delta) <> 0)
    select coalesce(jsonb_agg(jsonb_build_object('key', sku, 'label', name, 'item_id', id, 'unit', unit, 'qty', qty, 'mos', mos,
             'value', case when c then round(val, 2) end) order by val desc nulls last, sku), '[]'),
           jsonb_build_object('value', case when c then round(coalesce(sum(val), 0), 2) end, 'qty', coalesce(sum(qty), 0))
      into rows, totals from g;

  elsif p_kind = 'production' then
    -- person-hours on jobs (clipped to the range), jobs worked, station steps completed
    with h as (select pa.user_id, pa.job_id,
                      extract(epoch from (least(coalesce(pa.left_at, now()), t1) - greatest(pa.joined_at, t0))) / 3600 hrs
                 from public.participants pa where pa.joined_at < t1 and coalesce(pa.left_at, now()) > t0),
    g as (select pr.id, pr.full_name, coalesce(sum(h.hrs), 0) hrs, count(distinct h.job_id) jobs,
             (select count(*) from public.job_steps st where st.completed_by = pr.id and st.completed_at >= t0 and st.completed_at < t1) steps
        from public.profiles pr left join h on h.user_id = pr.id where pr.active or h.user_id is not null group by pr.id)
    select coalesce(jsonb_agg(jsonb_build_object('key', full_name, 'label', full_name, 'user_id', id, 'hours', round(hrs, 2), 'jobs', jobs, 'steps', steps,
             'hours_per_job', case when jobs > 0 then round(hrs / jobs, 2) end) order by hrs desc) filter (where hrs > 0 or steps > 0), '[]'),
           jsonb_build_object('hours', round(coalesce(sum(hrs), 0), 2), 'steps', coalesce(sum(steps), 0),
             'mos_done', (select count(*) from public.jobs where status = 'done' and completed_at >= t0 and completed_at < t1),
             'units_made', (select coalesce(sum(delta), 0) from public.stock_movements where reason = 'produce' and created_at >= t0 and created_at < t1),
             'by_station', (select coalesce(jsonb_agg(jsonb_build_object('station', s.name, 'steps', x.n) order by x.n desc), '[]')
                              from (select station_id, count(*) n from public.job_steps where completed_at >= t0 and completed_at < t1 group by station_id) x
                              left join public.stations s on s.id = x.station_id))
      into rows, totals from g;
  else
    raise exception 'Unknown report';
  end if;
  return jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'group', p_group, 'costs', c, 'rows', rows, 'totals', totals);
end $$;
revoke all on function public.report(text, date, date, text, uuid) from public, anon;
grant execute on function public.report(text, date, date, text, uuid) to authenticated;

-- ============================================================================
-- Phase 6c — API keys, webhooks (INT-06..09).
-- API keys: only a SHA-256 hash is stored; the key is shown once. The REST API
-- (edge function "api") checks a key with verify_api_key() and never returns
-- costs. Webhooks: business events go to an outbox (webhook_events); each active
-- webhook subscribed to the event gets a delivery row; the "webhooks" edge
-- function signs (HMAC-SHA256 with the webhook's secret) and sends them, with
-- retries at 1, 5, 30, 120 and 720 minutes. Owner/Developer manage both.
-- ============================================================================
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$ select public.is_active() and public.my_role() in ('boss', 'developer') $$;

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{read}' check (scopes <@ array['read', 'write']::text[] and cardinality(scopes) > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~ '^https://'),
  events text[] not null check (cardinality(events) > 0),
  secret text not null,
  active boolean not null default true,
  note text not null default '',
  failures int not null default 0,
  last_status int,
  last_delivery_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.webhook_events (
  id bigserial primary key,
  type text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.webhook_deliveries (
  id bigserial primary key,
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  event_id bigint not null references public.webhook_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'ok', 'failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  response_code int,
  error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_due on public.webhook_deliveries (next_at) where status in ('pending', 'sending');
do $$
declare t text;
begin
  foreach t in array array['api_keys', 'webhooks', 'webhook_events', 'webhook_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner read" on public.%I', t);
    execute format('create policy "owner read" on public.%I for select to authenticated using (public.is_owner())', t);
  end loop;
end $$;
drop policy if exists "owner write" on public.webhooks;
create policy "owner write" on public.webhooks for update to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "owner delete" on public.webhooks;
create policy "owner delete" on public.webhooks for delete to authenticated using (public.is_owner());
drop trigger if exists audit_row on public.api_keys;
create trigger audit_row after insert or update or delete on public.api_keys for each row execute function public.audit_row();
drop trigger if exists audit_row on public.webhooks;
create trigger audit_row after insert or update or delete on public.webhooks for each row execute function public.audit_row();

-- ---- API keys
create or replace function public.create_api_key(p_name text, p_scopes text[] default '{read}') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare k text := 'kt_' || encode(gen_random_bytes(24), 'hex'); id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner or a developer can create API keys'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the key a name'; end if;
  insert into public.api_keys (name, prefix, key_hash, scopes) values (trim(p_name), left(k, 10), encode(digest(k, 'sha256'), 'hex'), p_scopes) returning api_keys.id into id;
  return jsonb_build_object('id', id, 'key', k, 'prefix', left(k, 10));
end $$;
revoke all on function public.create_api_key(text, text[]) from public, anon;
grant execute on function public.create_api_key(text, text[]) to authenticated;

create or replace function public.revoke_api_key(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner or a developer can revoke API keys'; end if;
  update public.api_keys set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;
revoke all on function public.revoke_api_key(uuid) from public, anon;
grant execute on function public.revoke_api_key(uuid) to authenticated;

-- Used by the API edge function (service role only): the key's scopes, or null.
create or replace function public.verify_api_key(p_key text) returns text[]
language plpgsql security definer set search_path = public, extensions as $$
declare s text[];
begin
  update public.api_keys set last_used_at = now()
   where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null returning scopes into s;
  return s;
end $$;
revoke all on function public.verify_api_key(text) from public, anon, authenticated;

-- ---- webhooks
create or replace function public.webhook_event_types() returns text[]
language sql immutable as $$ select array['order.created', 'order.shipped', 'po.received', 'mo.completed', 'stock.low', 'test.ping'] $$;

create or replace function public.create_webhook(p_url text, p_events text[], p_note text default '') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare sec text := 'whsec_' || encode(gen_random_bytes(24), 'hex'); id uuid;
begin
  if not public.is_owner() then raise exception 'Only the owner or a developer can add webhooks'; end if;
  if p_url !~ '^https://[^\s/]+' then raise exception 'The address must start with https://'; end if;
  if not (p_events <@ (public.webhook_event_types() || array['*'])) or cardinality(p_events) = 0 then raise exception 'Pick at least one known event'; end if;
  insert into public.webhooks (url, events, secret, note) values (p_url, p_events, sec, coalesce(p_note, '')) returning webhooks.id into id;
  return jsonb_build_object('id', id, 'secret', sec);
end $$;
revoke all on function public.create_webhook(text, text[], text) from public, anon;
grant execute on function public.create_webhook(text, text[], text) to authenticated;

create or replace function public.rotate_webhook_secret(p_id uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare sec text := 'whsec_' || encode(gen_random_bytes(24), 'hex');
begin
  if not public.is_owner() then raise exception 'Only the owner or a developer can change webhooks'; end if;
  update public.webhooks set secret = sec where id = p_id;
  if not found then raise exception 'Webhook not found'; end if;
  return sec;
end $$;
revoke all on function public.rotate_webhook_secret(uuid) from public, anon;
grant execute on function public.rotate_webhook_secret(uuid) to authenticated;

-- Wake the sender (edge function) if one is configured.
create or replace function public.kick_webhooks() returns void
language plpgsql security definer set search_path = public as $$
declare url text;
begin
  select value into url from public.app_settings where key = 'webhooks_url';
  if url is not null and exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from public.webhook_deliveries where status in ('pending', 'sending') and next_at <= now()) then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)' using url, '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb;
  end if;
end $$;
revoke all on function public.kick_webhooks() from public, anon, authenticated;

-- Record an event and queue it for every subscribed webhook.
create or replace function public.emit_event(p_type text, p_data jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare eid bigint; n int;
begin
  if not exists (select 1 from public.webhooks where active and (p_type = any(events) or '*' = any(events))) then return null; end if;
  insert into public.webhook_events (type, data) values (p_type, p_data) returning id into eid;
  insert into public.webhook_deliveries (webhook_id, event_id)
    select id, eid from public.webhooks where active and (p_type = any(events) or '*' = any(events));
  get diagnostics n = row_count;
  if n > 0 then perform public.kick_webhooks(); end if;
  return eid;
end $$;
revoke all on function public.emit_event(text, jsonb) from public, anon, authenticated;

create or replace function public.test_webhook(p_id uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare eid bigint;
begin
  if not public.is_owner() then raise exception 'Only the owner or a developer can test webhooks'; end if;
  insert into public.webhook_events (type, data) values ('test.ping', jsonb_build_object('message', 'Hello from Kortana', 'webhook_id', p_id)) returning id into eid;
  insert into public.webhook_deliveries (webhook_id, event_id) values (p_id, eid);
  perform public.kick_webhooks();
  return eid;
end $$;
revoke all on function public.test_webhook(uuid) from public, anon;
grant execute on function public.test_webhook(uuid) to authenticated;

-- Sender side (service role): claim due deliveries, then report each result.
create or replace function public.claim_webhook_deliveries(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  with c as (select d.id from public.webhook_deliveries d
              where (d.status = 'pending' or (d.status = 'sending' and d.next_at < now() - interval '5 minutes')) and d.next_at <= now()
              order by d.next_at limit p_limit for update skip locked),
  u as (update public.webhook_deliveries d set status = 'sending', attempts = d.attempts + 1, next_at = now() from c where d.id = c.id returning d.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'attempt', u.attempts, 'url', w.url, 'secret', w.secret,
           'event', jsonb_build_object('id', e.id, 'type', e.type, 'created_at', e.created_at, 'data', e.data))), '[]')
    into out from u join public.webhooks w on w.id = u.webhook_id join public.webhook_events e on e.id = u.event_id;
  return out;
end $$;
revoke all on function public.claim_webhook_deliveries(int) from public, anon, authenticated;

create or replace function public.finish_webhook_delivery(p_id bigint, p_code int, p_error text default null) returns text
language plpgsql security definer set search_path = public as $$
declare d public.webhook_deliveries; ok boolean := p_code between 200 and 299; waits int[] := array[1, 5, 30, 120, 720];
begin
  select * into d from public.webhook_deliveries where id = p_id for update;
  if d.id is null then return 'missing'; end if;
  if ok then
    update public.webhook_deliveries set status = 'ok', response_code = p_code, error = null, delivered_at = now() where id = p_id;
    update public.webhooks set failures = 0, last_status = p_code, last_delivery_at = now() where id = d.webhook_id;
    return 'ok';
  end if;
  update public.webhooks set failures = failures + 1, last_status = p_code, last_delivery_at = now(),
    active = case when failures + 1 >= 50 then false else active end where id = d.webhook_id;
  if d.attempts > cardinality(waits) then
    update public.webhook_deliveries set status = 'failed', response_code = p_code, error = left(p_error, 500) where id = p_id;
    return 'failed';
  end if;
  update public.webhook_deliveries set status = 'pending', response_code = p_code, error = left(p_error, 500),
    next_at = now() + make_interval(mins => waits[d.attempts]) where id = p_id;
  return 'retry';
end $$;
revoke all on function public.finish_webhook_delivery(bigint, int, text) from public, anon, authenticated;

-- ---- business events
create or replace function public.webhook_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'orders' then
    if tg_op = 'INSERT' and new.kind = 'order' then
      perform public.emit_event('order.created', jsonb_build_object('id', new.id, 'number', new.order_number, 'customer', new.customer, 'company', new.company,
        'source', new.source, 'deadline', new.delivery_deadline));
    elsif tg_op = 'UPDATE' and new.delivery = 'shipped' and old.delivery is distinct from 'shipped' and old.delivery <> 'delivered' then
      perform public.emit_event('order.shipped', jsonb_build_object('id', new.id, 'number', new.order_number, 'customer', new.customer, 'tracking', new.tracking,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('sku', l.sku, 'name', l.name, 'quantity', l.quantity, 'shipped', l.shipped)), '[]') from public.order_lines l where l.order_id = new.id)));
    end if;
  elsif tg_table_name = 'purchase_orders' then
    if new.status = 'received' and old.status is distinct from 'received' then
      perform public.emit_event('po.received', jsonb_build_object('id', new.id, 'number', new.number,
        'supplier', (select name from public.suppliers where id = new.supplier_id), 'outsourced', new.kind = 'outsourced'));
    end if;
  elsif tg_table_name = 'jobs' then
    if new.status = 'done' and old.status is distinct from 'done' and new.sku is not null then
      perform public.emit_event('mo.completed', jsonb_build_object('id', new.id, 'code', new.code, 'sku', new.sku, 'quantity', new.quantity, 'title', new.title));
    end if;
  elsif tg_table_name = 'stock_items' then
    if new.min_quantity > 0 and old.quantity > old.min_quantity and new.quantity <= new.min_quantity then
      perform public.emit_event('stock.low', jsonb_build_object('id', new.id, 'sku', new.sku, 'name', new.name, 'quantity', new.quantity, 'reorder_point', new.min_quantity));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists webhook_events on public.orders;
create trigger webhook_events after insert or update on public.orders for each row execute function public.webhook_trigger();
drop trigger if exists webhook_events on public.purchase_orders;
create trigger webhook_events after update on public.purchase_orders for each row execute function public.webhook_trigger();
drop trigger if exists webhook_events on public.jobs;
create trigger webhook_events after update on public.jobs for each row execute function public.webhook_trigger();
drop trigger if exists webhook_events on public.stock_items;
create trigger webhook_events after update on public.stock_items for each row execute function public.webhook_trigger();

-- retries: every minute, if pg_cron is there
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('webhook-retries', '* * * * *', 'select public.kick_webhooks()');
  end if;
end $$;

-- The key hash and webhook secrets never go to the app.
create or replace function public.apply_cost_privileges() returns void
language plpgsql security definer set search_path = public as $$
declare t record; cols text;
begin
  for t in select * from (values ('stock_items', array['avg_cost']), ('stock_movements', array['unit_cost']),
                                 ('po_lines', array['unit_cost']), ('item_suppliers', array['unit_cost']),
                                 ('stations', array['cost_per_hour']), ('product_operations', array['fixed_cost']),
                                 ('api_keys', array['key_hash']), ('webhooks', array['secret'])) v(tbl, hidden) loop
    execute format('revoke select on public.%I from anon, authenticated', t.tbl);
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'public' and table_name = t.tbl and not (column_name = any(t.hidden));
    execute format('grant select (%s) on public.%I to authenticated', cols, t.tbl);
  end loop;
end $$;
revoke all on function public.apply_cost_privileges() from public, anon, authenticated;


-- API: orders created through the REST API (service role only; the edge function checks the key's "write" scope).
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('shopify', 'manual', 'api'));
create or replace function public.api_create_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare oid uuid; l jsonb; it public.stock_items; n int := 0; num text; ref text := nullif(trim(p->>'reference'), '');
begin
  if coalesce(trim(p->>'customer'), '') = '' then raise exception 'customer is required'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines must be a non-empty array'; end if;
  if ref is not null then
    select id into oid from public.orders where source = 'api' and note = 'API ref: ' || ref;
    if oid is not null then return jsonb_build_object('id', oid, 'number', (select order_number from public.orders where id = oid), 'duplicate', true); end if;
  end if;
  insert into public.orders (order_number, customer, company, email, phone, ship_to, shipping_method, note, kind, source, currency, ordered_at, delivery_deadline)
  values ('', trim(p->>'customer'), coalesce(p->>'company', ''), coalesce(p->>'email', ''), coalesce(p->>'phone', ''), coalesce(p->>'ship_to', ''),
          coalesce(p->>'shipping_method', ''), case when ref is null then '' else 'API ref: ' || ref end, 'order', 'api',
          coalesce(nullif(upper(p->>'currency'), ''), 'GBP'), now(), nullif(p->>'delivery_deadline', '')::date)
  returning id, order_number into oid, num;
  for l in select * from jsonb_array_elements(p->'lines') loop
    select * into it from public.stock_items where sku = trim(l->>'sku') and not archived;
    if it.id is null then raise exception 'unknown SKU: %', l->>'sku'; end if;
    if coalesce((l->>'quantity')::numeric, 0) <= 0 then raise exception 'quantity must be above 0 for %', it.sku; end if;
    n := n + 1;
    insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price, sort)
    values (oid, it.id, it.sku, it.name, (l->>'quantity')::numeric, coalesce((l->>'unit_price')::numeric, it.sale_price), n);
  end loop;
  return jsonb_build_object('id', oid, 'number', (select order_number from public.orders where id = oid), 'lines', n);
end $$;
revoke all on function public.api_create_order(jsonb) from public, anon, authenticated;


-- Settings → Integrations reads and changes everything through these (owner/developer only).
create or replace function public.integrations_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner or a developer can manage integrations'; end if;
  return jsonb_build_object(
    'keys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'prefix', prefix, 'scopes', scopes, 'created_at', created_at,
              'last_used_at', last_used_at, 'revoked_at', revoked_at, 'created_by', (select full_name from public.profiles where id = k.created_by)) order by revoked_at nulls first, created_at desc), '[]') from public.api_keys k),
    'webhooks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'events', events, 'active', active, 'note', note, 'failures', failures,
              'last_status', last_status, 'last_delivery_at', last_delivery_at, 'created_at', created_at) order by created_at), '[]') from public.webhooks),
    'deliveries', (select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]') from (
              select jsonb_build_object('id', d.id, 'webhook_id', d.webhook_id, 'type', e.type, 'status', d.status, 'attempts', d.attempts, 'code', d.response_code,
                'error', d.error, 'next_at', d.next_at, 'created_at', d.created_at) x
                from public.webhook_deliveries d join public.webhook_events e on e.id = d.event_id order by d.created_at desc limit 30) s),
    'events', to_jsonb(public.webhook_event_types()));
end $$;
revoke all on function public.integrations_state() from public, anon;
grant execute on function public.integrations_state() to authenticated;

create or replace function public.set_webhook(p_id uuid, p_active boolean default null, p_delete boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'Only the owner or a developer can change webhooks'; end if;
  if p_delete then delete from public.webhooks where id = p_id; return; end if;
  update public.webhooks set active = coalesce(p_active, active), failures = case when p_active then 0 else failures end where id = p_id;
end $$;
revoke all on function public.set_webhook(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_webhook(uuid, boolean, boolean) to authenticated;

-- ============================================================================
-- Phase 7 — close-out (CAT-02/06, SALES-07, SALES-09, INV-08, MFG-02, MFG-07,
-- MFG-09, ADMIN-06/07). Everything reuses the ledger: variants stay SKUs, kits
-- ship their components, stocktakes post through count_stock.
-- ============================================================================
-- ---- kits & bundles (SALES-07): an item type with a recipe and no stock of its own
alter table public.stock_items drop constraint if exists stock_items_kind_check;
alter table public.stock_items add constraint stock_items_kind_check check (kind in ('material', 'product', 'part', 'service', 'kit'));
create or replace function public.guard_kit_bom() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select kind from public.stock_items where id = new.material_id) = 'kit' then
    raise exception 'A kit cannot be an ingredient — add its components instead';
  end if;
  return new;
end $$;
drop trigger if exists guard_kit_bom on public.bom_lines;
create trigger guard_kit_bom before insert or update on public.bom_lines for each row execute function public.guard_kit_bom();

-- ---- variants (CAT-02/06): a family with options; each variant is its own SKU with its own recipe
create table if not exists public.product_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  options text[] not null default '{}',
  category text not null default '',
  created_at timestamptz not null default now()
);
alter table public.stock_items add column if not exists family_id uuid references public.product_families(id) on delete set null;
alter table public.stock_items add column if not exists variant jsonb not null default '{}';
create unique index if not exists stock_items_family_variant on public.stock_items (family_id, variant) where family_id is not null and not archived;
alter table public.product_families enable row level security;
drop policy if exists "staff read" on public.product_families;
drop policy if exists "keepers write" on public.product_families;
create policy "staff read" on public.product_families for select to authenticated using (public.is_active());
create policy "keepers write" on public.product_families for all to authenticated using (public.is_stock_keeper()) with check (public.is_stock_keeper());
drop trigger if exists audit_row on public.product_families;
create trigger audit_row after insert or update or delete on public.product_families for each row execute function public.audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_families') then
    alter publication supabase_realtime add table public.product_families;
  end if;
end $$;

-- New variant copied from an existing one: same details, recipe, operations and supplier refs.
create or replace function public.create_variant(p_from uuid, p_sku text, p_name text, p_variant jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare src public.stock_items; nid uuid;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can add items'; end if;
  select * into src from public.stock_items where id = p_from;
  if src.id is null then raise exception 'Item not found'; end if;
  if src.family_id is null then raise exception 'Put this item in a product family first'; end if;
  if coalesce(trim(p_sku), '') = '' then raise exception 'The new variant needs a SKU'; end if;
  if exists (select 1 from public.stock_items where sku = trim(p_sku)) then raise exception 'SKU % already exists', trim(p_sku); end if;
  insert into public.stock_items (sku, name, kind, category, location, unit, min_quantity, sale_price, supplier_id, supplier_code, lead_days, notes, make_min, make_batch, tracking, family_id, variant)
  values (trim(p_sku), coalesce(nullif(trim(p_name), ''), src.name), src.kind, src.category, '', src.unit, src.min_quantity, src.sale_price, src.supplier_id, '',
          src.lead_days, '', 0, src.make_batch, src.tracking, src.family_id, coalesce(p_variant, '{}'))
  returning id into nid;
  insert into public.bom_lines (product_id, material_id, quantity, notes) select nid, material_id, quantity, notes from public.bom_lines where product_id = src.id;
  insert into public.product_operations (product_id, station_id, name, setup_minutes, unit_minutes, fixed_cost, sort)
    select nid, station_id, name, setup_minutes, unit_minutes, fixed_cost, sort from public.product_operations where product_id = src.id;
  insert into public.item_suppliers (item_id, supplier_id, supplier_sku, unit_cost, lead_days, preferred)
    select nid, supplier_id, '', unit_cost, lead_days, preferred from public.item_suppliers where item_id = src.id;
  if exists (select 1 from public.products where sku = src.sku) then
    insert into public.products (sku, name, route, estimate_minutes) select trim(p_sku), coalesce(nullif(trim(p_name), ''), src.name), route, estimate_minutes
      from public.products where sku = src.sku on conflict do nothing;
  end if;
  return nid;
end $$;
revoke all on function public.create_variant(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_variant(uuid, text, text, jsonb) to authenticated;

-- ---- custom order fields (SALES-09) + workflow settings (ADMIN-06)
alter table public.company_settings add column if not exists order_fields jsonb not null default '[]';
alter table public.company_settings add column if not exists auto_sub_mos boolean not null default false;
alter table public.company_settings add column if not exists company_name text not null default 'Skalarki Electronics Ltd';
alter table public.company_settings add column if not exists company_address text not null default '';
alter table public.orders add column if not exists custom jsonb not null default '{}';

-- ---- stocktakes (INV-08): count, review the differences, post together
create sequence if not exists public.st_seq;
create table if not exists public.stocktakes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default 'ST-' || lpad(nextval('public.st_seq')::text, 4, '0'),
  location_id uuid not null references public.locations(id) on delete restrict,
  status text not null default 'counting' check (status in ('counting', 'posted', 'cancelled')),
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  posted_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz
);
create table if not exists public.stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
  item_id uuid not null references public.stock_items(id) on delete restrict,
  counted numeric(14,3) check (counted >= 0),
  system_at_post numeric(14,3),
  note text not null default '',
  counted_by uuid references public.profiles(id) on delete set null,
  counted_at timestamptz,
  unique (stocktake_id, item_id)
);
alter table public.stocktakes enable row level security;
alter table public.stocktake_lines enable row level security;
drop policy if exists "staff read" on public.stocktakes;
drop policy if exists "keepers write" on public.stocktakes;
drop policy if exists "staff read" on public.stocktake_lines;
drop policy if exists "keepers write" on public.stocktake_lines;
create policy "staff read" on public.stocktakes for select to authenticated using (public.is_active());
create policy "keepers write" on public.stocktakes for insert to authenticated with check (public.is_stock_keeper());
create policy "staff read" on public.stocktake_lines for select to authenticated using (public.is_active());
create policy "keepers write" on public.stocktake_lines for all to authenticated using (public.is_stock_keeper()) with check (public.is_stock_keeper());
do $$
declare t text;
begin
  foreach t in array array['stocktakes', 'stocktake_lines'] loop
    execute format('drop trigger if exists audit_row on public.%I', t);
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- Lines change only while counting.
create or replace function public.guard_stocktake_line() returns trigger
language plpgsql set search_path = public as $$
begin
  if (select status from public.stocktakes where id = coalesce(new.stocktake_id, old.stocktake_id)) <> 'counting'
     and not (tg_op = 'UPDATE' and new.counted is not distinct from old.counted and new.note = old.note and new.item_id = old.item_id
              and new.system_at_post is not distinct from old.system_at_post) then  -- (a removed person's name may still be cleared)
    raise exception 'This stocktake is closed';
  end if;
  if tg_op = 'UPDATE' and new.counted is not distinct from old.counted and new.note = old.note and new.system_at_post is not distinct from old.system_at_post then
    return new;
  end if;
  if tg_op <> 'DELETE' and new.counted is distinct from (case when tg_op = 'UPDATE' then old.counted end) then
    new.counted_by := auth.uid(); new.counted_at := now();
  end if;
  if tg_op <> 'DELETE' and current_setting('app.st_post', true) is distinct from 'on' then new.system_at_post := null; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_stocktake_line on public.stocktake_lines;
create trigger guard_stocktake_line before insert or update or delete on public.stocktake_lines for each row execute function public.guard_stocktake_line();

create or replace function public.start_stocktake(p_location uuid default null, p_items uuid[] default null, p_note text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare loc uuid := coalesce(p_location, public.default_location()); sid uuid;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can count stock'; end if;
  if exists (select 1 from public.stocktakes where location_id = loc and status = 'counting') then raise exception 'A stocktake is already open at this location'; end if;
  insert into public.stocktakes (location_id, note) values (loc, coalesce(p_note, '')) returning id into sid;
  insert into public.stocktake_lines (stocktake_id, item_id)
    select sid, s.id from public.stock_items s
     where not s.archived and s.kind not in ('service', 'kit')
       and (case when p_items is not null and cardinality(p_items) > 0 then s.id = any(p_items)
                 else exists (select 1 from public.stock_levels l where l.item_id = s.id and l.location_id = loc and l.quantity <> 0) end);
  return sid;
end $$;
revoke all on function public.start_stocktake(uuid, uuid[], text) from public, anon;
grant execute on function public.start_stocktake(uuid, uuid[], text) to authenticated;

-- Post: every counted line becomes a count at the location (difference vs the stock at posting time).
create or replace function public.post_stocktake(p_id uuid, p_action text default 'post') returns jsonb
language plpgsql security definer set search_path = public as $$
declare st public.stocktakes; l record; cur numeric; n int := 0; diff numeric := 0; val numeric := 0;
begin
  if not public.is_stock_keeper() then raise exception 'Only stock keepers can post stocktakes'; end if;
  select * into st from public.stocktakes where id = p_id for update;
  if st.id is null then raise exception 'Stocktake not found'; end if;
  if st.status <> 'counting' then raise exception 'This stocktake is closed'; end if;
  if p_action = 'cancel' then
    update public.stocktakes set status = 'cancelled', posted_by = auth.uid(), posted_at = now() where id = st.id;
    return jsonb_build_object('status', 'cancelled');
  end if;
  perform set_config('app.st_post', 'on', true);
  for l in select sl.*, s.avg_cost, s.sku from public.stocktake_lines sl join public.stock_items s on s.id = sl.item_id
            where sl.stocktake_id = st.id and sl.counted is not null for update of sl loop
    select coalesce((select quantity from public.stock_levels where item_id = l.item_id and location_id = st.location_id), 0) into cur;
    update public.stocktake_lines set system_at_post = cur where id = l.id;
    if l.counted <> cur then
      perform public.count_stock(l.item_id, l.counted, st.number || coalesce(nullif(' · ' || l.note, ' · '), ''), st.location_id);
      diff := diff + (l.counted - cur); val := val + (l.counted - cur) * coalesce(l.avg_cost, 0);
    end if;
    n := n + 1;
  end loop;
  perform set_config('app.st_post', 'off', true);
  update public.stocktakes set status = 'posted', posted_by = auth.uid(), posted_at = now() where id = st.id;
  return jsonb_build_object('status', 'posted', 'lines', n, 'difference', diff, 'value', case when public.can_see_costs() then round(val, 2) end);
end $$;
revoke all on function public.post_stocktake(uuid, text) from public, anon;
grant execute on function public.post_stocktake(uuid, text) to authenticated;

-- ---- sub-assembly MOs (MFG-02): linked child MOs for short sub-assemblies
alter table public.jobs add column if not exists parent_id uuid references public.jobs(id) on delete set null;
create index if not exists jobs_parent_idx on public.jobs (parent_id);
create or replace function public.create_sub_mos(p_job uuid) returns int
language plpgsql security definer set search_path = public as $$
declare j public.jobs; prod uuid; b record; need numeric; have numeric; open_q numeric; n int := 0; depth int := 0; p uuid; r uuid[]; pr public.products; loc uuid;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Only the office team can plan production'; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  p := j.parent_id;
  while p is not null and depth < 10 loop depth := depth + 1; select parent_id into p from public.jobs where id = p; end loop;
  if depth >= 5 then return 0; end if;
  prod := public.mo_product(j.id);
  loc := coalesce(j.location_id, public.default_location());
  for b in select bl.material_id, bl.quantity, m.sku, m.name from public.bom_lines bl join public.stock_items m on m.id = bl.material_id
            where bl.product_id = prod and m.kind in ('product', 'part') and exists (select 1 from public.bom_lines x where x.product_id = m.id) loop
    need := b.quantity * (coalesce(j.quantity, 1) - j.produced) - coalesce((select picked - used_from_wip - returned from public.mo_materials where job_id = j.id and item_id = b.material_id), 0);
    select greatest(coalesce(sum(quantity), 0), 0) into have from public.stock_levels where item_id = b.material_id and location_id = loc;
    select coalesce(sum(coalesce(quantity, 1) - produced), 0) into open_q from public.jobs where parent_id = j.id and sku = b.sku and status <> 'done';
    need := need - have - open_q;
    continue when need <= 0;
    select * into pr from public.products where sku = b.sku;
    r := case when coalesce(array_length(pr.route, 1), 0) > 0 then pr.route else public.default_route() end;
    insert into public.jobs (code, title, description, customer, priority, status, assignees, quantity, estimate_minutes, due_date, created_by, sku, route, stage, station_id, parent_id, location_id, rank)
    values ('STK-' || nextval('public.mo_seq'), b.name, 'Sub-assembly for ' || j.code, j.customer, j.priority, 'open', public.station_assignees(r[1]), ceil(need),
            pr.estimate_minutes, case when j.due_date is not null then j.due_date - 1 end, auth.uid(), b.sku, r, 0, r[1], j.id, j.location_id, j.rank);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.create_sub_mos(uuid) from public, anon;
grant execute on function public.create_sub_mos(uuid) to authenticated;

create or replace function public.auto_sub_mos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sku is not null and (select auto_sub_mos from public.company_settings where id = 1) then
    perform public.create_sub_mos(new.id);
  end if;
  return null;
end $$;
drop trigger if exists auto_sub_mos on public.jobs;
create trigger auto_sub_mos after insert on public.jobs for each row execute function public.auto_sub_mos();

-- ---- schedule (MFG-07/09): operations with the same step run at the same time; the finish date
-- counts the queue in front at each station and the station's daily capacity (hours × crew).
alter table public.product_operations add column if not exists step int check (step is null or step > 0);
create or replace function public.mo_schedule(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  j public.jobs; prod uuid; qty numeric; left_q numeric; hpd numeric; steps jsonb := '[]'; g record; day_n numeric := 0; d numeric; finish date; total_min numeric := 0;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  if j.status = 'done' then return jsonb_build_object('finish', j.completed_at::date, 'steps', '[]'::jsonb, 'minutes', 0); end if;
  select work_hours_per_day into hpd from public.company_settings where id = 1;
  prod := public.mo_product(j.id); qty := coalesce(j.quantity, 1); left_q := greatest(qty - j.produced, 0);
  for g in
    with ops as (
      select coalesce(o.step, 1000 + row_number() over (order by o.sort, o.created_at)) grp, o.station_id, st.name station,
             coalesce(nullif(o.name, ''), st.name, 'Operation') op, (o.setup_minutes + o.unit_minutes * left_q) mins
        from public.product_operations o left join public.stations st on st.id = o.station_id where o.product_id = prod),
    queue as (  -- open work ranked ahead of this MO at the same station
      select o.station_id, sum(o.setup_minutes + o.unit_minutes * greatest(coalesce(q.quantity, 1) - q.produced, 0)) mins
        from public.jobs q join public.stock_items s on s.sku = q.sku and s.kind not in ('material', 'service')
        join public.product_operations o on o.product_id = s.id
       where q.status <> 'done' and q.id <> j.id and q.sku is not null
         and (coalesce(q.rank, 1e15), q.created_at) < (coalesce(j.rank, 1e15), j.created_at)
       group by o.station_id)
    select ops.grp, jsonb_agg(jsonb_build_object('operation', ops.op, 'station', ops.station, 'minutes', ops.mins,
             'queue_minutes', coalesce(qu.mins, 0), 'crew', greatest((select count(*) from public.station_members sm where sm.station_id = ops.station_id), 1))) items,
           max((ops.mins + coalesce(qu.mins, 0)) / (hpd * 60 * greatest((select count(*) from public.station_members sm where sm.station_id = ops.station_id), 1))) days,
           max(ops.mins) longest
      from ops left join queue qu on qu.station_id = ops.station_id group by ops.grp order by ops.grp loop
    steps := steps || jsonb_build_object('step', g.grp, 'parallel', jsonb_array_length(g.items) > 1, 'operations', g.items, 'days', round(g.days, 2));
    day_n := day_n + g.days; total_min := total_min + g.longest;
  end loop;
  if jsonb_array_length(steps) = 0 then
    total_min := coalesce(j.estimate_minutes, 0) * left_q; day_n := total_min / (hpd * 60);
  end if;
  -- working days (Mon–Fri) from today
  d := ceil(day_n); finish := current_date;
  while d > 0 loop finish := finish + 1; if extract(isodow from finish) < 6 then d := d - 1; end if; end loop;
  return jsonb_build_object('finish', finish, 'working_days', ceil(day_n), 'minutes', round(total_min), 'steps', steps,
    'late', j.due_date is not null and finish > j.due_date);
end $$;
revoke all on function public.mo_schedule(uuid) from public, anon;
grant execute on function public.mo_schedule(uuid) to authenticated;

-- ---- updated: kits in the ledger, allocation, planning and sales reports; kits never get an MO

create or replace function public.move_stock(p_item uuid, p_delta numeric, p_reason text, p_ref text default '', p_note text default '', p_cost numeric default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s public.stock_items;
  q numeric;
  a numeric;
  loc uuid := nullif(current_setting('app.stock_loc', true), '')::uuid;
  st text := nullif(current_setting('app.stock_src_type', true), '');
  sid uuid := nullif(current_setting('app.stock_src_id', true), '')::uuid;
  lot uuid := nullif(current_setting('app.stock_lot', true), '')::uuid;
  oldloc text := current_setting('app.stock_loc', true);
  r record; left_qty numeric; take numeric;
begin
  select * into s from public.stock_items where id = p_item for update;
  if s.id is null then raise exception 'Item not found'; end if;
  if s.kind = 'service' then raise exception 'Services are not kept in stock'; end if;
  if s.kind = 'kit' then raise exception 'Kits are not kept in stock — their components are'; end if;
  if loc is null then
    loc := case st
      when 'po_line' then (select p.location_id from public.po_lines l join public.purchase_orders p on p.id = l.po_id where l.id = sid)
      when 'order_line' then (select o.location_id from public.order_lines l join public.orders o on o.id = l.order_id where l.id = sid)
      when 'return' then (select o.location_id from public.order_returns r2 join public.orders o on o.id = r2.order_id where r2.id = sid)
      when 'job' then (select j.location_id from public.jobs j where j.id = sid)
      else null end;
  end if;
  loc := coalesce(loc, public.default_location());

  -- Tracked item leaving without a named lot: first-expiry-first-out, then the untracked rest.
  if lot is null and p_delta < 0 and s.tracking <> 'none' and current_setting('app.stock_nolot', true) is distinct from 'on' then
    left_qty := -p_delta;
    perform set_config('app.stock_loc', loc::text, true);
    for r in select ll.lot_id, ll.quantity from public.lot_levels ll join public.lots lo on lo.id = ll.lot_id
              where lo.item_id = s.id and ll.location_id = loc and ll.quantity > 0
              order by lo.expiry nulls last, lo.created_at, lo.code loop
      exit when left_qty <= 0;
      take := least(r.quantity, left_qty);
      perform public.stock_lot(r.lot_id);
      perform public.move_stock(p_item, -take, p_reason, p_ref, p_note, p_cost);
      left_qty := left_qty - take;
    end loop;
    perform public.stock_lot(null);
    if left_qty > 0 then
      perform set_config('app.stock_nolot', 'on', true);
      perform public.move_stock(p_item, -left_qty, p_reason, p_ref, p_note, p_cost);
      perform set_config('app.stock_nolot', 'off', true);
    end if;
    perform set_config('app.stock_loc', coalesce(oldloc, ''), true);
    return (select quantity from public.stock_items where id = p_item);
  end if;

  q := s.quantity + p_delta;
  a := case
         when p_cost is null then s.avg_cost
         when p_delta > 0 and q > 0 then round((greatest(s.quantity, 0) * s.avg_cost + p_delta * p_cost) / (greatest(s.quantity, 0) + p_delta), 4)
         when p_delta > 0 then p_cost
         when p_delta < 0 and q > 0 and s.quantity > 0 then greatest(round((s.quantity * s.avg_cost + p_delta * p_cost) / q, 4), 0)
         else s.avg_cost end;
  perform set_config('app.stock_move', 'on', true);
  update public.stock_items set quantity = q, avg_cost = a,
    updated_at = now(), updated_by = coalesce(auth.uid(), updated_by)
  where id = s.id;
  perform set_config('app.stock_move', 'off', true);
  insert into public.stock_levels (item_id, location_id, quantity) values (s.id, loc, p_delta)
  on conflict (item_id, location_id) do update set quantity = stock_levels.quantity + p_delta, updated_at = now();
  if lot is not null then
    insert into public.lot_levels (lot_id, location_id, quantity) values (lot, loc, p_delta)
    on conflict (lot_id, location_id) do update set quantity = lot_levels.quantity + p_delta;
  end if;
  insert into public.stock_movements (item_id, delta, after, reason, ref, note, unit_cost, user_id, job_id, source_type, source_id, location_id, lot_id)
  values (s.id, p_delta, q, p_reason, coalesce(p_ref, ''), coalesce(p_note, ''), coalesce(p_cost, s.avg_cost), auth.uid(),
          nullif(current_setting('app.stock_job', true), '')::uuid, st, sid, loc, lot);
  return q;
end $$;

create or replace function public.ship_lines(p_order uuid, p_lines jsonb default null, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; r jsonb; q numeric; prev text; kind text; cmp record;
begin
  if not (public.is_admin() or public.my_wh_task(array['pick', 'ship'], p_order)) then raise exception 'Only the office team, or whoever is assigned to ship it, can ship orders'; end if;
  prev := public.claim_op('ship_lines', p_key);
  if prev is not null then return prev; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.kind = 'quote' then raise exception 'Quotes are not delivered'; end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled'; end if;
  for l in select * from public.order_lines where order_id = o.id order by sort, created_at for update loop
    if p_lines is null then q := l.quantity - l.shipped;
    else
      select x into r from jsonb_array_elements(p_lines) x where (x->>'line')::uuid = l.id;
      q := coalesce((r->>'qty')::numeric, 0);
    end if;
    continue when q = 0;
    if q < 0 then raise exception 'Ship a positive quantity'; end if;
    if l.shipped + q > l.quantity then
      raise exception '% — only % left to ship', coalesce(nullif(l.name, ''), l.sku), trim_scale(l.quantity - l.shipped);
    end if;
    select si.kind into kind from public.stock_items si where si.id = l.item_id;
    if kind = 'kit' then
      perform public.stock_source('order_line', l.id);
      for cmp in select b.material_id, b.quantity from public.bom_lines b join public.stock_items m on m.id = b.material_id and m.kind <> 'service'
                  where b.product_id = l.item_id order by m.sku loop
        perform public.move_stock(cmp.material_id, -(q * cmp.quantity), 'ship', o.order_number, 'Kit ' || coalesce(nullif(l.sku, ''), l.name));
      end loop;
    elsif l.item_id is not null and kind is distinct from 'service' then
      perform public.stock_source('order_line', l.id);
      perform public.move_stock(l.item_id, -q, 'ship', o.order_number, '');
    end if;
    update public.order_lines set shipped = shipped + q where id = l.id;
  end loop;
  return public.finish_op('ship_lines', p_key, public.order_delivery_after(o.id));
end $$;

create or replace function public.unship_lines(p_order uuid, p_lines jsonb default null, p_key text default null) returns text
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; r jsonb; q numeric; prev text; c numeric; cmp record;
begin
  if not public.is_admin() then raise exception 'Only the office team can change shipments'; end if;
  prev := public.claim_op('unship_lines', p_key);
  if prev is not null then return prev; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  for l in select * from public.order_lines where order_id = o.id order by sort, created_at for update loop
    if p_lines is null then q := l.shipped - l.returned;
    else
      select x into r from jsonb_array_elements(p_lines) x where (x->>'line')::uuid = l.id;
      q := coalesce((r->>'qty')::numeric, 0);
    end if;
    continue when q = 0;
    if q < 0 or q > l.shipped - l.returned then
      raise exception '% — only % shipped and not returned', coalesce(nullif(l.name, ''), l.sku), trim_scale(l.shipped - l.returned);
    end if;
    if (select kind from public.stock_items where id = l.item_id) = 'kit' then
      perform public.stock_source('order_line', l.id);
      for cmp in select item_id, -sum(delta) net,
                        case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end cost
                   from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason in ('ship', 'return')
                  group by item_id having -sum(delta) > 0 loop
        perform public.move_by_source_lots(cmp.item_id, round(cmp.net * q / (l.shipped - l.returned), 3), 'ship', o.order_number, 'Shipment undone', 'order_line', l.id, 'ship', cmp.cost);
      end loop;
      update public.order_lines set shipped = shipped - q where id = l.id;
      continue;
    end if;
    select case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end into c
      from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason = 'ship' and delta < 0;
    if exists (select 1 from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason = 'ship') then
      perform public.stock_source('order_line', l.id);
      perform public.move_by_source_lots(l.item_id, q, 'ship', o.order_number, 'Shipment undone', 'order_line', l.id, 'ship', c);
    end if;
    update public.order_lines set shipped = shipped - q where id = l.id;
  end loop;
  return public.finish_op('unship_lines', p_key, public.order_delivery_after(o.id));
end $$;

create or replace function public.return_lines(p_order uuid, p_lines jsonb, p_reason text default '', p_key text default null) returns int
language plpgsql security definer set search_path = public as $$
declare o public.orders; l public.order_lines; r jsonb; q numeric; prev text; c numeric; n int := 0; rid uuid; kind text; cmp record;
begin
  if not public.is_admin() then raise exception 'Only the office team can book returns'; end if;
  prev := public.claim_op('return_lines', p_key);
  if prev is not null then return prev::int; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into l from public.order_lines where id = (r->>'line')::uuid and order_id = o.id for update;
    if l.id is null then raise exception 'Order line not found'; end if;
    q := coalesce((r->>'qty')::numeric, 0);
    continue when q = 0;
    if q < 0 or q > l.shipped - l.returned then
      raise exception '% — only % can be returned', coalesce(nullif(l.name, ''), l.sku), trim_scale(l.shipped - l.returned);
    end if;
    insert into public.order_returns (order_id, order_line_id, quantity, restock, reason, created_by)
    values (o.id, l.id, q, coalesce((r->>'restock')::boolean, true), coalesce(p_reason, ''), auth.uid()) returning id into rid;
    select si.kind into kind from public.stock_items si where si.id = l.item_id;
    if coalesce((r->>'restock')::boolean, true) and kind = 'kit' then
      for cmp in select item_id, -sum(delta) net,
                        case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end cost
                   from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason in ('ship', 'return')
                  group by item_id having -sum(delta) > 0 loop
        perform public.stock_source('return', rid);
        perform public.move_by_source_lots(cmp.item_id, round(cmp.net * q / (l.shipped - l.returned), 3), 'return', o.order_number, coalesce(nullif(p_reason, ''), 'Customer return'), 'order_line', l.id, 'ship', cmp.cost);
      end loop;
    elsif coalesce((r->>'restock')::boolean, true) and l.item_id is not null and kind is distinct from 'service' then
      select case when bool_or(unit_cost is null) then null else round(sum(delta * unit_cost) / nullif(sum(delta), 0), 4) end into c
        from public.stock_movements where source_type = 'order_line' and source_id = l.id and reason = 'ship' and delta < 0;
      perform public.stock_source('return', rid);
      perform public.move_by_source_lots(l.item_id, q, 'return', o.order_number, coalesce(nullif(p_reason, ''), 'Customer return'), 'order_line', l.id, 'ship', c);
    end if;
    update public.order_lines set returned = returned + q where id = l.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nothing to return'; end if;
  perform public.finish_op('return_lines', p_key, n::text);
  return n;
end $$;

create or replace function public.availability() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d record; e record; need numeric; take numeric; got numeric; exp_qty numeric; exp_date date; exp_src text;
  holders text; tl uuid := public.transit_location(); dl uuid := public.default_location();
  lines jsonb := '{}'; ingr jsonb := '{}'; items jsonb := '{}'; st text; why text; nm text;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  create temp table if not exists av_supply (item_id uuid, location_id uuid, qty numeric, primary key (item_id, location_id)) on commit drop;
  create temp table if not exists av_expected (item_id uuid, location_id uuid, due date, src text, qty numeric, ord int) on commit drop;
  create temp table if not exists av_taken (item_id uuid, location_id uuid, who text, qty numeric, ord int) on commit drop;
  create temp table if not exists av_demand (kind text, ref_id uuid, owner_id uuid, label text, item_id uuid, location_id uuid,
    qty numeric, pegged boolean, rank numeric, due date, created timestamptz) on commit drop;
  truncate av_supply, av_expected, av_taken, av_demand;

  -- in transit and on the production floor (picked for an MO) is not free stock
  insert into av_supply select item_id, location_id, quantity from public.stock_levels
   where location_id not in (select id from public.locations where kind in ('transit', 'wip'));
  insert into av_expected
    select l.item_id, coalesce(p.location_id, dl), p.expected_date, p.number, l.quantity - l.received, 0
      from public.po_lines l join public.purchase_orders p on p.id = l.po_id
     where p.status in ('ordered', 'partial') and l.quantity > l.received
    union all
    select si.id, coalesce(j.location_id, dl), j.due_date, j.code, j.quantity - j.produced, 0
      from public.jobs j join lateral (select id from public.stock_items where sku = j.sku and kind not in ('material', 'service') order by created_at limit 1) si on true
     where j.status <> 'done' and not j.stock_booked and j.sku is not null and coalesce(j.quantity, 0) > j.produced
    union all
    select tl2.item_id, t.to_location, t.expected_date, t.number, tl2.quantity, 0
      from public.transfer_lines tl2 join public.stock_transfers t on t.id = tl2.transfer_id where t.status = 'in_transit';

  -- sales lines (stocked, not yet shipped). MTO lines with a finished MO are pegged to it.
  insert into av_demand
    select 'line', l.id, o.id, o.order_number, l.item_id, coalesce(o.location_id, dl), l.quantity - l.shipped,
           (j.id is not null and j.stock_booked), o.rank, o.delivery_deadline, o.created_at
      from public.order_lines l join public.orders o on o.id = l.order_id
      join public.stock_items si on si.id = l.item_id and si.kind not in ('service', 'kit')
      left join public.jobs j on j.order_line_id = l.id
     where o.kind = 'order' and o.status = 'open' and l.quantity > l.shipped
       and (j.id is null or j.stock_booked);
  insert into av_demand
    select 'line', l.id, o.id, o.order_number, b.material_id, coalesce(o.location_id, dl), (l.quantity - l.shipped) * b.quantity,
           false, o.rank, o.delivery_deadline, o.created_at
      from public.order_lines l join public.orders o on o.id = l.order_id
      join public.stock_items si on si.id = l.item_id and si.kind = 'kit'
      join public.bom_lines b on b.product_id = si.id join public.stock_items m on m.id = b.material_id and m.kind <> 'service'
     where o.kind = 'order' and o.status = 'open' and l.quantity > l.shipped;
  -- ingredients of unfinished MOs
  insert into av_demand
    -- still needed = recipe × (qty − already produced) − what is already picked for this MO
    select 'ingredient', j.id, j.id, j.code, b.material_id, coalesce(j.location_id, dl),
           greatest(b.quantity * (coalesce(j.quantity, 1) - j.produced) - coalesce(mm.picked - mm.used_from_wip - mm.returned, 0), 0),
           false, coalesce(o.rank, j.rank), j.due_date, j.created_at
      from public.jobs j
      join lateral (select id from public.stock_items where sku = j.sku and kind <> 'service' order by (kind = 'material'), created_at limit 1) p on true
      join public.bom_lines b on b.product_id = p.id
      join public.stock_items m on m.id = b.material_id and m.kind <> 'service'
      left join public.mo_materials mm on mm.job_id = j.id and mm.item_id = b.material_id
      left join public.orders o on o.id = j.order_id
     where j.status <> 'done' and not j.stock_booked and j.sku is not null;
  -- materials an outsourced PO needs at the contractor
  insert into av_demand
    select 'ingredient', p.id, p.id, p.number, pm.item_id, p.partner_location_id,
           sum(pm.quantity_per * (l.quantity - l.received)), false, null, p.expected_date, p.created_at
      from public.purchase_orders p join public.po_lines l on l.po_id = p.id
      join public.po_materials pm on pm.po_line_id = l.id
     where p.kind = 'outsourced' and p.status in ('ordered', 'partial') and p.partner_location_id is not null and l.quantity > l.received
     group by p.id, pm.item_id;
  -- draft transfers reserve at their source
  insert into av_demand
    select 'transfer', tl2.id, t.id, t.number, tl2.item_id, t.from_location, tl2.quantity, false,
           extract(epoch from t.created_at), t.expected_date, t.created_at
      from public.transfer_lines tl2 join public.stock_transfers t on t.id = tl2.transfer_id where t.status = 'draft';

  for d in select * from av_demand order by pegged desc, rank nulls last, due nulls last, created, ref_id loop
    need := d.qty;
    select coalesce(qty, 0) into got from av_supply where item_id = d.item_id and location_id = d.location_id;
    got := coalesce(got, 0);
    take := least(greatest(got, 0), need);
    if take > 0 then
      update av_supply set qty = qty - take where item_id = d.item_id and location_id = d.location_id;
      insert into av_taken values (d.item_id, d.location_id, d.label, take, 0);
    end if;
    need := need - take;
    exp_qty := 0; exp_date := null; exp_src := null;
    for e in select ctid, * from av_expected where item_id = d.item_id and location_id = d.location_id and qty > 0
              order by due nulls last, src loop
      exit when need <= 0;
      got := least(e.qty, need);
      update av_expected set qty = qty - got where ctid = e.ctid;
      need := need - got; exp_qty := exp_qty + got; exp_date := e.due;
      exp_src := coalesce(exp_src || ', ', '') || e.src;
    end loop;
    if need > 0 then
      select string_agg(distinct who, ', ') into holders from (select who from av_taken where item_id = d.item_id and location_id = d.location_id and who <> d.label limit 4) h;
      select name into nm from public.locations where id = d.location_id;
      st := 'not_available';
      why := format('%s short at %s', trim_scale(need), nm)
          || case when holders is not null then format(' — on-hand stock is promised to %s (higher priority)', holders) else ' — none on hand or on order' end;
    elsif exp_qty > 0 then
      st := 'expected';
      why := format('%s reserved now, %s expected from %s', trim_scale(take), trim_scale(exp_qty), exp_src);
    else
      st := 'in_stock'; why := format('%s reserved from stock', trim_scale(take));
    end if;
    if d.kind in ('line', 'transfer') then
      if lines ? d.ref_id::text then  -- kit line: keep the worst component
        if (case st when 'not_available' then 3 when 'expected' then 2 else 1 end) >
           (case lines->d.ref_id::text->>'status' when 'not_available' then 3 when 'expected' then 2 else 1 end) then
          lines := lines || jsonb_build_object(d.ref_id::text, jsonb_build_object('status', st, 'reserved', take, 'expected', exp_qty,
            'short', need, 'date', exp_date, 'why', why, 'kind', d.kind));
        end if;
      else
        lines := lines || jsonb_build_object(d.ref_id::text, jsonb_build_object('status', st, 'reserved', take, 'expected', exp_qty,
          'short', need, 'date', exp_date, 'why', why, 'kind', d.kind));
      end if;
    else
      -- an MO is as available as its worst ingredient
      ingr := jsonb_set(ingr, array[d.ref_id::text], jsonb_build_object(
        'status', case when st = 'not_available' or ingr->d.ref_id::text->>'status' = 'not_available' then 'not_available'
                       when st = 'expected' or ingr->d.ref_id::text->>'status' = 'expected' then 'expected' else 'in_stock' end,
        'date', greatest((ingr->d.ref_id::text->>'date')::date, exp_date),
        'short', coalesce(ingr->d.ref_id::text->'short', '[]'::jsonb) || case when need > 0
             then jsonb_build_array(jsonb_build_object('item_id', d.item_id, 'short', need, 'why', why)) else '[]'::jsonb end), true);
    end if;
  end loop;

  select coalesce(jsonb_object_agg(item_id, jsonb_build_object('on_hand', on_hand, 'reserved', reserved, 'available', on_hand - reserved)), '{}') into items
    from (select s.item_id, sum(s.quantity) on_hand, coalesce((select sum(qty) from av_taken t where t.item_id = s.item_id), 0) reserved
            from public.stock_levels s where s.location_id not in (select id from public.locations where kind in ('transit', 'wip')) group by s.item_id) x;
  return jsonb_build_object('lines', lines, 'mos', ingr, 'items', items, 'at', now());
end $$;

create or replace function public.plan_item(p_item uuid, p_location uuid default null, p_weeks int default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it public.stock_items; w0 date := date_trunc('week', current_date)::date; hist jsonb; h jsonb;
  wsum numeric := 0; wtot numeric := 0; i int := 0; rate numeric := 0; first_ship timestamptz; enough boolean;
  opening numeric; bal numeric; weeks jsonb := '[]'; v_wk date; rec numeric; sales numeric; other numeric; fc numeric; fsrc text; use_dem numeric;
  low numeric; low_wk date; reorder numeric; lead int; rqty numeric; batch numeric; act text; loc_name text;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  select * into it from public.stock_items where id = p_item;
  if it.id is null then raise exception 'Item not found'; end if;
  p_weeks := least(greatest(p_weeks, 4), 52);
  -- automatic forecast: weighted average of the last 12 complete weeks (weights 1..12)
  hist := public.demand_history(p_item, p_location, 12);
  for h in select * from jsonb_array_elements(hist) loop
    i := i + 1; wsum := wsum + i * (h->>'qty')::numeric; wtot := wtot + i;
  end loop;
  select min(created_at) into first_ship from public.stock_movements where item_id = p_item and reason = 'ship' and (p_location is null or location_id = p_location);
  enough := first_ship is not null and first_ship <= now() - interval '4 weeks';
  rate := case when enough then round(wsum / nullif(wtot, 0), 3) else 0 end;
  -- opening stock (in transit and the production floor are not free stock)
  select coalesce(sum(quantity), 0) into opening from public.stock_levels sl join public.locations l on l.id = sl.location_id
   where sl.item_id = p_item and l.kind not in ('transit', 'wip') and (p_location is null or sl.location_id = p_location);
  create temp table if not exists pl_flow (wk date, kind text, qty numeric, ref text) on commit drop;
  truncate pl_flow;
  -- receipts
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(p.expected_date, current_date))::date), 'receipt', l.quantity - l.received, p.number
    from public.po_lines l join public.purchase_orders p on p.id = l.po_id
   where l.item_id = p_item and p.status in ('ordered', 'partial') and l.quantity > l.received
     and (p_location is null or coalesce(p.location_id, public.default_location()) = p_location);
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(j.due_date, current_date))::date), 'receipt', coalesce(j.quantity, 1) - j.produced, j.code
    from public.jobs j where j.sku = it.sku and it.kind not in ('material', 'service') and j.status <> 'done' and not j.stock_booked
     and coalesce(j.quantity, 1) > j.produced and (p_location is null or coalesce(j.location_id, public.default_location()) = p_location);
  if p_location is not null then
    insert into pl_flow select greatest(w0, date_trunc('week', coalesce(t.expected_date, current_date))::date), 'receipt', tl.quantity, t.number
      from public.transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
     where tl.item_id = p_item and t.status = 'in_transit' and t.to_location = p_location;
    insert into pl_flow select greatest(w0, date_trunc('week', coalesce(t.expected_date, current_date))::date), 'demand', tl.quantity, t.number
      from public.transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
     where tl.item_id = p_item and t.status = 'draft' and t.from_location = p_location;
  end if;
  -- demand: sales lines, MO ingredients, outsourced-PO materials
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(o.delivery_deadline, current_date))::date), 'sales', l.quantity - l.shipped, o.order_number
    from public.order_lines l join public.orders o on o.id = l.order_id
   where l.item_id = p_item and o.kind = 'order' and o.status = 'open' and l.quantity > l.shipped
     and (p_location is null or coalesce(o.location_id, public.default_location()) = p_location);
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(o.delivery_deadline, current_date))::date), 'sales', (l.quantity - l.shipped) * b.quantity, o.order_number
    from public.order_lines l join public.orders o on o.id = l.order_id
    join public.stock_items k on k.id = l.item_id and k.kind = 'kit' join public.bom_lines b on b.product_id = k.id and b.material_id = p_item
   where o.kind = 'order' and o.status = 'open' and l.quantity > l.shipped
     and (p_location is null or coalesce(o.location_id, public.default_location()) = p_location);
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(j.due_date, current_date))::date), 'demand',
         greatest(b.quantity * (coalesce(j.quantity, 1) - j.produced) - coalesce(mm.picked - mm.used_from_wip - mm.returned, 0), 0), j.code
    from public.jobs j
    join lateral (select id from public.stock_items where sku = j.sku and kind <> 'service' order by (kind = 'material'), created_at limit 1) p on true
    join public.bom_lines b on b.product_id = p.id and b.material_id = p_item
    left join public.mo_materials mm on mm.job_id = j.id and mm.item_id = p_item
   where j.status <> 'done' and not j.stock_booked and (p_location is null or coalesce(j.location_id, public.default_location()) = p_location);
  insert into pl_flow select greatest(w0, date_trunc('week', coalesce(p.expected_date, current_date))::date), 'demand', pm.quantity_per * (l.quantity - l.received), p.number
    from public.po_materials pm join public.po_lines l on l.id = pm.po_line_id join public.purchase_orders p on p.id = l.po_id
   where pm.item_id = p_item and p.kind = 'outsourced' and p.status in ('ordered', 'partial') and l.quantity > l.received
     and (p_location is null or p.partner_location_id = p_location);
  -- walk the weeks
  bal := opening; low := opening; low_wk := null; reorder := coalesce(it.min_quantity, 0);
  for i in 0 .. p_weeks - 1 loop
    v_wk := w0 + 7 * i;
    select coalesce(sum(qty) filter (where kind = 'receipt'), 0), coalesce(sum(qty) filter (where kind = 'sales'), 0), coalesce(sum(qty) filter (where kind = 'demand'), 0)
      into rec, sales, other from pl_flow where pl_flow.wk = v_wk;
    -- forecast: weekly override, else monthly override spread over its days, else automatic
    select quantity into fc from public.forecast_overrides fo where fo.item_id = p_item and fo.period = 'week' and fo.period_start = v_wk
       and fo.location_id is not distinct from p_location;
    if fc is not null then fsrc := 'manual';
    else
      select round(quantity * 7 / extract(day from (period_start + interval '1 month' - interval '1 day')), 3) into fc from public.forecast_overrides fo
       where fo.item_id = p_item and fo.period = 'month' and fo.period_start = date_trunc('month', v_wk + 3)::date and fo.location_id is not distinct from p_location;
      if fc is not null then fsrc := 'manual'; else fc := rate; fsrc := case when enough then 'auto' else 'none' end; end if;
    end if;
    -- the forecast stands for customer sales: booked sales use it up (whichever is larger counts)
    use_dem := greatest(sales, fc) + other;
    bal := bal + rec - use_dem;
    if bal < low or (low_wk is null and bal < reorder) then
      if bal < reorder and low_wk is null then low_wk := v_wk; end if;
      low := least(low, bal);
    end if;
    weeks := weeks || jsonb_build_object('week', v_wk, 'receipts', rec, 'orders', sales, 'other', other, 'forecast', fc, 'forecast_source', fsrc,
      'demand', use_dem, 'closing', round(bal, 3),
      'refs', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'qty', qty, 'ref', ref)), '[]') from pl_flow f where f.wk = v_wk));
  end loop;
  -- recommendation: bring the lowest point back up to the reorder point (rounded to the batch size)
  act := null; rqty := 0;
  if low_wk is not null then
    act := case when exists (select 1 from public.bom_lines where product_id = p_item) then 'make' else 'buy' end;
    batch := greatest(coalesce(nullif(it.make_batch, 0), 1), 1);
    rqty := ceil(greatest(reorder - low, 0.001) / batch) * batch;
    lead := coalesce(it.lead_days, (select default_lead_days from public.company_settings where id = 1), 7);
  end if;
  select name into loc_name from public.locations where id = p_location;
  return jsonb_build_object(
    'item', jsonb_build_object('id', it.id, 'sku', it.sku, 'name', it.name, 'unit', it.unit, 'reorder_point', reorder),
    'location', loc_name, 'opening', opening, 'weeks', weeks, 'history', hist,
    'forecast', jsonb_build_object('weekly', rate, 'enough_history', enough,
      'method', 'Weighted average of the last 12 complete weeks of shipments; the most recent week counts 12×, the oldest 1×. Needs at least 4 weeks of history. Manual overrides replace it for their week or month.'),
    'recommendation', case when act is null then null else jsonb_build_object('action', act, 'quantity', rqty, 'short_week', low_wk,
      'order_by', greatest(current_date, low_wk - lead), 'lead_days', lead, 'lowest', round(low, 3),
      'reason', format('Projected stock falls to %s in the week of %s (reorder point %s)', trim_scale(round(low, 3)), to_char(low_wk, 'DD Mon'), trim_scale(reorder))) end);
end $$;

create or replace function public.report(p_kind text, p_from date, p_to date, p_group text default null, p_location uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c boolean := public.can_see_costs();
  buy boolean := 'buy' = any(public.my_kimera_sections()) or public.can_see_costs();
  t0 timestamptz := p_from::timestamptz; t1 timestamptz := (p_to + 1)::timestamptz;
  rows jsonb; totals jsonb; rate numeric;
begin
  if not public.is_active() then raise exception 'Not signed in'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Pick a valid date range'; end if;
  if 'insights' <> all(public.my_kimera_sections()) then raise exception 'Reports are not open for your role'; end if;

  if p_kind = 'sales' then
    -- revenue is recognised when goods ship (net of undo and returns); services when the order ships
    with s as (
      select m.item_id, o.id order_id, o.customer, coalesce(nullif(o.company, ''), o.customer) cust, date_trunc('month', m.created_at)::date mon,
             -m.delta qty, -m.delta * coalesce(ol.unit_price, 0) rev, -m.delta * m.unit_cost cogs
        from public.stock_movements m join public.order_lines ol on ol.id = m.source_id join public.orders o on o.id = ol.order_id
       where m.source_type = 'order_line' and m.reason in ('ship', 'return') and m.created_at >= t0 and m.created_at < t1
         and m.item_id = ol.item_id and (p_location is null or m.location_id = p_location)
      union all
      -- kits: each component movement is a share of the kit (units and revenue per kit, cost = every component)
      select ol.item_id, o.id, o.customer, coalesce(nullif(o.company, ''), o.customer), date_trunc('month', m.created_at)::date,
             -m.delta / b.quantity / c.n, -m.delta / b.quantity / c.n * coalesce(ol.unit_price, 0), -m.delta * m.unit_cost
        from public.stock_movements m join public.order_lines ol on ol.id = m.source_id join public.orders o on o.id = ol.order_id
        join public.stock_items k on k.id = ol.item_id and k.kind = 'kit'
        join public.bom_lines b on b.product_id = k.id and b.material_id = m.item_id
        join lateral (select count(*) n from public.bom_lines b2 join public.stock_items x on x.id = b2.material_id and x.kind <> 'service' where b2.product_id = k.id) c on true
       where m.source_type = 'order_line' and m.reason in ('ship', 'return') and m.created_at >= t0 and m.created_at < t1
         and (p_location is null or m.location_id = p_location)
      union all
      select ol.item_id, o.id, o.customer, coalesce(nullif(o.company, ''), o.customer), date_trunc('month', o.shipped_at)::date, ol.shipped - ol.returned,
             (ol.shipped - ol.returned) * coalesce(ol.unit_price, 0), 0
        from public.order_lines ol join public.orders o on o.id = ol.order_id join public.stock_items si on si.id = ol.item_id and si.kind = 'service'
       where o.shipped_at >= t0 and o.shipped_at < t1 and p_location is null),
    g as (
      select case coalesce(p_group, 'product') when 'customer' then cust when 'month' then to_char(mon, 'YYYY-MM') else si.sku end as key,
             case coalesce(p_group, 'product') when 'customer' then cust when 'month' then to_char(mon, 'Mon YYYY') else si.name end as label,
             case coalesce(p_group, 'product') when 'product' then si.id::text else null end as item_id,
             sum(qty) qty, sum(rev) revenue, sum(cogs) cogs, count(distinct order_id) orders
        from s left join public.stock_items si on si.id = s.item_id group by 1, 2, 3)
    select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'item_id', item_id, 'qty', qty, 'orders', orders, 'revenue', round(revenue, 2),
             'cost', case when c then round(cogs, 2) end, 'margin', case when c then round(revenue - cogs, 2) end,
             'margin_pct', case when c and revenue <> 0 then round((revenue - cogs) / revenue * 100, 1) end) order by revenue desc, key), '[]'),
           jsonb_build_object('qty', coalesce(sum(qty), 0), 'revenue', round(coalesce(sum(revenue), 0), 2), 'cost', case when c then round(coalesce(sum(cogs), 0), 2) end,
             'margin', case when c then round(coalesce(sum(revenue - cogs), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'inventory' then
    with m as (select item_id, delta, created_at from public.stock_movements where (p_location is null or location_id = p_location)),
    g as (select si.id, si.sku, si.name, si.unit, si.avg_cost,
             coalesce(sum(m.delta) filter (where m.created_at < t0), 0) opening,
             coalesce(sum(m.delta) filter (where m.created_at >= t0 and m.created_at < t1 and m.delta > 0), 0) qin,
             coalesce(sum(m.delta) filter (where m.created_at >= t0 and m.created_at < t1 and m.delta < 0), 0) qout,
             coalesce(sum(m.delta) filter (where m.created_at < t1), 0) closing
        from public.stock_items si left join m on m.item_id = si.id where si.kind <> 'service' and not si.archived group by si.id)
    select coalesce(jsonb_agg(jsonb_build_object('key', sku, 'label', name, 'item_id', id, 'unit', unit, 'opening', opening, 'in', qin, 'out', -qout, 'closing', closing,
             'value', case when c then round(closing * avg_cost, 2) end) order by sku) filter (where opening <> 0 or qin <> 0 or qout <> 0 or closing <> 0), '[]'),
           jsonb_build_object('in', coalesce(sum(qin), 0), 'out', coalesce(-sum(qout), 0), 'value', case when c then round(coalesce(sum(closing * avg_cost), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'purchasing' then
    with p as (select p.*, (select sum(l.quantity * l.unit_cost * p.fx_rate) from public.po_lines l where l.po_id = p.id) ordered_value,
                      (select sum(l.received * l.unit_cost * p.fx_rate) from public.po_lines l where l.po_id = p.id) received_value
                 from public.purchase_orders p where p.ordered_at >= t0 and p.ordered_at < t1 and p.status <> 'cancelled'
                  and (p_location is null or coalesce(p.location_id, public.default_location()) = p_location)),
    g as (select coalesce(s.name, '—') sup, s.id sid, count(*) pos, sum(ordered_value) ordered, sum(received_value) received,
             count(*) filter (where p.status = 'received') done,
             count(*) filter (where p.status = 'received' and p.expected_date is not null and p.received_at::date <= p.expected_date) on_time,
             count(*) filter (where p.status = 'received' and p.expected_date is not null) with_date,
             round(avg(extract(epoch from p.received_at - p.ordered_at) / 86400) filter (where p.status = 'received'), 1) lead_days,
             count(*) filter (where p.kind = 'outsourced') outsourced
        from p left join public.suppliers s on s.id = p.supplier_id group by s.name, s.id)
    select coalesce(jsonb_agg(jsonb_build_object('key', sup, 'label', sup, 'supplier_id', sid, 'pos', pos, 'outsourced', outsourced,
             'ordered', case when buy then round(ordered, 2) end, 'received', case when buy then round(received, 2) end,
             'on_time_pct', case when with_date > 0 then round(on_time * 100.0 / with_date) end, 'lead_days', lead_days) order by ordered desc nulls last), '[]'),
           jsonb_build_object('pos', coalesce(sum(pos), 0), 'ordered', case when buy then round(coalesce(sum(ordered), 0), 2) end, 'received', case when buy then round(coalesce(sum(received), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'manufacturing' then
    select labour_rate into rate from public.company_settings where id = 1;
    with j as (select j.* from public.jobs j where j.status = 'done' and j.completed_at >= t0 and j.completed_at < t1 and j.sku is not null
                  and (p_location is null or coalesce(j.location_id, public.default_location()) = p_location)),
    g as (select j.id, j.code, j.title, j.sku, coalesce(j.quantity, 1) qty, j.completed_at,
             (select coalesce(sum(-m.delta * m.unit_cost), 0) from public.stock_movements m where m.job_id = j.id and m.reason = 'consume') mat,
             (select coalesce(sum(extract(epoch from (coalesce(pa.left_at, j.completed_at) - pa.joined_at)) / 3600), 0) from public.participants pa where pa.job_id = j.id) hours,
             (select coalesce(sum(b.quantity * s.avg_cost), 0) * coalesce(j.quantity, 1) from public.bom_lines b join public.stock_items s on s.id = b.material_id
               where b.product_id = public.mo_product(j.id)) planned
        from j)
    select coalesce(jsonb_agg(jsonb_build_object('key', code, 'label', title, 'job_id', id, 'sku', sku, 'qty', qty, 'done', completed_at, 'hours', round(hours, 2),
             'planned', case when c then round(planned, 2) end, 'materials', case when c then round(mat, 2) end, 'labour', case when c then round(hours * rate, 2) end,
             'total', case when c then round(mat + hours * rate, 2) end, 'unit', case when c then round((mat + hours * rate) / qty, 2) end,
             'variance', case when c then round(mat - planned, 2) end) order by completed_at desc), '[]'),
           jsonb_build_object('mos', count(*), 'qty', coalesce(sum(qty), 0), 'hours', round(coalesce(sum(hours), 0), 2),
             'materials', case when c then round(coalesce(sum(mat), 0), 2) end, 'labour', case when c then round(coalesce(sum(hours * rate), 0), 2) end)
      into rows, totals from g;

  elsif p_kind = 'consumption' then
    with g as (select si.id, si.sku, si.name, si.unit, sum(-m.delta) qty, sum(-m.delta * m.unit_cost) val, count(distinct m.job_id) mos
                 from public.stock_movements m join public.stock_items si on si.id = m.item_id
                where m.reason = 'consume' and m.created_at >= t0 and m.created_at < t1 and (p_location is null or m.location_id = p_location)
                group by si.id having sum(m.delta) <> 0)
    select coalesce(jsonb_agg(jsonb_build_object('key', sku, 'label', name, 'item_id', id, 'unit', unit, 'qty', qty, 'mos', mos,
             'value', case when c then round(val, 2) end) order by val desc nulls last, sku), '[]'),
           jsonb_build_object('value', case when c then round(coalesce(sum(val), 0), 2) end, 'qty', coalesce(sum(qty), 0))
      into rows, totals from g;

  elsif p_kind = 'production' then
    -- person-hours on jobs (clipped to the range), jobs worked, station steps completed
    with h as (select pa.user_id, pa.job_id,
                      extract(epoch from (least(coalesce(pa.left_at, now()), t1) - greatest(pa.joined_at, t0))) / 3600 hrs
                 from public.participants pa where pa.joined_at < t1 and coalesce(pa.left_at, now()) > t0),
    g as (select pr.id, pr.full_name, coalesce(sum(h.hrs), 0) hrs, count(distinct h.job_id) jobs,
             (select count(*) from public.job_steps st where st.completed_by = pr.id and st.completed_at >= t0 and st.completed_at < t1) steps
        from public.profiles pr left join h on h.user_id = pr.id where pr.active or h.user_id is not null group by pr.id)
    select coalesce(jsonb_agg(jsonb_build_object('key', full_name, 'label', full_name, 'user_id', id, 'hours', round(hrs, 2), 'jobs', jobs, 'steps', steps,
             'hours_per_job', case when jobs > 0 then round(hrs / jobs, 2) end) order by hrs desc) filter (where hrs > 0 or steps > 0), '[]'),
           jsonb_build_object('hours', round(coalesce(sum(hrs), 0), 2), 'steps', coalesce(sum(steps), 0),
             'mos_done', (select count(*) from public.jobs where status = 'done' and completed_at >= t0 and completed_at < t1),
             'units_made', (select coalesce(sum(delta), 0) from public.stock_movements where reason = 'produce' and created_at >= t0 and created_at < t1),
             'by_station', (select coalesce(jsonb_agg(jsonb_build_object('station', s.name, 'steps', x.n) order by x.n desc), '[]')
                              from (select station_id, count(*) n from public.job_steps where completed_at >= t0 and completed_at < t1 group by station_id) x
                              left join public.stations s on s.id = x.station_id))
      into rows, totals from g;
  else
    raise exception 'Unknown report';
  end if;
  return jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'group', p_group, 'costs', c, 'rows', rows, 'totals', totals);
end $$;

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
    p_sku := coalesce(nullif(p_sku, ''), nullif(l.sku, '')); p_title := coalesce(nullif(p_title, ''), l.name);
    p_qty := coalesce(p_qty, l.quantity - l.shipped);
    p_due := coalesce(p_due, o.delivery_deadline);
  else
    code := 'STK-' || nextval('public.mo_seq');
  end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Quantity must be more than 0'; end if;
  if exists (select 1 from public.stock_items where sku = p_sku and kind = 'kit') then raise exception 'Kits are not manufactured — their components are shipped together'; end if;
  select * into pr from public.products where sku = p_sku;
  r := case when coalesce(array_length(p_route, 1), 0) > 0 then p_route
            when coalesce(array_length(pr.route, 1), 0) > 0 then pr.route else public.default_route() end;
  insert into public.jobs (code, title, customer, priority, status, assignees, quantity, estimate_minutes, due_date, created_by,
                           order_id, order_line_id, sku, route, stage, station_id, unit_price)
  values (code, coalesce(nullif(p_title, ''), p_sku, 'Manufacturing order'), coalesce(o.customer, ''), 3, 'open', public.station_assignees(r[1]),
          p_qty, pr.estimate_minutes, p_due, auth.uid(), o.id, l.id, nullif(p_sku, ''), r, 0, r[1], l.unit_price)
  returning id into jid;
  return jid;
end $$;

-- ---- updated: MO cost card takes its finish date from mo_schedule()
create or replace function public.mo_costs(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  j public.jobs; prod uuid; qty numeric; cs public.company_settings;
  mat_plan numeric; mat_act numeric; ops jsonb; ops_cost numeric; ops_min numeric; hours numeric; labour numeric;
  left_min numeric; days int; finish date;
begin
  if not public.can_see_costs() then return null; end if;
  select * into j from public.jobs where id = p_job;
  if j.id is null then raise exception 'Manufacturing order not found'; end if;
  select * into cs from public.company_settings where id = 1;
  prod := public.mo_product(j.id);
  qty := coalesce(j.quantity, 1);
  select coalesce(sum(b.quantity * qty * s.avg_cost), 0) into mat_plan
    from public.bom_lines b join public.stock_items s on s.id = b.material_id where b.product_id = prod;
  select coalesce(sum(-delta * coalesce(unit_cost, 0)), 0) into mat_act
    from public.stock_movements where job_id = j.id and reason = 'consume';
  select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(nullif(o.name, ''), st.name, 'Operation'), 'station', st.name,
           'minutes', o.setup_minutes + o.unit_minutes * qty,
           'cost', round((o.setup_minutes + o.unit_minutes * qty) / 60 * coalesce(st.cost_per_hour, 0) + o.fixed_cost, 2)) order by o.sort, o.created_at), '[]'),
         coalesce(sum(round((o.setup_minutes + o.unit_minutes * qty) / 60 * coalesce(st.cost_per_hour, 0) + o.fixed_cost, 2)), 0),
         coalesce(sum(o.setup_minutes + o.unit_minutes * qty), 0)
    into ops, ops_cost, ops_min
    from public.product_operations o left join public.stations st on st.id = o.station_id where o.product_id = prod;
  select coalesce(sum(extract(epoch from (coalesce(p.left_at, now()) - p.joined_at)) / 3600), 0) into hours
    from public.participants p where p.job_id = j.id;
  labour := round(hours * cs.labour_rate, 2);
  -- remaining operation time → working days → estimated finish (MFG-09)
  finish := (public.mo_schedule(j.id)->>'finish')::date;
  return jsonb_build_object(
    'quantity', qty, 'produced', j.produced,
    'materials_planned', round(mat_plan, 2), 'materials_actual', round(mat_act, 2),
    'operations', ops, 'operations_planned', ops_cost, 'minutes_planned', ops_min,
    'labour_hours', round(hours, 2), 'labour_rate', cs.labour_rate, 'labour_actual', labour,
    'total_planned', round(mat_plan + ops_cost, 2), 'total_actual', round(mat_act + labour + (select coalesce(sum(fixed_cost), 0) from public.product_operations where product_id = prod), 2),
    'unit_planned', round((mat_plan + ops_cost) / qty, 4),
    'estimated_finish', finish, 'due', j.due_date, 'late', (j.due_date is not null and finish > j.due_date and j.status <> 'done'));
end $$;

-- Keep last in the file (and re-run after any migration that adds columns to these tables).
select public.apply_cost_privileges();
