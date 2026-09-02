"use client";

import { useEffect, useRef } from "react";
import { useMotionValue, useSpring, type MotionValue } from "motion/react";

import { spring } from "@/motion/system";

import { useIsFinePointer } from "./use-media-query";
import { useReducedMotion } from "./use-reduced-motion";

interface MagneticOptions {
  /** How far outside the element the field reaches, in pixels. */
  radius?: number;
  /** Fraction of the pointer offset the element travels. Keep it believable. */
  pull?: number;
}

/**
 * Pointer-proximity attraction. The element leans towards the cursor while it
 * is inside the field and springs back when it leaves — no transform is ever
 * applied on touch or under reduced motion.
 */
export function useMagnetic<T extends HTMLElement>({
  radius = 90,
  pull = 0.32,
}: MagneticOptions = {}): {
  ref: React.RefObject<T | null>;
  x: MotionValue<number>;
  y: MotionValue<number>;
} {
  const ref = useRef<T>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const x = useSpring(rawX, spring.magnetic);
  const y = useSpring(rawY, spring.magnetic);

  const fine = useIsFinePointer();
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node || !fine || reduced) {
      rawX.set(0);
      rawY.set(0);
      return;
    }

    let frame = 0;
    let latest: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      if (!latest) return;
      const box = node.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const dx = latest.clientX - cx;
      const dy = latest.clientY - cy;
      const reach = Math.max(box.width, box.height) / 2 + radius;
      const distance = Math.hypot(dx, dy);

      if (distance > reach) {
        rawX.set(0);
        rawY.set(0);
        return;
      }
      // Falls off towards the edge of the field so there is no snap at entry.
      const falloff = 1 - distance / reach;
      rawX.set(dx * pull * falloff);
      rawY.set(dy * pull * falloff);
    };

    const onMove = (event: PointerEvent) => {
      latest = event;
      frame ||= requestAnimationFrame(apply);
    };
    const onLeave = () => {
      rawX.set(0);
      rawY.set(0);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onLeave, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fine, pull, radius, rawX, rawY, reduced]);

  return { ref, x, y };
}
