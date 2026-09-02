"use client";

import Image from "next/image";
import { useState } from "react";

import { cx, hashOf, initialsOf } from "@/lib/utils";

/**
 * Avatars are index marks, not circles: a square with the account's initials
 * in mono, and a deterministic accent corner derived from the username so two
 * accounts are never confusable at a glance.
 */
export function Avatar({
  name,
  src,
  size = 34,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const corner = hashOf(name) % 4;
  const corners = ["top-0 left-0", "top-0 right-0", "bottom-0 right-0", "bottom-0 left-0"];

  return (
    <span
      className={cx(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden border border-[var(--color-line-strong)] bg-[var(--color-raised)]",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src && !broken ? (
        <Image
          src={src}
          alt=""
          width={size * 2}
          height={size * 2}
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <>
          <span
            className="t-micro text-[var(--color-paper-70)]"
            style={{ fontSize: Math.max(8, size * 0.28) }}
          >
            {initialsOf(name)}
          </span>
          <span
            aria-hidden
            className={cx("absolute block bg-[var(--color-signal)]", corners[corner])}
            style={{ width: Math.max(3, size * 0.12), height: Math.max(3, size * 0.12) }}
          />
        </>
      )}
    </span>
  );
}
