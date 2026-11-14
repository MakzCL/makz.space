/**
 * Bridge to the SEND Android and iOS apps (push notifications).
 * Android: the app exposes `SENDNative` (an origin-restricted WebMessage listener); replies arrive as its `onmessage`.
 * iOS: the page posts to `webkit.messageHandlers.sendNative`; the app answers by calling `window.__sendNativePush`.
 * The app hands over its push token; the page registers it with the server using the signed-in session.
 */
import { api } from "./api.ts";
import { inAndroidApp, inIosApp } from "./mobile.ts";

type Reply = { type: "push:token"; platform: "android" | "ios"; token: string; sandbox?: boolean; version?: string }
  | { type: "push:denied" } | { type: "push:unavailable" };

const TOKEN_KEY = "send.native-push.token";
const w = window as unknown as {
  SENDNative?: { postMessage: (m: string) => void; onmessage: ((e: { data: string }) => void) | null };
  webkit?: { messageHandlers?: { sendNative?: { postMessage: (m: unknown) => void } } };
  __sendNativePush?: (r: Reply) => void;
};
export const inNativeApp = inAndroidApp || inIosApp;
const listeners = new Set<(r: Reply) => void>();

async function onReply(r: Reply) {
  if (r.type === "push:token" && r.token) {
    try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* storage may be blocked */ }
    await api.post("/api/push/devices", { platform: r.platform, token: r.token, sandbox: !!r.sandbox, app_version: r.version }).catch(() => {});
  }
  listeners.forEach((l) => l(r));
}
if (inAndroidApp && w.SENDNative) w.SENDNative.onmessage = (e) => { try { void onReply(JSON.parse(e.data)); } catch { /* ignore */ } };
if (inIosApp) w.__sendNativePush = (r) => void onReply(r);

function post(type: string) {
  if (inAndroidApp) w.SENDNative?.postMessage(JSON.stringify({ type }));
  else if (inIosApp) w.webkit?.messageHandlers?.sendNative?.postMessage({ type });
}
export const nativeBridgeReady = () => (inAndroidApp ? !!w.SENDNative : inIosApp ? !!w.webkit?.messageHandlers?.sendNative : false);

/** Ask the app for notification permission and its push token; resolves with what happened. */
export function enableNativePush(timeoutMs = 60_000): Promise<Reply["type"]> {
  if (!nativeBridgeReady()) return Promise.resolve("push:unavailable");
  return new Promise((resolve) => {
    const done = (r: Reply) => { listeners.delete(done); clearTimeout(t); resolve(r.type); };
    const t = setTimeout(() => { listeners.delete(done); resolve("push:unavailable"); }, timeoutMs);
    listeners.add(done);
    post("push:enable");
  });
}
/** Quietly refresh the token after sign-in (no permission prompt if it was never granted). */
export function syncNativePush() { if (nativeBridgeReady()) post("push:sync"); }
export async function disableNativePush() {
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  if (token) await api.del("/api/push/devices", { token }).catch(() => {});
}
export const nativePushRegistered = () => { try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; } };
