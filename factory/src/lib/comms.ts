import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Backend } from "./backend";
import { useStore } from "./store";
import type { Conversation, Message, PresenceStatus, Profile } from "./types";

/* ------------------------------------------------------------- presence -- */
/** Who has the app open right now (Supabase Realtime presence). */
const OnlineCtx = createContext<Set<string>>(new Set());
export const useOnline = () => useContext(OnlineCtx);

export function OnlineProvider({ children }: { children: ReactNode }) {
  const { backend, me } = useStore();
  const [online, setOnline] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ch = backend.channel("online", { presenceKey: me.id });
    ch.on("presence", { event: "sync" }, () => setOnline(new Set(Object.keys(ch.presenceState()))));
    ch.subscribe((s) => { if (s === "SUBSCRIBED") ch.track({ at: Date.now() }); });
    const seen = () => backend.update("profiles", me.id, { last_seen_at: new Date().toISOString() }).catch(() => {});
    seen();
    const i = setInterval(seen, 5 * 60000);
    const vis = () => { if (document.visibilityState === "hidden") seen(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(i); document.removeEventListener("visibilitychange", vis); backend.removeChannel(ch); };
  }, [backend, me.id]);
  return createElement(OnlineCtx.Provider, { value: online }, children);
}

export type Shown = PresenceStatus | "offline";
export const STATUS_META: Record<Shown, { label: string; color: string }> = {
  available: { label: "Available", color: "var(--ok)" },
  busy: { label: "Busy", color: "var(--red)" },
  dnd: { label: "Do not disturb", color: "var(--red)" },
  away: { label: "Away", color: "var(--moon)" },
  offline: { label: "Offline", color: "var(--dim)" },
};
/** What to show for someone: their chosen status while online, otherwise offline. */
export function shownStatus(p: Profile | undefined, online: Set<string>): Shown {
  if (!p || !online.has(p.id)) return "offline";
  return p.status ?? "available";
}

/* ---------------------------------------------------------------- chats -- */
export interface ConvView {
  c: Conversation;
  title: string;
  members: string[];
  other?: Profile;
  last?: Message;
  unread: number;
  lastRead: string;
}

/** My conversations, newest first, with names, last message and unread counts. */
export function useConversations() {
  const { db, me, person, refresh } = useStore();
  const list = useMemo<ConvView[]>(() => {
    const mine = new Map(db.conversation_members.filter((m) => m.user_id === me.id).map((m) => [m.conversation_id, m]));
    const lastBy = new Map<string, Message>();
    const unread = new Map<string, number>();
    for (const m of db.messages) {
      const cur = lastBy.get(m.conversation_id);
      if (!cur || cur.created_at < m.created_at) lastBy.set(m.conversation_id, m);
      const mem = mine.get(m.conversation_id);
      if (mem && m.sender_id !== me.id && m.kind !== "system" && m.created_at > mem.last_read_at) unread.set(m.conversation_id, (unread.get(m.conversation_id) ?? 0) + 1);
    }
    return db.conversations
      .filter((c) => mine.has(c.id) || c.kind === "channel")
      .map((c) => {
        const members = db.conversation_members.filter((m) => m.conversation_id === c.id).map((m) => m.user_id);
        const other = c.kind === "direct" ? person(members.find((u) => u !== me.id)) : undefined;
        const title = c.kind === "direct" ? other?.full_name ?? "…" : c.name || members.filter((u) => u !== me.id).map((u) => person(u)?.full_name.split(" ")[0]).join(", ");
        return { c, title, members, other, last: lastBy.get(c.id), unread: mine.get(c.id)?.muted ? 0 : unread.get(c.id) ?? 0, lastRead: mine.get(c.id)?.last_read_at ?? "" };
      })
      .sort((a, b) => (b.last?.created_at ?? b.c.last_message_at).localeCompare(a.last?.created_at ?? a.c.last_message_at));
  }, [db.conversations, db.conversation_members, db.messages, me.id, person]);

  // A chat someone else just started with me arrives as a membership first — fetch it.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const known = new Set(db.conversations.map((c) => c.id));
    const missing = [...new Set([...db.conversation_members.filter((m) => m.user_id === me.id).map((m) => m.conversation_id),
      ...db.messages.map((m) => m.conversation_id)])].filter((id) => !known.has(id) && !asked.current.has(id));
    if (missing.length) { missing.forEach((id) => asked.current.add(id)); refresh("conversations"); refresh("conversation_members"); }
  }, [db.conversations, db.conversation_members, db.messages, me.id, refresh]);
  return list;
}

export const totalUnread = (list: ConvView[]) => list.filter((v) => v.c.kind !== "channel" || v.unread).reduce((n, v) => n + v.unread, 0);

/* -------------------------------------------------------------- storage -- */
const urlCache = new Map<string, { url: string; at: number }>();
/** Short-lived link to a private chat file. */
export function useSignedUrl(backend: Backend, path: string | undefined) {
  const [url, setUrl] = useState<string | null>(() => (path && urlCache.get(path)?.url) || null);
  useEffect(() => {
    if (!path) return;
    const hit = urlCache.get(path);
    if (hit && Date.now() - hit.at < 5 * 3600 * 1000) { setUrl(hit.url); return; }
    let alive = true;
    backend.signedUrl(path).then((u) => { urlCache.set(path, { url: u, at: Date.now() }); if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [backend, path]);
  return url;
}

/** Shrink photos before sending (max 1920px, WebP/JPEG). Videos and files go as they are. */
export async function prepareImage(file: File): Promise<{ blob: Blob; w: number; h: number; name: string }> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, w: 0, h: 0, name: file.name };
  const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  if (scale === 1 && file.size < 1.5e6 && /jpe?g|webp/.test(file.type)) return { blob: file, w, h, name: file.name };
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/webp", 0.85));
  return { blob, w, h, name: file.name.replace(/\.[^.]+$/, "") + ".webp" };
}

/* ----------------------------------------------------------------- push -- */
const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** Ask for permission and register this device for push. */
export async function enablePush(backend: Backend, userId: string) {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? "On iPhone, add the app to your Home Screen first (Share → Add to Home Screen), then turn on notifications there." : "This browser cannot show notifications");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked — allow them in your browser or phone settings");
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch(backend.functionUrl("push"))).json() as { publicKey: string };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const existing = await backend.list("push_subscriptions" as never).catch(() => []) as { id: string; endpoint: string }[];
  const row = existing.find((x) => x.endpoint === j.endpoint);
  const data = { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) };
  if (row) await backend.update("push_subscriptions" as never, row.id, data as never);
  else await backend.insert("push_subscriptions" as never, data as never);
}

export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}
