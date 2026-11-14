import { html } from '../ui.js';
import { D, tz } from '../store.js';
import * as db from '../db.js';
import {
  animalLabel, breedingAttempts, eventsOf, isActive, isFemale, isBull, TYPES, STATUS,
  withdrawals, treatmentMilkEnd, treatmentMeatEnd, overlappingTreatments, sireLabel,
} from '../logic.js';
import { fmtDay, fmtDateTime, dayKey } from '../time.js';
import { breedingCard, holdText, animalRow, empty, treatmentsN } from '../components.js';
import { t, plural } from '../i18n.js';
import * as A from '../actions.js';
import { icon, KIND_ICON } from '../icons.js';
import { thumb, photoOf, photoSheet } from '../photos.js';

export const KIND_LABEL = {
  ai: 'Insemination (AI)', heat: 'Heat seen', natural: 'Natural service', pregcheck: 'Pregnancy check', dryoff: 'Dried off',
  calving: 'Calving', loss: 'Pregnancy loss', health: 'Health', vaccination: 'Vaccination', treatment: 'Treatment',
  movement: 'Movement', bse: 'Breeding soundness exam',
};
const RESULT = { pregnant: 'PREGNANT', open: 'OPEN', inconclusive: 'INCONCLUSIVE' };
const CONDITION = { mastitis: 'Mastitis', lameness: 'Lameness' };
const OUTCOME = { alive: 'alive', stillborn: 'stillborn', died: 'died soon after' };
const ASSIST = { farmer: 'Farmer helped', vet: 'Vet', caesarean: 'Caesarean' };
const REASON = { sold: 'Sold', transferred: 'Transferred', deceased: 'Died / put down', purchased: 'Bought in', returned: 'Returned', other: 'Other' };
const BSE = { satisfactory: 'Satisfactory', unsatisfactory: 'Unsatisfactory', deferred: 'Deferred / recheck' };

export function describe(e) {
  const z = tz();
  switch (e.kind) {
    case 'ai': return [e.sire && t('Sire {s}', { s: e.sire }), e.semenBatch && t('Batch {b}', { b: e.semenBatch }), e.technician && t('by {p}', { p: e.technician })].filter(Boolean).join(' · ');
    case 'natural': return sireLabel(D(), e) || t('Bull not recorded');
    case 'pregcheck': return [t(RESULT[e.result]), t(e.method), e.examiner, e.vetDueDate && t('vet due date {d}', { d: fmtDay(e.vetDueDate) })].filter(Boolean).join(' · ');
    case 'calving': return [plural(e.calfCount, ['calf', 'calves'], ['cielę', 'cielęta', 'cieląt']), e.assistance && e.assistance !== 'none' && t('assisted: {a}', { a: t(ASSIST[e.assistance]) }),
      ...(e.calves || []).map((c, i) => `#${i + 1} ${c.sex === 'F' ? t('heifer') : c.sex === 'M' ? t('bull') : ''} ${t(OUTCOME[c.outcome] || c.outcome)}${c.tag ? ` ${t('tag {tag}', { tag: c.tag })}` : ''}${c.weight ? ` ${c.weight} kg` : ''}${c.colostrumAt ? ` ${t('colostrum {d}', { d: fmtDateTime(c.colostrumAt, z) })}` : ''}`)].filter(Boolean).join(' · ');
    case 'health': return [e.condition === 'other' ? e.description : t(CONDITION[e.condition]), (e.quarters || []).join(' '), e.leg, t(e.severity)].filter(Boolean).join(' · ');
    case 'vaccination': return [e.product, e.dose, e.batch && t('batch {b}', { b: e.batch }), e.by].filter(Boolean).join(' · ');
    case 'treatment': {
      const me = treatmentMilkEnd(e); const te = treatmentMeatEnd(e);
      return [e.product, e.dose, e.batch && t('batch {b}', { b: e.batch }), e.by && t('by {p}', { p: e.by }),
        e.milkRequired ? (me ? t('milk withdrawal to {d}', { d: fmtDateTime(me, z) }) : t('MILK WITHDRAWAL END MISSING')) : t('no milk withdrawal'),
        e.meatRequired && (te ? t('meat to {d}', { d: fmtDateTime(te, z) }) : t('MEAT WITHDRAWAL END MISSING'))].filter(Boolean).join(' · ');
    }
    case 'movement': return [e.direction === 'off' ? `${t('Off')}: ${t(REASON[e.reasonOff])}` : `${t('On')}: ${t(REASON[e.reasonOn] || '')}`, e.party, e.reference].filter(Boolean).join(' · ');
    case 'bse': return [t(BSE[e.result]), e.examiner, e.recheckDate && t('recheck {d}', { d: fmtDay(e.recheckDate) })].filter(Boolean).join(' · ');
    default: return e.notes || '';
  }
}

