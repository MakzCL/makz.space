"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";

import { spring } from "@/motion/system";
import { useEnvironment } from "@/components/shell/environment";
import { useToast } from "@/components/shell/toaster";
import { toggleSavedAction } from "@/features/account/actions";
import { cx } from "@/lib/utils";
import type { SavedItemType } from "@/types";

/**
 * KEEP
 *
 * Saving is optimistic: the mark fills the instant it is pressed and the row
 * catches up. If the write fails the mark reverts and the reason is stated —
 * there is no silent success.
 *
 * Signed out, it does not pretend to work. It sends you to the account layer
 * and says why.
 */
export function SaveControl({
  type,
  slug,
  title,
  href,
  saved,
  label = "Keep",
}: {
  type: SavedItemType;
  slug: string;
  title: string;
  href: string;
  saved: boolean;
  label?: string;
}) {
  const { viewer } = useEnvironment();
  const { notify } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [truth, setTruth] = useState(saved);
  const [optimistic, setOptimistic] = useOptimistic(truth);

  const press = () => {
    if (!viewer) {
      notify({
        label: "Sign in to keep records",
        detail: "Saved records live on your account",
        tone: "signal",
      });
      router.push(`/account?next=${encodeURIComponent(href)}`);
      return;
    }

    start(async () => {
      setOptimistic(!optimistic);
      const result = await toggleSavedAction({
        item_type: type,
        item_slug: slug,
        item_title: title,
        item_href: href,
      });

      if (!result.ok) {
        notify({ label: "Could not save", detail: result.message, tone: "fault" });
        return;
      }
      setTruth(result.data?.saved ?? false);
      notify({
        label: result.data?.saved ? "Kept" : "Removed",
        detail: title,
        tone: "signal",
      });
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={press}
      disabled={pending}
      aria-pressed={optimistic}
      data-cursor="focus"
      className={cx(
        "group inline-flex h-11 items-center gap-3 border px-4 transition-colors duration-200",
        optimistic
          ? "border-[var(--color-signal)] text-[var(--color-signal)]"
          : "border-[var(--color-edge)] text-[var(--color-paper-70)] hover:border-[var(--color-paper-35)] hover:text-[var(--color-paper)]",
        pending && "opacity-70",
      )}
    >
      <span className="relative flex h-3 w-3 items-center justify-center">
        <span
          aria-hidden
          className={cx(
            "absolute inset-0 border transition-colors duration-200",
            optimistic ? "border-[var(--color-signal)]" : "border-current",
          )}
        />
        <motion.span
          aria-hidden
          initial={false}
          animate={{ scale: optimistic ? 1 : 0 }}
          transition={spring.snap}
          className="block h-full w-full bg-[var(--color-signal)]"
        />
      </span>
      <span className="t-meta">{optimistic ? "Kept" : label}</span>
    </button>
  );
}
