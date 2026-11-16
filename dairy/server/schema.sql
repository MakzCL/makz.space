-- Dairy Herd sync server (Supabase / Postgres): structure, functions and permissions as live on the
-- "dairy-herd" project (2026-11-16). Run once on an empty project (SQL Editor). No farm data here.
-- Tables live in a private schema the public API cannot reach. Phones talk to it only through the dairy_*
-- functions, each of which checks the phone's secret device key (stored here only as a SHA-256 hash).
-- App updates are served from the public storage bucket "dairy-app" (created below).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists dairy;
revoke all on schema dairy from public, anon, authenticated;

create table if not exists dairy.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  topic text not null default encode(extensions.gen_random_bytes(16), 'hex'),
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
  used_by uuid references dairy.devices(id) on delete set null,
  id uuid not null default gen_random_uuid(),
  role text not null default 'worker',
  max_uses integer not null default 1,
  uses integer not null default 0,
  note text not null default '',
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);
create sequence if not exists dairy.change_seq;
create table if not exists dairy.records (
  farm_id uuid not null references dairy.farms(id) on delete cascade,
  store text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null,
  seq bigint not null default nextval('dairy.change_seq'),
  device_id uuid references dairy.devices(id) on delete set null,
  primary key (farm_id, store, id)
);
create index if not exists records_farm_seq on dairy.records (farm_id, seq);
alter table dairy.farms enable row level security;
alter table dairy.devices enable row level security;
alter table dairy.invites enable row level security;
alter table dairy.records enable row level security;
revoke all on all tables in schema dairy from public, anon, authenticated;

-- FUNCTIONS
CREATE OR REPLACE FUNCTION dairy.new_device(p_farm uuid, p_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tok text := encode(extensions.gen_random_bytes(32), 'hex'); dev uuid; f dairy.farms;
begin
  insert into dairy.devices (farm_id, token_hash, label) values (p_farm, dairy.hash(tok), left(coalesce(p_label, ''), 80)) returning id into dev;
  select * into f from dairy.farms where id = p_farm;
  return jsonb_build_object('farm_id', f.id, 'farm_name', f.name, 'topic', f.topic, 'device_id', dev, 'token', tok);
end $function$
;
CREATE OR REPLACE FUNCTION dairy.clean_code(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$function$
;
CREATE OR REPLACE FUNCTION dairy.device_for(p_token text)
 RETURNS dairy.devices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices;
begin
  select * into d from dairy.devices where token_hash = dairy.hash(p_token) and not revoked;
  if not found then raise exception 'device not recognised' using errcode = '28000'; end if;
  update dairy.devices set last_seen = now() where id = d.id;
  return d;
end $function$
;
CREATE OR REPLACE FUNCTION dairy.hash(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$function$
;
CREATE OR REPLACE FUNCTION dairy.invite_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text := ''; b bytea := extensions.gen_random_bytes(10); i int;
begin
  for i in 0..9 loop code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
  return code;
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_create_invite(p_token text, p_role text, p_hours integer, p_uses integer, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices := dairy.device_for(p_token); code text := dairy.invite_code();
        exp timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 48), 1), 24 * 30));
        role text := case when p_role = 'admin' then 'admin' else 'worker' end;
