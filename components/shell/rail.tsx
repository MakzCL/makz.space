"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { SECTIONS, sectionForPath } from "@/lib/site";
import { duration, ease, motionPreset, spring, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

import { useCommandPalette } from "./command-palette";
import { AppearanceControl } from "./appearance-control";

/**
 * THE RAIL
 *
 * Desktop navigation is a numbered edge index, not a bar of words. Collapsed
 * it shows only indices — the interface stays quiet. Approach it with the
 * pointer or focus it with the keyboard and it unfolds a panel carrying the
 * full index: name, descriptor, and a rule that draws under the row you are
 * pointing at.
 *
 * The active section is marked by a single accent block that travels between
 * cells on a shared layout, so changing section reads as one object moving.
 */
export function Rail() {
  const pathname = usePathname();
  const active = sectionForPath(pathname);
  const reduced = useReducedMotion();
  const palette = useCommandPalette();

  const [open, setOpen] = useState(false);
  const [pointed, setPointed] = useState<string | null>(null);
  const closeTimer = useRef(0);

  const hold = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  }, []);

  const release = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    // A short grace period so crossing the seam between rail and panel, or
    // tabbing between two cells, does not flicker it shut.
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setPointed(null);
    }, 120);
  }, []);

  return (
    <nav
      data-chrome
      aria-label="Sections"
      className="relative z-[var(--z-rail)] hidden w-[var(--unit-rail)] shrink-0 border-r border-[var(--color-line)] bg-[var(--color-base)] lg:flex lg:flex-col"
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) release();
      }}
    >
      {/* The list and the unfolded index share one box, so their rows can
          never drift out of alignment with each other. */}
      <div className="relative flex flex-1 flex-col">
      <ul role="list" className="flex flex-1 flex-col justify-center">
        {SECTIONS.map((section) => {
          const isActive = section.href === active.href;
          return (
            <li key={section.href} className="relative">
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                onPointerEnter={() => setPointed(section.href)}
                onFocus={() => setPointed(section.href)}
                data-cursor="focus"
                className={cx(
                  "relative flex h-16 items-center justify-center transition-colors duration-200",
                  isActive
                    ? "text-[var(--color-paper)]"
                    : "text-[var(--color-paper-20)] hover:text-[var(--color-paper-70)]",
                )}
              >
                {isActive ? (
                  <motion.span
                    layoutId="rail-mark"
                    aria-hidden
                    transition={reduced ? { duration: 0 } : spring.snap}
                    className="absolute left-0 top-1/2 block h-8 w-[2px] -translate-y-1/2 bg-[var(--color-signal)]"
                  />
                ) : null}
                <span className="t-micro t-tabular">{section.index}</span>
                <span className="sr-only">{section.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* The unfolded index. Sits alongside the rail, never over the stage
          content it is describing. */}
      <AnimatePresence>
        {open ? (
          <motion.div
            key="index"
            initial={reduced ? { opacity: 1 } : { clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)", opacity: 1 }}
            exit={
              reduced
                ? { opacity: 0 }
                : {
                    clipPath: "inset(0 100% 0 0)",
                    transition: { duration: duration.fast, ease: ease.in },
                  }
            }
            transition={{ duration: duration.interface, ease: ease.out }}
            className="absolute left-full top-0 h-full w-[23rem] border-r border-[var(--color-line)] bg-[var(--color-base)] shadow-[var(--shadow-lift)]"
          >
            <ul role="list" className="flex h-full flex-col justify-center">
              {SECTIONS.map((section, i) => {
                const isActive = section.href === active.href;
                const isPointed = section.href === pointed;
                return (
                  <li key={section.href}>
                    <Link
                      href={section.href}
                      tabIndex={-1}
                      onPointerEnter={() => setPointed(section.href)}
                      className="group block h-16 px-5"
                    >
                      <motion.div
                        initial={reduced ? false : { opacity: 0, x: -14 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          ...motionPreset.interface,
                          delay: i * stagger.item * 0.6,
                        }}
                        className="flex h-full flex-col justify-center"
                      >
                        <span
                          className={cx(
                            "text-[1.35rem] font-bold leading-none tracking-[-0.03em] transition-colors duration-200",
                            isActive
                              ? "text-[var(--color-signal)]"
                              : isPointed
                                ? "text-[var(--color-paper)]"
                                : "text-[var(--color-paper-35)]",
                          )}
                        >
                          {section.name}
                        </span>
                        <span className="t-micro mt-1.5 block truncate text-[var(--color-paper-20)]">
                          {section.descriptor}
                        </span>
                        <span
                          aria-hidden
                          className={cx(
                            "mt-2 block h-px origin-left bg-[var(--color-signal)] transition-transform duration-300 ease-out",
                            isPointed ? "scale-x-100" : "scale-x-0",
                          )}
                        />
                      </motion.div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
      </div>

      <div className="mt-auto flex flex-col items-center gap-px border-t border-[var(--color-line)] py-3">
        <AppearanceControl orientation="vertical" />
        <button
          type="button"
          onClick={palette.open}
          data-cursor="focus"
          aria-label="Open the command palette"
          className="mt-1 flex h-9 w-9 items-center justify-center border border-[var(--color-edge)] text-[var(--color-paper-35)] transition-colors duration-200 hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]"
        >
          <span className="t-micro">⌘K</span>
        </button>
      </div>

    </nav>
  );
}
