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

select pg_temp.check((select count(*) from public.profiles where role = 'operator' and not active) = 3, 'every sign-up starts as a pending operator (no automatic boss)');
select pg_temp.check((select count(distinct employee_code) from public.profiles) = 3, 'unique employee codes');

-- Bootstrap: a boss link made in the SQL editor turns the owner into the boss
insert into public.join_links (code, pin, role, expires_at, max_uses)
  values ('BOSSBOOT', public.join_pin(), 'boss', now() + interval '1 day', 1);
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(public.redeem_join_link('BOSSBOOT', '101010') = 'ok', 'owner redeems the bootstrap boss link');
select pg_temp.check((select active and role = 'boss' from public.profiles where id = auth.uid()), 'owner is now an active boss');
select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
select pg_temp.check(public.redeem_join_link('BOSSBOOT', '101010') = 'invalid', 'single-use boss link cannot be reused');

-- Pending accounts: no access until they join with link + PIN
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((select count(*) from public.profiles) = 1, 'pending account sees only itself');
select pg_temp.expect_fail($$insert into public.shifts (user_id) values (auth.uid())$$, 'pending account clocks in');
select pg_temp.expect_fail($$update public.profiles set active = true where id = auth.uid()$$, 'pending account activates itself');
select pg_temp.expect_fail($$select public.create_join_link('operator', '1111', 24, null)$$, 'pending account creates a link');

select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select code as link from public.create_join_link('operator', '4321', 24, 5) \gset
select code as bosslink from public.create_join_link('manager', '', 24, 1) \gset
select pg_temp.check((select count(*) from public.join_links where created_by = auth.uid()) = 2, 'boss creates invite links');
select pg_temp.check((select count(distinct code) from public.join_links) = 3, 'every link is unique');
select pg_temp.check((select bool_and(pin = '101010') from public.join_links), 'every link uses the team PIN 101010');

select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((select valid and role = 'operator' and inviter = 'Bo' from public.join_link_info(:'link')), 'link info is public and minimal');
select pg_temp.check(not public.check_join_pin(:'link', '0000'), 'wrong PIN rejected');
select pg_temp.check(public.redeem_join_link(:'link', '0000') = 'wrong_pin', 'redeem with wrong PIN refused');
select pg_temp.check(not (select active from public.profiles where id = auth.uid()), 'still pending after wrong PIN');
select pg_temp.check(public.check_join_pin(:'link', '101010'), 'right PIN accepted');
select pg_temp.check(public.redeem_join_link(:'link', '101010') = 'ok', 'redeem with right PIN');
select pg_temp.check((select active and role = 'operator' from public.profiles where id = auth.uid()), 'link + PIN activates the account');
select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
select public.redeem_join_link(:'link', '101010');
select pg_temp.become(null);
select pg_temp.check((select uses = 2 and failed = 2 from public.join_links where code = :'link'), 'uses and failed attempts counted');
-- Ten wrong guesses lock the manager link
select public.check_join_pin(:'bosslink', '0000') from generate_series(1, 10);
select pg_temp.check((select reason = 'locked' from public.join_link_info(:'bosslink')), 'link locks after 10 wrong PINs');
select pg_temp.check(not public.check_join_pin(:'bosslink', '101010'), 'locked link refuses the right PIN');

-- Operator 1
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select public.create_join_link('operator', '1111', 24, null)$$, 'operator creates a link');
select pg_temp.check((select count(*) from public.join_links) = 0, 'operator cannot see invite links');
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
-- Managers and office can no longer make invite links
update public.profiles set role = 'manager' where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.become('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_fail($$select public.create_join_link('operator', '101010', 24, 1)$$, 'manager creates a link');
select pg_temp.check((select count(*) from public.join_links) = 0, 'manager cannot see invite links');
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select role from public.profiles where id = '00000000-0000-0000-0000-0000000000a2') = 'assistant', 'boss changes roles');
insert into public.announcements (author_id, body) values (auth.uid(), 'hello');

