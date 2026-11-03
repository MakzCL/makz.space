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
  "total_price": "1450.00", "currency": "GBP",
  "line_items": [
    {"id": 9001, "title": "A32X Pedestal", "variant_title": "Amber LED / CS & FO sides", "sku": "SK-0123", "quantity": 2, "price": "650.00",
     "properties": [{"name": "Engraving", "value": "N123AB"}, {"name": "_hidden", "value": "x"}]},
    {"id": 9002, "title": "Throttle quadrant", "variant_title": null, "sku": "SK-0200", "quantity": 1},
    {"id": 9003, "title": "Gift card", "sku": "", "quantity": 1, "gift_card": true}
  ]}$j$::jsonb) as made \gset
select pg_temp.check(:made = 2, 'Shopify order → one job per product line (gift cards skipped)');
select id as job1 from public.jobs where shopify_line_id = 9001 \gset
select pg_temp.check((select code = '#1043-1' and title = 'A32X Pedestal - Amber LED - CS & FO sides' and quantity = 2
  and customer = 'Ann Pilot' and sku = 'SK-0123' and description like 'Engraving: N123AB%' and description not like '%_hidden%'
  from public.jobs where id = :'job1'), 'job filled from the order line');
select pg_temp.check((select unit_price = 650 from public.jobs where id = :'job1'), 'line price stored');
select pg_temp.check((select o.order_number = '#1043' and o.total_price = 1450 and o.company = 'Sim Co' and o.ship_to like '1 Runway Rd, Leeds%' and o.shipping_method = 'DPD Next Day'
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
select pg_temp.check(public.previous_stage(:'job1') = 'Packing', 'manager sends a finished job back to packing');
select pg_temp.check(public.previous_stage(:'job1') = 'Quality check', 'and back again to quality check');
select pg_temp.check((select status = 'open' and stage = 2 and assignees = array[:'A1'::uuid] from public.jobs where id = :'job1'), 'sent-back job lands with that station''s crew');
select public.complete_stage(:'job1'); select public.complete_stage(:'job1');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.previous_stage((select id from public.jobs where shopify_line_id = 9002))$$, 'non-lead sends a job back');
select pg_temp.become(:'A1');
select pg_temp.check((select count(distinct stage) = 4 and count(*) = 6 from public.job_steps where job_id = :'job1'), 'every station''s completion is recorded (incl. redone after send-back)');
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
reset role; select pg_temp.check((select quantity = 20.5 and avg_cost = 12.4 from public.stock_items where sku = 'AL-SHEET'), 'imported quantity and cost'); set role authenticated;
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
reset role; select pg_temp.check((select avg_cost > 12.4 and avg_cost < 15 from public.stock_items where sku = 'AL-SHEET'), 'receiving at a higher price raises the average cost'); set role authenticated;
select pg_temp.expect_fail($$select public.receive_po_line((select id from public.po_lines limit 1), 1)$$, 'receiving on a closed PO');
-- Finishing the Shopify job for SK-0123 ×2 consumes its recipe (made to order: no finished stock added)
select pg_temp.become(null);
update public.jobs set status = 'open', completed_at = null, stock_booked = false where shopify_line_id = 9001;
update public.jobs set status = 'done' where shopify_line_id = 9001;
select pg_temp.check((select quantity = 25 from public.stock_items where sku = 'AL-SHEET'), 'finished job uses 1.5 m2 × 2');
select pg_temp.check((select quantity = 92 from public.stock_items where sku = 'LED-AMB'), 'finished job uses 4 LEDs × 2');
select pg_temp.check((select quantity = 3 from public.stock_items where sku = 'SK-0123'), 'make-to-order output goes on stock until its line ships');
update public.jobs set status = 'paused' where shopify_line_id = 9001;
update public.jobs set status = 'done' where shopify_line_id = 9001;
select pg_temp.check((select quantity = 25 from public.stock_items where sku = 'AL-SHEET'), 'stock is booked only once per job');
-- Make-to-stock job adds finished product
insert into public.jobs (code, title, sku, quantity, status) values ('SK-2401', 'Build 3 pedestals for stock', 'SK-0123', 3, 'open');
update public.jobs set status = 'done' where code = 'SK-2401';
select pg_temp.check((select quantity = 6 from public.stock_items where sku = 'SK-0123'), 'make-to-stock job adds finished products');
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
select pg_temp.check((select count(*) from public.conversations where kind = 'channel') = 0, 'no channels');

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
select pg_temp.expect_fail($$select public.create_conversation('channel', 'Ops', '{}')$$, 'creating a channel');
select public.create_conversation('group', 'Floor', array['00000000-0000-0000-0000-00000000000b'::uuid, '00000000-0000-0000-0000-0000000000a1'::uuid]) as floor \gset
insert into public.messages (conversation_id, sender_id, body) values (:'floor', auth.uid(), 'Morning all');
select pg_temp.become(:'A1');
update public.messages set body = 'Hacked' where body = 'Morning all';
select pg_temp.check((select body = 'Morning all' from public.messages where body in ('Morning all', 'Hacked')), 'cannot edit other people''s messages');
update public.messages set body = 'Pedestal for #1043 ready today?' where conversation_id = :'dm';
select pg_temp.check((select edited_at is not null from public.messages where conversation_id = :'dm' and kind = 'text'), 'edits are marked');
select public.create_conversation('group', 'Line 2', array[:'B'::uuid]) as grp \gset
select pg_temp.check((select count(*) from public.conversation_members where conversation_id = :'grp') = 2, 'group chat with members');
-- Calendar
-- (the app inserts with RETURNING, so the new row must be visible to its creator)
insert into public.events (id, title, starts_at, ends_at, organizer_id)
  values ('e0000000-0000-0000-0000-000000000001', 'Production meeting', now() + interval '5 minutes', now() + interval '35 minutes', auth.uid()) returning id;
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
insert into public.calls (id, conversation_id, started_by, kind) values ('ca000000-0000-0000-0000-000000000001', :'dm', auth.uid(), 'video') returning id;
select public.join_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.check((select count(*) from public.messages where conversation_id = :'dm' and kind = 'call') = 1, 'call shows in the chat');
select pg_temp.become(:'B');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'call') = 1, 'call rings the other person');
select public.join_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.join_call('ca000000-0000-0000-0000-000000000001')$$, 'joining someone else''s call');
select pg_temp.become(:'A1');
select public.leave_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.check((select status = 'ended' from public.calls), 'a 1:1 call ends when either person hangs up');
select pg_temp.become(:'B');
select public.leave_call('ca000000-0000-0000-0000-000000000001');
select pg_temp.check((select status = 'ended' and ended_at is not null from public.calls), 'last one out ends the call');
update public.profiles set status = 'dnd' where id = auth.uid();
select pg_temp.check((select status = 'dnd' from public.profiles where id = auth.uid()), 'set own presence status');

-- Kortana: sales orders, quotes, delivery, manufacturing orders
select pg_temp.become(null);
select pg_temp.check((select count(*) from public.jobs where order_id is not null and order_line_id is null) = 0, 'every Shopify job has an order line');
select pg_temp.check((select count(*) from public.order_lines ol join public.orders o on o.id = ol.order_id where o.source = 'shopify') >= 2, 'Shopify orders keep their lines');
select pg_temp.become(:'B');
insert into public.orders (order_number, customer, kind, delivery_deadline) values ('', 'Acme Ltd', 'order', current_date + 7);
select pg_temp.check((select order_number = 'SO-90001' and source = 'manual' and created_by = auth.uid() from public.orders where customer = 'Acme Ltd'), 'manual sales order gets an SO number');
insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price, sort)
  select o.id, s.id, s.sku, s.name, 1, 99, 0 from public.orders o, public.stock_items s where o.customer = 'Acme Ltd' and s.sku = 'SK-0123';
insert into public.order_lines (order_id, sku, name, quantity, unit_price, sort)
  select o.id, 'SK-0123', 'Custom sign', 2, 150, 1 from public.orders o where o.customer = 'Acme Ltd';
select public.create_mo(null, null, null, null, (select id from public.order_lines where name = 'Custom sign'));
select pg_temp.check((select code = 'SO-90001-2' and quantity = 2 and order_id is not null and due_date = current_date + 7 and array_length(route, 1) > 0
  from public.jobs where order_line_id = (select id from public.order_lines where name = 'Custom sign')), 'make-to-order MO for a sales line');
select pg_temp.expect_fail($$select public.create_mo(null, null, null, null, (select id from public.order_lines where name = 'Custom sign'))$$, 'second MO for the same line');
select public.set_delivery((select id from public.orders where customer = 'Acme Ltd'), 'shipped');
select pg_temp.check((select quantity = 5 from public.stock_items where sku = 'SK-0123'), 'shipping takes the stocked line off stock (untracked line does not)');
select public.set_delivery((select id from public.orders where customer = 'Acme Ltd'), 'shipped');
select pg_temp.check((select quantity = 5 from public.stock_items where sku = 'SK-0123'), 'shipping twice takes stock once');
select public.set_delivery((select id from public.orders where customer = 'Acme Ltd'), 'not_shipped');
select pg_temp.check((select quantity = 6 from public.stock_items where sku = 'SK-0123'), 'undoing the shipment returns stock');
select public.set_delivery((select id from public.orders where customer = 'Acme Ltd'), 'delivered');
select pg_temp.check((select status = 'done' and delivered_at is not null and shipped_at is not null from public.orders where customer = 'Acme Ltd'), 'delivered order is done');
insert into public.orders (order_number, customer, kind) values ('', 'Quote Co', 'quote');
select pg_temp.check((select order_number = 'QT-1001' from public.orders where customer = 'Quote Co'), 'quote gets a QT number');
select pg_temp.expect_fail($$select public.set_delivery((select id from public.orders where customer = 'Quote Co'), 'packed')$$, 'delivering a quote');
select pg_temp.check(public.convert_quote((select id from public.orders where customer = 'Quote Co')) = 'SO-90002', 'quote becomes a sales order');
select pg_temp.check(public.create_mo('SK-0123', 'Stock build', 5) is not null, 'make-to-stock MO');
select pg_temp.check((select code = 'STK-1001' and order_id is null and quantity = 5 from public.jobs where title = 'Stock build'), 'stock MO numbered STK-');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.create_mo('SK-0123', 'x', 1)$$, 'operator plans production');
select pg_temp.expect_fail($$select public.set_delivery((select id from public.orders where customer = 'Acme Ltd'), 'packed')$$, 'operator ships orders');
select pg_temp.expect_fail($$insert into public.orders (order_number, customer) values ('', 'Nope')$$, 'operator creates sales orders');
-- Tickets
insert into public.issues (reported_by, title, severity, job_id) values (auth.uid(), 'Bent panel', 'high', (select id from public.jobs where title = 'Stock build'));
select pg_temp.become(:'B');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'ticket') = 1, 'office team told about a new ticket');
select pg_temp.check((select number > 0 from public.issues where title = 'Bent panel'), 'ticket is numbered');
update public.issues set assignee_id = :'A1', status = 'acknowledged' where title = 'Bent panel';
select pg_temp.check((select count(*) from public.issue_comments where kind = 'event') = 2, 'status and owner changes are logged');
select pg_temp.become(:'A1');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'ticket' and title = 'Ticket given to you') = 1, 'assignee told');
insert into public.issue_comments (issue_id, author_id, body) select id, auth.uid(), 'New panel cut' from public.issues where title = 'Bent panel';
update public.issues set status = 'resolved' where title = 'Bent panel';
select pg_temp.check((select resolved_at is not null and resolved_by = auth.uid() from public.issues where title = 'Bent panel'), 'assignee resolves the ticket');
select pg_temp.become(:'A2');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'ticket') = 3, 'reporter hears about progress, reply and fix');
insert into public.issue_comments (issue_id, author_id, body) select id, auth.uid(), 'Thanks' from public.issues where title = 'Bent panel';
select pg_temp.check((select count(*) from public.issue_comments where kind = 'comment') = 2, 'reporter replies on the thread');
select pg_temp.become(:'B');
insert into public.issues (reported_by, title) values (auth.uid(), 'Office printer');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$insert into public.issue_comments (issue_id, author_id, body) select id, auth.uid(), 'x' from public.issues where title = 'Office printer'$$, 'commenting on someone else''s ticket');
select pg_temp.expect_fail($$insert into public.issue_comments (issue_id, author_id, body, kind) select id, auth.uid(), 'status:open', 'event' from public.issues where title = 'Bent panel'$$, 'faking a history entry');

-- Clock reminders (Mon 2 Nov 2026, UK time = GMT)
select pg_temp.become(null);
delete from public.notifications where kind = 'clock';
delete from public.shifts;
insert into public.shifts (user_id, clock_in) values (:'A1', '2026-11-02 05:50+00');
select pg_temp.check(public.shift_reminders('2026-11-02 05:59+00') = 1, 'clock-in reminder only for the one not clocked in (owner skipped)');
select pg_temp.check((select user_id = :'A2' from public.notifications where kind = 'clock'), 'reminder goes to the operator');
select pg_temp.check(public.shift_reminders('2026-11-02 05:59:30+00') = 0, 'clock-in reminder sent once');
select pg_temp.check(public.shift_reminders('2026-11-02 10:00+00') = 0, 'no reminders outside the set times');
update public.shifts set clock_out = '2026-11-02 14:00+00' where user_id = :'A1';
select pg_temp.check(public.shift_reminders('2026-11-02 13:59+00') = 1, 'afternoon reminder skips someone who worked this morning');
select pg_temp.check(public.shift_reminders('2026-11-07 05:59+00') = 0, 'no clock-in reminders at the weekend');
insert into public.shifts (user_id, clock_in) values (:'A2', '2026-11-02 14:02+00');
select pg_temp.check(public.shift_reminders('2026-11-02 14:01+00') = 0, 'just clocked in: no clock-out nag');
select pg_temp.check(public.shift_reminders('2026-11-02 22:01+00') = 1, 'clock-out reminder at 22:01 for an open shift');
select pg_temp.check(public.shift_reminders('2026-11-03 02:00+00') = 1, 'and again at 02:00 if still clocked in');

-- Keep-in-stock builds
select pg_temp.become(:'B');
insert into public.stock_items (sku, name, kind, location) values ('FR-PED', 'Pedestal metal frame', 'part', 'Upstairs');
update public.stock_items set make_min = 1 where sku = 'FR-PED';
select pg_temp.check((select count(*) from public.jobs where sku = 'FR-PED' and code like 'STK-%' and status = 'open' and quantity = 1) = 1, 'keep-1 rule raises a frame build');
update public.stock_items set location = 'Upstairs rack' where sku = 'FR-PED';
update public.stock_items set make_min = 1 where sku = 'FR-PED';
select pg_temp.check((select count(*) from public.jobs where sku = 'FR-PED') = 1, 'no duplicate build while one is in production');
update public.jobs set status = 'done' where sku = 'FR-PED';
select pg_temp.check((select quantity = 1 from public.stock_items where sku = 'FR-PED'), 'finished frame goes on stock upstairs');
select pg_temp.check((select count(*) from public.jobs where sku = 'FR-PED' and status <> 'done') = 0, 'stock at target: nothing new raised');
select public.adjust_stock((select id from public.stock_items where sku = 'FR-PED'), -1, 'used in pedestal');
select pg_temp.check((select count(*) from public.jobs where sku = 'FR-PED' and status = 'open') = 1, 'using the frame raises the next build');

