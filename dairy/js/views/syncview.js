import { html, openForm, toast } from '../ui.js';
import { S, D } from '../store.js';
import { t } from '../i18n.js';
import { isAdmin, currentUser } from '../auth.js';
import * as sync from '../sync.js';
import { fmtDateTime } from '../time.js';

export function deviceLabel(name = currentUser()?.name) {
  const ua = navigator.userAgent;
  const kind = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : 'Computer';
  return [name, kind].filter(Boolean).join(' · ');
}

const hhmm = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');

/** Short status for the header pill. */
export function statusText() {
  if (!sync.isConnected()) return { cls: 'off', text: t('Only on this phone') };
  const n = sync.pendingCount();
  switch (sync.state.status) {
    case 'syncing': return { cls: 'busy', text: t('Syncing…') };
    case 'offline': return { cls: 'warn', text: n ? t('Offline · {n} to send', { n }) : t('Offline · saved on phone') };
    case 'error': return { cls: 'warn', text: t('Sync problem') };
    case 'removed': return { cls: 'warn', text: t('Phone removed from farm') };
    case 'synced': return { cls: 'ok', text: sync.state.live ? t('Live · synced {t}', { t: hhmm(sync.state.lastSync) }) : t('Synced {t}', { t: hhmm(sync.state.lastSync) }) };
    default: return { cls: 'busy', text: t('Connecting…') };
  }
}

export function syncPill() {
  const s = statusText();
  return html`<a href="#/sync" class="sync-pill ${s.cls}" data-testid="sync-pill">${s.text}</a>`;
}

export function joinForm({ fromGate = false, onDone } = {}) {
  openForm({
    title: 'Join a farm',
    header: html`<p class="lead">${t('Ask the farm admin for an invite code: More → Sync & phones → Invite a phone.')}</p>`,
    values: { label: deviceLabel('') },
    submitLabel: 'Join farm',
    fields: [
      { name: 'code', label: 'Invite code', required: true, placeholder: 'ABCD-EFGH-JK' },
      { name: 'label', label: "This phone's name", help: 'Shown in the list of phones, e.g. “Tom’s phone”.' },
    ],
    async onSubmit(v) {
      if (!navigator.onLine) throw new Error(t('Joining needs an internet connection.'));
      const hasRecords = D().animals.length || D().milk.length || D().events.length;
      if (!fromGate && hasRecords && !confirm(t('The records on this phone will be replaced by the farm’s records. Continue?'))) return { msg: false };
      try {
        await sync.joinFarm(v.code, v.label || deviceLabel(''));
      } catch (err) {
        throw new Error(/invite/i.test(err.message) ? t('That code is wrong, used or expired.') : t('Could not join: {m}', { m: err.message }));
      }
      setTimeout(() => onDone?.(), 0);
      return t('Joined {f}', { f: sync.config()?.farmName || t('the farm') });
    },
  });
}

