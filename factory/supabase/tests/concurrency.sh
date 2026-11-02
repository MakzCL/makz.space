#!/usr/bin/env bash
# Scenario 13: simultaneous stock operations from many sessions.
#  * 20 sessions each take 1 from an item holding 20 → exactly 0 left, 20 movements (no lost updates)
#  * 10 sessions replay the same receive key at once → received once
#  * 6 sessions try to ship the same last unit to 6 orders → exactly one ships (scenario 13)
# Run (as root, local Postgres 16): bash concurrency.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=tconc
STUB=/home/user/makz.space/supabase/tests/00-supabase-stub.sql
su postgres -c "dropdb --if-exists $DB; createdb $DB"
su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 -f $STUB -f ../schema.sql" >/dev/null 2>&1
B=00000000-0000-0000-0000-00000000000b
su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1" >/dev/null <<SQL
grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;
grant usage, select on all sequences in schema public to authenticated;
insert into auth.users (id, email, raw_user_meta_data) values ('$B', 'b@x.test', '{"full_name":"Bo"}');
update public.profiles set role = 'boss', active = true where id = '$B';
insert into public.stock_items (sku, name) values ('C-ITEM', 'Contended item'), ('C-RCV', 'Received item');
select set_config('app.stock_move', 'on', false);
select public.move_stock(id, 20, 'opening') from public.stock_items where sku = 'C-ITEM';
insert into public.suppliers (name) values ('S');
insert into public.purchase_orders (supplier_id, status) select id, 'ordered' from public.suppliers;
insert into public.po_lines (po_id, item_id, quantity, unit_cost) select (select id from public.purchase_orders), id, 5, 1 from public.stock_items where sku = 'C-RCV';
insert into public.stock_items (sku, name, kind) values ('C-LAST', 'Last unit', 'product');
select public.move_stock(id, 1, 'opening') from public.stock_items where sku = 'C-LAST';
insert into public.orders (order_number, customer, kind) select '', 'Race ' || g, 'order' from generate_series(1, 6) g;
insert into public.order_lines (order_id, item_id, sku, name, quantity) select o.id, s.id, 'C-LAST', 'Last unit', 1 from public.orders o, public.stock_items s where o.customer like 'Race %' and s.sku = 'C-LAST';
SQL
as_boss="set request.jwt.claim.sub = '$B'; set role authenticated;"
for i in $(seq 1 20); do
  su postgres -c "psql -q -d $DB -c \"$as_boss select public.adjust_stock((select id from public.stock_items where sku = 'C-ITEM'), -1, 'race $i');\"" >/dev/null &
done
for i in $(seq 1 10); do
  su postgres -c "psql -q -d $DB -c \"$as_boss select public.receive_po_line((select id from public.po_lines), 5, 'same-key');\"" >/dev/null &
done
for o in $(su postgres -c "psql -At -d $DB -c \"select id from public.orders where customer like 'Race %'\""); do
  su postgres -c "psql -q -d $DB -c \"$as_boss select public.ship_lines('$o', null);\"" >/dev/null 2>&1 &
done
wait
LAST=$(su postgres -c "psql -At -d $DB -c \"select (select quantity from public.stock_items where sku = 'C-LAST') || ' ' || (select sum(shipped) from public.order_lines where sku = 'C-LAST')\"")
echo "last unit: qty/shipped = $LAST"
[ "$LAST" = "0.000 1.000" ] || { echo "CONCURRENCY TESTS FAILED (last unit shipped twice?)"; exit 1; }
OUT=$(su postgres -c "psql -At -d $DB -c \"select (select quantity from public.stock_items where sku = 'C-ITEM') || ' ' || (select count(*) from public.stock_movements m join public.stock_items s on s.id = m.item_id where s.sku = 'C-ITEM' and reason = 'adjust') || ' ' || (select quantity from public.stock_items where sku = 'C-RCV') || ' ' || (select received from public.po_lines)\"")
echo "contended: qty/moves, received: qty/line = $OUT"
[ "$OUT" = "0.000 20 5.000 5.000" ] && echo "CONCURRENCY TESTS PASSED" || { echo "CONCURRENCY TESTS FAILED"; exit 1; }
