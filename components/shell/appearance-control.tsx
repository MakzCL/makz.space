"use client";

import { motion } from "motion/react";

import { spring } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";
import type { Appearance } from "@/types";

import { useEnvironment } from "./environment";

const OPTIONS: { value: Appearance; label: string; long: string }[] = [
  { value: "dark", label: "DK", long: "Dark" },
  { value: "day", label: "DY", long: "Day" },
  { value: "system", label: "AU", long: "Auto" },
];

/**
 * Material selector. Three fixed positions with a solid block that travels
 * between them — the same marker language as the rail and the dock, so the
 * interface only ever has one way of saying "this one".
 */
export function AppearanceControl({
  orientation = "horizontal",
}: {
  orientation?: "horizontal" | "vertical";
}) {
  const { appearance, setAppearance } = useEnvironment();
  const reduced = useReducedMotion();
  const vertical = orientation === "vertical";

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cx(
        "flex border border-[var(--color-edge)]",
        vertical ? "flex-col" : "flex-row",
      )}
    >
      {OPTIONS.map((option) => {
        const active = option.value === appearance;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.long}
            title={option.long}
            onClick={() => setAppearance(option.value)}
            data-cursor="focus"
            className={cx(
              "relative flex items-center justify-center transition-colors duration-200",
              vertical
                ? "h-7 w-9 border-b border-[var(--color-line)] last:border-b-0"
                : "h-8 w-11 border-r border-[var(--color-line)] last:border-r-0",
              active
                ? "text-[var(--color-void)]"
                : "text-[var(--color-paper-35)] hover:text-[var(--color-paper)]",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`appearance-${orientation}`}
                aria-hidden
                transition={reduced ? { duration: 0 } : spring.snap}
                className="absolute inset-0 bg-[var(--color-paper)]"
              />
            ) : null}
            <span className="relative t-micro">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
