/**
 * Call tiles you can rearrange: drag a tile and drop it anywhere — it snaps into the slot whose centre is
 * closest to where you let go (the tile there moves over). The order is remembered per call on this device.
 */
import { useCallback, useRef } from "react";
import { create } from "zustand";

const KEY = "send.tileOrder";
const load = (): Record<string, string[]> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; } };

export const useTileOrder = create<{ order: Record<string, string[]> }>(() => ({ order: load() }));

export function setTileOrder(channelId: string, keys: string[]) {
  const order = { ...useTileOrder.getState().order, [channelId]: keys };
  useTileOrder.setState({ order });
  try { localStorage.setItem(KEY, JSON.stringify(order)); } catch { /* private mode */ }
}

/** Sort tiles by the saved order; tiles not in it keep their natural place after the ordered ones. */
export function sortTiles<T extends { key: string }>(tiles: T[], saved: string[] | undefined): T[] {
  if (!saved?.length) return tiles;
  const rank = new Map(saved.map((k, i) => [k, i]));
  return tiles.map((t, i) => ({ t, i })).sort((a, b) => (rank.get(a.t.key) ?? 1e6 + a.i) - (rank.get(b.t.key) ?? 1e6 + b.i)).map((x) => x.t);
}

/**
 * Home-screen style dragging: pick a tile up and the others slide out of the way as you move it; let go and it
 * settles into the gap. The order changes live (so the grid re-flows) and every other tile animates from where it
 * was to where it now is. A press only becomes a drag after the pointer moves a few pixels, so clicks keep working.
 */
export function useTileDrag(keysRef: { current: string[] }, onReorder: (keys: string[]) => void) {
  type Drag = { key: string; el: HTMLElement; root: HTMLElement; x: number; y: number; gx: number; gy: number; id: number; dragging: boolean; px: number; py: number; lastSwap: number };
  const state = useRef<Drag | null>(null);
  const tilesIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(":scope > [data-key]")];
  /** Where a tile sits in the layout, ignoring any translate on it. */
  const slot = (el: HTMLElement) => { const r = el.getBoundingClientRect(); const [tx = 0, ty = 0] = (el.style.translate || "0 0").split(" ").map((v) => parseFloat(v) || 0); return { left: r.left - tx, top: r.top - ty, width: r.width, height: r.height }; };
  const follow = (s: Drag) => { const r = slot(s.el); s.el.style.translate = `${s.px - s.gx - r.left}px ${s.py - s.gy - r.top}px`; };

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.pointerType === "touch") return; // touch keeps scrolling; rearrange with a mouse or pen
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
    if (!el || el.parentElement !== e.currentTarget || (e.target as HTMLElement).closest("button, input, a, select, .vol-pop")) return;
    const r = el.getBoundingClientRect();
    state.current = { key: el.dataset.key!, el, root: e.currentTarget, x: e.clientX, y: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, id: e.pointerId, dragging: false, px: e.clientX, py: e.clientY, lastSwap: 0 };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = state.current; if (!s || e.pointerId !== s.id) return;
    s.px = e.clientX; s.py = e.clientY;
    if (!s.dragging) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
      s.dragging = true;
      s.el.classList.add("tile-dragging");
      s.el.style.transition = "none";
      s.root.classList.add("tiles-reordering");
      try { s.root.setPointerCapture(e.pointerId); } catch { /* */ }
    }
    follow(s);
    // Which slot is the pointer over? Move there if it's another tile's (with a short pause so it doesn't jitter).
    if (performance.now() - s.lastSwap < 120) return;
    let best: HTMLElement | null = null, bestD = Infinity;
    for (const t of tilesIn(s.root)) {
      const r = t === s.el ? slot(t) : t.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bestD) { bestD = d; best = t; }
    }
    if (!best || best === s.el) return;
    const list = keysRef.current, from = list.indexOf(s.key), to = list.indexOf(best.dataset.key!);
    if (from < 0 || to < 0) return;
    // FLIP: remember where everything is, change the order, then animate each tile from old to new place.
    const before = new Map(tilesIn(s.root).filter((t) => t !== s.el).map((t) => [t, t.getBoundingClientRect()]));
    const next = list.filter((k) => k !== s.key); next.splice(to, 0, s.key);
    keysRef.current = next;
    s.lastSwap = performance.now();
    onReorder(next);
    requestAnimationFrame(() => {
      for (const [t, old] of before) {
        if (!t.isConnected) continue;
        const now = t.getBoundingClientRect();
        const dx = old.left - now.left, dy = old.top - now.top;
        if (!dx && !dy) continue;
        t.style.transition = "none"; t.style.translate = `${dx}px ${dy}px`;
        void t.offsetWidth;
        t.style.transition = "translate .22s cubic-bezier(.2,.8,.2,1)"; t.style.translate = "0px 0px";
        const done = () => { t.style.transition = ""; t.style.translate = ""; t.removeEventListener("transitionend", done); };
        t.addEventListener("transitionend", done);
      }
      if (state.current === s) follow(s);
    });
  }, [onReorder]);

  const finish = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const s = state.current; if (!s || e.pointerId !== s.id) return;
    state.current = null;
    if (!s.dragging) return;
    s.root.classList.remove("tiles-reordering");
    // Settle into the gap.
    s.el.style.transition = "translate .2s cubic-bezier(.2,.8,.2,1)";
    s.el.style.translate = "0px 0px";
    const done = () => { s.el.classList.remove("tile-dragging"); s.el.style.transition = ""; s.el.style.translate = ""; s.el.removeEventListener("transitionend", done); };
    s.el.addEventListener("transitionend", done); setTimeout(done, 300);
    // Swallow the click that follows the drag.
    const eat = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 0);
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish };
}
