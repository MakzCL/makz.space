import { useSyncExternalStore } from "react";
import { BRAND } from "@syndo/shared";
import { previewMode } from "./preview-mode.ts";

/** Minimal history router. Routes: /login /register /forgot /reset /verify /invite/:code /channels/@me[/:cid] /channels/:gid[/:cid[/:mid]] */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener("popstate", notify);

export function navigate(path: string, replace = false) {
  if (previewMode) {
    const target = new URL(path, location.origin);
    target.searchParams.set("preview", "1");
    path = target.pathname + target.search + target.hash;
  }
  if (path === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", path);
  notify();
}

export interface Route { name: string; params: Record<string, string>; query: URLSearchParams }
function parse(): Route {
  const p = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const query = new URLSearchParams(location.search);
  if (p[0] === "channels") return { name: "channels", params: { guild: p[1] ?? "@me", channel: p[2] ?? "", message: p[3] ?? "" }, query };
  if (p[0] === "invite" && p[1]) return { name: "invite", params: { code: p[1] }, query };
  if (p[0] === "qr" && p[1]) return { name: "qr", params: { id: p[1] }, query };
  if (["login", "register", "forgot", "reset", "verify"].includes(p[0] ?? "")) return { name: p[0]!, params: {}, query };
  return { name: "home", params: {}, query };
}
let cached = parse();
let key = location.pathname + location.search;
const snapshot = () => {
  const k = location.pathname + location.search;
  if (k !== key) { key = k; cached = parse(); }
  return cached;
};
export const useRoute = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, snapshot);
export const setTitle = (section?: string) => { document.title = section ? `${section} · ${BRAND.name}` : BRAND.name; };
export const messageLink = (guildId: string | null, channelId: string, messageId: string) => `${location.origin}/channels/${guildId ?? "@me"}/${channelId}/${messageId}`;
