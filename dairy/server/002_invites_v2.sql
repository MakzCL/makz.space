-- Invites v2: role, lifetime, number of uses, note; info lookup for the invite page.
-- Applied after schema.sql (migration "dairy_invites_v2").
alter table dairy.invites add column if not exists id uuid not null default gen_random_uuid();
alter table dairy.invites add column if not exists role text not null default 'worker';
alter table dairy.invites add column if not exists max_uses int not null default 1;
alter table dairy.invites add column if not exists uses int not null default 0;
alter table dairy.invites add column if not exists note text not null default '';
alter table dairy.invites add column if not exists created_at timestamptz not null default now();
alter table dairy.invites add column if not exists revoked boolean not null default false;
update dairy.invites set uses = 1 where used_at is not null and uses = 0;

create or replace function dairy.invite_code() returns text language plpgsql set search_path = '' as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code text := ''; b bytea := extensions.gen_random_bytes(10); i int;
begin
  for i in 0..9 loop code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
  return code;
end $$;

create or replace function dairy.clean_code(p text) returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create or replace function public.dairy_create_invite(p_token text, p_role text, p_hours int, p_uses int, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token); code text := dairy.invite_code();
        exp timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 48), 1), 24 * 30));
        role text := case when p_role = 'admin' then 'admin' else 'worker' end;
begin
  insert into dairy.invites (code_hash, farm_id, created_by, expires_at, role, max_uses, note)
    values (dairy.hash(code), d.farm_id, d.id, exp, role, least(greatest(coalesce(p_uses, 1), 1), 50), left(coalesce(p_note, ''), 80));
  return jsonb_build_object('code', code, 'expires_at', exp, 'role', role, 'max_uses', least(greatest(coalesce(p_uses, 1), 1), 50));
end $$;

create or replace function public.dairy_create_invite(p_token text) returns jsonb language sql security definer set search_path = '' as $$
  select public.dairy_create_invite(p_token, 'worker', 48, 1, '')
$$;

create or replace function public.dairy_invite_info(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv dairy.invites; f dairy.farms;
begin
  select * into inv from dairy.invites where code_hash = dairy.hash(dairy.clean_code(p_code));
  if not found or inv.revoked or inv.uses >= inv.max_uses or inv.expires_at < now() then return jsonb_build_object('valid', false); end if;
  select * into f from dairy.farms where id = inv.farm_id;
  return jsonb_build_object('valid', true, 'farm_name', f.name, 'role', inv.role, 'expires_at', inv.expires_at, 'uses_left', inv.max_uses - inv.uses);
end $$;

create or replace function public.dairy_join(p_code text, p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv dairy.invites; res jsonb;
begin
  select * into inv from dairy.invites where code_hash = dairy.hash(dairy.clean_code(p_code)) for update;
  if not found or inv.revoked or inv.uses >= inv.max_uses or inv.expires_at < now() then
    raise exception 'invite code not valid' using errcode = '28000';
  end if;
  res := dairy.new_device(inv.farm_id, p_label);
  update dairy.invites set uses = uses + 1, used_at = now(), used_by = (res->>'device_id')::uuid where code_hash = inv.code_hash;
  return res || jsonb_build_object('role', inv.role);
end $$;

create or replace function public.dairy_invites(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role, 'note', note, 'uses', uses, 'max_uses', max_uses,
      'expires_at', expires_at, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
    from dairy.invites where farm_id = d.farm_id and not revoked and expires_at > now() and uses < max_uses);
end $$;

create or replace function public.dairy_revoke_invite(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d dairy.devices := dairy.device_for(p_token);
begin
  update dairy.invites set revoked = true where id = p_id and farm_id = d.farm_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.dairy_create_invite(text, text, int, int, text), public.dairy_invite_info(text),
  public.dairy_invites(text), public.dairy_revoke_invite(text, uuid) from public;
grant execute on function public.dairy_create_invite(text, text, int, int, text), public.dairy_create_invite(text),
  public.dairy_invite_info(text), public.dairy_join(text, text), public.dairy_invites(text), public.dairy_revoke_invite(text, uuid)
  to anon, authenticated;
revoke all on function dairy.invite_code(), dairy.clean_code(text) from public, anon, authenticated;