function timelineItems(a) {
  const z = tz();
  const items = eventsOf(D(), a.id).map((e) => ({ at: e.at, key: dayKey(e.at, z), label: t(KIND_LABEL[e.kind] || e.kind), text: describe(e), notes: e.notes, id: e.id, kind: e.kind, by: e.createdBy }));
  for (const x of D().exposures) {
    if (!(isBull(a) ? x.bullId === a.id : (x.animalIds || []).includes(a.id))) continue;
    items.push({ kind: 'exposure', at: x.start, key: x.start, label: t('Bull exposure'), text: `${fmtDay(x.start)} – ${x.end ? fmtDay(x.end) : t('ongoing')} · ${sireLabel(D(), x) || t('Bull not recorded')}${x.group ? ` · ${x.group}` : ''}${isBull(a) ? ` · ${plural(x.animalIds.length, ['animal', 'animals'], ['zwierzę', 'zwierzęta', 'zwierząt'])}` : ''}`, exposureId: x.id });
  }
  const USE = { withheld: 'Milk withheld', discarded: 'Milk discarded', onfarm: 'Milk on-farm use' };
  for (const m of D().milk.filter((x) => x.animalId === a.id)) {
    items.push({ kind: 'milk', at: m.date, key: m.date, label: t(m.kind === 'cow' ? 'Milk yield' : USE[m.use]), text: `${m.litres} L${m.session ? ` · ${t(m.session)}` : ''}`, milkId: m.id });
  }
  return items.sort((x, y) => (x.at < y.at ? 1 : -1));
}

