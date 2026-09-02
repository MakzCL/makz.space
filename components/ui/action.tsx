"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";

import { spring } from "@/motion/system";
import { useMagnetic } from "@/hooks/use-magnetic";
import { cx } from "@/lib/utils";

type Tone = "solid" | "line" | "ghost" | "signal";
type Size = "sm" | "md" | "lg";

const TONE: Record<Tone, string> = {
  // Filled paper on ink. The primary commitment in a flow.
  solid:
    "bg-[var(--color-paper)] text-[var(--color-void)] hover:bg-[var(--color-signal)] hover:text-[var(--color-void)]",
  // The default. A hairline that fills from the leading edge on hover.
  line: "border border-[var(--color-edge)] text-[var(--color-paper)] hover:border-[var(--color-signal)] hover:text-[var(--color-signal)]",
  ghost: "text-[var(--color-paper-50)] hover:text-[var(--color-paper)]",
  signal:
    "bg-[var(--color-signal)] text-[var(--color-void)] hover:bg-[var(--color-signal-hi)]",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 gap-2",
  md: "h-11 px-5 gap-3",
  lg: "h-14 px-7 gap-4",
};

interface Common {
  tone?: Tone;
  size?: Size;
  magnetic?: boolean;
  full?: boolean;
  index?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The only button in the system. No radius by default, a hairline border, a
 * monospaced label, an optional index tick, and a press that actually
 * compresses. Magnetic attraction is opt-in and only on fine pointers.
 */
type NativeButton = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onAnimationStart" | "onDragStart" | "onDragEnd" | "onDrag" | "style"
>;

export const Action = forwardRef<HTMLButtonElement, Common & NativeButton>(
  function Action(
    { tone = "line", size = "md", magnetic = false, full, index, className, children, ...rest },
    forwarded,
  ) {
  const { ref, x, y } = useMagnetic<HTMLButtonElement>({ radius: 70, pull: 0.24 });

  return (
    <motion.button
      ref={(node) => {
        ref.current = node;
        if (typeof forwarded === "function") forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      style={magnetic ? { x, y } : undefined}
      whileTap={{ scale: 0.97 }}
      transition={spring.snap}
      className={cx(base(tone, size, full), className)}
      {...rest}
    >
      {index ? <Tick>{index}</Tick> : null}
      <span className="t-meta">{children}</span>
      </motion.button>
    );
  },
);

export function ActionLink({
  href,
  external,
  tone = "line",
  size = "md",
  full,
  index,
  className,
  children,
  cursor,
}: Common & { href: string; external?: boolean; cursor?: string }) {
  const content = (
    <>
      {index ? <Tick>{index}</Tick> : null}
      <span className="t-meta">{children}</span>
      {external ? (
        <span aria-hidden className="t-meta text-current opacity-60">
          ↗
        </span>
      ) : null}
    </>
  );

  const classes = cx(base(tone, size, full), className);

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        data-cursor={cursor ?? "external"}
        className={classes}
      >
        {content}
      </a>
    );
  }

  return (
    <Link href={href} data-cursor={cursor} className={classes}>
      {content}
    </Link>
  );
}

function base(tone: Tone, size: Size, full?: boolean) {
  return cx(
    "group relative inline-flex select-none items-center justify-center whitespace-nowrap",
    "transition-[color,background-color,border-color] duration-200 ease-out",
    "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-signal)]",
    "disabled:pointer-events-none disabled:opacity-40",
    TONE[tone],
    SIZE[size],
    full && "w-full",
  );
}

function Tick({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden className="t-micro opacity-45">
      {children}
    </span>
  );
}
