import { html, raw, openForm, openSheet, toast } from '../ui.js';
import { S, D } from '../store.js';
import { t } from '../i18n.js';
import { isAdmin, currentUser, createJoinedUser } from '../auth.js';
import * as sync from '../sync.js';
import { fmtDateTime } from '../time.js';
import { icon } from '../icons.js';
import { WEB_URL } from '../config.js';
import qrcode from '../vendor/qrcode.js';

export function deviceLabel(name = currentUser()?.name) {
  const ua = navigator.userAgent;
  const kind = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : 'Computer';
  return [name, kind].filter(Boolean).join(' · ');
}

const hhmm = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '');
export const inviteLink = (code) => `${WEB_URL}/join?c=${encodeURIComponent(code)}`;
const prettyCode = (c) => String(c).replace(/(.{4})(.{4})(.{2})/, '$1-$2-$3');

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

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return raw(q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }));
}

async function share(title, text, url) {
  try {
    if (window.Capacitor?.isNativePlatform?.()) { await window.Capacitor.nativePromise('Share', 'share', { title, text, url, dialogTitle: title }); return; }
    if (navigator.share) { await navigator.share({ title, text, url }); return; }
  } catch (err) { if (/cancel|abort/i.test(err?.message || err?.name || '')) return; }
  await copy(url);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('Link copied')); } catch { prompt(t('Copy this link:'), text); }
}

// ---------- joining ----------

/**
 * Join a farm with an invite: the code makes this phone part of the farm,
 * then the person creates their own login (or uses the one they have).
 */
export function joinForm({ fromGate = false, code = '', onDone } = {}) {
  let joined = null; // keeps the join if creating the login fails (e.g. name taken)
  openForm({
    title: 'Join a farm',
    header: html`<div class="join-info" data-join-info>${code ? html`<p class="muted">${t('Checking the invite…')}</p>` : html`<p class="lead">${t('Ask the farm admin for an invite link or code: More → Sync & phones → Invite a phone.')}</p>`}</div>`,
    values: { code, existing: false },
    submitLabel: 'Join farm',
    fields: [
      { name: 'code', label: 'Invite code', required: true, placeholder: 'ABCD-EFGH-JK' },
      { name: 'existing', label: 'I already have a login on this farm (new phone)', type: 'checkbox' },
      { type: 'heading', label: 'Your account', showIf: { name: 'existing', is: [false] } },
      { name: 'name', label: 'Your name', showIf: { name: 'existing', is: [false] } },
      { name: 'pin', label: 'PIN or password (at least 4)', type: 'password', showIf: { name: 'existing', is: [false] } },
      { name: 'pin2', label: 'Repeat PIN or password', type: 'password', showIf: { name: 'existing', is: [false] } },
      { name: 'phone', label: 'Phone number (for calls)', inputmode: 'tel', showIf: { name: 'existing', is: [false] } },
      { name: 'label', label: "This phone's name", detail: true, help: 'Shown in the list of phones, e.g. “Tom’s phone”.' },
    ],
    onMount(el, form) {
      const box = el.querySelector('[data-join-info]');
      const show = async (c) => {
        if (!c || c.replace(/[^A-Za-z0-9]/g, '').length < 10) return;
        try {
          const info = await sync.inviteInfo(c);
          box.innerHTML = String(info.valid
            ? html`<div class="invite-hello">${icon('herd')}<div><strong>${info.farm_name || t('the farm')}</strong>
              <span>${t(info.role === 'admin' ? 'You are invited as an admin' : 'You are invited as a worker')}</span></div></div>`
            : html`<p class="form-error">${t('That code is wrong, used or expired.')}</p>`);
        } catch { box.innerHTML = String(html`<p class="muted small">${t('Joining needs an internet connection.')}</p>`); }
      };
      show(code);
      form.querySelector('[name=code]').addEventListener('change', (e) => show(e.target.value));
    },
    async onSubmit(v) {
      if (!navigator.onLine) throw new Error(t('Joining needs an internet connection.'));
      if (!v.existing) {
        if (!v.name) throw new Error(t('{label} is required.', { label: t('Your name') }));
        if (!v.pin || v.pin.length < 4) throw new Error(t('Use at least 4 characters or digits.'));
        if (v.pin !== v.pin2) throw new Error(t('The two entries do not match.'));
      }
      if (!joined) {
        const hasRecords = D().animals.length || D().milk.length || D().events.length;
        if (!fromGate && hasRecords && !confirm(t('The records on this phone will be replaced by the farm’s records. Continue?'))) return { msg: false };
        try {
          joined = await sync.joinFarm(v.code, v.label || deviceLabel(v.name || ''));
        } catch (err) {
          throw new Error(/invite/i.test(err.message) ? t('That code is wrong, used or expired.') : t('Could not join: {m}', { m: err.message }));
        }
      }
      if (!v.existing) await createJoinedUser(v.name, v.pin, v.pin2, joined.role, v.phone);
      try { sessionStorage.removeItem('dairy-join'); } catch { /* ignore */ }
      setTimeout(() => onDone?.(), 0);
      return t('Joined {f}', { f: joined.farmName || sync.config()?.farmName || t('the farm') });
    },
  });
}

