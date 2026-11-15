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
  /**
   * Where a tile sits in the layout, ignoring where it's being moved to on screen. Uses the computed translate, so
   * a tile that's still sliding into its new place is measured at that place (measuring it mid-slide is what made
   * tiles swap back and forth).
   */
  const slot = (el: HTMLElement) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const [tx = 0, ty = 0] = (cs.translate && cs.translate !== "none" ? cs.translate : "0 0").split(" ").map((v) => parseFloat(v) || 0);
    const sc = parseFloat(cs.scale) || 1; // the picked-up tile is drawn a little bigger
    const w = r.width / sc, h = r.height / sc;
    return { left: r.left - tx + (r.width - w) / 2, top: r.top - ty + (r.height - h) / 2, width: w, height: h };
  };
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
      s.el.dataset.dragging = "1"; // an attribute, not a class: React rewrites the class list when someone starts talking
      s.el.style.transition = "none";
      s.root.dataset.reordering = "1";
      try { s.root.setPointerCapture(e.pointerId); } catch { /* */ }
    }
    follow(s);
    // Move only once the pointer is well inside another tile's place (not just nearer to it), and not straight
    // after a move, so two tiles never fight over a spot.
    if (performance.now() - s.lastSwap < 180) return;
    let best: HTMLElement | null = null;
    for (const t of tilesIn(s.root)) {
      if (t === s.el) continue;
      const r = slot(t), ix = r.width * 0.18, iy = r.height * 0.18;
      if (e.clientX > r.left + ix && e.clientX < r.left + r.width - ix && e.clientY > r.top + iy && e.clientY < r.top + r.height - iy) { best = t; break; }
    }
    if (!best) return;
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
        // Measure the new place without the slide that may still be running from the last move.
        t.style.transition = "none"; t.style.translate = "";
        const now = t.getBoundingClientRect();
        const dx = old.left - now.left, dy = old.top - now.top;
        if (!dx && !dy) continue;
        t.style.transition = "none"; t.style.translate = `${dx}px ${dy}px`;
        void t.offsetWidth;
        t.style.transition = "translate .34s cubic-bezier(.22,1,.36,1)"; t.style.translate = "0px 0px";
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
    delete s.root.dataset.reordering;
    // Settle into the gap.
    s.el.style.transition = "translate .3s cubic-bezier(.22,1,.36,1), scale .3s cubic-bezier(.22,1,.36,1)";
    s.el.style.translate = "0px 0px";
    s.el.dataset.dragging = "settle"; // stays on top while it slides home
    const done = () => { delete s.el.dataset.dragging; s.el.style.transition = ""; s.el.style.translate = ""; s.el.removeEventListener("transitionend", done); };
    s.el.addEventListener("transitionend", done); setTimeout(done, 340);
    // Swallow the click that follows the drag.
    const eat = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener("click", eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 0);
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish };
}
