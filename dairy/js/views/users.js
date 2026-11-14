import { html } from '../ui.js';
import { users, currentUser, isAdmin, userForm, lockSettingsForm } from '../auth.js';
import { S } from '../store.js';
import { t } from '../i18n.js';

export function usersView() {
  const me = currentUser();
  const list = users();
  return {
    html: html`<header class="top"><h1>${t(isAdmin() ? 'Users & login' : 'My PIN')}</h1>${isAdmin() ? html`<button type="button" class="btn primary" data-act="add">+ ${t('Add user')}</button>` : ''}</header>
    <p class="muted">${t('Each person who uses this phone gets their own name and PIN. New records show who entered them.')}</p>
    <div class="list">${(isAdmin() ? list : list.filter((u) => u.id === me.id)).map((u) => html`<button type="button" class="card link-card" data-act="edit" data-id="${u.id}">
      <strong>${u.name}</strong>${u.id === me.id ? ` (${t('you')})` : ''}<br><span class="muted">${t(u.role === 'admin' ? 'Admin' : 'Worker')}</span></button>`)}</div>
    ${isAdmin() ? html`<section class="card"><h2 class="h2">${t('Auto-lock')}</h2><p>${t('Locks after {n} minutes without use, and whenever the app is closed.', { n: S().lockMinutes ?? 15 })}</p>
      <button type="button" class="btn" data-act="lockset">${t('Change')}</button></section>` : ''}
    <p class="muted small">${t('PINs are stored only as a scrambled code (hash). This keeps strangers out of the app; keep backup files private, as they contain the farm records.')}</p>`,
    actions: {
      add: () => userForm(),
      edit: (d) => { const u = list.find((x) => x.id === d.id); if (u && (isAdmin() || u.id === me.id)) userForm(u); },
      lockset: () => lockSettingsForm(),
    },
  };
}
