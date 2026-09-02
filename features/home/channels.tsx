"use client";

import { motion } from "motion/react";

import { CHANNELS, SITE } from "@/lib/site";
import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * The closing strip. Channels are listed as a ruled register with the handle
 * as the emphasis — the platform name is metadata, the handle is the address.
 */
export function Channels() {
  const reduced = useReducedMotion();

  return (
    <section
      aria-labelledby="channels-title"
      className="border-t border-[var(--color-line)]"
    >
      <div className="gutter flex items-baseline justify-between gap-6 py-5">
        <h2 id="channels-title" className="t-micro text-[var(--color-paper-35)]">
          Channels
        </h2>
        <span className="t-micro text-[var(--color-paper-20)]">Elsewhere</span>
      </div>

      <ul role="list" className="grid grid-cols-1 border-t border-[var(--color-line)] md:grid-cols-2">
        {CHANNELS.map((channel, i) => (
          <motion.li
            key={channel.key}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ ...motionPreset.reveal, delay: i * stagger.item }}
            className="border-b border-[var(--color-line)] md:[&:nth-child(odd)]:border-r"
          >
            <a
              href={channel.href}
              target="_blank"
              rel="noreferrer noopener"
              data-cursor="external"
              className="group flex items-baseline gap-5 px-[var(--unit-gutter)] py-6 transition-colors duration-200 hover:bg-[var(--color-surface)]"
            >
              <span className="t-micro w-20 shrink-0 text-[var(--color-paper-20)]">
                {channel.label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[clamp(1.1rem,2.4vw,1.6rem)] font-semibold tracking-[-0.03em] text-[var(--color-paper)] transition-colors duration-200 group-hover:text-[var(--color-signal)]">
                  {channel.handle}
                </span>
                <span className="t-micro mt-1.5 block text-[var(--color-paper-20)]">
                  {channel.note}
                </span>
              </span>
              <span
                aria-hidden
                className="t-micro shrink-0 text-[var(--color-paper-20)] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--color-signal)]"
              >
                ↗
              </span>
            </a>
          </motion.li>
        ))}
      </ul>

      <div className="gutter flex flex-wrap items-baseline justify-between gap-4 py-6">
        <span className="t-micro text-[var(--color-paper-20)]">
          © 2026 {SITE.domain} — {SITE.operator}
        </span>
        <span className="t-micro text-[var(--color-paper-20)]">
          Built in {SITE.locality}
        </span>
      </div>
    </section>
  );
}
