// node --test tests/   (no dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, diffDays, fromInputDateTime, toInputDateTime, addDays } from '../js/time.js';
import {
  searchAnimals, breedingStatus, inseminatedIn, awaitingResult, withdrawals, milkHolds, milkTotals, milkDay, todayItems, toCSV,
} from '../js/logic.js';

const TZ = 'Pacific/Auckland';
const NOW = Date.parse('2026-11-14T10:00:00Z'); // 23:00 on 14 Nov in Auckland
function data(over = {}) {
  return {
    settings: { id: 'farm', timeZone: TZ, firstCheckDays: 30, recheckDays: 14, gestationDays: 283, dryOffDays: 60 },
    animals: [], events: [], exposures: [], tasks: [], milk: [], milkDays: [], buyers: [], collections: [], statements: [], quality: [],
    ...over,
  };
}
const cow = (id, code, extra = {}) => ({ id, code, tag: `IE1234560${code}`, type: 'cow', sex: 'F', status: 'active', ...extra });
const atLocal = (s) => fromInputDateTime(s, TZ);

test('time zone: day keys follow the farm clock, not UTC', () => {
  assert.equal(dayKey('2026-11-14T10:00:00Z', TZ), '2026-11-14');
  assert.equal(dayKey('2026-11-14T11:30:00Z', TZ), '2026-11-15'); // after midnight NZ
  assert.equal(toInputDateTime(atLocal('2026-03-29T07:15'), TZ), '2026-03-29T07:15');
  assert.equal(diffDays('2026-10-27', '2026-11-14'), 18);
  // DST change in Europe (29 Mar 2026): local 07:15 round-trips
  assert.equal(toInputDateTime(fromInputDateTime('2026-03-29T07:15', 'Europe/Dublin'), 'Europe/Dublin'), '2026-03-29T07:15');
});

test('search keeps leading zeroes and matches partial codes/tags', () => {
  const animals = [cow('a', '0042'), cow('b', '0420'), cow('c', '42'), cow('d', '1042', { status: 'sold' })];
  assert.deepEqual(searchAnimals(animals, '0042').map((a) => a.code)[0], '0042');
  assert.deepEqual(searchAnimals(animals, '42').map((a) => a.code), ['42', '0042', '0420']);
  assert.equal(searchAnimals(animals, '1042').length, 0);
  assert.equal(searchAnimals(animals, '1042', { includeArchived: true }).length, 1);
});

test('insemination 18 days ago, repeat resets count, counts once', () => {
  const D = data({ animals: [cow('a', '0042')] });
  D.events.push({ id: 'e1', animalId: 'a', kind: 'ai', at: atLocal('2026-10-27T07:00') });
  let st = breedingStatus(D, D.animals[0], NOW);
  assert.equal(st.state, 'awaiting');
  assert.equal(st.daysSince, 18);
  D.events.push({ id: 'e2', animalId: 'a', kind: 'ai', at: atLocal('2026-11-10T07:00') });
  st = breedingStatus(D, D.animals[0], NOW);
  assert.equal(st.daysSince, 4);
  assert.equal(st.attempts.length, 2);
  const ins = inseminatedIn(D, '2026-10-16', '2026-11-14');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].attempts.length, 2);
});

test('pregnancy checks: inconclusive stays, pregnant leaves list with calving date', () => {
  const D = data({ animals: [cow('a', '0042')] });
  D.events.push({ id: 'e1', animalId: 'a', kind: 'ai', at: atLocal('2026-10-01T07:00') });
  assert.equal(awaitingResult(D, NOW).length, 1);
  assert.equal(breedingStatus(D, D.animals[0], NOW).checkDue, '2026-10-31');
  assert.ok(breedingStatus(D, D.animals[0], NOW).checkOverdue);
  D.events.push({ id: 'c1', animalId: 'a', kind: 'pregcheck', at: atLocal('2026-11-05T09:00'), result: 'inconclusive', serviceId: 'e1' });
  let st = breedingStatus(D, D.animals[0], NOW);
  assert.equal(st.state, 'awaiting');
  assert.ok(st.inconclusive);
  assert.equal(st.checkDue, '2026-11-19');
  assert.equal(awaitingResult(D, NOW).length, 1);
  D.events.push({ id: 'c2', animalId: 'a', kind: 'pregcheck', at: atLocal('2026-11-14T09:00'), result: 'pregnant', serviceId: 'e1' });
  st = breedingStatus(D, D.animals[0], NOW);
  assert.equal(st.state, 'pregnant');
  assert.equal(st.calving.from, addDays('2026-10-01', 283));
  assert.equal(st.dryOff.due, addDays(st.calving.from, -60));
  assert.equal(awaitingResult(D, NOW).length, 0);
});

test('a check linked to an earlier service does not resolve the latest one', () => {
  const D = data({ animals: [cow('a', '7')] });
  D.events.push({ id: 's1', animalId: 'a', kind: 'ai', at: atLocal('2026-09-01T07:00') });
  D.events.push({ id: 's2', animalId: 'a', kind: 'ai', at: atLocal('2026-10-20T07:00') });
  D.events.push({ id: 'c', animalId: 'a', kind: 'pregcheck', at: atLocal('2026-11-01T07:00'), result: 'open', serviceId: 's1' });
  assert.equal(breedingStatus(D, D.animals[0], NOW).state, 'awaiting');
});

