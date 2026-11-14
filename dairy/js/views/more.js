import { html, download, toast, openForm } from '../ui.js';
import { D, S, tz, saveSettings, periodRange } from '../store.js';
import * as db from '../db.js';
import {
  animalLabel, isActive, isBull, milkHolds, eventsOf, sireLabel, toCSV, TYPES, STATUS, MILK_SOURCES, milkDay,
  collectionValue, treatmentMilkEnd, treatmentMeatEnd, breedingStatus, isFemale,
} from '../logic.js';
import { fmtDay, fmtDateTime, dayKey, timeZones, todayKey, inText, diffDays } from '../time.js';
import { holdText, animalRow, empty, L, money, periodChips } from '../components.js';
import { editAnimal, editTask, completeTask, recordExposure, editEvent } from '../actions.js';
import { describe, KIND_LABEL } from './animal.js';
import { addSampleData, removeSampleData } from '../sample.js';
import { t as tr, lang, setLang } from '../i18n.js';
import { createFirstOwner, currentUser, isAdmin, lock, users } from '../auth.js';

export const LANGS = [['en', 'English'], ['pl', 'Polski']];

export async function changeLang(l) {
  setLang(l);
  await saveSettings({ language: l });
}

function langSwitch() {
  return html`<div class="lang" role="group" aria-label="Język / Language">${LANGS.map(([k, l]) => html`<button type="button" class="chip ${lang() === k ? 'on' : ''}" data-act="lang" data-v="${k}" aria-pressed="${lang() === k}">${l}</button>`)}</div>`;
}

export function moreView() {
  const links = [
    ['#/health', 'Health & treatments', 'Milk holds, mastitis, lameness, vaccinations'],
    ['#/bulls', 'Bulls', 'Profiles, groups, soundness exams'],
    ['#/tasks', 'Vet visits & reminders', 'Upcoming and done'],
    ['#/reports', 'Reports & CSV export', 'Spreadsheets for your records'],
    ...(isAdmin() ? [
      ['#/data', 'Backup & restore', 'Save everything to a file, sample data'],
      ['#/settings', 'Farm settings', 'Time zone, currency, vet schedule'],
    ] : []),
    ['#/users', isAdmin() ? 'Users & login' : 'My PIN', isAdmin() ? 'Who can open the app, auto-lock' : 'Change my PIN'],
    ['#/help', 'Help & install', 'Starting, installing, backing up'],
  ];
  return {
    html: html`<header class="top"><h1>${tr('More')}</h1></header>
    <div class="card user-card"><span>${tr('Logged in as {n}', { n: currentUser()?.name || '' })}</span><button type="button" class="btn" data-act="lock" data-testid="lock">${tr('Lock now')}</button></div>
    <p class="h3">Język / Language</p>${langSwitch()}
    <nav class="menu">${links.map(([h, a, b]) => html`<a class="menu-item" href="${h}"><strong>${tr(a)}</strong><span>${tr(b)}</span></a>`)}</nav>
    <p class="muted small center">${tr('Dairy Herd · all records are stored on this device')}</p>`,
    actions: { lang: (d) => changeLang(d.v), lock: () => lock() },
  };
}

export function healthView() {
  const holds = milkHolds(D());
  const recent = D().events.filter((e) => ['health', 'treatment', 'vaccination'].includes(e.kind)).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);
  return {
    html: html`<header class="top"><h1>${tr('Health')}</h1></header>
    <section class="card"><h2 class="h2">${tr('Milk holds')} (${holds.length})</h2>
      ${holds.length ? holds.map(({ animal: a, hold }) => html`<a class="item danger" href="#/animal/${a.id}"><span class="item-k">${tr('WITHHOLD MILK')}</span><span class="item-code">${animalLabel(a)}</span>
        <span>${holdText(hold)} · ${hold.treatments.map((x) => x.product).join(' + ')}</span></a>`) : empty('No milk holds.')}</section>
    <p class="muted">${tr('To record a problem or treatment, find the animal and use the buttons on her page.')}</p>
    <a href="#/" class="btn">${tr('Find animal')}</a>
    <h2 class="h2">${tr('Recent health records')}</h2>
    ${recent.length ? recent.map((e) => {
      const a = db.get('animals', e.animalId);
      return html`<button type="button" class="card link-card" data-act="edit" data-id="${e.id}"><strong>${animalLabel(a)}</strong> · ${fmtDateTime(e.at, tz())}<br>
        ${tr(KIND_LABEL[e.kind])}: ${describe(e)}</button>`;
    }) : empty('Nothing recorded yet.')}`,
    actions: { edit: (d) => editEvent(db.get('events', d.id)) },
  };
}

