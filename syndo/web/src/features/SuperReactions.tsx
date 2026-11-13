/**
 * Reactions row: normal and super (burst) reactions, a hover preview of who reacted,
 * right-click (long-press on phones) for the full "who reacted" viewer, and the burst animation.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SmilePlus, Sparkles, X } from "lucide-react";
import { emojiUrl, type Message, type Reaction, type User } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { displayName, toast, useStore } from "../store.ts";
import { customReaction } from "../expressions.ts";
import { CustomEmoji } from "../markdown.tsx";
import { Avatar, Modal } from "../components/ui.tsx";
import { openContextMenu } from "../components/overlay.tsx";
import { openModal } from "./modals.tsx";

const enc = (e: string) => encodeURIComponent(e);
const path = (m: Message, emoji: string) => `/api/channels/${m.channel_id}/messages/${m.id}/reactions/${enc(emoji)}`;
export const reactionId = (r: { emoji: string; burst?: boolean }) => `${r.burst ? "b" : "n"}:${r.emoji}`;

export function ReactionEmoji({ emoji, size }: { emoji: string; size?: number }) {
  const c = customReaction(emoji);
  return c ? <CustomEmoji id={c.id} name={c.name} size={size} /> : <>{emoji}</>;
}
const label = (emoji: string) => { const c = customReaction(emoji); return c ? `:${c.name}:` : emoji; };

/* ----------------------------------------------------------- who reacted (cached per message, emoji, kind) */
const cache = new Map<string, { count: number; users: User[] }>();
async function whoReacted(m: Message, r: Reaction): Promise<User[]> {
  const key = `${m.id}|${reactionId(r)}`, hit = cache.get(key);
  if (hit && hit.count === r.count) return hit.users;
  const users = await api.get<User[]>(`${path(m, r.emoji)}${r.burst ? "?type=burst" : ""}`);
  cache.set(key, { count: r.count, users });
  return users;
}

/* ----------------------------------------------------------- burst animation */
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches || ["off", "reduced", "minimal"].includes(document.documentElement.dataset.motion ?? "");
/** Plays the super reaction burst over a message (or a specific chip). Safe to call for messages that aren't on screen. */
export function playBurst(messageId: string, emoji: string) {
  if (typeof document === "undefined" || document.hidden) return;
  const msg = document.querySelector<HTMLElement>(`[data-mid="${CSS.escape(messageId)}"]`);
  if (!msg) return;
  const chip = msg.querySelector<HTMLElement>(`.reaction.burst[data-emoji="${CSS.escape(emoji)}"]`) ?? msg.querySelector<HTMLElement>(".reactions") ?? msg;
  const box = chip.getBoundingClientRect();
  if (box.bottom < 0 || box.top > innerHeight) return;
  const cx = box.left + Math.min(box.width, 60) / 2, cy = box.top + box.height / 2;
  const layer = document.createElement("div");
  layer.className = "burst-layer"; layer.setAttribute("aria-hidden", "true");
  layer.style.left = `${cx}px`; layer.style.top = `${cy}px`;
  const c = customReaction(emoji);
  const glyph = () => {
    if (c) { const img = document.createElement("img"); img.src = emojiUrl(c.id); img.alt = ""; return img; }
    const s = document.createElement("span"); s.textContent = emoji; return s;
  };
  const hero = document.createElement("i"); hero.className = "burst-hero"; hero.appendChild(glyph()); layer.appendChild(hero);
  const ring = document.createElement("i"); ring.className = "burst-ring"; layer.appendChild(ring);
  if (!reduced()) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i"); p.className = "burst-p";
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, d = 70 + Math.random() * 90;
      p.style.setProperty("--dx", `${Math.cos(a) * d}px`); p.style.setProperty("--dy", `${Math.sin(a) * d - 40}px`);
      p.style.setProperty("--r", `${(Math.random() - 0.5) * 140}deg`); p.style.setProperty("--s", `${0.55 + Math.random() * 0.6}`);
      p.style.animationDelay = `${Math.random() * 90}ms`;
      p.appendChild(glyph()); layer.appendChild(p);
    }
    for (let i = 0; i < 14; i++) {
      const sp = document.createElement("i"); sp.className = "burst-spark";
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 70;
      sp.style.setProperty("--dx", `${Math.cos(a) * d}px`); sp.style.setProperty("--dy", `${Math.sin(a) * d}px`);
      sp.style.animationDelay = `${60 + Math.random() * 160}ms`;
      layer.appendChild(sp);
    }
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1500);
}
// Someone else's super reaction arrives through the gateway (store.ts dispatches this).
if (typeof window !== "undefined") window.addEventListener("send:burst", (e) => { const d = (e as CustomEvent).detail; if (d?.message_id) playBurst(d.message_id, d.emoji); });

