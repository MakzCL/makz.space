import { html } from '../ui.js';
import { D, S, ui, periodRange, tz } from '../store.js';
import { searchAnimals, inseminatedIn, awaitingResult, todayItems, milkTotals, animalLabel } from '../logic.js';
import { fmtDay, inText, agoText, fmtLong, todayKey, partsIn } from '../time.js';
import { animalRow, holdText, periodChips, periodLabel, L, money, breedingHeadline, treatmentsN, emptyState } from '../components.js';
import { editAnimal, editTask, completeTask, recordExposure } from '../actions.js';
import { milkForm, collectionForm } from './milk.js';
import { t, plural } from '../i18n.js';
import { currentUser } from '../auth.js';
import { icon } from '../icons.js';
import * as db from '../db.js';
import { syncPill } from './syncview.js';
import { updateBanner } from './updateview.js';

export function searchResults(q) {
  const list = searchAnimals(D().animals, q);
  if (!q.trim()) return '';
  if (!list.length) {
    const archived = searchAnimals(D().animals, q, { includeArchived: true });
    return html`<div class="results"><p class="empty">${t('No active animal matches “{q}”.', { q })}</p>
      ${archived.map((a) => animalRow(a))}
      <button type="button" class="btn" data-act="addWithCode" data-code="${q.trim()}">${icon('plus')}${t('Add animal with code {code}', { code: q.trim() })}</button></div>`;
  }
  return html`<div class="results" data-testid="search-results">${list.slice(0, 12).map((a) => animalRow(a, breedingHeadline(a).main))}
    ${list.length > 12 ? html`<p class="muted">${t('{n} more — keep typing', { n: list.length - 12 })}</p>` : ''}</div>`;
}

function item({ tone = '', ico, k, code, sub, href, testid, extra = '' }) {
  const inner = html`<span class="item-ico">${icon(ico)}</span>
    <span class="item-body"><span class="item-k">${k}</span>${code ? html`<span class="item-code">${code}</span>` : ''}<span class="item-sub">${sub}</span>${extra}</span>
    ${href ? icon('chevron', { cls: 'item-chev' }) : ''}`;
  return href
    ? html`<a class="item ${tone}" href="${href}" ${testid ? html`data-testid="${testid}"` : ''}>${inner}</a>`
    : html`<div class="item ${tone}">${inner}</div>`;
}

function itemHtml(it) {
  const a = it.animal;
  const code = a ? animalLabel(a) : '';
  const href = a ? `#/animal/${a.id}` : null;
  switch (it.type) {
    case 'hold':
      return item({ tone: 'danger', ico: 'dropOff', k: t('WITHHOLD MILK'), code, href, testid: 'today-hold',
        sub: `${holdText(it.hold)}${it.hold.overlapping ? ` · ${treatmentsN(it.hold.treatments.length)}` : ''}` });
    case 'checkOverdue':
      return item({ tone: 'warn', ico: 'pulse', k: t('Pregnancy check overdue'), code, href,
        sub: `${t('due {date} ({when})', { date: fmtDay(it.st.checkDue), when: inText(it.days) })}${it.st.inconclusive ? ` · ${t('inconclusive last time')}` : ''}` });
    case 'calving':
      return item({ tone: it.days < 0 ? 'warn' : 'calm', ico: 'baby', k: t(it.days < 0 ? 'Calving overdue' : 'Calving due'), code, href,
        sub: `${it.st.calving.from === it.st.calving.to ? fmtDay(it.st.calving.from) : t('from {date}', { date: fmtDay(it.st.calving.from) })} (${inText(it.days)})` });
    case 'dryoff':
      return item({ tone: 'calm', ico: 'pause', k: t('Dry off'), code, href, sub: t('by {date} ({when})', { date: fmtDay(it.st.dryOff.due), when: inText(it.days) }) });
    case 'checkSoon':
      return item({ tone: 'calm', ico: 'pulse', k: t('Pregnancy check'), code, href, sub: `${fmtDay(it.st.checkDue)} (${inText(it.days)})` });
    case 'bse':
      return item({ tone: 'calm', ico: 'clipboard', k: t('Bull soundness recheck'), code, href, sub: `${fmtDay(it.event.recheckDate)} (${inText(it.days)})` });
    case 'task':
      return item({ tone: it.days < 0 ? 'warn' : 'calm', ico: it.task.kind === 'vet' ? 'stethoscope' : 'bell', k: t(it.task.kind === 'vet' ? 'Vet visit' : 'Reminder'),
        code: it.task.title, sub: `${fmtDay(it.task.date)} (${inText(it.days)})${a ? ` · ${code}` : ''}`,
        extra: html`<span class="item-actions"><button type="button" class="btn small" data-act="taskDone" data-id="${it.task.id}">${icon('check', { size: 18 })}${t('Done')}</button>
        <button type="button" class="btn small ghost" data-act="taskEdit" data-id="${it.task.id}">${t('Edit')}</button></span>` });
    default: return '';
  }
}