-- 1:1 call: hanging up ends it for both; an unanswered call leaves a missed-call notification
select pg_temp.become(:'A1');
insert into public.calls (id, conversation_id, started_by, kind) values ('ca000000-0000-0000-0000-000000000002', :'dm', auth.uid(), 'voice') returning id;
select public.join_call('ca000000-0000-0000-0000-000000000002');
select pg_temp.become(:'B');
select public.join_call('ca000000-0000-0000-0000-000000000002');
select pg_temp.become(:'A1');
select public.leave_call('ca000000-0000-0000-0000-000000000002');
select pg_temp.check((select status = 'ended' from public.calls where id = 'ca000000-0000-0000-0000-000000000002'), 'one person hanging up ends a 1:1 call');
select pg_temp.check((select count(*) from public.call_participants where call_id = 'ca000000-0000-0000-0000-000000000002' and left_at is null) = 0, 'both are out of the ended call');
insert into public.calls (id, conversation_id, started_by, kind) values ('ca000000-0000-0000-0000-000000000003', :'dm', auth.uid(), 'video') returning id;
select public.join_call('ca000000-0000-0000-0000-000000000003');
select public.leave_call('ca000000-0000-0000-0000-000000000003');
select pg_temp.become(:'B');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'missed_call' and title like 'Missed video call from%') = 1, 'unanswered call: missed-call notification');
select pg_temp.become(:'A1');
select pg_temp.check((select count(*) from public.notifications where user_id = auth.uid() and kind = 'missed_call') = 0, 'caller gets no missed-call notice');

-- Admin staff tools: roles (Owner reserved for the owner), Support role, missed shifts
select pg_temp.become(:'A1'); -- manager
update public.profiles set role = 'support' where id = :'A2';
select pg_temp.check((select role = 'support' from public.profiles where id = :'A2'), 'manager changes a role (to Support)');
select pg_temp.expect_fail($$update public.profiles set role = 'boss' where id = '00000000-0000-0000-0000-0000000000a2'$$, 'manager makes someone Owner');
select pg_temp.expect_fail($$update public.profiles set role = 'operator' where id = '00000000-0000-0000-0000-00000000000b'$$, 'manager demotes the owner');
select pg_temp.expect_fail($$update public.profiles set role = 'office' where id = auth.uid()$$, 'changing your own role');
insert into public.shifts (user_id, clock_in, clock_out) values (:'A2', now() - interval '9 hours', now() - interval '1 hour');
select pg_temp.check((select count(*) from public.shifts where user_id = :'A2' and clock_out is not null and clock_out > now() - interval '2 hours') = 1, 'admin adds a missed shift');
select pg_temp.become(:'A2'); -- support (not admin)
update public.profiles set role = 'operator' where id = :'A1';
select pg_temp.check((select role = 'manager' from public.profiles where id = :'A1'), 'support cannot change anyone''s role');
select pg_temp.expect_fail($$insert into public.shifts (user_id, clock_in) values ('00000000-0000-0000-0000-0000000000a1', now())$$, 'support adds shifts for others');
select pg_temp.check(not public.is_admin(), 'support has no admin rights');
select pg_temp.become(:'A1');
update public.profiles set role = 'operator' where id = :'A2';

-- Katana 1:1: sub-assembly recipes, exact reversal on reopen, office complete/reopen
select pg_temp.become(:'B');
insert into public.stock_items (sku, name, kind) values ('SCR-M4x12', 'M4x12 BLACK Socket Head', 'material'), ('DOC-L', 'Left Document Holder Piece', 'material'),
  ('DOC-R', 'Right Document Holder Piece', 'material'), ('PED-FRAME', 'Pedestal frame', 'part'), ('PED', 'A32X Pedestal', 'product');
select public.adjust_stock(id, 100, 'opening') from public.stock_items where sku = 'SCR-M4x12';
select public.adjust_stock(id, 5, 'opening') from public.stock_items where sku in ('DOC-L', 'DOC-R');
insert into public.bom_lines (product_id, material_id, quantity)
  select f.id, m.id, q from public.stock_items f, (values ('SCR-M4x12', 24), ('DOC-L', 1), ('DOC-R', 1)) v(sku, q) join public.stock_items m on m.sku = v.sku where f.sku = 'PED-FRAME';
insert into public.bom_lines (product_id, material_id, quantity)
  select p.id, f.id, 1 from public.stock_items p, public.stock_items f where p.sku = 'PED' and f.sku = 'PED-FRAME';
-- build two frames (make to stock)
select public.create_mo('PED-FRAME', 'Pedestal frame', 2);
select public.complete_mo((select id from public.jobs where sku = 'PED-FRAME' and status <> 'done' limit 1));
select pg_temp.check((select quantity = 52 from public.stock_items where sku = 'SCR-M4x12'), 'frame MO uses 24 screws × 2');
select pg_temp.check((select quantity = 3 from public.stock_items where sku = 'DOC-L') and (select quantity = 3 from public.stock_items where sku = 'DOC-R'), 'frame MO uses the left and right document holder pieces');
select pg_temp.check((select quantity = 2 from public.stock_items where sku = 'PED-FRAME'), 'finished frames go on stock');
-- pedestal consumes one frame
select public.create_mo('PED', 'A32X Pedestal', 1);
select public.complete_mo((select id from public.jobs where sku = 'PED' and status <> 'done' limit 1));
select pg_temp.check((select quantity = 1 from public.stock_items where sku = 'PED-FRAME') and (select quantity = 1 from public.stock_items where sku = 'PED'), 'pedestal MO takes a frame and adds a pedestal');
select pg_temp.check((select count(*) from public.stock_movements where job_id = (select id from public.jobs where sku = 'PED' limit 1)) = 2, 'movements are linked to the MO');
-- recipe changes, then the frame MO is reopened: exactly what was booked comes back
update public.bom_lines set quantity = 30 where material_id = (select id from public.stock_items where sku = 'SCR-M4x12');
select public.reopen_mo((select id from public.jobs where sku = 'PED-FRAME' limit 1));
select pg_temp.check((select quantity = 100 from public.stock_items where sku = 'SCR-M4x12') and (select quantity = 5 from public.stock_items where sku = 'DOC-L'), 'reopen returns exactly what was used (not the new recipe)');
select pg_temp.check((select quantity = -1 from public.stock_items where sku = 'PED-FRAME'), 'reopen takes the produced frames back off');
select pg_temp.check((select not stock_booked and status = 'open' from public.jobs where sku = 'PED-FRAME' limit 1), 'reopened MO is open again');
select public.complete_mo((select id from public.jobs where sku = 'PED-FRAME' limit 1));
select pg_temp.check((select quantity = 40 from public.stock_items where sku = 'SCR-M4x12') and (select quantity = 1 from public.stock_items where sku = 'PED-FRAME'), 'completing again books the current recipe once');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.complete_mo((select id from public.jobs where sku = 'PED' limit 1))$$, 'operator completes MOs from Kortana');

-- ============================================================================
-- KORTANA phase 1 acceptance (numerical fixtures; docs/kimera-coverage.md)
-- ============================================================================
select pg_temp.become(:'B');
select pg_temp.check((select base_currency = 'GBP' from public.company_settings), 'base currency defaults to GBP');
insert into public.suppliers (name, currency) values ('K1 Screws Ltd', 'GBP'), ('K1 EuroParts', 'EUR');
insert into public.stock_items (sku, name, kind, unit) values
  ('K1-SCREW', 'K1 screw', 'material', 'pcs'), ('K1-PANEL', 'K1 panel', 'material', 'pcs'),
  ('K1-SUB', 'K1 sub-assembly', 'part', 'pcs'), ('K1-UNIT', 'K1 unit', 'product', 'pcs'),
  ('K1-SVC', 'K1 installation', 'service', 'h');
insert into public.bom_lines (product_id, material_id, quantity)
  select p.id, m.id, v.q from (values ('K1-SUB', 'K1-SCREW', 4), ('K1-SUB', 'K1-PANEL', 1), ('K1-UNIT', 'K1-SUB', 1), ('K1-UNIT', 'K1-SCREW', 2)) v(p, m, q)
  join public.stock_items p on p.sku = v.p join public.stock_items m on m.sku = v.m;

-- Scenario 1: partial receipt (GBP) — 100 screws @ 0.10, 10 panels @ 5.00
insert into public.purchase_orders (supplier_id, status) select id, 'draft' from public.suppliers where name = 'K1 Screws Ltd';
select id as k1po from public.purchase_orders where supplier_id = (select id from public.suppliers where name = 'K1 Screws Ltd') \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) select :'k1po', id, 100, 0.10 from public.stock_items where sku = 'K1-SCREW';
insert into public.po_lines (po_id, item_id, quantity, unit_cost) select :'k1po', id, 10, 5.00 from public.stock_items where sku = 'K1-PANEL';
select l.id as screwline from public.po_lines l join public.stock_items s on s.id = l.item_id where s.sku = 'K1-SCREW' \gset
select l.id as panelline from public.po_lines l join public.stock_items s on s.id = l.item_id where s.sku = 'K1-PANEL' and l.po_id = :'k1po' \gset
select pg_temp.expect_fail($$select public.receive_po_line(:'screwline', 10)$$, 'receiving a draft PO');
update public.purchase_orders set status = 'ordered' where id = :'k1po';
select pg_temp.check(public.receive_po_line(:'screwline', 60, 'rcv-1') = 'partial', 'S1 receive 60 of 100 → partial');
select pg_temp.check(public.receive_po_line(:'screwline', 60, 'rcv-1') = 'partial', 'S9 same key replayed → same answer');
select pg_temp.check((select received = 60 and quantity - received = 40 from public.po_lines where id = :'screwline'), 'S1 received 60, outstanding 40');
reset role; select pg_temp.check((select quantity = 60 and avg_cost = 0.10 from public.stock_items where sku = 'K1-SCREW'), 'S1 on hand 60 @ 0.10'); set role authenticated;
select pg_temp.check((select count(*) = 1 from public.stock_movements where source_type = 'po_line' and source_id = :'screwline'), 'S9 replay posts no second movement');
select pg_temp.expect_fail($$select public.receive_po_line(:'screwline', 50)$$, 'receiving more than outstanding without confirming');
select pg_temp.check(public.receive_po_line(:'screwline', 40) = 'partial', 'rest of the screws in, panels still due');
select pg_temp.check(public.receive_po_line(:'panelline', 10) = 'received', 'panels in → PO received');
select pg_temp.check(public.reverse_po_receipt(:'panelline', 2) = 'partial', 'reversing 2 panels reopens the PO');
reset role; select pg_temp.check((select quantity = 8 and avg_cost = 5 from public.stock_items where sku = 'K1-PANEL'), 'reversal takes 2 panels out at their receipt cost'); set role authenticated;
select pg_temp.check(public.receive_po_line(:'panelline', 2) = 'received', 'panels re-received');
select pg_temp.expect_fail($$delete from public.purchase_orders where id = '$$ || :'k1po' || $$'$$, 'deleting a PO with receipts');

-- Multicurrency: 10 panels @ 10.00 EUR, rate 0.85 → 8.50 GBP; average (10×5 + 10×8.5)/20 = 6.75
insert into public.purchase_orders (supplier_id, status, currency, fx_rate) select id, 'ordered', 'EUR', 0.85 from public.suppliers where name = 'K1 EuroParts';
insert into public.po_lines (po_id, item_id, quantity, unit_cost)
  select (select id from public.purchase_orders where currency = 'EUR'), id, 10, 10 from public.stock_items where sku = 'K1-PANEL';
select public.receive_po_line((select l.id from public.po_lines l join public.purchase_orders p on p.id = l.po_id where p.currency = 'EUR'), 10);
reset role; select pg_temp.check((select quantity = 20 and avg_cost = 6.75 from public.stock_items where sku = 'K1-PANEL'), 'EUR receipt converted to GBP before averaging (avg 6.75)'); set role authenticated;
reset role; select pg_temp.check((select unit_cost = 8.5 from public.stock_movements m join public.purchase_orders p on p.number = m.ref where p.currency = 'EUR'), 'movement keeps the base-currency cost 8.50'); set role authenticated;

-- Scenario 4: sub-assembly. 2 × SUB = 8 screws (0.80) + 2 panels (13.50) → 7.15 each
select public.create_mo('K1-SUB', 'K1 sub', 2);
select public.complete_mo((select id from public.jobs where sku = 'K1-SUB' and status <> 'done'));
select pg_temp.check((select quantity = 92 from public.stock_items where sku = 'K1-SCREW') and (select quantity = 18 from public.stock_items where sku = 'K1-PANEL'), 'S4 SUB MO consumes 8 screws + 2 panels');
reset role; select pg_temp.check((select quantity = 2 and avg_cost = 7.15 from public.stock_items where sku = 'K1-SUB'), 'S4 SUB output costed at consumed materials: 7.15'); set role authenticated;

-- Scenario 3: make-to-order unit + a service line on one sales order
insert into public.orders (order_number, customer, kind) values ('', 'K1 Customer', 'order');
select id as k1so from public.orders where customer = 'K1 Customer' \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price, sort)
  select :'k1so', id, sku, name, 1, 50, 0 from public.stock_items where sku = 'K1-UNIT';
insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price, sort)
  select :'k1so', id, sku, name, 2, 30, 1 from public.stock_items where sku = 'K1-SVC';
select id as unitline from public.order_lines where order_id = :'k1so' and sku = 'K1-UNIT' \gset
select id as svcline from public.order_lines where order_id = :'k1so' and sku = 'K1-SVC' \gset
select public.create_mo(null, null, null, null, :'unitline');
select public.complete_mo((select id from public.jobs where order_line_id = :'unitline'));
select pg_temp.check((select quantity = 1 from public.stock_items where sku = 'K1-SUB') and (select quantity = 90 from public.stock_items where sku = 'K1-SCREW'), 'S4 unit uses 1 SUB + 2 screws — screws inside the SUB are not counted again');
reset role; select pg_temp.check((select quantity = 1 and avg_cost = 7.35 from public.stock_items where sku = 'K1-UNIT'), 'S3 MTO output on stock at 7.15 + 0.20 = 7.35'); set role authenticated;
select pg_temp.check(public.ship_lines(:'k1so', jsonb_build_array(jsonb_build_object('line', :'svcline', 'qty', 2))) = 'partially_shipped', 'S3 service line ships first → partially shipped');
select pg_temp.check((select count(*) = 0 from public.stock_movements where source_id = :'svcline'), 'services never move stock');
select pg_temp.check(public.ship_lines(:'k1so', null, 'ship-1') = 'shipped', 'S3 rest ships → shipped');
select pg_temp.check(public.ship_lines(:'k1so', null, 'ship-1') = 'shipped', 'S9 replayed ship is a no-op');
select pg_temp.check((select quantity = 0 from public.stock_items where sku = 'K1-UNIT'), 'S3 unit left stock once');
reset role; select pg_temp.check((select unit_cost = 7.35 and source_type = 'order_line' from public.stock_movements where source_id = :'unitline'), 'S3 shipment linked to its line at cost 7.35'); set role authenticated;
select pg_temp.expect_fail($$delete from public.orders where id = '$$ || :'k1so' || $$'$$, 'deleting a shipped order');
select pg_temp.expect_fail($$delete from public.jobs where order_line_id = '$$ || :'unitline' || $$'$$, 'deleting an MO with booked stock');

