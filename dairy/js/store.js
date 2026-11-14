// App-wide data snapshot (rebuilt after any write) and record helpers.
import * as db from './db.js';
import { settingsOf } from './logic.js';
import { toast } from './ui.js';

let cache = null;
db.onChange(() => { cache = null; });

export function D() {
  if (!cache) {
    cache = { settings: db.get('settings', 'farm') || null };
    for (const s of db.STORES) if (s !== 'settings' && s !== 'meta') cache[s] = db.all(s);
  }
  return cache;
}
export const S = () => settingsOf(D());
export const tz = () => S().timeZone;
export const animal = (id) => db.get('animals', id);
export const bulls = () => D().animals.filter((a) => a.type === 'bull');

export async function saveSettings(patch) {
  await db.put('settings', { ...S(), ...patch, id: 'farm' });
}

/** Save with undo for deletes. */
export async function removeWithUndo(store, rec, label = 'Record deleted', extraOps = [], undoOps = []) {
  await db.write([{ store, del: rec.id }, ...extraOps]);
  toast(label, { action: { label: 'Undo', fn: () => db.write([{ store, put: rec }, ...undoOps]) } });
}

export function notFuture(iso, what = 'date') {
  if (iso && Date.parse(iso) > Date.now() + 10 * 60000) throw new Error(`The ${what} is in the future. Check the date and time.`);
}

export function distinct(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}
export const groups = () => distinct(D().animals.map((a) => a.group));

// ---------- session UI state ----------
import { todayKey as _today, addDays as _add } from './time.js';
export const ui = { period: '30', from: null, to: null, query: '', kb: 'numeric' };

export function periodRange() {
  const t = _today(tz());
  if (ui.period === 'custom' && ui.from && ui.to) return { from: ui.from, to: ui.to, label: 'Custom' };
  if (ui.period === 'month') return { from: `${t.slice(0, 8)}01`, to: t, label: 'This month' };
  const n = +ui.period || 30;
  return { from: _add(t, -(n - 1)), to: t, label: `Last ${n} days` };
}
