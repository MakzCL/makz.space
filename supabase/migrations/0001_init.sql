-- =========================================================================
-- MAKZ — initial schema
-- Profiles, preferences, saved records and activity, with row level
-- security on every table. Run against a fresh Supabase project:
--   supabase db push        (CLI)
--   or paste into the SQL editor.
-- =========================================================================

-- Both live in the `extensions` schema, per Supabase convention. Every use
-- below is schema-qualified rather than relying on the search_path, so the
-- migration applies identically through the CLI, the SQL editor and a plain
-- psql session.
create extension if not exists "citext" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;

-- ---- ENUMS --------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('member', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.profile_visibility as enum ('public', 'private');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.appearance_mode as enum ('system', 'dark', 'day');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.motion_mode as enum ('full', 'reduced');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.saved_item_type as enum ('work', 'frame', 'game', 'stream');
exception when duplicate_object then null; end $$;

-- ---- PROFILES -----------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           extensions.citext not null unique
                       check (username ~ '^[a-z0-9](?:[a-z0-9_-]{1,22}[a-z0-9])$'),
  display_name       text check (char_length(display_name) <= 60),
  avatar_url         text check (avatar_url is null or avatar_url ~* '^https://'),
  bio                text check (char_length(bio) <= 400),
  location           text check (char_length(location) <= 80),
  website            text check (website is null or website ~* '^https?://'),
  role               public.user_role not null default 'member',
  profile_visibility public.profile_visibility not null default 'public',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_seen_at       timestamptz
);

comment on table public.profiles is 'Public identity for an account. One row per auth user.';

create index if not exists profiles_username_idx on public.profiles (username);
create index if not exists profiles_visibility_idx
  on public.profiles (profile_visibility)
  where profile_visibility = 'public';

-- ---- PREFERENCES --------------------------------------------------------
create table if not exists public.preferences (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  appearance    public.appearance_mode not null default 'dark',
  motion        public.motion_mode not null default 'full',
  show_activity boolean not null default true,
  email_updates boolean not null default false,
  updated_at    timestamptz not null default now()
);

comment on table public.preferences is 'Per-account environment settings. Private to the owner.';

-- ---- SAVED ITEMS --------------------------------------------------------
create table if not exists public.saved_items (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  item_type  public.saved_item_type not null,
  item_slug  text not null check (char_length(item_slug) between 1 and 120),
  item_title text not null check (char_length(item_title) between 1 and 200),
  item_href  text not null check (item_href ~ '^/'),
  created_at timestamptz not null default now(),
  constraint saved_items_unique unique (user_id, item_type, item_slug)
);

comment on table public.saved_items is 'Records an account has kept. Private to the owner.';

create index if not exists saved_items_user_created_idx
  on public.saved_items (user_id, created_at desc);

-- ---- ACTIVITY -----------------------------------------------------------
create table if not exists public.activity (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (char_length(kind) between 1 and 60),
  subject    text check (char_length(subject) <= 200),
  metadata   jsonb,
  created_at timestamptz not null default now()
);

comment on table public.activity is 'Append-only account event log surfaced on profiles.';

create index if not exists activity_user_created_idx
  on public.activity (user_id, created_at desc);

-- =========================================================================
-- TRIGGERS
-- =========================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists preferences_touch on public.preferences;
create trigger preferences_touch
  before update on public.preferences
  for each row execute function public.touch_updated_at();

-- Guard columns an account must not be able to escalate on itself.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    new.id := old.id;
    new.role := old.role;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Provision a profile and preferences the moment an account is created.
-- Username comes from sign-up metadata; falls back to a derived, unique slug.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  requested text;
  candidate text;
  suffix    int := 0;