-- Scenario 8: partial fulfilment + return. Sell 5 screws, ship 3, return 1 restock + 1 scrap.
insert into public.orders (order_number, customer, kind) values ('', 'K1 Returns', 'order');
select id as k1so2 from public.orders where customer = 'K1 Returns' \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price, sort)
  select :'k1so2', id, sku, name, 5, 1, 0 from public.stock_items where sku = 'K1-SCREW';
select id as rline from public.order_lines where order_id = :'k1so2' \gset
select pg_temp.check(public.ship_lines(:'k1so2', jsonb_build_array(jsonb_build_object('line', :'rline', 'qty', 3))) = 'partially_shipped', 'S8 ship 3 of 5');
select pg_temp.check((select quantity = 87 from public.stock_items where sku = 'K1-SCREW') and (select quantity - shipped = 2 from public.order_lines where id = :'rline'), 'S8 on hand 87, 2 left to ship');
select pg_temp.expect_fail($$select public.ship_lines('$$ || :'k1so2' || $$', jsonb_build_array(jsonb_build_object('line', '$$ || :'rline' || $$', 'qty', 3)))$$, 'shipping more than is left');
select pg_temp.check(public.return_lines(:'k1so2', jsonb_build_array(jsonb_build_object('line', :'rline', 'qty', 1, 'restock', true), jsonb_build_object('line', :'rline', 'qty', 1, 'restock', false)), 'damaged') = 2, 'S8 return 1 to stock, 1 scrapped');
select pg_temp.check((select quantity = 88 from public.stock_items where sku = 'K1-SCREW'), 'S8 only the restocked screw comes back');
select pg_temp.check((select returned = 2 from public.order_lines where id = :'rline') and (select count(*) = 2 from public.order_returns where order_line_id = :'rline'), 'S8 both returns recorded on the line');
select pg_temp.expect_fail($$select public.return_lines('$$ || :'k1so2' || $$', jsonb_build_array(jsonb_build_object('line', '$$ || :'rline' || $$', 'qty', 2)))$$, 'returning more than shipped');
select pg_temp.expect_fail($$update public.orders set status = 'cancelled' where id = '$$ || :'k1so2' || $$'$$, 'cancelling while goods are still with the customer');

-- Reopen restores at booked cost; fractional MO quantity
select public.create_mo('K1-SUB', 'K1 sub again', 1);
select public.complete_mo((select id from public.jobs where title = 'K1 sub again'));
select public.reopen_mo((select id from public.jobs where title = 'K1 sub again'));
reset role; select pg_temp.check((select quantity = 88 and avg_cost = 0.10 from public.stock_items where sku = 'K1-SCREW') and (select quantity = 18 and avg_cost = 6.75 from public.stock_items where sku = 'K1-PANEL')
  and (select quantity = 1 and avg_cost = 7.15 from public.stock_items where sku = 'K1-SUB'), 'reopen puts everything back at the cost it was booked at'); set role authenticated;
select pg_temp.check((select quantity = 0.5 from public.jobs where id = public.create_mo('K1-SUB', 'Half', 0.5)), 'fractional MO quantity kept (no rounding up)');
select pg_temp.expect_fail($$select public.adjust_stock((select id from public.stock_items where sku = 'K1-SVC'), 1, '')$$, 'stocking a service');
select pg_temp.check(public.adjust_stock((select id from public.stock_items where sku = 'K1-SCREW'), -8, 'lost', 'adj-1') = 80
  and public.adjust_stock((select id from public.stock_items where sku = 'K1-SCREW'), -8, 'lost', 'adj-1') = 80, 'S9 double-clicked adjustment books once');
select pg_temp.expect_fail($$delete from public.stock_items where sku = 'K1-SCREW'$$, 'deleting an item with stock history');

-- Scenario 12: valuation reconciles to the ledger, item by item
reset role; select pg_temp.check((select bool_and(abs(s.quantity * s.avg_cost - v.val) < 0.01) from public.stock_items s
  join (select item_id, sum(delta * unit_cost) val from public.stock_movements group by item_id) v on v.item_id = s.id
  where s.sku like 'K1-%'), 'S12 stock value = Σ movement delta × unit cost for every item'); set role authenticated;
reset role; select pg_temp.check((select abs(sum(-delta * unit_cost) - 7.35) < 0.001 from public.stock_movements where job_id = (select id from public.jobs where order_line_id = :'unitline') and reason = 'consume'), 'S12 unit MO cost = 7.35 from its consumption'); set role authenticated;

-- Scenario 10: restricted actions (API level; the UI hides/disables the same buttons)
select pg_temp.check((select count(*) > 0 from public.audit_log where table_name = 'order_lines' and row_id = :'rline'), 'audit log records order line changes');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.ship_lines('$$ || :'k1so2' || $$', null)$$, 'operator ships');
select pg_temp.expect_fail($$select public.return_lines('$$ || :'k1so2' || $$', '[]')$$, 'operator books returns');
select pg_temp.expect_fail($$select public.receive_po_line('$$ || :'screwline' || $$', 1, null, true)$$, 'operator receives');
select pg_temp.expect_fail($$select public.reverse_po_receipt('$$ || :'screwline' || $$', 1)$$, 'operator reverses receipts');
select pg_temp.check((select count(*) = 0 from public.audit_log), 'operators cannot read the audit log');
update public.company_settings set base_currency = 'USD';
select pg_temp.check((select base_currency = 'GBP' from public.company_settings), 'operator cannot change the base currency (RLS: 0 rows)');

-- ============================================================================
-- KORTANA phase 2 acceptance: customers, tax, barcodes, supplier refs, import check
-- ============================================================================
select pg_temp.become(:'B');
select pg_temp.check((select count(*) = 0 from public.orders where customer_id is null and coalesce(customer, '') <> ''), 'every existing order with a customer name is linked to a customer');
select pg_temp.check((select count(*) = 1 from public.customers where name = 'Acme Ltd'), 'two Acme orders → one customer record');
insert into public.orders (order_number, customer, company, email, kind) values ('', 'Jo Pilot', 'Sky Ltd', 'JO@sky.test', 'order');
insert into public.orders (order_number, customer, company, email, kind) values ('', 'Joanna Pilot', '', 'jo@sky.test', 'quote');
select pg_temp.check((select count(distinct customer_id) = 1 from public.orders where lower(email) = 'jo@sky.test'), 'same e-mail → same customer, whatever the spelling');
select pg_temp.check((select count(*) = 2 from public.orders o join public.customers c on c.id = o.customer_id where c.email = 'jo@sky.test'), 'customer order history lists both');
-- export customer is zero-rated: their lines take 0%, everyone else the 20% default
update public.customers set tax_rate_id = (select id from public.tax_rates where rate = 0) where email = 'jo@sky.test';
insert into public.order_lines (order_id, sku, name, quantity, unit_price, sort)
  select id, 'X', 'Export line', 2, 100, 0 from public.orders where email = 'JO@sky.test';
select pg_temp.check((select tax_rate = 0 from public.order_lines where name = 'Export line'), 'zero-rated customer → 0% on the line');
insert into public.order_lines (order_id, sku, name, quantity, unit_price, sort)
  select id, 'X', 'Home line', 2, 100, 0 from public.orders where customer = 'K1 Customer';
select pg_temp.check((select tax_rate = 0.20 from public.order_lines where name = 'Home line'), 'default VAT 20% copied onto the line');
update public.tax_rates set rate = 0.25 where is_default;
select pg_temp.check((select tax_rate = 0.20 from public.order_lines where name = 'Home line'), 'changing the rate later does not rewrite old lines');
update public.tax_rates set rate = 0.20 where is_default;
select pg_temp.expect_fail($$insert into public.tax_rates (name, rate, is_default) values ('Second default', 0.05, true)$$, 'two default tax rates');
-- picking a customer fills the order
insert into public.customers (name, company, email, address) values ('Avia Buyer', 'Avia Sim', 'buy@avia.test', 'Hangar 3, KBFI');
insert into public.orders (order_number, customer, kind, customer_id) select '', '', 'order', id from public.customers where email = 'buy@avia.test';
select pg_temp.check((select customer = 'Avia Buyer' and company = 'Avia Sim' and ship_to = 'Hangar 3, KBFI' from public.orders where email = 'buy@avia.test'), 'order picks up the customer''s details');
-- barcodes + supplier references
update public.stock_items set barcode = '5012345678900' where sku = 'K1-SCREW';
select pg_temp.expect_fail($$update public.stock_items set barcode = '5012345678900' where sku = 'K1-PANEL'$$, 'same barcode on two items');
insert into public.item_suppliers (item_id, supplier_id, supplier_sku, unit_cost, lead_days)
  select s.id, p.id, 'EP-PNL-10', 10, 21 from public.stock_items s, public.suppliers p where s.sku = 'K1-PANEL' and p.name = 'K1 EuroParts';
select pg_temp.check((select count(*) = 1 from public.item_suppliers i join public.stock_items s on s.id = i.item_id where s.sku = 'K1-PANEL' and supplier_sku = 'EP-PNL-10'), 'item keeps a reference per supplier');
-- import check: nothing written, every problem named
select public.check_import('items', $j$[
  {"sku":"K1-SCREW","name":"K1 screw","quantity":"95","avg_cost":"0.12"},
  {"sku":"NEW-1","name":"New thing","quantity":"4"},
  {"sku":"","name":"No sku"},
  {"sku":"BAD-1","quantity":"lots","kind":"gizmo"},
  {"sku":"NEW-1","name":"dup"},
  {"sku":"BAD-2","barcode":"5012345678900"}
]$j$::jsonb) as chk \gset
select pg_temp.check((:'chk'::jsonb->0->>'action') = 'update' and (:'chk'::jsonb->0->'changes') ? 'stock: 80 → 95', 'check: existing item → update, shows stock change');
select pg_temp.check((:'chk'::jsonb->1->>'action') = 'create', 'check: new SKU → create');
select pg_temp.check((:'chk'::jsonb->2->>'action') = 'error', 'check: missing SKU → error');
select pg_temp.check((:'chk'::jsonb->3->>'action') = 'error' and jsonb_array_length(:'chk'::jsonb->3->'problems') = 2, 'check: bad number + bad type both reported');
select pg_temp.check((:'chk'::jsonb->4->>'action') = 'error', 'check: duplicate SKU in the file → error');
select pg_temp.check((:'chk'::jsonb->5->>'action') = 'error', 'check: barcode used by another item → error');
select pg_temp.check((select quantity = 80 from public.stock_items where sku = 'K1-SCREW') and not exists (select 1 from public.stock_items where sku = 'NEW-1'), 'check wrote nothing');
select pg_temp.check((select public.check_import('bom', '[{"product_sku":"K1-UNIT","material_sku":"NOPE","quantity":"1"},{"product_sku":"K1-UNIT","material_sku":"K1-PANEL","quantity":"2"}]')->0->>'action') = 'error', 'check: unknown ingredient → error');
select pg_temp.check(jsonb_array_length(public.recent_activity('customers')) > 0 and (public.recent_activity('customers')->0->>'action') is not null, 'office sees customer activity');
-- base currency locked once stock has a value
select pg_temp.expect_fail($$update public.company_settings set base_currency = 'EUR'$$, 'changing base currency after stock is valued');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.check_import('items', '[]')$$, 'operator runs an import check');
select pg_temp.expect_fail($$select public.recent_activity()$$, 'operator reads activity');
select pg_temp.expect_fail($$insert into public.customers (name) values ('Sneaky')$$, 'operator adds customers');

-- Developer = owner-level access, separate role
select pg_temp.become(:'B');
select role as a1role from public.profiles where id = :'A1' \gset
update public.profiles set role = 'developer' where id = :'A1';
select pg_temp.check((select role = 'developer' from public.profiles where id = :'A1'), 'owner makes someone Developer');
select pg_temp.become(:'A1');
select pg_temp.check(public.is_admin() and public.is_lead() and public.is_stock_keeper(), 'developer has admin, lead and stock rights');
select pg_temp.check(public.create_join_link('operator', '', 24, 1) is not null, 'developer creates invite links like the owner');
select pg_temp.check((select count(*) > 0 from public.join_links), 'developer reads invite links');
select pg_temp.check(jsonb_typeof(public.recent_activity()) = 'array', 'developer reads activity');
select pg_temp.expect_fail($$update public.profiles set role = 'operator' where id = auth.uid()$$, 'developer changes own role');
select pg_temp.become(:'B');
update public.profiles set role = :'a1role' where id = :'A1';

-- Kortana section access: owner decides, others only read
select pg_temp.become(:'B');
select pg_temp.check('insights' = any(public.my_kimera_sections()) and cardinality(public.my_kimera_sections()) = 10, 'owner sees every Kortana section (+ costs)');
select pg_temp.check((select not ('insights' = any(sections)) and 'tickets' = any(sections) from public.kimera_access where role = 'support'), 'support: everything + tickets, no insights by default');
select public.set_kimera_access('support', array['tickets']);
select pg_temp.check((select sections = array['tickets'] from public.kimera_access where role = 'support'), 'owner changes what support sees');
select pg_temp.expect_fail($$update public.kimera_access set sections = array['nope'] where role = 'support'$$, 'unknown section name');
select pg_temp.expect_fail($$insert into public.kimera_access (role, sections) values ('boss', '{}')$$, 'locking the owner out');
select pg_temp.become(:'A2');
update public.kimera_access set sections = array['insights'] where role = 'operator';
select pg_temp.check((select not ('insights' = any(sections)) from public.kimera_access where role = 'operator'), 'operator cannot grant themselves insights (RLS: 0 rows)');
select pg_temp.check(not ('insights' = any(public.my_kimera_sections())), 'operator sections come from the table');
select pg_temp.expect_fail($$select public.set_kimera_access('operator', array['insights'])$$, 'operator changes section access');

-- ADMIN-03: costs only for roles with the 'costs' permission
select pg_temp.become(:'B');
select pg_temp.expect_fail($$select avg_cost from public.stock_items limit 1$$, 'reading avg_cost straight from the API (even the owner)');
select pg_temp.check((public.my_costs('stock_items')->>(select id::text from public.stock_items where sku = 'K1-SUB'))::numeric = 7.15, 'owner gets costs through my_costs()');
select pg_temp.check((select count(*) > 0 from public.stock_items where sku = 'K1-SUB'), 'items stay readable without the cost column');
select pg_temp.become(:'A2');
select pg_temp.check(public.my_costs('stock_items') is null and public.my_costs('stock_movements') is null and public.my_costs('po_lines') is null, 'operator gets no costs');
select pg_temp.expect_fail($$select unit_cost from public.stock_movements limit 1$$, 'operator reads movement costs');
select pg_temp.become(:'B');
select public.set_kimera_access('operator', array['buy']);
select pg_temp.become(:'A2');
select pg_temp.check(public.my_costs('po_lines') is not null and public.my_costs('stock_items') is null, 'Buy access shows PO prices, not stock costs');
select pg_temp.become(:'B');
select public.set_kimera_access('operator', array['costs']);
select pg_temp.become(:'A2');
select pg_temp.check(public.my_costs('stock_items') is not null, 'owner grants costs → operator sees them');
select pg_temp.become(:'B');
select public.set_kimera_access('operator', array[]::text[]);

