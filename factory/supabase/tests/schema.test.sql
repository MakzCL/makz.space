-- Run: createdb t && psql -d t -f ../../../supabase/tests/00-supabase-stub.sql -f ../schema.sql -f schema.test.sql
\set ON_ERROR_STOP 1
set client_min_messages = notice;
-- Supabase lets API roles call auth.uid(); the stub does not by default.
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function pg_temp.become(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  if u is null then reset role; else set role authenticated; end if;
end $$;

create or replace function pg_temp.expect_fail(q text, what text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'ok  · denied: % (%)', what, sqlerrm; return; end;
  raise exception 'FAIL · should have been denied: %', what;
end $$;

create or replace function pg_temp.check(cond boolean, what text) returns void language plpgsql as $$
begin
  if not cond then raise exception 'FAIL · %', what; end if;
  raise notice 'ok  · %', what;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000b', 'boss@x.test', '{"full_name":"Bo Boss"}'),
  ('00000000-0000-0000-0000-0000000000a1', 'op1@x.test',  '{"full_name":"Olly One"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'op2@x.test',  '{"full_name":"Tess Two"}');

select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'boss', 'first account becomes boss');
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 'operator', 'later accounts start as operator');
select pg_temp.check((select count(distinct employee_code) from public.profiles) = 3, 'unique employee codes');

-- Operator 1
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$update public.profiles set role = 'boss' where id = auth.uid()$$, 'operator promotes self');
update public.profiles set full_name = 'Olly Uno' where id = auth.uid();
select pg_temp.check((select full_name from public.profiles where id = auth.uid()) = 'Olly Uno', 'operator edits own name');
update public.profiles set full_name = 'Hacked' where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.check((select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a2') = 'Tess Two', 'operator cannot edit others');
insert into public.shifts (user_id) values (auth.uid());
select pg_temp.expect_fail($$insert into public.shifts (user_id) values ('00000000-0000-0000-0000-0000000000a2')$$, 'clock in someone else');
select pg_temp.expect_fail($$insert into public.jobs (code, title) values ('SK-1','x')$$, 'operator creates job');
select pg_temp.expect_fail($$insert into public.stock_items (sku, name) values ('A','a')$$, 'operator adds stock');
insert into public.absences (user_id, kind, start_date, end_date) values (auth.uid(), 'holiday', current_date, current_date + 2);

-- Boss creates a job for operator 1 and promotes op2 to assistant
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
insert into public.jobs (id, code, title, assignees) values
  ('10000000-0000-0000-0000-000000000001', 'SK-1', 'Board', array['00000000-0000-0000-0000-0000000000a1']::uuid[]);
select pg_temp.check((select count(*) from public.absences) = 1, 'boss sees absence requests');
select pg_temp.check((select count(*) from public.shifts) = 1, 'boss sees all shifts');

-- Operator 1 starts the job and invites operator 2
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
insert into public.work_sessions (id, job_id, started_by) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', auth.uid());
insert into public.participants (session_id, job_id, user_id) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', auth.uid());
update public.jobs set status = 'in_progress' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.check((select status from public.jobs where code = 'SK-1') = 'in_progress', 'assignee updates job status');

-- Operator 2 cannot gatecrash before being invited
select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
select pg_temp.expect_fail($$insert into public.participants (session_id, job_id, user_id) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', auth.uid())$$, 'join session without invite');
select pg_temp.expect_fail($$insert into public.work_sessions (job_id, started_by) values ('10000000-0000-0000-0000-000000000001', auth.uid())$$, 'start a job you are not on');
select pg_temp.check((select count(*) from public.shifts) = 1, 'op2 sees who is on shift (presence)');
select pg_temp.check((select count(*) from public.absences) = 0, 'op2 cannot see op1 absences');

select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
insert into public.invites (id, session_id, job_id, from_user, to_user) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', auth.uid(), '00000000-0000-0000-0000-0000000000a2');

select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
insert into public.shifts (user_id) values (auth.uid());
insert into public.participants (session_id, job_id, user_id) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', auth.uid());
update public.invites set status = 'accepted' where id = '30000000-0000-0000-0000-000000000001';
update public.jobs set assignees = assignees || auth.uid() where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.participants where session_id = '20000000-0000-0000-0000-000000000001') = 2, 'invited helper joins the crew');
select pg_temp.check((select cardinality(assignees) from public.jobs where code = 'SK-1') = 2, 'helper added to job');

-- Finish: helper closes everyone out, job done
update public.participants set left_at = now() where session_id = '20000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.participants where left_at is not null) = 2, 'crew member can close the session for all');
update public.work_sessions set ended_at = now() where id = '20000000-0000-0000-0000-000000000001';
update public.jobs set status = 'done', completed_at = now() where id = '10000000-0000-0000-0000-000000000001';

-- Boss: role changes, stock, news
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
update public.profiles set role = 'assistant' where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a2') = 'assistant', 'boss changes roles');
insert into public.announcements (author_id, body) values (auth.uid(), 'hello');

select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
insert into public.stock_items (sku, name, quantity) values ('RES-1', 'Resistor', 10);
select pg_temp.check((select count(*) from public.stock_items) = 1, 'assistant manages stock');
select pg_temp.expect_fail($$insert into public.announcements (author_id, body) values (auth.uid(), 'spam')$$, 'assistant posts news');
select pg_temp.check((select count(*) from public.shifts where user_id <> auth.uid() and clock_out is not null) = 0, 'no access to others'' shift history');

select pg_temp.become(null);
select pg_temp.check((select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) = 0, 'every table has RLS');
delete from auth.users;
select pg_temp.check((select count(*) from public.profiles) + (select count(*) from public.shifts) + (select count(*) from public.participants) = 0, 'deleting users cascades');
\echo ALL SCHEMA TESTS PASSED
