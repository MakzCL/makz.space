// IndexedDB storage with an in-memory mirror. Every write is committed to
// IndexedDB before the mirror changes, so what the screen shows is what is
// on the phone.
//
// Sync: each local change to a farm record also leaves an entry in the
// `outbox` store, in the same transaction, so nothing is lost if the phone
// has no signal or the app is closed before it uploads.

const DB_NAME = 'dairy-herd';
const VERSION = 2;
export const STORES = [
  'settings', 'animals', 'events', 'exposures', 'tasks', 'milk', 'milkDays',
  'buyers', 'collections', 'statements', 'quality', 'meta',
];
/** Stores shared with the other phones of the farm. `meta` stays on this phone. */
export const SYNCED = STORES.filter((s) => s !== 'meta');
const OUTBOX = 'outbox';

let idb = null;
let actor = null;
/** Name of the logged-in person, stamped on new records. */
export function setActor(name) { actor = name; }
const mem = {};
const listeners = new Set();
const localListeners = new Set();

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function txDone(tx) {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Save was interrupted'));
  });
}

const okey = (store, id) => `${store}\u0001${id}`;

export async function open() {
  idb = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of [...STORES, OUTBOX]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Close other Dairy Herd tabs and reload'));
  });
  const tx = idb.transaction([...STORES, OUTBOX], 'readonly');
  await Promise.all([...STORES, OUTBOX].map(async (s) => {
    const rows = await req(tx.objectStore(s).getAll());
    mem[s] = new Map(rows.map((r) => [r.id, r]));
  }));
}

