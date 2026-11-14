// Every record form. Each opens a sheet; saving writes to IndexedDB.
import * as db from './db.js';
import { html, openForm, toast } from './ui.js';
import { D, S, tz, bulls, groups, distinct, notFuture, removeWithUndo, animal as getAnimal } from './store.js';
import {
  animalLabel, breedingAttempts, breedingStatus, isActive, isFemale, TYPES, sireLabel,
  treatmentMilkEnd, withdrawals,
} from './logic.js';
import { fmtDay, fmtDateTime, todayKey, dayKey, addDays, fromInputDateTime } from './time.js';

const nowIso = () => new Date().toISOString();

export function cowBanner(a, sub = '') {
  return html`<div class="cow-banner"><span class="cow-banner-label">${TYPES[a.type] || 'Animal'}</span>
    <span class="code-xl">${animalLabel(a)}</span>
    <span class="cow-banner-sub">${a.tag && a.tag !== a.code ? `Tag ${a.tag}` : ''}${a.group ? ` · ${a.group}` : ''}${sub}</span></div>`;
}

async function saveEvent(rec) {
  await db.put('events', rec);
}

function delEvent(e, label) {
  return () => removeWithUndo('events', e, label || 'Record deleted');
}

const bullOptions = () => [['', '— Not on farm records / unknown —'], ...bulls().filter(isActive).map((b) => [b.id, `${animalLabel(b)}${b.name ? ` ${b.name}` : ''}`])];
const females = () => D().animals.filter((a) => isActive(a) && isFemale(a))
  .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

// ---------- breeding ----------

export function recordInsemination(a, existing) {
  const sires = distinct(D().events.filter((e) => e.kind === 'ai').map((e) => e.sire));
  const techs = distinct(D().events.filter((e) => e.kind === 'ai').map((e) => e.technician));
  openForm({
    title: existing ? 'Edit insemination' : 'Record insemination',
    header: cowBanner(a),
    tz: tz(),
    recordId: existing?.id,
    values: existing || { at: nowIso() },
    submitLabel: existing ? 'Save changes' : 'Save insemination',
    fields: [
      { name: 'at', label: 'Date and time', type: 'datetime', required: true, quick: true, help: 'Defaults to now. Change it to backdate.' },
      { name: 'sire', label: 'Sire (bull name or code)', detail: true, list: sires },
      { name: 'semenBatch', label: 'Semen batch / straw code', detail: true },
      { name: 'technician', label: 'Technician', detail: true, list: techs },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      notFuture(v.at);
      if (!existing) {
        const dup = D().events.find((e) => e.id !== id && e.animalId === a.id && e.kind === 'ai'
          && Math.abs(Date.parse(e.at) - Date.parse(v.at)) < 60000);
        if (dup) return { msg: `Already saved for ${animalLabel(a)} — not added twice` };
      }
      await saveEvent({ ...(existing || {}), ...v, id, animalId: a.id, kind: 'ai' });
      return `Insemination saved for ${animalLabel(a)}`;
    },
    onDelete: existing && delEvent(existing, 'Insemination deleted'),
  });
}

export function recordHeat(a, existing) {
  openForm({
    title: existing ? 'Edit heat' : 'Record heat', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso() },
    fields: [
      { name: 'at', label: 'Seen in heat', type: 'datetime', required: true, quick: true },
      { name: 'sign', label: 'Sign', type: 'select', detail: true, options: [['', '—'], 'Standing to be mounted', 'Mounting others', 'Clear mucus', 'Activity monitor alert', 'Other'] },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) { notFuture(v.at); await saveEvent({ ...(existing || {}), ...v, id, animalId: a.id, kind: 'heat' }); return 'Heat saved'; },
    onDelete: existing && delEvent(existing),
  });
}

