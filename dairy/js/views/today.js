import { html } from '../ui.js';
import { D, S, tz, ui, periodRange } from '../store.js';
import { searchAnimals, inseminatedIn, awaitingResult, todayItems, milkTotals, animalLabel, withdrawals } from '../logic.js';
import { fmtDay, inText, agoText } from '../time.js';
import { animalRow, holdText, periodChips, L, money, breedingHeadline } from '../components.js';
import { editAnimal, editTask, completeTask, recordExposure } from '../actions.js';
import { milkForm, collectionForm } from './milk.js';
import * as db from '../db.js';

export function searchResults(q) {
  const list = searchAnimals(D().animals, q);
  if (!q.trim()) return '';
  if (!list.length) {
    const archived = searchAnimals(D().animals, q, { includeArchived: true });
    return html`<div class="results"><p class="empty">No active animal matches “${q}”.</p>
      ${archived.map((a) => animalRow(a))}
      <button type="button" class="btn" data-act="addWithCode" data-code="${q.trim()}">Add animal with code ${q.trim()}</button></div>`;
  }
  return html`<div class="results" data-testid="search-results">${list.slice(0, 12).map((a) => animalRow(a, breedingHeadline(a).main))}
    ${list.length > 12 ? html`<p class="muted">${list.length - 12} more — keep typing</p>` : ''}</div>`;
}

function itemHtml(it) {
  const a = it.animal;
  const code = a ? animalLabel(a) : '';
  const go = a ? `#/animal/${a.id}` : null;
  switch (it.type) {
    case 'hold':
      return html`<a class="item danger" href="${go}" data-testid="today-hold"><span class="item-k">WITHHOLD MILK</span>
        <span class="item-code">${code}</span><span>${holdText(it.hold)}${it.hold.overlapping ? ` · ${it.hold.treatments.length} treatments` : ''}</span></a>`;
    case 'checkOverdue':
      return html`<a class="item warn" href="${go}"><span class="item-k">Pregnancy check overdue</span><span class="item-code">${code}</span>
        <span>due ${fmtDay(it.st.checkDue)} (${inText(it.days)})${it.st.inconclusive ? ' · inconclusive last time' : ''}</span></a>`;
    case 'calving':
      return html`<a class="item" href="${go}"><span class="item-k">Calving ${it.days < 0 ? 'overdue' : 'due'}</span><span class="item-code">${code}</span>
        <span>${it.st.calving.from === it.st.calving.to ? fmtDay(it.st.calving.from) : `from ${fmtDay(it.st.calving.from)}`} (${inText(it.days)})</span></a>`;
    case 'dryoff':
      return html`<a class="item" href="${go}"><span class="item-k">Dry off</span><span class="item-code">${code}</span>
        <span>by ${fmtDay(it.st.dryOff.due)} (${inText(it.days)})</span></a>`;
    case 'checkSoon':
      return html`<a class="item" href="${go}"><span class="item-k">Pregnancy check</span><span class="item-code">${code}</span>
        <span>${fmtDay(it.st.checkDue)} (${inText(it.days)})</span></a>`;
    case 'bse':
      return html`<a class="item" href="${go}"><span class="item-k">Bull soundness recheck</span><span class="item-code">${code}</span>
        <span>${fmtDay(it.event.recheckDate)} (${inText(it.days)})</span></a>`;
    case 'task':
      return html`<div class="item ${it.days < 0 ? 'warn' : ''}"><span class="item-k">${it.task.kind === 'vet' ? 'Vet visit' : 'Reminder'}</span>
        <span class="item-code">${it.task.title}</span><span>${fmtDay(it.task.date)} (${inText(it.days)})${a ? ` · ${code}` : ''}</span>
        <span class="item-actions"><button type="button" class="btn small" data-act="taskDone" data-id="${it.task.id}">Done</button>
        <button type="button" class="btn small ghost" data-act="taskEdit" data-id="${it.task.id}">Edit</button></span></div>`;
    default: return '';
  }
}