-- ============================================================================
-- KORTANA phase 3a: locations, per-location stock, transfers (scenario 6)
-- ============================================================================
select pg_temp.become(:'B');
select pg_temp.check((select count(*) = 1 from public.locations where is_default) and (select count(*) = 1 from public.locations where kind = 'transit'), 'default location + in-transit exist');
insert into public.locations (name, kind) values ('Upstairs', 'warehouse');
select id as upstairs from public.locations where name = 'Upstairs' \gset
select id as home from public.locations where is_default \gset
select id as screw from public.stock_items where sku = 'K1-SCREW' \gset
select quantity as screw0 from public.stock_items where sku = 'K1-SCREW' \gset
select public.adjust_stock(:'screw', 10, 'found upstairs', null, :'upstairs');
select pg_temp.check((select quantity = 10 from public.stock_levels where item_id = :'screw' and location_id = :'upstairs'), 'adjustment lands at the chosen location');
select pg_temp.check((select quantity = :screw0 + 10 from public.stock_items where id = :'screw'), 'company total includes every location');
-- S6: transfer 4 screws home → upstairs
insert into public.stock_transfers (from_location, to_location) values (:'home', :'upstairs');
select id as tr from public.stock_transfers order by created_at desc limit 1 \gset
insert into public.transfer_lines (transfer_id, item_id, quantity) values (:'tr', :'screw', 4);
select pg_temp.check(public.post_transfer(:'tr', 'dispatch', 'tr-1') = 'in_transit', 'S6 dispatch → in transit');
select pg_temp.check(public.post_transfer(:'tr', 'dispatch', 'tr-1') = 'in_transit', 'S6 replayed dispatch is a no-op');
select pg_temp.check((select quantity = :screw0 + 10 from public.stock_items where id = :'screw'), 'S6 total unchanged while in transit');
select pg_temp.check((select quantity = 4 from public.stock_levels where item_id = :'screw' and location_id = public.transit_location()), 'S6 4 shown in transit');
select pg_temp.expect_fail($$update public.transfer_lines set quantity = 5 where transfer_id = '$$ || :'tr' || $$'$$, 'changing lines after dispatch');
select pg_temp.expect_fail($$update public.stock_transfers set status = 'received' where id = '$$ || :'tr' || $$'$$, 'marking a transfer received without booking stock');
select pg_temp.check(public.post_transfer(:'tr', 'receive') = 'received', 'S6 receive');
select pg_temp.check((select quantity = 14 from public.stock_levels where item_id = :'screw' and location_id = :'upstairs')
  and (select quantity = 0 from public.stock_levels where item_id = :'screw' and location_id = public.transit_location())
  and (select quantity = :screw0 + 10 from public.stock_items where id = :'screw'), 'S6 upstairs 14, transit 0, company total unchanged');
select pg_temp.check((select count(*) = 4 from public.stock_movements where source_type = 'transfer_line' and reason = 'transfer'), 'S6 four linked transfer movements (out, in transit ×2, in)');
select pg_temp.expect_fail($$delete from public.stock_transfers where id = '$$ || :'tr' || $$'$$, 'deleting a posted transfer');
-- cancel while in transit puts it back
insert into public.stock_transfers (from_location, to_location) values (:'upstairs', :'home');
select id as tr2 from public.stock_transfers order by created_at desc limit 1 \gset
insert into public.transfer_lines (transfer_id, item_id, quantity) values (:'tr2', :'screw', 3);
select public.post_transfer(:'tr2', 'dispatch');
select pg_temp.check(public.post_transfer(:'tr2', 'cancel') = 'cancelled', 'cancel an in-transit transfer');
select pg_temp.check((select quantity = 14 from public.stock_levels where item_id = :'screw' and location_id = :'upstairs'), 'cancelling in transit returns the stock');
-- count at one location only touches that location
select public.count_stock(:'screw', 12, 'shelf count', :'upstairs');
select pg_temp.check((select quantity = 12 from public.stock_levels where item_id = :'screw' and location_id = :'upstairs'), 'count sets that location');
-- receiving into a PO's location
insert into public.purchase_orders (supplier_id, status, location_id) select id, 'ordered', :'upstairs' from public.suppliers where name = 'K1 Screws Ltd';
insert into public.po_lines (po_id, item_id, quantity, unit_cost)
  select (select id from public.purchase_orders where location_id = :'upstairs'), :'screw', 5, 0.10;
select public.receive_po_line((select l.id from public.po_lines l join public.purchase_orders p on p.id = l.po_id where p.location_id = :'upstairs'), 5);
select pg_temp.check((select quantity = 17 from public.stock_levels where item_id = :'screw' and location_id = :'upstairs'), 'PO receipt lands at the PO''s location');
select public.set_bin(:'screw', :'upstairs', 'Rack U3');
select pg_temp.check((select bin = 'Rack U3' from public.stock_levels where item_id = :'screw' and location_id = :'upstairs'), 'bin per location');
-- invariant: locations always add up to the company total
reset role; select pg_temp.check((select bool_and(s.quantity = coalesce(l.total, 0)) from public.stock_items s left join (select item_id, sum(quantity) total from public.stock_levels group by item_id) l on l.item_id = s.id), 'every item: Σ locations = company total'); set role authenticated;
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.post_transfer('$$ || :'tr' || $$', 'cancel')$$, 'operator posts transfers');
select pg_temp.expect_fail($$insert into public.locations (name) values ('Sneaky')$$, 'operator adds locations');

-- ============================================================================
-- KORTANA phase 3b: priority allocation (scenario 2), no over-shipping
-- ============================================================================
select pg_temp.become(:'B');
insert into public.stock_items (sku, name, kind) values ('AL-W', 'Alloc widget', 'product'), ('AL-R', 'Alloc raw', 'material');
select id as alw from public.stock_items where sku = 'AL-W' \gset
select id as alr from public.stock_items where sku = 'AL-R' \gset
select public.adjust_stock(:'alw', 5, 'opening');
insert into public.orders (order_number, customer, kind, ordered_at) values ('', 'Alloc A', 'order', now() - interval '2 days');
insert into public.orders (order_number, customer, kind, ordered_at) values ('', 'Alloc B', 'order', now() - interval '1 day');
select id as soa, order_number as soan from public.orders where customer = 'Alloc A' \gset
select id as sob, order_number as sobn from public.orders where customer = 'Alloc B' \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity, sort) values (:'soa', :'alw', 'AL-W', 'Widget', 4, 0);
insert into public.order_lines (order_id, item_id, sku, name, quantity, sort) values (:'sob', :'alw', 'AL-W', 'Widget', 3, 0);
select id as la from public.order_lines where order_id = :'soa' \gset
select id as lb from public.order_lines where order_id = :'sob' \gset
select public.availability() as av \gset
select pg_temp.check((:'av'::jsonb->'lines'->:'la'->>'status') = 'in_stock' and (:'av'::jsonb->'lines'->:'la'->>'reserved')::numeric = 4, 'S2 older order A: 4 of 5 reserved, in stock');
select pg_temp.check((:'av'::jsonb->'lines'->:'lb'->>'status') = 'not_available' and (:'av'::jsonb->'lines'->:'lb'->>'reserved')::numeric = 1
  and (:'av'::jsonb->'lines'->:'lb'->>'short')::numeric = 2, 'S2 order B: 1 reserved, 2 short');
select pg_temp.check((:'av'::jsonb->'lines'->:'lb'->>'why') like '%' || :'soan' || '%', 'S2 the shortage names the order holding the stock');
select pg_temp.check((:'av'::jsonb->'items'->:'alw'->>'available')::numeric = 0, 'S2 nothing left uncommitted');
-- B is moved ahead of A
select public.set_rank('order', :'sob', :'soa');
select public.availability() as av \gset
select pg_temp.check((:'av'::jsonb->'lines'->:'lb'->>'status') = 'in_stock' and (:'av'::jsonb->'lines'->:'la'->>'status') = 'not_available'
  and (:'av'::jsonb->'lines'->:'la'->>'reserved')::numeric = 2, 'S2 after reprioritising: B in stock, A gets the remaining 2');
-- a PO on the way turns A into Expected with the date and PO number
insert into public.purchase_orders (supplier_id, status, expected_date) select id, 'ordered', current_date + 5 from public.suppliers where name = 'K1 Screws Ltd';
select id as alpo, number as alpon from public.purchase_orders where expected_date = current_date + 5 \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'alpo', :'alw', 10, 1);
select public.availability() as av \gset
select pg_temp.check((:'av'::jsonb->'lines'->:'la'->>'status') = 'expected' and (:'av'::jsonb->'lines'->:'la'->>'date')::date = current_date + 5
  and (:'av'::jsonb->'lines'->:'la'->>'why') like '%' || :'alpon' || '%', 'S2 A expected on the PO date, naming the PO');
-- an MO's ingredients compete too: MTS MO for 2 × (1 AL-R) with no AL-R anywhere → not available
insert into public.bom_lines (product_id, material_id, quantity) values (:'alw', :'alr', 1);
select public.create_mo('AL-W', 'Alloc build', 2) as almo \gset
select public.availability() as av \gset
select pg_temp.check((:'av'::jsonb->'mos'->:'almo'->>'status') = 'not_available' and jsonb_array_length(:'av'::jsonb->'mos'->:'almo'->'short') = 1, 'MO ingredient shortage shown on the MO');
select pg_temp.check((:'av'::jsonb->'lines'->:'la'->>'status') = 'expected', 'the MO output also counts as expected supply');
-- no over-shipping: B ships its 3, A cannot ship 4 from the 2 left
select public.ship_lines(:'sob', null);
select pg_temp.expect_fail($$select public.ship_lines('$$ || :'soa' || $$', null)$$, 'shipping more than is on the shelf');
select pg_temp.check((select quantity = 2 from public.stock_items where id = :'alw'), 'refused shipment left stock untouched');
select pg_temp.expect_fail($$select public.set_rank('job', (select id from public.jobs where order_id is not null limit 1), null)$$, 'reranking an MTO MO directly (it follows its order)');
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.set_rank('order', '$$ || :'soa' || $$', null)$$, 'operator changes priorities');

-- ============================================================================
-- KORTANA phase 4a: pick, partial completion, actual use, unused returned (scenario 5)
-- recipe P5 = 2 × M5A (£1.00) + 1 × M5B (£3.00); MO for 10
-- ============================================================================
select pg_temp.become(:'B');
select public.import_items('[{"sku":"M5A","name":"Bracket","quantity":"30","avg_cost":"1.00"},{"sku":"M5B","name":"Panel","quantity":"10","avg_cost":"3.00"},{"sku":"P5","name":"Assembly","kind":"product"}]'::jsonb);
insert into public.bom_lines (product_id, material_id, quantity)
  select p.id, m.id, v.q from (values ('M5A', 2), ('M5B', 1)) v(sku, q) join public.stock_items m on m.sku = v.sku, public.stock_items p where p.sku = 'P5';
select public.create_mo('P5', 'Assembly ×10', 10) as mo5 \gset
select id as m5a from public.stock_items where sku = 'M5A' \gset
select id as m5b from public.stock_items where sku = 'M5B' \gset
select pg_temp.check(public.pick_mo(:'mo5', null, 'pick-1') = 2, 'S5 pick everything the recipe needs (2 materials)');
select pg_temp.check(public.pick_mo(:'mo5', null, 'pick-1') = 2, 'S5 replayed pick is a no-op');
select public.pick_mo(:'mo5', jsonb_build_array(jsonb_build_object('item', :'m5a', 'qty', 3)));
select pg_temp.check((select quantity = 7 from public.stock_levels where item_id = :'m5a' and location_id = public.default_location())
  and (select quantity = 23 from public.stock_levels where item_id = :'m5a' and location_id = public.wip_location())
  and (select quantity = 30 from public.stock_items where id = :'m5a'), 'S5 picked 23 on the floor, 7 on the shelf, company total still 30');
select public.availability() as av \gset
select pg_temp.check((:'av'::jsonb->'mos'->:'mo5'->>'status') = 'in_stock', 'S5 picked material covers the MO');
select public.create_mo('M5A-USE', 'other', 1);
select pg_temp.check((:'av'::jsonb->'items'->:'m5a'->>'available')::numeric = 7, 'S5 picked material is no longer free for other orders');
-- part 1: make 4 by the recipe → 8 brackets + 4 panels from the floor, output £5.00 each
select pg_temp.check(public.produce_mo(:'mo5', 4, null, 'prod-1') = 'partial', 'S5 complete 4 of 10');
select pg_temp.check(public.produce_mo(:'mo5', 4, null, 'prod-1') = 'partial', 'S5 replayed completion books once');
reset role; select pg_temp.check((select quantity = 4 and avg_cost = 5 from public.stock_items where sku = 'P5'), 'S5 4 made at £5.00 (8×1 + 4×3) / 4'); set role authenticated;
select pg_temp.check((select produced = 4 and status <> 'done' from public.jobs where id = :'mo5'), 'S5 MO shows 4 produced, still open');
-- part 2: make 3, actually used 7 brackets (1 scrapped) and 3 panels
select public.produce_mo(:'mo5', 3, jsonb_build_object(:'m5a', 7, :'m5b', 3));
select pg_temp.check((select picked = 23 and used_from_wip = 15 from public.mo_materials where job_id = :'mo5' and item_id = :'m5a'), 'S5 actual use recorded (8 + 7 brackets)');
select pg_temp.expect_fail($$select public.produce_mo('$$ || :'mo5' || $$', 4)$$, 'completing more than is left (3)');
-- finish the rest the Factory way (status → done): 6 + 3 more, 2 unused brackets go back to the shelf
update public.jobs set status = 'done' where id = :'mo5';
select pg_temp.check((select quantity = 10 from public.stock_items where sku = 'P5') and (select produced = 10 and stock_booked from public.jobs where id = :'mo5'), 'S5 finished: 10 made');
select pg_temp.check((select picked = 23 and used_from_wip = 21 and returned = 2 from public.mo_materials where job_id = :'mo5' and item_id = :'m5a'), 'S5 reconciled: picked 23 = used 21 + returned 2');
select pg_temp.check((select quantity = 9 from public.stock_levels where item_id = :'m5a' and location_id = public.default_location())
  and (select quantity = 0 from public.stock_levels where item_id = :'m5a' and location_id = public.wip_location())
  and (select quantity = 0 from public.stock_levels where item_id = :'m5b' and location_id = public.wip_location()), 'S5 floor empty, unused brackets back on the shelf (9)');
reset role;
select pg_temp.check((select abs(quantity * avg_cost - 51) < 0.01 from public.stock_items where sku = 'P5'), 'S12 assembly value £51 = 21 brackets × £1 + 10 panels × £3');
select pg_temp.check((select abs(sum(-delta * unit_cost) - 51) < 0.001 from public.stock_movements where job_id = :'mo5' and reason = 'consume'), 'S12 MO material cost £51 from its consumption');
set role authenticated;
-- reopen reverses everything at the location it happened
select public.reopen_mo(:'mo5');
select pg_temp.check((select quantity = 0 from public.stock_items where sku = 'P5') and (select produced = 0 from public.jobs where id = :'mo5')
  and (select quantity = 21 from public.stock_levels where item_id = :'m5a' and location_id = public.wip_location()), 'reopen: output removed, used material back on the floor for this MO');
reset role; select pg_temp.check((select bool_and(s.quantity = coalesce(l.total, 0)) from public.stock_items s left join (select item_id, sum(quantity) total from public.stock_levels group by item_id) l on l.item_id = s.id), 'every item: Σ locations = company total (after picking)'); set role authenticated;
select pg_temp.become(:'A2');
select pg_temp.expect_fail($$select public.pick_mo('$$ || :'mo5' || $$')$$, 'operator not on the job picks materials');