export function recordNatural(a, existing) {
  openForm({
    title: existing ? 'Edit natural service' : 'Observed natural service', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso() },
    fields: [
      { name: 'at', label: 'Service seen', type: 'datetime', required: true, quick: true },
      { name: 'bullId', label: 'Bull', type: 'select', options: bullOptions() },
      { name: 'bullText', label: 'Bull name (if not on farm records)', showIf: { name: 'bullId', is: [''] } },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) { notFuture(v.at); await saveEvent({ ...(existing || {}), ...v, id, animalId: a.id, kind: 'natural' }); return 'Natural service saved'; },
    onDelete: existing && delEvent(existing),
  });
}

function attemptLabel(t) {
  if (t.kind === 'exposure') return `Bull exposure ${fmtDay(t.start)} – ${t.end ? fmtDay(t.end) : 'ongoing'}${t.sire ? ` (${t.sire})` : ''}`;
  return `${t.kind === 'ai' ? 'AI' : 'Natural service'} ${fmtDay(t.start)}${t.sire ? ` (${t.sire})` : ''}`;
}

export function recordPregCheck(a, existing) {
  const attempts = breedingAttempts(D(), a.id, tz());
  const latest = attempts[attempts.length - 1];
  const examiners = distinct(D().events.filter((e) => e.kind === 'pregcheck').map((e) => e.examiner));
  openForm({
    title: existing ? 'Edit pregnancy check' : 'Pregnancy check', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso(), serviceId: latest?.id || '' },
    fields: [
      { name: 'result', label: 'Result', type: 'choice', required: true, options: [['pregnant', 'Pregnant'], ['open', 'Open (not pregnant)'], ['inconclusive', 'Inconclusive']] },
      { name: 'at', label: 'Check date', type: 'datetime', required: true, quick: true },
      { name: 'serviceId', label: 'Service this check is for', type: 'select', options: [...attempts.slice().reverse().map((t) => [t.id, attemptLabel(t)]), ['', 'Not known']] },
      { name: 'method', label: 'Method', type: 'select', detail: true, options: [['', '—'], 'Ultrasound', 'Rectal palpation', 'Blood test', 'Milk test', 'Other'] },
      { name: 'examiner', label: 'Examiner (vet or technician)', detail: true, list: examiners },
      { name: 'vetDueDate', label: "Vet's expected calving date", type: 'date', detail: true, showIf: { name: 'result', is: ['pregnant'] }, help: 'Overrides the calculated date.' },
      { name: 'nextCheck', label: 'Set a reminder for the next check', type: 'date', detail: true, showIf: { name: 'result', is: ['inconclusive', 'pregnant'] }, help: `Inconclusive results are rechecked after ${S().recheckDays} days unless you pick a date.` },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      notFuture(v.at);
      const ops = [{ store: 'events', put: { ...(existing || {}), ...v, nextCheck: undefined, id, animalId: a.id, kind: 'pregcheck' } }];
      // A check closes any open check reminder for this animal.
      for (const t of D().tasks) if (!t.done && t.kind === 'pregcheck' && t.animalId === a.id) ops.push({ store: 'tasks', put: { ...t, done: true, doneAt: nowIso() } });
      if (v.nextCheck) ops.push({ store: 'tasks', put: { id: `${id}-next`, kind: 'pregcheck', animalId: a.id, date: v.nextCheck, title: `Pregnancy check ${animalLabel(a)}`, done: false } });
      await db.write(ops);
      return `Pregnancy check saved: ${v.result}`;
    },
    onDelete: existing && delEvent(existing),
  });
}

export function setCheckReminder(a) {
  const st = breedingStatus(D(), a);
  const existing = st.reminder;
  openForm({
    title: 'Pregnancy check reminder', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values: existing || { date: st.checkDue || addDays(todayKey(tz()), 7) },
    fields: [
      { name: 'date', label: 'Check on', type: 'date', required: true, help: `Default follows your vet's schedule: first check ${S().firstCheckDays} days after service, recheck ${S().recheckDays} days after an inconclusive result.` },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      await db.put('tasks', { ...(existing || {}), ...v, id, kind: 'pregcheck', animalId: a.id, title: `Pregnancy check ${animalLabel(a)}`, done: false });
      return 'Reminder set';
    },
    onDelete: existing && (() => removeWithUndo('tasks', existing, 'Reminder removed')),
    deleteLabel: 'Remove reminder (use vet schedule)',
  });
}

