import { html } from '../ui.js';
import { D } from '../store.js';
import { isActive, isBull, TYPES, searchAnimals } from '../logic.js';
import { animalRow, empty, breedingHeadline } from '../components.js';
import { editAnimal } from '../actions.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';

const state = { tab: 'active', filter: '', type: '' };
const PLURAL_TYPE = { cow: 'Cows', heifer: 'Heifers', calf: 'Calves', bull: 'Bulls', steer: 'Steers' };

export function herdView() {
  const all = D().animals;
  const pool = all.filter((a) => (state.tab === 'active' ? isActive(a) : !isActive(a)));
  const counts = pool.reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + 1 }), {});
  let list = pool;
  if (state.type) list = list.filter((a) => a.type === state.type);
  if (state.filter) {
    const ids = new Set(searchAnimals(list, state.filter, { includeArchived: true }).map((a) => a.id));
    list = list.filter((a) => ids.has(a.id) || String(a.group || '').toLowerCase().includes(state.filter.toLowerCase()));
  }
  list.sort((a, b) => String(a.code || a.tag).localeCompare(String(b.code || b.tag), undefined, { numeric: true }));
  const archived = all.filter((a) => !isActive(a)).length;
  return {
    html: html`
    <header class="top"><h1>${t('Herd')}</h1><button type="button" class="btn primary round-add" data-act="add" aria-label="${t('Add animal')}">${icon('plus')}<span>${t('Add animal')}</span></button></header>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="tab ${state.tab === 'active' ? 'on' : ''}" aria-selected="${state.tab === 'active'}" data-act="tab" data-v="active">${t('On farm')} (${all.length - archived})</button>
      <button type="button" role="tab" class="tab ${state.tab === 'archive' ? 'on' : ''}" aria-selected="${state.tab === 'archive'}" data-act="tab" data-v="archive">${t('Archive')} (${archived})</button>
    </div>
    <div class="type-chips" role="group" aria-label="${t('Type')}">
      <button type="button" class="chip ${!state.type ? 'on' : ''}" data-act="type" data-v="" aria-pressed="${!state.type}">${t('All')} (${pool.length})</button>
      ${Object.entries(TYPES).filter(([k]) => counts[k]).map(([k, v]) => html`<button type="button" class="chip ${state.type === k ? 'on' : ''}" data-act="type" data-v="${k}" aria-pressed="${state.type === k}">${t(PLURAL_TYPE[k] || v)} (${counts[k]})</button>`)}
    </div>
    <label class="search-pill">${icon('search', { size: 20 })}<input id="herd-filter" type="search" placeholder="${t('Search by code, tag or group')}" value="${state.filter}" data-filter aria-label="${t('Filter')}"></label>
    ${state.tab === 'archive' ? html`<p class="muted small">${t('Sold, transferred and dead animals. Their full history is kept.')}</p>` : ''}
    <div class="list" data-testid="herd-list">${list.length ? list.map((a) => animalRow(a, isBull(a) ? '' : breedingHeadline(a).main)) : empty(state.tab === 'active' ? 'No animals yet. Add your first animal.' : 'No archived animals.')}</div>`,
    actions: {
      add: () => editAnimal(),
      tab: (d) => { state.tab = d.v; return 'render'; },
      type: (d) => { state.type = d.v; return 'render'; },
    },
    mount(el) {
      const f = el.querySelector('[data-filter]');
      f.addEventListener('input', () => { state.filter = f.value; window.dispatchEvent(new Event('rerender')); });
      f.addEventListener('search', () => { state.filter = f.value; window.dispatchEvent(new Event('rerender')); });
    },
  };
}
