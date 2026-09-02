"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform } from "motion/react";

import { motionPreset } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";
import type { MediaAsset } from "@/types";

interface FrameProps {
  asset: MediaAsset;
  /** Responsive sizes hint. Always pass one — it decides the bytes shipped. */
  sizes: string;
  priority?: boolean;
  /** Vertical drift as the frame crosses the viewport, in percent of height. */
  parallax?: number;
  /**
   * Overrides the asset's own ratio when the layout — not the artwork —
   * decides the shape of the window. Contained art is letterboxed inside it.
   */
  aspect?: string;
  className?: string;
  overlay?: React.ReactNode;
  cursor?: string;
}

/**
 * THE FRAME
 *
 * Media never sits in a rounded card. It sits behind an aperture that opens
 * to reveal it: the mask lifts, the image settles out of a slight over-scale,
 * and until the bytes land there is a ruled placeholder carrying the asset's
 * own metadata rather than a spinner.
 *
 * If the image fails outright, the placeholder becomes a designed missing
 * state — it never collapses the layout.
 */
export function Frame({
  asset,
  sizes,
  priority = false,
  parallax = 0,
  aspect,
  className,
  overlay,
  cursor,
}: FrameProps) {
  const reduced = useReducedMotion();
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"pending" | "ready" | "failed">("pending");

  const { scrollYProgress } = useScroll({
    target: holder,
    offset: ["start end", "end start"],
  });
  const drift = useTransform(
    scrollYProgress,
    [0, 1],
    parallax && !reduced ? [`${parallax}%`, `${-parallax}%`] : ["0%", "0%"],
  );

  return (
    <motion.div
      ref={holder}
      data-cursor={cursor}
      className={cx(
        "relative overflow-hidden bg-[var(--color-surface)]",
        className,
      )}
      style={{ aspectRatio: aspect ?? asset.aspect }}
      initial={reduced ? false : { clipPath: "inset(0 0 100% 0)" }}
      whileInView={{ clipPath: "inset(0 0 0% 0)" }}
      viewport={{ once: true, margin: "-8% 0px" }}
      transition={motionPreset.cinematic}
    >
      {state !== "failed" ? (
        <motion.div
          className="absolute inset-0"
          style={{ y: drift, scale: parallax && !reduced ? 1.12 : 1 }}
        >
          <motion.div
            className="absolute inset-0"
            initial={reduced ? false : { scale: 1.14 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true, margin: "-8% 0px" }}
            transition={motionPreset.cinematic}
          >
            <Image
              src={asset.src}
              alt={asset.alt}
              fill
              sizes={sizes}
              priority={priority}
              loading={priority ? undefined : "lazy"}
              onLoad={() => setState("ready")}
              onError={() => setState("failed")}
              className={cx(
                "transition-opacity duration-500 ease-out",
                asset.fit === "contain" ? "object-contain" : "object-cover",
                state === "ready" ? "opacity-100" : "opacity-0",
              )}
            />
          </motion.div>
        </motion.div>
      ) : null}

      {state !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <span
              aria-hidden
              className={cx(
                "block h-px w-16",
                state === "failed"
                  ? "bg-[var(--color-signal)]"
                  : "animate-pulse bg-[var(--color-paper-20)]",
              )}
            />
            <span
              className={cx(
                "t-micro",
                state === "failed"
                  ? "text-[var(--color-signal)]"
                  : "text-[var(--color-paper-20)]",
              )}
            >
              {state === "failed" ? "Image unavailable" : (asset.meta ?? "Loading")}
            </span>
            {state === "failed" ? (
              <span className="t-micro max-w-[24ch] text-[var(--color-paper-20)]">
                {asset.alt}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {overlay}
    </motion.div>
  );
}
