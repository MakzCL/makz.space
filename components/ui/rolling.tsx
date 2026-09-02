"use client";

import { AnimatePresence, motion } from "motion/react";

import { duration, ease } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

/**
 * A value that changes by rolling the old one out and the new one in, digit
 * by digit. Used for counters, indexes and any metadata that updates in
 * place — the movement is what tells you it changed.
 */
export function Rolling({
  value,
  className,
  direction = "up",
}: {
  value: string | number;
  className?: string;
  direction?: "up" | "down";
}) {
  const reduced = useReducedMotion();
  const text = String(value);
  const sign = direction === "up" ? 1 : -1;

  if (reduced) return <span className={className}>{text}</span>;

  return (
    <span className={cx("inline-flex", className)} aria-label={text}>
      {[...text].map((glyph, index) => (
        <span
          key={index}
          aria-hidden
          className="reveal-clip inline-block"
          style={{ width: glyph === " " ? "0.32em" : undefined }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${index}-${glyph}`}
              className="inline-block"
              initial={{ y: `${sign * 100}%`, opacity: 0 }}
              animate={{ y: "0%", opacity: 1 }}
              exit={{ y: `${-sign * 100}%`, opacity: 0 }}
              transition={{
                duration: duration.interface,
                ease: ease.out,
                delay: index * 0.018,
              }}
            >
              {glyph === " " ? " " : glyph}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