// ---------- inviting ----------

export function inviteForm() {
  openForm({
    title: 'Invite a phone',
    header: html`<p class="lead">${t('Make a link for a new person. It downloads the app and lets them create their own login.')}</p>`,
    values: { role: 'worker', hours: '48', uses: '1' },
    submitLabel: 'Create invite link',
    fields: [
      { name: 'note', label: 'Who is it for?', placeholder: 'e.g. Tomek' },
      { name: 'role', label: 'Access', type: 'choice', options: [['worker', 'Worker — records only'], ['admin', 'Admin — also users, settings, backup']] },
      { name: 'hours', label: 'Link works for', type: 'choice', options: [['24', '1 day'], ['48', '2 days'], ['168', '7 days'], ['720', '30 days']] },
      { name: 'uses', label: 'How many people can use it', type: 'choice', options: [['1', 'One person'], ['3', '3 people'], ['10', '10 people']] },
    ],
    async onSubmit(v) {
      let r;
      try {
        r = await sync.createInvite({ role: v.role, hours: +v.hours, uses: +v.uses, note: v.note || '' });
      } catch (err) { throw new Error(err.offline ? t('Needs an internet connection.') : err.message); }
      setTimeout(() => inviteResult(r, v.note), 50);
      return { msg: false };
    },
  });
}

function inviteResult(r, note) {
  const link = inviteLink(r.code);
  const farm = sync.config()?.farmName || S().farmName || 'Dairy Herd';
  const text = t('Join {f} on Dairy Herd: download the app and use code {c}.', { f: farm, c: prettyCode(r.code) });
  openSheet(t('Invite ready'), html`
    <div class="invite" data-testid="invite-result">
      ${note ? html`<p class="invite-for">${t('For {n}', { n: note })}</p>` : ''}
      <div class="qr" aria-label="${t('QR code for the invite link')}">${qrSvg(link)}</div>
      <p class="muted small">${t('Scan with the new phone’s camera, or send the link.')}</p>
      <p class="invite-code" data-testid="invite-code">${prettyCode(r.code)}</p>
      <p class="invite-link" data-testid="invite-link">${link}</p>
      <p class="muted small">${t(r.role === 'admin' ? 'Admin' : 'Worker')} · ${t('works until {d}', { d: fmtDateTime(r.expires_at, S().timeZone) })} · ${t('{n} people', { n: r.max_uses })}</p>
    </div>
    <div class="photo-actions">
      <button type="button" class="btn primary big" data-share>${icon('move')}${t('Share link')}</button>
      <button type="button" class="btn big" data-copy>${t('Copy link')}</button>
    </div>`, {
    onMount(el) {
      el.querySelector('[data-share]').onclick = () => share(t('Dairy Herd invite'), text, link);
      el.querySelector('[data-copy]').onclick = () => copy(link);
      window.dispatchEvent(new Event('rerender'));
    },
  });
}