-- ============================================================================
-- KORTANA phase 4b: operations + costs (MFG-08/09/14/15). P5 ×10: setup 30 min + 6 min/unit
-- at £30/h + £5 fixed = £50 planned operations; materials £50 planned (10 × (2×£1 + 1×£3))
-- ============================================================================
select pg_temp.become(:'B');
update public.company_settings set labour_rate = 20, work_hours_per_day = 8;
insert into public.stations (name, cost_per_hour) values ('Assembly bench', 30);
insert into public.product_operations (product_id, station_id, name, setup_minutes, unit_minutes, fixed_cost)
  select p.id, s.id, 'Assemble', 30, 6, 5 from public.stock_items p, public.stations s where p.sku = 'P5' and s.name = 'Assembly bench';
select public.mo_costs(:'mo5') as mc \gset
select pg_temp.check((:'mc'::jsonb->>'operations_planned')::numeric = 50 and (:'mc'::jsonb->>'minutes_planned')::numeric = 90, 'operations planned: 90 min → £45 + £5 fixed = £50');
reset role; select (select avg_cost from public.stock_items where sku = 'M5A') * 20 + (select avg_cost from public.stock_items where sku = 'M5B') * 10 as matplan \gset
set role authenticated;
select pg_temp.check(abs((:'mc'::jsonb->>'materials_planned')::numeric - :matplan) < 0.01, 'materials planned = recipe × qty at current average cost');
select pg_temp.check((:'mc'::jsonb->>'estimated_finish')::date = current_date + 1, '90 min left at 8 h/day → finishes in 1 working day');
-- 2 h logged on the job → £40 labour at £20/h
insert into public.work_sessions (job_id, started_by, started_at) values (:'mo5', :'B', now() - interval '2 hours');
insert into public.participants (session_id, job_id, user_id, joined_at, left_at)
  select id, :'mo5', :'B', now() - interval '2 hours', now() from public.work_sessions where job_id = :'mo5' order by started_at desc limit 1;
select public.mo_costs(:'mo5') as mc \gset
select pg_temp.check(abs((:'mc'::jsonb->>'labour_hours')::numeric - 2) < 0.01 and abs((:'mc'::jsonb->>'labour_actual')::numeric - 40) < 0.5, 'actual labour: 2 h × £20 = £40 from logged time');
select pg_temp.become(:'A2');
select pg_temp.check(public.mo_costs(:'mo5') is null, 'operators without Costs & margins get no MO costs');

-- ============================================================================
-- KORTANA phase 4c: batches, expiry, serials, trace (scenario 7)
-- ============================================================================
select pg_temp.become(:'B');
insert into public.stock_items (sku, name, kind, tracking) values ('LT-MAT', 'Resin', 'material', 'batch'), ('LT-PROD', 'Moulded part', 'product', 'batch'), ('LT-SER', 'Control unit', 'product', 'serial');
select id as ltmat from public.stock_items where sku = 'LT-MAT' \gset
select id as ltprod from public.stock_items where sku = 'LT-PROD' \gset
select id as ltser from public.stock_items where sku = 'LT-SER' \gset
insert into public.bom_lines (product_id, material_id, quantity) values (:'ltprod', :'ltmat', 2);
insert into public.purchase_orders (supplier_id, status) select id, 'ordered' from public.suppliers where name = 'K1 Screws Ltd';
select id as ltpo, number as ltpon from public.purchase_orders order by created_at desc limit 1 \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'ltpo', :'ltmat', 15, 2), (:'ltpo', :'ltser', 3, 50);
select id as ltl1 from public.po_lines where po_id = :'ltpo' and item_id = :'ltmat' \gset
select id as ltl2 from public.po_lines where po_id = :'ltpo' and item_id = :'ltser' \gset
select public.receive_po_line(:'ltl1', 10, null, false, 'L-100', current_date + 30);
select public.receive_po_line(:'ltl1', 5, null, false, 'L-200', current_date + 10);
select id as l100 from public.lots where code = 'L-100' \gset
select id as l200 from public.lots where code = 'L-200' \gset
select pg_temp.check((select quantity = 10 from public.lot_levels where lot_id = :'l100') and (select quantity = 5 from public.lot_levels where lot_id = :'l200'), 'S7 two batches received with their expiry dates');
-- MO for 3 needs 6 resin: first-expiry-first-out takes all of L-200 (5) then 1 of L-100
select public.create_mo('LT-PROD', 'Mould 3', 3) as ltmo \gset
select code as ltmocode from public.jobs where id = :'ltmo' \gset
select public.complete_mo(:'ltmo');
select pg_temp.check((select quantity = 0 from public.lot_levels where lot_id = :'l200') and (select quantity = 9 from public.lot_levels where lot_id = :'l100'), 'S7 FEFO: the batch expiring first is used first');
select id as outlot from public.lots where item_id = :'ltprod' and code = :'ltmocode' \gset
select pg_temp.check((select quantity = 3 from public.lot_levels where lot_id = :'outlot'), 'S7 output batch named after the MO');
select pg_temp.check((select count(*) = 2 and sum(quantity) = 6 from public.lot_links where parent_lot = :'outlot'), 'S7 output linked to both resin batches (5 + 1)');
-- ship 2 to a customer
insert into public.orders (order_number, customer, company, kind) values ('', 'Trace Buyer', 'Trace Co', 'order');
select id as ltso, order_number as ltson from public.orders where customer = 'Trace Buyer' \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity) values (:'ltso', :'ltprod', 'LT-PROD', 'Moulded part', 2);
select public.ship_lines(:'ltso', null);
select public.trace_lot(:'l100') as tr \gset
select pg_temp.check((:'tr'::jsonb->'shipped'->0->>'order') = :'ltson' and (:'tr'::jsonb->'shipped'->0->>'company') = 'Trace Co', 'S7 resin batch L-100 traced forward to the customer order');
select pg_temp.check((:'tr'::jsonb->'went_into'->0->>'lot') = :'ltmocode', 'S7 … through the MO batch it went into');
select pg_temp.check((:'tr'::jsonb->'received'->0->>'po') = :'ltpon', 'S7 … and back to the PO it arrived on');
select public.trace_lot(:'outlot') as tr2 \gset
select pg_temp.check(jsonb_array_length(:'tr2'::jsonb->'made_from') = 2 and (:'tr2'::jsonb->'made_from'->0->'received'->0->>'po') = :'ltpon', 'S7 finished batch traced back to both resin batches and their PO');
-- undoing the shipment puts it back into the same batch
select public.unship_lines(:'ltso', null);
select pg_temp.check((select quantity = 3 from public.lot_levels where lot_id = :'outlot'), 'undo shipment returns stock into the batch it left');
-- serials: one lot per piece
select public.receive_po_line(:'ltl2', 3, null, false, 'CU');
select pg_temp.check((select count(*) = 3 from public.lots where item_id = :'ltser') and (select bool_and(quantity = 1) from public.lot_levels ll join public.lots l on l.id = ll.lot_id where l.item_id = :'ltser'), 'serial items: one serial number per piece (CU-001…003)');
select pg_temp.expect_fail($$select public.receive_po_line('$$ || :'ltl1' || $$', 0.5)$$, 'receiving beyond the ordered quantity of a batch line');
reset role; select pg_temp.check((select bool_and(s.quantity = coalesce(l.total, 0)) from public.stock_items s left join (select item_id, sum(quantity) total from public.stock_levels group by item_id) l on l.item_id = s.id), 'every item: Σ locations = company total (with lots)');
select pg_temp.check((select bool_and(lv.total <= sl.quantity + 0.0001) from (select lo.item_id, ll.location_id, sum(ll.quantity) total from public.lot_levels ll join public.lots lo on lo.id = ll.lot_id group by 1, 2) lv
  join public.stock_levels sl on sl.item_id = lv.item_id and sl.location_id = lv.location_id), 'lots never add up to more than the location holds'); set role authenticated;

-- ---------------------------------------------------------------- phase 5: outsourcing
insert into public.suppliers (name, currency) values ('Powder Co', 'GBP');
select id as osup from public.suppliers where name = 'Powder Co' \gset
insert into public.locations (name, kind, supplier_id) values ('Powder Co (contractor)', 'partner', :'osup');
select id as oloc from public.locations where name = 'Powder Co (contractor)' \gset
insert into public.stock_items (sku, name, kind) values ('OUT-MAT', 'Raw obudowa', 'material'), ('OUT-PROD', 'Coated obudowa', 'product');
select id as omat from public.stock_items where sku = 'OUT-MAT' \gset
select id as oprod from public.stock_items where sku = 'OUT-PROD' \gset
insert into public.bom_lines (product_id, material_id, quantity) values (:'oprod', :'omat', 2);
insert into public.purchase_orders (supplier_id, status) values (:'osup', 'ordered') returning id as obuy \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'obuy', :'omat', 20, 4) returning id as obuyl \gset
select public.receive_po_line(:'obuyl', 20);
insert into public.purchase_orders (supplier_id, status, kind) values (:'osup', 'draft', 'outsourced') returning id as opo \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'opo', :'oprod', 5, 10) returning id as opl \gset
select pg_temp.check((select quantity_per = 2 from public.po_materials where po_line_id = :'opl' and item_id = :'omat'), 'OUT-02 outsourced PO line takes its materials from the recipe');
select pg_temp.expect_fail($$update public.purchase_orders set status = 'ordered' where id = '$$ || :'opo' || $$'$$, 'ordering an outsourced PO without a contractor location');
select pg_temp.expect_fail($$update public.purchase_orders set partner_location_id = public.default_location() where id = '$$ || :'opo' || $$'$$, 'a non-partner location as the contractor');
update public.purchase_orders set partner_location_id = :'oloc', status = 'ordered' where id = :'opo';
select public.availability() as oav \gset
select pg_temp.check((:'oav'::jsonb->'mos'->:'opo'->>'status') = 'not_available', 'OUT-06 allocation: the contractor has none of the materials yet');
select public.send_po_materials(:'opo') as otr \gset
select pg_temp.check((select quantity = 10 from public.transfer_lines where transfer_id = :'otr' and item_id = :'omat'), 'OUT-04 send materials: a transfer of exactly what the contractor needs (10)');
select public.post_transfer(:'otr', 'dispatch');
select public.post_transfer(:'otr', 'receive');
select pg_temp.check((select quantity = 10 from public.stock_levels where item_id = :'omat' and location_id = :'oloc'), 'OUT-03 our stock is visible at the contractor');
select public.availability() as oav \gset
select pg_temp.check((:'oav'::jsonb->'mos'->:'opo'->>'status') = 'in_stock', 'OUT-06 allocation: contractor now has everything');
select pg_temp.check((:'oav'::jsonb->'items'->:'omat'->>'reserved')::numeric = 10, 'materials at the contractor are reserved for the PO');
select pg_temp.check(public.receive_po_line(:'opl', 3) = 'partial', 'OUT-05 receive 3 finished pieces');
select pg_temp.check((select quantity = 4 from public.stock_levels where item_id = :'omat' and location_id = :'oloc'), 'OUT-05 receipt consumed 6 materials at the contractor');
select pg_temp.check((select quantity = 3 from public.stock_levels where item_id = :'oprod' and location_id = public.default_location()), 'OUT-05 finished goods arrive at our location');
reset role;
select pg_temp.check((select avg_cost = 18 from public.stock_items where id = :'oprod'), 'OUT-05 cost = contractor fee 10 + materials 2 × £4');
select pg_temp.check((select avg_cost = 4 from public.stock_items where id = :'omat'), 'material cost unchanged by the transfer and consumption');
set role authenticated;
select pg_temp.expect_fail($$update public.po_materials set quantity_per = 3 where po_line_id = '$$ || :'opl' || $$'$$, 'changing materials after a receipt');
select pg_temp.expect_fail($$update public.purchase_orders set kind = 'standard' where id = '$$ || :'opo' || $$'$$, 'switching a received PO back to standard');
select public.reverse_po_receipt(:'opl', 1);
select pg_temp.check((select quantity = 6 from public.stock_levels where item_id = :'omat' and location_id = :'oloc')
  and (select quantity = 2 from public.stock_items where id = :'oprod')
  and (select consumed = 4 from public.po_materials where po_line_id = :'opl'), 'reversal: product out, its materials back with the contractor');
reset role; select pg_temp.check((select avg_cost = 18 from public.stock_items where id = :'oprod'), 'reversal leaves product cost unchanged'); set role authenticated;
select pg_temp.expect_fail($$select public.send_po_materials('$$ || :'opo' || $$')$$, 'sending materials the contractor already has');
select pg_temp.check(public.receive_po_line(:'opl', 3) = 'received', 'finish the outsourced PO');
select pg_temp.check((select quantity = 0 from public.stock_levels where item_id = :'omat' and location_id = :'oloc'), 'contractor used all the materials');
reset role; select pg_temp.check((select bool_and(s.quantity = coalesce(l.total, 0)) from public.stock_items s left join (select item_id, sum(quantity) total from public.stock_levels group by item_id) l on l.item_id = s.id), 'every item: Σ locations = company total (with contractors)'); set role authenticated;

-- ---------------------------------------------------------------- removing staff
select pg_temp.become(null);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'dev@x.test', '{"full_name":"Dee Dev"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'mgr@x.test', '{"full_name":"Max Manager"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'ast@x.test', '{"full_name":"Ann Assistant"}'),
  ('00000000-0000-0000-0000-0000000000d4', 'opr@x.test', '{"full_name":"Oscar Operator"}');
update public.profiles set active = true, role = 'developer' where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set active = true, role = 'manager' where id = '00000000-0000-0000-0000-0000000000d2';
update public.profiles set active = true, role = 'assistant' where id = '00000000-0000-0000-0000-0000000000d3';
update public.profiles set active = true, role = 'operator' where id = '00000000-0000-0000-0000-0000000000d4';
insert into public.shifts (user_id, clock_in) values ('00000000-0000-0000-0000-0000000000d4', now() - interval '2 hours');
select pg_temp.become('00000000-0000-0000-0000-0000000000d3');
select pg_temp.expect_fail($$select public.remove_staff('00000000-0000-0000-0000-0000000000d2')$$, 'assistant removes a manager');
select pg_temp.expect_fail($$select public.remove_staff('00000000-0000-0000-0000-0000000000d3')$$, 'removing yourself');
select pg_temp.check(public.remove_staff('00000000-0000-0000-0000-0000000000d4') = 'removed', 'assistant removes an operator');
select pg_temp.become(null);
select pg_temp.check((select not active and removed_at is not null from public.profiles where id = '00000000-0000-0000-0000-0000000000d4'), 'removed person loses access');
select pg_temp.check((select count(*) = 0 from public.shifts where user_id = '00000000-0000-0000-0000-0000000000d4' and clock_out is null)
  and (select count(*) = 1 from public.shifts where user_id = '00000000-0000-0000-0000-0000000000d4'), 'their open shift is closed and their history kept');