export function recordDryOff(a, existing) {
  openForm({
    title: existing ? 'Edit dry-off' : 'Dry off', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso() },
    fields: [
      { name: 'at', label: 'Dried off', type: 'datetime', required: true, quick: true },
      { name: 'notes', label: 'Notes (record dry-cow tubes as a treatment)', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) { notFuture(v.at); await saveEvent({ ...(existing || {}), ...v, id, animalId: a.id, kind: 'dryoff' }); return 'Dry-off saved'; },
    onDelete: existing && delEvent(existing),
  });
}

export function recordLoss(a, existing) {
  openForm({
    title: existing ? 'Edit pregnancy loss' : 'Pregnancy loss', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso() },
    fields: [
      { name: 'at', label: 'Date noticed', type: 'datetime', required: true, quick: true },
      { name: 'cause', label: 'Suspected cause', detail: true },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) { notFuture(v.at); await saveEvent({ ...(existing || {}), ...v, id, animalId: a.id, kind: 'loss' }); return 'Pregnancy loss saved'; },
    onDelete: existing && delEvent(existing),
  });
}

export function recordCalving(a, existing) {
  const st = breedingStatus(D(), a);
  const latest = st.latest;
  const defSire = latest?.exact ? (latest.event.bullId ? '' : latest.sire) : '';
  const values = existing ? { ...existing } : {
    at: nowIso(), calfCount: '1', assistance: 'none',
    bullId: latest?.event?.bullId || latest?.exposure?.bullId || '', sire: defSire,
  };
  if (existing) (existing.calves || []).forEach((c, i) => {
    const n = i + 1;
    Object.assign(values, { [`c${n}_outcome`]: c.outcome, [`c${n}_sex`]: c.sex, [`c${n}_tag`]: c.tag, [`c${n}_weight`]: c.weight, [`c${n}_colostrum`]: c.colostrumAt, [`c${n}_keep`]: !!c.calfId });
  });
  else for (let n = 1; n <= 3; n++) Object.assign(values, { [`c${n}_outcome`]: 'alive', [`c${n}_keep`]: true });
  const calfFields = [];
  for (let n = 1; n <= 3; n++) {
    const showIf = { name: 'calfCount', is: n === 1 ? ['1', '2', '3'] : n === 2 ? ['2', '3'] : ['3'] };
    calfFields.push(
      { type: 'heading', label: `Calf ${n}`, showIf },
      { name: `c${n}_outcome`, label: 'Outcome', type: 'choice', options: [['alive', 'Alive'], ['stillborn', 'Stillborn'], ['died', 'Died soon after']], showIf },
      { name: `c${n}_sex`, label: 'Sex', type: 'choice', options: [['F', 'Heifer (F)'], ['M', 'Bull (M)']], showIf },
      { name: `c${n}_tag`, label: 'Ear tag', showIf },
      { name: `c${n}_weight`, label: 'Birth weight (kg)', type: 'number', showIf },
      { name: `c${n}_colostrum`, label: 'First colostrum feeding', type: 'datetime', showIf },
      { name: `c${n}_keep`, label: 'Add this calf to the herd list', type: 'checkbox', showIf },
    );
  }
  openForm({
    title: existing ? 'Edit calving' : 'Record calving', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values,
    fields: [
      { name: 'at', label: 'Calved', type: 'datetime', required: true, quick: true },
      { name: 'calfCount', label: 'Number of calves', type: 'choice', required: true, options: [['1', 'One'], ['2', 'Twins'], ['3', 'Triplets']] },
      { name: 'assistance', label: 'Assistance', type: 'choice', options: [['none', 'None'], ['farmer', 'Farmer helped'], ['vet', 'Vet'], ['caesarean', 'Caesarean']] },
      ...calfFields,
      { type: 'heading', label: 'Sire', detail: true },
      { name: 'bullId', label: 'Sire on farm records', type: 'select', detail: true, options: bullOptions() },
      { name: 'sire', label: 'Sire name / code (AI sire or other)', detail: true },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      notFuture(v.at);
      const count = +v.calfCount;
      const ops = [];
      const calves = [];
      for (let n = 1; n <= count; n++) {
        const prev = existing?.calves?.[n - 1];
        const c = {
          outcome: v[`c${n}_outcome`] || 'alive', sex: v[`c${n}_sex`], tag: v[`c${n}_tag`],
          weight: v[`c${n}_weight`], colostrumAt: v[`c${n}_colostrum`], calfId: prev?.calfId || null,
        };
        const keep = v[`c${n}_keep`] && c.outcome === 'alive';
        if (keep) {
          const calfId = c.calfId || `${id}-calf${n}`;
          const prior = getAnimal(calfId) || {};
          ops.push({ store: 'animals', put: {
            ...prior, id: calfId, type: 'calf', sex: c.sex || prior.sex || null, tag: c.tag || prior.tag || null,
            code: prior.code || c.tag || null, birthDate: dayKey(v.at, tz()), damId: a.id,
            sireId: v.bullId || null, sireText: v.sire || null, birthWeight: c.weight, group: prior.group || 'Calves',
            status: prior.status || 'active', sample: a.sample || undefined,
          } });
          c.calfId = calfId;
        }
        calves.push(c);
      }
      ops.push({ store: 'events', put: { ...(existing || {}), at: v.at, calfCount: count, assistance: v.assistance, bullId: v.bullId, sire: v.sire, notes: v.notes, calves, id, animalId: a.id, kind: 'calving' } });
      if (a.type === 'heifer') ops.push({ store: 'animals', put: { ...a, type: 'cow' } });
      await db.write(ops);
      return `Calving saved — ${count === 2 ? 'twins' : count === 3 ? 'triplets' : '1 calf'}`;
    },
    onDelete: existing && delEvent(existing, 'Calving deleted (calf records kept)'),
  });
}

