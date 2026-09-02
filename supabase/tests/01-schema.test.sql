\set ON_ERROR_STOP on
\pset pager off
\t on

-- ============================================================
-- 1. PROVISIONING: creating an auth user must create a profile,
--    preferences and an activity row, with a derived unique handle.
-- ============================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'karol@example.com',
   '{"username":"karol","display_name":"Karol Kuklinski"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com',
   '{"username":"karol"}'::jsonb),                       -- collides on purpose
  ('33333333-3333-3333-3333-333333333333', 'plain@example.com', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'x@example.com',
   '{"username":"AB"}'::jsonb);                          -- too short on purpose

select 'provisioned profiles = ' || count(*)::text from public.profiles;
select 'provisioned preferences = ' || count(*)::text from public.preferences;
select 'account.created events = ' || count(*)::text from public.activity where kind = 'account.created';
select 'handles: ' || string_agg(username::text, ', ' order by username) from public.profiles;
select 'appearance default = ' || appearance::text from public.preferences limit 1;

-- ============================================================
-- 2. CONSTRAINTS
-- ============================================================
do $$ begin
  begin
    insert into public.profiles (id, username) values (gen_random_uuid(), 'AB');
    raise exception 'FAIL: short/invalid handle was accepted';
  exception when check_violation then raise notice 'ok: invalid handle rejected';
  when foreign_key_violation then raise notice 'ok: handle rejected (fk first)';
  end;
  begin
    update public.profiles set website = 'ftp://nope' where username = 'karol';
    raise exception 'FAIL: non-http website accepted';
  exception when check_violation then raise notice 'ok: bad website rejected';
  end;
  begin
    insert into public.saved_items (user_id, item_type, item_slug, item_title, item_href)
    values ('11111111-1111-1111-1111-111111111111', 'work', 'x', 'X', 'https://evil');
    raise exception 'FAIL: absolute href accepted into saved_items';
  exception when check_violation then raise notice 'ok: non-relative href rejected';
  end;
end $$;

-- ============================================================
-- 3. RLS — read isolation
-- ============================================================
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set request.jwt.claim.role = 'authenticated';

insert into public.saved_items (user_id, item_type, item_slug, item_title, item_href)
values ('11111111-1111-1111-1111-111111111111', 'work', 'makzmc', 'MAKZMC', '/work/makzmc');

select 'karol sees own saved = ' || count(*)::text from public.saved_items;

-- become the other account
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'other sees karol saved = ' || count(*)::text from public.saved_items;
select 'other sees own preferences only = ' || count(*)::text from public.preferences;

-- ============================================================
-- 4. RLS — write isolation
-- ============================================================
do $$ begin
  begin
    insert into public.saved_items (user_id, item_type, item_slug, item_title, item_href)
    values ('11111111-1111-1111-1111-111111111111', 'work', 'stolen', 'S', '/x');
    raise exception 'FAIL: wrote a saved item onto another account';
  exception when insufficient_privilege then raise notice 'ok: cross-account insert denied';
  end;

  update public.profiles set bio = 'hacked' where id = '11111111-1111-1111-1111-111111111111';
  if found then raise exception 'FAIL: edited another account profile'; end if;
  raise notice 'ok: cross-account profile update matched no rows';

  update public.preferences set appearance = 'day'
    where user_id = '11111111-1111-1111-1111-111111111111';
  if found then raise exception 'FAIL: edited another account preferences'; end if;
  raise notice 'ok: cross-account preferences update matched no rows';

  delete from public.saved_items where user_id = '11111111-1111-1111-1111-111111111111';
  if found then raise exception 'FAIL: deleted another account saved item'; end if;
  raise notice 'ok: cross-account delete matched no rows';
end $$;

-- ============================================================
-- 5. Column guard — an account must not escalate its own role
-- ============================================================
update public.profiles set role = 'admin', bio = 'mine'
  where id = '22222222-2222-2222-2222-222222222222';
select 'self role after escalation attempt = ' || role::text
  from public.profiles where id = '22222222-2222-2222-2222-222222222222';
select 'own bio did save = ' || coalesce(bio, 'null')
  from public.profiles where id = '22222222-2222-2222-2222-222222222222';

-- ============================================================
-- 6. Profile visibility
-- ============================================================
reset role;
update public.profiles set profile_visibility = 'private'
  where id = '11111111-1111-1111-1111-111111111111';

set role anon;
set request.jwt.claim.sub = '';
set request.jwt.claim.role = 'anon';
select 'anon sees public profiles = ' || count(*)::text from public.profiles;
select 'anon sees the private one = ' || count(*)::text from public.profiles
  where id = '11111111-1111-1111-1111-111111111111';
select 'anon sees any preferences = ' || count(*)::text from public.preferences;
select 'anon sees any saved items = ' || count(*)::text from public.saved_items;

-- ============================================================
-- 7. Activity visibility follows the profile + the opt-out
-- ============================================================
reset role;
update public.preferences set show_activity = false
  where user_id = '33333333-3333-3333-3333-333333333333';
set role anon;
select 'anon sees activity of opted-out account = ' || count(*)::text
  from public.activity where user_id = '33333333-3333-3333-3333-333333333333';
select 'anon sees activity of a normal public account = ' || count(*)::text
  from public.activity where user_id = '44444444-4444-4444-4444-444444444444';

-- ============================================================
-- 8. Handle availability helper leaks only a boolean
-- ============================================================
select 'available(karol) = ' || public.username_available('karol')::text;
select 'available(brandnew) = ' || public.username_available('brandnew')::text;
select 'available(KAROL) case-insensitive = ' || public.username_available('KAROL')::text;

-- ============================================================
-- 9. Cascade — deleting the auth user removes everything
-- ============================================================
reset role;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select 'rows left for deleted account = ' ||
  ( (select count(*) from public.profiles    where id = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.preferences where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.saved_items where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.activity    where user_id = '11111111-1111-1111-1111-111111111111')
  )::text;

-- ============================================================
-- 10. RLS is actually enabled everywhere
-- ============================================================
select 'tables without RLS = ' || coalesce(string_agg(relname, ', '), 'none')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

select 'policy count = ' || count(*)::text from pg_policies where schemaname = 'public';