export function bullsView() {
  const list = D().animals.filter(isBull).sort((a, b) => Number(!isActive(a)) - Number(!isActive(b)));
  const today = todayKey(tz());
  return {
    html: html`<header class="top"><h1>${tr('Bulls')}</h1><button type="button" class="btn primary" data-act="add">+ ${tr('Add bull')}</button></header>
    ${list.length ? list.map((b) => {
      const exams = eventsOf(D(), b.id, ['bse']);
      const last = exams[exams.length - 1];
      const exp = D().exposures.filter((x) => x.bullId === b.id && !x.end);
      return animalRow(b, html`${last ? tr('Last exam {d}: {r}', { d: fmtDay(dayKey(last.at, tz())), r: describe(last).split(' · ')[0] }) : tr('No soundness exam')}${last?.recheckDate ? ` · ${tr('recheck {d}', { d: inText(diffDays(today, last.recheckDate)) })}` : ''}${exp.length ? ` · ${tr('with {g}', { g: exp.map((x) => x.group || x.animalIds.length).join(', ') })}` : ''}`);
    }) : empty('No bulls recorded.')}
    <button type="button" class="btn" data-act="exposure">${tr('Record bull with a group')}</button>`,
    actions: { add: () => editAnimal(null, { type: 'bull' }), exposure: () => recordExposure() },
  };
}

export function tasksView() {
  const tasks = D().tasks.slice().sort((a, b) => a.date.localeCompare(b.date));
  const open = tasks.filter((x) => !x.done); const done = tasks.filter((x) => x.done).reverse().slice(0, 30);
  const today = todayKey(tz());
  const row = (x) => html`<div class="item ${!x.done && x.date < today ? 'warn' : ''}"><span class="item-k">${tr(x.kind === 'vet' ? 'Vet visit' : x.kind === 'pregcheck' ? 'Pregnancy check' : 'Reminder')}</span>
    <span class="item-code">${x.title}</span><span>${fmtDay(x.date)}${x.done ? ` · ${tr('done')}` : ` (${inText(diffDays(today, x.date))})`}</span>
    ${!x.done ? html`<span class="item-actions"><button type="button" class="btn small" data-act="done" data-id="${x.id}">${tr('Done')}</button><button type="button" class="btn small ghost" data-act="edit" data-id="${x.id}">${tr('Edit')}</button></span>` : ''}</div>`;
  return {
    html: html`<header class="top"><h1>${tr('Reminders')}</h1><button type="button" class="btn primary" data-act="add">+ ${tr('Add')}</button></header>
      <div class="list">${open.length ? open.map(row) : empty('No open reminders.')}</div>
      ${done.length ? html`<h2 class="h2">${tr('Done')}</h2><div class="list">${done.map(row)}</div>` : ''}`,
    actions: { add: () => editTask(), done: (d) => completeTask(db.get('tasks', d.id)), edit: (d) => editTask(db.get('tasks', d.id)) },
  };
}

