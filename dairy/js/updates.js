// App updates for the Android app.
// latest.json (published next to each APK) says which version is newest.
// The Android app compares it with its own version and, when asked, downloads
// the APK, checks its SHA-256 and opens Android's installer (AppUpdaterPlugin).
// The web version updates itself through the service worker.
import { SYNC_URL } from './config.js';

export const LATEST_URL = `${SYNC_URL}/storage/v1/object/public/dairy-app/releases/latest.json`;
const CHECK_KEY = 'dairy-update-check';
const listeners = new Set();
export const updateState = { latest: null, current: null, available: false, checkedAt: null, error: null };

export const isAndroidApp = () => !!window.Capacitor?.isNativePlatform?.() && window.Capacitor?.getPlatform?.() === 'android';
const native = (method, opts = {}) => window.Capacitor.nativePromise('AppUpdater', method, opts);

export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function set(patch) { Object.assign(updateState, patch); for (const fn of listeners) fn(updateState); }

export async function appInfo() {
  if (!isAndroidApp()) return null;
  try { return await native('info'); } catch { return null; } // app built before the updater existed
}

export async function checkForUpdate() {
  const current = await appInfo();
  try {
    const res = await fetch(`${LATEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const latest = await res.json();
    const available = !!(current && latest.versionCode > current.versionCode);
    try { localStorage.setItem(CHECK_KEY, String(Date.now())); } catch { /* ignore */ }
    set({ latest, current, available, checkedAt: new Date().toISOString(), error: null });
  } catch (err) {
    set({ current, error: navigator.onLine ? err.message : 'offline', checkedAt: new Date().toISOString() });
  }
  return updateState;
}

/** Quiet check when the app opens, at most once every 12 hours. */
export function autoCheck() {
  if (!isAndroidApp() || !navigator.onLine) return;
  let last = 0;
  try { last = +localStorage.getItem(CHECK_KEY) || 0; } catch { /* ignore */ }
  if (Date.now() - last > 12 * 3600 * 1000) setTimeout(checkForUpdate, 4000);
}

export class NeedsPermission extends Error {}

/** Download and open the installer. Throws NeedsPermission the first time. */
export async function installUpdate() {
  const { latest } = updateState;
  if (!latest) throw new Error('No update found');
  const info = await native('info');
  if (!info.canInstall) {
    await native('openInstallSettings');
    throw new NeedsPermission();
  }
  await native('downloadAndInstall', { url: latest.url, sha256: latest.sha256 });
}
