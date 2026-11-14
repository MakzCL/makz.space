// Pure herd logic: no DOM, no storage. Every function takes a data snapshot
// D = { settings, animals, events, exposures, tasks, milk, milkDays, buyers,
//       collections, statements, quality } and, where time matters, `now` (ms).

import { dayKey, addDays, diffDays, todayKey } from './time.js';

export const DEFAULT_SETTINGS = {
  id: 'farm',
  farmName: '',
  timeZone: 'UTC',
  currency: 'EUR',
  gestationDays: 283,
  dryOffDays: 60,          // dry off this many days before expected calving
  firstCheckDays: 30,      // vet: first pregnancy check this many days after service
  recheckDays: 14,         // vet: recheck an inconclusive result after this many days
  calvingSoonDays: 30,     // show calvings due within this window
  dryOffSoonDays: 14,      // show dry-offs due within this window
  upcomingDays: 7,         // show checks / vet visits due within this window
  defaultMilkSource: 'sessions',
  setupDone: false,
};

export const settingsOf = (D) => ({ ...DEFAULT_SETTINGS, ...(D.settings || {}) });

export const TYPES = { cow: 'Cow', heifer: 'Heifer', calf: 'Calf', bull: 'Bull', steer: 'Steer' };
export const STATUS = { active: 'Active', sold: 'Sold', transferred: 'Transferred', deceased: 'Deceased' };

export const isActive = (a) => (a.status || 'active') === 'active';
export const isFemale = (a) => a.type === 'cow' || a.type === 'heifer' || (a.type === 'calf' && a.sex === 'F');
export const isBull = (a) => a.type === 'bull';

export function animalLabel(a) {
  if (!a) return 'Unknown animal';
  return a.code || a.tag || a.name || 'No code';
}

// ---------- search ----------

/** Full or partial farm code / ear tag. Strings only: leading zeroes kept. */
export function searchAnimals(animals, q, { includeArchived = false } = {}) {
  const s = String(q || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return [];
  const out = [];
  for (const a of animals) {
    if (!includeArchived && !isActive(a)) continue;
    const code = String(a.code || '').toLowerCase();
    const tag = String(a.tag || '').toLowerCase().replace(/\s+/g, '');
    const name = String(a.name || '').toLowerCase();
    let rank = 99;
    if (code === s) rank = 0;
    else if (tag === s) rank = 1;
    else if (code.startsWith(s)) rank = 2;
    else if (tag.endsWith(s)) rank = 3; // ear tags are usually read from the end
    else if (code.includes(s)) rank = 4;
    else if (tag.includes(s)) rank = 5;
    else if (name.includes(s)) rank = 6;
    if (rank < 99) out.push({ a, rank });
  }
  out.sort((x, y) => x.rank - y.rank || String(x.a.code).localeCompare(String(y.a.code), undefined, { numeric: true }));
  return out.map((x) => x.a);
}

// ---------- breeding ----------

const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

export function eventsOf(D, animalId, kinds) {
  return D.events.filter((e) => e.animalId === animalId && (!kinds || kinds.includes(e.kind))).sort(byAt);
}

export function sireLabel(D, e) {
  if (e.bullId) {
    const b = D.animals.find((x) => x.id === e.bullId);
    if (b) return b.name ? `${b.name} (${animalLabel(b)})` : animalLabel(b);
  }
  return e.sire || e.bullText || '';
}

/**
 * Every breeding attempt for an animal, oldest first: AI, observed natural
 * service, and bull exposures (which have a window, not a service date).
 */
export function breedingAttempts(D, animalId, tz) {
  const out = [];
  for (const e of D.events) {
    if (e.animalId !== animalId || (e.kind !== 'ai' && e.kind !== 'natural')) continue;
    const k = dayKey(e.at, tz);
    out.push({ id: e.id, kind: e.kind, start: k, end: k, exact: true, at: e.at, sire: sireLabel(D, e), event: e });
  }
  for (const x of D.exposures) {
    if (!(x.animalIds || []).includes(animalId)) continue;
    out.push({
      id: x.id, kind: 'exposure', start: x.start, end: x.end || null, exact: false,
      at: x.start, sire: sireLabel(D, x), exposure: x,
    });
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : String(a.at).localeCompare(String(b.at))));
  return out;
}

