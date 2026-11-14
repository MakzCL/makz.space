import { html, raw } from './ui.js';
import { D, S, tz, ui, periodRange } from './store.js';
import { breedingStatus, withdrawals, animalLabel, prospectiveCalving, isFemale, TYPES, STATUS, isActive } from './logic.js';
import { fmtDay, fmtDateTime, agoText, inText, diffDays, todayKey } from './time.js';
import { t, locale, plural } from './i18n.js';
import { icon } from './icons.js';
import { thumb } from './photos.js';

export const num = (n, d = 2) => Number(n || 0).toLocaleString(locale(), { maximumFractionDigits: d });
export const L = (n) => `${Number(n || 0).toLocaleString(locale(), { maximumFractionDigits: 1 })} L`;
export function money(n) {
  try { return new Intl.NumberFormat(locale(), { style: 'currency', currency: S().currency }).format(n || 0); } catch { return `${(n || 0).toFixed(2)} ${S().currency}`; }
}
export const days = (n) => plural(n, ['day', 'days'], ['dzień', 'dni', 'dni']);
export const treatmentsN = (n) => plural(n, ['treatment', 'treatments'], ['leczenie', 'leczenia', 'leczeń']);

export function holdText(hold) {
  if (hold.missingEnd) return t('end time missing');
  return t('until {d}', { d: fmtDateTime(hold.until, tz()) });
}

export function holdBanner(a, { compact = false } = {}) {
  const w = withdrawals(D(), a.id);
  if (!w.milk.active) return '';
  return html`<div class="hold ${compact ? 'compact' : ''}" role="alert">
    <strong class="hold-title">${icon('dropOff')}${t('WITHHOLD MILK')}</strong>
    <span>${compact ? `${animalLabel(a)} · ` : ''}${holdText(w.milk)}${w.milk.overlapping ? ` · ${t('{n} overlapping treatments', { n: w.milk.treatments.length })}` : ''}</span>
  </div>`;
}

/** One-line breeding status, the headline after an insemination. */
export function breedingHeadline(a, st = breedingStatus(D(), a)) {
  const l = st.latest;
  if (!l) return { main: isFemale(a) ? t('No breeding recorded') : '', sub: '' };
  const zone = tz();
  let main; let sub;
  if (l.kind === 'ai') {
    main = t('Inseminated {ago}', { ago: agoText(st.daysSince) });
    sub = `${fmtDateTime(l.at, zone)}${l.sire ? ` · ${l.sire}` : ''}`;
  } else if (l.kind === 'natural') {
    main = t('Served (natural) {ago}', { ago: agoText(st.daysSince) });
    sub = `${fmtDateTime(l.at, zone)}${l.sire ? ` · ${l.sire}` : ''}`;
  } else {
    const [lo, hi] = st.daysRange;
    main = l.end ? t('With bull {from} – {to}', { from: fmtDay(l.start), to: fmtDay(l.end) }) : t('With bull since {from}', { from: fmtDay(l.start) });
    sub = `${t('Service date not known')} · ${t('{range} days since possible service', { range: lo === hi ? lo : `${lo}–${hi}` })}${l.sire ? ` · ${l.sire}` : ''}`;
  }
  return { main, sub };
}

export function stateBadge(st) {
  const map = {
    awaiting: st.inconclusive ? ['warn', 'Inconclusive — recheck'] : ['info', 'Awaiting pregnancy result'],
    pregnant: ['good', 'Pregnant'], open: ['muted', 'Open'], calved: ['muted', 'Calved'], lost: ['warn', 'Pregnancy lost'], none: ['muted', ''],
  };
  const [cls, text] = map[st.state] || map.none;
  return text ? html`<span class="badge ${cls}">${t(text)}</span>` : '';
}

export function calvingText(c) {
  if (!c) return '';
  if (c.from === c.to) return fmtDay(c.from);
  return t('between {a} and {b}', { a: fmtDay(c.from), b: fmtDay(c.to) });
}

export function checkLine(st) {
  if (st.state !== 'awaiting') return '';
  if (!st.checkDue) return html`<p class="muted">${t('Pregnancy check: set once the bull is out, or set a reminder.')}</p>`;
  const d = diffDays(todayKey(tz()), st.checkDue);
  return html`<p class="${d < 0 ? 'overdue' : ''}">${t(d < 0 ? 'Pregnancy check overdue {date} ({when})' : 'Pregnancy check due {date} ({when})', { date: fmtDay(st.checkDue), when: inText(d) })}${st.reminder ? ` · ${t('reminder set')}` : ''}</p>`;
}

