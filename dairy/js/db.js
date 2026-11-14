// IndexedDB storage with an in-memory mirror. Every write is committed to
// IndexedDB before the mirror changes, so what the screen shows is what is
// on the phone.

const DB_NAME = 'dairy-herd';
const VERSION = 1;
export const STORES = [
  'settings', 'animals', 'events', 'exposures', 'tasks', 'milk', 'milkDays',
  'buyers', 'collections', 'statements', 'quality', 'meta',
];

let idb = null;
let actor = null;
/** Name of the logged-in person, stamped on new records. */
export function setActor(name) { actor = name; }
const mem = {};
const listeners = new Set();

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

export async function open() {
  idb = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Close other Dairy Herd tabs and reload'));
  });
  const tx = idb.transaction(STORES, 'readonly');
  await Promise.all(STORES.map(async (s) => {
    const rows = await req(tx.objectStore(s).getAll());
    mem[s] = new Map(rows.map((r) => [r.id, r]));
  }));
}

export const all = (s) => [...mem[s].values()];
export const get = (s, id) => mem[s].get(id);
export const count = (s) => mem[s].size;

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

/**
 * Apply several writes in one transaction: [{store, put: rec} | {store, del: id}]
 */
export async function write(ops) {
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = idb.transaction(stores, 'readwrite');
  const now = new Date().toISOString();
  for (const o of ops) {
    if (o.put) {
      o.put.updatedAt = now;
      if (!o.put.createdAt) { o.put.createdAt = now; if (actor && o.store !== 'settings' && o.store !== 'meta') o.put.createdBy = actor; }
      tx.objectStore(o.store).put(o.put);
    } else tx.objectStore(o.store).delete(o.del);
  }
  await txDone(tx);
  for (const o of ops) {
    if (o.put) mem[o.store].set(o.put.id, structuredClone(o.put));
    else mem[o.store].delete(o.del);
  }
  emit();
}

export const put = (store, rec) => write([{ store, put: rec }]);
export const del = (store, id) => write([{ store, del: id }]);

export function dump() {
  const out = {};
  for (const s of STORES) out[s] = all(s);
  return out;
}

/** Replace everything (restore). */
export async function replaceAll(data) {
  const tx = idb.transaction(STORES, 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    os.clear();
    for (const r of data[s] || []) os.put(r);
  }
  await txDone(tx);
  for (const s of STORES) mem[s] = new Map((data[s] || []).map((r) => [r.id, r]));
  emit();
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
