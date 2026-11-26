import { useRef, useState } from "react";
import { Bell, BellOff, Check } from "lucide-react";
import type { Channel, Guild, NotificationSetting } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { isMutedScope, notifLevel, toast, useStore } from "../store.ts";
import { Popover } from "../components/overlay.tsx";
import { Modal, Toggle } from "../components/ui.tsx";
import { openModal } from "./modals.tsx";
import { disableNativePush, enableNativePush, inNativeApp, nativeBridgeReady, nativePushRegistered } from "../native.ts";
import { inAndroidApp } from "../mobile.ts";

/**
 * Discord-style notification settings: All messages / Only @mentions / Nothing, timed mutes,
 * suppress @everyone and role mentions, hide muted channels; plus Web Push when SEND is closed.
 */

export const MUTE_TIMES: { label: string; minutes: number | null }[] = [
  { label: "For 15 minutes", minutes: 15 }, { label: "For 1 hour", minutes: 60 }, { label: "For 3 hours", minutes: 180 },
  { label: "For 8 hours", minutes: 480 }, { label: "For 24 hours", minutes: 1440 }, { label: "Until I turn it back on", minutes: null },
];

export async function saveNotif(scopeId: string, kind: 0 | 1 | 2, patch: Partial<NotificationSetting> & { mute_minutes?: number | null }) {
  try {
    const r = await api.put<NotificationSetting>(`/api/users/@me/notification-settings/${kind === 2 ? "dms" : scopeId}`, { scope_kind: kind, ...patch });
    useStore.setState((s) => ({ notif: { ...s.notif, [r.scope_id]: r } }));
    return r;
  } catch (e) { toast(errMsg(e), "error"); return null; }
}

const until = (iso: string | null) => (iso ? `until ${new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "");

/** The bell in a channel header. */
export function ChannelBell({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const s = useStore((st) => st.notif[channel.id]);
  const muted = useStore(() => isMutedScope(channel.id));
  const level = useStore(() => notifLevel(channel));
  const inherited = s?.level == null;
  return <>
    <button ref={btn} className={`icon-btn ${muted ? "active" : ""}`} aria-label="Notification settings" title={muted ? `Muted ${until(s?.muted_until ?? null)}` : "Notification settings"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{muted ? <BellOff size={20} /> : <Bell size={20} />}</button>
    {open && <Popover className="menu notif-menu" label="Notification settings" anchor={() => btn.current} onClose={() => setOpen(false)}>
      {muted ? <button role="menuitem" onClick={() => { saveNotif(channel.id, 1, { muted: false }); setOpen(false); }}>Unmute channel<small className="muted block">{until(s?.muted_until ?? null)}</small></button>
        : <details className="menu-sub"><summary role="menuitem">Mute channel</summary>{MUTE_TIMES.map((t) => <button key={t.label} role="menuitem" onClick={() => { saveNotif(channel.id, 1, { muted: true, mute_minutes: t.minutes }); setOpen(false); }}>{t.label}</button>)}</details>}
      <hr />
      {([[null, `Use category/server default`], [0, "All messages"], [1, "Only @mentions"], [2, "Nothing"]] as const).map(([v, label]) => (
        <button key={String(v)} role="menuitemradio" aria-checked={v === null ? inherited : !inherited && level === v} onClick={() => saveNotif(channel.id, 1, { level: v })}>
          {label}{(v === null ? inherited : !inherited && level === v) && <Check size={14} />}
          {v === null && <small className="muted block">{["All messages", "Only @mentions", "Nothing"][level]}</small>}
        </button>
      ))}
    </Popover>}
  </>;
}

/** Server-wide settings (from the server menu / right-click). */
export function openServerNotifications(guild: Guild) {
  openModal((close) => <ServerNotifications guild={guild} onClose={close} />);
}
function ServerNotifications({ guild, onClose }: { guild: Guild; onClose: () => void }) {
  const s = useStore((st) => st.notif[guild.id]);
  const muted = useStore(() => isMutedScope(guild.id));
  const level = s?.level ?? 1;
  const set = (p: Partial<NotificationSetting> & { mute_minutes?: number | null }) => saveNotif(guild.id, 0, p);
  return (
    <Modal title="Notification settings" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <p className="muted">{guild.name}</p>
      <div className="setting-block">
        <Toggle label={`Mute ${guild.name}`} hint={muted ? `Muted ${until(s?.muted_until ?? null)}. Muting a server stops notifications and unread dots, except for mentions you choose to keep.` : "Muting a server stops its notifications and unread dots."} checked={muted} onChange={(v) => set(v ? { muted: true, mute_minutes: null } : { muted: false })} />
        {!muted && <div className="chips">{MUTE_TIMES.slice(0, 5).map((t) => <button key={t.label} className="chip" onClick={() => set({ muted: true, mute_minutes: t.minutes })}>{t.label.replace("For ", "")}</button>)}</div>}
      </div>
      <fieldset className="radio-list"><legend>Server notification settings</legend>
        {[[0, "All messages"], [1, "Only @mentions"], [2, "Nothing"]].map(([v, l]) => (
          <label key={v as number}><input type="radio" name="lvl" checked={level === v} onChange={() => set({ level: v as 0 | 1 | 2 })} /> {l}</label>
        ))}
      </fieldset>
      <Toggle label="Suppress @everyone and @here" checked={!!s?.suppress_everyone} onChange={(v) => set({ suppress_everyone: v })} />
      <Toggle label="Suppress all role @mentions" checked={!!s?.suppress_roles} onChange={(v) => set({ suppress_roles: v })} />
      <Toggle label="Hide muted channels" hint="Muted channels disappear from the list unless they have mentions." checked={!!s?.hide_muted} onChange={(v) => set({ hide_muted: v })} />
      <Toggle label="Mobile push notifications" checked={s?.mobile_push !== false} onChange={(v) => set({ mobile_push: v })} />
    </Modal>
  );
}

/* ---------------------------------------------------------------------------- web push -- */
const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

export async function pushState(): Promise<"unsupported" | "unavailable" | "denied" | "off" | "on"> {
  if (inNativeApp) {
    const { native } = await api.get<{ native?: { android: boolean; ios: boolean } }>("/api/push/key").catch(() => ({ native: undefined }));
    if (!nativeBridgeReady() || !native?.[inAndroidApp ? "android" : "ios"]) return "unavailable";
    return nativePushRegistered() ? "on" : "off";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  const { key } = await api.get<{ key: string | null }>("/api/push/key").catch(() => ({ key: null }));
  if (!key) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}
export async function enablePush() {
  if (inNativeApp) {
    const r = await enableNativePush();
    if (r === "push:denied") throw new Error("Notifications are turned off for SEND. Turn them on in your phone's settings.");
    if (r !== "push:token") throw new Error("Push notifications aren't available in this version of the app.");
    return;
  }
  const { key } = await api.get<{ key: string | null }>("/api/push/key");
  if (!key) throw new Error("Push notifications aren't set up on this server yet.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Allow notifications for SEND in your browser settings.");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  const j = sub.toJSON();
  await api.post("/api/push/subscriptions", { endpoint: j.endpoint, keys: j.keys });
}
export async function disablePush() {
  if (inNativeApp) return disableNativePush();
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await api.del("/api/push/subscriptions", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
}
