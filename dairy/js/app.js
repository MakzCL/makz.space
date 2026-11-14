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
import { t, setLang, detectLang } from './i18n.js';
import { currentUser, hasUsers, isAdmin, resumeSession, showLogin, startIdleWatch, createOwnerForm } from './auth.js';
import { usersView } from './views/users.js';
import { syncView, joinForm, statusText } from './views/syncview.js';
import { startSync, onStatus } from './sync.js';

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
    case 'settings': return ['more', isAdmin() ? settingsView() : adminOnly()];
    case 'data': return ['more', isAdmin() ? dataView() : adminOnly()];
    case 'users': return ['more', usersView()];
    case 'sync': return ['more', syncView()];
    case 'help': return ['more', helpView()];
    default: return ['today', todayView()];
  }
}

function adminOnly() {
  return { html: html`<header class="top"><h1>${t('Admin only')}</h1></header><p>${t('Only an admin can open this. Ask the farm owner.')}</p><a class="btn" href="#/more">${t('Back')}</a>` };
}

let gateOpen = false;
/** Nothing from the herd is drawn until someone is logged in. */
async function gate() {
  if (gateOpen) return;
  gateOpen = true;
  dropSheet();
  nav.hidden = true;
  if (!hasUsers()) {
    view.innerHTML = String(html`<section class="login"><img src="icons/icon.svg" alt="" class="login-logo" width="72" height="72"><h1>Dairy Herd</h1>
      <p>${t('Set up a login before using the app.')}</p>
      <button type="button" class="btn primary big" data-setup data-testid="gate-new">${t('Start a new farm')}</button>
      <button type="button" class="btn big" data-join data-testid="gate-join">${t('Join a farm with a code')}</button></section>`);
    const open = () => (S().setupDone ? createOwnerForm({ onDone: unlock }) : openSettingsForm(true, {}, unlock));
    view.querySelector('[data-setup]').onclick = open;
    view.querySelector('[data-join]').onclick = () => joinForm({ fromGate: true, onDone: () => { gateOpen = false; gate(); } });
    return;
  }
  await showLogin(view);
  unlock();
}
function unlock() {
  gateOpen = false;
  nav.hidden = false;
  render({ scroll: true });
}
window.addEventListener('locked', () => { document.getElementById('toast')?.classList.remove('show'); gateOpen = false; gate(); });

function renderNav(active) {
  const holds = milkHolds(D()).length;
  const items = [['today', '#/', 'Today'], ['herd', '#/herd', 'Herd'], ['breeding', '#/breeding/awaiting', 'Breeding'], ['milk', '#/milk', 'Milk'], ['more', '#/more', 'More']];
  nav.setAttribute('aria-label', t('Main'));
  nav.innerHTML = String(html`${items.map(([k, href, label]) => html`<a href="${href}" class="${active === k ? 'on' : ''}" ${active === k ? html`aria-current="page"` : ''}>
    <span class="nav-ico" aria-hidden="true">${ICONS[k]}</span><span>${t(label)}</span>${k === 'milk' && holds ? html`<span class="dot" aria-label="${t('{n} milk holds', { n: holds })}">${holds}</span>` : ''}</a>`)}`);
}

const ICONS = {
  today: '◉', herd: '☰', breeding: '♀', milk: '⛁', more: '⋯',
};

export function render({ scroll = false } = {}) {
  if (!currentUser()) { gate(); return; }
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
  n.textContent = navigator.onLine ? '' : t('Offline · saving on phone');
  n.hidden = navigator.onLine;
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

async function boot() {
  setLang(detectLang());
  try {
    await db.open();
  } catch (err) {
    view.innerHTML = `<div class="card"><h1>${t('Storage problem')}</h1><p>${String(err.message || err)}</p><p>${t('Private browsing can block storage. Open the app in a normal window.')}</p></div>`;
    return;
  }
  let redraw = 0;
  db.onChange(() => { cancelAnimationFrame(redraw); redraw = requestAnimationFrame(() => render()); });
  if (!db.get('settings', 'farm')) {
    const { defaultTimeZone } = await import('./time.js');
    await db.put('settings', { id: 'farm', timeZone: defaultTimeZone(), currency: detectLang() === 'pl' ? 'PLN' : 'EUR', language: detectLang(), setupDone: false });
  }
  let savedLang = null;
  try { savedLang = localStorage.getItem('dairy-lang'); } catch { /* ignore */ }
  setLang(savedLang || S().language || detectLang());
  startIdleWatch();
  resumeSession();
  startSync();
  onStatus(() => {
    const s = statusText();
    for (const el of document.querySelectorAll('[data-testid=sync-pill]')) { el.className = `sync-pill ${s.cls}`; el.textContent = s.text; }
  });
  render();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor?.isNativePlatform?.()) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline mode unavailable', err));
  }
  window.__dairyReady = true;
}

/** Android app: status bar icons dark on the light page, light in dark mode. */
function systemBarStyle() {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  window.Capacitor.nativePromise('SystemBars', 'setStyle', { style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
}
systemBarStyle();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', systemBarStyle);

window.addEventListener('error', (e) => toast(t('Something went wrong: {m}', { m: e.message }), { kind: 'err' }));
window.addEventListener('unhandledrejection', (e) => toast(t('Could not complete: {m}', { m: e.reason?.message || e.reason }), { kind: 'err' }));
boot();
