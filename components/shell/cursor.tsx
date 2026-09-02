"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";

import { motionPreset, spring } from "@/motion/system";
import { useIsFinePointer } from "@/hooks/use-media-query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Cursor intents. Any element can declare one with data-cursor="view".
 * Anything interactive that declares none simply gets the focus state.
 */
const INTENTS = {
  default: { label: "", size: 9 },
  focus: { label: "", size: 26 },
  view: { label: "VIEW", size: 76 },
  open: { label: "OPEN", size: 76 },
  drag: { label: "DRAG", size: 72 },
  play: { label: "PLAY", size: 72 },
  external: { label: "↗", size: 40 },
  copy: { label: "COPY", size: 74 },
  close: { label: "CLOSE", size: 76 },
  next: { label: "NEXT", size: 70 },
  prev: { label: "PREV", size: 70 },
} as const;

type Intent = keyof typeof INTENTS;

function isIntent(value: string | undefined): value is Intent {
  return Boolean(value && value in INTENTS);
}

/**
 * THE CURSOR
 *
 * Two elements: a hairline square that trails on a spring and carries the
 * intent label, and a two-pixel dot pinned to the exact pointer position so
 * precision is never lost while the frame is catching up.
 *
 * Never rendered on touch devices or under reduced motion — the native
 * cursor is restored by removing the data-cursor flag from <html>.
 */
export function Cursor() {
  const fine = useIsFinePointer();
  const reduced = useReducedMotion();
  const enabled = fine && !reduced;

  const [intent, setIntent] = useState<Intent>("default");
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(false);

  const dotX = useMotionValue(-100);
  const dotY = useMotionValue(-100);
  const frameX = useSpring(dotX, spring.magnetic);
  const frameY = useSpring(dotY, spring.magnetic);

  const raf = useRef(0);
  const point = useRef({ x: -100, y: -100 });

  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      delete root.dataset.cursor;
      return;
    }
    root.dataset.cursor = "on";
    return () => {
      delete root.dataset.cursor;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const flush = () => {
      raf.current = 0;
      dotX.set(point.current.x);
      dotY.set(point.current.y);
    };

    const onMove = (event: PointerEvent) => {
      point.current = { x: event.clientX, y: event.clientY };
      if (!visible) setVisible(true);
      raf.current ||= requestAnimationFrame(flush);

      const target = event.target as Element | null;
      const holder = target?.closest?.("[data-cursor]") as HTMLElement | null;
      const declared = holder?.dataset.cursor;

      if (isIntent(declared)) {
        setIntent(declared);
        return;
      }
      const interactive = target?.closest?.(
        'a,button,[role="button"],input,textarea,select,[tabindex]:not([tabindex="-1"])',
      );
      setIntent(interactive ? "focus" : "default");
    };

    const onDown = () => setPressed(true);
    const onUp = () => setPressed(false);
    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerenter", onEnter);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerenter", onEnter);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [dotX, dotY, enabled, visible]);

  if (!enabled) return null;

  const shape = INTENTS[intent];
  const labelled = shape.label.length > 0;

  return (
    <div
      data-chrome
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[var(--z-cursor)] hidden lg:block"
    >
      <motion.div
        className="absolute left-0 top-0 flex items-center justify-center"
        style={{ x: frameX, y: frameY }}
        animate={{ opacity: visible ? 1 : 0 }}
        transition={motionPreset.fast}
      >
        <motion.div
          className="flex items-center justify-center border"
          animate={{
            width: shape.size,
            height: labelled ? shape.size * 0.42 : shape.size,
            x: "-50%",
            y: "-50%",
            scale: pressed ? 0.88 : 1,
            borderColor: labelled
              ? "var(--color-signal)"
              : intent === "focus"
                ? "var(--color-paper-50)"
                : "var(--color-paper-35)",
            backgroundColor: labelled
              ? "var(--color-signal)"
              : intent === "focus"
                ? "var(--color-paper-06)"
                : "transparent",
          }}
          transition={spring.snap}
          style={{ borderRadius: labelled ? 2 : 0 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {labelled ? (
              <motion.span
                key={shape.label}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={motionPreset.fast}
                className="t-micro whitespace-nowrap text-[var(--color-void)]"
              >
                {shape.label}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      <motion.span
        className="absolute left-0 top-0 block h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 bg-[var(--color-signal)]"
        style={{ x: dotX, y: dotY }}
        animate={{ opacity: visible && !labelled ? 1 : 0 }}
        transition={motionPreset.fast}
      />
    </div>
  );
}