select pg_temp.become('00000000-0000-0000-0000-0000000000d4');
select pg_temp.check((select count(*) = 0 from public.stock_items), 'a removed person sees nothing');
select pg_temp.become('00000000-0000-0000-0000-0000000000d2');
select pg_temp.expect_fail($$select public.remove_staff('00000000-0000-0000-0000-0000000000d1')$$, 'manager removes a developer');
select pg_temp.expect_fail($$update public.profiles set removed_at = now() where id = '00000000-0000-0000-0000-0000000000d3'$$, 'manager sets removed_at directly');
select pg_temp.check(public.restore_staff('00000000-0000-0000-0000-0000000000d4') = 'active', 'manager restores the operator');
select pg_temp.check((select active and removed_at is null from public.profiles where id = '00000000-0000-0000-0000-0000000000d4'), 'restored person is active again');
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.check(public.remove_staff('00000000-0000-0000-0000-0000000000d2') = 'removed', 'developer removes a manager');
select pg_temp.become(null);
update public.profiles set role = 'operator' where role in ('boss') and id <> '00000000-0000-0000-0000-0000000000d1';
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.check((select count(*) = 1 from public.profiles where role in ('boss','developer') and active and removed_at is null), 'only one owner/developer left');

-- ---------------------------------------------------------------- phase 5a: warehouse tasks
-- d1 developer, d3 assistant, d4 operator (active again)
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
insert into public.purchase_orders (supplier_id, status) values (:'osup', 'ordered') returning id as wpo \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'wpo', :'omat', 5, 4) returning id as wpl \gset
select pg_temp.expect_fail($$insert into public.wh_tasks (kind, source_id, assigned_to) values ('receive', '$$ || :'wpo' || $$', '00000000-0000-0000-0000-0000000000d4')$$, 'assigning warehouse work to an operator');
insert into public.wh_tasks (kind, source_id, assigned_to) values ('receive', :'wpo', '00000000-0000-0000-0000-0000000000d3') returning id as wt1 \gset
select pg_temp.expect_fail($$insert into public.wh_tasks (kind, source_id) values ('receive', '$$ || :'wpo' || $$')$$, 'two open tasks for the same PO');
select pg_temp.expect_fail($$insert into public.wh_tasks (kind, source_id) values ('pick', '$$ || :'wpo' || $$')$$, 'a pick task pointing at a PO');
select pg_temp.become('00000000-0000-0000-0000-0000000000d4');
select pg_temp.expect_fail($$select public.wh_task_step('$$ || :'wt1' || $$', 'start')$$, 'someone else starts my task');
select pg_temp.become('00000000-0000-0000-0000-0000000000d3');
select pg_temp.check(public.wh_task_step(:'wt1', 'start') = 'in_progress', 'WH-03 assignee starts the receiving task');
update public.wh_tasks set status = 'done' where id = :'wt1';
select pg_temp.check((select status = 'in_progress' from public.wh_tasks where id = :'wt1'), 'assistant cannot edit the task row directly');
select public.receive_po_line(:'wpl', 5);
select pg_temp.check((select status = 'done' and done_by = '00000000-0000-0000-0000-0000000000d3' from public.wh_tasks where id = :'wt1'), 'WH-09 receiving the whole PO closes the task');
-- pick + ship by an assistant
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
insert into public.orders (order_number, customer, kind) values ('', 'Warehouse Buyer', 'order') returning id as wso \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity) values (:'wso', :'omat', 'OUT-MAT', 'Raw obudowa', 3) returning id as wsl \gset
insert into public.wh_tasks (kind, source_id, assigned_to) values ('pick', :'wso', '00000000-0000-0000-0000-0000000000d3') returning id as wt2 \gset
select pg_temp.become('00000000-0000-0000-0000-0000000000d3');
select pg_temp.check(public.wh_task_step(:'wt2', 'done') = 'done', 'assistant finishes picking');
select pg_temp.check((select delivery = 'packed' from public.orders where id = :'wso'), 'WH-05 finished pick marks the order packed');
select pg_temp.expect_fail($$select public.ship_lines('$$ || :'wso' || $$', null)$$, 'assistant ships an order without a ship task');
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
insert into public.wh_tasks (kind, source_id, assigned_to) values ('ship', :'wso', '00000000-0000-0000-0000-0000000000d3') returning id as wt3 \gset
select pg_temp.become('00000000-0000-0000-0000-0000000000d3');
select public.ship_lines(:'wso', jsonb_build_array(jsonb_build_object('line', :'wsl', 'qty', 1)));
select pg_temp.check((select status = 'open' from public.wh_tasks where id = :'wt3') and (select shipped = 1 from public.order_lines where id = :'wsl'), 'WH-07 assigned assistant ships part of the order; task stays open');
select public.ship_lines(:'wso', null);
select pg_temp.check((select status = 'done' from public.wh_tasks where id = :'wt3'), 'shipping the rest closes the ship task');
-- count task
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect_fail($$insert into public.wh_tasks (kind, source_id) values ('count', '$$ || :'wpo' || $$')$$, 'a count task tied to a document');
insert into public.wh_tasks (kind, items, assigned_to) values ('count', array[:'omat'::uuid], '00000000-0000-0000-0000-0000000000d3') returning id as wt4 \gset
select pg_temp.check((select location_id = public.default_location() from public.wh_tasks where id = :'wt4'), 'count task defaults to the main location');
update public.wh_tasks set status = 'cancelled' where id = :'wt4';
select pg_temp.check((select status = 'cancelled' from public.wh_tasks where id = :'wt4'), 'office can cancel a task');

-- ---------------------------------------------------------------- phase 6a: planning
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
insert into public.stock_items (sku, name, kind, min_quantity, lead_days) values ('PL-MAT', 'Planned panel', 'material', 5, 7) returning id as plm \gset
insert into public.purchase_orders (supplier_id, status) values (:'osup', 'ordered') returning id as plpo \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'plpo', :'plm', 40, 2) returning id as plpl \gset
select public.receive_po_line(:'plpl', 40);
insert into public.orders (order_number, customer, kind) values ('', 'History Buyer', 'order') returning id as plso \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity) values (:'plso', :'plm', 'PL-MAT', 'Planned panel', 24) returning id as plsl \gset
select public.ship_lines(:'plso', jsonb_build_array(jsonb_build_object('line', :'plsl', 'qty', 3))) from generate_series(1, 8);
-- move the 8 shipments back into the last 8 complete weeks (history)
select pg_temp.become(null);
set session_replication_role = replica;
with s as (select id, row_number() over (order by created_at, id) n from public.stock_movements where item_id = :'plm' and reason = 'ship')
update public.stock_movements m set created_at = date_trunc('week', now()) - make_interval(weeks => s.n::int) + interval '2 days' from s where m.id = s.id;
set session_replication_role = origin;
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
-- booked sale of 5 due in two weeks, a PO of 10 arriving in three
insert into public.orders (order_number, customer, kind, delivery_deadline) values ('', 'Future Buyer', 'order', date_trunc('week', current_date)::date + 15) returning id as plso2 \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity) values (:'plso2', :'plm', 'PL-MAT', 'Planned panel', 5);
insert into public.purchase_orders (supplier_id, status, expected_date) values (:'osup', 'ordered', date_trunc('week', current_date)::date + 22) returning id as plpo2 \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'plpo2', :'plm', 10, 2);
select public.plan_item(:'plm', null, 12) as pl \gset
select pg_temp.check((:'pl'::jsonb->>'opening')::numeric = 16, 'PLAN-01 opening stock = 40 received − 24 shipped');
select pg_temp.check((:'pl'::jsonb->'forecast'->>'weekly')::numeric = 2.615 and (:'pl'::jsonb->'forecast'->>'enough_history')::boolean, 'PLAN-02 automatic forecast = weighted 12-week average (204/78 = 2.615 a week)');
select pg_temp.check((:'pl'::jsonb->'weeks'->2->>'demand')::numeric = 5 and (:'pl'::jsonb->'weeks'->2->>'orders')::numeric = 5, 'booked sales (5) use up the forecast that week instead of adding to it');
select pg_temp.check((:'pl'::jsonb->'weeks'->3->>'receipts')::numeric = 10, 'PLAN-01 PO receipt lands in its expected week');
select pg_temp.check((:'pl'::jsonb->'weeks'->6->>'closing')::numeric = 5.31 and (:'pl'::jsonb->'weeks'->7->>'closing')::numeric = 2.695, 'projected closing stock week by week');
select pg_temp.check((:'pl'::jsonb->'recommendation'->>'action') = 'buy' and (:'pl'::jsonb->'recommendation'->>'quantity')::numeric = 13
  and (:'pl'::jsonb->'recommendation'->>'short_week')::date = date_trunc('week', current_date)::date + 49, 'PLAN-06 recommendation: buy 13 before the week stock drops below the reorder point');
select pg_temp.check((:'pl'::jsonb->'recommendation'->>'order_by')::date = date_trunc('week', current_date)::date + 42, 'PLAN-06 order by = shortage week − 7 days lead time');
select pg_temp.check((:'pl'::jsonb->'weeks'->0->>'forecast_source') = 'auto', 'PLAN-05 automatic weeks are marked auto');
-- manual override for this week (PLAN-03/05/07)
insert into public.forecast_overrides (item_id, period, period_start, quantity, note) values (:'plm', 'week', date_trunc('week', current_date)::date, 10, 'Trade show');
select public.plan_item(:'plm', null, 12) as pl2 \gset
select pg_temp.check((:'pl2'::jsonb->'weeks'->0->>'forecast_source') = 'manual' and (:'pl2'::jsonb->'weeks'->0->>'demand')::numeric = 10, 'PLAN-03/05 a weekly override replaces the forecast and is marked manual');
select pg_temp.check((:'pl2'::jsonb->'recommendation'->>'quantity')::numeric = 21, 'PLAN-07 the override flows into the projection and the recommendation (13 + 7.385 → 21)');
select pg_temp.expect_fail($$insert into public.forecast_overrides (item_id, period, period_start, quantity) values ('$$ || :'plm' || $$', 'week', current_date + (8 - extract(isodow from current_date))::int + 1, 1)$$, 'a weekly override not starting on a Monday');
-- monthly override for a new product with no history (PLAN-04)
insert into public.stock_items (sku, name, kind, min_quantity) values ('PL-NEW', 'Brand new panel', 'material', 0) returning id as pln \gset
select public.plan_item(:'pln', null, 8) as pl3 \gset
select pg_temp.check((:'pl3'::jsonb->'forecast'->>'enough_history')::boolean = false and (:'pl3'::jsonb->'weeks'->0->>'forecast_source') = 'none', 'PLAN-04 a new product has no automatic forecast');
insert into public.forecast_overrides (item_id, period, period_start, quantity) select :'pln', 'month', m, extract(day from m + interval '1 month' - interval '1 day') from (select date_trunc('month', date_trunc('week', current_date)::date + 3)::date m) x;
select public.plan_item(:'pln', null, 8) as pl4 \gset
select pg_temp.check((:'pl4'::jsonb->'weeks'->0->>'forecast')::numeric = 7 and (:'pl4'::jsonb->'weeks'->0->>'forecast_source') = 'manual' and (:'pl4'::jsonb->'recommendation'->>'action') = 'buy',
  'PLAN-04 a monthly override of one a day becomes 7 a week and triggers a buy');
-- location-specific planning (PLAN-08)
select public.plan_item(:'plm', :'oloc', 4) as pl5 \gset
select pg_temp.check((:'pl5'::jsonb->>'opening')::numeric = 0 and (:'pl5'::jsonb->'forecast'->>'weekly')::numeric = 0, 'PLAN-08 planning at one location only counts that location');
select pg_temp.check(jsonb_array_length(public.plan_overview(null, 12)) >= 2 and exists (select 1 from jsonb_array_elements(public.plan_overview(null, 12)) x where x->'item'->>'sku' = 'PL-MAT'), 'plan overview lists items needing action');
select pg_temp.become('00000000-0000-0000-0000-0000000000d3');
insert into public.forecast_overrides (item_id, period, period_start, quantity) select :'plm', 'week', date_trunc('week', current_date)::date + 7, 1 where false;
select pg_temp.expect_fail($$insert into public.forecast_overrides (item_id, period, period_start, quantity) values ('$$ || :'plm' || $$', 'week', date_trunc('week', current_date)::date + 7, 1)$$, 'assistant sets a forecast');

-- ---------------------------------------------------------------- phase 6b: reports (REP-09 reconciliation)
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
insert into public.orders (order_number, customer, company, kind) values ('', 'Report Buyer', 'Report Co', 'order') returning id as rso \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price) values (:'rso', :'plm', 'PL-MAT', 'Planned panel', 2, 50) returning id as rsl \gset
select public.ship_lines(:'rso', null);
select public.report('sales', current_date - 400, current_date, 'customer') as rs \gset
select pg_temp.check(exists (select 1 from jsonb_array_elements(:'rs'::jsonb->'rows') x where x->>'key' = 'Report Co' and (x->>'revenue')::numeric = 100 and (x->>'cost')::numeric = 4 and (x->>'margin')::numeric = 96),
  'REP-01 sales by customer: 2 × £50 revenue, cost 2 × £2, margin £96');
reset role; select coalesce(sum(-m.delta * m.unit_cost), 0) as ledger_cogs from public.stock_movements m where m.source_type = 'order_line' and m.reason in ('ship', 'return') \gset
set role authenticated;
select pg_temp.check(abs((:'rs'::jsonb->'totals'->>'cost')::numeric - :ledger_cogs) < 0.01, 'REP-09 sales cost reconciles with the ledger');
select public.report('inventory', current_date - 400, current_date) as ri \gset
reset role;
select pg_temp.check(not exists (select 1 from jsonb_array_elements(:'ri'::jsonb->'rows') x join public.stock_items s on s.id = (x->>'item_id')::uuid where (x->>'closing')::numeric <> s.quantity)
  and (select count(*) from public.stock_items where kind <> 'service' and not archived and quantity <> 0) = (select count(*) from jsonb_array_elements(:'ri'::jsonb->'rows') x where (x->>'closing')::numeric <> 0),
  'REP-02/09 inventory closing = every item''s stock on hand');
set role authenticated;
select public.report('inventory', current_date - 400, current_date, null, :'oloc') as ril \gset
reset role;
select pg_temp.check(not exists (select 1 from jsonb_array_elements(:'ril'::jsonb->'rows') x where (x->>'closing')::numeric <> coalesce((select quantity from public.stock_levels where item_id = (x->>'item_id')::uuid and location_id = :'oloc'), 0)),
  'REP-02/09 inventory at one location = that location''s stock levels');
select coalesce(sum(-delta), 0) as ledger_consumed from public.stock_movements where reason = 'consume' \gset
set role authenticated;
select pg_temp.check((public.report('consumption', current_date - 400, current_date)->'totals'->>'qty')::numeric = :ledger_consumed, 'REP-05/09 consumption reconciles with the ledger');
select public.report('manufacturing', current_date - 400, current_date) as rm \gset
select pg_temp.check(not exists (select 1 from jsonb_array_elements(:'rm'::jsonb->'rows') x where (x->>'materials')::numeric <> ((public.mo_costs((x->>'job_id')::uuid))->>'materials_actual')::numeric)
  and jsonb_array_length(:'rm'::jsonb->'rows') > 0, 'REP-04/09 MO material cost = the MO cost card, for every finished MO');
select pg_temp.check((public.report('purchasing', current_date - 400, current_date)->'totals'->>'pos')::int
  = (select count(*) from public.purchase_orders where ordered_at >= current_date - 400 and status <> 'cancelled'), 'REP-03/09 purchasing counts every ordered PO');