// ---------- reports / CSV ----------
function csvSets() {
  const z = tz();
  const csv = (rows, cols) => toCSV(rows, cols.map((c) => ({ ...c, label: tr(c.label) })));
  const A = (id) => animalLabel(db.get('animals', id));
  const ev = (kinds) => D().events.filter((e) => kinds.includes(e.kind)).sort((a, b) => (a.at < b.at ? -1 : 1));
  return {
    animals: () => csv(D().animals, [
      { label: 'Farm code', get: 'code' }, { label: 'Ear tag', get: 'tag' }, { label: 'Name', get: 'name' }, { label: 'Type', get: (a) => tr(TYPES[a.type]) },
      { label: 'Sex', get: 'sex' }, { label: 'Breed', get: 'breed' }, { label: 'Group', get: 'group' }, { label: 'Born', get: 'birthDate' },
      { label: 'Dam', get: (a) => (a.damId ? A(a.damId) : '') }, { label: 'Sire', get: (a) => (a.sireId ? A(a.sireId) : a.sireText) },
      { label: 'Status', get: (a) => tr(STATUS[a.status || 'active']) }, { label: 'Status date', get: 'statusDate' },
      { label: 'Breeding status', get: (a) => (isFemale(a) ? breedingStatus(D(), a).state : '') }, { label: 'Sample', get: (a) => (a.sample ? tr('yes') : '') },
    ]),
    breeding: () => csv(ev(['heat', 'ai', 'natural', 'pregcheck', 'dryoff', 'calving', 'loss']), [
      { label: 'Animal', get: (e) => A(e.animalId) }, { label: 'Date', get: (e) => dayKey(e.at, z) }, { label: 'Time', get: (e) => fmtDateTime(e.at, z).slice(-5) },
      { label: 'Record', get: (e) => tr(KIND_LABEL[e.kind]) }, { label: 'Sire', get: (e) => sireLabel(D(), e) }, { label: 'Semen batch', get: 'semenBatch' },
      { label: 'Technician / examiner', get: (e) => e.technician || e.examiner }, { label: 'Result', get: 'result' }, { label: 'Method', get: 'method' },
      { label: 'Details', get: (e) => describe(e) }, { label: 'Notes', get: 'notes' },
    ]),
    exposures: () => csv(D().exposures, [
      { label: 'Bull', get: (x) => sireLabel(D(), x) }, { label: 'Group', get: 'group' }, { label: 'In', get: 'start' }, { label: 'Out', get: 'end' },
      { label: 'Animals', get: (x) => (x.animalIds || []).map(A).join(' ') },
    ]),
    treatments: () => csv(ev(['treatment', 'vaccination', 'health']), [
      { label: 'Animal', get: (e) => A(e.animalId) }, { label: 'Record', get: (e) => tr(KIND_LABEL[e.kind]) }, { label: 'Start', get: (e) => fmtDateTime(e.at, z) },
      { label: 'Last dose', get: (e) => (e.lastAt ? fmtDateTime(e.lastAt, z) : '') }, { label: 'Product', get: 'product' }, { label: 'Dose', get: 'dose' },
      { label: 'Batch', get: 'batch' }, { label: 'Given by', get: 'by' }, { label: 'Reason / problem', get: (e) => e.reason || e.condition },
      { label: 'Milk withdrawal end', get: (e) => (e.kind !== 'treatment' ? '' : e.milkRequired ? (treatmentMilkEnd(e) ? fmtDateTime(treatmentMilkEnd(e), z) : tr('MISSING')) : tr('n/a')) },
      { label: 'Meat withdrawal end', get: (e) => (e.kind !== 'treatment' ? '' : e.meatRequired ? (treatmentMeatEnd(e) ? fmtDateTime(treatmentMeatEnd(e), z) : tr('MISSING')) : tr('n/a')) },
      { label: 'Notes', get: 'notes' },
    ]),
    movements: () => csv(ev(['movement']), [
      { label: 'Animal', get: (e) => A(e.animalId) }, { label: 'Date', get: (e) => dayKey(e.at, z) }, { label: 'Direction', get: 'direction' },
      { label: 'Reason', get: (e) => e.reasonOff || e.reasonOn }, { label: 'Party', get: 'party' }, { label: 'Reference', get: 'reference' },
    ]),
    'milk-daily': () => {
      const days = [...new Set(D().milk.map((m) => m.date))].sort();
      return csv(days.map((d) => milkDay(D(), d)), [
        { label: 'Date', get: 'date' }, { label: 'Official litres', get: 'official' }, { label: 'Official source', get: (m) => tr(MILK_SOURCES[m.source]) },
        { label: 'Session total', get: (m) => m.bySource.sessions }, { label: 'Daily total entered', get: (m) => m.bySource.daily }, { label: 'Cow yields', get: (m) => m.bySource.cows },
        { label: 'Withheld', get: (m) => m.kept.withheld }, { label: 'Discarded', get: (m) => m.kept.discarded }, { label: 'On-farm use', get: (m) => m.kept.onfarm },
      ]);
    },
    'milk-entries': () => csv(D().milk.slice().sort((a, b) => a.date.localeCompare(b.date)), [
      { label: 'Date', get: 'date' }, { label: 'Kind', get: 'kind' }, { label: 'Session', get: 'session' }, { label: 'Cow', get: (m) => (m.animalId ? A(m.animalId) : '') },
      { label: 'Use', get: 'use' }, { label: 'Litres', get: 'litres' }, { label: 'Notes', get: 'notes' },
    ]),
    collections: () => csv(D().collections.slice().sort((a, b) => a.date.localeCompare(b.date)), [
      { label: 'Date', get: 'date' }, { label: 'Buyer', get: (c) => db.get('buyers', c.buyerId)?.name }, { label: 'Litres accepted', get: 'litresAccepted' },
      { label: 'Litres rejected', get: 'litresRejected' }, { label: 'Reference', get: 'reference' }, { label: 'Price per litre', get: 'pricePerLitre' },
      { label: 'Expected value', get: (c) => collectionValue(c)?.toFixed(2) },
    ]),
    statements: () => csv(D().statements, [
      { label: 'Buyer', get: (s) => db.get('buyers', s.buyerId)?.name }, { label: 'From', get: 'from' }, { label: 'To', get: 'to' },
      { label: 'Bonuses', get: 'bonuses' }, { label: 'Deductions', get: 'deductions' }, { label: 'Statement amount', get: 'statementAmount' },
      { label: 'Payment date', get: 'paymentDate' }, { label: 'Amount received', get: 'paidAmount' }, { label: 'Reference', get: 'reference' },
    ]),
    quality: () => csv(D().quality, [
      { label: 'Date', get: 'date' }, { label: 'Sample', get: 'sampleType' }, { label: 'Tank temp C', get: 'tankTemp' }, { label: 'Butterfat %', get: 'butterfat' },
      { label: 'Protein %', get: 'protein' }, { label: 'SCC k/ml', get: 'scc' }, { label: 'Bacteria k cfu/ml', get: 'bacteria' },
    ]),
  };
}