// ---------- health ----------

export function recordHealth(a, existing, condition) {
  openForm({
    title: existing ? 'Edit health record' : 'Health problem', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso(), condition: condition || 'mastitis' },
    fields: [
      { name: 'condition', label: 'Problem', type: 'choice', required: true, options: [['mastitis', 'Mastitis'], ['lameness', 'Lameness'], ['other', 'Other']] },
      { name: 'at', label: 'Seen', type: 'datetime', required: true, quick: true },
      { name: 'quarters', label: 'Quarter(s)', type: 'multi', options: [['LF', 'Left front'], ['RF', 'Right front'], ['LH', 'Left hind'], ['RH', 'Right hind']], showIf: { name: 'condition', is: ['mastitis'] } },
      { name: 'leg', label: 'Leg', type: 'choice', options: [['LF', 'LF'], ['RF', 'RF'], ['LH', 'LH'], ['RH', 'RH']], showIf: { name: 'condition', is: ['lameness'] } },
      { name: 'description', label: 'What is wrong', showIf: { name: 'condition', is: ['other'] } },
      { name: 'severity', label: 'Severity', type: 'select', detail: true, options: [['', '—'], 'Mild', 'Moderate', 'Severe'] },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      notFuture(v.at);
      await saveEvent({ ...(existing || {}), ...v, id, animalId: a.id, kind: 'health' });
      return { msg: 'Health record saved', action: !existing && { label: 'Add treatment', fn: () => recordTreatment(a) } };
    },
    onDelete: existing && delEvent(existing),
  });
}

