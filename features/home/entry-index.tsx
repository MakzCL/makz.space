"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { AnimatePresence, motion, useMotionValue, useSpring } from "motion/react";

import { SECTIONS } from "@/lib/site";
import { duration, ease, motionPreset, spring } from "@/motion/system";
import { useIsFinePointer } from "@/hooks/use-media-query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

const IB = "https://i.ibb.co";

/** Each destination carries an image; the index is the only place they meet. */
const PLATE: Record<string, { src: string; alt: string }> = {
  "/work": { src: `${IB}/Z6DsR6gs/hq-makz-space.jpg`, alt: "Selected work" },
  "/live": { src: `${IB}/vCgJ75ks/makz-sp-1.jpg`, alt: "The broadcast" },
  "/gaming": { src: `${IB}/yL111TC/makzmc-webbg.png`, alt: "Game servers" },
  "/frames": { src: `${IB}/0y9Hy7h5/NISSAN-GTR-R35-POS.png`, alt: "Poster work" },
  "/signal": { src: `${IB}/nqwD0frf/makz-stam3.jpg`, alt: "Channels" },
};

const ENTRIES = SECTIONS.filter((section) => section.href !== "/");

/**
 * THE ENTRY INDEX
 *
 * Navigation set at display scale. Pointing at a row dims every other row,
 * slides its descriptor in from the right, and brings the destination's image
 * to the cursor on a trailing spring — so the index is also a viewer.
 *
 * On touch there is no follower: each row carries its own plate at the right
 * edge instead, because a cursor-anchored panel has nothing to anchor to.
 */
export function EntryIndex() {
  const [active, setActive] = useState<string | null>(null);
  const fine = useIsFinePointer();
  const reduced = useReducedMotion();
  const holder = useRef<HTMLElement>(null);

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const x = useSpring(px, spring.trail);
  const y = useSpring(py, spring.trail);

  const track = (event: React.PointerEvent) => {
    if (!fine || reduced) return;
    const box = holder.current?.getBoundingClientRect();
    if (!box) return;
    px.set(event.clientX - box.left);
    py.set(event.clientY - box.top);
  };

  const plate = active ? PLATE[active] : undefined;

  return (
    <section
      ref={holder}
      aria-labelledby="entry-index-title"
      onPointerMove={track}
      onPointerLeave={() => setActive(null)}
      className="relative border-t border-[var(--color-line)]"
    >
      <div className="gutter flex items-baseline justify-between gap-6 py-5">
        <h2 id="entry-index-title" className="t-micro text-[var(--color-paper-35)]">
          Index — five destinations
        </h2>
        <span className="t-micro text-[var(--color-paper-20)]">01 / 05</span>
      </div>

      <ul role="list" className="relative z-[var(--z-stage)]">
        {ENTRIES.map((section) => {
          const isActive = active === section.href;
          const dimmed = active !== null && !isActive;
          return (
            <li key={section.href} className="border-t border-[var(--color-line)]">
              <Link
                href={section.href}
                data-cursor="open"
                onPointerEnter={() => setActive(section.href)}
                onFocus={() => setActive(section.href)}
                onBlur={() => setActive(null)}
                className="group flex items-center gap-5 px-[var(--unit-gutter)] py-6 md:py-8"
              >
                <span
                  className={cx(
                    "t-micro t-tabular shrink-0 transition-colors duration-300",
                    isActive ? "text-[var(--color-signal)]" : "text-[var(--color-paper-20)]",
                  )}
                >
                  {section.index}
                </span>

                <motion.span
                  animate={{
                    x: reduced ? 0 : isActive ? 16 : 0,
                    opacity: dimmed ? 0.28 : 1,
                  }}
                  transition={motionPreset.interface}
                  className="block min-w-0 truncate text-[clamp(2.1rem,6vw,5.25rem)] font-bold leading-[0.9] tracking-[-0.035em] text-[var(--color-paper)]"
                >
                  {section.name}
                </motion.span>

                <span className="ml-auto flex items-center gap-5">
                  <motion.span
                    aria-hidden
                    initial={false}
                    animate={{
                      opacity: isActive ? 1 : 0,
                      x: reduced ? 0 : isActive ? 0 : 18,
                    }}
                    transition={motionPreset.interface}
                    className="t-micro hidden max-w-[22ch] text-right leading-[1.7] text-[var(--color-paper-35)] xl:block"
                  >
                    {section.descriptor}
                  </motion.span>

                  {/* Touch plate. */}
                  {!fine && PLATE[section.href] ? (
                    <span className="relative block h-14 w-20 shrink-0 overflow-hidden border border-[var(--color-line)] lg:hidden">
                      <Image
                        src={PLATE[section.href]!.src}
                        alt=""
                        fill
                        sizes="80px"
                        loading="lazy"
                        className="object-cover opacity-70"
                      />
                    </span>
                  ) : null}

                  <span
                    aria-hidden
                    className={cx(
                      "t-micro shrink-0 transition-all duration-300",
                      isActive
                        ? "translate-x-0 text-[var(--color-signal)]"
                        : "-translate-x-2 text-[var(--color-paper-20)]",
                    )}
                  >
                    →
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* The follower. One node, moved by transform only, never re-mounted
          while the pointer travels between rows. */}
      {fine && !reduced ? (
        <motion.div
          aria-hidden
          style={{ x, y }}
          className="pointer-events-none absolute left-0 top-0 z-0 hidden lg:block"
        >
          <div className="relative -translate-x-1/2 -translate-y-1/2">
            <AnimatePresence mode="wait">
              {plate ? (
                <motion.div
                  key={active}
                  initial={{ clipPath: "inset(50% 0 50% 0)", opacity: 0 }}
                  animate={{ clipPath: "inset(0% 0 0% 0)", opacity: 1 }}
                  exit={{
                    clipPath: "inset(50% 0 50% 0)",
                    opacity: 0,
                    transition: { duration: duration.fast, ease: ease.in },
                  }}
                  transition={{ duration: duration.interface, ease: ease.out }}
                  className="relative h-[19rem] w-[14rem] overflow-hidden border border-[var(--color-line-strong)] bg-[var(--color-surface)]"
                >
                  <motion.div
                    className="absolute inset-0"
                    initial={{ scale: 1.2 }}
                    animate={{ scale: 1 }}
                    transition={{ duration: duration.cinematic, ease: ease.out }}
                  >
                    <Image
                      src={plate.src}
                      alt=""
                      fill
                      sizes="224px"
                      loading="lazy"
                      className="object-cover"
                    />
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>
      ) : null}
    </section>
  );
}
