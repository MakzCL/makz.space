"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { duration, ease, motionPreset, stagger } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Avatar } from "@/components/ui/avatar";
import { signOutAction } from "@/features/account/actions";
import { cx } from "@/lib/utils";

import { useEnvironment } from "./environment";

const ROWS = [
  { label: "Profile", href: "/u/me", note: "Your public record" },
  { label: "Saved", href: "/saved", note: "Kept records" },
  { label: "Settings", href: "/settings", note: "Account and appearance" },
];

/**
 * THE ACCOUNT CONTROL
 *
 * Signed out it is a single word in the ledger. Signed in it becomes the
 * account's mark and handle, and opening it drops a panel that belongs to the
 * strip rather than floating above it: it shares the ledger's right edge,
 * unfolds downward under a clip, and its rows arrive on the shared cadence.
 */
export function AccountControl() {
  const { viewer } = useEnvironment();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const holder = useRef<HTMLDivElement>(null);

  // Navigating closes the menu. Derived from the route during render so the
  // panel is gone in the same commit the new page arrives, not one after.
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!viewer) {
    return (
      <Link
        href="/account"
        data-cursor="focus"
        className="group flex items-center gap-2 border-l border-[var(--color-line)] px-4 text-[var(--color-paper-70)] transition-colors duration-200 hover:bg-[var(--color-paper)] hover:text-[var(--color-void)]"
      >
        <span className="t-micro">SIGN IN</span>
        <span
          aria-hidden
          className="block h-1 w-1 bg-[var(--color-signal)] transition-transform duration-200 group-hover:scale-150"
        />
      </Link>
    );
  }

  const name = viewer.profile.display_name || viewer.profile.username;

  return (
    <div ref={holder} className="relative flex items-stretch">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        data-cursor="focus"
        className={cx(
          "flex items-center gap-2.5 border-l border-[var(--color-line)] px-3 transition-colors duration-200 sm:px-4",
          open ? "bg-[var(--color-raised)]" : "hover:bg-[var(--color-surface)]",
        )}
      >
        <Avatar name={name} src={viewer.profile.avatar_url} size={20} />
        <span className="t-micro hidden text-[var(--color-paper-70)] sm:inline">
          {viewer.profile.username}
        </span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={motionPreset.fast}
          className="t-micro text-[var(--color-paper-20)]"
        >
          ▾
        </motion.span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="menu"
            aria-label="Account"
            initial={reduced ? { opacity: 0 } : { clipPath: "inset(0 0 100% 0)" }}
            animate={{ clipPath: "inset(0 0 0% 0)", opacity: 1 }}
            exit={
              reduced
                ? { opacity: 0 }
                : {
                    clipPath: "inset(0 0 100% 0)",
                    transition: { duration: duration.fast, ease: ease.in },
                  }
            }
            transition={{ duration: duration.interface, ease: ease.out }}
            className="absolute right-0 top-full z-[var(--z-overlay)] w-[19rem] border-b border-l border-[var(--color-line-strong)] bg-[var(--color-base)] shadow-[var(--shadow-overlay)]"
          >
            <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-4 py-4">
              <Avatar name={name} src={viewer.profile.avatar_url} size={40} />
              <div className="min-w-0">
                <p className="truncate text-[0.95rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--color-paper)]">
                  {name}
                </p>
                <p className="t-micro mt-1 truncate text-[var(--color-paper-35)]">
                  @{viewer.profile.username}
                </p>
              </div>
            </div>

            <ul role="list">
              {ROWS.map((row, i) => (
                <motion.li
                  key={row.href}
                  initial={reduced ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    ...motionPreset.interface,
                    delay: 0.04 + i * stagger.item * 0.7,
                  }}
                >
                  <Link
                    href={row.href}
                    role="menuitem"
                    className="group flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3 transition-colors duration-150 hover:bg-[var(--color-surface)]"
                  >
                    <span className="t-meta text-[var(--color-paper)]">{row.label}</span>
                    <span className="t-micro text-[var(--color-paper-20)] transition-colors duration-150 group-hover:text-[var(--color-signal)]">
                      {row.note}
                    </span>
                  </Link>
                </motion.li>
              ))}
            </ul>

            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => start(() => void signOutAction())}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors duration-150 hover:bg-[var(--color-signal-12)] disabled:opacity-50"
            >
              <span className="t-meta text-[var(--color-signal)]">
                {pending ? "Signing out" : "Sign out"}
              </span>
              <span aria-hidden className="t-micro text-[var(--color-signal)]">
                {pending ? "···" : "↩"}
              </span>
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