export function reportsView() {
  const sets = csvSets();
  const labels = {
    animals: 'Animals (incl. archive)', breeding: 'Breeding & calving records', exposures: 'Bull exposures', treatments: 'Health, treatments & vaccinations',
    movements: 'Movements on / off', 'milk-daily': 'Milk per day (official totals)', 'milk-entries': 'Milk entries', collections: 'Collections (sales)',
    statements: 'Statements & payments', quality: 'Milk quality',
  };
  const r = periodRange();
  const days = [...new Set(D().milk.filter((m) => m.date >= r.from && m.date <= r.to).map((m) => m.date))].sort();
  return {
    html: html`<header class="top"><h1>${tr('Reports')}</h1></header>
    <h2 class="h2">${tr('Download CSV')}</h2><p class="muted small">${tr('Opens in Excel, Numbers or Google Sheets. All dates are farm dates ({tz}).', { tz: tz() })}</p>
    <div class="grid-actions">${Object.keys(sets).map((k) => html`<button type="button" class="btn" data-act="csv" data-k="${k}">${tr(labels[k])}</button>`)}</div>
    <h2 class="h2">${tr('Milk by day')}</h2>${periodChips()}
    ${days.length ? html`<table class="table"><thead><tr><th>${tr('Date')}</th><th>${tr('Produced')}</th><th>${tr('Source')}</th><th>${tr('Kept out')}</th></tr></thead><tbody>
      ${days.map((d) => { const md = milkDay(D(), d); return html`<tr><td>${fmtDay(d)}</td><td>${L(md.official)}</td><td>${tr(MILK_SOURCES[md.source])}</td><td>${L(md.kept.withheld + md.kept.discarded + md.kept.onfarm)}</td></tr>`; })}
    </tbody></table>` : empty('No milk in this period.')}`,
    actions: {
      csv: (d) => { download(`dairy-herd-${d.k}-${todayKey(tz())}.csv`, '\uFEFF' + sets[d.k]()); toast(tr('CSV downloaded')); },
    },
  };
}

// ---------- settings ----------
export function settingsView() {
  const s = S();
  return {
    html: html`<header class="top"><h1>${tr('Settings')}</h1></header><button type="button" class="btn" data-act="open">${tr('Edit settings')}</button>
    <dl class="kv"><dt>${tr('Language')}</dt><dd>${LANGS.find(([k]) => k === lang())[1]}</dd><dt>${tr('Farm')}</dt><dd>${s.farmName || '—'}</dd><dt>${tr('Time zone')}</dt><dd>${s.timeZone}</dd><dt>${tr('Currency')}</dt><dd>${s.currency}</dd>
    <dt>${tr('Gestation')}</dt><dd>${tr('{n} days', { n: s.gestationDays })}</dd><dt>${tr('Dry off')}</dt><dd>${tr('{n} days before calving', { n: s.dryOffDays })}</dd>
    <dt>${tr('First pregnancy check')}</dt><dd>${tr('{n} days after service', { n: s.firstCheckDays })}</dd><dt>${tr('Recheck inconclusive')}</dt><dd>${tr('after {n} days', { n: s.recheckDays })}</dd>
    <dt>${tr('Default milk total')}</dt><dd>${tr(MILK_SOURCES[s.defaultMilkSource])}</dd></dl>`,
    actions: { open: () => openSettingsForm() },
  };
}