/* ----------------------------------------------------------- toggling */
export async function toggleReaction(m: Message, emoji: string, burst = false) {
  const mine = m.reactions.find((r) => r.emoji === emoji && !!r.burst === burst)?.me;
  const url = `${path(m, emoji)}/@me${burst ? "?type=burst" : ""}`;
  if (burst && !mine) requestAnimationFrame(() => requestAnimationFrame(() => playBurst(m.id, emoji)));
  try { mine ? await api.del(url) : await api.put(url); } catch (e) { toast(errMsg(e), "error"); }
}

/* ----------------------------------------------------------- viewer */
export function openReactionsViewer(m: Message, start?: Reaction) {
  openModal((close) => <ReactionsViewer messageId={m.id} channelId={m.channel_id} fallback={m} start={start ? reactionId(start) : undefined} onClose={close} />);
}
function ReactionsViewer({ messageId, channelId, fallback, start, onClose }: { messageId: string; channelId: string; fallback: Message; start?: string; onClose: () => void }) {
  // Follow the live message so counts and removals update while the dialog is open.
  const m = useStore((s) => s.messages[channelId]?.list.find((x) => x.id === messageId)) ?? fallback;
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState(start ?? (m.reactions[0] ? reactionId(m.reactions[0]) : ""));
  const r = m.reactions.find((x) => reactionId(x) === tab) ?? m.reactions[0];
  const [users, setUsers] = useState<User[] | null>(null);
  useEffect(() => { if (!r) return; setUsers(null); whoReacted(m, r).then(setUsers).catch(() => setUsers([])); }, [r?.emoji, r?.burst, r?.count]); // eslint-disable-line
  if (!r) { onClose(); return null; }
  return (
    <Modal title="Reactions" onClose={onClose} className="reactions-viewer" label="Reactions">
      <div className="rv">
        <div className="rv-tabs" role="tablist" aria-label="Reactions">
          {m.reactions.map((x) => (
            <button key={reactionId(x)} role="tab" aria-selected={reactionId(x) === reactionId(r)} className={`rv-tab ${x.burst ? "burst" : ""} ${reactionId(x) === reactionId(r) ? "on" : ""}`} onClick={() => setTab(reactionId(x))}>
              <span className="rv-emoji"><ReactionEmoji emoji={x.emoji} size={20} /></span>{x.burst && <Sparkles size={12} className="rv-spark" aria-label="Super reaction" />}<span>{x.count}</span>
            </button>
          ))}
        </div>
        <ul className="rv-list" aria-live="polite">
          {users === null ? <li className="muted rv-empty">Loading…</li> : users.length === 0 ? <li className="muted rv-empty">Nobody yet.</li> : users.map((u) => (
            <li key={u.id} className="rv-user">
              <Avatar user={u} size={32} status="" />
              <span className="rv-names"><b className="ellipsis">{displayName(u)}</b><small className="muted ellipsis">{u.username}</small></span>
              {u.id === me?.id && <button className="icon-btn sm" aria-label="Remove my reaction" onClick={() => toggleReaction(m, r.emoji, !!r.burst)}><X size={15} /></button>}
            </li>
          ))}
        </ul>
      </div>
      <p className="muted small rv-foot">{r.burst ? <><Sparkles size={12} /> Super reactions with {label(r.emoji)}</> : <>Reacted with {label(r.emoji)}</>}</p>
    </Modal>
  );
}

