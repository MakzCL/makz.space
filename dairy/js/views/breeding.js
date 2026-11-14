import { html } from '../ui.js';
import { D, tz, periodRange } from '../store.js';
import * as db from '../db.js';
import { inseminatedIn, awaitingResult, pregnantList, animalLabel, sireLabel, prospectiveCalving } from '../logic.js';
import { fmtDay, fmtDateTime, diffDays, todayKey, inText, dayKey, agoText } from '../time.js';
import { periodChips, empty, calvingText, breedingHeadline } from '../components.js';
import { recordExposure, recordPregCheck, setCheckReminder } from '../actions.js';
import { t, plural } from '../i18n.js';

const TABS = [['awaiting', 'Awaiting result'], ['pregnant', 'Pregnant'], ['inseminated', 'Inseminated'], ['exposures', 'Bull exposures'], ['heats', 'Heats']];

function rowLink(a, main, sub, extra = '') {
  return html`<div class="brow"><a class="brow-main" href="#/animal/${a.id}"><span class="row-code">${animalLabel(a)}</span>
    <span class="row-main"><span>${main}</span>${sub ? html`<span class="row-extra">${sub}</span>` : ''}</span></a>${extra}</div>`;
}

export function breedingView(tab = 'awaiting') {
  const today = todayKey(tz());
  let body;
  if (tab === 'awaiting') {
    const list = awaitingResult(D());
    body = html`<p class="muted small">${t('Active animals whose latest breeding still needs a pregnancy result. Inconclusive results stay here.')}</p>
      ${list.length ? list.map(({ animal: a, st }) => {
        const h = breedingHeadline(a, st);
        const days = st.latest.exact ? t('{n} days since service', { n: st.daysSince }) : t('{range} days since possible service', { range: `${st.daysRange[0]}–${st.daysRange[1]}` });
        const due = st.checkDue ? html`<span class="${st.checkOverdue ? 'overdue' : ''}">${t(st.checkOverdue ? 'Check overdue {date} ({when})' : 'Check due {date} ({when})', { date: fmtDay(st.checkDue), when: inText(diffDays(today, st.checkDue)) })}</span>` : t('Bull still in — no check due yet');
        const pc = prospectiveCalving(D(), st);
        return rowLink(a, html`<strong data-testid="awaiting-days">${days}</strong> · ${h.main}`,
          html`${due}${st.inconclusive ? ` · ${t('last check inconclusive')}` : ''}${pc && !st.latest.exact ? ` · ${t('if pregnant, calving {a} – {b}', { a: fmtDay(pc.from), b: pc.ongoing ? '…' : fmtDay(pc.to) })}` : ''}`,
          html`<span class="brow-acts"><button type="button" class="btn small" data-act="check" data-id="${a.id}">${t('Check result')}</button>
            <button type="button" class="btn small ghost" data-act="remind" data-id="${a.id}">${t('Reminder')}</button></span>`);
      }) : empty('No animals waiting for a pregnancy result.')}`;
  } else if (tab === 'pregnant') {
    const list = pregnantList(D());
    body = list.length ? list.map(({ animal: a, st }) => rowLink(a,
      html`${t('Calving')} ${st.calving ? calvingText(st.calving) : t('date unknown — add vet estimate')}${st.calving?.source === 'vet' ? ` (${t('vet')})` : st.calving?.source === 'exposure' ? ` (${t('range from bull exposure')})` : ''}`,
      st.dryOff ? (st.dryOff.done ? t('Dried off') : t('Dry off by {date} ({when})', { date: fmtDay(st.dryOff.due), when: inText(diffDays(today, st.dryOff.due)) })) : '')) : empty('No confirmed pregnancies.');
  } else if (tab === 'inseminated') {
    const r = periodRange();
    const list = inseminatedIn(D(), r.from, r.to);
    const n = list.reduce((s, x) => s + x.attempts.length, 0);
    body = html`${periodChips()}
      <p><strong data-testid="ins-count">${list.length}</strong> ${t('cows inseminated, {n}. Each cow counts once.', { n: plural(n, ['insemination', 'inseminations'], ['inseminacja', 'inseminacje', 'inseminacji']) })}</p>
      ${list.length ? list.map(({ animal: a, attempts }) => rowLink(a, breedingHeadline(a).main,
        attempts.map((e) => fmtDateTime(e.at, tz())).join(' · ') + (attempts.length > 1 ? ` (${plural(attempts.length, ['attempt', 'attempts'], ['próba', 'próby', 'prób'])})` : ''))) : empty('No inseminations in this period.')}`;
  } else if (tab === 'exposures') {
    const list = D().exposures.slice().sort((a, b) => b.start.localeCompare(a.start));
    body = html`<button type="button" class="btn primary" data-act="newExposure">+ ${t('Bull with a group')}</button>
      ${list.length ? list.map((x) => html`<button type="button" class="card link-card" data-act="editExposure" data-id="${x.id}">
        <strong>${sireLabel(D(), x) || t('Bull not recorded')}</strong>${x.group ? ` · ${x.group}` : ''}<br>
        ${fmtDay(x.start)} – ${x.end ? fmtDay(x.end) : html`<span class="badge info">${t('still in')}</span>`} · ${plural((x.animalIds || []).length, ['animal', 'animals'], ['zwierzę', 'zwierzęta', 'zwierząt'])}
        <span class="muted small">${(x.animalIds || []).map((id) => animalLabel(db.get('animals', id))).join(', ')}</span></button>`) : empty('No bull exposures recorded.')}`;
  } else {
    const heats = D().events.filter((e) => e.kind === 'heat').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
    body = heats.length ? heats.map((e) => {
      const a = db.get('animals', e.animalId);
      if (!a) return '';
      const d = diffDays(dayKey(e.at, tz()), today);
      return rowLink(a, t('Heat {d}', { d: fmtDateTime(e.at, tz()) }), t('{ago} · next expected about {date}', { ago: agoText(d), date: fmtDay(dayKey(Date.parse(e.at) + 21 * 86400000, tz())) }));
    }) : empty('No heats recorded.');
  }
  return {
    html: html`<header class="top"><h1>${t('Breeding')}</h1></header>
      <nav class="tabs scroll" aria-label="${t('Breeding lists')}">${TABS.map(([k, l]) => html`<a class="tab ${tab === k ? 'on' : ''}" href="#/breeding/${k}" ${tab === k ? html`aria-current="page"` : ''}>${t(l)}</a>`)}</nav>
      <div class="list">${body}</div>`,
    actions: {
      check: (d) => recordPregCheck(db.get('animals', d.id)),
      remind: (d) => setCheckReminder(db.get('animals', d.id)),
      newExposure: () => recordExposure(),
      editExposure: (d) => recordExposure(db.get('exposures', d.id)),
    },
  };
}