function openTaskFor(D, animalId, kind) {
  return D.tasks
    .filter((t) => !t.done && t.kind === kind && t.animalId === animalId)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

/**
 * Where an animal stands in her breeding cycle.
 * state: none | awaiting | pregnant | open | calved | lost
 */
export function breedingStatus(D, animal, now = Date.now()) {
  const S = settingsOf(D);
  const tz = S.timeZone;
  const today = todayKey(tz, now);
  const attempts = breedingAttempts(D, animal.id, tz);
  const latest = attempts[attempts.length - 1] || null;
  const res = {
    state: 'none', latest, attempts, today, lastCheck: null, inconclusive: false,
    checkDue: null, checkOverdue: false, reminder: null, calving: null, dryOff: null,
    daysSince: null, daysRange: null,
  };
  if (!latest) return res;

  if (latest.exact) res.daysSince = diffDays(latest.start, today);
  else res.daysRange = [diffDays(latest.end || today, today), diffDays(latest.start, today)];

  const attemptIds = new Set(attempts.map((a) => a.id));
  const outcomes = [];
  for (const e of D.events) {
    if (e.animalId !== animal.id) continue;
    if (e.kind === 'pregcheck') {
      const linkedElsewhere = e.serviceId && e.serviceId !== latest.id && attemptIds.has(e.serviceId);
      if (linkedElsewhere) continue;
      if (e.serviceId === latest.id || dayKey(e.at, tz) >= latest.start) outcomes.push(e);
    } else if ((e.kind === 'calving' || e.kind === 'loss') && dayKey(e.at, tz) >= latest.start) {
      outcomes.push(e);
    }
  }
  outcomes.sort(byAt);
  const last = outcomes[outcomes.length - 1];
  const checks = outcomes.filter((e) => e.kind === 'pregcheck');
  res.lastCheck = checks[checks.length - 1] || null;

  if (!last) res.state = 'awaiting';
  else if (last.kind === 'calving') res.state = 'calved';
  else if (last.kind === 'loss') res.state = 'lost';
  else if (last.result === 'pregnant') res.state = 'pregnant';
  else if (last.result === 'open') res.state = 'open';
  else { res.state = 'awaiting'; res.inconclusive = true; }

  if (res.state === 'awaiting') {
    const reminder = openTaskFor(D, animal.id, 'pregcheck');
    res.reminder = reminder;
    if (reminder) res.checkDue = reminder.date;
    else if (res.inconclusive) res.checkDue = addDays(dayKey(res.lastCheck.at, tz), S.recheckDays);
    else if (latest.exact) res.checkDue = addDays(latest.start, S.firstCheckDays);
    else if (latest.end) res.checkDue = addDays(latest.end, S.firstCheckDays);
    if (res.checkDue) {
      const d = diffDays(res.checkDue, today);
      res.checkOverdue = d > 0;
      res.checkOverdueDays = d;
    }
  }

  if (res.state === 'pregnant') {
    const pregCheck = [...checks].reverse().find((c) => c.result === 'pregnant');
    if (pregCheck?.vetDueDate) {
      res.calving = { from: pregCheck.vetDueDate, to: pregCheck.vetDueDate, source: 'vet' };
    } else if (latest.exact) {
      const d = addDays(latest.start, S.gestationDays);
      res.calving = { from: d, to: d, source: 'service' };
    } else {
      res.calving = {
        from: addDays(latest.start, S.gestationDays),
        // Conception happened within the exposure window and before the positive check.
        to: addDays(latest.end || (pregCheck ? dayKey(pregCheck.at, tz) : today), S.gestationDays),
        source: 'exposure',
      };
    }
    const dried = D.events.some((e) => e.animalId === animal.id && e.kind === 'dryoff' && dayKey(e.at, tz) >= latest.start);
    res.dryOff = { due: addDays(res.calving.from, -S.dryOffDays), done: dried };
  }
  return res;
}

/** Calving estimate for an animal that is still awaiting a result ("if pregnant"). */
export function prospectiveCalving(D, st) {
  const S = settingsOf(D);
  if (!st.latest) return null;
  return {
    from: addDays(st.latest.start, S.gestationDays),
    to: addDays(st.latest.end || st.latest.start, S.gestationDays),
    ongoing: !st.latest.exact && !st.latest.end,
  };
}

/** Distinct animals with an AI dated in [from, to] (farm calendar days, inclusive). */
export function inseminatedIn(D, from, to) {
  const tz = settingsOf(D).timeZone;
  const map = new Map();
  for (const e of D.events) {
    if (e.kind !== 'ai') continue;
    const k = dayKey(e.at, tz);
    if (k < from || k > to) continue;
    if (!map.has(e.animalId)) map.set(e.animalId, []);
    map.get(e.animalId).push(e);
  }
  return [...map.entries()].map(([animalId, evs]) => ({
    animal: D.animals.find((a) => a.id === animalId), animalId, attempts: evs.sort(byAt),
  })).filter((x) => x.animal);
}

export function awaitingResult(D, now = Date.now()) {
  return D.animals
    .filter((a) => isActive(a) && isFemale(a))
    .map((a) => ({ animal: a, st: breedingStatus(D, a, now) }))
    .filter((x) => x.st.state === 'awaiting')
    .sort((x, y) => (y.st.checkOverdueDays ?? -999) - (x.st.checkOverdueDays ?? -999));
}

export function pregnantList(D, now = Date.now()) {
  return D.animals
    .filter((a) => isActive(a) && isFemale(a))
    .map((a) => ({ animal: a, st: breedingStatus(D, a, now) }))
    .filter((x) => x.st.state === 'pregnant')
    .sort((x, y) => (x.st.calving?.from || '9').localeCompare(y.st.calving?.from || '9'));
}

// ---------- withdrawals ----------

export function treatmentMilkEnd(t) {
  if (!t.milkRequired) return null;
  if (t.milkEndManual) return t.milkEndManual;
  if (t.milkPeriod == null || t.milkPeriod === '' || isNaN(t.milkPeriod)) return null;
  const base = Date.parse(t.lastAt || t.at);
  const mult = t.milkUnit === 'hours' ? 3600000 : 86400000;
  return new Date(base + Number(t.milkPeriod) * mult).toISOString();
}

export function treatmentMeatEnd(t) {
  if (!t.meatRequired) return null;
  if (t.meatEndManual) return t.meatEndManual;
  if (t.meatPeriod == null || t.meatPeriod === '' || isNaN(t.meatPeriod)) return null;
  const base = Date.parse(t.lastAt || t.at);
  return new Date(base + Number(t.meatPeriod) * 86400000).toISOString();
}

function holdFrom(list, endFn, now) {
  const active = list.filter((t) => {
    const end = endFn(t);
    return !end || Date.parse(end) > now;
  });
  const missing = active.filter((t) => !endFn(t));
  const ends = active.map(endFn).filter(Boolean).sort();
  return {
    active: active.length > 0,
    treatments: active,
    missingEnd: missing.length > 0,
    until: missing.length ? null : ends[ends.length - 1] || null,
    overlapping: active.length > 1,
  };
}

/** Milk / meat withdrawal for one animal. Active while ANY withdrawal runs or an end time is missing. */
export function withdrawals(D, animalId, now = Date.now()) {
  const ts = D.events.filter((e) => e.animalId === animalId && e.kind === 'treatment');
  return {
    milk: holdFrom(ts.filter((t) => t.milkRequired), treatmentMilkEnd, now),
    meat: holdFrom(ts.filter((t) => t.meatRequired), treatmentMeatEnd, now),
  };
}

export function milkHolds(D, now = Date.now()) {
  return D.animals
    .filter(isActive)
    .map((a) => ({ animal: a, hold: withdrawals(D, a.id, now).milk }))
    .filter((x) => x.hold.active)
    .sort((x, y) => String(x.animal.code).localeCompare(String(y.animal.code), undefined, { numeric: true }));
}

/** Treatments whose date ranges overlap another treatment of the same animal. */
export function overlappingTreatments(D, animalId) {
  const ts = eventsOf(D, animalId, ['treatment']);
  const span = (t) => {
    const s = Date.parse(t.at);
    const ends = [Date.parse(t.lastAt || t.at), Date.parse(treatmentMilkEnd(t) || 0) || 0, Date.parse(treatmentMeatEnd(t) || 0) || 0];
    const missing = (t.milkRequired && !treatmentMilkEnd(t)) || (t.meatRequired && !treatmentMeatEnd(t));
    return [s, missing ? Infinity : Math.max(...ends)];
  };
  const ids = new Set();
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const [a1, a2] = span(ts[i]); const [b1, b2] = span(ts[j]);
      if (a1 <= b2 && b1 <= a2) { ids.add(ts[i].id); ids.add(ts[j].id); }
    }
  }
  return ids;
}