begin
  requested := lower(coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(new.email, '@', 1),
    'member'
  ));
  requested := regexp_replace(requested, '[^a-z0-9_-]', '', 'g');
  requested := left(requested, 20);
  if char_length(requested) < 3 then
    requested := 'member' || left(replace(new.id::text, '-', ''), 6);
  end if;

  candidate := requested;
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    suffix := suffix + 1;
    candidate := left(requested, 20 - char_length(suffix::text)) || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    nullif(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;

  insert into public.preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.activity (user_id, kind, subject)
  values (new.id, 'account.created', candidate);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- VISIBILITY HELPER
--
-- Answers "may anyone read this account's activity?" without exposing the
-- preferences row the answer is derived from. Definer, so it can see past
-- row level security; stable and boolean-valued, so it cannot be used to
-- read anything else.
-- =========================================================================

create or replace function public.activity_is_public(account uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    join public.preferences q on q.user_id = p.id
    where p.id = account
      and p.profile_visibility = 'public'
      and q.show_activity
  );
$$;

revoke all on function public.activity_is_public(uuid) from public;
grant execute on function public.activity_is_public(uuid) to anon, authenticated;

-- =========================================================================
-- ROW LEVEL SECURITY
-- =========================================================================

alter table public.profiles    enable row level security;
alter table public.preferences enable row level security;
alter table public.saved_items enable row level security;
alter table public.activity    enable row level security;

-- PROFILES ---------------------------------------------------------------
drop policy if exists "profiles are readable when public or own" on public.profiles;
create policy "profiles are readable when public or own"
  on public.profiles for select
  using (profile_visibility = 'public' or id = (select auth.uid()));

drop policy if exists "an account may create only its own profile" on public.profiles;
create policy "an account may create only its own profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "an account may update only its own profile" on public.profiles;
create policy "an account may update only its own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No delete policy: profiles are removed by cascading the auth user.

-- PREFERENCES ------------------------------------------------------------
drop policy if exists "preferences are private" on public.preferences;
create policy "preferences are private"
  on public.preferences for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "an account may create its own preferences" on public.preferences;
create policy "an account may create its own preferences"
  on public.preferences for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "an account may update its own preferences" on public.preferences;
create policy "an account may update its own preferences"
  on public.preferences for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- SAVED ITEMS ------------------------------------------------------------
drop policy if exists "saved items are private" on public.saved_items;
create policy "saved items are private"
  on public.saved_items for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "an account may save for itself" on public.saved_items;
create policy "an account may save for itself"
  on public.saved_items for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "an account may unsave its own items" on public.saved_items;
create policy "an account may unsave its own items"
  on public.saved_items for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ACTIVITY ---------------------------------------------------------------
-- Readable by the owner, and by anyone when the owner's profile is public
-- and they have not switched activity off.
--
-- That second condition depends on `preferences`, which is private — so a
-- policy that reads it inline would evaluate to false for every reader but
-- the owner, silently hiding all public activity. It is answered instead by
-- a definer function that returns nothing but a boolean about one account.
drop policy if exists "activity follows profile visibility" on public.activity;
create policy "activity follows profile visibility"
  on public.activity for select
  using (
    user_id = (select auth.uid())
    or public.activity_is_public(activity.user_id)
  );

drop policy if exists "an account may log its own activity" on public.activity;
create policy "an account may log its own activity"
  on public.activity for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- =========================================================================
-- HELPERS
-- =========================================================================

-- Availability check for the sign-up and settings forms. Runs as definer so
-- it can see private profiles without leaking anything but a boolean.
create or replace function public.username_available(candidate extensions.citext)
returns boolean
language sql
security definer
-- `extensions` must be on the path or the citext `=` operator is not found
-- and the comparison silently degrades to a case-sensitive text match, which
-- would report a taken handle as available.
set search_path = public, extensions
stable
as $$
  select not exists (select 1 from public.profiles where username = candidate);
$$;

revoke all on function public.username_available(extensions.citext) from public;
grant execute on function public.username_available(extensions.citext) to anon, authenticated;

-- Cheap presence write used by the shell.
create or replace function public.touch_last_seen()
returns void
language sql
security invoker
as $$
  update public.profiles
     set last_seen_at = now()
   where id = (select auth.uid());
$$;

grant execute on function public.touch_last_seen() to authenticated;