select pg_temp.become('00000000-0000-0000-0000-0000000000a2');
insert into public.stock_items (sku, name) values ('RES-1', 'Resistor');
select public.adjust_stock((select id from public.stock_items where sku = 'RES-1'), 10, 'delivery');
select pg_temp.check((select quantity = 10 from public.stock_items where sku = 'RES-1'), 'assistant manages stock');
select pg_temp.expect_fail($$insert into public.announcements (author_id, body) values (auth.uid(), 'spam')$$, 'assistant posts news');
select pg_temp.check((select count(*) from public.shifts where user_id <> auth.uid() and clock_out is not null) = 0, 'no access to others'' shift history');

-- ------------------------------------------------ production flow (Shopify)
\set A1 '00000000-0000-0000-0000-0000000000a1'
\set A2 '00000000-0000-0000-0000-0000000000a2'
select pg_temp.become(null);
select pg_temp.check((select count(*) from public.stations) = 4, 'starter stations exist');
insert into public.station_members (station_id, user_id) select id, :'A2' from public.stations where name = 'Metal works';
insert into public.station_members (station_id, user_id) select id, :'A1' from public.stations where name = 'Quality check';
select public.ingest_shopify_order($j${
  "id": 5550001, "name": "#1043", "order_number": 1043, "email": "buyer@x.test", "created_at": "2026-11-02T10:00:00Z",
  "note": "Deliver to loading bay",
  "shipping_address": {"first_name": "Ann", "last_name": "Pilot", "company": "Sim Co", "address1": "1 Runway Rd",
                       "city": "Leeds", "zip": "LS1 1AA", "country": "United Kingdom", "phone": "0113 000"},
  "shipping_lines": [{"title": "DPD Next Day"}],
  "line_items": [
    {"id": 9001, "title": "A32X Pedestal", "variant_title": "Amber LED / CS & FO sides", "sku": "SK-0123", "quantity": 2,
     "properties": [{"name": "Engraving", "value": "N123AB"}, {"name": "_hidden", "value": "x"}]},
    {"id": 9002, "title": "Throttle quadrant", "variant_title": null, "sku": "SK-0200", "quantity": 1},
    {"id": 9003, "title": "Gift card", "sku": "", "quantity": 1, "gift_card": true}
  ]}$j$::jsonb) as made \gset
select pg_temp.check(:made = 2, 'Shopify order → one job per product line (gift cards skipped)');
select id as job1 from public.jobs where shopify_line_id = 9001 \gset
select pg_temp.check((select code = '#1043-1' and title = 'A32X Pedestal - Amber LED - CS & FO sides' and quantity = 2
  and customer = 'Ann Pilot' and sku = 'SK-0123' and description like 'Engraving: N123AB%' and description not like '%_hidden%'
  from public.jobs where id = :'job1'), 'job filled from the order line');
select pg_temp.check((select o.order_number = '#1043' and o.company = 'Sim Co' and o.ship_to like '1 Runway Rd, Leeds%' and o.shipping_method = 'DPD Next Day'
  from public.orders o join public.jobs j on j.order_id = o.id where j.id = :'job1'), 'order keeps customer, ship-to and delivery');
select pg_temp.check((select s.name = 'Metal works' and j.assignees = array[:'A2'::uuid] from public.jobs j join public.stations s on s.id = j.station_id where j.id = :'job1'),
  'job starts at the first station, assigned to its crew');
select pg_temp.check((select cardinality(route) = 4 from public.products where sku = 'SK-0123'), 'unknown SKU is registered with the default route');
select pg_temp.check(public.ingest_shopify_order((select jsonb_build_object('id', 5550001, 'name', '#1043', 'line_items',
  jsonb_build_array(jsonb_build_object('id', 9001, 'title', 'A32X Pedestal', 'sku', 'SK-0123', 'quantity', 2))))) = 0, 'same order twice makes no duplicates');

-- Metal works (assistant a2) finishes → panel fitting (nobody there yet)
select pg_temp.become(:'A2');
select pg_temp.check(public.complete_stage(:'job1') = 'next', 'metal works completes its stage');
select pg_temp.check((select s.name = 'Panel fitting' and j.status = 'open' and j.assignees = '{}' from public.jobs j join public.stations s on s.id = j.station_id where j.id = :'job1'),
  'job moves up to panel fitting');