export function todayView() {
  const s = S();
  const r = periodRange();
  const ins = inseminatedIn(D(), r.from, r.to);
  const attempts = ins.reduce((n, x) => n + x.attempts.length, 0);
  const awaiting = awaitingResult(D());
  const overdue = awaiting.filter((x) => x.st.checkOverdue).length;
  const items = todayItems(D());
  const holds = items.filter((i) => i.type === 'hold');
  const rest = items.filter((i) => i.type !== 'hold');
  const m = milkTotals(D(), r.from, r.to);
  const hasSample = D().animals.some((a) => a.sample) || D().milk.some((x) => x.sample);
  const lastBackup = db.get('meta', 'lastBackup')?.at;
  const backupDays = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup)) / 86400000) : null;
  const recordCount = D().events.length + D().milk.length;

  return {
    html: html`
    <header class="top"><div><h1>Dairy Herd</h1><p class="farm">${s.farmName || 'My farm'}</p></div>
      <span class="net" data-net></span></header>

    <section class="find card" aria-labelledby="find-label">
      <label id="find-label" for="find" class="find-label">Find cow by code</label>
      <div class="search-row">
        <input id="find" type="search" inputmode="${ui.kb}" autocomplete="off" autocapitalize="characters" enterkeyhint="go"
          placeholder="Code or tag" value="${ui.query}" data-testid="find">
        <button type="button" class="btn kb" data-act="kb" aria-label="Switch keyboard">${ui.kb === 'numeric' ? 'ABC' : '123'}</button>
      </div>
      <div id="results">${searchResults(ui.query)}</div>
    </section>

    ${hasSample ? html`<div class="sample-banner">You are looking at <strong>sample data</strong> (marked “Sample”). <a href="#/data">Remove sample data</a></div>` : ''}

    ${holds.length ? html`<section aria-label="Milk holds" class="list">${holds.map(itemHtml)}</section>` : ''}
    ${rest.length ? html`<section aria-labelledby="att" class="list"><h2 id="att" class="h2">Needs attention</h2>${rest.map(itemHtml)}</section>`
      : html`<p class="all-clear">Nothing overdue or due soon.</p>`}

    <section class="counts" aria-label="Breeding counts">
      <a class="count" href="#/breeding/inseminated" data-testid="count-inseminated">
        <span class="count-n">${ins.length}</span><span class="count-l">Cows inseminated</span>
        <span class="count-s">${r.label}${attempts !== ins.length ? ` · ${attempts} inseminations` : ''}</span></a>
      <a class="count" href="#/breeding/awaiting" data-testid="count-awaiting">
        <span class="count-n">${awaiting.length}</span><span class="count-l">Awaiting pregnancy result</span>
        <span class="count-s ${overdue ? 'overdue' : ''}">${overdue ? `${overdue} check${overdue > 1 ? 's' : ''} overdue` : 'none overdue'}</span></a>
    </section>
    ${periodChips()}

    <section class="card" aria-labelledby="milk-h">
      <h2 id="milk-h" class="h2">Milk · ${r.label}</h2>
      <dl class="totals" data-testid="milk-totals">
        <div><dt>Litres produced</dt><dd data-testid="t-produced">${L(m.produced)}</dd></div>
        <div><dt>Litres sold</dt><dd data-testid="t-sold">${L(m.sold)}</dd></div>
        <div><dt>Expected amount</dt><dd data-testid="t-expected">${money(m.expected)}</dd></div>
        <div><dt>Payments received</dt><dd data-testid="t-received">${money(m.received)}</dd></div>
      </dl>
      ${m.keptTotal ? html`<p class="muted small">Kept out of the tank: ${L(m.keptTotal)} (withheld ${L(m.kept.withheld)}, discarded ${L(m.kept.discarded)}, on-farm ${L(m.kept.onfarm)})</p>` : ''}
      ${m.unpriced ? html`<p class="muted small">${m.unpriced} collection(s) without a price are not in the expected amount.</p>` : ''}
      <a href="#/milk" class="link">Milk details →</a>
    </section>

    <section class="quick" aria-label="Quick entry">
      <button type="button" class="btn" data-act="milk">Record milk</button>
      <button type="button" class="btn" data-act="collection">Milk collection</button>
      <button type="button" class="btn" data-act="exposure">Bull with group</button>
      <button type="button" class="btn" data-act="vet">Vet visit / reminder</button>
      <button type="button" class="btn" data-act="add">Add animal</button>
    </section>
    ${recordCount && (backupDays == null || backupDays > 14) ? html`<p class="backup-nag">${backupDays == null ? 'No backup yet.' : `Last backup ${agoText(backupDays)}.`} <a href="#/data">Back up now</a></p>` : ''}
    `,
    actions: {
      kb() { ui.kb = ui.kb === 'numeric' ? 'text' : 'numeric'; const i = document.getElementById('find'); i.inputMode = ui.kb; document.querySelector('[data-act=kb]').textContent = ui.kb === 'numeric' ? 'ABC' : '123'; i.blur(); i.focus(); },
      addWithCode: (d) => editAnimal(null, { code: d.code }),
      taskDone: (d) => completeTask(db.get('tasks', d.id)),
      taskEdit: (d) => editTask(db.get('tasks', d.id)),
      milk: () => milkForm(),
      collection: () => collectionForm(),
      exposure: () => recordExposure(),
      vet: () => editTask(),
      add: () => editAnimal(),
    },
    mount(el) {
      const input = el.querySelector('#find');
      const res = el.querySelector('#results');
      input.addEventListener('input', () => { ui.query = input.value; res.innerHTML = String(searchResults(ui.query)); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const first = res.querySelector('a.row');
          if (first) location.hash = first.getAttribute('href');
        }
      });
    },
  };
}

export { withdrawals };
