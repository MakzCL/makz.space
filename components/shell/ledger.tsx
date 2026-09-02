"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { SECTIONS, SITE, sectionForPath } from "@/lib/site";
import { motionPreset } from "@/motion/system";
import { useClock } from "@/hooks/use-clock";
import { cx } from "@/lib/utils";

import { AccountControl } from "./account-control";
import { LiveTick } from "./live-tick";

/**
 * THE LEDGER
 *
 * The top strip is not a navigation bar — it carries no links to sections.
 * It is a data rule: who this is, where you are, what time it is there, and
 * whether the broadcast is up. Navigation lives in the rail and the dock.
 */
export function Ledger() {
  const pathname = usePathname();
  const section = sectionForPath(pathname);
  const { time } = useClock();

  return (
    <header
      data-chrome
      className="relative z-[var(--z-ledger)] flex h-[var(--unit-ledger)] w-full shrink-0 items-stretch border-b border-[var(--color-line)] bg-[var(--color-base)]"
    >
      <Link
        href="/"
        aria-label="MAKZ — standby"
        data-cursor="focus"
        className="group flex items-center gap-2.5 border-r border-[var(--color-line)] px-4 lg:w-[var(--unit-rail)] lg:justify-center lg:px-0"
      >
        <span className="text-[0.9rem] font-extrabold leading-none tracking-[-0.06em] text-[var(--color-paper)]">
          MAKZ
        </span>
        <motion.span
          aria-hidden
          className="block h-1 w-1 bg-[var(--color-signal)]"
          initial={{ opacity: 0.35 }}
          whileHover={{ opacity: 1 }}
          transition={motionPreset.fast}
        />
      </Link>

      {/* Position. Swaps as a rolling pair on every route change. Below 400px
          there is no room for it and the dock already marks the section, so it
          gives way rather than clipping. */}
      <span aria-hidden className="flex-1 min-[400px]:hidden" />
      <div className="hidden min-w-0 flex-1 items-center gap-3 overflow-hidden px-3 min-[400px]:flex sm:px-4">
        <span className="t-micro shrink-0 text-[var(--color-signal)]">
          {section.index}
        </span>
        <span className="reveal-clip block h-3 shrink-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={section.name}
              className="t-micro block whitespace-nowrap text-[var(--color-paper-70)]"
              initial={{ y: "110%" }}
              animate={{ y: "0%" }}
              exit={{ y: "-110%" }}
              transition={motionPreset.interface}
            >
              {section.name}
            </motion.span>
          </AnimatePresence>
        </span>
        <span
          aria-hidden
          className="hidden h-px min-w-4 flex-1 bg-[var(--color-line)] sm:block"
        />
        <span className="t-micro hidden min-w-0 truncate text-[var(--color-paper-20)] xl:block">
          {section.descriptor}
        </span>
      </div>

      <div className="flex shrink-0 items-stretch">
        <LiveTick />

        <div className="hidden items-center gap-2 border-l border-[var(--color-line)] px-4 md:flex">
          <span className="t-micro text-[var(--color-paper-35)]">
            {SITE.locality.slice(0, 3).toUpperCase()}
          </span>
          <span className="t-micro t-tabular text-[var(--color-paper-70)]">
            {time ?? "--:--:--"}
          </span>
        </div>

        <AccountControl />
      </div>
    </header>
  );
}

/** Index of every section, used by the rail, the dock and the palette. */
export const NAV = SECTIONS;

export function activeIndexFor(pathname: string) {
  return NAV.findIndex((node) => node.href === sectionForPath(pathname).href);
}

export { cx };
