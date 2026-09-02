"use client";

import { usePathname } from "next/navigation";
import { motion, useScroll, useSpring } from "motion/react";

import { SITE, sectionForPath } from "@/lib/site";
import { spring } from "@/motion/system";
import { useClock } from "@/hooks/use-clock";

import { useStageScroll } from "./stage-scroll";

/**
 * THE DECK
 *
 * The bottom rule is a readout, not a footer: coordinates, local date, the
 * position of the current section in the index, and a progress line bound to
 * the stage's scroll. It never contains links — everything on it is state.
 *
 * It appears only where the rail does. Below that width the dock owns the
 * bottom edge, and two stacked strips would be chrome for its own sake.
 */
export function Deck() {
  const pathname = usePathname();
  const section = sectionForPath(pathname);
  const { date } = useClock();
  const container = useStageScroll();

  // The stage owns the scroll, not the document.
  const { scrollYProgress } = useScroll({ container });
  const line = useSpring(scrollYProgress, spring.glide);

  return (
    <div
      data-chrome
      aria-hidden
      className="relative z-[var(--z-sticky)] hidden h-[var(--unit-deck)] shrink-0 items-center gap-5 border-t border-[var(--color-line)] bg-[var(--color-base)] px-4 lg:flex"
    >
      <span className="t-micro t-tabular text-[var(--color-paper-20)]">
        {SITE.coordinates.lat.toFixed(4)}N {Math.abs(SITE.coordinates.lon).toFixed(4)}W
      </span>
      <span className="t-micro text-[var(--color-paper-20)]">
        {SITE.region.toUpperCase()}
      </span>
      <span className="t-micro t-tabular text-[var(--color-paper-20)]">
        {date ?? "--/--/----"}
      </span>

      <div className="relative mx-2 h-px flex-1 bg-[var(--color-line)]">
        <motion.span
          className="absolute inset-y-0 left-0 block w-full origin-left bg-[var(--color-signal)]"
          style={{ scaleX: line }}
        />
      </div>

      <span className="t-micro t-tabular text-[var(--color-paper-35)]">
        {section.index} / 05
      </span>
    </div>
  );
}
