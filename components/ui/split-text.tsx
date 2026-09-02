"use client";

import { Fragment, useId } from "react";
import { motion } from "motion/react";

import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

interface SplitTextProps {
  children: string;
  /** Words rise as units; characters resolve individually. */
  by?: "word" | "char" | "line";
  className?: string;
  delay?: number;
  /** Play as soon as it mounts, or when scrolled into view. */
  trigger?: "mount" | "view";
  as?: "span" | "h1" | "h2" | "h3" | "p";
}

/**
 * Type that arrives under its own clipping mask, one unit at a time.
 *
 * The whole string stays in the accessibility tree as a single label; the
 * animated fragments are hidden from it, so a screen reader hears the
 * sentence, not the letters.
 */
export function SplitText({
  children,
  by = "word",
  className,
  delay = 0,
  trigger = "mount",
  as: Tag = "span",
}: SplitTextProps) {
  const reduced = useReducedMotion();
  const id = useId();

  const units =
    by === "line"
      ? children.split("\n")
      : by === "word"
        ? children.split(/(\s+)/)
        : [...children];

  const step = by === "char" ? stagger.char : by === "word" ? stagger.word : stagger.line;

  if (reduced) {
    return <Tag className={className}>{children}</Tag>;
  }

  const animate = trigger === "mount" ? "shown" : undefined;
  const whileInView = trigger === "view" ? "shown" : undefined;

  return (
    <Tag className={className} aria-label={children}>
      {units.map((unit, index) => {
        if (/^\s+$/.test(unit)) return <Fragment key={`${id}-s-${index}`}> </Fragment>;
        return (
          <span
            key={`${id}-${index}`}
            aria-hidden
            className={cx(
              "reveal-clip",
              by === "line" ? "block" : "inline-block align-top",
            )}
          >
            <motion.span
              className="inline-block"
              initial={{ y: "112%" }}
              animate={animate ? { y: "0%" } : undefined}
              whileInView={whileInView ? { y: "0%" } : undefined}
              viewport={trigger === "view" ? { once: true, margin: "-12% 0px" } : undefined}
              transition={{ ...motionPreset.reveal, delay: delay + index * step }}
            >
              {unit}
            </motion.span>
          </span>
        );
      })}
    </Tag>
  );
}
