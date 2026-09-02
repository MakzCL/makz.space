"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, type PanInfo } from "motion/react";

import { duration, ease, motionPreset, spring } from "@/motion/system";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useLockScroll } from "@/hooks/use-lock-scroll";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Plate } from "@/components/media/plate";
import { cx } from "@/lib/utils";
import type { FrameRecord } from "@/types";

/** A filmstrip cell. */
function Thumb({
  frame,
  active,
  onSelect,
}: {
  frame: FrameRecord;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={frame.title}
      aria-current={active}
      className={cx(
        "block shrink-0 border transition-opacity duration-200",
        active
          ? "border-[var(--color-signal)] opacity-100"
          : "border-transparent opacity-40 hover:opacity-80",
      )}
    >
      <Plate src={frame.asset.src} label={frame.index} size="h-12 w-16" sizes="64px" />
    </button>
  );
}

/**
 * THE VIEWER
 *
 * Full-bleed, black, and the image is the only lit object. Metadata runs
 * along the bottom rule with a filmstrip beside it; the arrow keys, a drag,
 * or a click on the strip move between frames. Direction is preserved — going
 * forward always enters from the right — so the sequence has a geography.
 */
export function Viewer({
  frames,
  activeIndex,
  direction,
  onClose,
  onMove,
}: {
  frames: FrameRecord[];
  activeIndex: number | null;
  direction: 1 | -1;
  onClose: () => void;
  onMove: (next: number, direction: 1 | -1) => void;
}) {
  const open = activeIndex !== null;
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);

  useLockScroll(open);
  useFocusTrap(panel, open);

  // Per-frame load state, keyed by slug so moving between frames resets it.
  const [plate, setPlate] = useState<{ slug: string; state: "pending" | "ready" | "failed" }>(
    { slug: "", state: "pending" },
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      if (activeIndex === null) return;
      const next = (activeIndex + delta + frames.length) % frames.length;
      onMove(next, delta);
    },
    [activeIndex, frames.length, onMove],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open, step]);

  // Keep the current thumbnail visible in the strip.
  useEffect(() => {
    if (activeIndex === null) return;
    const node = strip.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeIndex]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -80 || info.velocity.x < -420) step(1);
    else if (info.offset.x > 80 || info.velocity.x > 420) step(-1);
  };

  const frame = activeIndex !== null ? frames[activeIndex] : undefined;

  return (
    <AnimatePresence>
      {open && frame ? (
        <motion.div
          ref={panel}
          data-chrome
          role="dialog"
          aria-modal="true"
          aria-label={`${frame.title} — ${frame.subject}`}
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: duration.interface } }}
          transition={{ duration: duration.interface, ease: ease.out }}
          className="fixed inset-0 z-[var(--z-overlay)] flex flex-col bg-[var(--color-void)]"
        >
          {/* Head rule */}
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-3">
            <span className="flex items-center gap-3">
              <span className="t-micro t-tabular text-[var(--color-signal)]">
                {frame.index}
              </span>
              <span className="t-micro text-[var(--color-paper-35)]">
                {frame.series}
              </span>
            </span>
            <span className="t-micro t-tabular text-[var(--color-paper-20)]">
              {String(activeIndex + 1).padStart(2, "0")} /{" "}
              {String(frames.length).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={onClose}
              data-cursor="close"
              className="t-micro text-[var(--color-paper-35)] transition-colors duration-200 hover:text-[var(--color-paper)]"
            >
              CLOSE ESC
            </button>
          </div>

          {/* Plate */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={frame.slug}
                custom={direction}
                drag={reduced ? false : "x"}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.14}
                onDragEnd={onDragEnd}
                data-cursor="drag"
                initial={
                  reduced
                    ? { opacity: 0 }
                    : { x: `${direction * 42}%`, opacity: 0, scale: 0.97 }
                }
                animate={{ x: 0, opacity: 1, scale: 1 }}
                exit={
                  reduced
                    ? { opacity: 0 }
                    : {
                        x: `${direction * -42}%`,
                        opacity: 0,
                        scale: 0.97,
                        transition: { duration: duration.interface, ease: ease.in },
                      }
                }
                transition={spring.heavy}
                className="absolute inset-0 flex touch-pan-y items-center justify-center p-4 md:p-10"
              >
                <div className="relative h-full w-full">
                  <Image
                    src={frame.asset.src}
                    alt={frame.asset.alt}
                    fill
                    sizes="100vw"
                    priority
                    onLoad={() => setPlate({ slug: frame.slug, state: "ready" })}
                    onError={() => setPlate({ slug: frame.slug, state: "failed" })}
                    className={cx(
                      "select-none object-contain transition-opacity duration-500",
                      plate.slug === frame.slug && plate.state === "ready"
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                    draggable={false}
                  />

                  {plate.slug !== frame.slug || plate.state !== "ready" ? (
                    <div className="pointer-events-none absolute inset-0 grid place-items-center">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <span
                          aria-hidden
                          className={cx(
                            "block h-px w-20",
                            plate.slug === frame.slug && plate.state === "failed"
                              ? "bg-[var(--color-signal)]"
                              : "animate-pulse bg-[var(--color-paper-20)]",
                          )}
                        />
                        <span
                          className={cx(
                            "t-micro",
                            plate.slug === frame.slug && plate.state === "failed"
                              ? "text-[var(--color-signal)]"
                              : "text-[var(--color-paper-20)]",
                          )}
                        >
                          {plate.slug === frame.slug && plate.state === "failed"
                            ? "Image unavailable"
                            : `Loading ${frame.index}`}
                        </span>
                        {plate.slug === frame.slug && plate.state === "failed" ? (
                          <span className="t-micro max-w-[28ch] leading-[1.8] text-[var(--color-paper-20)]">
                            {frame.asset.alt}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Edge steps. Large hit areas, invisible until pointed at. */}
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous frame"
              data-cursor="prev"
              className="absolute inset-y-0 left-0 w-[18%] cursor-none opacity-0"
            />
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next frame"
              data-cursor="next"
              className="absolute inset-y-0 right-0 w-[18%] cursor-none opacity-0"
            />
          </div>

          {/* Foot rule: metadata plus filmstrip */}
          <div className="shrink-0 border-t border-[var(--color-line)]">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={frame.slug}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={motionPreset.fast}
                  className="text-[1.05rem] font-bold tracking-[-0.03em] text-[var(--color-paper)]"
                >
                  {frame.title}
                </motion.span>
              </AnimatePresence>
              <span className="t-micro text-[var(--color-paper-35)]">{frame.subject}</span>
              <span className="t-micro text-[var(--color-paper-20)]">{frame.medium}</span>
              <span className="t-micro t-tabular ml-auto text-[var(--color-paper-20)]">
                {frame.year}
              </span>
            </div>

            <div
              ref={strip}
              className="flex gap-px overflow-x-auto border-t border-[var(--color-line)] px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
            >
              {frames.map((item, i) => (
                <Thumb
                  key={item.slug}
                  frame={item}
                  active={i === activeIndex}
                  onSelect={() => onMove(i, i > (activeIndex ?? 0) ? 1 : -1)}
                />
              ))}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
