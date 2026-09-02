"use client";

import { motion } from "motion/react";

import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

/**
 * THE WORDMARK
 *
 * MAKZ is not a logo dropped onto a page — from tablet width up it is cut in
 * half by the data band that runs across the environment. Above the cut the
 * letters are solid; below it they are outlined, as though the band passes in
 * front of a heavier object behind it.
 *
 * Below that width the cut is abandoned rather than shrunk: at phone sizes the
 * band would be a few pixels tall and the readouts would sit on the glyphs, so
 * the mark stays whole and the band becomes a rule underneath it. Same
 * information, composed for the space it actually has.
 *
 * Each letter is its own cell so it can rise on its own beat, and both halves
 * of a letter travel together because the clip is relative to the cell.
 */
export function Wordmark({
  text = "MAKZ",
  className,
  band,
}: {
  text?: string;
  className?: string;
  /** Rendered inside the cut, and in the rule below it on small screens. */
  band?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const letters = [...text];

  return (
    <div className={cx("relative w-full", className)}>
      <h1
        aria-label={text}
        className="t-mega flex w-full select-none justify-between text-[var(--color-paper)]"
      >
        {letters.map((letter, i) => (
          <span key={i} aria-hidden className="reveal-clip relative block">
            <motion.span
              className="relative block"
              initial={reduced ? false : { y: "104%" }}
              animate={{ y: "0%" }}
              transition={{
                ...motionPreset.reveal,
                duration: 1.05,
                delay: 0.06 + i * stagger.line,
              }}
            >
              {/* Solid. Clipped at the cut only where the cut exists. */}
              <span className="block md:[clip-path:inset(0_0_54%_0)]">{letter}</span>
              {/* Outlined below the cut, pinned back over the first copy. */}
              <span
                className="absolute inset-0 hidden text-transparent md:block md:[clip-path:inset(60%_0_0_0)]"
                style={{ WebkitTextStroke: "1px var(--color-paper-35)" }}
              >
                {letter}
              </span>
            </motion.span>
          </span>
        ))}
      </h1>

      {/* The cut. Tablet and up. */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 hidden items-center md:flex"
        style={{ top: "46%", height: "14%" }}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...motionPreset.interface, delay: 0.5 }}
      >
        <span className="absolute inset-x-0 top-0 h-px bg-[var(--color-line-strong)]" />
        <span className="absolute inset-x-0 bottom-0 h-px bg-[var(--color-line-strong)]" />
        <div className="pointer-events-auto relative flex w-full items-center justify-between overflow-hidden bg-[var(--color-base)] px-1">
          {band}
        </div>
      </motion.div>

      {/* The same readouts as a rule, below the mark. Phones only. */}
      <motion.div
        className="mt-5 flex items-center justify-between gap-4 border-y border-[var(--color-line-strong)] py-2.5 md:hidden"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ...motionPreset.interface, delay: 0.5 }}
      >
        {band}
      </motion.div>
    </div>
  );
}