test('bull exposure gives a range, never an invented service date', () => {
  const D = data({ animals: [cow('h', '201', { type: 'heifer' })] });
  D.exposures.push({ id: 'x', bullId: null, bullText: 'Duke', start: '2026-09-01', end: '2026-10-15', animalIds: ['h'] });
  let st = breedingStatus(D, D.animals[0], NOW);
  assert.equal(st.state, 'awaiting');
  assert.equal(st.latest.exact, false);
  assert.equal(st.daysSince, null);
  assert.deepEqual(st.daysRange, [30, 74]);
  assert.equal(st.checkDue, '2026-11-14');
  D.events.push({ id: 'c', animalId: 'h', kind: 'pregcheck', at: atLocal('2026-11-14T08:00'), result: 'pregnant' });
  st = breedingStatus(D, D.animals[0], NOW);
  assert.equal(st.calving.source, 'exposure');
  assert.equal(st.calving.from, addDays('2026-09-01', 283));
  assert.equal(st.calving.to, addDays('2026-10-15', 283));
  D.events.find((e) => e.id === 'c').vetDueDate = '2027-07-01';
  assert.deepEqual(breedingStatus(D, D.animals[0], NOW).calving, { from: '2027-07-01', to: '2027-07-01', source: 'vet' });
});

test('overlapping treatments keep the milk hold until both end; missing end keeps it on', () => {
  const D = data({ animals: [cow('a', '0131')] });
  D.events.push({ id: 't1', animalId: 'a', kind: 'treatment', at: '2026-11-13T00:00:00Z', milkRequired: true, milkPeriod: 48, milkUnit: 'hours' });
  D.events.push({ id: 't2', animalId: 'a', kind: 'treatment', at: '2026-11-14T00:00:00Z', milkRequired: true, milkPeriod: 3, milkUnit: 'days' });
  let w = withdrawals(D, 'a', NOW);
  assert.ok(w.milk.active); assert.ok(w.milk.overlapping);
  assert.equal(w.milk.until, '2026-11-17T00:00:00.000Z');
  w = withdrawals(D, 'a', Date.parse('2026-11-15T12:00:00Z')); // first ended, second not
  assert.ok(w.milk.active); assert.equal(w.milk.treatments.length, 1);
  assert.equal(withdrawals(D, 'a', Date.parse('2026-11-17T00:00:01Z')).milk.active, false);
  D.events.push({ id: 't3', animalId: 'a', kind: 'treatment', at: '2026-11-10T00:00:00Z', milkRequired: true });
  w = withdrawals(D, 'a', Date.parse('2026-12-30T00:00:00Z'));
  assert.ok(w.milk.active); assert.ok(w.milk.missingEnd);
  assert.equal(milkHolds(D, Date.parse('2026-12-30T00:00:00Z')).length, 1);
});

test('milk: one official source per day, collections and statements counted once', () => {
  const D = data({ settings: { id: 'farm', timeZone: TZ, defaultMilkSource: 'sessions' } });
  D.milk.push(
    { id: 'm1', date: '2026-11-13', kind: 'session', session: 'AM', litres: 500 },
    { id: 'm2', date: '2026-11-13', kind: 'session', session: 'PM', litres: 450 },
    { id: 'm3', date: '2026-11-13', kind: 'daily', litres: 960 }, // reference only
    { id: 'm4', date: '2026-11-13', kind: 'cow', animalId: 'a', session: 'AM', litres: 30 },
    { id: 'm5', date: '2026-11-13', kind: 'kept', use: 'withheld', litres: 20 },
    { id: 'm6', date: '2026-11-14', kind: 'daily', litres: 900 },
  );
  D.milkDays.push({ id: '2026-11-13', source: 'sessions' }, { id: '2026-11-14', source: 'daily' });
  assert.equal(milkDay(D, '2026-11-13').official, 950);
  D.collections.push({ id: 'c1', date: '2026-11-14', buyerId: 'b', litresAccepted: 1800, litresRejected: 50, pricePerLitre: 0.5 });
  D.statements.push({ id: 's1', buyerId: 'b', from: '2026-11-01', to: '2026-11-14', bonuses: 20, deductions: 5, statementAmount: 912, paymentDate: '2026-11-14', paidAmount: 912 });
  const t = milkTotals(D, '2026-11-01', '2026-11-14');
  assert.equal(t.produced, 1850);
  assert.equal(t.kept.withheld, 20);
  assert.equal(t.sold, 1800);
  assert.equal(t.expected, 915);
  assert.equal(t.statements, 912);
  assert.equal(t.received, 912);
});

test('today list puts milk holds first', () => {
  const D = data({ animals: [cow('a', '1'), cow('b', '2')] });
  D.events.push({ id: 'e', animalId: 'b', kind: 'ai', at: atLocal('2026-09-01T07:00') });
  D.events.push({ id: 't', animalId: 'a', kind: 'treatment', at: '2026-11-14T00:00:00Z', milkRequired: true });
  const items = todayItems(D, NOW);
  assert.equal(items[0].type, 'hold');
  assert.equal(items[1].type, 'checkOverdue');
});

test('CSV quotes codes and neutralises formulas', () => {
  const csv = toCSV([{ c: '0042', n: '=SUM(A1)' }], [{ label: 'Code', get: 'c' }, { label: 'N', get: 'n' }]);
  assert.equal(csv, 'Code,N\r\n"0042",\'=SUM(A1)\r\n');
});
