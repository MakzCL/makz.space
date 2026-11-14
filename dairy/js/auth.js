// Login: named users with a PIN or password, stored only as salted PBKDF2 hashes.
// The app shows nothing until someone logs in, and locks again when idle.
import * as db from './db.js';
import { html, openForm, toast } from './ui.js';
import { S, saveSettings } from './store.js';
import { t, lang, setLang } from './i18n.js';
import { icon } from './icons.js';

const ITER = 150000;
const SESSION_KEY = 'dairy-session';
const FAIL_KEY = 'dairy-login-fails';
let current = null;      // { id, name, role }
let lastActive = Date.now();

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashSecret(secret, saltHex, iter = ITER) {
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

async function makeUser(name, secret, role, id = db.uid()) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { id, name: name.trim(), role, salt, iter: ITER, hash: await hashSecret(secret, salt) };
}

export const users = () => S().users || [];
export const hasUsers = () => users().length > 0;
export const currentUser = () => current;
export const isAdmin = () => current?.role === 'admin';
const lockMinutes = () => S().lockMinutes ?? 15;

function checkSecret(secret) {
  if (!secret || secret.length < 4) throw new Error(t('Use at least 4 characters or digits.'));
}

/** Restore a session that is still within the idle limit (survives a reload, not closing the app). */
export function resumeSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    const u = s && users().find((x) => x.id === s.id);
    if (u && Date.now() - s.at < lockMinutes() * 60000) { setCurrent(u); return true; }
  } catch { /* ignore */ }
  return false;
}

function setCurrent(u) {
  current = u ? { id: u.id, name: u.name, role: u.role } : null;
  db.setActor(current?.name || null);
  touch();
}

function touch() {
  lastActive = Date.now();
  try { if (current) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: current.id, at: lastActive })); } catch { /* ignore */ }
}

export function lock() {
  current = null;
  db.setActor(null);
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event('locked'));
}

/** Lock after the idle limit, also when the phone comes back from the background. */
export function startIdleWatch() {
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { if (current) touch(); }, { passive: true });
  const check = () => { if (current && Date.now() - lastActive > lockMinutes() * 60000) lock(); };
  setInterval(check, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}

