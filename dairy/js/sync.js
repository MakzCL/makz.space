// Online sync: every phone keeps its own full copy (works with no signal) and
// swaps changes with the farm's server when it can.
//   push  - upload the outbox
//   pull  - download changes since the last one seen
//   live  - after uploading, a phone sends a "changed" ping on the farm's
//           realtime channel; the other phones pull straight away.
//           A timer also checks every 30 s in case a ping is missed.
import * as db from './db.js';
import { SYNC_URL, SYNC_KEY } from './config.js';

const listeners = new Set();
export const state = { status: 'off', error: null, lastSync: null, live: false };

export const config = () => db.get('meta', 'sync') || null;
export const isConnected = () => !!config();
export const pendingCount = () => db.outbox().length;
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function set(patch) { Object.assign(state, patch); for (const fn of listeners) fn(state); }

async function rpc(fn, args) {
  if (!SYNC_URL) throw new Error('Sync server not configured');
  const headers = { apikey: SYNC_KEY, 'Content-Type': 'application/json' };
  if (SYNC_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SYNC_KEY}`;
  let res;
  try {
    res = await fetch(`${SYNC_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch {
    const e = new Error('No connection'); e.offline = true; throw e;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(body.message || res.statusText);
    e.code = body.code;
    throw e;
  }
  return body;
}

// ---------- connect / disconnect ----------

async function saveConfig(c) { await db.putMeta({ id: 'sync', ...c }); }

/** Put this phone's farm online. Uploads everything already on the phone. */
export async function startFarm(farmName, label) {
  const r = await rpc('dairy_create_farm', { p_name: farmName || '', p_label: label });
  await saveConfig({ farmId: r.farm_id, farmName: r.farm_name, topic: r.topic, deviceId: r.device_id, token: r.token, lastSeq: 0, label });
  await db.queueEverything();
  connectLive();
  await syncNow();
}

/** Join a farm with an invite code. Replaces the farm records on this phone. */
export async function joinFarm(code, label) {
  const r = await rpc('dairy_join', { p_code: code, p_label: label });
  await db.clearFarmData();
  await saveConfig({ farmId: r.farm_id, farmName: r.farm_name, topic: r.topic, deviceId: r.device_id, token: r.token, lastSeq: 0, label });
  connectLive();
  await syncNow({ throwErrors: true });
}

/** Stop syncing on this phone. Records stay on the phone. */
export async function disconnect() {
  closeLive();
  await db.delMeta('sync');
  await db.clearOutbox();
  set({ status: 'off', error: null, live: false });
}

export async function createInvite() {
  return rpc('dairy_create_invite', { p_token: config().token });
}
export async function devices() {
  return rpc('dairy_devices', { p_token: config().token });
}
export async function revokeDevice(id) {
  return rpc('dairy_revoke_device', { p_token: config().token, p_device: id });
}

// ---------- push / pull ----------

let running = false;
let again = false;

export async function syncNow({ throwErrors = false } = {}) {
  if (!config()) return;
  if (running) { again = true; return; }
  running = true;
  set({ status: 'syncing' });
  try {
    let pushed = 0;
    for (;;) {
      // Up to 400 changes, but keep each upload under ~1 MB (photos are ~25 KB each).
      const all = db.pendingChanges(400);
      if (!all.length) break;
      const batch = [];
      let bytes = 0;
      for (const c of all) {
        const size = c.data ? JSON.stringify(c.data).length : 100;
        if (batch.length && bytes + size > 1_000_000) break;
        batch.push(c); bytes += size;
      }
      await rpc('dairy_push', {
        p_token: config().token,
        p_changes: batch.map(({ store, id, data, deleted, updated_at }) => ({ store, id, data, deleted, updated_at })),
      });
      await db.clearSent(batch);
      pushed += batch.length;
      if (batch.length === all.length && all.length < 400) break;
    }
    for (;;) {
      const c = config();
      const r = await rpc('dairy_pull', { p_token: c.token, p_since: c.lastSeq || 0, p_limit: 300 });
      if (r.rows.length) await db.applyRemote(r.rows);
      const last = r.rows.length ? r.rows[r.rows.length - 1].seq : c.lastSeq;
      if (last !== c.lastSeq || r.farm_name !== c.farmName) await saveConfig({ ...config(), lastSeq: last, farmName: r.farm_name });
      if (r.rows.length < 300) break;
    }
    if (pushed) ping();
    set({ status: 'synced', error: null, lastSync: new Date().toISOString() });
  } catch (err) {
    if (err.code === '28000') set({ status: 'removed', error: err.message });
    else set({ status: err.offline || !navigator.onLine ? 'offline' : 'error', error: err.message });
    if (throwErrors) throw err;
  } finally {
    running = false;
    if (again) { again = false; setTimeout(syncNow, 50); }
  }
}

let timer = 0;
function schedule(ms = 600) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
}

// ---------- live channel (Supabase Realtime broadcast, raw Phoenix protocol) ----------

let ws = null;
let hb = 0;
let ref = 0;
let retry = 1000;
let closing = false;

const topicName = () => `realtime:dairy-${config()?.topic}`;
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify({ ...msg, ref: String(++ref) })); }

function connectLive() {
  if (!config() || !SYNC_URL || typeof WebSocket === 'undefined') return;
  if (ws && ws.readyState <= 1) return;
  closing = false;
  ws = new WebSocket(`${SYNC_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SYNC_KEY)}&vsn=1.0.0`);
  ws.onopen = () => {
    retry = 1000;
    send({ topic: topicName(), event: 'phx_join', payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false } } });
    clearInterval(hb);
    hb = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {} }), 25000);
  };
  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.event === 'phx_reply' && msg.topic === topicName() && msg.payload?.status === 'ok') set({ live: true });
    if (msg.event === 'broadcast' && msg.payload?.event === 'changed') schedule(200);
  };
  ws.onclose = () => {
    clearInterval(hb);
    set({ live: false });
    if (!closing && config()) { setTimeout(connectLive, retry); retry = Math.min(retry * 2, 60000); }
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}

function closeLive() {
  closing = true;
  clearInterval(hb);
  try { ws?.close(); } catch { /* ignore */ }
  ws = null;
}

function ping() {
  send({ topic: topicName(), event: 'broadcast', payload: { type: 'broadcast', event: 'changed', payload: {} } });
}

// ---------- start ----------

export function startSync() {
  db.onLocalChange(() => schedule(500));
  window.addEventListener('online', () => { connectLive(); schedule(100); });
  window.addEventListener('offline', () => set({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { connectLive(); schedule(100); }
  });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);
  if (config()) { connectLive(); schedule(50); }
}