const CURRENCIES = ['PLN', 'EUR', 'GBP', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'CZK', 'HUF', 'RON', 'ZAR', 'INR', 'KES', 'BRL', 'ARS', 'UYU'];

export function openSettingsForm(first = false, keep = {}, onDone = null) {
  const s = S();
  const zones = timeZones();
  if (!zones.includes(s.timeZone)) zones.unshift(s.timeZone);
  openForm({
    title: first ? 'Welcome to Dairy Herd' : 'Farm settings', tz: s.timeZone, recordId: 'farm',
    header: first ? html`<p class="lead">${tr('Set up your farm. You can change these later in More → Farm settings.')}</p>` : '',
    values: { ...s, language: lang(), sample: first ? true : undefined, ...keep },
    submitLabel: first ? 'Start' : 'Save settings',
    fields: [
      { name: 'language', label: 'Język / Language', type: 'choice', options: LANGS },
      { name: 'farmName', label: 'Farm name' },
      ...(first ? [
        { type: 'heading', label: 'Your login' },
        { type: 'info', html: html`<p class="help">${tr('Only people with a login can open Dairy Herd on this phone. You are the admin: you can add workers later.')}</p>` },
        { name: 'ownerName', label: 'Your name', required: true },
        { name: 'pin', label: 'PIN or password (at least 4)', type: 'password', required: true },
        { name: 'pin2', label: 'Repeat PIN or password', type: 'password', required: true },
        { type: 'heading', label: 'Farm' },
      ] : []),
      { name: 'timeZone', label: 'Farm time zone', type: 'select', options: zones.map((z) => [z, z]), help: 'Days since insemination and all dates follow this clock.' },
      { name: 'currency', label: 'Currency', type: 'select', options: (CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES]).map((c) => [c, c]) },
      ...(first ? [{ name: 'sample', label: 'Load sample data to try the app (clearly marked, removable)', type: 'checkbox' }] : []),
      { type: 'heading', label: "Vet's schedule & planning intervals", detail: true },
      { name: 'firstCheckDays', label: 'First pregnancy check (days after service)', type: 'number', min: 1, detail: true },
      { name: 'recheckDays', label: 'Recheck an inconclusive result after (days)', type: 'number', min: 1, detail: true },
      { name: 'gestationDays', label: 'Gestation length (days)', type: 'number', min: 200, detail: true },
      { name: 'dryOffDays', label: 'Dry off before calving (days)', type: 'number', min: 0, detail: true },
      { name: 'calvingSoonDays', label: 'Show calvings due within (days)', type: 'number', min: 1, detail: true },
      { name: 'dryOffSoonDays', label: 'Show dry-offs due within (days)', type: 'number', min: 1, detail: true },
      { name: 'upcomingDays', label: 'Show checks and vet visits due within (days)', type: 'number', min: 1, detail: true },
      { name: 'defaultMilkSource', label: 'Official daily milk total normally comes from', type: 'select', detail: true, options: Object.entries(MILK_SOURCES) },
    ],
    onMount(el, form) {
      // Switching language redraws the form at once in that language.
      for (const r of form.querySelectorAll('[name=language]')) {
        r.addEventListener('change', () => {
          const keepVals = {
            farmName: form.querySelector('[name=farmName]').value, timeZone: form.querySelector('[name=timeZone]').value,
            currency: form.querySelector('[name=currency]').value, sample: form.querySelector('[name=sample]')?.checked,
          };
          keepVals.ownerName = form.querySelector('[name=ownerName]')?.value;
          setLang(r.value);
          window.dispatchEvent(new Event('rerender'));
          openSettingsForm(first, keepVals, onDone);
        });
      }
    },
    async onSubmit(v) {
      if (first) await createFirstOwner(v.ownerName, v.pin, v.pin2);
      const clean = { ...v };
      for (const k of ['sample', 'ownerName', 'pin', 'pin2']) delete clean[k];
      for (const k of ['firstCheckDays', 'recheckDays', 'gestationDays', 'dryOffDays', 'calvingSoonDays', 'dryOffSoonDays', 'upcomingDays']) {
        if (clean[k] == null || Number.isNaN(clean[k])) delete clean[k]; else clean[k] = Math.round(clean[k]);
      }
      if (clean.language) setLang(clean.language);
      await saveSettings({ ...clean, setupDone: true });
      if (first && v.sample) await addSampleData();
      if (first && onDone) setTimeout(onDone, 0);
      return first ? (v.sample ? tr('Sample data loaded — try searching for 0042') : tr('Ready. Add your first animal.')) : tr('Settings saved');
    },
  });
}