export function recordVaccination(a, existing) {
  const products = distinct(D().events.filter((e) => e.kind === 'vaccination').map((e) => e.product));
  openForm({
    title: existing ? 'Edit vaccination' : 'Vaccination', header: a ? cowBanner(a) : '', tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso() },
    fields: [
      { name: 'product', label: 'Vaccine', required: true, list: products },
      { name: 'at', label: 'Given', type: 'datetime', required: true, quick: true },
      { name: 'dose', label: 'Dose', detail: true },
      { name: 'batch', label: 'Batch number', detail: true },
      { name: 'by', label: 'Given by', detail: true },
      { name: 'booster', label: 'Booster due', type: 'date', detail: true, help: 'Adds a reminder to Today.' },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      notFuture(v.at);
      const ops = [{ store: 'events', put: { ...(existing || {}), ...v, id, animalId: a.id, kind: 'vaccination' } }];
      if (v.booster) ops.push({ store: 'tasks', put: { id: `${id}-booster`, kind: 'other', animalId: a.id, date: v.booster, title: `Booster: ${v.product} for ${animalLabel(a)}`, done: false } });
      await db.write(ops);
      return 'Vaccination saved';
    },
    onDelete: existing && delEvent(existing),
  });
}

export function recordTreatment(a, existing) {
  const products = distinct(D().events.filter((e) => e.kind === 'treatment').map((e) => e.product));
  const people = distinct(D().events.filter((e) => e.kind === 'treatment').map((e) => e.by));
  const values = existing ? { ...existing, milk: existing.milkRequired ? 'yes' : 'no', meat: existing.meatRequired ? 'yes' : 'no' }
    : { at: nowIso(), milkUnit: 'hours', meat: 'no' };
  openForm({
    title: existing ? 'Edit treatment' : 'Treatment', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values,
    fields: [
      { name: 'product', label: 'Product', required: true, list: products },
      { name: 'at', label: 'First dose', type: 'datetime', required: true, quick: true },
      { name: 'milk', label: 'Milk withdrawal', type: 'choice', required: true, options: [['yes', 'Yes — withhold milk'], ['no', 'Not applicable']] },
      { name: 'milkPeriod', label: 'Milk withdrawal period (from label or vet)', type: 'number', min: 0, showIf: { name: 'milk', is: ['yes'] } },
      { name: 'milkUnit', label: 'Period is in', type: 'choice', options: [['hours', 'Hours'], ['days', 'Days']], showIf: { name: 'milk', is: ['yes'] } },
      { name: 'milkEndManual', label: 'Or exact milk withdrawal end', type: 'datetime', showIf: { name: 'milk', is: ['yes'] }, help: 'Leave both blank if you do not know yet — the milk hold stays on until you add it.' },
      { type: 'info', name: 'calc', html: html`<p class="calc" data-calc></p>`, showIf: { name: 'milk', is: ['yes'] } },
      { name: 'meat', label: 'Meat withdrawal', type: 'choice', options: [['yes', 'Yes'], ['no', 'Not applicable']] },
      { name: 'meatPeriod', label: 'Meat withdrawal period (days)', type: 'number', min: 0, showIf: { name: 'meat', is: ['yes'] } },
      { name: 'meatEndManual', label: 'Or exact meat withdrawal end', type: 'datetime', showIf: { name: 'meat', is: ['yes'] } },
      { name: 'lastAt', label: 'Last dose (if more than one)', type: 'datetime', detail: true, help: 'Withdrawal periods count from the last dose.' },
      { name: 'dose', label: 'Dose', detail: true },
      { name: 'route', label: 'Route', type: 'select', detail: true, options: [['', '—'], 'Intramammary', 'Intramuscular', 'Subcutaneous', 'Intravenous', 'Oral', 'Topical', 'Other'] },
      { name: 'batch', label: 'Batch number', detail: true },
      { name: 'by', label: 'Administered by', detail: true, list: people },
      { name: 'reason', label: 'Reason', detail: true },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    onMount(el, form) {
      const calc = el.querySelector('[data-calc]');
      const upd = () => {
        const get = (n) => form.querySelector(`[name="${n}"]`);
        const unit = form.querySelector('[name="milkUnit"]:checked')?.value || 'hours';
        const conv = (n) => (get(n).value ? fromInputDateTime(get(n).value, tz()) : null);
        const t = {
          milkRequired: true, at: conv('at'), lastAt: conv('lastAt'),
          milkPeriod: get('milkPeriod').value === '' ? null : +get('milkPeriod').value, milkUnit: unit,
          milkEndManual: conv('milkEndManual'),
        };
        const end = t.at ? treatmentMilkEnd(t) : null;
        calc.textContent = end ? `Milk hold until ${fmtDateTime(end, tz())}` : 'Milk hold stays on until an end time is entered.';
      };
      form.addEventListener('input', upd); form.addEventListener('change', upd); upd();
    },
    async onSubmit(v, id) {
      notFuture(v.at);
      const rec = { ...(existing || {}), ...v, id, animalId: a.id, kind: 'treatment', milkRequired: v.milk === 'yes', meatRequired: v.meat === 'yes' };
      delete rec.milk; delete rec.meat; delete rec.calc;
      if (!rec.milkRequired) { rec.milkPeriod = null; rec.milkEndManual = null; }
      if (!rec.meatRequired) { rec.meatPeriod = null; rec.meatEndManual = null; }
      await saveEvent(rec);
      const w = withdrawals({ ...D() }, a.id);
      return w.milk.active ? `Saved — WITHHOLD MILK from ${animalLabel(a)}` : 'Treatment saved';
    },
    onDelete: existing && delEvent(existing, 'Treatment deleted'),
  });
}

export function recordMovement(a, existing) {
  const values = existing || { at: nowIso(), direction: isActive(a) ? 'off' : 'on' };
  openForm({
    title: existing ? 'Edit movement' : 'Movement on / off farm', header: cowBanner(a), tz: tz(), recordId: existing?.id,
    values,
    fields: [
      { name: 'direction', label: 'Direction', type: 'choice', required: true, options: [['off', 'Off the farm / died'], ['on', 'On to the farm']] },
      { name: 'reasonOff', label: 'Reason', type: 'choice', options: [['sold', 'Sold'], ['transferred', 'Transferred'], ['deceased', 'Died / put down']], showIf: { name: 'direction', is: ['off'] } },
      { name: 'reasonOn', label: 'Reason', type: 'choice', options: [['purchased', 'Bought in'], ['returned', 'Returned'], ['other', 'Other']], showIf: { name: 'direction', is: ['on'] } },
      { name: 'at', label: 'Date', type: 'datetime', required: true, quick: true },
      { name: 'party', label: 'Buyer / seller / destination', detail: true },
      { name: 'reference', label: 'Movement or passport reference', detail: true },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      notFuture(v.at);
      if (v.direction === 'off' && !v.reasonOff) throw new Error('Choose a reason.');
      if (v.direction === 'off' && v.reasonOff !== 'deceased') {
        const w = withdrawals(D(), a.id);
        if ((w.meat.active || w.milk.active) && !confirm(`${animalLabel(a)} has an active withdrawal. Move her off anyway?`)) return { msg: false };
      }
      const status = v.direction === 'off' ? v.reasonOff : 'active';
      await db.write([
        { store: 'events', put: { ...(existing || {}), ...v, id, animalId: a.id, kind: 'movement' } },
        { store: 'animals', put: { ...getAnimal(a.id), status, statusDate: dayKey(v.at, tz()) } },
      ]);
      return status === 'active' ? 'Movement saved' : `${animalLabel(a)} moved to the archive (${status})`;
    },
    onDelete: existing && (() => {
      const before = getAnimal(a.id);
      return removeWithUndo('events', existing, 'Movement deleted — status set back to active',
        [{ store: 'animals', put: { ...before, status: 'active', statusDate: null } }],
        [{ store: 'animals', put: before }]);
    }),
  });
}

// ---------- bulls ----------

export function recordBSE(b, existing) {
  openForm({
    title: existing ? 'Edit soundness exam' : 'Breeding soundness exam', header: cowBanner(b), tz: tz(), recordId: existing?.id,
    values: existing || { at: nowIso() },
    fields: [
      { name: 'at', label: 'Exam date', type: 'datetime', required: true, quick: true },
      { name: 'result', label: 'Result', type: 'choice', required: true, options: [['satisfactory', 'Satisfactory'], ['unsatisfactory', 'Unsatisfactory'], ['deferred', 'Deferred / recheck']] },
      { name: 'recheckDate', label: 'Recheck due', type: 'date', help: 'Shows on Today when it is near.' },
      { name: 'examiner', label: 'Vet', detail: true },
      { name: 'notes', label: 'Findings / notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) { notFuture(v.at); await saveEvent({ ...(existing || {}), ...v, id, animalId: b.id, kind: 'bse' }); return 'Exam saved'; },
    onDelete: existing && delEvent(existing),
  });
}

/** A bull running with a group: the service date and sire stay uncertain. */
export function recordExposure(existing, preset = {}) {
  const fem = females();
  openForm({
    title: existing ? 'Edit bull exposure' : 'Bull with a group', tz: tz(), recordId: existing?.id,
    header: html`<p class="lead">Use this when a bull runs with cows and you did not see the service. Calving is shown as a date range.</p>`,
    values: existing || { start: todayKey(tz()), ...preset },
    fields: [
      { name: 'bullId', label: 'Bull', type: 'select', options: bullOptions() },
      { name: 'bullText', label: 'Bull name (if not on farm records)', showIf: { name: 'bullId', is: [''] } },
      { name: 'group', label: 'Group', list: groups(), help: 'Ticks the animals in this group below.' },
      { name: 'start', label: 'Bull went in', type: 'date', required: true },
      { name: 'end', label: 'Bull came out', type: 'date', help: 'Leave empty while the bull is still with them.' },
      { name: 'animalIds', label: 'Animals exposed', type: 'multi', required: true, options: fem.map((a) => [a.id, `${animalLabel(a)}${a.group ? ` · ${a.group}` : ''}`]) },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    onMount(el, form) {
      const g = form.querySelector('[name="group"]');
      g.addEventListener('change', () => {
        const ids = new Set(fem.filter((a) => a.group === g.value).map((a) => a.id));
        for (const c of form.querySelectorAll('[name="animalIds"]')) c.checked = ids.has(c.value);
      });
    },
    async onSubmit(v, id) {
      if (v.end && v.end < v.start) throw new Error('The end date is before the start date.');
      if (v.start > todayKey(tz())) throw new Error('The start date is in the future.');
      await db.put('exposures', { ...(existing || {}), ...v, id });
      return `Exposure saved for ${v.animalIds.length} animal${v.animalIds.length === 1 ? '' : 's'}`;
    },
    onDelete: existing && (() => removeWithUndo('exposures', existing, 'Exposure deleted')),
  });
}

// ---------- animals & tasks ----------

export function editAnimal(existing, preset = {}) {
  const fem = D().animals.filter((a) => isFemale(a) && a.id !== existing?.id)
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  openForm({
    title: existing ? `Edit ${animalLabel(existing)}` : 'Add animal', tz: tz(), recordId: existing?.id,
    values: existing || { type: 'cow', ...preset },
    fields: [
      { name: 'code', label: 'Farm code', inputmode: 'text', help: 'Typed exactly as written: 0042 stays 0042.' },
      { name: 'tag', label: 'Ear tag', inputmode: 'text' },
      { name: 'type', label: 'Type', type: 'choice', required: true, options: Object.entries(TYPES) },
      { name: 'sex', label: 'Sex', type: 'choice', options: [['F', 'Female'], ['M', 'Male']], showIf: { name: 'type', is: ['calf'] } },
      { name: 'group', label: 'Group', list: groups() },
      { name: 'name', label: 'Name', detail: true },
      { name: 'breed', label: 'Breed', detail: true, list: distinct(D().animals.map((a) => a.breed)) },
      { name: 'birthDate', label: 'Date of birth', type: 'date', detail: true },
      { name: 'damId', label: 'Dam', type: 'select', detail: true, options: [['', '—'], ...fem.map((a) => [a.id, animalLabel(a)])] },
      { name: 'sireText', label: 'Sire', detail: true },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) {
      if (!v.code && !v.tag) throw new Error('Enter a farm code or an ear tag.');
      const clash = D().animals.find((x) => x.id !== id && isActive(x) && v.code && x.code === v.code);
      if (clash) throw new Error(`Code ${v.code} is already used by another active animal.`);
      if (v.type !== 'calf') v.sex = ['cow', 'heifer'].includes(v.type) ? 'F' : 'M';
      await db.put('animals', { status: 'active', ...(existing || {}), ...v, id });
      return { msg: existing ? 'Animal updated' : `${v.code || v.tag} added`, go: existing ? undefined : `#/animal/${id}` };
    },
    onDelete: existing && (() => {
      const evs = D().events.filter((e) => e.animalId === existing.id);
      if (!confirm(`Delete ${animalLabel(existing)} and ${evs.length} record(s) about her/him completely? To keep history, record a movement off the farm instead.`)) throw new Error('Not deleted.');
      return db.write([{ store: 'animals', del: existing.id }, ...evs.map((e) => ({ store: 'events', del: e.id }))]).then(() => ({ go: '#/herd' }));
    }),
    deleteLabel: 'Delete animal completely',
    deleteConfirm: 'Delete this animal?',
  });
}

export function editTask(existing, preset = {}) {
  const all = D().animals.filter(isActive).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
  openForm({
    title: existing ? 'Edit reminder' : 'Vet visit or reminder', tz: tz(), recordId: existing?.id,
    values: existing || { date: todayKey(tz()), kind: 'vet', ...preset },
    fields: [
      { name: 'kind', label: 'Type', type: 'choice', options: [['vet', 'Vet visit'], ['other', 'Other job']] },
      { name: 'title', label: 'What', required: true, placeholder: 'e.g. Herd pregnancy scan' },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'animalId', label: 'Animal (optional)', type: 'select', detail: true, options: [['', '—'], ...all.map((a) => [a.id, animalLabel(a)])] },
      { name: 'notes', label: 'Notes', type: 'textarea', detail: true },
    ],
    async onSubmit(v, id) { await db.put('tasks', { done: false, ...(existing || {}), ...v, id }); return 'Reminder saved'; },
    onDelete: existing && (() => removeWithUndo('tasks', existing, 'Reminder deleted')),
  });
}

export async function completeTask(t) {
  await db.put('tasks', { ...t, done: true, doneAt: nowIso() });
  toast('Marked done', { action: { label: 'Undo', fn: () => db.put('tasks', { ...t, done: false }) } });
}

/** Open the right edit form for any event. */
export function editEvent(e) {
  const a = getAnimal(e.animalId);
  if (!a) return;
  const map = {
    ai: recordInsemination, heat: recordHeat, natural: recordNatural, pregcheck: recordPregCheck, dryoff: recordDryOff,
    loss: recordLoss, calving: recordCalving, health: recordHealth, vaccination: recordVaccination,
    treatment: recordTreatment, movement: recordMovement, bse: recordBSE,
  };
  map[e.kind]?.(a, e);
}

export { sireLabel, fmtDateTime };
