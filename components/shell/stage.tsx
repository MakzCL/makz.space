"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { duration, ease, motionPreset, stagger } from "@/motion/system";
import { sectionForPath } from "@/lib/site";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

import { useStageScroll } from "./stage-scroll";

const COLUMNS = 7;

/** Order the shutters lift in: centre first, outwards. Reads as an opening. */
const LIFT_ORDER = (() => {
  const centre = (COLUMNS - 1) / 2;
  return Array.from({ length: COLUMNS }, (_, i) => Math.abs(i - centre));
})();

const COVER = 0.34;
const HOLD = 0.16;
const LIFT = 0.46;

/**
 * THE CURTAIN
 *
 * Route changes are not fades. Seven shutters climb the stage from the
 * bottom, staggered across the viewport; the destination's index and name
 * resolve inside the sealed mask with an accent rule drawing beneath them;
 * then the shutters lift from the centre outwards and the incoming content
 * reveals underneath.
 *
 * The outgoing page recedes rather than disappearing, so the shutters read as
 * passing in front of something rather than replacing nothing.
 *
 * The curtain is scoped to the stage — the ledger, rail and deck stay lit
 * through the whole transition, because the shell is not what changed.
 */
export function Stage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const section = sectionForPath(pathname);

  const scroller = useStageScroll();

  const [curtain, setCurtain] = useState<null | {
    key: string;
    index: string;
    name: string;
  }>(null);
  const [seen, setSeen] = useState(pathname);

  // The route changed. Derived during render rather than in an effect, so the
  // curtain is already mounted in the same commit that swaps the content —
  // there is no frame in which the new page is visible undressed.
  if (seen !== pathname) {
    setSeen(pathname);
    if (!reduced) {
      setCurtain({ key: pathname, index: section.index, name: section.name });
    }
  }

  // Clearing is a timer, not a render concern.
  useEffect(() => {
    if (!curtain) return;
    const id = window.setTimeout(
      () => setCurtain(null),
      (COVER + HOLD + LIFT + (COLUMNS - 1) * 0.03) * 1000,
    );
    return () => window.clearTimeout(id);
  }, [curtain]);

  // Each route starts at the top of its own scroll container.
  const resetScroll = useCallback(() => {
    scroller.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [scroller]);

  return (
    <>
      <div
        ref={scroller}
        id="stage"
        data-stage
        className="relative h-full w-full overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <AnimatePresence mode="wait" initial={false} onExitComplete={resetScroll}>
          <motion.main
            key={pathname}
            id="main"
            initial={reduced ? false : { opacity: 0 }}
            animate={{
              opacity: 1,
              transition: reduced
                ? { duration: 0 }
                : { duration: duration.fast, delay: COVER + HOLD * 0.5 },
            }}
            exit={
              reduced
                ? { opacity: 1 }
                : {
                    opacity: 0.45,
                    scale: 0.985,
                    transition: { duration: COVER, ease: ease.in },
                  }
            }
            style={{ transformOrigin: "50% 40%" }}
            /* Bounded on very wide displays so the composition stays a
               composition instead of a thin band pinned to the left edge. */
            className="mx-auto min-h-full w-full max-w-[128rem]"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>

      {curtain ? (
        <div
          key={curtain.key}
          data-chrome
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[var(--z-curtain)]"
        >
          <div className="absolute inset-0 flex">
            {Array.from({ length: COLUMNS }, (_, i) => (
              <motion.div
                key={i}
                className="h-full flex-1 border-r border-[var(--color-line)] bg-[var(--color-void)] last:border-r-0"
                initial={{ y: "100%" }}
                animate={{ y: ["100%", "0%", "0%", "-100%"] }}
                transition={{
                  duration: COVER + HOLD + LIFT,
                  ease: ease.inOut,
                  times: [
                    0,
                    COVER / (COVER + HOLD + LIFT),
                    (COVER + HOLD) / (COVER + HOLD + LIFT),
                    1,
                  ],
                  // Cover sweeps left to right; the lift opens from the centre.
                  delay: i * 0.03 - (LIFT_ORDER[i] ?? 0) * 0.012,
                }}
                style={{ willChange: "transform" }}
              />
            ))}
          </div>

          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <motion.span
              className="t-micro text-[var(--color-signal)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{
                duration: COVER + HOLD + LIFT * 0.5,
                times: [0, 0.5, 0.7, 1],
              }}
            >
              {curtain.index}
            </motion.span>

            <span className="reveal-clip block">
              <motion.span
                className="t-display block px-6 text-center text-[var(--color-paper)]"
                initial={{ y: "110%" }}
                animate={{ y: ["110%", "0%", "0%", "-110%"] }}
                transition={{
                  duration: COVER + HOLD + LIFT * 0.7,
                  ease: ease.out,
                  times: [0, 0.42, 0.62, 1],
                }}
              >
                {curtain.name}
              </motion.span>
            </span>

            <motion.span
              className="block h-px w-[min(38vw,20rem)] origin-left bg-[var(--color-signal)]"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: [0, 0, 1, 1], opacity: [0, 1, 1, 0] }}
              transition={{
                duration: COVER + HOLD + LIFT * 0.6,
                ease: ease.drive,
                times: [0, 0.34, 0.72, 1],
              }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Content-level reveal used by every section: a stack of masked lines that
 * arrive on a shared cadence, starting after the curtain has lifted.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <span className={`reveal-clip block ${className ?? ""}`}>
      <motion.span
        className="block"
        initial={reduced ? false : { y: "108%" }}
        animate={{ y: "0%" }}
        transition={
          reduced ? { duration: 0 } : { ...motionPreset.reveal, delay: delay * stagger.line }
        }
      >
        {children}
      </motion.span>
    </span>
  );
}
