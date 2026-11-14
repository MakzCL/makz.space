import { html, raw } from './ui.js';
import { D, S, tz, ui, periodRange } from './store.js';
import { breedingStatus, withdrawals, animalLabel, prospectiveCalving, isFemale, TYPES, STATUS, isActive } from './logic.js';
import { fmtDay, fmtDateTime, agoText, inText, diffDays, todayKey } from './time.js';

export const L = (n) => `${Number(n || 0).toLocaleString('en-GB', { maximumFractionDigits: 1 })} L`;
export function money(n) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: S().currency }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${S().currency}`; }
}

export function holdText(hold) {
  if (hold.missingEnd) return 'end time missing';
  return `until ${fmtDateTime(hold.until, tz())}`;
}

export function holdBanner(a, { compact = false } = {}) {
  const w = withdrawals(D(), a.id);
  if (!w.milk.active) return '';
  return html`<div class="hold ${compact ? 'compact' : ''}" role="alert">
    <strong class="hold-title">WITHHOLD MILK</strong>
    <span>${compact ? `${animalLabel(a)} · ` : ''}${holdText(w.milk)}${w.milk.overlapping ? ` · ${w.milk.treatments.length} overlapping treatments` : ''}</span>
  </div>`;
}

/** One-line breeding status, the headline after an insemination. */
export function breedingHeadline(a, st = breedingStatus(D(), a)) {
  const l = st.latest;
  if (!l) return { main: isFemale(a) ? 'No breeding recorded' : '', sub: '' };
  const zone = tz();
  let main; let sub;
  if (l.kind === 'ai') {
    main = `Inseminated ${agoText(st.daysSince)}`;
    sub = `${fmtDateTime(l.at, zone)}${l.sire ? ` · ${l.sire}` : ''}`;
  } else if (l.kind === 'natural') {
    main = `Served (natural) ${agoText(st.daysSince)}`;
    sub = `${fmtDateTime(l.at, zone)}${l.sire ? ` · ${l.sire}` : ''}`;
  } else {
    const [lo, hi] = st.daysRange;
    main = `With bull ${l.end ? `${fmtDay(l.start)} – ${fmtDay(l.end)}` : `since ${fmtDay(l.start)}`}`;
    sub = `Service date not known · ${lo === hi ? lo : `${lo}–${hi}`} days since possible service${l.sire ? ` · ${l.sire}` : ''}`;
  }
  return { main, sub };
}

export function stateBadge(st) {
  const map = {
    awaiting: st.inconclusive ? ['warn', 'Inconclusive — recheck'] : ['info', 'Awaiting pregnancy result'],
    pregnant: ['good', 'Pregnant'], open: ['muted', 'Open'], calved: ['muted', 'Calved'], lost: ['warn', 'Pregnancy lost'], none: ['muted', ''],
  };
  const [cls, text] = map[st.state] || map.none;
  return text ? html`<span class="badge ${cls}">${text}</span>` : '';
}

export function calvingText(c) {
  if (!c) return '';
  if (c.from === c.to) return fmtDay(c.from);
  return `between ${fmtDay(c.from)} and ${fmtDay(c.to)}`;
}

export function checkLine(st) {
  if (st.state !== 'awaiting') return '';
  if (!st.checkDue) return html`<p class="muted">Pregnancy check: set once the bull is out, or set a reminder.</p>`;
  const d = diffDays(todayKey(tz()), st.checkDue);
  return html`<p class="${d < 0 ? 'overdue' : ''}">Pregnancy check ${d < 0 ? 'overdue' : 'due'} ${fmtDay(st.checkDue)} (${inText(d)})${st.reminder ? ' · reminder set' : ''}</p>`;
}

export function breedingCard(a) {
  const st = breedingStatus(D(), a);
  const h = breedingHeadline(a, st);
  if (!st.latest) return html`<div class="card breeding"><p class="muted">${h.main}</p></div>`;
  const pc = st.state === 'awaiting' ? prospectiveCalving(D(), st) : null;
  return html`<div class="card breeding" data-testid="breeding-card">
    <p class="headline" data-testid="breeding-headline">${h.main}</p>
    <p class="sub">${h.sub}</p>
    <p>${stateBadge(st)}</p>
    ${checkLine(st)}
    ${st.state === 'pregnant' ? html`<p>Expected calving: <strong>${st.calving ? calvingText(st.calving) : 'unknown'}</strong>${st.calving?.source === 'vet' ? ' (vet estimate)' : st.calving?.source === 'exposure' ? ' (from bull exposure window)' : ''}</p>
      ${st.dryOff ? html`<p>${st.dryOff.done ? 'Dried off' : `Dry off by ${fmtDay(st.dryOff.due)} (${inText(diffDays(todayKey(tz()), st.dryOff.due))})`}</p>` : ''}` : ''}
    ${pc ? html`<p class="muted">If pregnant, calving ${pc.from === pc.to ? `about ${fmtDay(pc.from)}` : `between ${fmtDay(pc.from)} and ${pc.ongoing ? 'later (bull still in)' : fmtDay(pc.to)}`}</p>` : ''}
  </div>`;
}

export function animalRow(a, extra = '') {
  const w = withdrawals(D(), a.id);
  return html`<a class="row" href="#/animal/${a.id}" data-testid="animal-row">
    <span class="row-code">${animalLabel(a)}</span>
    <span class="row-main"><span>${[a.tag && a.tag !== a.code ? a.tag : '', TYPES[a.type], a.group].filter(Boolean).join(' · ')}</span>
      ${extra ? html`<span class="row-extra">${extra}</span>` : ''}</span>
    ${w.milk.active ? html`<span class="badge danger">Withhold milk</span>` : ''}
    ${!isActive(a) ? html`<span class="badge muted">${STATUS[a.status]}</span>` : ''}
    ${a.sample ? html`<span class="badge sample">Sample</span>` : ''}
  </a>`;
}

export function periodChips(act = 'period') {
  const r = periodRange();
  const opts = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month'], ['custom', 'Custom']];
  return html`<div class="period">
    <div class="chips" role="group" aria-label="Period">${opts.map(([v, l]) => html`<button type="button" class="chip ${ui.period === v ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${ui.period === v}">${l}</button>`)}</div>
    ${ui.period === 'custom' ? html`<div class="custom-range"><label>From <input type="date" data-range="from" value="${ui.from || r.from}"></label><label>To <input type="date" data-range="to" value="${ui.to || r.to}"></label></div>` : ''}
    <p class="muted small">${fmtDay(r.from)} – ${fmtDay(r.to)}</p></div>`;
}

export function empty(text) { return html`<p class="empty">${text}</p>`; }
export { raw };