// ---------- data: backup / restore / sample ----------
const STORE_LABEL = {
  animals: 'Animals', events: 'Records', exposures: 'Bull exposures', tasks: 'Reminders', milk: 'Milk entries', milkDays: 'Milk days',
  buyers: 'Buyers', collections: 'Collections', statements: 'Statements', quality: 'Quality readings',
};

export function dataView() {
  const last = db.get('meta', 'lastBackup')?.at;
  const sampleCount = D().animals.filter((a) => a.sample).length;
  const counts = db.STORES.filter((s) => !['settings', 'meta'].includes(s)).map((s) => [s, db.count(s)]);
  return {
    html: html`<header class="top"><h1>${tr('Backup & restore')}</h1></header>
    <section class="card"><h2 class="h2">${tr('Backup')}</h2>
      <p>${tr('Saves every record and setting to one file. Keep it somewhere safe off this phone (email it to yourself, cloud drive, computer).')}</p>
      <p class="muted">${tr('Last backup: {d}', { d: last ? fmtDateTime(last, tz()) : tr('never') })}</p>
      <button type="button" class="btn primary big" data-act="backup">${tr('Download full backup')}</button></section>
    <section class="card"><h2 class="h2">${tr('Restore')}</h2>
      <p>${tr('Replaces everything on this device with a backup file.')}</p>
      <label class="btn file-btn">${tr('Choose backup file…')}<input type="file" accept=".json,application/json" data-restore hidden></label></section>
    <section class="card"><h2 class="h2">${tr('Sample data')}</h2>
      ${sampleCount ? html`<p>${tr('{n} sample animals and their records are loaded. They are marked “Sample”.', { n: sampleCount })}</p>
        <button type="button" class="btn danger" data-act="removeSample">${tr('Remove sample data')}</button>`
        : html`<p>${tr('No sample data loaded.')}</p><button type="button" class="btn" data-act="addSample">${tr('Load sample data')}</button>`}</section>
    <section class="card"><h2 class="h2">${tr('On this device')}</h2><dl class="kv">${counts.map(([k, n]) => html`<dt>${tr(STORE_LABEL[k])}</dt><dd>${n}</dd>`)}</dl>
      <p class="muted small" data-persist></p></section>`,
    actions: {
      async backup() {
        const data = { app: 'dairy-herd', version: 1, exportedAt: new Date().toISOString(), data: db.dump() };
        download(`dairy-herd-backup-${todayKey(tz())}.json`, JSON.stringify(data, null, 1), 'application/json');
        await db.put('meta', { id: 'lastBackup', at: new Date().toISOString() });
        toast(tr('Backup downloaded'));
      },
      async removeSample() {
        if (!confirm(tr('Remove all sample animals and everything recorded on them, plus sample milk and sales records?'))) return;
        const n = await removeSampleData();
        toast(tr('Removed {n} sample records', { n }));
      },
      async addSample() { await addSampleData(); toast(tr('Sample data loaded')); },
    },
    mount(el) {
      el.querySelector('[data-restore]').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          if (parsed.app !== 'dairy-herd' || !parsed.data) throw new Error(tr('This is not a Dairy Herd backup file.'));
          const n = Object.values(parsed.data).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
          if (!confirm(tr('Restore backup from {d} with {n} records? Everything currently on this device will be replaced.', { d: fmtDateTime(parsed.exportedAt, tz()), n }))) return;
          for (const s of db.STORES) if (parsed.data[s] && !Array.isArray(parsed.data[s])) throw new Error(tr('Backup is damaged ({s}).', { s }));
          await db.replaceAll(parsed.data);
          const l = db.get('settings', 'farm')?.language;
          if (l) setLang(l);
          toast(tr('Backup restored'));
          if (!users().some((u) => u.id === currentUser()?.id)) lock();
        } catch (err) { toast(err.message || tr('Could not read the file'), { kind: 'err' }); }
        e.target.value = '';
      });
      const p = el.querySelector('[data-persist]');
      navigator.storage?.persisted?.().then((ok) => { p.textContent = ok ? tr('Storage is protected from automatic clearing.') : tr('Tip: install the app to protect its storage from being cleared.'); });
    },
  };
}