// ---------- milk ----------

export const MILK_SOURCES = {
  sessions: 'Milking session totals',
  daily: 'Daily herd total',
  cows: 'Sum of cow yields',
};

export function milkDaySource(D, date) {
  const rec = D.milkDays.find((d) => d.id === date);
  return rec?.source || settingsOf(D).defaultMilkSource;
}

/** Official produced litres for one day, from exactly one source. */
export function milkDay(D, date) {
  const entries = D.milk.filter((m) => m.date === date);
  const sum = (kind) => entries.filter((m) => m.kind === kind).reduce((s, m) => s + (+m.litres || 0), 0);
  const bySource = { sessions: sum('session'), daily: sum('daily'), cows: sum('cow') };
  const has = {
    sessions: entries.some((m) => m.kind === 'session'),
    daily: entries.some((m) => m.kind === 'daily'),
    cows: entries.some((m) => m.kind === 'cow'),
  };
  const source = milkDaySource(D, date);
  const kept = { withheld: 0, discarded: 0, onfarm: 0 };
  for (const m of entries) if (m.kind === 'kept') kept[m.use] = (kept[m.use] || 0) + (+m.litres || 0);
  return { date, source, official: bySource[source], bySource, has, kept, entries };
}

export function collectionValue(c) {
  if (c.pricePerLitre == null || c.pricePerLitre === '') return null;
  return (+c.litresAccepted || 0) * +c.pricePerLitre;
}

