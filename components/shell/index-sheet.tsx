"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

import { CHANNELS, SECTIONS, sectionForPath } from "@/lib/site";
import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

import { AppearanceControl } from "./appearance-control";
import { Sheet } from "./sheet";
import { useCommandPalette } from "./command-palette";

/**
 * The full index on mobile. Sections are set at display size so the list is
 * the page rather than a menu on top of one; each row arrives on the shared
 * item cadence and the active one is marked in signal.
 */
export function IndexSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const active = sectionForPath(pathname);
  const reduced = useReducedMotion();
  const palette = useCommandPalette();

  return (
    <Sheet open={open} onClose={onClose} label="Index">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ul role="list" className="border-t border-[var(--color-line)]">
          {SECTIONS.map((section, i) => {
            const isActive = section.href === active.href;
            return (
              <motion.li
                key={section.href}
                initial={reduced ? false : { opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...motionPreset.reveal, delay: 0.04 + i * stagger.item }}
                className="border-b border-[var(--color-line)]"
              >
                <Link
                  href={section.href}
                  onClick={onClose}
                  aria-current={isActive ? "page" : undefined}
                  className="flex items-baseline gap-4 px-[var(--unit-gutter)] py-4 active:bg-[var(--color-surface)]"
                >
                  <span
                    className={cx(
                      "t-micro t-tabular shrink-0",
                      isActive ? "text-[var(--color-signal)]" : "text-[var(--color-paper-20)]",
                    )}
                  >
                    {section.index}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cx(
                        "block text-[1.75rem] font-bold leading-none tracking-[-0.035em]",
                        isActive ? "text-[var(--color-signal)]" : "text-[var(--color-paper)]",
                      )}
                    >
                      {section.name}
                    </span>
                    <span className="t-micro mt-2 block text-[var(--color-paper-20)]">
                      {section.descriptor}
                    </span>
                  </span>
                </Link>
              </motion.li>
            );
          })}
        </ul>

        <div className="gutter flex items-center justify-between gap-4 py-5">
          <span className="t-micro text-[var(--color-paper-20)]">Appearance</span>
          <AppearanceControl orientation="horizontal" />
        </div>

        <div className="gutter pb-6">
          <button
            type="button"
            onClick={() => {
              onClose();
              palette.open();
            }}
            className="flex w-full items-center justify-between border border-[var(--color-edge)] px-4 py-3.5 text-left active:bg-[var(--color-surface)]"
          >
            <span className="t-meta text-[var(--color-paper)]">Search everything</span>
            <span className="t-micro text-[var(--color-paper-20)]">Command</span>
          </button>
        </div>

        <ul
          role="list"
          className="grid grid-cols-2 border-t border-[var(--color-line)]"
        >
          {CHANNELS.map((channel) => (
            <li
              key={channel.key}
              className="border-b border-r border-[var(--color-line)] last:border-r-0 [&:nth-child(2n)]:border-r-0"
            >
              <a
                href={channel.href}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center justify-between px-[var(--unit-gutter)] py-3.5 active:bg-[var(--color-surface)]"
              >
                <span className="t-meta text-[var(--color-paper-70)]">{channel.label}</span>
                <span aria-hidden className="t-micro text-[var(--color-paper-20)]">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