function greeting() {
  const h = partsIn(Date.now(), tz()).h;
  const name = currentUser()?.name?.split(' ')[0] || '';
  const g = h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening');
  return name ? `${g}, ${name}` : g;
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
  const herdSize = D().animals.filter((a) => (a.status || 'active') === 'active').length;

  return {
    html: html`
    <header class="hero">
      <div class="hero-top"><p class="hero-date">${fmtLong(todayKey(tz()))}</p>${syncPill()}</div>
      <h1 class="hero-title">${greeting()}</h1>
      <p class="hero-farm">${s.farmName || t('My farm')} · ${plural(herdSize, ['animal', 'animals'], ['zwierzę', 'zwierzęta', 'zwierząt'])}</p>
      <span class="net" data-net hidden></span>
      <section class="find" aria-labelledby="find-label">
        <label id="find-label" for="find" class="find-label">${t('Find cow by code')}</label>
        <div class="search-row">
          <span class="search-field">${icon('search', { cls: 'search-ico' })}
          <input id="find" type="search" inputmode="${ui.kb}" autocomplete="off" autocapitalize="characters" enterkeyhint="go"
            placeholder="${t('Code or tag')}" value="${ui.query}" data-testid="find"></span>
          <button type="button" class="btn kb" data-act="kb" aria-label="${t('Switch keyboard')}">${ui.kb === 'numeric' ? 'ABC' : '123'}</button>
        </div>
        <div id="results">${searchResults(ui.query)}</div>
      </section>
    </header>

    ${updateBanner()}
    ${hasSample ? html`<div class="sample-banner">${icon('sun')}<span>${t('You are looking at sample data (marked “Sample”).')} <a href="#/data">${t('Remove sample data')}</a></span></div>` : ''}

    ${holds.length ? html`<section aria-label="${t('Milk holds')}" class="list">${holds.map(itemHtml)}</section>` : ''}

    <section aria-labelledby="att">
      <h2 id="att" class="section-title">${t('Needs attention')}${rest.length ? html`<span class="count-badge">${rest.length}</span>` : ''}</h2>
      ${rest.length ? html`<div class="list">${rest.map(itemHtml)}</div>`
        : html`<p class="all-clear">${icon('checkCircle')}${t('Nothing overdue or due soon.')}</p>`}
    </section>

    <section aria-labelledby="br">
      <h2 id="br" class="section-title">${t('Breeding')}</h2>
      <div class="counts">
        <a class="count" href="#/breeding/inseminated" data-testid="count-inseminated">
          <span class="count-ico">${icon('syringe')}</span>
          <span class="count-n">${ins.length}</span><span class="count-l">${t('Cows inseminated')}</span>
          <span class="count-s">${periodLabel(r)}${attempts !== ins.length ? ` · ${plural(attempts, ['insemination', 'inseminations'], ['inseminacja', 'inseminacje', 'inseminacji'])}` : ''}</span></a>
        <a class="count" href="#/breeding/awaiting" data-testid="count-awaiting">
          <span class="count-ico">${icon('pulse')}</span>
          <span class="count-n">${awaiting.length}</span><span class="count-l">${t('Awaiting pregnancy result')}</span>
          <span class="count-s ${overdue ? 'overdue' : ''}">${overdue ? t('{n} overdue', { n: plural(overdue, ['check', 'checks'], ['badanie', 'badania', 'badań']) }) : t('none overdue')}</span></a>
      </div>
      ${periodChips()}
    </section>

    <section class="card milk-card" aria-labelledby="milk-h">
      <div class="card-head"><h2 id="milk-h" class="card-title">${icon('milk')}${t('Milk')}</h2><span class="muted small">${periodLabel(r)}</span></div>
      <dl class="totals" data-testid="milk-totals">
        <div><dt>${t('Litres produced')}</dt><dd data-testid="t-produced">${L(m.produced)}</dd></div>
        <div><dt>${t('Litres sold')}</dt><dd data-testid="t-sold">${L(m.sold)}</dd></div>
        <div><dt>${t('Expected amount')}</dt><dd data-testid="t-expected">${money(m.expected)}</dd></div>
        <div><dt>${t('Payments received')}</dt><dd data-testid="t-received">${money(m.received)}</dd></div>
      </dl>
      ${m.keptTotal ? html`<p class="muted small">${t('Kept out of the tank: {total} (withheld {w}, discarded {d}, on-farm {o})', { total: L(m.keptTotal), w: L(m.kept.withheld), d: L(m.kept.discarded), o: L(m.kept.onfarm) })}</p>` : ''}
      ${m.unpriced ? html`<p class="muted small">${t('{n} collection(s) without a price are not in the expected amount.', { n: m.unpriced })}</p>` : ''}
      <a href="#/milk" class="link">${t('Milk details →')}</a>
    </section>

    <section aria-labelledby="qe">
      <h2 id="qe" class="section-title">${t('Quick entry')}</h2>
      <div class="quick">
        <button type="button" class="tile" data-act="milk"><span class="tile-ico">${icon('milk')}</span>${t('Record milk')}</button>
        <button type="button" class="tile" data-act="collection"><span class="tile-ico">${icon('truck')}</span>${t('Milk collection')}</button>
        <button type="button" class="tile" data-act="exposure"><span class="tile-ico">${icon('bull')}</span>${t('Bull with group')}</button>
        <button type="button" class="tile" data-act="vet"><span class="tile-ico">${icon('stethoscope')}</span>${t('Vet visit / reminder')}</button>
        <button type="button" class="tile wide" data-act="add"><span class="tile-ico">${icon('plus')}</span>${t('Add animal')}</button>
      </div>
    </section>
    ${recordCount && (backupDays == null || backupDays > 14) ? html`<p class="backup-nag">${icon('download')}<span>${backupDays == null ? t('No backup yet.') : t('Last backup {ago}.', { ago: agoText(backupDays) })} <a href="#/data">${t('Back up now')}</a></span></p>` : ''}
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
