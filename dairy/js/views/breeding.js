import { html } from '../ui.js';
import { D, tz, periodRange } from '../store.js';
import * as db from '../db.js';
import { inseminatedIn, awaitingResult, pregnantList, animalLabel, sireLabel, isActive, prospectiveCalving } from '../logic.js';
import { fmtDay, fmtDateTime, diffDays, todayKey, inText, dayKey } from '../time.js';
import { periodChips, empty, calvingText, breedingHeadline, holdBanner } from '../components.js';
import { recordExposure, recordPregCheck, setCheckReminder } from '../actions.js';

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
    body = html`<p class="muted small">Active animals whose latest breeding still needs a pregnancy result. Inconclusive results stay here.</p>
      ${list.length ? list.map(({ animal: a, st }) => {
        const h = breedingHeadline(a, st);
        const days = st.latest.exact ? `${st.daysSince} days since service` : `${st.daysRange[0]}–${st.daysRange[1]} days since possible service`;
        const due = st.checkDue ? html`<span class="${st.checkOverdue ? 'overdue' : ''}">Check ${st.checkOverdue ? 'overdue' : 'due'} ${fmtDay(st.checkDue)} (${inText(diffDays(today, st.checkDue))})</span>` : 'Bull still in — no check due yet';
        const pc = prospectiveCalving(D(), st);
        return rowLink(a, html`<strong data-testid="awaiting-days">${days}</strong> · ${h.main}`,
          html`${due}${st.inconclusive ? ' · last check inconclusive' : ''}${pc && !st.latest.exact ? html` · if pregnant, calving ${fmtDay(pc.from)} – ${pc.ongoing ? '…' : fmtDay(pc.to)}` : ''}`,
          html`<span class="brow-acts"><button type="button" class="btn small" data-act="check" data-id="${a.id}">Check result</button>
            <button type="button" class="btn small ghost" data-act="remind" data-id="${a.id}">Reminder</button></span>`);
      }) : empty('No animals waiting for a pregnancy result.')}`;
  } else if (tab === 'pregnant') {
    const list = pregnantList(D());
    body = list.length ? list.map(({ animal: a, st }) => rowLink(a,
      html`Calving ${st.calving ? calvingText(st.calving) : 'date unknown — add vet estimate'}${st.calving?.source === 'vet' ? ' (vet)' : st.calving?.source === 'exposure' ? ' (range from bull exposure)' : ''}`,
      st.dryOff ? (st.dryOff.done ? 'Dried off' : `Dry off by ${fmtDay(st.dryOff.due)} (${inText(diffDays(today, st.dryOff.due))})`) : '')) : empty('No confirmed pregnancies.');
  } else if (tab === 'inseminated') {
    const r = periodRange();
    const list = inseminatedIn(D(), r.from, r.to);
    body = html`${periodChips()}
      <p><strong data-testid="ins-count">${list.length}</strong> cow${list.length === 1 ? '' : 's'} inseminated, ${list.reduce((n, x) => n + x.attempts.length, 0)} inseminations. Each cow counts once.</p>
      ${list.length ? list.map(({ animal: a, attempts }) => rowLink(a, breedingHeadline(a).main,
        attempts.map((e) => fmtDateTime(e.at, tz())).join(' · ') + (attempts.length > 1 ? ` (${attempts.length} attempts)` : ''))) : empty('No inseminations in this period.')}`;
  } else if (tab === 'exposures') {
    const list = D().exposures.slice().sort((a, b) => b.start.localeCompare(a.start));
    body = html`<button type="button" class="btn primary" data-act="newExposure">+ Bull with a group</button>
      ${list.length ? list.map((x) => html`<button type="button" class="card link-card" data-act="editExposure" data-id="${x.id}">
        <strong>${sireLabel(D(), x) || 'Bull not recorded'}</strong>${x.group ? ` · ${x.group}` : ''}<br>
        ${fmtDay(x.start)} – ${x.end ? fmtDay(x.end) : html`<span class="badge info">still in</span>`} · ${(x.animalIds || []).length} animals
        <span class="muted small">${(x.animalIds || []).map((id) => animalLabel(db.get('animals', id))).join(', ')}</span></button>`) : empty('No bull exposures recorded.')}`;
  } else {
    const heats = D().events.filter((e) => e.kind === 'heat').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
    body = heats.length ? heats.map((e) => {
      const a = db.get('animals', e.animalId);
      if (!a) return '';
      const d = diffDays(dayKey(e.at, tz()), today);
      return rowLink(a, `Heat ${fmtDateTime(e.at, tz())}`, `${d} days ago · next expected about ${fmtDay(dayKey(Date.parse(e.at) + 21 * 86400000, tz()))}`);
    }) : empty('No heats recorded.');
  }
  return {
    html: html`<header class="top"><h1>Breeding</h1></header>
      <nav class="tabs scroll" aria-label="Breeding lists">${TABS.map(([k, l]) => html`<a class="tab ${tab === k ? 'on' : ''}" href="#/breeding/${k}" ${tab === k ? html`aria-current="page"` : ''}>${l}</a>`)}</nav>
      <div class="list">${body}</div>`,
    actions: {
      check: (d) => recordPregCheck(db.get('animals', d.id)),
      remind: (d) => setCheckReminder(db.get('animals', d.id)),
      newExposure: () => recordExposure(),
      editExposure: (d) => recordExposure(db.get('exposures', d.id)),
    },
  };
}
export { holdBanner, isActive };
