"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { motionPreset } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Rolling } from "@/components/ui/rolling";
import { cx } from "@/lib/utils";

import { useLiveStatus } from "./live-status";

/**
 * Broadcast state in the ledger. Online, it is the only accent in the strip
 * and it pulses on the same cadence as the viewer count updates. Offline, it
 * reads as an inert label rather than disappearing — absence is information.
 */
export function LiveTick() {
  const { status } = useLiveStatus();
  const reduced = useReducedMotion();

  return (
    <Link
      href="/live"
      data-cursor="focus"
      aria-label={
        status.online
          ? `Broadcast online, ${status.viewers} watching`
          : "Broadcast offline"
      }
      className={cx(
        "group flex items-center gap-2 border-l border-[var(--color-line)] px-3.5 transition-colors duration-200 sm:px-4",
        status.online
          ? "text-[var(--color-signal)] hover:bg-[var(--color-signal-12)]"
          : "text-[var(--color-paper-35)] hover:text-[var(--color-paper-70)]",
      )}
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0 items-center justify-center">
        <span
          className={cx(
            "block h-1.5 w-1.5",
            status.online ? "bg-[var(--color-signal)]" : "bg-[var(--color-paper-20)]",
          )}
        />
        {status.online && !reduced ? (
          <motion.span
            aria-hidden
            className="absolute inset-0 bg-[var(--color-signal)]"
            animate={{ opacity: [0.9, 0, 0.9], scale: [1, 2.6, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
          />
        ) : null}
      </span>

      <span className="t-micro">{status.online ? "LIVE" : "OFFLINE"}</span>

      {status.online ? (
        <motion.span
          initial={{ opacity: 0, width: 0 }}
          animate={{ opacity: 1, width: "auto" }}
          transition={motionPreset.interface}
          className="t-micro t-tabular hidden overflow-hidden text-[var(--color-signal)] sm:inline-flex"
        >
          <Rolling value={status.viewers} />
        </motion.span>
      ) : null}
    </Link>
  );
}