export const all = (s) => [...mem[s].values()];
export const get = (s, id) => mem[s].get(id);
export const count = (s) => mem[s].size;

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Called after a change made on this phone to a synced record. */
export function onLocalChange(fn) { localListeners.add(fn); return () => localListeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

/**
 * Apply several writes in one transaction: [{store, put: rec} | {store, del: id}]
 */
export async function write(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  const synced = ops.some((o) => SYNCED.includes(o.store));
  const tx = idb.transaction(synced ? [...stores, OUTBOX] : stores, 'readwrite');
  const now = new Date().toISOString();
  const outbox = [];
  for (const o of ops) {
    if (o.put) {
      o.put.updatedAt = now;
      if (!o.put.createdAt) { o.put.createdAt = now; if (actor && o.store !== 'settings' && o.store !== 'meta') o.put.createdBy = actor; }
      tx.objectStore(o.store).put(o.put);
    } else tx.objectStore(o.store).delete(o.del);
    if (SYNCED.includes(o.store)) {
      const entry = { id: okey(o.store, o.put ? o.put.id : o.del), store: o.store, rid: o.put ? o.put.id : o.del, at: now };
      tx.objectStore(OUTBOX).put(entry);
      outbox.push(entry);
    }
  }
  await txDone(tx);
  for (const o of ops) {
    if (o.put) mem[o.store].set(o.put.id, structuredClone(o.put));
    else mem[o.store].delete(o.del);
  }
  for (const e of outbox) mem[OUTBOX].set(e.id, e);
  emit();
  if (outbox.length) for (const fn of localListeners) fn();
}

export const put = (store, rec) => write([{ store, put: rec }]);
export const del = (store, id) => write([{ store, del: id }]);

// ---------- sync support ----------

export const outbox = () => all(OUTBOX);

/** Changes waiting to upload, as the server expects them. */
export function pendingChanges(limit = 500) {
  return outbox().slice(0, limit).map((e) => {
    const rec = mem[e.store]?.get(e.rid);
    return rec
      ? { key: e.id, at: e.at, store: e.store, id: e.rid, data: rec, deleted: false, updated_at: rec.updatedAt || e.at }
      : { key: e.id, at: e.at, store: e.store, id: e.rid, data: null, deleted: true, updated_at: e.at };
  });
}

/** Clear outbox entries that were uploaded, unless they changed again meanwhile. */
export async function clearSent(sent) {
  const tx = idb.transaction(OUTBOX, 'readwrite');
  const done = [];
  for (const s of sent) {
    const cur = mem[OUTBOX].get(s.key);
    if (cur && cur.at === s.at) { tx.objectStore(OUTBOX).delete(s.key); done.push(s.key); }
  }
  await txDone(tx);
  for (const k of done) mem[OUTBOX].delete(k);
}

/** Put every farm record in the outbox (first upload of an existing farm). */
export async function queueEverything() {
  const tx = idb.transaction(OUTBOX, 'readwrite');
  const now = new Date().toISOString();
  for (const s of SYNCED) for (const r of mem[s].values()) {
    const e = { id: okey(s, r.id), store: s, rid: r.id, at: now };
    tx.objectStore(OUTBOX).put(e);
    mem[OUTBOX].set(e.id, e);
  }
  await txDone(tx);
}

/**
 * Apply changes downloaded from the server. A record with a newer change
 * still waiting on this phone is left alone; it uploads and wins on the server.
 * Returns how many records changed here.
 */
export async function applyRemote(rows) {
  const tx = idb.transaction(SYNCED, 'readwrite');
  const applied = [];
  for (const r of rows) {
    if (!SYNCED.includes(r.store)) continue;
    const waiting = mem[OUTBOX].get(okey(r.store, r.id));
    if (waiting && Date.parse(waiting.at) > Date.parse(r.updated_at)) continue;
    const local = mem[r.store].get(r.id);
    if (r.deleted) {
      if (!local) continue;
      tx.objectStore(r.store).delete(r.id);
      applied.push([r.store, r.id, null]);
    } else {
      if (local && local.updatedAt && r.data?.updatedAt && local.updatedAt >= r.data.updatedAt) continue;
      tx.objectStore(r.store).put(r.data);
      applied.push([r.store, r.id, r.data]);
    }
  }
  await txDone(tx);
  for (const [s, id, data] of applied) {
    if (data) mem[s].set(id, data); else mem[s].delete(id);
  }
  if (applied.length) emit();
  return applied.length;
}

/** Remove all farm records and pending uploads (before joining another farm). */
export async function clearFarmData() {
  const tx = idb.transaction([...SYNCED, OUTBOX], 'readwrite');
  for (const s of [...SYNCED, OUTBOX]) tx.objectStore(s).clear();
  await txDone(tx);
  for (const s of [...SYNCED, OUTBOX]) mem[s] = new Map();
  emit();
}

/** Write a meta record without counting it as a farm change. */
export async function putMeta(rec) {
  const tx = idb.transaction('meta', 'readwrite');
  tx.objectStore('meta').put(rec);
  await txDone(tx);
  mem.meta.set(rec.id, structuredClone(rec));
}

export async function delMeta(id) {
  const tx = idb.transaction('meta', 'readwrite');
  tx.objectStore('meta').delete(id);
  await txDone(tx);
  mem.meta.delete(id);
}

export async function clearOutbox() {
  const tx = idb.transaction(OUTBOX, 'readwrite');
  tx.objectStore(OUTBOX).clear();
  await txDone(tx);
  mem[OUTBOX] = new Map();
}

// ---------- backup ----------

/** Everything for a backup file. Never includes this phone's sync key. */
export function dump() {
  const out = {};
  for (const s of STORES) out[s] = all(s);
  out.meta = out.meta.filter((m) => m.id !== 'sync');
  return out;
}

/** Replace everything (restore, or erase with {}). */
export async function replaceAll(data) {
  const keep = data.meta ? data.meta.filter((m) => m.id !== 'sync') : [];
  const tx = idb.transaction([...STORES, OUTBOX], 'readwrite');
  for (const s of [...STORES, OUTBOX]) {
    const os = tx.objectStore(s);
    os.clear();
    for (const r of (s === 'meta' ? keep : data[s]) || []) os.put(r);
  }
  await txDone(tx);
  for (const s of STORES) mem[s] = new Map(((s === 'meta' ? keep : data[s]) || []).map((r) => [r.id, r]));
  mem[OUTBOX] = new Map();
  emit();
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
