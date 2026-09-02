"use client";

import { useState } from "react";
import Image from "next/image";

import { cx } from "@/lib/utils";

/**
 * A small fixed-size image cell — a thumbnail, a filmstrip frame, a readout
 * plate. If the file never arrives it falls back to the item's index rather
 * than a browser broken-image glyph, which is the one thing that makes a
 * careful interface look abandoned.
 */
export function Plate({
  src,
  alt = "",
  label,
  size,
  sizes,
  className,
  imgClassName,
}: {
  src: string;
  alt?: string;
  /** Shown if the image fails. Usually the item's index. */
  label: string;
  /** Tailwind sizing classes for the cell. */
  size: string;
  sizes: string;
  className?: string;
  imgClassName?: string;
}) {
  const [broken, setBroken] = useState(false);

  return (
    <span
      className={cx(
        "relative block shrink-0 overflow-hidden bg-[var(--color-surface)]",
        size,
        className,
      )}
    >
      {broken ? (
        <span className="t-micro absolute inset-0 grid place-items-center text-[var(--color-paper-20)]">
          {label}
        </span>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          loading="lazy"
          onError={() => setBroken(true)}
          className={cx("object-cover", imgClassName)}
        />
      )}
    </span>
  );
}