select pg_temp.expect_fail($$select public.complete_stage((select id from public.jobs where shopify_line_id = 9001))$$, 'completing a stage at someone else''s station');
select pg_temp.expect_fail($$insert into public.stations (name) values ('Hack')$$, 'non-lead edits stations');
-- Manager a1 can push it on; a1 is in quality check so it lands with them
select pg_temp.become(:'A1');
select public.complete_stage(:'job1');
select pg_temp.check((select s.name = 'Quality check' and j.assignees = array[:'A1'::uuid] from public.jobs j join public.stations s on s.id = j.station_id where j.id = :'job1'),
  'quality check gets the job');
select public.complete_stage(:'job1');
select pg_temp.check(public.complete_stage(:'job1') = 'done', 'packing is the last stage');
select pg_temp.check((select status = 'done' and completed_at is not null from public.jobs where id = :'job1'), 'job is done after the last station');
select pg_temp.check((select count(*) = 4 and count(distinct stage) = 4 from public.job_steps where job_id = :'job1'), 'every station''s completion is recorded');
select pg_temp.expect_fail($$select public.ingest_shopify_order('{}'::jsonb)$$, 'app users cannot inject orders');
-- New station member picks up open jobs waiting there
select pg_temp.become(null);
insert into public.station_members (station_id, user_id) select id, :'A1' from public.stations where name = 'Metal works';
select pg_temp.check((select assignees @> array[:'A1'::uuid, :'A2'::uuid] from public.jobs where shopify_line_id = 9002), 'joining a station picks up its waiting jobs');
delete from public.station_members where user_id = :'A2';
select pg_temp.check((select not (:'A2'::uuid = any(assignees)) from public.jobs where shopify_line_id = 9002), 'leaving a station drops its waiting jobs');

-- ------------------------------------------------------- inventory (Katana)
\set B '00000000-0000-0000-0000-00000000000b'
select pg_temp.become(:'B');
select pg_temp.check(public.import_items($j$[
  {"sku":"SK-0123","name":"A32X Pedestal","kind":"product","category":"Pedestals","unit":"pcs","quantity":"1"},
  {"sku":"AL-SHEET","name":"Aluminium sheet 2mm","category":"Metal","unit":"m2","quantity":"20.5","avg_cost":"12.40","supplier":"Metals Ltd","min_quantity":"5"},
  {"sku":"LED-AMB","name":"Amber LED strip","quantity":"100","avg_cost":"0.80","supplier":"metals ltd"},
  {"sku":"","name":"no sku row"}
]$j$::jsonb) = 3, 'Katana items import (rows without SKU skipped)');
select pg_temp.check((select count(*) from public.suppliers) = 1, 'suppliers matched by name, case-insensitive');
select pg_temp.check((select quantity = 20.5 and avg_cost = 12.4 from public.stock_items where sku = 'AL-SHEET'), 'imported quantity and cost');
select pg_temp.check((select count(*) from public.stock_movements where reason = 'import') = 3, 'import is in the stock history');
select pg_temp.check(public.import_bom($j$[
  {"product_sku":"SK-0123","material_sku":"AL-SHEET","quantity":"1.5"},
  {"product_sku":"SK-0123","material_sku":"LED-AMB","quantity":"4"},
  {"product_sku":"SK-0123","material_sku":"NOPE","quantity":"1"}
]$j$::jsonb) = 2, 'recipe import (unknown SKUs skipped)');
select pg_temp.expect_fail($$update public.stock_items set quantity = 999 where sku = 'AL-SHEET'$$, 'editing quantity directly');
update public.stock_items set location = 'Rack B2' where sku = 'AL-SHEET';
select pg_temp.check((select location = 'Rack B2' from public.stock_items where sku = 'AL-SHEET'), 'item details stay editable');
select pg_temp.check(public.count_stock((select id from public.stock_items where sku = 'AL-SHEET'), 18, 'stocktake') = 18, 'stocktake sets the counted quantity');
select pg_temp.check((select delta = -2.5 and reason = 'count' from public.stock_movements where reason = 'count'), 'stocktake records the difference');
-- Purchase order: receive 10 m2 at 15.00 → average cost moves
insert into public.purchase_orders (supplier_id, status) select id, 'ordered' from public.suppliers limit 1;
insert into public.po_lines (po_id, item_id, quantity, unit_cost)
  select (select id from public.purchase_orders limit 1), id, 10, 15 from public.stock_items where sku = 'AL-SHEET';
