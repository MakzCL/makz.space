import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * One stack for every dismissible surface (dialogs, popovers, menus, pickers, the media viewer).
 *
 * - Escape closes only the topmost layer, so a dropdown's Escape never also closes its dialog.
 * - A pointer press dismisses the transient layers *above* the layer it landed in, so interacting
 *   with a portalled child menu keeps its parent open, and clicking inside a dialog closes only the
 *   popovers stacked on it.
 * - Pressing a layer's anchor (the button that opened it) counts as inside, so that button's own
 *   click handler can toggle the layer closed instead of it closing and immediately reopening.
 * - When a layer closes, focus returns to whatever had focus before it opened (without scrolling).
 */
export type DismissReason = "escape" | "outside" | "blur";
export interface LayerOptions {
  /** Close when pressing outside this layer (and outside its anchor). Default true. */
  outside?: boolean;
  /** Close on Escape. Default true. */
  escape?: boolean;
  /** For layers with outside:false — true (default) blocks presses from dismissing layers beneath; false is a docked panel that just ignores them. */
  modal?: boolean;
  /** Whether app shortcuts pause while this layer is open. Default true; docked panels (pins, search) set false. */
  blocksShortcuts?: boolean;
  /** Close when the window loses focus (context menus). Default false. */
  blur?: boolean;
  /** Restore focus to the previously focused element on close. Default true. */
  restoreFocus?: boolean;
  /** Element(s) treated as part of the layer for outside-press purposes. */
  anchor?: () => Element | null | undefined;
}
interface Layer { node: HTMLElement; opts: LayerOptions; dismiss: (r: DismissReason) => void; restoreTo: HTMLElement | null }

const stack: Layer[] = [];
export const hasLayers = () => stack.length > 0;
/** True while a dialog, menu or popover is open — app shortcuts must not act on what is underneath it. */
export const hasBlockingLayers = () => stack.some((l) => l.opts.blocksShortcuts !== false);
export const topLayerNode = () => stack[stack.length - 1]?.node ?? null;

function inside(l: Layer, t: Node) { return l.node.contains(t) || !!l.opts.anchor?.()?.contains(t); }

export function pushLayer(node: HTMLElement, dismiss: (r: DismissReason) => void, opts: LayerOptions = {}) {
  const layer: Layer = { node, opts, dismiss, restoreTo: document.activeElement instanceof HTMLElement ? document.activeElement : null };
  stack.push(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (opts.restoreFocus === false) return;
    const target = layer.restoreTo, active = document.activeElement;
    // Only move focus back if it was inside the closing layer (or got lost) — never steal it from elsewhere.
    if (target?.isConnected && (!active || active === document.body || node.contains(active) || !active.isConnected)) {
      queueMicrotask(() => { if (document.activeElement === document.body || document.activeElement === null || !document.activeElement.isConnected) target.focus({ preventScroll: true }); });
      target.focus({ preventScroll: true });
    }
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.isComposing || !stack.length || document.body.dataset.recordingKeybind) return;
    const top = stack[stack.length - 1]!;
    // A layer still swallows Escape when it opts out of closing, so nothing underneath reacts.
    e.preventDefault(); e.stopImmediatePropagation();
    if (top.opts.escape !== false) top.dismiss("escape");
  }, true);
  window.addEventListener("pointerdown", (e) => {
    if (!stack.length) return;
    const t = e.target as Node;
    let hit = -1;
    for (let i = stack.length - 1; i >= 0; i--) if (inside(stack[i]!, t)) { hit = i; break; }
    for (let i = stack.length - 1; i > hit; i--) {
      const l = stack[i]!;
      if (l.opts.outside === false) { if (l.opts.modal === false) continue; break; } // a modal blocks presses from reaching what's beneath it
      l.dismiss("outside");
    }
  }, true);
  window.addEventListener("blur", () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.opts.blur) stack[i]!.dismiss("blur"); });
}

/** Register the element in `ref` as a layer for as long as the component is mounted. */
export function useLayer(ref: RefObject<HTMLElement | null>, onDismiss: (r: DismissReason) => void, opts: LayerOptions = {}) {
  const cb = useRef(onDismiss); cb.current = onDismiss;
  const o = useRef(opts); o.current = opts;
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    return pushLayer(node, (r) => cb.current(r), {
      get outside() { return o.current.outside; }, get modal() { return o.current.modal; }, get escape() { return o.current.escape; }, get blur() { return o.current.blur; },
      get restoreFocus() { return o.current.restoreFocus; }, get blocksShortcuts() { return o.current.blocksShortcuts; }, anchor: () => o.current.anchor?.(),
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
