"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "motion/react";

import { SECTIONS, sectionForPath } from "@/lib/site";
import { spring } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

/** Fetched the first time the index is opened, not with the shell. */
const IndexSheet = dynamic(
  () => import("./index-sheet").then((m) => m.IndexSheet),
  { ssr: false },
);

/** The four sections that earn a permanent thumb position. */
const PRIMARY = SECTIONS.filter((section) =>
  ["/", "/work", "/live", "/gaming"].includes(section.href),
);

/**
 * THE DOCK
 *
 * Mobile navigation sits under the thumb, not behind a hamburger. Four fixed
 * destinations plus the index, which opens the full set as a sheet. The
 * active cell is marked by an accent rule that slides along the top edge —
 * the same object as the rail's marker, in a different orientation.
 */
export function Dock() {
  const pathname = usePathname();
  const active = sectionForPath(pathname);
  const reduced = useReducedMotion();
  const [sheet, setSheet] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  return (
    <>
      <nav
        data-chrome
        aria-label="Sections"
        className="relative z-[var(--z-rail)] shrink-0 border-t border-[var(--color-line)] bg-[var(--color-base)] pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul role="list" className="grid h-[var(--unit-dock)] grid-cols-5">
          {PRIMARY.map((section) => {
            const isActive = section.href === active.href && !sheet;
            return (
              <li key={section.href} className="relative">
                <Link
                  href={section.href}
                  aria-current={isActive ? "page" : undefined}
                  className="flex h-full flex-col items-center justify-center gap-1.5 active:opacity-55"
                >
                  {isActive ? (
                    <motion.span
                      layoutId="dock-mark"
                      aria-hidden
                      transition={reduced ? { duration: 0 } : spring.snap}
                      className="absolute inset-x-3 top-0 block h-[2px] bg-[var(--color-signal)]"
                    />
                  ) : null}
                  <span
                    className={cx(
                      "t-micro t-tabular transition-colors duration-200",
                      isActive ? "text-[var(--color-signal)]" : "text-[var(--color-paper-20)]",
                    )}
                  >
                    {section.index}
                  </span>
                  <span
                    className={cx(
                      "text-[0.6rem] font-semibold uppercase leading-none tracking-[0.1em] transition-colors duration-200",
                      isActive ? "text-[var(--color-paper)]" : "text-[var(--color-paper-35)]",
                    )}
                  >
                    {section.name}
                  </span>
                </Link>
              </li>
            );
          })}

          <li className="relative border-l border-[var(--color-line)]">
            <button
              type="button"
              onClick={() => {
                setEverOpened(true);
                setSheet(true);
              }}
              aria-expanded={sheet}
              aria-haspopup="dialog"
              className="flex h-full w-full flex-col items-center justify-center gap-1.5 active:opacity-55"
            >
              {sheet ? (
                <motion.span
                  layoutId="dock-mark"
                  aria-hidden
                  transition={reduced ? { duration: 0 } : spring.snap}
                  className="absolute inset-x-3 top-0 block h-[2px] bg-[var(--color-signal)]"
                />
              ) : null}
              <span
                aria-hidden
                className="flex flex-col gap-[3px] pt-[3px]"
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="block h-px w-4 bg-[var(--color-paper-50)]"
                    animate={{ width: sheet ? 16 - i * 4 : 16 }}
                    transition={spring.snap}
                  />
                ))}
              </span>
              <span className="text-[0.6rem] font-semibold uppercase leading-none tracking-[0.1em] text-[var(--color-paper-35)]">
                Index
              </span>
            </button>
          </li>
        </ul>
      </nav>

      {everOpened ? (
        <IndexSheet open={sheet} onClose={() => setSheet(false)} />
      ) : null}
    </>
  );
}
