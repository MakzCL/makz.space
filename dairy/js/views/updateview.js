import { html, toast } from '../ui.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { fmtDateTime } from '../time.js';
import { tz } from '../store.js';
import { updateState, isAndroidApp, checkForUpdate, installUpdate, NeedsPermission } from '../updates.js';
import { lang } from '../i18n.js';

let busy = false;

function notes(latest) {
  const n = latest?.notes;
  if (!n) return '';
  return typeof n === 'string' ? n : (n[lang()] || n.en || '');
}

/** "App version" card for More and Settings. */
export function updateCard() {
  if (!isAndroidApp()) {
    return html`<section class="card update-card"><div class="card-head"><h2 class="card-title">${icon('refresh')}${t('App updates')}</h2></div>
      <p class="muted">${t('This web version updates itself whenever it is opened with signal.')}</p></section>`;
  }
  const s = updateState;
  const cur = s.current;
  let status;
  if (busy) status = html`<p class="update-status busy">${icon('refresh', { cls: 'spin' })}${t('Downloading update…')}</p>`;
  else if (s.available) {
    status = html`<div class="update-new"><p class="update-status new">${icon('download')}${t('Version {v} is ready to install', { v: s.latest.versionName })}</p>
      ${notes(s.latest) ? html`<p class="muted small">${notes(s.latest)}</p>` : ''}
      <button type="button" class="btn primary big" data-act="installUpdate" data-testid="install-update">${icon('download')}${t('Download and install')}</button>
      <p class="muted small">${t('Your records stay on the phone. Android asks you to confirm the update.')}</p></div>`;
  } else if (s.error) status = html`<p class="update-status warn">${s.error === 'offline' ? t('No signal — try again later.') : t('Could not check: {m}', { m: s.error })}</p>`;
  else if (s.checkedAt) status = html`<p class="update-status ok">${icon('checkCircle')}${t('You have the latest version.')}</p>`;
  else status = '';
  return html`<section class="card update-card" data-testid="update-card"><div class="card-head"><h2 class="card-title">${icon('refresh')}${t('App updates')}</h2>
    <span class="muted small">${cur ? t('Version {v}', { v: cur.versionName }) : ''}</span></div>
    ${status}
    ${!s.available && !busy ? html`<button type="button" class="btn" data-act="checkUpdate" data-testid="check-update">${icon('refresh', { size: 20 })}${t('Check for updates')}</button>` : ''}
    ${s.checkedAt ? html`<p class="muted small">${t('Last checked {d}', { d: fmtDateTime(s.checkedAt, tz()) })}</p>` : ''}</section>`;
}

/** Shown on Today when an update is waiting. */
export function updateBanner() {
  if (!updateState.available) return '';
  return html`<a class="update-banner" href="#/more">${icon('download')}<span>${t('Version {v} is ready to install', { v: updateState.latest.versionName })}</span>${icon('chevron')}</a>`;
}

const rerender = () => window.dispatchEvent(new Event('rerender'));

export const updateActions = {
  async checkUpdate() {
    await checkForUpdate();
    rerender();
  },
  async installUpdate() {
    if (busy) return;
    busy = true; rerender();
    try {
      await installUpdate();
    } catch (err) {
      if (err instanceof NeedsPermission) {
        toast(t('Allow “Install unknown apps” for Dairy Herd, come back, and tap Download and install again.'), { ms: 9000 });
      } else toast(t('Update failed: {m}', { m: err.message }), { kind: 'err', ms: 8000 });
    } finally {
      busy = false; rerender();
    }
  },
};