export function animalView(id) {
  const a = db.get('animals', id);
  if (!a) return { html: html`<p class="empty">${t('Animal not found.')}</p><a href="#/herd" class="btn">${t('Herd list')}</a>` };
  const w = withdrawals(D(), a.id);
  const overlapIds = overlappingTreatments(D(), a.id);
  const female = isFemale(a);
  const active = isActive(a);
  const dam = a.damId && db.get('animals', a.damId);
  const offspring = D().animals.filter((x) => x.damId === a.id || x.sireId === a.id);
  const attempts = female ? breedingAttempts(D(), a.id, tz()) : [];
  const bse = isBull(a) ? eventsOf(D(), a.id, ['bse']) : [];
  const timeline = timelineItems(a);
  const missing = w.milk.treatments.find((x) => !treatmentMilkEnd(x));
  const sire = a.sireId && db.get('animals', a.sireId);

  return {
    html: html`
    <div class="page-bar"><a href="#/" class="back" data-act="back" aria-label="${t('Back')}">${icon('back')}<span>${t('Back')}</span></a>
      ${active ? html`<button type="button" class="icon-btn" data-act="edit" aria-label="${t('Edit details')}">${icon('edit')}</button>` : ''}</div>
    <header class="animal-head">
      <div class="animal-id">
        <button type="button" class="photo-btn" data-act="photo" data-testid="photo-btn" aria-label="${t(photoOf(a.id) ? 'Change photo' : 'Add photo')}">
          ${thumb(a, 'photo-lg')}${photoOf(a.id) ? '' : html`<span class="photo-add">${icon('plus', { size: 16 })}${t('Add photo')}</span>`}</button>
        <div><p class="type">${t(TYPES[a.type] || '')}</p>
        <h1 class="code-xl" data-testid="animal-code">${animalLabel(a)}</h1></div>
      </div>
      <div class="chips-info">
        ${a.tag && a.tag !== a.code ? html`<span class="info-chip">${icon('tag', { size: 16 })}${a.tag}</span>` : ''}
        ${a.group ? html`<span class="info-chip">${icon('herd', { size: 16 })}${a.group}</span>` : ''}
        ${a.breed ? html`<span class="info-chip">${a.breed}</span>` : ''}
        ${a.name ? html`<span class="info-chip">${a.name}</span>` : ''}
        ${!active ? html`<span class="badge muted">${t(STATUS[a.status])} ${a.statusDate ? fmtDay(a.statusDate) : ''}</span>` : ''}
        ${a.sample ? html`<span class="badge sample">${t('Sample')}</span>` : ''}</div>
    </header>

    ${w.milk.active ? html`<div class="hold big" role="alert" data-testid="profile-hold"><strong class="hold-title">${icon('dropOff')}${t('WITHHOLD MILK')}</strong>
      <span>${holdText(w.milk)}</span>
      ${w.milk.overlapping ? html`<span>${t('{n} overlapping treatments: {list}', { n: w.milk.treatments.length, list: w.milk.treatments.map((x) => x.product).join(', ') })}</span>` : html`<span>${w.milk.treatments[0].product}</span>`}
      ${missing ? html`<button type="button" class="btn" data-act="editEvent" data-id="${missing.id}">${t('Add withdrawal end time')}</button>` : ''}</div>` : ''}
    ${w.meat.active ? html`<div class="hold meat" role="status">${icon('alert')}<strong>${t('Meat withdrawal')}</strong> ${holdText(w.meat)}</div>` : ''}

    ${female ? breedingCard(a) : ''}
    ${female && active ? html`<button type="button" class="btn primary huge" data-act="insem" data-testid="record-insemination">${icon('syringe')}${t('Record insemination')}</button>` : ''}

    ${active ? html`<div class="grid-actions">
      ${female ? html`<button type="button" class="btn act" data-act="heat">${icon('flame')}<span>${t('Heat seen')}</span></button><button type="button" class="btn act" data-act="preg" data-testid="act-preg">${icon('pulse')}<span>${t('Pregnancy check')}</span></button>` : ''}
      ${isBull(a) ? html`<button type="button" class="btn act" data-act="bse">${icon('clipboard')}<span>${t('Soundness exam')}</span></button><button type="button" class="btn act" data-act="exposure">${icon('bull')}<span>${t('Put with group')}</span></button>` : ''}
      <button type="button" class="btn act" data-act="treat" data-testid="act-treat">${icon('pill')}<span>${t('Treatment')}</span></button>
      <button type="button" class="btn act" data-act="health" data-testid="act-health">${icon('stethoscope')}<span>${t('Health problem')}</span></button>
    </div>
    <details class="more-actions"><summary>${t('More records')}${icon('chevron', { cls: 'sum-chev' })}</summary><div class="grid-actions">
      ${female ? html`<button type="button" class="btn act" data-act="natural">${icon('heart')}<span>${t('Natural service seen')}</span></button><button type="button" class="btn act" data-act="exposure">${icon('bull')}<span>${t('Bull with her group')}</span></button><button type="button" class="btn act" data-act="reminder">${icon('bell')}<span>${t('Check reminder')}</span></button><button type="button" class="btn act" data-act="dryoff">${icon('pause')}<span>${t('Dry off')}</span></button><button type="button" class="btn act" data-act="calving">${icon('baby')}<span>${t('Calving')}</span></button><button type="button" class="btn act" data-act="loss">${icon('ban')}<span>${t('Pregnancy loss')}</span></button>` : ''}
      <button type="button" class="btn act" data-act="vacc">${icon('syringe')}<span>${t('Vaccination')}</span></button><button type="button" class="btn act" data-act="move">${icon('move')}<span>${t('Moved off / died')}</span></button><button type="button" class="btn act" data-act="edit">${icon('edit')}<span>${t('Edit details')}</span></button>
    </div></details>` : html`<div class="grid-actions"><button type="button" class="btn act" data-act="move">${icon('move')}<span>${t('Moved back on')}</span></button><button type="button" class="btn act" data-act="edit">${icon('edit')}<span>${t('Edit details')}</span></button></div>`}

    ${female && attempts.length ? html`<section class="card"><h2 class="h2">${t('Breeding attempts ({n})', { n: attempts.length })}</h2>
      <ol class="attempts" data-testid="attempts">${attempts.slice().reverse().map((x) => html`<li>
        <button type="button" class="link-row" data-act="${x.kind === 'exposure' ? 'editExposure' : 'editEvent'}" data-id="${x.id}">
        <strong>${t(x.kind === 'ai' ? 'AI' : x.kind === 'natural' ? 'Natural service' : 'Bull exposure')}</strong>
        ${x.exact ? fmtDateTime(x.at, tz()) : `${fmtDay(x.start)} – ${x.end ? fmtDay(x.end) : t('ongoing')}`}${x.sire ? ` · ${x.sire}` : ''}</button></li>`)}</ol></section>` : ''}

    ${isBull(a) ? html`<section class="card"><h2 class="h2">${t('Soundness exams')}</h2>${bse.length ? html`<ul class="plain">${bse.slice().reverse().map((e) => html`<li><button type="button" class="link-row" data-act="editEvent" data-id="${e.id}">${fmtDay(dayKey(e.at, tz()))} · ${describe(e)}</button></li>`)}</ul>` : empty('No exams recorded.')}</section>` : ''}

    ${(dam || offspring.length || a.sireText || a.sireId) ? html`<section class="card"><h2 class="h2">${t('Family')}</h2>
      ${dam ? html`<p>${t('Dam')}: <a href="#/animal/${dam.id}">${animalLabel(dam)}</a></p>` : ''}
      ${a.sireText || a.sireId ? html`<p>${t('Sire')}: ${sire ? html`<a href="#/animal/${a.sireId}">${animalLabel(sire)}</a>` : a.sireText}</p>` : ''}
      ${a.birthDate ? html`<p>${t('Born {d}', { d: fmtDay(a.birthDate) })}${a.birthWeight ? ` · ${a.birthWeight} kg` : ''}</p>` : ''}
      ${offspring.length ? html`<h3 class="h3">${t('Calves')}</h3>${offspring.map((c) => animalRow(c))}` : ''}</section>` : ''}

    <section class="card"><h2 class="h2">${t('History')}</h2>
      ${timeline.length ? html`<ol class="timeline" data-testid="timeline">${timeline.map((x) => html`<li class="tl-${x.kind} ${x.kind === 'treatment' && overlapIds.has(x.id) ? 'overlap' : ''}">
        <span class="tl-dot">${icon(KIND_ICON[x.kind] || 'clipboard', { size: 18 })}</span>
        <button type="button" class="link-row" ${x.id ? html`data-act="editEvent" data-id="${x.id}"` : x.exposureId ? html`data-act="editExposure" data-id="${x.exposureId}"` : html`data-act="editMilk" data-id="${x.milkId}"`}>
          <span class="tl-date">${x.id ? fmtDateTime(x.at, tz()) : fmtDay(x.key)}</span>
          <span class="tl-label">${x.label}${x.kind === 'treatment' && overlapIds.has(x.id) ? html` <span class="badge warn">${t('overlaps')}</span>` : ''}</span>
          <span class="tl-text">${x.text}</span>${x.notes ? html`<span class="tl-notes">${x.notes}</span>` : ''}${x.by ? html`<span class="tl-by">${t('entered by {n}', { n: x.by })}</span>` : ''}
        </button></li>`)}</ol>
        <p class="muted small">${t('Tap a record to correct or delete it.')}</p>` : empty('Nothing recorded yet.')}
    </section>`,
    actions: {
      back: (d, e) => { if (history.length > 1) { e.preventDefault(); history.back(); } },
      insem: () => A.recordInsemination(a), heat: () => A.recordHeat(a), preg: () => A.recordPregCheck(a),
      natural: () => A.recordNatural(a), reminder: () => A.setCheckReminder(a), dryoff: () => A.recordDryOff(a),
      calving: () => A.recordCalving(a), loss: () => A.recordLoss(a), treat: () => A.recordTreatment(a),
      health: () => A.recordHealth(a), vacc: () => A.recordVaccination(a), move: () => A.recordMovement(a),
      edit: () => A.editAnimal(a), bse: () => A.recordBSE(a), photo: () => photoSheet(a),
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