export function helpView() {
  if (lang() === 'pl') {
    return { html: html`<header class="top"><h1>Pomoc</h1></header>
  <section class="card prose"><h2 class="h2">Instalacja na telefonie</h2>
    <p><strong>Android (Chrome):</strong> otwórz aplikację, stuknij menu ⋮ → <em>Zainstaluj aplikację</em> (lub <em>Dodaj do ekranu głównego</em>).</p>
    <p><strong>iPhone (Safari):</strong> stuknij Udostępnij → <em>Do ekranu początkowego</em>.</p>
    <p>Otwórz ją raz przy zasięgu. Potem działa bez zasięgu: każdy wpis zapisuje się od razu w telefonie.</p></section>
  <section class="card prose"><h2 class="h2">Szybka inseminacja</h2>
    <ol><li>Na ekranie Dziś wpisz numer krowy (np. <strong>0042</strong> albo samo 42) lub numer kolczyka.</li><li>Stuknij krowę.</li><li>Stuknij <strong>Zapisz inseminację</strong> → <strong>Zapisz</strong>. Data i godzina to domyślnie „teraz”; stuknij przycisk lub datę, aby wpisać wcześniejszą.</li></ol>
    <p>Buhaj, partia nasienia, inseminator i uwagi są pod <em>Dodaj szczegóły</em>. Stuknij dowolny wpis w historii, aby go poprawić lub usunąć.</p></section>
  <section class="card prose"><h2 class="h2">Wstrzymanie mleka</h2><p>Gdy zapiszesz leczenie z okresem karencji na mleko, czerwony znak <strong>WSTRZYMAJ MLEKO</strong> pojawia się na ekranie Dziś, przy krowie i na ekranie Mleko, aż skończą się wszystkie karencje. Jeśli nie znasz jeszcze końca karencji, znak zostaje, dopóki go nie wpiszesz.</p></section>
  <section class="card prose"><h2 class="h2">Kopia zapasowa</h2><p>Wpisy są tylko w tym telefonie. Co najmniej raz w tygodniu użyj <a href="#/data">Kopia zapasowa i przywracanie</a> i przechowuj plik gdzie indziej. Aby przenieść dane na nowy telefon, przywróć tam ten plik.</p></section>` };
  }
  return { html: html`<header class="top"><h1>Help</h1></header>
  <section class="card prose"><h2 class="h2">Install on your phone</h2>
    <p><strong>Android (Chrome):</strong> open the app, tap the ⋮ menu → <em>Install app</em> (or <em>Add to Home screen</em>).</p>
    <p><strong>iPhone (Safari):</strong> tap Share → <em>Add to Home Screen</em>.</p>
    <p>Open it once with signal. After that it works with no signal: every record is saved on the phone straight away.</p></section>
  <section class="card prose"><h2 class="h2">Quick insemination</h2>
    <ol><li>On Today, type the cow's code (e.g. <strong>0042</strong> or just 42) or ear tag.</li><li>Tap her.</li><li>Tap <strong>Record insemination</strong> → <strong>Save insemination</strong>. Date and time default to now; tap a chip or the date to backdate.</li></ol>
    <p>Sire, straw batch, technician and notes are under <em>Add details</em>. Tap any record in her history to correct or delete it.</p></section>
  <section class="card prose"><h2 class="h2">Milk holds</h2><p>When you record a treatment with a milk withdrawal, a red <strong>WITHHOLD MILK</strong> flag shows on Today, the cow and the Milk screen until every withdrawal has ended. If you don't know the end time yet, the flag stays until you add it.</p></section>
  <section class="card prose"><h2 class="h2">Back up</h2><p>Records live only on this phone. Use <a href="#/data">Backup & restore</a> at least weekly and keep the file somewhere else. To move to a new phone, restore the file there.</p></section>` };
}

export { isActive };
