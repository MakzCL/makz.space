import * as db from './db.js';
import { html, dropSheet, sheetIsOpen, toast } from './ui.js';
import { S, ui } from './store.js';
import { todayView } from './views/today.js';
import { animalView } from './views/animal.js';
import { herdView } from './views/herd.js';
import { breedingView } from './views/breeding.js';
import { milkView } from './views/milk.js';
import { moreView, healthView, bullsView, tasksView, reportsView, settingsView, dataView, helpView, openSettingsForm } from './views/more.js';
import { milkHolds } from './logic.js';
import { D } from './store.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');
let current = null;

function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  const [name, arg] = parts;
  switch (name) {
    case 'today': case '': return ['today', todayView()];
    case 'animal': return ['herd', animalView(arg)];
    case 'herd': return ['herd', herdView()];
    case 'breeding': return ['breeding', breedingView(arg)];
    case 'milk': return ['milk', milkView(arg)];
    case 'more': return ['more', moreView()];
    case 'health': return ['more', healthView()];
    case 'bulls': return ['more', bullsView()];
    case 'tasks': return ['more', tasksView()];
    case 'reports': return ['more', reportsView()];
    case 'settings': return ['more', settingsView()];
    case 'data': return ['more', dataView()];
    case 'help': return ['more', helpView()];
    default: return ['today', todayView()];
  }
}

function renderNav(active) {
  const holds = milkHolds(D()).length;
  const items = [['today', '#/', 'Today'], ['herd', '#/herd', 'Herd'], ['breeding', '#/breeding/awaiting', 'Breeding'], ['milk', '#/milk', 'Milk'], ['more', '#/more', 'More']];
  nav.innerHTML = String(html`${items.map(([k, href, label]) => html`<a href="${href}" class="${active === k ? 'on' : ''}" ${active === k ? html`aria-current="page"` : ''}>
    <span class="nav-ico" aria-hidden="true">${ICONS[k]}</span><span>${label}</span>${k === 'milk' && holds ? html`<span class="dot" aria-label="${holds} milk holds">${holds}</span>` : ''}</a>`)}`);
}

const ICONS = {
  today: '◉', herd: '☰', breeding: '♀', milk: '⛁', more: '⋯',
};

export function render({ scroll = false } = {}) {
  const focusId = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  const y = window.scrollY;
  const [tab, v] = route();
  current = v;
  view.innerHTML = String(v.html);
  renderNav(tab);
  v.mount?.(view);
  updateNet();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el && view.contains(el)) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ } }
  }
  window.scrollTo(0, scroll ? 0 : y);
}

view.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act]');
  if (!t || !current?.actions) return;
  const act = t.dataset.act;
  if (act === 'period') { ui.period = t.dataset.v; render(); return; }
  const fn = current.actions[act];
  if (!fn) return;
  const r = await fn(t.dataset, e);
  if (r === 'render') render();
});
view.addEventListener('change', (e) => {
  const r = e.target.closest('[data-range]');
  if (r) { ui[r.dataset.range] = e.target.value; render(); }
});
window.addEventListener('rerender', () => render());
window.addEventListener('hashchange', () => {
  if (sheetIsOpen()) dropSheet();
  render({ scroll: true });
});

function updateNet() {
  const n = document.querySelector('[data-net]');
  if (!n) return;
  n.textContent = navigator.onLine ? '' : 'Offline · saving on phone';
  n.hidden = navigator.onLine;
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

async function boot() {
  try {
    await db.open();
  } catch (err) {
    view.innerHTML = `<div class="card"><h1>Storage problem</h1><p>${String(err.message || err)}</p><p>Private browsing can block storage. Open the app in a normal window.</p></div>`;
    return;
  }
  let redraw = 0;
  db.onChange(() => { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(() => render()); });
  if (!db.get('settings', 'farm')) {
    const { defaultTimeZone } = await import('./time.js');
    await db.put('settings', { id: 'farm', timeZone: defaultTimeZone(), currency: 'EUR', setupDone: false });
  }
  render();
  if (!S().setupDone) openSettingsForm(true);
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable', err));
  }
  window.__dairyReady = true;
}

window.addEventListener('error', (e) => toast(`Something went wrong: ${e.message}`, { kind: 'err' }));
window.addEventListener('unhandledrejection', (e) => toast(`Could not complete: ${e.reason?.message || e.reason}`, { kind: 'err' }));
boot();
