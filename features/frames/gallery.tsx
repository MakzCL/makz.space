"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "motion/react";

import { FRAME_SERIES, type FrameSeries } from "@/lib/data/frames";
import { motionPreset, spring, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Frame } from "@/components/media/frame";
import { cx } from "@/lib/utils";
import type { FrameRecord } from "@/types";

/** The full-bleed viewer is fetched when a frame is first opened. */
const Viewer = dynamic(() => import("./viewer").then((m) => m.Viewer), {
  ssr: false,
});

/**
 * Editorial cells. The grid — not the artwork — decides the shape of each
 * window, so a portrait poster and a landscape still can share a row without
 * one of them being three screens tall. Contained art is letterboxed inside
 * its window; the pattern repeats every six items, so any length of
 * collection stays composed.
 */
const CELLS = [
  { span: "md:col-span-7", aspect: "16 / 11" },
  { span: "md:col-span-5", aspect: "4 / 5" },
  { span: "md:col-span-5", aspect: "4 / 5" },
  { span: "md:col-span-7", aspect: "16 / 11" },
  { span: "md:col-span-4", aspect: "3 / 4" },
  { span: "md:col-span-8", aspect: "16 / 9" },
] as const;

export function Gallery({ frames }: { frames: FrameRecord[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const reduced = useReducedMotion();

  const [series, setSeries] = useState<FrameSeries>("All");
  const [direction, setDirection] = useState<1 | -1>(1);
  // Once the viewer has been mounted it stays, so closing keeps its exit
  // animation instead of vanishing with the chunk.
  const [opened, setOpened] = useState(false);

  const visible = useMemo(
    () => (series === "All" ? frames : frames.filter((f) => f.series === series)),
    [frames, series],
  );

  const requested = params.get("frame");
  const activeIndex = requested
    ? visible.findIndex((frame) => frame.slug === requested)
    : -1;

  // A deep link into a filtered-out frame widens the filter rather than
  // showing nothing. Resolved during render so the viewer opens on the first
  // paint instead of flashing an empty grid first.
  if (
    requested &&
    activeIndex === -1 &&
    series !== "All" &&
    frames.some((frame) => frame.slug === requested)
  ) {
    setSeries("All");
  }

  const openAt = useCallback(
    (index: number, dir: 1 | -1 = 1) => {
      const frame = visible[index];
      if (!frame) return;
      setDirection(dir);
      setOpened(true);
      router.replace(`/frames?frame=${frame.slug}`, { scroll: false });
    },
    [router, visible],
  );

  const close = useCallback(() => {
    router.replace("/frames", { scroll: false });
  }, [router]);

  return (
    <>
      {/* Series selector. A rule of switches, not tabs. */}
      <div
        role="tablist"
        aria-label="Series"
        className="flex flex-wrap items-center gap-x-1 gap-y-2 border-y border-[var(--color-line)] px-[var(--unit-gutter)] py-3"
      >
        {FRAME_SERIES.map((option) => {
          const active = option === series;
          const count =
            option === "All"
              ? frames.length
              : frames.filter((frame) => frame.series === option).length;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSeries(option)}
              data-cursor="focus"
              className={cx(
                "relative px-3 py-2 transition-colors duration-200",
                active
                  ? "text-[var(--color-paper)]"
                  : "text-[var(--color-paper-35)] hover:text-[var(--color-paper-70)]",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="series-mark"
                  aria-hidden
                  transition={reduced ? { duration: 0 } : spring.snap}
                  className="absolute inset-x-2 bottom-0 block h-px bg-[var(--color-signal)]"
                />
              ) : null}
              <span className="t-meta">{option}</span>
              <span className="t-micro ml-2 text-[var(--color-paper-20)]">
                {String(count).padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <Empty series={series} onReset={() => setSeries("All")} />
      ) : (
        <ul
          role="list"
          className="grid grid-cols-1 items-start gap-px bg-[var(--color-line)] md:grid-cols-12"
        >
          {visible.map((frame, i) => {
            const cell = CELLS[i % CELLS.length]!;
            return (
            <motion.li
              key={frame.slug}
              initial={reduced ? false : { opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-8% 0px" }}
              transition={{
                ...motionPreset.reveal,
                delay: Math.min(i, 6) * stagger.item,
              }}
              className={cx("relative bg-[var(--color-base)]", cell.span)}
            >
              <button
                type="button"
                onClick={() => openAt(i, 1)}
                data-cursor="view"
                className="group block w-full text-left"
              >
                <Frame
                  asset={frame.asset}
                  aspect={cell.aspect}
                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 40vw"
                  priority={i < 2}
                  className="w-full max-h-[72vh]"
                />
                <span className="flex items-baseline gap-3 px-4 py-3.5">
                  <span className="t-micro t-tabular text-[var(--color-paper-20)] transition-colors duration-200 group-hover:text-[var(--color-signal)]">
                    {frame.index}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[1rem] font-semibold tracking-[-0.025em] text-[var(--color-paper)]">
                      {frame.title}
                    </span>
                    <span className="t-micro mt-1 block truncate text-[var(--color-paper-20)]">
                      {frame.subject}
                    </span>
                  </span>
                  <span className="t-micro shrink-0 text-[var(--color-paper-20)]">
                    {frame.year}
                  </span>
                </span>
              </button>
              </motion.li>
            );
          })}
        </ul>
      )}

      {activeIndex >= 0 || opened ? (
        <Viewer
          frames={visible}
          activeIndex={activeIndex >= 0 ? activeIndex : null}
          direction={direction}
          onClose={close}
          onMove={(index, dir) => openAt(index, dir)}
        />
      ) : null}
    </>
  );
}

/** Empty states get the same attention as full ones. */
function Empty({ series, onReset }: { series: string; onReset: () => void }) {
  return (
    <div className="gutter flex flex-col items-start gap-5 py-24">
      <span aria-hidden className="block h-px w-14 bg-[var(--color-signal)]" />
      <p className="max-w-[20ch] text-[clamp(1.5rem,4vw,2.6rem)] font-bold leading-[0.98] tracking-[-0.04em] text-[var(--color-paper)]">
        Nothing filed under {series}.
      </p>
      <p className="t-body max-w-[46ch]">
        The series exists but has no frames in it yet. New work is added here
        first.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="t-meta border-b border-[var(--color-signal)] pb-1 text-[var(--color-signal)]"
      >
        Show everything
      </button>
    </div>
  );
}
