"use client";

import { useId } from "react";
import { motion } from "motion/react";

import { spring } from "@/motion/system";
import { cx } from "@/lib/utils";

/**
 * A switch shaped like a two-position mechanical selector: a hairline track
 * split in two, with a solid block that slides between the halves. Never a
 * pill, never a shadow.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="min-w-0">
        <label htmlFor={id} className="t-ui block cursor-pointer text-[var(--color-paper)]">
          {label}
        </label>
        {description ? (
          <p className="t-micro mt-1.5 max-w-[46ch] leading-[1.7] tracking-[0.06em] text-[var(--color-paper-35)]">
            {description}
          </p>
        ) : null}
      </div>

      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 grid h-6 w-12 shrink-0 grid-cols-2 border transition-colors duration-200",
          checked
            ? "border-[var(--color-signal)]"
            : "border-[var(--color-edge)] hover:border-[var(--color-paper-35)]",
          disabled && "pointer-events-none opacity-40",
        )}
      >
        <motion.span
          aria-hidden
          layout
          transition={spring.snap}
          className={cx(
            "col-span-1 block h-full w-full",
            checked
              ? "col-start-2 bg-[var(--color-signal)]"
              : "col-start-1 bg-[var(--color-paper-20)]",
          )}
        />
      </button>
    </div>
  );
}

/**
 * A segmented selector. The active cell is marked by a solid block that
 * travels between options on a shared layout id, so switching reads as one
 * object moving rather than two states cross-fading.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  name,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  label: string;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full border border-[var(--color-edge)]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "relative flex-1 px-3 py-3 text-center transition-colors duration-200",
              "border-r border-[var(--color-line)] last:border-r-0",
              active ? "text-[var(--color-void)]" : "text-[var(--color-paper-50)] hover:text-[var(--color-paper)]",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`segment-${name}`}
                transition={spring.snap}
                className="absolute inset-0 bg-[var(--color-paper)]"
              />
            ) : null}
            <span className="relative t-meta">{option.label}</span>
            {option.hint ? (
              <span
                className={cx(
                  "relative mt-1 block t-micro",
                  active ? "text-[var(--color-void)] opacity-55" : "text-[var(--color-paper-20)]",
                )}
              >
                {option.hint}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