select pg_temp.check((public.report('production', current_date - 400, current_date)->'totals'->>'mos_done')::int = (select count(*) from public.jobs where status = 'done' and completed_at >= current_date - 400), 'REP-06 production totals');
select pg_temp.expect_fail($$select public.report('sales', current_date, current_date - 1)$$, 'a date range that ends before it starts');
select pg_temp.become('00000000-0000-0000-0000-0000000000d4');
select pg_temp.expect_fail($$select public.report('sales', current_date - 30, current_date)$$, 'operator opens reports');

-- ---------------------------------------------------------------- phase 6c: API keys + webhooks
select pg_temp.become('00000000-0000-0000-0000-0000000000d2');
select pg_temp.expect_fail($$select public.create_api_key('Zapier')$$, 'a manager creates an API key');
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
select public.create_api_key('Zapier', array['read', 'write']) as ak \gset
select pg_temp.check((:'ak'::jsonb->>'key') like 'kt\_%' and length(:'ak'::jsonb->>'key') = 51, 'INT-08 the new key is shown once (kt_…)');
select pg_temp.expect_fail($$select key_hash from public.api_keys$$, 'the app reads key hashes');
select pg_temp.check((select prefix from public.api_keys where id = (:'ak'::jsonb->>'id')::uuid) = left(:'ak'::jsonb->>'key', 10), 'only the prefix is visible');
select pg_temp.expect_fail($$select public.verify_api_key('x')$$, 'the app calls verify_api_key');
reset role;
select pg_temp.check(public.verify_api_key(:'ak'::jsonb->>'key') = array['read', 'write'], 'INT-06 a valid key returns its scopes');
select pg_temp.check(public.verify_api_key('kt_wrong') is null, 'a wrong key is refused');
set role authenticated;
select public.revoke_api_key((:'ak'::jsonb->>'id')::uuid);
reset role; select pg_temp.check(public.verify_api_key(:'ak'::jsonb->>'key') is null, 'a revoked key stops working'); set role authenticated;
-- webhooks
select pg_temp.expect_fail($$select public.create_webhook('http://insecure.test/hook', array['order.created'])$$, 'a webhook over plain http');
select pg_temp.expect_fail($$select public.create_webhook('https://x.test/hook', array['order.deleted'])$$, 'a webhook for an unknown event');
select public.create_webhook('https://hooks.example.test/kortana', array['order.created', 'order.shipped', 'stock.low']) as wh \gset
select (:'wh'::jsonb->>'id') as whid \gset
select pg_temp.check((:'wh'::jsonb->>'secret') like 'whsec\_%', 'INT-07 the signing secret is shown once');
select pg_temp.expect_fail($$select secret from public.webhooks$$, 'the app reads webhook secrets');
insert into public.orders (order_number, customer, kind) values ('', 'Hook Buyer', 'order') returning id as hso \gset
select pg_temp.check((select count(*) from public.webhook_deliveries d join public.webhook_events e on e.id = d.event_id
  where e.type = 'order.created' and e.data->>'id' = :'hso' and d.webhook_id = :'whid') = 1, 'INT-07 a new order queues an order.created delivery');
insert into public.order_lines (order_id, item_id, sku, name, quantity) values (:'hso', :'plm', 'PL-MAT', 'Planned panel', 1);
select public.ship_lines(:'hso', null);
select pg_temp.check((select count(*) from public.webhook_events where type = 'order.shipped' and data->>'id' = :'hso' and jsonb_array_length(data->'lines') = 1) = 1, 'shipping queues order.shipped with its lines');
select pg_temp.check((select count(*) from public.webhook_events where type = 'po.received') = 0, 'events nobody subscribed to are not recorded');
-- sender: claim, fail with backoff, then succeed
reset role;
select public.claim_webhook_deliveries(100) as cl \gset
select pg_temp.check(jsonb_array_length(:'cl'::jsonb) >= 2 and (:'cl'::jsonb->0->>'secret') like 'whsec\_%', 'the sender claims due deliveries with what it needs to sign');
select pg_temp.check(jsonb_array_length(public.claim_webhook_deliveries(100)) = 0, 'a claimed delivery is not handed out twice');
select (:'cl'::jsonb->0->>'id')::bigint as d1 \gset
select pg_temp.check(public.finish_webhook_delivery(:d1, 500, 'boom') = 'retry', 'a failed delivery is queued for a retry');
select pg_temp.check((select status = 'pending' and next_at > now() + interval '50 seconds' from public.webhook_deliveries where id = :d1), '… a minute later');
select pg_temp.check(public.finish_webhook_delivery((:'cl'::jsonb->1->>'id')::bigint, 200) = 'ok', 'a delivered webhook is marked ok');
select pg_temp.check((select failures = 0 and last_status = 200 from public.webhooks where id = :'whid'), 'a success resets the failure count');
update public.webhook_deliveries set attempts = 6 where id = :d1;
select pg_temp.check(public.finish_webhook_delivery(:d1, 404) = 'failed', 'after six attempts a delivery is given up');
set role authenticated;
select pg_temp.check(public.test_webhook(:'whid') > 0, 'a test ping can be sent');
reset role;
select public.api_create_order(jsonb_build_object('customer', 'API Buyer', 'reference', 'ext-77', 'lines', jsonb_build_array(jsonb_build_object('sku', 'PL-MAT', 'quantity', 2, 'unit_price', 40)))) as ao \gset
select pg_temp.check((select source = 'api' and order_number <> '' from public.orders where id = (:'ao'::jsonb->>'id')::uuid)
  and (select quantity = 2 and unit_price = 40 from public.order_lines where order_id = (:'ao'::jsonb->>'id')::uuid), 'INT-06 the API creates a sales order from SKUs');
select pg_temp.check((public.api_create_order(jsonb_build_object('customer', 'API Buyer', 'reference', 'ext-77', 'lines', jsonb_build_array(jsonb_build_object('sku', 'PL-MAT', 'quantity', 2))))->>'duplicate')::boolean,
  'INT-09 resending the same reference does not create a second order');
select pg_temp.expect_fail($$select public.api_create_order('{"customer":"X","lines":[{"sku":"NOPE","quantity":1}]}')$$, 'an API order with an unknown SKU');
set role authenticated;
select pg_temp.check(jsonb_array_length(public.integrations_state()->'keys') = 1 and not (public.integrations_state()->'keys'->0 ? 'key_hash')
  and not (public.integrations_state()->'webhooks'->0 ? 'secret') and jsonb_array_length(public.integrations_state()->'deliveries') >= 3, 'INT-08 the integrations screen sees keys and webhooks without hashes or secrets');
select public.set_webhook(:'whid', false);
select pg_temp.check((select not active from public.webhooks where id = :'whid'), 'a webhook can be paused');
select pg_temp.become('00000000-0000-0000-0000-0000000000d2');
select pg_temp.check((select count(*) from public.webhooks) = 0 and (select count(*) from public.webhook_deliveries) = 0, 'managers do not see webhooks or deliveries');
select pg_temp.expect_fail($$select public.integrations_state()$$, 'a manager opens Integrations');

-- ---------------------------------------------------------------- phase 7: kits, variants, custom fields, stocktakes, sub-MOs, schedule
select pg_temp.become('00000000-0000-0000-0000-0000000000d1');
-- kits (SALES-07)
insert into public.stock_items (sku, name, kind) values ('KIT-A', 'Panel bundle', 'kit'), ('KC-1', 'Bundle panel', 'material'), ('KC-2', 'Bundle screws', 'material') ;
select id as kit from public.stock_items where sku = 'KIT-A' \gset
select id as kc1 from public.stock_items where sku = 'KC-1' \gset
select id as kc2 from public.stock_items where sku = 'KC-2' \gset
insert into public.bom_lines (product_id, material_id, quantity) values (:'kit', :'kc1', 1), (:'kit', :'kc2', 4);
select pg_temp.expect_fail($$insert into public.bom_lines (product_id, material_id, quantity) values ('$$ || :'kc1' || $$', '$$ || :'kit' || $$', 1)$$, 'a kit as an ingredient');
select pg_temp.expect_fail($$select public.adjust_stock('$$ || :'kit' || $$', 5)$$, 'putting a kit itself on stock');
select pg_temp.expect_fail($$select public.create_mo('KIT-A', 'x', 1)$$, 'a manufacturing order for a kit');
insert into public.purchase_orders (supplier_id, status) values (:'osup', 'ordered') returning id as kpo \gset
insert into public.po_lines (po_id, item_id, quantity, unit_cost) values (:'kpo', :'kc1', 5, 10), (:'kpo', :'kc2', 20, 0.5);
select public.receive_po_line(id, quantity) from public.po_lines where po_id = :'kpo';
insert into public.orders (order_number, customer, kind) values ('', 'Kit Buyer', 'order') returning id as kso \gset
insert into public.order_lines (order_id, item_id, sku, name, quantity, unit_price) values (:'kso', :'kit', 'KIT-A', 'Panel bundle', 3, 40) returning id as ksl \gset
select public.availability() as kav \gset
select pg_temp.check((:'kav'::jsonb->'lines'->:'ksl'->>'status') = 'in_stock', 'SALES-07 kit availability comes from its components');
update public.order_lines set quantity = 6 where id = :'ksl';
select public.availability() as kav2 \gset
select pg_temp.check((:'kav2'::jsonb->'lines'->:'ksl'->>'status') = 'not_available', 'a kit is short when any component is short (6 kits need 6 panels, 5 on hand)');
update public.order_lines set quantity = 3 where id = :'ksl';
select public.ship_lines(:'kso', null);
select pg_temp.check((select quantity = 2 from public.stock_items where id = :'kc1') and (select quantity = 8 from public.stock_items where id = :'kc2') and (select quantity = 0 from public.stock_items where id = :'kit'),
  'shipping 3 kits takes 3 panels and 12 screws off stock');
select pg_temp.check((public.report('sales', current_date - 1, current_date, 'product')->'rows') @> jsonb_build_array(jsonb_build_object('key', 'KIT-A', 'revenue', 120, 'cost', 36)),
  'the sales report shows the kit: 3 × £40, cost 3 × (£10 + 4 × £0.50)');
select public.return_lines(:'kso', jsonb_build_array(jsonb_build_object('line', :'ksl', 'qty', 1, 'restock', true)), 'Changed mind');
select pg_temp.check((select quantity = 3 from public.stock_items where id = :'kc1') and (select quantity = 12 from public.stock_items where id = :'kc2'), 'returning 1 kit puts 1 panel and 4 screws back');
select public.unship_lines(:'kso', jsonb_build_array(jsonb_build_object('line', :'ksl', 'qty', 2)));
select pg_temp.check((select quantity = 5 from public.stock_items where id = :'kc1') and (select quantity = 20 from public.stock_items where id = :'kc2'), 'undoing the other 2 kits puts the rest back');
-- variants (CAT-02/06)
insert into public.product_families (name, options) values ('Pedestal panel', array['Colour', 'Version']) returning id as fam \gset
update public.stock_items set family_id = :'fam', variant = '{"Colour":"AMBER","Version":"V1"}' where id = :'ltprod';
select public.create_variant(:'ltprod', 'LT-PROD-W', 'Moulded part — WHITE', '{"Colour":"WHITE","Version":"V1"}') as var \gset
select pg_temp.check((select count(*) from public.bom_lines where product_id = :'var') = (select count(*) from public.bom_lines where product_id = :'ltprod')
  and (select family_id = :'fam' and variant->>'Colour' = 'WHITE' from public.stock_items where id = :'var'), 'CAT-02/06 a new variant copies its recipe and joins the family');
select pg_temp.expect_fail($$select public.create_variant('$$ || :'ltprod' || $$', 'LT-PROD-W2', 'x', '{"Colour":"WHITE","Version":"V1"}')$$, 'two variants with the same options');
select pg_temp.expect_fail($$select public.create_variant('$$ || :'ltprod' || $$', 'LT-PROD-W', 'x', '{"Colour":"RED"}')$$, 'a variant with a SKU that exists');
-- custom fields (SALES-09)
update public.company_settings set order_fields = '[{"key":"aircraft","label":"Aircraft type","type":"text"}]' where id = 1;
update public.orders set custom = '{"aircraft":"A320"}' where id = :'kso';
select pg_temp.check((select custom->>'aircraft' = 'A320' from public.orders where id = :'kso'), 'SALES-09 orders keep custom field values');
-- stocktakes (INV-08)
select public.start_stocktake(null, array[:'kc1'::uuid, :'kc2'::uuid], 'Shelf B') as stk \gset
select pg_temp.check((select count(*) = 2 from public.stocktake_lines where stocktake_id = :'stk'), 'INV-08 a stocktake lists the items to count');
select pg_temp.expect_fail($$select public.start_stocktake(null)$$, 'two open stocktakes at one location');
update public.stocktake_lines set counted = 4 where stocktake_id = :'stk' and item_id = :'kc1';
update public.stocktake_lines set counted = 20 where stocktake_id = :'stk' and item_id = :'kc2';
select pg_temp.check((select quantity = 5 from public.stock_items where id = :'kc1'), 'counting does not change stock until the stocktake is posted');
select public.post_stocktake(:'stk') as stp \gset
select pg_temp.check((:'stp'::jsonb->>'difference')::numeric = -1 and (:'stp'::jsonb->>'value')::numeric = -10, 'posting books the difference (−1 panel, −£10)');
select pg_temp.check((select quantity = 4 from public.stock_items where id = :'kc1') and (select system_at_post = 5 from public.stocktake_lines where stocktake_id = :'stk' and item_id = :'kc1'), '… and keeps what the system said at posting');
select pg_temp.expect_fail($$update public.stocktake_lines set counted = 1 where stocktake_id = '$$ || :'stk' || $$'$$, 'changing a posted stocktake');
-- sub-assembly MOs (MFG-02)
insert into public.stock_items (sku, name, kind) values ('SA-TOP', 'Top assembly', 'product'), ('SA-SUB', 'Frame sub-assembly', 'part'), ('SA-RAW', 'Frame tube', 'material');
select id as satop from public.stock_items where sku = 'SA-TOP' \gset
select id as sasub from public.stock_items where sku = 'SA-SUB' \gset
select id as saraw from public.stock_items where sku = 'SA-RAW' \gset
insert into public.bom_lines (product_id, material_id, quantity) values (:'satop', :'sasub', 2), (:'sasub', :'saraw', 3);
select public.create_mo('SA-TOP', 'Top', 3) as satj \gset
select pg_temp.check(public.create_sub_mos(:'satj') = 1 and (select quantity = 6 and parent_id = :'satj' from public.jobs where sku = 'SA-SUB'), 'MFG-02 a linked sub-assembly MO for the 6 frames needed');
select pg_temp.check(public.create_sub_mos(:'satj') = 0, 'running it again does not double the sub-assembly MO');
update public.company_settings set auto_sub_mos = true where id = 1;
select public.create_mo('SA-TOP', 'Top again', 1) as satj2 \gset
select pg_temp.check((select count(*) = 1 from public.jobs where parent_id = :'satj2'), 'ADMIN-06 with automatic sub-assemblies switched on, the MO creates its own');
update public.company_settings set auto_sub_mos = false where id = 1;
-- schedule (MFG-07/09)
reset role;
update public.company_settings set work_hours_per_day = 8 where id = 1;
insert into public.product_operations (product_id, station_id, name, setup_minutes, unit_minutes, step)
  select :'satop'::uuid, (select id from public.stations order by sort limit 1), 'Cut', 0, 160, 1 union all
  select :'satop'::uuid, (select id from public.stations order by sort offset 1 limit 1), 'Paint', 0, 100, 1 union all
  select :'satop'::uuid, (select id from public.stations order by sort limit 1), 'Assemble', 0, 160, 2;