export function statementCollections(D, st) {
  return D.collections.filter((c) => c.buyerId === st.buyerId && c.date >= st.from && c.date <= st.to);
}

export function statementExpected(D, st) {
  const cols = statementCollections(D, st);
  const unpriced = cols.filter((c) => collectionValue(c) == null).length;
  const base = cols.reduce((s, c) => s + (collectionValue(c) || 0), 0);
  return { value: base + (+st.bonuses || 0) - (+st.deductions || 0), unpriced, collections: cols };
}

/**
 * Period milk & money totals, each counted once:
 *  produced  - official daily totals (one source per day)
 *  kept      - withheld / discarded / on-farm use (recorded separately)
 *  sold      - litres accepted on collections (a collection IS the sale)
 *  expected  - priced collections + statement bonuses - deductions
 *  statements- buyers' final statement amounts (statement end date in period)
 *  received  - payments by payment date
 */
export function milkTotals(D, from, to) {
  const days = new Set(D.milk.filter((m) => m.date >= from && m.date <= to).map((m) => m.date));
  let produced = 0;
  const kept = { withheld: 0, discarded: 0, onfarm: 0 };
  for (const d of days) {
    const md = milkDay(D, d);
    produced += md.official;
    for (const k in kept) kept[k] += md.kept[k] || 0;
  }
  const cols = D.collections.filter((c) => c.date >= from && c.date <= to);
  const sold = cols.reduce((s, c) => s + (+c.litresAccepted || 0), 0);
  const rejected = cols.reduce((s, c) => s + (+c.litresRejected || 0), 0);
  let expected = 0; let unpriced = 0;
  for (const c of cols) {
    const v = collectionValue(c);
    if (v == null) unpriced++; else expected += v;
  }
  let statements = 0; let received = 0;
  for (const st of D.statements) {
    if (st.to >= from && st.to <= to) {
      expected += (+st.bonuses || 0) - (+st.deductions || 0);
      if (st.statementAmount != null && st.statementAmount !== '') statements += +st.statementAmount;
    }
    if (st.paymentDate && st.paymentDate >= from && st.paymentDate <= to && st.paidAmount != null && st.paidAmount !== '') {
      received += +st.paidAmount;
    }
  }
  return {
    produced, kept, keptTotal: kept.withheld + kept.discarded + kept.onfarm,
    sold, rejected, collections: cols.length, expected, unpriced, statements, received, days: days.size,
  };
}

