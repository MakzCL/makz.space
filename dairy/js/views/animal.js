import { html } from '../ui.js';
import { D, tz } from '../store.js';
import * as db from '../db.js';
import {
  animalLabel, breedingAttempts, breedingStatus, eventsOf, isActive, isFemale, isBull, TYPES, STATUS,
  withdrawals, treatmentMilkEnd, treatmentMeatEnd, overlappingTreatments, sireLabel,
} from '../logic.js';
import { fmtDay, fmtDateTime, dayKey } from '../time.js';
import { breedingCard, holdText, animalRow, empty } from '../components.js';
import * as A from '../actions.js';

const KIND_LABEL = {
  ai: 'Insemination (AI)', heat: 'Heat seen', natural: 'Natural service', pregcheck: 'Pregnancy check', dryoff: 'Dried off',
  calving: 'Calving', loss: 'Pregnancy loss', health: 'Health', vaccination: 'Vaccination', treatment: 'Treatment',
  movement: 'Movement', bse: 'Breeding soundness exam',
};

export function describe(e) {
  const z = tz();
  switch (e.kind) {
    case 'ai': return [e.sire && `Sire ${e.sire}`, e.semenBatch && `Batch ${e.semenBatch}`, e.technician && `by ${e.technician}`].filter(Boolean).join(' · ');
    case 'natural': return sireLabel(D(), e) || 'Bull not recorded';
    case 'pregcheck': return [{ pregnant: 'PREGNANT', open: 'OPEN', inconclusive: 'INCONCLUSIVE' }[e.result], e.method, e.examiner, e.vetDueDate && `vet due date ${fmtDay(e.vetDueDate)}`].filter(Boolean).join(' · ');
    case 'calving': return [`${e.calfCount} calf${e.calfCount > 1 ? 'ves' : ''}`, e.assistance && e.assistance !== 'none' && `assisted: ${e.assistance}`,
      ...(e.calves || []).map((c, i) => `#${i + 1} ${c.sex === 'F' ? 'heifer' : c.sex === 'M' ? 'bull' : ''} ${c.outcome}${c.tag ? ` tag ${c.tag}` : ''}${c.weight ? ` ${c.weight} kg` : ''}${c.colostrumAt ? ` colostrum ${fmtDateTime(c.colostrumAt, z)}` : ''}`)].filter(Boolean).join(' · ');
    case 'health': return [e.condition === 'other' ? e.description : e.condition, (e.quarters || []).join(' '), e.leg, e.severity].filter(Boolean).join(' · ');
    case 'vaccination': return [e.product, e.dose, e.batch && `batch ${e.batch}`, e.by].filter(Boolean).join(' · ');
    case 'treatment': {
      const me = treatmentMilkEnd(e); const te = treatmentMeatEnd(e);
      return [e.product, e.dose, e.batch && `batch ${e.batch}`, e.by && `by ${e.by}`,
        e.milkRequired ? (me ? `milk withdrawal to ${fmtDateTime(me, z)}` : 'MILK WITHDRAWAL END MISSING') : 'no milk withdrawal',
        e.meatRequired && (te ? `meat to ${fmtDateTime(te, z)}` : 'MEAT WITHDRAWAL END MISSING')].filter(Boolean).join(' · ');
    }
    case 'movement': return [e.direction === 'off' ? `Off: ${e.reasonOff}` : `On: ${e.reasonOn || ''}`, e.party, e.reference].filter(Boolean).join(' · ');
    case 'bse': return [e.result, e.examiner, e.recheckDate && `recheck ${fmtDay(e.recheckDate)}`].filter(Boolean).join(' · ');
    default: return e.notes || '';
  }
}

function timelineItems(a) {
  const z = tz();
  const items = eventsOf(D(), a.id).map((e) => ({ at: e.at, key: dayKey(e.at, z), label: KIND_LABEL[e.kind] || e.kind, text: describe(e), notes: e.notes, id: e.id, kind: e.kind }));
  for (const x of D().exposures) {
    if (!(isBull(a) ? x.bullId === a.id : (x.animalIds || []).includes(a.id))) continue;
    items.push({ at: x.start, key: x.start, label: 'Bull exposure', text: `${fmtDay(x.start)} – ${x.end ? fmtDay(x.end) : 'ongoing'} · ${sireLabel(D(), x) || 'bull not recorded'}${x.group ? ` · ${x.group}` : ''}${isBull(a) ? ` · ${x.animalIds.length} animals` : ''}`, exposureId: x.id });
  }
  for (const m of D().milk.filter((x) => x.animalId === a.id)) {
    items.push({ at: m.date, key: m.date, label: m.kind === 'cow' ? 'Milk yield' : `Milk ${m.use}`, text: `${m.litres} L${m.session ? ` · ${m.session}` : ''}`, milkId: m.id });
  }
  return items.sort((x, y) => (x.at < y.at ? 1 : -1));
}

