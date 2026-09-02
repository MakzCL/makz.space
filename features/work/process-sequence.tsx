"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { useStageScroll } from "@/components/shell/stage-scroll";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx, pad } from "@/lib/utils";
import type { TimelineEntry } from "@/types";

gsap.registerPlugin(ScrollTrigger);

/**
 * THE PROCESS SEQUENCE
 *
 * The one place in the build where scroll is taken over rather than
 * decorated. The panel pins and the phases advance under it, so the reader
 * moves through the process at the pace of the work rather than scrolling
 * past a list of it — the scroll position *is* the timeline.
 *
 * This is what GSAP is here for: a single pinned trigger with a scrubbed
 * progress value. Motion drives everything else in the site; pinning a
 * section to a custom scroll container and scrubbing it frame-accurately is
 * the job it does better.
 *
 * Below tablet width, and under reduced motion, it is a plain ordered list.
 * Nothing about the content depends on the pin.
 */
export function ProcessSequence({ phases }: { phases: TimelineEntry[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useStageScroll();
  const reduced = useReducedMotion();
  const roomy = useMediaQuery("(min-width: 768px)");

  const [progress, setProgress] = useState(0);
  const pinned = roomy && !reduced && phases.length > 1;

  useEffect(() => {
    if (!pinned) return;
    const node = holder.current;
    const panelNode = panel.current;
    const scrollerNode = scroller.current;
    if (!node || !panelNode || !scrollerNode) return;

    const context = gsap.context(() => {
      ScrollTrigger.create({
        trigger: node,
        scroller: scrollerNode,
        pin: panelNode,
        pinType: "transform",
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (self) => setProgress(self.progress),
      });
    }, node);

    // The stage's height changes as fonts land and media resolves.
    const refresh = () => ScrollTrigger.refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(scrollerNode);

    return () => {
      observer.disconnect();
      context.revert();
    };
  }, [pinned, scroller]);

  if (!pinned) {
    return (
      <ol role="list" className="mt-6">
        {phases.map((entry) => (
          <li
            key={entry.phase}
            className="flex gap-5 border-t border-[var(--color-line)] py-4"
          >
            <span className="t-micro t-tabular mt-1 shrink-0 text-[var(--color-signal)]">
              {entry.phase}
            </span>
            <span className="min-w-0">
              <span className="block text-[1.05rem] font-semibold tracking-[-0.02em] text-[var(--color-paper)]">
                {entry.label}
              </span>
              <span className="t-micro mt-1.5 block leading-[1.7] text-[var(--color-paper-35)]">
                {entry.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    );
  }

  // Which phase the scrub is currently sitting on. Clamped rather than
  // rounded, so the last phase holds until the pin releases.
  const index = Math.min(
    phases.length - 1,
    Math.floor(progress * phases.length * 0.999),
  );

  return (
    <div
      ref={holder}
      className="relative mt-8"
      style={{ height: `${phases.length * 58}vh` }}
    >
      <div
        ref={panel}
        className="grid h-[58vh] grid-cols-1 items-center gap-10 lg:grid-cols-[16rem_1fr]"
      >
        {/* The whole sequence, always visible, with the scrub position marked.
            You can see where you are and what is still to come. */}
        <ol role="list" className="hidden lg:block">
          {phases.map((entry, i) => (
            <li
              key={entry.phase}
              aria-current={i === index ? "step" : undefined}
              className="relative border-t border-[var(--color-line)] py-2.5 last:border-b"
            >
              <span
                aria-hidden
                className={cx(
                  "absolute left-0 top-0 block h-[2px] bg-[var(--color-signal)] transition-[width] duration-150 ease-linear",
                )}
                style={{
                  width: `${Math.max(0, Math.min(1, progress * phases.length - i)) * 100}%`,
                }}
              />
              <span className="flex items-baseline gap-3">
                <span
                  className={cx(
                    "t-micro t-tabular transition-colors duration-300",
                    i === index
                      ? "text-[var(--color-signal)]"
                      : "text-[var(--color-paper-20)]",
                  )}
                >
                  {entry.phase}
                </span>
                <span
                  className={cx(
                    "t-meta transition-colors duration-300",
                    i === index
                      ? "text-[var(--color-paper)]"
                      : "text-[var(--color-paper-35)]",
                  )}
                >
                  {entry.label}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {/* Compact scrub for narrower panels. */}
        <div className="flex gap-1.5 lg:hidden" aria-hidden>
          {phases.map((entry, i) => (
            <span
              key={entry.phase}
              className="relative h-[2px] flex-1 overflow-hidden bg-[var(--color-line-strong)]"
            >
              <span
                className="absolute inset-y-0 left-0 block bg-[var(--color-signal)] transition-[width] duration-150 ease-linear"
                style={{
                  width: `${Math.max(0, Math.min(1, progress * phases.length - i)) * 100}%`,
                }}
              />
            </span>
          ))}
        </div>

        {/* The phase itself. Every phase is rendered and cross-faded in place,
            so the panel never reflows as the sequence advances. */}
        <div className="relative min-h-[15rem]">
          <p className="t-micro text-[var(--color-paper-20)]">
            Phase {pad(index + 1)} of {pad(phases.length)}
          </p>

          <div className="relative mt-5 min-h-[12rem]">
            {phases.map((entry, i) => (
              <div
                key={entry.phase}
                aria-hidden={i !== index}
                className={cx(
                  "absolute inset-0 transition-all duration-500 ease-out",
                  i === index
                    ? "translate-y-0 opacity-100"
                    : i < index
                      ? "pointer-events-none -translate-y-5 opacity-0"
                      : "pointer-events-none translate-y-5 opacity-0",
                )}
              >
                <span className="t-micro t-tabular text-[var(--color-signal)]">
                  {entry.phase}
                </span>
                <p className="mt-3 max-w-[18ch] text-[clamp(2rem,5vw,4.25rem)] font-bold leading-[0.96] tracking-[-0.04em] text-[var(--color-paper)]">
                  {entry.label}
                </p>
                <p className="t-body mt-5 max-w-[46ch]">{entry.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The full sequence stays in the document for assistive technology and
          for anyone who lands here with scripting unavailable. */}
      <ol className="sr-only">
        {phases.map((entry) => (
          <li key={entry.phase}>
            {entry.phase} — {entry.label}. {entry.detail}
          </li>
        ))}
      </ol>
    </div>
  );
}
