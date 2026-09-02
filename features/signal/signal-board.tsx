"use client";

import { motion } from "motion/react";

import { CHANNELS, SITE } from "@/lib/site";
import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useClock } from "@/hooks/use-clock";
import { ActionLink } from "@/components/ui/action";

/**
 * SIGNAL
 *
 * Channels set as a register at display scale: the handle is the address, the
 * platform is metadata. Below it, the two things people actually come here to
 * do — join the community, or get in contact — given equal weight instead of
 * being buried in a footer.
 */
export function SignalBoard() {
  const reduced = useReducedMotion();
  const { time } = useClock();

  return (
    <div>
      <ul role="list" className="border-t border-[var(--color-line)]">
        {CHANNELS.map((channel, i) => (
          <motion.li
            key={channel.key}
            initial={reduced ? false : { opacity: 0, x: -18 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ ...motionPreset.reveal, delay: i * stagger.item }}
            className="border-b border-[var(--color-line)]"
          >
            <a
              href={channel.href}
              target="_blank"
              rel="noreferrer noopener"
              data-cursor="external"
              className="group flex items-center gap-5 px-[var(--unit-gutter)] py-6 transition-colors duration-200 hover:bg-[var(--color-surface)] md:py-8"
            >
              <span className="t-micro t-tabular w-8 shrink-0 text-[var(--color-paper-20)]">
                {String(i + 1).padStart(2, "0")}
              </span>

              <span className="min-w-0 flex-1">
                <span className="t-title block truncate text-[var(--color-paper)] transition-colors duration-200 group-hover:text-[var(--color-signal)]">
                  {channel.handle}
                </span>
                <span className="t-micro mt-2 block text-[var(--color-paper-20)]">
                  {channel.label} — {channel.note}
                </span>
              </span>

              <span
                aria-hidden
                className="t-micro shrink-0 text-[var(--color-paper-20)] transition-all duration-300 group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-[var(--color-signal)]"
              >
                ↗
              </span>
            </a>
          </motion.li>
        ))}
      </ul>

      <div className="grid grid-cols-1 border-b border-[var(--color-line)] lg:grid-cols-2">
        <section className="border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-10 lg:border-b-0 lg:border-r">
          <h2 className="t-micro text-[var(--color-paper-35)]">Community</h2>
          <p className="mt-5 max-w-[24ch] text-[clamp(1.4rem,3.4vw,2.2rem)] font-bold leading-[1.02] tracking-[-0.035em] text-[var(--color-paper)]">
            Stream chat, server talk, support.
          </p>
          <p className="t-body mt-5 max-w-[48ch]">
            The Discord is where sessions get announced, convoys get organised
            and MakzMC problems get solved. It is the fastest way to reach me.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ActionLink href="https://discord.gg/HWUrCtQar8" external tone="solid">
              Join the Discord
            </ActionLink>
            <ActionLink href="https://discord.gg/mTPNyBdPSU" external tone="line">
              MakzMC server
            </ActionLink>
          </div>
        </section>

        <section className="px-[var(--unit-gutter)] py-10">
          <h2 className="t-micro text-[var(--color-paper-35)]">Location</h2>
          <dl className="mt-6">
            {[
              { label: "Based", value: `${SITE.locality}, ${SITE.region}` },
              { label: "Local time", value: time ?? "--:--:--" },
              {
                label: "Coordinates",
                value: `${SITE.coordinates.lat.toFixed(4)}N ${Math.abs(
                  SITE.coordinates.lon,
                ).toFixed(4)}W`,
              },
              { label: "Working on", value: "Design, broadcast, servers" },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-baseline gap-4 border-t border-[var(--color-line)] py-3.5"
              >
                <dt className="t-micro w-28 shrink-0 text-[var(--color-paper-20)]">
                  {row.label}
                </dt>
                <dd className="t-ui t-tabular text-[var(--color-paper)]">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <div className="gutter flex flex-wrap items-baseline justify-between gap-4 py-6">
        <span className="t-micro text-[var(--color-paper-20)]">
          © 2026 {SITE.domain} — {SITE.operator}
        </span>
        <span className="t-micro text-[var(--color-paper-20)]">All rights reserved</span>
      </div>
    </div>
  );
}
