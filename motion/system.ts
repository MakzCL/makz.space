/**
 * MAKZ MOTION SYSTEM
 *
 * Five behaviours, not five hundred values. Every animated surface in the
 * application picks one of these and inherits its duration, curve and
 * physics. If a new animation needs a value that is not here, the value is
 * wrong or the behaviour is missing — extend this file, never inline.
 *
 *   fast       — a control acknowledging a press. Sub-perceptual.
 *   interface  — chrome rearranging itself. Confident, no overshoot.
 *   reveal     — content arriving. Decelerates hard, lands quietly.
 *   page       — a route replacing another. Owns the screen briefly.
 *   cinematic  — media taking over. Slow enough to feel deliberate.
 */

import type { Transition, Variants } from "motion/react";

/* ---- CURVES -------------------------------------------------------------
   Named for what they do, not for their maths. Deliberately asymmetric:
   things leave faster than they arrive, which is how weight reads. */
export const ease = {
  /** Long deceleration. The house curve for anything arriving. */
  out: [0.16, 1, 0.3, 1],
  /** Sharper deceleration for small, frequent interface moves. */
  outShort: [0.25, 1, 0.5, 1],
  /** Accelerates away. Exits only. */
  in: [0.7, 0, 0.84, 0],
  /** Heavy symmetric curve. Curtains, shutters, full-screen geometry. */
  inOut: [0.85, 0, 0.15, 1],
  /** Almost linear with a soft landing. Progress bars, scrubbing, counters. */
  drive: [0.4, 0, 0.15, 1],
} as const;

/* ---- DURATIONS (seconds) ---------------------------------------------- */
export const duration = {
  instant: 0.12,
  fast: 0.2,
  interface: 0.34,
  reveal: 0.62,
  page: 0.86,
  cinematic: 1.25,
} as const;

/* ---- STAGGERS ---------------------------------------------------------- */
export const stagger = {
  char: 0.016,
  word: 0.038,
  line: 0.07,
  item: 0.055,
  panel: 0.09,
} as const;

/* ---- SPRINGS -----------------------------------------------------------
   Real physics for anything a pointer or finger is directly driving. */
export const spring = {
  /** Snappy, no wobble. Toggles, active markers, tab underlines. */
  snap: { type: "spring", stiffness: 620, damping: 42, mass: 0.7 },
  /** The default for panels and sheets. One barely-visible settle. */
  glide: { type: "spring", stiffness: 320, damping: 34, mass: 0.9 },
  /** Weighty. Large surfaces, drag-dismiss, media frames. */
  heavy: { type: "spring", stiffness: 210, damping: 32, mass: 1.25 },
  /** Loose follow for magnetic and cursor tracking. */
  magnetic: { type: "spring", stiffness: 240, damping: 22, mass: 0.55 },
  /** Very loose trailing element. */
  trail: { type: "spring", stiffness: 130, damping: 20, mass: 0.9 },
} as const satisfies Record<string, Transition>;

/* ---- THE FIVE BEHAVIOURS ----------------------------------------------- */
export const motionPreset = {
  fast: { duration: duration.fast, ease: ease.outShort },
  interface: { duration: duration.interface, ease: ease.out },
  reveal: { duration: duration.reveal, ease: ease.out },
  page: { duration: duration.page, ease: ease.inOut },
  cinematic: { duration: duration.cinematic, ease: ease.out },
} as const satisfies Record<string, Transition>;

/* ---- SHARED VARIANTS ---------------------------------------------------
   Reused so that "content arriving" looks identical in every section. */

/** A line of type rising out of its own clipping mask. */
export const lineReveal: Variants = {
  hidden: { y: "108%" },
  shown: (i: number = 0) => ({
    y: "0%",
    transition: { ...motionPreset.reveal, delay: i * stagger.line },
  }),
  gone: { y: "-108%", transition: { duration: duration.interface, ease: ease.in } },
};

/** A block fading up a few pixels. For paragraphs and metadata only —
 *  never for anything structural, which should mask instead. */
export const blockReveal: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { ...motionPreset.reveal, delay: i * stagger.item },
  }),
  gone: { opacity: 0, transition: { duration: duration.fast, ease: ease.in } },
};

/** A row in an index. Enters from the leading edge under a mask. */
export const rowReveal: Variants = {
  hidden: { opacity: 0, x: -18 },
  shown: (i: number = 0) => ({
    opacity: 1,
    x: 0,
    transition: { ...motionPreset.reveal, delay: 0.05 + i * stagger.item },
  }),
};

/** Media uncovering itself: the frame opens, the image un-scales behind it. */
export const frameReveal: Variants = {
  hidden: { clipPath: "inset(0 0 100% 0)" },
  shown: { clipPath: "inset(0 0 0% 0)", transition: motionPreset.cinematic },
};

export const imageSettle: Variants = {
  hidden: { scale: 1.16 },
  shown: { scale: 1, transition: motionPreset.cinematic },
};

/* ---- HELPERS ------------------------------------------------------------ */

/** Applies a preset with an explicit delay without re-declaring the curve. */
export function delayed(
  preset: keyof typeof motionPreset,
  delay: number,
): Transition {
  return { ...motionPreset[preset], delay };
}

/** Collapses any transition to nothing. Used by the reduced-motion guard so
 *  components keep their identical variant tree and simply stop moving. */
export const still: Transition = { duration: 0 };