// ---------- screen ----------

export function syncView() {
  const c = sync.config();
  const s = statusText();
  const admin = isAdmin();
  if (!c) {
    return {
      html: html`<header class="top"><h1>${t('Sync & phones')}</h1></header>
      <section class="card"><p class="sync-state off">${s.text}</p>
        <p>${t('Turn on sync to share this farm with other phones. Every phone keeps working with no signal and catches up when it has one; changes show on the other phones within seconds.')}</p>
        ${admin ? html`<button type="button" class="btn primary big" data-act="start" data-testid="sync-start">${icon('cloud')}${t('Share this farm online')}</button>` : html`<p class="muted">${t('Only an admin can turn on sync.')}</p>`}
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
      <button type="button" class="btn" data-act="now">${icon('refresh', { size: 20 })}${t('Sync now')}</button>
    </section>
    ${admin ? html`<section class="card"><div class="card-head"><h2 class="card-title">${icon('phone')}${t('Invite a phone')}</h2></div>
      <p class="muted">${t('Make a link for a new person. It downloads the app and lets them create their own login.')}</p>
      <button type="button" class="btn primary big" data-act="invite" data-testid="invite">${icon('plus')}${t('Invite a phone')}</button>
      <div data-invites></div></section>
    <section class="card"><h2 class="h2">${t('Phones on this farm')}</h2>
      <div data-devices><p class="muted">${t('Loading…')}</p></div></section>
    <section class="card"><h2 class="h2">${t('Stop syncing')}</h2>
      <p class="muted">${t('This phone keeps its records but stops sharing. Other phones are not affected.')}</p>
      <button type="button" class="btn danger" data-act="disconnect">${t('Stop syncing on this phone')}</button></section>` : ''}`,
    actions: {
      now: () => sync.syncNow(),
      invite: () => inviteForm(),
      async revokeInvite(d) {
        if (!confirm(t('Cancel this invite? The link will stop working.'))) return;
        await sync.revokeInvite(d.id);
        toast(t('Invite cancelled'));
        window.dispatchEvent(new Event('rerender'));
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
      const inv = el.querySelector('[data-invites]');
      if (!box) return;
      try {
        const [list, invites] = await Promise.all([sync.devices(), sync.listInvites()]);
        box.innerHTML = String(html`<ul class="plain">${list.map((x) => html`<li class="device"><span class="device-ico">${icon('phone', { size: 20 })}</span><span class="device-main"><strong>${x.label || t('Phone')}</strong>${x.this ? ` (${t('this phone')})` : ''}<br>
          <span class="muted small">${x.last_seen ? t('Last seen {d}', { d: fmtDateTime(x.last_seen, S().timeZone) }) : ''}</span></span>
          ${x.this ? '' : html`<button type="button" class="btn small danger" data-act="revoke" data-id="${x.id}" data-label="${x.label}">${t('Remove')}</button>`}</li>`)}</ul>`);
        inv.innerHTML = invites.length ? String(html`<h3 class="section-title">${t('Open invites')}</h3><ul class="plain">${invites.map((x) => html`<li class="device">
          <span class="device-ico">${icon('user', { size: 20 })}</span><span class="device-main"><strong>${x.note || t(x.role === 'admin' ? 'Admin' : 'Worker')}</strong><br>
          <span class="muted small">${t('{u} of {m} used', { u: x.uses, m: x.max_uses })} · ${t('works until {d}', { d: fmtDateTime(x.expires_at, S().timeZone) })}</span></span>
          <button type="button" class="btn small ghost" data-act="revokeInvite" data-id="${x.id}">${t('Cancel')}</button></li>`)}</ul>`) : '';
      } catch (err) {
        box.innerHTML = String(html`<p class="muted">${err.offline ? t('Connect to the internet to see the phones.') : err.message}</p>`);
      }
    },
  };
}