export function syncView() {
  const c = sync.config();
  const s = statusText();
  const admin = isAdmin();
  if (!c) {
    return {
      html: html`<header class="top"><h1>${t('Sync & phones')}</h1></header>
      <section class="card"><p class="sync-state off">${s.text}</p>
        <p>${t('Turn on sync to share this farm with other phones. Every phone keeps working with no signal and catches up when it has one; changes show on the other phones within seconds.')}</p>
        ${admin ? html`<button type="button" class="btn primary big" data-act="start" data-testid="sync-start">${t('Share this farm online')}</button>` : html`<p class="muted">${t('Only an admin can turn on sync.')}</p>`}
      </section>
      <section class="card"><h2 class="h2">${t('Join another phone’s farm')}</h2>
        <p>${t('If the farm already runs on another phone, enter the invite code from that phone.')}</p>
        <button type="button" class="btn" data-act="join">${t('Join with a code')}</button></section>`,
      actions: {
        async start() {
          if (!navigator.onLine) { toast(t('Needs an internet connection.'), { kind: 'err' }); return; }
          try {
            await sync.startFarm(S().farmName, deviceLabel());
            toast(t('This farm is now online'));
          } catch (err) { toast(t('Could not reach the server: {m}', { m: err.message }), { kind: 'err' }); }
          window.dispatchEvent(new Event('rerender'));
        },
        join: () => joinForm(),
      },
    };
  }
  return {
    html: html`<header class="top"><h1>${t('Sync & phones')}</h1></header>
    <section class="card">
      <p class="sync-state ${s.cls}" data-testid="sync-state">${s.text}</p>
      <dl class="kv"><dt>${t('Farm')}</dt><dd>${c.farmName || S().farmName || '—'}</dd>
        <dt>${t('This phone')}</dt><dd>${c.label || ''}</dd>
        <dt>${t('Waiting to send')}</dt><dd>${sync.pendingCount()}</dd>
        <dt>${t('Last synced')}</dt><dd>${sync.state.lastSync ? fmtDateTime(sync.state.lastSync, S().timeZone) : '—'}</dd></dl>
      ${sync.state.error && sync.state.status !== 'synced' ? html`<p class="muted small">${sync.state.error}</p>` : ''}
      <button type="button" class="btn" data-act="now">${t('Sync now')}</button>
    </section>
    ${admin ? html`<section class="card"><h2 class="h2">${t('Phones on this farm')}</h2>
      <button type="button" class="btn primary" data-act="invite" data-testid="invite">${t('Invite a phone')}</button>
      <div data-invite></div>
      <div data-devices><p class="muted">${t('Loading…')}</p></div></section>
    <section class="card"><h2 class="h2">${t('Stop syncing')}</h2>
      <p class="muted">${t('This phone keeps its records but stops sharing. Other phones are not affected.')}</p>
      <button type="button" class="btn danger" data-act="disconnect">${t('Stop syncing on this phone')}</button></section>` : ''}`,
    actions: {
      now: () => sync.syncNow(),
      async invite(d, e) {
        try {
          const r = await sync.createInvite();
          const code = r.code.replace(/(.{4})(.{4})(.{2})/, '$1-$2-$3');
          document.querySelector('[data-invite]').innerHTML = String(html`<div class="invite"><p>${t('On the new phone: install Dairy Herd → Join a farm, and enter:')}</p>
            <p class="invite-code" data-testid="invite-code">${code}</p><p class="muted small">${t('Works once, until {d}.', { d: fmtDateTime(r.expires_at, S().timeZone) })}</p></div>`);
        } catch (err) { toast(err.offline ? t('Needs an internet connection.') : err.message, { kind: 'err' }); }
      },
      async revoke(d) {
        if (!confirm(t('Remove “{n}” from the farm? It will stop receiving and sending records.', { n: d.label }))) return;
        await sync.revokeDevice(d.id);
        toast(t('Phone removed'));
        window.dispatchEvent(new Event('rerender'));
      },
      async disconnect() {
        if (!confirm(t('Stop syncing on this phone?'))) return;
        await sync.disconnect();
        window.dispatchEvent(new Event('rerender'));
      },
    },
    async mount(el) {
      const box = el.querySelector('[data-devices]');
      if (!box) return;
      try {
        const list = await sync.devices();
        box.innerHTML = String(html`<ul class="plain">${list.map((x) => html`<li class="device"><span><strong>${x.label || t('Phone')}</strong>${x.this ? ` (${t('this phone')})` : ''}<br>
          <span class="muted small">${x.last_seen ? t('Last seen {d}', { d: fmtDateTime(x.last_seen, S().timeZone) }) : ''}</span></span>
          ${x.this ? '' : html`<button type="button" class="btn small danger" data-act="revoke" data-id="${x.id}" data-label="${x.label}">${t('Remove')}</button>`}</li>`)}</ul>`);
      } catch (err) {
        box.innerHTML = String(html`<p class="muted">${err.offline ? t('Connect to the internet to see the phones.') : err.message}</p>`);
      }
    },
  };
}