select pg_temp.check(public.receive_po_line((select id from public.po_lines limit 1), 4) = 'partial', 'part delivery leaves the PO open');
select pg_temp.check(public.receive_po_line((select id from public.po_lines limit 1), 6) = 'received', 'full delivery closes the PO');
select pg_temp.check((select quantity = 28 from public.stock_items where sku = 'AL-SHEET'), 'receiving adds stock');
select pg_temp.check((select avg_cost > 12.4 and avg_cost < 15 from public.stock_items where sku = 'AL-SHEET'), 'receiving at a higher price raises the average cost');
select pg_temp.expect_fail($$select public.receive_po_line((select id from public.po_lines limit 1), 1)$$, 'receiving on a closed PO');
-- Finishing the Shopify job for SK-0123 ×2 consumes its recipe (made to order: no finished stock added)
select pg_temp.become(null);
update public.jobs set status = 'open', completed_at = null, stock_booked = false where shopify_line_id = 9001;
update public.jobs set status = 'done' where shopify_line_id = 9001;
select pg_temp.check((select quantity = 25 from public.stock_items where sku = 'AL-SHEET'), 'finished job uses 1.5 m2 × 2');
select pg_temp.check((select quantity = 92 from public.stock_items where sku = 'LED-AMB'), 'finished job uses 4 LEDs × 2');
select pg_temp.check((select quantity = 1 from public.stock_items where sku = 'SK-0123'), 'customer order does not add finished stock');
update public.jobs set status = 'paused' where shopify_line_id = 9001;
update public.jobs set status = 'done' where shopify_line_id = 9001;
select pg_temp.check((select quantity = 25 from public.stock_items where sku = 'AL-SHEET'), 'stock is booked only once per job');
-- Make-to-stock job adds finished product
insert into public.jobs (code, title, sku, quantity, status) values ('SK-2401', 'Build 3 pedestals for stock', 'SK-0123', 3, 'open');
update public.jobs set status = 'done' where code = 'SK-2401';
select pg_temp.check((select quantity = 4 from public.stock_items where sku = 'SK-0123'), 'make-to-stock job adds finished products');
select pg_temp.check((select count(*) from public.stock_movements where reason = 'consume' and ref = 'SK-2401') = 2, 'consumption is in the history with the job code');
-- operators cannot touch stock
update public.profiles set role = 'operator' where id = :'A2';
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.adjust_stock((select id from public.stock_items where sku = 'LED-AMB'), -5, '')$$, 'operator books stock out');
select pg_temp.expect_fail($$select public.import_items('[{"sku":"X","quantity":"5"}]'::jsonb)$$, 'operator imports stock');
select pg_temp.expect_fail($$insert into public.purchase_orders (status) values ('draft')$$, 'operator creates a purchase order');
select pg_temp.expect_fail($$select public.move_stock((select id from public.stock_items where sku = 'LED-AMB'), 5, 'adjust')$$, 'calling the internal stock function directly');
select pg_temp.become(null);
-- ----------------------------------------------------------- comms (Teams)
select pg_temp.become(null);
select pg_temp.check((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id where n.kind = 'news') >= 2, 'noticeboard post notifies everyone else');
select pg_temp.check((select count(*) from public.notifications where user_id = :'A2' and kind = 'job_new') >= 1, 'new Shopify job notifies the station crew');
select pg_temp.check((select count(*) from public.notifications where user_id = :'A2' and kind = 'invite') = 1, 'team invite notifies the helper');
select pg_temp.check((select count(*) from public.notifications where kind = 'job_given' and user_id = :'A1') >= 1, 'job reaching your station notifies you');
select pg_temp.check((select count(*) from public.conversation_members m join public.conversations c on c.id = m.conversation_id where c.name = 'General') = 3, 'everyone active is in the General channel');

