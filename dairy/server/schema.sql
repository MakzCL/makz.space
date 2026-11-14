-- Dairy Herd sync server (Supabase / Postgres).
-- Tables live in a private schema that the public API cannot reach.
-- Phones talk to it only through the dairy_* functions below, each of which
-- checks the phone's secret device key (stored here only as a SHA-256 hash).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists dairy;
revoke all on schema dairy from public, anon, authenticated;

create table if not exists dairy.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  topic text not null default encode(extensions.gen_random_bytes(16), 'hex'), -- live-update channel name
  created_at timestamptz not null default now()
);

create table if not exists dairy.devices (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references dairy.farms(id) on delete cascade,
  token_hash text not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_seen timestamptz,
  revoked boolean not null default false
);

create table if not exists dairy.invites (
  code_hash text primary key,
  farm_id uuid not null references dairy.farms(id) on delete cascade,
  created_by uuid references dairy.devices(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references dairy.devices(id) on delete set null
);

create sequence if not exists dairy.change_seq;

-- One row per app record. data is the record as the app stores it.
create table if not exists dairy.records (
  farm_id uuid not null references dairy.farms(id) on delete cascade,
  store text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null,           -- when the phone changed it (conflict clock)
  seq bigint not null default nextval('dairy.change_seq'),  -- server order, for "changes since"
  device_id uuid references dairy.devices(id) on delete set null,
  primary key (farm_id, store, id)
);
create index if not exists records_farm_seq on dairy.records (farm_id, seq);

alter table dairy.farms enable row level security;
alter table dairy.devices enable row level security;
alter table dairy.invites enable row level security;
alter table dairy.records enable row level security;
revoke all on all tables in schema dairy from public, anon, authenticated;

-- ---------- helpers ----------

create or replace function dairy.hash(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

create or replace function dairy.device_for(p_token text) returns dairy.devices
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices;
begin
  select * into d from dairy.devices where token_hash = dairy.hash(p_token) and not revoked;
  if not found then raise exception 'device not recognised' using errcode = '28000'; end if;
  update dairy.devices set last_seen = now() where id = d.id;
  return d;
end $$;

create or replace function dairy.new_device(p_farm uuid, p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex'); dev uuid; f dairy.farms;
begin
  insert into dairy.devices (farm_id, token_hash, label) values (p_farm, dairy.hash(tok), left(coalesce(p_label, ''), 80)) returning id into dev;
  select * into f from dairy.farms where id = p_farm;
  return jsonb_build_object('farm_id', f.id, 'farm_name', f.name, 'topic', f.topic, 'device_id', dev, 'token', tok);
end $$;

-- ---------- API (callable with the public key) ----------

-- Start syncing a farm from this phone. Returns this phone's device key.
create or replace function public.dairy_create_farm(p_name text, p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
  insert into dairy.farms (name) values (left(coalesce(p_name, ''), 120)) returning id into fid;
  return dairy.new_device(fid, p_label);
end $$;

-- One-time code (valid 48 hours) that lets another phone join this farm.
create or replace function public.dairy_create_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token);
        alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        code text := ''; b bytea := extensions.gen_random_bytes(10); i int;
begin
  for i in 0..9 loop code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
  insert into dairy.invites (code_hash, farm_id, created_by, expires_at)
    values (dairy.hash(code), d.farm_id, d.id, now() + interval '48 hours');
  return jsonb_build_object('code', code, 'expires_at', now() + interval '48 hours');
end $$;

create or replace function public.dairy_join(p_code text, p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv dairy.invites; res jsonb;
begin
  select * into inv from dairy.invites
    where code_hash = dairy.hash(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')))
    for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'invite code not valid' using errcode = '28000';
  end if;
  res := dairy.new_device(inv.farm_id, p_label);
  update dairy.invites set used_at = now(), used_by = (res->>'device_id')::uuid where code_hash = inv.code_hash;
  return res;
end $$;

-- Upload changes: [{store, id, data, deleted, updated_at}]. The newest change of a record wins.
create or replace function public.dairy_push(p_token text, p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token); c jsonb; n int := 0;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then
    raise exception 'send at most 500 changes as an array';
  end if;
  for c in select * from jsonb_array_elements(p_changes) loop
    insert into dairy.records as r (farm_id, store, id, data, deleted, updated_at, device_id)
    values (d.farm_id, c->>'store', c->>'id', case when (c->>'deleted')::boolean then null else c->'data' end,
            coalesce((c->>'deleted')::boolean, false), (c->>'updated_at')::timestamptz, d.id)
    on conflict (farm_id, store, id) do update
      set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at,
          device_id = excluded.device_id, seq = nextval('dairy.change_seq')
      where r.updated_at <= excluded.updated_at;
    n := n + 1;
  end loop;
  return jsonb_build_object('accepted', n);
end $$;

-- Download changes made after `p_since` (server order), up to p_limit rows.
create or replace function public.dairy_pull(p_token text, p_since bigint, p_limit int default 1000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token); rows jsonb;
begin
  select coalesce(jsonb_agg(x order by x.seq), '[]'::jsonb) into rows from (
    select store, id, data, deleted, updated_at, seq from dairy.records
    where farm_id = d.farm_id and seq > coalesce(p_since, 0)
    order by seq limit least(greatest(coalesce(p_limit, 1000), 1), 2000)
  ) x;
  return jsonb_build_object('rows', rows,
    'farm_name', (select name from dairy.farms where id = d.farm_id));
end $$;

create or replace function public.dairy_devices(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'created_at', created_at,
    'last_seen', last_seen, 'this', id = d.id) order by created_at), '[]'::jsonb)
    from dairy.devices where farm_id = d.farm_id and not revoked);
end $$;

-- Remove a phone from the farm (lost or replaced phone).
create or replace function public.dairy_revoke_device(p_token text, p_device uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token);
begin
  update dairy.devices set revoked = true where id = p_device and farm_id = d.farm_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dairy_rename_farm(p_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token);
begin
  update dairy.farms set name = left(coalesce(p_name, ''), 120) where id = d.farm_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.dairy_create_farm(text, text), public.dairy_create_invite(text), public.dairy_join(text, text),
  public.dairy_push(text, jsonb), public.dairy_pull(text, bigint, int), public.dairy_devices(text),
  public.dairy_revoke_device(text, uuid), public.dairy_rename_farm(text, text) from public;
grant execute on function public.dairy_create_farm(text, text), public.dairy_create_invite(text), public.dairy_join(text, text),
  public.dairy_push(text, jsonb), public.dairy_pull(text, bigint, int), public.dairy_devices(text),
  public.dairy_revoke_device(text, uuid), public.dairy_rename_farm(text, text) to anon, authenticated;
revoke all on function dairy.hash(text), dairy.device_for(text), dairy.new_device(uuid, text) from public, anon, authenticated;