begin
  insert into dairy.invites (code_hash, farm_id, created_by, expires_at, role, max_uses, note)
    values (dairy.hash(code), d.farm_id, d.id, exp, role, least(greatest(coalesce(p_uses, 1), 1), 50), left(coalesce(p_note, ''), 80));
  return jsonb_build_object('code', code, 'expires_at', exp, 'role', role, 'max_uses', least(greatest(coalesce(p_uses, 1), 1), 50));
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_pull(p_token text, p_since bigint, p_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices := dairy.device_for(p_token); rows jsonb;
begin
  select coalesce(jsonb_agg(x order by x.seq), '[]'::jsonb) into rows from (
    select store, id, data, deleted, updated_at, seq from dairy.records
    where farm_id = d.farm_id and seq > coalesce(p_since, 0)
    order by seq limit least(greatest(coalesce(p_limit, 1000), 1), 2000)
  ) x;
  return jsonb_build_object('rows', rows,
    'farm_name', (select name from dairy.farms where id = d.farm_id));
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_create_farm(p_name text, p_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare fid uuid;
begin
  insert into dairy.farms (name) values (left(coalesce(p_name, ''), 120)) returning id into fid;
  return dairy.new_device(fid, p_label);
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_join(p_code text, p_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv dairy.invites; res jsonb;
begin
  select * into inv from dairy.invites where code_hash = dairy.hash(dairy.clean_code(p_code)) for update;
  if not found or inv.revoked or inv.uses >= inv.max_uses or inv.expires_at < now() then
    raise exception 'invite code not valid' using errcode = '28000';
  end if;
  res := dairy.new_device(inv.farm_id, p_label);
  update dairy.invites set uses = uses + 1, used_at = now(), used_by = (res->>'device_id')::uuid where code_hash = inv.code_hash;
  return res || jsonb_build_object('role', inv.role);
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_push(p_token text, p_changes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_rename_farm(p_token text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices := dairy.device_for(p_token);
begin
  update dairy.farms set name = left(coalesce(p_name, ''), 120) where id = d.farm_id;
  return jsonb_build_object('ok', true);
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_revoke_device(p_token text, p_device uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices := dairy.device_for(p_token);
begin
  update dairy.devices set revoked = true where id = p_device and farm_id = d.farm_id;
  return jsonb_build_object('ok', true);
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_revoke_invite(p_token text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices := dairy.device_for(p_token);
begin
  update dairy.invites set revoked = true where id = p_id and farm_id = d.farm_id;
  return jsonb_build_object('ok', true);
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_create_invite(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.dairy_create_invite(p_token, 'worker', 48, 1, '')
$function$
;
CREATE OR REPLACE FUNCTION public.dairy_devices(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices := dairy.device_for(p_token);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'created_at', created_at,
    'last_seen', last_seen, 'this', id = d.id) order by created_at), '[]'::jsonb)
    from dairy.devices where farm_id = d.farm_id and not revoked);
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_invite_info(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv dairy.invites; f dairy.farms;
begin
  select * into inv from dairy.invites where code_hash = dairy.hash(dairy.clean_code(p_code));
  if not found or inv.revoked or inv.uses >= inv.max_uses or inv.expires_at < now() then
    return jsonb_build_object('valid', false);
  end if;
  select * into f from dairy.farms where id = inv.farm_id;
  return jsonb_build_object('valid', true, 'farm_name', f.name, 'role', inv.role, 'expires_at', inv.expires_at,
    'uses_left', inv.max_uses - inv.uses);
end $function$
;
CREATE OR REPLACE FUNCTION public.dairy_invites(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d dairy.devices := dairy.device_for(p_token);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role, 'note', note, 'uses', uses, 'max_uses', max_uses,
      'expires_at', expires_at, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
    from dairy.invites where farm_id = d.farm_id and not revoked and expires_at > now() and uses < max_uses);
end $function$
;
-- GRANTS
revoke all on function public.dairy_invites(p_token text) from public;
grant execute on function public.dairy_invites(p_token text) to anon, authenticated;
revoke all on function public.dairy_create_invite(p_token text, p_role text, p_hours integer, p_uses integer, p_note text) from public;
grant execute on function public.dairy_create_invite(p_token text, p_role text, p_hours integer, p_uses integer, p_note text) to anon, authenticated;
revoke all on function public.dairy_invite_info(p_code text) from public;
grant execute on function public.dairy_invite_info(p_code text) to anon, authenticated;
revoke all on function public.dairy_revoke_invite(p_token text, p_id uuid) from public;
grant execute on function public.dairy_revoke_invite(p_token text, p_id uuid) to anon, authenticated;
revoke all on function dairy.clean_code(p text) from public;
revoke all on function dairy.clean_code(p text) from anon, authenticated;
revoke all on function public.dairy_pull(p_token text, p_since bigint, p_limit integer) from public;
grant execute on function public.dairy_pull(p_token text, p_since bigint, p_limit integer) to anon, authenticated;
revoke all on function public.dairy_create_farm(p_name text, p_label text) from public;
grant execute on function public.dairy_create_farm(p_name text, p_label text) to anon, authenticated;
revoke all on function public.dairy_devices(p_token text) from public;
grant execute on function public.dairy_devices(p_token text) to anon, authenticated;
revoke all on function public.dairy_create_invite(p_token text) from public;
grant execute on function public.dairy_create_invite(p_token text) to anon, authenticated;
revoke all on function public.dairy_join(p_code text, p_label text) from public;
grant execute on function public.dairy_join(p_code text, p_label text) to anon, authenticated;
revoke all on function dairy.hash(p text) from public;
revoke all on function dairy.hash(p text) from anon, authenticated;
revoke all on function public.dairy_push(p_token text, p_changes jsonb) from public;
grant execute on function public.dairy_push(p_token text, p_changes jsonb) to anon, authenticated;
revoke all on function public.dairy_revoke_device(p_token text, p_device uuid) from public;
grant execute on function public.dairy_revoke_device(p_token text, p_device uuid) to anon, authenticated;
revoke all on function public.dairy_rename_farm(p_token text, p_name text) from public;
grant execute on function public.dairy_rename_farm(p_token text, p_name text) to anon, authenticated;
revoke all on function dairy.device_for(p_token text) from public;
revoke all on function dairy.device_for(p_token text) from anon, authenticated;
revoke all on function dairy.new_device(p_farm uuid, p_label text) from public;
revoke all on function dairy.new_device(p_farm uuid, p_label text) from anon, authenticated;
revoke all on function dairy.invite_code() from public;
revoke all on function dairy.invite_code() from anon, authenticated;

-- Public bucket for APK updates (releases/latest.json, releases/DairyHerd-*.apk).
insert into storage.buckets (id, name, public) values ('dairy-app', 'dairy-app', true) on conflict (id) do nothing;