function failState() {
  try { return JSON.parse(localStorage.getItem(FAIL_KEY) || '{"n":0,"until":0}'); } catch { return { n: 0, until: 0 }; }
}
function setFail(s) { try { localStorage.setItem(FAIL_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

export async function login(userId, secret) {
  const f = failState();
  if (Date.now() < f.until) throw new Error(t('Too many wrong tries. Wait {s} seconds.', { s: Math.ceil((f.until - Date.now()) / 1000) }));
  const u = users().find((x) => x.id === userId);
  if (!u || (await hashSecret(secret || '', u.salt, u.iter)) !== u.hash) {
    const n = f.n + 1;
    setFail({ n, until: n >= 5 ? Date.now() + Math.min(300, 30 * 2 ** (n - 5)) * 1000 : 0 });
    throw new Error(t('Wrong PIN or password.'));
  }
  setFail({ n: 0, until: 0 });
  setCurrent(u);
}

// ---------- screens ----------

function langChips() {
  return html`<div class="lang center-row" role="group" aria-label="Język / Language">
    <button type="button" class="chip ${lang() === 'en' ? 'on' : ''}" data-lang="en">English</button>
    <button type="button" class="chip ${lang() === 'pl' ? 'on' : ''}" data-lang="pl">Polski</button></div>`;
}

/** Full-screen login. Resolves when someone has logged in. */
export function showLogin(root) {
  return new Promise((resolve) => {
    const draw = (err = '') => {
      const list = users();
      const last = (() => { try { return localStorage.getItem('dairy-last-user'); } catch { return null; } })();
      const sel = list.find((u) => u.id === last)?.id || list[0]?.id;
      root.innerHTML = String(html`<section class="login" aria-labelledby="login-h">
        <img src="icons/icon.svg" alt="" class="login-logo" width="72" height="72">
        <h1 id="login-h">Dairy Herd</h1>
        <p class="farm">${S().farmName || ''}</p>
        <form class="form login-form" novalidate>
          <div class="form-error" role="alert" ${err ? '' : 'hidden'}>${err}</div>
          ${list.length > 1 ? html`<div class="field"><label for="l_user">${t('Who are you?')}</label>
            <select id="l_user" name="user">${list.map((u) => html`<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${u.name}</option>`)}</select></div>`
            : html`<input type="hidden" name="user" value="${sel}"><p class="login-name">${list[0].name}</p>`}
          <div class="field"><label for="l_pin">${t('PIN or password')}</label>
            <input id="l_pin" name="pin" type="password" inputmode="none" autocomplete="current-password" enterkeyhint="go" data-testid="login-pin" class="pin-input"></div>
          <div class="keypad" role="group" aria-label="${t('PIN or password')}">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button type="button" class="key" data-key="${n}">${n}</button>`)}
            <button type="button" class="key key-soft" data-kb aria-label="${t('Use letters')}">${icon('keyboard')}</button>
            <button type="button" class="key" data-key="0">0</button>
            <button type="button" class="key key-soft" data-del aria-label="${t('Delete')}">${icon('backspace')}</button>
          </div>
          <button type="submit" class="btn primary big" data-testid="login-submit">${icon('lock', { size: 20 })}${t('Log in')}</button>
        </form>
        ${langChips()}
        <details class="forgot"><summary>${t('Forgot PIN?')}</summary>
          <p>${t('Ask the farm owner (admin) to reset it in More → Users & login.')}</p>
          <p>${t('If the only admin forgot it, the data cannot be opened. You can erase this device and restore a backup file.')}</p>
          <button type="button" class="btn danger" data-erase>${t('Erase this device…')}</button></details>
      </section>`);
      const form = root.querySelector('form');
      const pin = root.querySelector('#l_pin');
      const pad = root.querySelector('.keypad');
      for (const k of root.querySelectorAll('[data-key]')) {
        k.onclick = () => { pin.value += k.dataset.key; navigator.vibrate?.(8); };
      }
      root.querySelector('[data-del]').onclick = () => { pin.value = pin.value.slice(0, -1); };
      root.querySelector('[data-kb]').onclick = () => {
        // Switch to the phone keyboard for passwords with letters.
        pin.inputMode = 'text';
        pad.hidden = true;
        pin.focus();
      };
      for (const b of root.querySelectorAll('[data-lang]')) b.onclick = () => { setLang(b.dataset.lang); draw(); };
      root.querySelector('[data-erase]').onclick = async () => {
        const word = t('ERASE');
        if (prompt(t('This deletes every record on this device. Type {w} to confirm.', { w: word })) !== word) return;
        await db.replaceAll({});
        try { sessionStorage.clear(); localStorage.removeItem(FAIL_KEY); } catch { /* ignore */ }
        location.reload();
      };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        btn.disabled = true;
        try {
          const id = form.user.value;
          await login(id, pin.value);
          try { localStorage.setItem('dairy-last-user', id); } catch { /* ignore */ }
          resolve(current);
        } catch (err) {
          draw(err.message);
        }
      };
    };
    draw();
  });
}

export async function createFirstOwner(name, pin, pin2) {
  checkSecret(pin);
  if (pin !== pin2) throw new Error(t('The two entries do not match.'));
  const u = await makeUser(name, pin, 'admin');
  await saveSettings({ users: [u] });
  setCurrent(u);
  try { localStorage.setItem('dairy-last-user', u.id); } catch { /* ignore */ }
}

/** First account (owner). Used during setup and for installs from before logins existed. */
export function createOwnerForm({ onDone } = {}) {
  openForm({
    title: 'Create your login',
    header: html`<p class="lead">${t('Only people with a login can open Dairy Herd on this phone. You are the admin: you can add workers later.')}</p>`,
    values: {},
    submitLabel: 'Create login',
    fields: [
      { name: 'name', label: 'Your name', required: true },
      { name: 'pin', label: 'PIN or password (at least 4)', required: true, type: 'password' },
      { name: 'pin2', label: 'Repeat PIN or password', required: true, type: 'password' },
    ],
    async onSubmit(v) {
      checkSecret(v.pin);
      if (v.pin !== v.pin2) throw new Error(t('The two entries do not match.'));
      const u = await makeUser(v.name, v.pin, 'admin');
      await saveSettings({ users: [u] });
      setCurrent(u);
      try { localStorage.setItem('dairy-last-user', u.id); } catch { /* ignore */ }
      onDone?.();
      return t('Login created. Remember your PIN.');
    },
  });
  // Block closing: a login is required.
  document.querySelector('.sheet [data-close]')?.setAttribute('hidden', '');
}

export function userForm(existing) {
  const self = existing && existing.id === current?.id;
  openForm({
    title: existing ? (self ? 'Change my PIN' : 'Edit user') : 'Add user',
    values: existing ? { name: existing.name, role: existing.role } : { role: 'worker' },
    submitLabel: 'Save',
    fields: [
      { name: 'name', label: 'Name', required: true },
      ...(!self ? [{ name: 'role', label: 'Access', type: 'choice', options: [['worker', 'Worker — records only'], ['admin', 'Admin — also users, settings, backup']] }] : []),
      { name: 'pin', label: existing ? 'New PIN or password (leave empty to keep)' : 'PIN or password (at least 4)', type: 'password', required: !existing },
    ],
    async onSubmit(v) {
      if (v.pin) checkSecret(v.pin);
      const list = users().slice();
      const clash = list.find((u) => u.name.toLowerCase() === v.name.trim().toLowerCase() && u.id !== existing?.id);
      if (clash) throw new Error(t('There is already a user called {n}.', { n: v.name }));
      let u;
      if (existing) {
        u = v.pin ? await makeUser(v.name, v.pin, existing.role, existing.id) : { ...existing, name: v.name.trim() };
        if (!self) u.role = v.role;
        if (existing.role === 'admin' && u.role !== 'admin' && !list.some((x) => x.id !== u.id && x.role === 'admin')) throw new Error(t('Keep at least one admin.'));
        list[list.findIndex((x) => x.id === existing.id)] = u;
      } else {
        u = await makeUser(v.name, v.pin, v.role || 'worker');
        list.push(u);
      }
      await saveSettings({ users: list });
      if (self) setCurrent(u);
      return t('User saved');
    },
    onDelete: existing && !self ? async () => {
      const list = users().filter((x) => x.id !== existing.id);
      if (!list.some((x) => x.role === 'admin')) throw new Error(t('Keep at least one admin.'));
      await saveSettings({ users: list });
      toast(t('User removed'));
    } : null,
    deleteLabel: 'Remove user',
    deleteConfirm: 'Remove this user? They will not be able to log in.',
  });
}

export function lockSettingsForm() {
  openForm({
    title: 'Auto-lock',
    values: { lockMinutes: lockMinutes() },
    fields: [{ name: 'lockMinutes', label: 'Lock after this many minutes without use', type: 'number', min: 1, required: true }],
    async onSubmit(v) {
      await saveSettings({ lockMinutes: Math.max(1, Math.min(720, Math.round(v.lockMinutes))) });
      return t('Settings saved');
    },
  });
}
