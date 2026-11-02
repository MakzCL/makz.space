-- =========================================================================
-- Skalarki Electronics — Factory app schema
-- Run once in Supabase → SQL Editor (or `psql -f schema.sql`).
--
-- Roles (gateways): boss · manager · office · assistant · operator
-- The FIRST account that signs up becomes the boss; everyone after that
-- starts as an operator and the boss promotes them from the Team screen.
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

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('boss','manager','office'), false)
$$;

-- New auth user → profile. First person in is the boss.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first boolean;
begin
  select not exists (select 1 from public.profiles) into first;
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    case when first then 'boss'::public.staff_role else 'operator'::public.staff_role end
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
  if auth.uid() is null then return new; end if;
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
create policy "stock keepers write" on public.stock_items for all to authenticated
  using (public.my_role() in ('boss','manager','office','assistant'))
  with check (public.my_role() in ('boss','manager','office','assistant'));

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

-- ------------------------------------------------------------- realtime ---
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','shifts','breaks','jobs','work_sessions','participants',
                             'invites','issues','stock_items','absences','announcements'] loop
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
