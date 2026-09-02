"use client";

import { motion } from "motion/react";

import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { SplitText } from "@/components/ui/split-text";

/**
 * Every section opens the same way: index, name at display scale, a single
 * sentence, and a row of readouts on a rule. It is the one repeated structure
 * in the site — consistency here is what lets each section's body be
 * completely different without the environment coming apart.
 */
export function SectionHead({
  index,
  name,
  lede,
  readouts = [],
}: {
  index: string;
  name: string;
  lede: string;
  readouts?: { label: string; value: string }[];
}) {
  const reduced = useReducedMotion();

  return (
    <header className="gutter pt-8 md:pt-12">
      <motion.div
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={motionPreset.interface}
        className="flex items-center gap-3"
      >
        <span className="t-micro text-[var(--color-signal)]">{index}</span>
        <span aria-hidden className="block h-px w-8 bg-[var(--color-line-strong)]" />
        <span className="t-micro text-[var(--color-paper-20)]">Section</span>
      </motion.div>

      <SplitText
        as="h1"
        by="char"
        delay={0.08}
        className="t-display mt-5 block uppercase text-[var(--color-paper)]"
      >
        {name}
      </SplitText>

      <motion.p
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...motionPreset.reveal, delay: 0.3 }}
        className="t-lead mt-6 max-w-[54ch] t-pretty"
      >
        {lede}
      </motion.p>

      {readouts.length > 0 ? (
        <div className="mt-9 flex flex-wrap gap-x-10 gap-y-4 border-t border-[var(--color-line)] pt-4">
          {readouts.map((readout, i) => (
            <motion.span
              key={readout.label}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionPreset.reveal, delay: 0.38 + i * stagger.item }}
              className="flex flex-col gap-1.5"
            >
              <span className="t-micro text-[var(--color-paper-20)]">{readout.label}</span>
              <span className="t-meta t-tabular text-[var(--color-paper)]">
                {readout.value}
              </span>
            </motion.span>
          ))}
        </div>
      ) : null}
    </header>
  );
}
