// Chat: messages are ordinary synced records in the `messages` store.
// thread = 'farm' (everyone) or 'dm:<userA>:<userB>' (two people, ids sorted).
import * as db from './db.js';
import { currentUser, users } from './auth.js';

export const FARM = 'farm';
export const dmThread = (a, b) => `dm:${[a, b].sort().join(':')}`;
export const isMine = (m) => m.fromId === currentUser()?.id;

/** Threads this person can see. */
export function canSee(thread, me = currentUser()) {
  if (thread === FARM) return true;
  return !!me && thread.startsWith('dm:') && thread.split(':').includes(me.id);
}

export function messages(thread) {
  return db.all('messages').filter((m) => m.thread === thread).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export async function send(thread, text) {
  const me = currentUser();
  const body = String(text || '').trim();
  if (!me || !body) return;
  await db.put('messages', { id: db.uid(), thread, fromId: me.id, fromName: me.name, text: body.slice(0, 2000), at: new Date().toISOString() });
}

// ---------- unread ----------
const readKey = () => `dairy-read-${currentUser()?.id || 'x'}`;
function readMap() { try { return JSON.parse(localStorage.getItem(readKey()) || '{}'); } catch { return {}; } }
export function markRead(thread) {
  const list = messages(thread);
  if (!list.length) return;
  const map = readMap();
  map[thread] = list[list.length - 1].at;
  try { localStorage.setItem(readKey(), JSON.stringify(map)); } catch { /* ignore */ }
}
export function unread(thread) {
  const since = readMap()[thread] || '';
  return messages(thread).filter((m) => m.at > since && !isMine(m)).length;
}
export function totalUnread() {
  const me = currentUser();
  if (!me) return 0;
  const threads = new Set(db.all('messages').map((m) => m.thread).filter((th) => canSee(th, me)));
  let n = 0;
  for (const th of threads) n += unread(th);
  return n;
}

/** Name of a thread for this person. */
export function threadTitle(thread) {
  if (thread === FARM) return null;
  const me = currentUser();
  const otherId = thread.split(':').slice(1).find((id) => id !== me?.id);
  return users().find((u) => u.id === otherId) || { id: otherId, name: '?' };
}

// ---------- new-message alerts ----------
let seen = null;
/** Messages that arrived since the last call (from other people, in threads I can see). */
export function newArrivals() {
  const all = db.all('messages');
  if (!seen) { seen = new Set(all.map((m) => m.id)); return []; }
  const fresh = all.filter((m) => !seen.has(m.id));
  for (const m of fresh) seen.add(m.id);
  return fresh.filter((m) => !isMine(m) && canSee(m.thread));
}
