// Clearly labelled sample data. Every record carries sample: true.
import * as db from './db.js';
import { D, tz } from './store.js';
import { todayKey, addDays, dayStartIso } from './time.js';
import { t as tr } from './i18n.js';

export async function addSampleData() {
  const z = tz();
  const t = todayKey(z);
  const at = (daysAgo, hour = 7) => new Date(Date.parse(dayStartIso(addDays(t, -daysAgo), z)) + hour * 3600000).toISOString();
  const ops = [];
  const A = (id, rec) => ops.push({ store: 'animals', put: { id: `s-${id}`, status: 'active', sample: true, breed: 'Holstein Friesian', ...rec } });
  const E = (id, rec) => ops.push({ store: 'events', put: { id: `s-e-${id}`, sample: true, ...rec } });

  A('bull', { code: 'B01', tag: 'IE 900111 0001', type: 'bull', sex: 'M', name: 'Duke', breed: 'Hereford', group: tr('Heifers') });
  A('0042', { code: '0042', tag: 'IE 123456 0042', type: 'cow', sex: 'F', group: tr('Milkers'), birthDate: addDays(t, -4 * 365) });
  A('0007', { code: '0007', tag: 'IE 123456 0007', type: 'cow', sex: 'F', group: tr('Milkers'), birthDate: addDays(t, -6 * 365) });
  A('0108', { code: '0108', tag: 'IE 123456 0108', type: 'cow', sex: 'F', group: tr('Milkers') });
  A('0115', { code: '0115', tag: 'IE 123456 0115', type: 'cow', sex: 'F', group: tr('Milkers') });
  A('0123', { code: '0123', tag: 'IE 123456 0123', type: 'cow', sex: 'F', group: tr('Milkers') });
  A('0131', { code: '0131', tag: 'IE 123456 0131', type: 'cow', sex: 'F', group: tr('Milkers') });
  A('0420', { code: '0420', tag: 'IE 123456 0420', type: 'cow', sex: 'F', group: tr('Milkers') });
  A('h201', { code: '201', tag: 'IE 123456 0201', type: 'heifer', sex: 'F', group: tr('Heifers') });
  A('h202', { code: '202', tag: 'IE 123456 0202', type: 'heifer', sex: 'F', group: tr('Heifers') });
  A('sold', { code: '0099', tag: 'IE 123456 0099', type: 'cow', sex: 'F', group: tr('Milkers'), status: 'sold', statusDate: addDays(t, -40) });

  // 0007: inseminated 40 days ago, no check yet -> overdue check
  E('1', { animalId: 's-0007', kind: 'ai', at: at(40), sire: tr('Sample Sire A'), technician: tr('Sample AI tech') });
  // 0108: pregnant, calving due in ~12 days, not dried off
  E('2', { animalId: 's-0108', kind: 'ai', at: at(271), sire: tr('Sample Sire B') });
  E('3', { animalId: 's-0108', kind: 'pregcheck', at: at(230), result: 'pregnant', method: tr('Ultrasound'), examiner: tr('Sample Vet') });
  // 0115: pregnant, dry-off due soon
  E('4', { animalId: 's-0115', kind: 'ai', at: at(215), sire: tr('Sample Sire A') });
  E('5', { animalId: 's-0115', kind: 'pregcheck', at: at(180), result: 'pregnant', method: tr('Ultrasound'), examiner: tr('Sample Vet') });
  // 0123: inconclusive check -> stays on follow-up
  E('6', { animalId: 's-0123', kind: 'ai', at: at(33), sire: tr('Sample Sire B') });
  E('7', { animalId: 's-0123', kind: 'pregcheck', at: at(3), result: 'inconclusive', method: tr('Ultrasound'), examiner: tr('Sample Vet') });
  // 0131: mastitis + treatment with active milk withdrawal
  E('8', { animalId: 's-0131', kind: 'health', at: at(1, 6), condition: 'mastitis', quarters: ['LF'], severity: tr('Moderate') });
  E('9', { animalId: 's-0131', kind: 'treatment', at: at(1, 7), product: tr('Sample intramammary tube'), dose: tr('1 tube LF'), by: tr('Farmer'), milkRequired: true, milkPeriod: 84, milkUnit: 'hours', meatRequired: true, meatPeriod: 4 });
  E('10', { animalId: 's-0420', kind: 'heat', at: at(2, 18), sign: tr('Standing to be mounted') });
  E('11', { animalId: 's-bull', kind: 'bse', at: at(300), result: 'satisfactory', examiner: tr('Sample Vet'), recheckDate: addDays(t, 5) });
  ops.push({ store: 'exposures', put: { id: 's-x1', sample: true, bullId: 's-bull', group: tr('Heifers'), start: addDays(t, -50), end: null, animalIds: ['s-h201', 's-h202'] } });
  ops.push({ store: 'tasks', put: { id: 's-t1', sample: true, kind: 'vet', title: tr('Sample: vet herd scan'), date: addDays(t, 2), done: false } });

  // Milk: two sessions a day for 10 days, a collection every 2 days.
  ops.push({ store: 'buyers', put: { id: 's-buyer', sample: true, name: tr('Sample Creamery'), defaultPrice: 0.42 } });
  for (let d = 1; d <= 10; d++) {
    const date = addDays(t, -d);
    ops.push({ store: 'milk', put: { id: `s-m-${d}-am`, sample: true, kind: 'session', date, session: 'AM', litres: 410 + (d % 3) * 5 } });
    ops.push({ store: 'milk', put: { id: `s-m-${d}-pm`, sample: true, kind: 'session', date, session: 'PM', litres: 380 + (d % 4) * 5 } });
    ops.push({ store: 'milkDays', put: { id: date, sample: true, source: 'sessions', auto: true } });
    if (d % 2 === 0) {
      ops.push({ store: 'collections', put: { id: `s-c-${d}`, sample: true, date, buyerId: 's-buyer', litresAccepted: 1560, litresRejected: 0, reference: `SAMPLE-${d}`, pricePerLitre: 0.42 } });
      ops.push({ store: 'quality', put: { id: `s-q-${d}`, sample: true, date, sampleType: 'collection', collectionId: `s-c-${d}`, tankTemp: 3.6 + (d % 3) / 10, butterfat: 4.1 + (d % 4) / 20, protein: 3.4 + (d % 2) / 20, scc: 180 + d * 4, bacteria: 12 + d } });
    }
  }
  ops.push({ store: 'milk', put: { id: 's-m-kept', sample: true, kind: 'kept', date: addDays(t, -1), use: 'withheld', litres: 18, animalId: 's-0131' } });
  await db.write(ops);
}

/** Remove sample records and anything recorded on sample animals. */
export async function removeSampleData() {
  const data = D();
  const sampleAnimals = new Set(data.animals.filter((a) => a.sample).map((a) => a.id));
  const ops = [];
  for (const store of ['animals', 'events', 'exposures', 'tasks', 'milk', 'milkDays', 'buyers', 'collections', 'statements', 'quality']) {
    for (const r of data[store] || []) {
      let onSample = r.sample || sampleAnimals.has(r.animalId);
      // Keep a sample buyer if real collections or statements point at it.
      if (store === 'buyers' && [...data.collections, ...data.statements].some((c) => c.buyerId === r.id && !c.sample)) onSample = false;
      if (onSample) ops.push({ store, del: r.id });
      else if (store === 'exposures' && (r.animalIds || []).some((id) => sampleAnimals.has(id))) {
        ops.push({ store, put: { ...r, animalIds: r.animalIds.filter((id) => !sampleAnimals.has(id)), bullId: sampleAnimals.has(r.bullId) ? null : r.bullId } });
      }
    }
  }
  if (ops.length) await db.write(ops);
  return ops.length;
}