set role authenticated;
select public.mo_schedule(:'satj') as sch \gset
select pg_temp.check(jsonb_array_length(:'sch'::jsonb->'steps') = 2 and (:'sch'::jsonb->'steps'->0->>'parallel')::boolean and (:'sch'::jsonb->>'minutes')::numeric = 960,
  'MFG-07 operations sharing a step run side by side (480 + 480 min, not 480 + 300 + 480)');
select pg_temp.check((:'sch'::jsonb->>'working_days')::int >= 2 and (:'sch'::jsonb->>'finish')::date > current_date, 'MFG-09 a finish date in working days');
select public.mo_schedule(:'satj2') as sch2 \gset
select pg_temp.check((:'sch2'::jsonb->'steps'->0->'operations'->0->>'queue_minutes')::numeric > 0, 'MFG-09 the MO behind it waits for the queue at the station');

-- ================================================================ TROTAN (laser design & production)
select pg_temp.become(null);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'lo@x.test', '{"full_name":"Lena Office"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'lop@x.test', '{"full_name":"Laser Operator"}'),
  ('00000000-0000-0000-0000-0000000000e3', 'lsu@x.test', '{"full_name":"Sue Support"}');
update public.profiles set active = true, role = 'office' where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set active = true, role = 'operator' where id = '00000000-0000-0000-0000-0000000000e2';
update public.profiles set active = true, role = 'support' where id = '00000000-0000-0000-0000-0000000000e3';
update public.profiles set active = true, role = 'boss' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
insert into public.stock_items (sku, name, kind, unit) values ('PLY3-SHEET', 'Plywood 3 mm sheet 600×400', 'material', 'sheet') returning id as tply \gset
select public.opening_stock(:'tply', 5, 4.20);
insert into public.trotan_machines (name, adapter, manufacturer, model, caps) values ('Virtual CO2 600×400', 'virtual', 'TROTAN', 'Simulator',
  '{"bedW":600,"bedH":400,"laserType":"co2","maxPowerW":60,"maxSpeed":1000,"maxRasterSpeed":3550,"accel":15000,"travelSpeed":1200,"ops":["cut","raster"],"freq":null,"dpi":[500],"focus":{"min":-5,"max":5},"airAssist":true,"maxPasses":10}') returning id as tm \gset
insert into public.trotan_machines (name, adapter, manufacturer, model, caps) values ('Workshop CO2', 'none', 'Any', 'Real', '{"bedW":600,"bedH":400,"maxSpeed":1000}') returning id as tmreal \gset
insert into public.trotan_materials (name, category, thickness_mm, sheet_w, sheet_h, stock_item_id) values ('Plywood 3 mm', 'Plywood', 3, 600, 400, :'tply') returning id as tmat \gset
insert into public.trotan_materials (name, category) values ('PVC', 'Prohibited plastics') returning id as tpvc \gset
update public.trotan_machines set prohibited = array[:'tpvc'::uuid] where id = :'tm';
select pg_temp.expect_fail($$insert into public.trotan_profiles (material_id, machine_id, operation, params, status) values ('$$ || :'tmat' || $$', '$$ || :'tm' || $$', 'cut', '{"power":80,"speed":20}', 'approved')$$, 'TROTAN new settings cannot start as approved');
insert into public.trotan_profiles (material_id, machine_id, operation, params) values (:'tmat', :'tm', 'cut', '{"power":80,"speed":20,"passes":1}') returning id as tpf \gset

-- access: operators run jobs but cannot design or configure; support only browses
select pg_temp.become('00000000-0000-0000-0000-0000000000e2');
select pg_temp.check(public.trotan_can('produce') and not public.trotan_can('design') and not public.trotan_can('approve'), 'TROTAN operator: produce yes, design/approve no');
select pg_temp.expect_fail($$insert into public.trotan_projects (name, doc) values ('x', '{"format":"trotan","units":"mm","objects":[]}')$$, 'TROTAN operators cannot create designs');
select pg_temp.expect_fail($$insert into public.trotan_machines (name, caps) values ('x', '{"bedW":1,"bedH":1,"maxSpeed":1}')$$, 'TROTAN operators cannot configure machines');
select pg_temp.become('00000000-0000-0000-0000-0000000000e3');
select pg_temp.check((select count(*) from public.trotan_machines) = 3 and not public.trotan_can('prepare'), 'TROTAN support can browse (seeded virtual laser + 2) but not prepare');
select pg_temp.check((select count(*) from public.trotan_profiles where status = 'approved') = 0, 'TROTAN first install has no approved settings — nothing is presented as a validated recipe');
select pg_temp.expect_fail($$select public.trotan_set_profile_status('$$ || :'tpf' || $$', 'approved')$$, 'TROTAN support cannot approve settings');

-- office designs; saves are versioned and conflict-safe
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
insert into public.trotan_projects (name, customer, doc) values ('Coasters', 'Demo', '{"format":"trotan","version":1,"units":"mm","width":200,"height":100,"layers":[],"objects":[],"guides":[]}') returning id as tpr \gset
select pg_temp.check(public.trotan_save(:'tpr', 1, '{"format":"trotan","version":1,"units":"mm","width":200,"height":100,"layers":[],"objects":[{"id":"a"}],"guides":[]}', 'first', true) = 2, 'TROTAN save → version 2 with a revision');
select pg_temp.expect_fail($$select public.trotan_save('$$ || :'tpr' || $$', 1, '{"format":"trotan","units":"mm","objects":[]}')$$, 'TROTAN a stale save (someone else saved first) is refused');
select pg_temp.expect_fail($$select public.trotan_save('$$ || :'tpr' || $$', 2, '{"format":"x"}')$$, 'TROTAN an invalid design is refused');
select pg_temp.check((select count(*) = 1 from public.trotan_revisions where project_id = :'tpr' and version = 2), 'TROTAN revision 2 stored');
select pg_temp.expect_fail($$select public.trotan_set_profile_status('$$ || :'tpf' || $$', 'approved')$$, 'TROTAN office (no approve right) cannot approve settings');

-- jobs: validation errors, unapproved settings and missing stock all block the queue
insert into public.trotan_jobs (project_id, revision, machine_id, material_id, status, ops, copies, sheets, validation)
  values (:'tpr', 2, :'tm', :'tmat', 'ready', '{"cut":{"power":80,"speed":20,"passes":1}}', 6, 3, '[{"level":"error","code":"sheet"}]') returning id as tj \gset
select pg_temp.expect_fail($$select public.trotan_queue('$$ || :'tj' || $$')$$, 'TROTAN a job with validation errors cannot be queued');
update public.trotan_jobs set validation = '[{"level":"warning","code":"overlap"}]' where id = :'tj';
select pg_temp.expect_fail($$select public.trotan_queue('$$ || :'tj' || $$')$$, 'TROTAN a job without approved settings cannot be queued');
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select public.trotan_set_profile_status(:'tpf', 'approved');
select pg_temp.expect_fail($$update public.trotan_profiles set params = '{"power":100}' where id = '$$ || :'tpf' || $$'$$, 'TROTAN approved settings are locked');
insert into public.trotan_profiles (material_id, machine_id, operation, version, params) values (:'tmat', :'tm', 'cut', 2, '{"power":75,"speed":22,"passes":1}') returning id as tpf2 \gset
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
select pg_temp.expect_fail($$update public.trotan_jobs set status = 'running' where id = '$$ || :'tj' || $$'$$, 'TROTAN a job cannot jump to running');
insert into public.trotan_jobs (project_id, revision, machine_id, material_id, status, ops, sheets) values (:'tpr', 2, :'tm', :'tmat', 'ready', '{"cut":{"power":95,"speed":20,"passes":1}}', 0) returning id as tjx \gset
select pg_temp.expect_fail($$select public.trotan_queue('$$ || :'tjx' || $$')$$, 'TROTAN settings that differ from the approved ones are refused');
select public.trotan_save(:'tpr', 2, '{"format":"trotan","version":1,"units":"mm","width":200,"height":100,"layers":[{"id":"L","params":{"power":99}}],"objects":[],"guides":[]}', 'layer override', true);
update public.trotan_jobs set revision = 3, ops = '{"cut":{"power":80,"speed":20,"passes":1}}' where id = :'tjx';
select pg_temp.expect_fail($$select public.trotan_queue('$$ || :'tjx' || $$')$$, 'TROTAN per-layer settings only on material tests');
delete from public.trotan_jobs where id = :'tjx';
select pg_temp.check(public.trotan_queue(:'tj') = 'queued', 'TROTAN validated job with approved settings is queued');
select pg_temp.check((select status = 'reserved' and quantity = 3 from public.trotan_reservations where job_id = :'tj'), 'TROTAN 3 sheets reserved in KORTANA');
select pg_temp.check((select quantity = 5 from public.stock_items where id = :'tply'), 'TROTAN queuing does not deduct stock');
select pg_temp.expect_fail($$update public.trotan_jobs set kerf = 0.2 where id = '$$ || :'tj' || $$'$$, 'TROTAN a queued job cannot be edited');
insert into public.trotan_jobs (project_id, revision, machine_id, material_id, status, ops, sheets) values (:'tpr', 2, :'tm', :'tmat', 'ready', '{"cut":{"power":80,"speed":20,"passes":1}}', 3) returning id as tj2 \gset
select pg_temp.expect_fail($$select public.trotan_queue('$$ || :'tj2' || $$')$$, 'TROTAN only 2 free sheets left — the second job is refused');
update public.trotan_jobs set sheets = 2, material_id = :'tpvc' where id = :'tj2';
select pg_temp.expect_fail($$select public.trotan_queue('$$ || :'tj2' || $$')$$, 'TROTAN prohibited material is refused');
update public.trotan_jobs set material_id = :'tmat' where id = :'tj2';
select public.trotan_queue(:'tj2');

-- material test cards may use unapproved settings, but only an approver can queue them
insert into public.trotan_jobs (project_id, revision, machine_id, material_id, status, ops, sheets, test) values (:'tpr', 2, :'tm', :'tmat', 'ready', '{"raster":{}}', 0, true) returning id as tjt \gset
select pg_temp.expect_fail($$select public.trotan_queue('$$ || :'tjt' || $$')$$, 'TROTAN office cannot queue a material test with unapproved settings');
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select pg_temp.check(public.trotan_queue(:'tjt') = 'queued', 'TROTAN an approver can queue a material test card');
update public.trotan_jobs set status = 'cancelled' where id = :'tjt';
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
-- production: operator confirms checks; one run per machine; finishing is idempotent
select pg_temp.become('00000000-0000-0000-0000-0000000000e2');
select pg_temp.expect_fail($$select public.trotan_start('$$ || :'tj' || $$', '[{"name":"Lid closed","ok":false}]')$$, 'TROTAN a run needs every pre-run check confirmed');
select public.trotan_start(:'tj', '[{"name":"Material placed","ok":true},{"name":"Lid closed","ok":true}]', 'start-1') as trun \gset
select pg_temp.check(public.trotan_start(:'tj', '[{"name":"x","ok":true}]', 'start-1') = :'trun'::uuid, 'TROTAN a repeated start (same key) returns the same run');
select pg_temp.check((select status = 'busy' from public.trotan_machines where id = :'tm') and (select status = 'running' from public.trotan_jobs where id = :'tj'), 'TROTAN job running, machine busy');
select pg_temp.expect_fail($$select public.trotan_start('$$ || :'tj2' || $$', '[{"name":"x","ok":true}]')$$, 'TROTAN a busy machine cannot start a second job');
select public.trotan_finish(:'trun', 'done', 5, 1, 312.5, 3, '', 'fin-1');
select public.trotan_finish(:'trun', 'done', 5, 1, 312.5, 3, '', 'fin-1');
select public.trotan_finish(:'trun', 'done', 5, 1, 312.5, 3, '', 'fin-2');
select pg_temp.check((select quantity = 2 from public.stock_items where id = :'tply'), 'TROTAN finishing consumed 3 sheets exactly once (5 → 2)');
select pg_temp.check((select count(*) = 1 from public.stock_movements where source_type = 'trotan_job' and source_id = :'tj' and reason = 'consume'), 'TROTAN one traceable KORTANA movement for the job');
select pg_temp.check((select status = 'consumed' and consumed = 3 from public.trotan_reservations where job_id = :'tj'), 'TROTAN reservation consumed');
select pg_temp.check((select status = 'done' and qty_good = 5 and qty_scrap = 1 and actual_s = 312.5 and operator = '00000000-0000-0000-0000-0000000000e2' from public.trotan_jobs where id = :'tj'), 'TROTAN results, time and operator recorded');
select pg_temp.check((select status = 'idle' from public.trotan_machines where id = :'tm'), 'TROTAN machine free again');
-- a failed run with no material used releases the stock
select public.trotan_start(:'tj2', '[{"name":"x","ok":true}]') as trun2 \gset
select public.trotan_finish(:'trun2', 'aborted', 0, 0, 10, 0, 'Lid opened');
select pg_temp.check((select status = 'released' from public.trotan_reservations where job_id = :'tj2') and (select quantity = 2 from public.stock_items where id = :'tply'), 'TROTAN aborted run with no material used releases the reservation');
select pg_temp.check((select status = 'failed' and error = 'Lid opened' from public.trotan_jobs where id = :'tj2'), 'TROTAN failure reason recorded');

-- machines without a validated interface never run; finished jobs cannot be deleted
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
insert into public.trotan_jobs (project_id, revision, machine_id, material_id, status, sheets) values (:'tpr', 2, :'tmreal', :'tmat', 'ready', 0) returning id as tj3 \gset
select public.trotan_queue(:'tj3');
select pg_temp.become('00000000-0000-0000-0000-0000000000e2');
select pg_temp.expect_fail($$select public.trotan_start('$$ || :'tj3' || $$', '[{"name":"x","ok":true}]')$$, 'TROTAN a machine without a validated interface can never be started from TROTAN');
select pg_temp.become('00000000-0000-0000-0000-0000000000e1');
delete from public.trotan_jobs where id = :'tj';
select pg_temp.check((select count(*) = 1 from public.trotan_jobs where id = :'tj'), 'TROTAN a finished job cannot be deleted');
-- SK Factory link
select pg_temp.become('00000000-0000-0000-0000-00000000000b');
select public.create_mo('PLY3-SHEET', 'Coaster MO', 6) as tmo \gset
update public.trotan_jobs set mo_job_id = :'tmo' where id = :'tj';
select pg_temp.check((select status = 'done' and qty_good = 5 from public.trotan_mo_activity where mo_job_id = :'tmo'), 'TROTAN SK Factory sees the laser result on its MO');
select pg_temp.check((select count(*) > 0 from public.audit_log where table_name = 'trotan_jobs'), 'TROTAN job changes are in the audit log');

select pg_temp.become(null);
select pg_temp.check((select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) = 0, 'every table has RLS');
delete from auth.users;
select pg_temp.check((select count(*) from public.profiles) + (select count(*) from public.shifts) + (select count(*) from public.participants) = 0, 'deleting users cascades');
\echo ALL SCHEMA TESTS PASSED
