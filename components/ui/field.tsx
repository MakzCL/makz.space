"use client";

import { useId, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AnimatePresence, motion } from "motion/react";

import { motionPreset } from "@/motion/system";
import { cx } from "@/lib/utils";

interface FieldShell {
  label: string;
  hint?: string;
  error?: string | null;
  index?: string;
  /** Right-aligned control inside the field, e.g. a reveal toggle. */
  trailing?: React.ReactNode;
}

/**
 * A field is a ruled line, not a box. The label sits above in micro type, the
 * rule under the input turns to signal on focus and draws in from the left,
 * and errors arrive under the rule without shifting the layout above them.
 */
export function Field({
  label,
  hint,
  error,
  index,
  trailing,
  className,
  ...rest
}: FieldShell & InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cx("group relative", className)}>
      <Head id={id} label={label} index={index} error={error} />
      <div className="relative flex items-center">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          data-focus-inset
          className={cx(
            "h-11 w-full bg-transparent pr-9 text-[0.95rem] tracking-[-0.01em] outline-none",
            "text-[var(--color-paper)] placeholder:text-[var(--color-paper-20)]",
            "autofill:bg-transparent",
          )}
          {...rest}
        />
        {trailing ? <div className="absolute right-0">{trailing}</div> : null}
      </div>
      <Rule focused={focused} error={Boolean(error)} />
      <Foot id={id} hint={hint} error={error} />
    </div>
  );
}

export function AreaField({
  label,
  hint,
  error,
  index,
  className,
  ...rest
}: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }) {
  const id = useId();
  const [focused, setFocused] = useState(false);

  return (
    <div className={cx("group relative", className)}>
      <Head id={id} label={label} index={index} error={error} />
      <textarea
        id={id}
        rows={4}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onFocus={(event) => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          rest.onBlur?.(event);
        }}
        data-focus-inset
        className="w-full resize-none bg-transparent py-2 text-[0.95rem] leading-relaxed tracking-[-0.01em] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-paper-20)]"
        {...rest}
      />
      <Rule focused={focused} error={Boolean(error)} />
      <Foot id={id} hint={hint} error={error} />
    </div>
  );
}

function Head({
  id,
  label,
  index,
  error,
}: {
  id: string;
  label: string;
  index?: string;
  error?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-1">
      <label
        htmlFor={id}
        className={cx(
          "t-micro transition-colors duration-200",
          error ? "text-[var(--color-signal)]" : "text-[var(--color-paper-35)]",
        )}
      >
        {label}
      </label>
      {index ? (
        <span aria-hidden className="t-micro text-[var(--color-paper-20)]">
          {index}
        </span>
      ) : null}
    </div>
  );
}

function Rule({ focused, error }: { focused: boolean; error: boolean }) {
  return (
    <div className="relative h-px w-full bg-[var(--color-edge)]">
      <motion.span
        aria-hidden
        className="absolute inset-y-0 left-0 block w-full origin-left bg-[var(--color-signal)]"
        initial={false}
        animate={{ scaleX: error || focused ? 1 : 0 }}
        transition={motionPreset.interface}
      />
    </div>
  );
}

function Foot({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: string;
  error?: string | null;
}) {
  return (
    <div className="min-h-[1.35rem] pt-1.5">
      <AnimatePresence mode="wait" initial={false}>
        {error ? (
          <motion.p
            key="error"
            id={`${id}-error`}
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={motionPreset.fast}
            className="t-micro text-[var(--color-signal)]"
          >
            {error}
          </motion.p>
        ) : hint ? (
          <motion.p
            key="hint"
            id={`${id}-hint`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionPreset.fast}
            className="t-micro text-[var(--color-paper-20)]"
          >
            {hint}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