select pg_temp.become(:'A1');
select public.open_direct(:'B') as dm \gset
select pg_temp.check(public.open_direct(:'B') = :'dm', 'opening a chat with the same person reuses it');
insert into public.messages (conversation_id, sender_id, body) values (:'dm', auth.uid(), 'Pedestal for #1043 ready?');
select pg_temp.become(:'B');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'message' and body like 'Pedestal%') = 1, 'chat message notifies the other person');
select pg_temp.check((select count(*) from public.messages where conversation_id = :'dm') = 1, 'boss reads the direct chat');
update public.conversation_members set last_read_at = now() where conversation_id = :'dm' and user_id = auth.uid();
select pg_temp.check((select count(*) from public.conversation_members where conversation_id = :'dm' and last_read_at is not null) = 2, 'read receipts recorded');
select pg_temp.become(:'A2');
select pg_temp.check((select count(*) from public.messages where conversation_id = :'dm') = 0, 'others cannot read a private chat');
select pg_temp.expect_fail(format($$insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), 'hi')$$, :'dm'), 'posting into someone else''s chat');
select pg_temp.check((select count(*) from public.notifications where user_id = :'B') = 0, 'notifications are private');
select pg_temp.expect_fail($$select public.create_conversation('channel', 'Ops', '{}')$$, 'operator creates a channel');
insert into public.messages (conversation_id, sender_id, body) select id, auth.uid(), 'Morning all' from public.conversations where name = 'General';
select pg_temp.become(:'A1');
update public.messages set body = 'Hacked' where body = 'Morning all';
select pg_temp.check((select body = 'Morning all' from public.messages where body in ('Morning all', 'Hacked')), 'cannot edit other people''s messages');
update public.messages set body = 'Pedestal for #1043 ready today?' where conversation_id = :'dm';
select pg_temp.check((select edited_at is not null from public.messages where conversation_id = :'dm' and kind = 'text'), 'edits are marked');
select public.create_conversation('group', 'Line 2', array[:'B'::uuid]) as grp \gset
select pg_temp.check((select count(*) from public.conversation_members where conversation_id = :'grp') = 2, 'group chat with members');
-- Calendar
insert into public.events (id, title, starts_at, ends_at, organizer_id)
  values ('e0000000-0000-0000-0000-000000000001', 'Production meeting', now() + interval '5 minutes', now() + interval '35 minutes', auth.uid());
insert into public.event_attendees (event_id, user_id) values ('e0000000-0000-0000-0000-000000000001', :'B');
select pg_temp.become(:'B');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'meeting') = 1, 'meeting invite notifies attendee');
update public.event_attendees set response = 'accepted' where user_id = auth.uid();
select pg_temp.check((select count(*) from public.events) = 1, 'attendee sees the meeting');
select pg_temp.become(:'A2');
select pg_temp.check((select count(*) from public.events) = 0, 'others do not see the meeting');
select pg_temp.become(null);
select pg_temp.check(public.send_reminders() = 1, 'reminder sent 10 minutes before');
select pg_temp.check((select count(*) from public.notifications where kind = 'reminder') = 2, 'organiser and attendee reminded');
select pg_temp.check(public.send_reminders() = 0, 'reminders only once');
-- Calls
select pg_temp.become(:'A1');
insert into public.calls (id, conversation_id, started_by, kind) values ('ca000000-0000-0000-0000-000000000001', :'dm', auth.uid(), 'video');
select public.join_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from public.messages where conversation_id = :'dm' and kind = 'call') = 1, 'call shows in the chat');
select pg_temp.become(:'B');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'call') = 1, 'call rings the other person');
select public.join_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.join_call('ca000000-0000-0000-0000-000000000001')$$, 'joining someone else''s call');
select pg_temp.become(:'A1');
select public.leave_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.check((select status = 'active' from public.calls), 'call continues while someone is in it');
select pg_temp.become(:'B');
select public.leave_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.check((select status = 'ended' and ended_at is not null from public.calls), 'last one out ends the call');
update public.profiles set status = 'dnd' where id = auth.uid();
select pg_temp.check((select status = 'dnd' from public.profiles where id = auth.uid()), 'set own presence status');

select pg_temp.become(null);
select pg_temp.check((select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) = 0, 'every table has RLS');
delete from auth.users;
select pg_temp.check((select count(*) from public.profiles) + (select count(*) from public.shifts) + (select count(*) from public.participants) = 0, 'deleting users cascades');
\echo ALL SCHEMA TESTS PASSED
