"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";

import { duration, ease, motionPreset, stagger } from "@/motion/system";
import { useIsFinePointer } from "@/hooks/use-media-query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";
import type { WorkRecord } from "@/types";

/**
 * THE RECORD INDEX
 *
 * Records are a numbered list set at display scale, not a grid of cards.
 * Pointing at a row recomposes the whole screen: the environment behind the
 * list changes to that record's cover, the row's metadata slides in, and
 * every other row falls back to an outline so the list reads as a single
 * selection rather than eight competing objects.
 *
 * The cover lives in one fixed layer and cross-fades between records — the
 * images are never mounted per row, so a long index costs one image at a
 * time regardless of length.
 */
export function RecordIndex({ records }: { records: WorkRecord[] }) {
  const [active, setActive] = useState<string | null>(null);
  const fine = useIsFinePointer();
  const reduced = useReducedMotion();
  const holder = useRef<HTMLDivElement>(null);

  const current = records.find((record) => record.slug === active);

  return (
    <div ref={holder} className="relative">
      {/* Environment layer. Desktop only: on touch the covers travel with
          their rows instead, where a thumb can actually reach them. */}
      {fine ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[38%] overflow-hidden lg:block"
        >
          <AnimatePresence mode="wait">
            {current ? (
              <motion.div
                key={current.slug}
                initial={{ clipPath: "inset(0 0 100% 0)" }}
                animate={{ clipPath: "inset(0 0 0% 0)" }}
                exit={{
                  clipPath: "inset(100% 0 0 0)",
                  transition: { duration: duration.interface, ease: ease.in },
                }}
                transition={{ duration: duration.reveal, ease: ease.out }}
                className="absolute inset-0"
              >
                <motion.div
                  className="absolute inset-0"
                  initial={reduced ? false : { scale: 1.14 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: duration.cinematic, ease: ease.out }}
                >
                  <Image
                    src={current.cover.src}
                    alt=""
                    fill
                    sizes="38vw"
                    className={cx(
                      "opacity-45",
                      current.cover.fit === "contain" ? "object-contain" : "object-cover",
                    )}
                  />
                </motion.div>
                <span className="absolute inset-y-0 left-0 w-px bg-[var(--color-line-strong)]" />
                <span className="absolute inset-0 bg-gradient-to-r from-[var(--color-base)] via-transparent to-transparent" />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}

      <ul
        role="list"
        className="relative z-[var(--z-stage)] border-t border-[var(--color-line)]"
        onPointerLeave={() => setActive(null)}
      >
        {records.map((record, i) => {
          const isActive = active === record.slug;
          const dimmed = active !== null && !isActive;
          return (
            <motion.li
              key={record.slug}
              initial={reduced ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...motionPreset.reveal, delay: 0.08 + i * stagger.item }}
              className="border-b border-[var(--color-line)]"
            >
              <Link
                href={`/work/${record.slug}`}
                data-cursor="view"
                onPointerEnter={() => setActive(record.slug)}
                onFocus={() => setActive(record.slug)}
                onBlur={() => setActive(null)}
                className="group block px-[var(--unit-gutter)] py-5 md:py-7"
              >
                <div className="flex items-start gap-4 md:gap-6">
                  <span
                    className={cx(
                      "t-micro t-tabular mt-2 shrink-0 transition-colors duration-300",
                      isActive ? "text-[var(--color-signal)]" : "text-[var(--color-paper-20)]",
                    )}
                  >
                    {record.index}
                  </span>

                  <div className="min-w-0 flex-1">
                    <motion.span
                      animate={{
                        x: reduced || !fine ? 0 : isActive ? 14 : 0,
                        opacity: dimmed ? 0.3 : 1,
                      }}
                      transition={motionPreset.interface}
                      className="t-title block truncate text-[var(--color-paper)]"
                    >
                      {record.title}
                    </motion.span>

                    <motion.span
                      animate={{ opacity: dimmed ? 0.25 : 1 }}
                      transition={motionPreset.interface}
                      className="mt-3 block max-w-[56ch] text-[0.95rem] leading-[1.55] tracking-[-0.01em] text-[var(--color-paper-50)]"
                    >
                      {record.subtitle}
                    </motion.span>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      {record.discipline.map((item) => (
                        <span key={item} className="t-micro text-[var(--color-paper-20)]">
                          {item}
                        </span>
                      ))}
                    </div>

                    {/* Touch cover: inline, sized for a thumb, lazy. */}
                    <div className="relative mt-4 aspect-[16/9] w-full overflow-hidden border border-[var(--color-line)] lg:hidden">
                      <Image
                        src={record.cover.src}
                        alt={record.cover.alt}
                        fill
                        sizes="(max-width: 1024px) 92vw, 0px"
                        loading={i < 2 ? "eager" : "lazy"}
                        className={cx(
                          "opacity-80",
                          record.cover.fit === "contain" ? "object-contain" : "object-cover",
                        )}
                      />
                    </div>
                  </div>

                  <div className="hidden shrink-0 flex-col items-end gap-2 pt-1 md:flex">
                    <span className="t-micro text-[var(--color-paper-20)]">{record.year}</span>
                    <span
                      className={cx(
                        "t-micro",
                        record.status === "active" || record.status === "ongoing"
                          ? "text-[var(--color-signal)]"
                          : "text-[var(--color-paper-20)]",
                      )}
                    >
                      {record.status.toUpperCase()}
                    </span>
                    <span
                      aria-hidden
                      className={cx(
                        "mt-2 block h-px bg-[var(--color-signal)] transition-all duration-300 ease-out",
                        isActive ? "w-10" : "w-0",
                      )}
                    />
                  </div>
                </div>
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
