"use client";

import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion, type PanInfo } from "motion/react";

import { duration, ease, spring } from "@/motion/system";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useLockScroll } from "@/hooks/use-lock-scroll";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

/**
 * THE SHEET
 *
 * A surface that rises from the bottom edge and can be thrown back down.
 * Dismissal is velocity-aware rather than distance-only, so a quick flick
 * closes it even if it barely moved — which is how a native sheet behaves and
 * why a web one usually feels wrong.
 */
export function Sheet({
  open,
  onClose,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useLockScroll(open);
  useFocusTrap(panel, open);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 140 || info.velocity.y > 520) onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
        <div
          data-chrome
          className="fixed inset-0 z-[var(--z-sheet)]"
          role="presentation"
        >
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.interface, ease: ease.out }}
            className="absolute inset-0 h-full w-full cursor-default bg-[var(--color-scrim)] backdrop-blur-[3px]"
          />

          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { y: "100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={
              reduced
                ? { opacity: 0 }
                : { y: "100%", transition: { duration: duration.interface, ease: ease.in } }
            }
            transition={spring.heavy}
            drag={reduced ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.55 }}
            onDragEnd={onDragEnd}
            className={cx(
              "absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col border-t border-[var(--color-line-strong)] bg-[var(--color-base)] pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-sheet)]",
              className,
            )}
          >
            <div className="flex shrink-0 cursor-grab touch-none items-center justify-center py-3 active:cursor-grabbing">
              <span aria-hidden className="block h-[2px] w-10 bg-[var(--color-paper-20)]" />
            </div>
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
