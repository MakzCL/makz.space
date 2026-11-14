import { html } from '../ui.js';
import { D } from '../store.js';
import { isActive, isBull, TYPES, searchAnimals } from '../logic.js';
import { animalRow, empty, breedingHeadline } from '../components.js';
import { editAnimal } from '../actions.js';
import { t } from '../i18n.js';

const state = { tab: 'active', filter: '', type: '' };

export function herdView() {
  const all = D().animals;
  let list = all.filter((a) => (state.tab === 'active' ? isActive(a) : !isActive(a)));
  if (state.type) list = list.filter((a) => a.type === state.type);
  if (state.filter) {
    const ids = new Set(searchAnimals(list, state.filter, { includeArchived: true }).map((a) => a.id));
    list = list.filter((a) => ids.has(a.id) || String(a.group || '').toLowerCase().includes(state.filter.toLowerCase()));
  }
  list.sort((a, b) => String(a.code || a.tag).localeCompare(String(b.code || b.tag), undefined, { numeric: true }));
  const archived = all.filter((a) => !isActive(a)).length;
  return {
    html: html`
    <header class="top"><h1>${t('Herd')}</h1><button type="button" class="btn primary" data-act="add">+ ${t('Add animal')}</button></header>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" class="tab ${state.tab === 'active' ? 'on' : ''}" aria-selected="${state.tab === 'active'}" data-act="tab" data-v="active">${t('On farm')} (${all.length - archived})</button>
      <button type="button" role="tab" class="tab ${state.tab === 'archive' ? 'on' : ''}" aria-selected="${state.tab === 'archive'}" data-act="tab" data-v="archive">${t('Archive')} (${archived})</button>
    </div>
    <div class="filters">
      <input id="herd-filter" type="search" placeholder="${t('Filter by code, tag or group')}" value="${state.filter}" data-filter aria-label="${t('Filter')}">
      <select data-type aria-label="${t('Type')}"><option value="">${t('All types')}</option>${Object.entries(TYPES).map(([k, v]) => html`<option value="${k}" ${state.type === k ? 'selected' : ''}>${t(v)}</option>`)}</select>
    </div>
    ${state.tab === 'archive' ? html`<p class="muted small">${t('Sold, transferred and dead animals. Their full history is kept.')}</p>` : ''}
    <div class="list" data-testid="herd-list">${list.length ? list.map((a) => animalRow(a, isBull(a) ? '' : breedingHeadline(a).main)) : empty(state.tab === 'active' ? 'No animals yet. Add your first animal.' : 'No archived animals.')}</div>`,
    actions: {
      add: () => editAnimal(),
      tab: (d) => { state.tab = d.v; return 'render'; },
    },
    mount(el) {
      const f = el.querySelector('[data-filter]');
      f.addEventListener('input', () => { state.filter = f.value; window.dispatchEvent(new Event('rerender')); });
      f.addEventListener('search', () => { state.filter = f.value; window.dispatchEvent(new Event('rerender')); });
      el.querySelector('[data-type]').addEventListener('change', (e) => { state.type = e.target.value; window.dispatchEvent(new Event('rerender')); });
    },
  };
}
