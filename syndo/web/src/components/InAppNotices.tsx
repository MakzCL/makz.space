import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { User } from "@syndo/shared";
import { navigate } from "../router.ts";
import { Avatar } from "./ui.tsx";

/** In-app message banners for phones: who, where, a preview; tap to open, swipe up or wait to dismiss. */
export interface Notice { id: string; user: User; title: string; where: string; text: string; href: string; mention: boolean; at?: number }
const useNotices = create<Notice[]>(() => []);
const MAX = 3, LIFE = 5000;

export function pushNotice(n: Notice) {
  useNotices.setState((list) => [{ ...n, at: Date.now() }, ...list.filter((x) => x.id !== n.id)].slice(0, MAX), true);
  setTimeout(() => dismiss(n.id), LIFE);
  try { navigator.vibrate?.(n.mention ? [12, 60, 12] : 12); } catch { /* not supported */ }
}
const dismiss = (id: string) => useNotices.setState((list) => list.filter((x) => x.id !== id), true);

export function InAppNotices() {
  const list = useNotices();
  if (!list.length) return null;
  return <div className="inapp-notices" aria-live="polite">{list.map((n) => <NoticeCard key={n.id} n={n} />)}</div>;
}

function NoticeCard({ n }: { n: Notice }) {
  const ref = useRef<HTMLButtonElement>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  useEffect(() => { ref.current?.classList.add("in"); }, []);
  const open = () => { dismiss(n.id); navigate(n.href); };
  return <button ref={ref} className={`inapp-notice ${n.mention ? "mention" : ""}`} onClick={open} aria-label={`${n.title} in ${n.where}: ${n.text}. Open`}
    onTouchStart={(e) => { start.current = { y: e.touches[0]!.clientY, t: Date.now() }; }}
    onTouchMove={(e) => { if (!start.current || !ref.current) return; const dy = Math.min(0, e.touches[0]!.clientY - start.current.y); ref.current.style.transform = `translateY(${dy}px)`; ref.current.style.opacity = String(1 + dy / 120); }}
    onTouchEnd={(e) => { const s = start.current; start.current = null; if (!s || !ref.current) return; const dy = e.changedTouches[0]!.clientY - s.y; if (dy < -36) { e.preventDefault(); dismiss(n.id); } else { ref.current.style.transform = ""; ref.current.style.opacity = ""; } }}>
    <Avatar user={n.user} size={38} status="" />
    <span className="inapp-body">
      <span className="inapp-top"><strong className="ellipsis">{n.title}</strong><small className="ellipsis">{n.where}</small></span>
      <span className="inapp-text">{n.text}</span>
    </span>
    <span className="inapp-life" aria-hidden />
  </button>;
}
