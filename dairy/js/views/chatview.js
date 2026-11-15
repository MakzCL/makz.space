import { html } from '../ui.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { tz } from '../store.js';
import { dayKey, fmtDow, todayKey, partsIn } from '../time.js';
import { currentUser, users } from '../auth.js';
import * as chat from '../chat.js';
import { startCall, canCall } from '../calls.js';
import * as sync from '../sync.js';

const drafts = {};
let stickToBottom = true;

const time = (iso) => { const p = partsIn(Date.parse(iso), tz()); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };
const avatar = (name, cls = '') => html`<span class="avatar ${cls}">${String(name || '?').slice(0, 1).toUpperCase()}</span>`;

function preview(thread) {
  const list = chat.messages(thread);
  const last = list[list.length - 1];
  if (!last) return t('No messages yet');
  return `${chat.isMine(last) ? `${t('You')}: ` : thread === chat.FARM ? `${last.fromName}: ` : ''}${last.text}`;
}

function callBtn(u) {
  if (!canCall() && !u.phone) return '';
  return html`<button type="button" class="icon-btn call-icon" data-act="call" data-id="${u.id}" aria-label="${t('Call {n}', { n: u.name })}">${icon('phone')}</button>`;
}

function listView() {
  const me = currentUser();
  const people = users().filter((u) => u.id !== me?.id);
  const row = (thread, title, sub, av, extra = '') => {
    const n = chat.unread(thread);
    return html`<div class="chat-row"><a class="chat-link" href="#/chat/${encodeURIComponent(thread)}" data-testid="thread">
      ${av}<span class="chat-main"><strong>${title}</strong><span class="chat-prev">${sub}</span></span>
      ${n ? html`<span class="unread" data-testid="unread">${n}</span>` : ''}</a>${extra}</div>`;
  };
  return {
    html: html`<header class="top"><h1>${t('Chat')}</h1></header>
    ${!sync.isConnected() ? html`<p class="sample-banner">${icon('cloud')}<span>${t('Chat and calls work once the farm is shared online.')} <a href="#/sync">${t('Sync & phones')}</a></span></p>` : ''}
    <div class="list">
      ${row(chat.FARM, t('Whole farm'), preview(chat.FARM), html`<span class="avatar farm">${icon('herd', { size: 22 })}</span>`)}
      ${people.length ? html`<h2 class="section-title">${t('People')}</h2>` : ''}
      ${people.map((u) => row(chat.dmThread(me.id, u.id), u.name, preview(chat.dmThread(me.id, u.id)), avatar(u.name), callBtn(u)))}
      ${!people.length ? html`<p class="muted small">${t('Invite people in More → Sync & phones to chat with them.')}</p>` : ''}
    </div>`,
    actions: { call: (d) => { const u = users().find((x) => x.id === d.id); if (u) startCall(u); } },
  };
}

function threadView(thread) {
  if (!chat.canSee(thread)) return listView();
  const other = chat.threadTitle(thread);
  const list = chat.messages(thread);
  chat.markRead(thread);
  let lastDay = '';
  const body = list.map((m, i) => {
    const day = dayKey(m.at, tz());
    const sep = day !== lastDay ? html`<p class="chat-day">${day === todayKey(tz()) ? t('Today') : fmtDow(day)}</p>` : '';
    lastDay = day;
    const mine = chat.isMine(m);
    const showName = !mine && thread === chat.FARM && list[i - 1]?.fromId !== m.fromId;
    return html`${sep}<div class="msg ${mine ? 'mine' : ''}">${showName ? html`<span class="msg-name">${m.fromName}</span>` : ''}
      <span class="msg-text">${m.text}</span><span class="msg-time">${time(m.at)}</span></div>`;
  });
  return {
    html: html`<div class="chat-head"><a href="#/chat" class="back" aria-label="${t('Back')}">${icon('back')}</a>
      ${other ? avatar(other.name) : html`<span class="avatar farm">${icon('herd', { size: 22 })}</span>`}
      <strong class="chat-title">${other ? other.name : t('Whole farm')}</strong>${other ? callBtn(other) : ''}</div>
    <div class="msgs" data-testid="messages">${list.length ? body : html`<p class="empty">${t('No messages yet')}</p>`}</div>
    <form class="composer" data-composer>
      <textarea id="chat-input" rows="1" placeholder="${t('Message')}" aria-label="${t('Message')}" data-testid="chat-input">${drafts[thread] || ''}</textarea>
      <button type="submit" class="send" aria-label="${t('Send')}" data-testid="chat-send">${icon('chevron', { size: 26 })}</button>
    </form>`,
    actions: { call: (d) => { const u = users().find((x) => x.id === d.id); if (u) startCall(u); } },
    mount(el) {
      document.body.classList.add('in-chat');
      const input = el.querySelector('#chat-input');
      const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };
      input.addEventListener('input', () => { drafts[thread] = input.value; grow(); });
      grow();
      el.querySelector('[data-composer]').addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value;
        if (!text.trim()) return;
        drafts[thread] = '';
        input.value = '';
        stickToBottom = true;
        await chat.send(thread, text);
        input.focus();
      });
      if (stickToBottom) requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
      const onScroll = () => { stickToBottom = window.innerHeight + window.scrollY > document.body.scrollHeight - 120; };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('hashchange', () => { window.removeEventListener('scroll', onScroll); document.body.classList.remove('in-chat'); }, { once: true });
    },
  };
}

export function chatView(arg) {
  document.body.classList.remove('in-chat');
  if (arg) { stickToBottom = true; return threadView(decodeURIComponent(arg)); }
  return listView();
}