/* ----------------------------------------------------------- hover preview */
function Preview({ m, r, anchor }: { m: Message; r: Reaction; anchor: HTMLElement }) {
  const [users, setUsers] = useState<User[] | null>(null);
  useEffect(() => { whoReacted(m, r).then(setUsers).catch(() => setUsers([])); }, [m.id, r.emoji, r.burst, r.count]); // eslint-disable-line
  const box = anchor.getBoundingClientRect();
  const names = (users ?? []).map(displayName);
  const shown = names.slice(0, 3), more = r.count - shown.length;
  const text = users === null ? "…" : shown.length === 0 ? "" : `${shown.join(", ")}${more > 0 ? ` and ${more} other${more === 1 ? "" : "s"}` : ""}`;
  const top = box.top > 110;
  return createPortal(
    <div className={`reaction-tip ${r.burst ? "burst" : ""} ${top ? "above" : "below"}`} role="tooltip" style={{ left: Math.max(12, Math.min(innerWidth - 12, box.left + box.width / 2)), top: top ? box.top - 8 : box.bottom + 8 }}>
      <span className="reaction-tip-emoji"><ReactionEmoji emoji={r.emoji} size={34} /></span>
      <span className="reaction-tip-text">{text}{text && <> {r.burst ? "super reacted" : "reacted"} with {label(r.emoji)}</>}<small>Right-click to see everyone</small></span>
    </div>, document.body);
}

/* ----------------------------------------------------------- the row */
export function Reactions({ m, canAdd, onAdd }: { m: Message; canAdd: boolean; onAdd: (el: HTMLElement, burst: boolean) => void }) {
  const [hover, setHover] = useState<{ r: Reaction; el: HTMLElement } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = (r: Reaction, el: HTMLElement) => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover({ r, el }), 380); };
  const leave = () => { clearTimeout(timer.current); setHover(null); };
  if (!m.reactions.length) return null;
  return (
    <div className="reactions">
      {m.reactions.map((r) => (
        <button key={reactionId(r)} data-emoji={r.emoji} className={`reaction ${r.me ? "me" : ""} ${r.burst ? "burst" : ""}`} aria-pressed={r.me}
          aria-label={`${label(r.emoji)} ${r.count} ${r.burst ? "super " : ""}reaction${r.count === 1 ? "" : "s"}`}
          onClick={() => { leave(); toggleReaction(m, r.emoji, !!r.burst); }}
          onMouseEnter={(e) => enter(r, e.currentTarget)} onMouseLeave={leave} onFocus={(e) => enter(r, e.currentTarget)} onBlur={leave}
          onContextMenu={(e) => {
            e.stopPropagation(); leave();
            openContextMenu(e, [
              { label: "View reactions", onSelect: () => openReactionsViewer(m, r) },
              ...(r.burst ? [{ label: r.me ? "Remove super reaction" : "Super react", icon: <Sparkles size={15} />, onSelect: () => toggleReaction(m, r.emoji, true) }]
                : [{ label: "Super react", icon: <Sparkles size={15} />, onSelect: () => toggleReaction(m, r.emoji, true) }]),
              { label: r.me ? "Remove reaction" : "Add reaction", onSelect: () => toggleReaction(m, r.emoji, !!r.burst) },
            ]);
          }}>
          <span className="r-emoji"><ReactionEmoji emoji={r.emoji} /></span>{r.count}
        </button>
      ))}
      {canAdd && <>
        <button className="reaction add" aria-label="Add reaction" onClick={(e) => onAdd(e.currentTarget, false)}><SmilePlus size={14} /></button>
        <button className="reaction add add-burst" aria-label="Add super reaction" title="Super reaction" onClick={(e) => onAdd(e.currentTarget, true)}><Sparkles size={14} /></button>
      </>}
      {hover && <Preview m={m} r={hover.r} anchor={hover.el} />}
    </div>
  );
}