export function animalView(id) {
  const a = db.get('animals', id);
  if (!a) return { html: html`<p class="empty">Animal not found.</p><a href="#/herd" class="btn">Herd list</a>` };
  const w = withdrawals(D(), a.id);
  const overlapIds = overlappingTreatments(D(), a.id);
  const female = isFemale(a);
  const active = isActive(a);
  const dam = a.damId && db.get('animals', a.damId);
  const offspring = D().animals.filter((x) => x.damId === a.id || x.sireId === a.id);
  const attempts = female ? breedingAttempts(D(), a.id, tz()) : [];
  const bse = isBull(a) ? eventsOf(D(), a.id, ['bse']) : [];
  const timeline = timelineItems(a);
  const missing = w.milk.treatments.find((t) => !treatmentMilkEnd(t));

  return {
    html: html`
    <a href="#/" class="back" data-act="back">← Back</a>
    <header class="animal-head">
      <p class="type">${TYPES[a.type] || ''}${a.breed ? ` · ${a.breed}` : ''}${a.group ? ` · ${a.group}` : ''}</p>
      <h1 class="code-xl" data-testid="animal-code">${animalLabel(a)}</h1>
      <p class="tagline">${a.tag && a.tag !== a.code ? `Ear tag ${a.tag}` : ''}${a.name ? ` · ${a.name}` : ''}
        ${!active ? html` <span class="badge muted">${STATUS[a.status]} ${a.statusDate ? fmtDay(a.statusDate) : ''}</span>` : ''}
        ${a.sample ? html` <span class="badge sample">Sample</span>` : ''}</p>
    </header>

    ${w.milk.active ? html`<div class="hold big" role="alert" data-testid="profile-hold"><strong class="hold-title">WITHHOLD MILK</strong>
      <span>${holdText(w.milk)}</span>
      ${w.milk.overlapping ? html`<span>${w.milk.treatments.length} overlapping treatments: ${w.milk.treatments.map((t) => t.product).join(', ')}</span>` : html`<span>${w.milk.treatments[0].product}</span>`}
      ${missing ? html`<button type="button" class="btn" data-act="editEvent" data-id="${missing.id}">Add withdrawal end time</button>` : ''}</div>` : ''}
    ${w.meat.active ? html`<div class="hold meat" role="status"><strong>Meat withdrawal</strong> ${holdText(w.meat)}</div>` : ''}

    ${female ? breedingCard(a) : ''}
    ${female && active ? html`<button type="button" class="btn primary huge" data-act="insem" data-testid="record-insemination">Record insemination</button>` : ''}

    ${active ? html`<div class="grid-actions">
      ${female ? html`<button type="button" class="btn" data-act="heat">Heat seen</button>
        <button type="button" class="btn" data-act="preg">Pregnancy check</button>` : ''}
      ${isBull(a) ? html`<button type="button" class="btn" data-act="bse">Soundness exam</button>
        <button type="button" class="btn" data-act="exposure">Put with group</button>` : ''}
      <button type="button" class="btn" data-act="treat">Treatment</button>
      <button type="button" class="btn" data-act="health">Health problem</button>
    </div>
    <details class="more-actions"><summary>More records</summary><div class="grid-actions">
      ${female ? html`<button type="button" class="btn" data-act="natural">Natural service seen</button>
        <button type="button" class="btn" data-act="exposure">Bull with her group</button>
        <button type="button" class="btn" data-act="reminder">Check reminder</button>
        <button type="button" class="btn" data-act="dryoff">Dry off</button>
        <button type="button" class="btn" data-act="calving">Calving</button>
        <button type="button" class="btn" data-act="loss">Pregnancy loss</button>` : ''}
      <button type="button" class="btn" data-act="vacc">Vaccination</button>
      <button type="button" class="btn" data-act="move">Moved off / died</button>
      <button type="button" class="btn" data-act="edit">Edit details</button>
    </div></details>` : html`<div class="grid-actions"><button type="button" class="btn" data-act="move">Moved back on</button><button type="button" class="btn" data-act="edit">Edit details</button></div>`}

    ${female && attempts.length ? html`<section class="card"><h2 class="h2">Breeding attempts (${attempts.length})</h2>
      <ol class="attempts" data-testid="attempts">${attempts.slice().reverse().map((t) => html`<li>
        <button type="button" class="link-row" data-act="${t.kind === 'exposure' ? 'editExposure' : 'editEvent'}" data-id="${t.id}">
        <strong>${t.kind === 'ai' ? 'AI' : t.kind === 'natural' ? 'Natural service' : 'Bull exposure'}</strong>
        ${t.exact ? fmtDateTime(t.at, tz()) : `${fmtDay(t.start)} – ${t.end ? fmtDay(t.end) : 'ongoing'}`}${t.sire ? ` · ${t.sire}` : ''}</button></li>`)}</ol></section>` : ''}

    ${isBull(a) ? html`<section class="card"><h2 class="h2">Soundness exams</h2>${bse.length ? html`<ul class="plain">${bse.slice().reverse().map((e) => html`<li><button type="button" class="link-row" data-act="editEvent" data-id="${e.id}">${fmtDay(dayKey(e.at, tz()))} · ${describe(e)}</button></li>`)}</ul>` : empty('No exams recorded.')}</section>` : ''}

    ${(dam || offspring.length || a.sireText) ? html`<section class="card"><h2 class="h2">Family</h2>
      ${dam ? html`<p>Dam: <a href="#/animal/${dam.id}">${animalLabel(dam)}</a></p>` : ''}
      ${a.sireText || a.sireId ? html`<p>Sire: ${a.sireId && db.get('animals', a.sireId) ? html`<a href="#/animal/${a.sireId}">${animalLabel(db.get('animals', a.sireId))}</a>` : a.sireText}</p>` : ''}
      ${a.birthDate ? html`<p>Born ${fmtDay(a.birthDate)}${a.birthWeight ? ` · ${a.birthWeight} kg` : ''}</p>` : ''}
      ${offspring.length ? html`<h3 class="h3">Calves</h3>${offspring.map((c) => animalRow(c))}` : ''}</section>` : ''}

    <section class="card"><h2 class="h2">History</h2>
      ${timeline.length ? html`<ol class="timeline" data-testid="timeline">${timeline.map((t) => html`<li class="${t.kind === 'treatment' && overlapIds.has(t.id) ? 'overlap' : ''}">
        <button type="button" class="link-row" ${t.id ? html`data-act="editEvent" data-id="${t.id}"` : t.exposureId ? html`data-act="editExposure" data-id="${t.exposureId}"` : html`data-act="editMilk" data-id="${t.milkId}"`}>
          <span class="tl-date">${t.id ? fmtDateTime(t.at, tz()) : fmtDay(t.key)}</span>
          <span class="tl-label">${t.label}${t.kind === 'treatment' && overlapIds.has(t.id) ? html` <span class="badge warn">overlaps</span>` : ''}</span>
          <span class="tl-text">${t.text}</span>${t.notes ? html`<span class="tl-notes">${t.notes}</span>` : ''}
        </button></li>`)}</ol>
        <p class="muted small">Tap a record to correct or delete it.</p>` : empty('Nothing recorded yet.')}
    </section>`,
    actions: {
      back: (d, e) => { if (history.length > 1) { e.preventDefault(); history.back(); } },
      insem: () => A.recordInsemination(a), heat: () => A.recordHeat(a), preg: () => A.recordPregCheck(a),
      natural: () => A.recordNatural(a), reminder: () => A.setCheckReminder(a), dryoff: () => A.recordDryOff(a),
      calving: () => A.recordCalving(a), loss: () => A.recordLoss(a), treat: () => A.recordTreatment(a),
      health: () => A.recordHealth(a), vacc: () => A.recordVaccination(a), move: () => A.recordMovement(a),
      edit: () => A.editAnimal(a), bse: () => A.recordBSE(a),
      exposure: () => A.recordExposure(null, isBull(a) ? { bullId: a.id } : {
        group: a.group,
        animalIds: a.group ? D().animals.filter((x) => isActive(x) && isFemale(x) && x.group === a.group).map((x) => x.id) : [a.id],
      }),
      editEvent: (d) => A.editEvent(db.get('events', d.id)),
      editExposure: (d) => A.recordExposure(db.get('exposures', d.id)),
      editMilk: async (d) => (await import('./milk.js')).milkForm(db.get('milk', d.id)),
    },
  };
}
