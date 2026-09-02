"use client";

import { AnimatePresence, motion } from "motion/react";

import { duration, ease, spring } from "@/motion/system";
import { useOnline } from "@/hooks/use-online";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * THE CONNECTION RULE
 *
 * When the device drops off the network, a rule drops out of the ledger and
 * says so plainly. It explains what still works — every section already
 * loaded, because the shell never unloads — and what does not.
 *
 * It is a statement, not a modal: nothing is blocked, nothing is covered, and
 * it leaves on its own the moment the connection returns.
 */
export function Connection() {
  const online = useOnline();
  const reduced = useReducedMotion();

  return (
    <AnimatePresence>
      {!online ? (
        <motion.div
          data-chrome
          role="status"
          aria-live="polite"
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1 }}
          exit={
            reduced
              ? { opacity: 0 }
              : {
                  height: 0,
                  opacity: 0,
                  transition: { duration: duration.interface, ease: ease.in },
                }
          }
          transition={spring.glide}
          className="relative z-[var(--z-ledger)] shrink-0 overflow-hidden border-b border-[var(--color-signal)] bg-[var(--color-signal-12)]"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="block h-1.5 w-1.5 bg-[var(--color-signal)]"
              />
              <span className="t-micro text-[var(--color-signal)]">
                No network
              </span>
            </span>
            <span className="t-micro text-[var(--color-paper-50)]">
              Sections you have already opened still work. Live state, media and
              sign-in will resume on their own.
            </span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