/** Progress through the cycle: service → check, or service → calving. */
function cycleBar(st) {
  const today = todayKey(tz());
  let from; let to; let label; let tone = '';
  if (st.state === 'awaiting' && st.latest.exact && st.checkDue) {
    from = st.latest.start; to = st.checkDue; label = t('Pregnancy check'); tone = st.checkOverdue ? 'late' : '';
  } else if (st.state === 'pregnant' && st.calving && st.latest.exact) {
    from = st.latest.start; to = st.calving.from; label = t('Expected calving');
  } else return '';
  const total = Math.max(1, diffDays(from, to));
  const done = diffDays(from, today);
  const pct = Math.max(2, Math.min(100, Math.round((done / total) * 100)));
  return html`<div class="cycle ${tone}" role="img" aria-label="${label}: ${pct}%">
    <div class="cycle-bar"><span style="width:${pct}%"></span></div>
    <div class="cycle-legend"><span>${t('Day {n}', { n: done })}</span><span>${label}: ${t('day {n}', { n: total })}</span></div></div>`;
}

export function breedingCard(a) {
  const st = breedingStatus(D(), a);
  const h = breedingHeadline(a, st);
  if (!st.latest) return html`<div class="card breeding empty-breeding">${icon('heart')}<p class="muted">${h.main}</p></div>`;
  const pc = st.state === 'awaiting' ? prospectiveCalving(D(), st) : null;
  const src = st.calving?.source === 'vet' ? ` (${t('vet estimate')})` : st.calving?.source === 'exposure' ? ` (${t('from bull exposure window')})` : '';
  return html`<div class="card breeding" data-testid="breeding-card">
    <div class="breeding-top"><span class="breeding-ico">${icon(st.latest.kind === 'ai' ? 'syringe' : st.latest.kind === 'natural' ? 'heart' : 'bull')}</span>
      <div><p class="headline" data-testid="breeding-headline">${h.main}</p><p class="sub">${h.sub}</p></div></div>
    <p>${stateBadge(st)}</p>
    ${cycleBar(st)}
    ${checkLine(st)}
    ${st.state === 'pregnant' ? html`<p>${t('Expected calving')}: <strong>${st.calving ? calvingText(st.calving) : t('unknown')}</strong>${src}</p>
      ${st.dryOff ? html`<p>${st.dryOff.done ? t('Dried off') : t('Dry off by {date} ({when})', { date: fmtDay(st.dryOff.due), when: inText(diffDays(todayKey(tz()), st.dryOff.due)) })}</p>` : ''}` : ''}
    ${pc ? html`<p class="muted">${pc.from === pc.to ? t('If pregnant, calving about {date}', { date: fmtDay(pc.from) })
      : t('If pregnant, calving between {a} and {b}', { a: fmtDay(pc.from), b: pc.ongoing ? t('later (bull still in)') : fmtDay(pc.to) })}</p>` : ''}
  </div>`;
}

export function animalRow(a, extra = '') {
  const w = withdrawals(D(), a.id);
  return html`<a class="row" href="#/animal/${a.id}" data-testid="animal-row">
    ${thumb(a)}
    <span class="row-id"><span class="row-code">${animalLabel(a)}</span>${a.tag && a.tag !== a.code ? html`<span class="row-tag">${a.tag}</span>` : ''}</span>
    <span class="row-main"><span>${[t(TYPES[a.type]), a.group].filter(Boolean).join(' · ')}</span>
      ${extra ? html`<span class="row-extra">${extra}</span>` : ''}
    <span class="row-badges">${w.milk.active ? html`<span class="badge danger">${icon('dropOff', { size: 14 })}${t('Withhold milk')}</span>` : ''}
    ${!isActive(a) ? html`<span class="badge muted">${t(STATUS[a.status])}</span>` : ''}
    ${a.sample ? html`<span class="badge sample">${t('Sample')}</span>` : ''}</span></span>
    ${icon('chevron', { cls: 'row-chev' })}
  </a>`;
}

export function periodLabel(r) {
  return r.n ? t('Last {n} days', { n: r.n }) : t(r.label);
}

export function periodChips(act = 'period') {
  const r = periodRange();
  const opts = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month'], ['custom', 'Custom']];
  return html`<div class="period">
    <div class="chips" role="group" aria-label="${t('Period')}">${opts.map(([v, l]) => html`<button type="button" class="chip ${ui.period === v ? 'on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${ui.period === v}">${t(l)}</button>`)}</div>
    ${ui.period === 'custom' ? html`<div class="custom-range"><label>${t('From')} <input type="date" data-range="from" value="${ui.from || r.from}"></label><label>${t('To')} <input type="date" data-range="to" value="${ui.to || r.to}"></label></div>` : ''}
    <p class="muted small">${fmtDay(r.from)} – ${fmtDay(r.to)}</p></div>`;
}

export function empty(text, ico = 'checkCircle') { return html`<div class="empty">${icon(ico)}<p>${t(text)}</p></div>`; }
export const emptyState = empty;
export { raw };