// ---------- today ----------

export function todayItems(D, now = Date.now()) {
  const S = settingsOf(D);
  const tz = S.timeZone;
  const today = todayKey(tz, now);
  const items = [];
  for (const { animal, hold } of milkHolds(D, now)) items.push({ type: 'hold', animal, hold, prio: 0 });
  const females = D.animals.filter((a) => isActive(a) && isFemale(a));
  for (const a of females) {
    const st = breedingStatus(D, a, now);
    if (st.state === 'awaiting' && st.checkDue) {
      const d = diffDays(today, st.checkDue);
      if (d < 0) items.push({ type: 'checkOverdue', animal: a, st, days: d, prio: 1 });
      else if (d <= S.upcomingDays) items.push({ type: 'checkSoon', animal: a, st, days: d, prio: 5 });
    }
    if (st.state === 'pregnant' && st.calving) {
      const d = diffDays(today, st.calving.from);
      if (d <= S.calvingSoonDays) items.push({ type: 'calving', animal: a, st, days: d, prio: 2 });
      if (st.dryOff && !st.dryOff.done) {
        const dd = diffDays(today, st.dryOff.due);
        if (dd <= S.dryOffSoonDays) items.push({ type: 'dryoff', animal: a, st, days: dd, prio: 3 });
      }
    }
  }
  for (const t of D.tasks) {
    if (t.done || t.kind === 'pregcheck') continue;
    const d = diffDays(today, t.date);
    if (d <= S.upcomingDays) items.push({ type: 'task', task: t, animal: D.animals.find((a) => a.id === t.animalId), days: d, prio: 4 });
  }
  for (const b of D.animals.filter((a) => isActive(a) && isBull(a))) {
    const exams = eventsOf(D, b.id, ['bse']);
    const last = exams[exams.length - 1];
    if (last?.recheckDate) {
      const d = diffDays(today, last.recheckDate);
      if (d <= S.upcomingDays) items.push({ type: 'bse', animal: b, event: last, days: d, prio: 4 });
    }
  }
  items.sort((a, b) => a.prio - b.prio || (a.days ?? 0) - (b.days ?? 0));
  return items;
}

// ---------- csv ----------

export function toCSV(rows, cols) {
  const cell = (v) => {
    if (v == null) return '';
    const s = String(v);
    // Prefix with a tab-less apostrophe guard against spreadsheet formula injection,
    // but keep codes like 0042 as text by quoting.
    const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(guarded) || /^0\d/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  const head = cols.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.get])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}
