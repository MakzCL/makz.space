"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useToast } from "@/components/shell/toaster";
import { ActionLink } from "@/components/ui/action";
import { toggleSavedAction } from "@/features/account/actions";
import { formatRelative } from "@/lib/utils";
import type { SavedItem } from "@/types";

export function SavedList({ items }: { items: SavedItem[] }) {
  const reduced = useReducedMotion();
  const router = useRouter();
  const { notify } = useToast();
  const [pending, start] = useTransition();
  const [removed, setRemoved] = useState<string[]>([]);

  const visible = items.filter((item) => !removed.includes(item.id));

  const release = (item: SavedItem) => {
    start(async () => {
      setRemoved((list) => [...list, item.id]);
      const result = await toggleSavedAction({
        item_type: item.item_type,
        item_slug: item.item_slug,
        item_title: item.item_title,
        item_href: item.item_href,
      });
      if (!result.ok) {
        setRemoved((list) => list.filter((id) => id !== item.id));
        notify({ label: "Could not remove", detail: result.message, tone: "fault" });
        return;
      }
      notify({ label: "Removed", detail: item.item_title, tone: "signal" });
      router.refresh();
    });
  };

  if (visible.length === 0) {
    return (
      <div className="gutter flex flex-col items-start gap-5 border-t border-[var(--color-line)] py-20">
        <span aria-hidden className="block h-px w-14 bg-[var(--color-signal)]" />
        <p className="max-w-[18ch] text-[clamp(1.6rem,4.5vw,3rem)] font-bold leading-[0.98] tracking-[-0.04em] text-[var(--color-paper)]">
          Nothing kept yet.
        </p>
        <p className="t-body max-w-[46ch]">
          The keep control sits at the top of every record and every server. Use
          it and the record lands here, on your account.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <ActionLink href="/work" tone="solid">
            Browse records
          </ActionLink>
          <ActionLink href="/frames" tone="line">
            Browse frames
          </ActionLink>
        </div>
      </div>
    );
  }

  return (
    <ul role="list" className="border-t border-[var(--color-line)]">
      <AnimatePresence initial={false}>
        {visible.map((item, i) => (
          <motion.li
            key={item.id}
            layout
            initial={reduced ? false : { opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24, height: 0 }}
            transition={{ ...motionPreset.reveal, delay: i * stagger.item * 0.6 }}
            className="border-b border-[var(--color-line)]"
          >
            <div className="flex items-center gap-4 px-[var(--unit-gutter)] py-5">
              <span className="t-micro w-14 shrink-0 text-[var(--color-paper-20)]">
                {item.item_type}
              </span>

              <Link
                href={item.item_href}
                className="group min-w-0 flex-1"
                data-cursor="open"
              >
                <span className="block truncate text-[1.15rem] font-semibold tracking-[-0.025em] text-[var(--color-paper)] transition-colors duration-200 group-hover:text-[var(--color-signal)]">
                  {item.item_title}
                </span>
                <span className="t-micro mt-1.5 block text-[var(--color-paper-20)]">
                  Kept {formatRelative(item.created_at)}
                </span>
              </Link>

              <button
                type="button"
                onClick={() => release(item)}
                disabled={pending}
                className="t-micro shrink-0 border border-[var(--color-edge)] px-3 py-2 text-[var(--color-paper-35)] transition-colors duration-200 hover:border-[var(--color-signal)] hover:text-[var(--color-signal)] disabled:opacity-50"
              >
                Release
              </button>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
