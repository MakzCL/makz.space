"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { CHANNELS, SECTIONS } from "@/lib/site";
import { WORK } from "@/lib/data/work";
import { FRAMES } from "@/lib/data/frames";
import { CONNECTIONS, GAMES } from "@/lib/data/gaming";
import { duration, ease, motionPreset, spring, stagger } from "@/motion/system";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useLockScroll } from "@/hooks/use-lock-scroll";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useCopy } from "@/hooks/use-copy";
import { cx, fuzzyScore } from "@/lib/utils";
import { signOutAction } from "@/features/account/actions";

import { useEnvironment } from "./environment";
import { useToast } from "./toaster";

type Group = "Sections" | "Records" | "Frames" | "Servers" | "Channels" | "Commands";

interface Entry {
  id: string;
  group: Group;
  label: string;
  detail: string;
  index?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

/**
 * THE CONSOLE
 *
 * ⌘K drops this from the top edge: the query set at display size, the result
 * index beneath it, and a readout of the highlighted entry alongside.
 * Everything addressable in the site is in here — sections, records, frames,
 * servers, channels and account commands — and matching is local, so nothing
 * is requested while typing.
 *
 * Loaded on first open rather than with the shell.
 */
export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { viewer, appearance, setAppearance, motion: motionSetting, setMotion } =
    useEnvironment();
  const { notify } = useToast();
  const { copy } = useCopy();

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useLockScroll(open);
  useFocusTrap(panel, open);

  // Opening resets the console. Derived from the open flag during render so
  // the first painted frame is already empty, never the previous query.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }

  useEffect(() => {
    if (!open) return;
    // Focus after the panel has travelled, so the caret does not appear
    // mid-flight and iOS does not scroll the sheet under the keyboard.
    const id = window.setTimeout(() => input.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const entries = useMemo<Entry[]>(() => {
    const list: Entry[] = [];

    for (const section of SECTIONS) {
      list.push({
        id: `section:${section.href}`,
        group: "Sections",
        index: section.index,
        label: section.name,
        detail: section.descriptor,
        run: () => go(section.href),
      });
    }

    for (const record of WORK) {
      list.push({
        id: `work:${record.slug}`,
        group: "Records",
        index: record.index,
        label: record.title,
        detail: record.subtitle,
        keywords: record.discipline.join(" "),
        run: () => go(`/work/${record.slug}`),
      });
    }

    for (const frame of FRAMES) {
      list.push({
        id: `frame:${frame.slug}`,
        group: "Frames",
        index: frame.index,
        label: frame.title,
        detail: `${frame.subject} — ${frame.series}`,
        run: () => go(`/frames?frame=${frame.slug}`),
      });
    }

    for (const game of GAMES) {
      list.push({
        id: `game:${game.slug}`,
        group: "Servers",
        index: game.index,
        label: game.title,
        detail: game.platform,
        run: () => go(`/gaming#${game.slug}`),
      });
    }

    for (const connection of CONNECTIONS) {
      list.push({
        id: `copy:${connection.key}`,
        group: "Commands",
        label: `Copy ${connection.label.toLowerCase()}`,
        detail: connection.value,
        keywords: "clipboard address ip",
        run: async () => {
          await copy(connection.value);
          notify({ label: "Copied", detail: connection.label, tone: "signal" });
          onClose();
        },
      });
    }

    for (const channel of CHANNELS) {
      list.push({
        id: `channel:${channel.key}`,
        group: "Channels",
        label: channel.label,
        detail: channel.handle,
        run: () => {
          window.open(channel.href, "_blank", "noopener,noreferrer");
          onClose();
        },
      });
    }

    list.push(
      {
        id: "cmd:appearance",
        group: "Commands",
        label: appearance === "day" ? "Switch to dark" : "Switch to day",
        detail: `Currently ${appearance}`,
        keywords: "theme light dark appearance material",
        run: () => {
          setAppearance(appearance === "day" ? "dark" : "day");
          notify({ label: "Appearance changed", tone: "signal" });
          onClose();
        },
      },
      {
        id: "cmd:motion",
        group: "Commands",
        label: motionSetting === "reduced" ? "Restore full motion" : "Reduce motion",
        detail: `Currently ${motionSetting}`,
        keywords: "animation accessibility",
        run: () => {
          setMotion(motionSetting === "reduced" ? "full" : "reduced");
          notify({ label: "Motion updated", tone: "signal" });
          onClose();
        },
      },
    );

    if (viewer) {
      list.push(
        {
          id: "cmd:profile",
          group: "Commands",
          label: "Open profile",
          detail: `@${viewer.profile.username}`,
          run: () => go(`/u/${viewer.profile.username}`),
        },
        {
          id: "cmd:saved",
          group: "Commands",
          label: "Saved records",
          detail: "Everything you kept",
          run: () => go("/saved"),
        },
        {
          id: "cmd:settings",
          group: "Commands",
          label: "Account settings",
          detail: "General, profile, appearance, privacy, security",
          run: () => go("/settings"),
        },
        {
          id: "cmd:signout",
          group: "Commands",
          label: "Sign out",
          detail: "End this session",
          run: async () => {
            onClose();
            await signOutAction();
          },
        },
      );
    } else {
      list.push({
        id: "cmd:signin",
        group: "Commands",
        label: "Sign in",
        detail: "Enter the account layer",
        keywords: "login account register",
        run: () => go("/account"),
      });
    }

    return list;
  }, [appearance, copy, go, motionSetting, notify, onClose, setAppearance, setMotion, viewer]);

  const results = useMemo(() => {
    if (!query.trim()) return entries.slice(0, 40);

    const scored = entries
      .map((entry) => ({
        entry,
        score: Math.max(
          fuzzyScore(query, entry.label) * 2,
          fuzzyScore(query, entry.detail),
          entry.keywords ? fuzzyScore(query, entry.keywords) : 0,
          fuzzyScore(query, entry.group),
        ),
      }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);

    // A loose subsequence match will find something in almost any string, so
    // anything far weaker than the best hit is noise rather than a result.
    const best = scored[0]?.score ?? 0;
    const floor = Math.max(40, best * 0.3);

    return scored
      .filter((row) => row.score >= floor)
      .slice(0, 40)
      .map((row) => row.entry);
  }, [entries, query]);

  // A new query means a new first result; the highlight follows it.
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    if (cursor !== 0) setCursor(0);
  }

  const active = results[cursor];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setCursor((value) => (results.length ? (value + 1) % results.length : 0));
    }
    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setCursor((value) =>
        results.length ? (value - 1 + results.length) % results.length : 0,
      );
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void active?.run();
    }
  };

  // Keep the highlighted row in view without hijacking the page scroll.
  useEffect(() => {
    const node = listRef.current?.children[cursor] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <AnimatePresence>
      {open ? (
        <div data-chrome className="fixed inset-0 z-[var(--z-palette)]">
          <motion.button
            type="button"
            aria-label="Close the command palette"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.interface, ease: ease.out }}
            className="absolute inset-0 h-full w-full cursor-default bg-[var(--color-scrim)] backdrop-blur-[2px]"
          />

          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            initial={reduced ? { opacity: 0 } : { y: "-100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={
              reduced
                ? { opacity: 0 }
                : { y: "-100%", transition: { duration: duration.interface, ease: ease.in } }
            }
            transition={spring.heavy}
            className="absolute inset-x-0 top-0 flex max-h-[86dvh] flex-col border-b border-[var(--color-line-strong)] bg-[var(--color-base)] shadow-[var(--shadow-overlay)]"
          >
            {/* The query, set as interface-scale display type. */}
            <div className="flex items-center gap-4 border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-6 md:py-9">
              <span className="t-micro shrink-0 text-[var(--color-signal)]">
                {String(results.length).padStart(2, "0")}
              </span>
              <div className="relative flex min-w-0 flex-1 items-center">
                <input
                  ref={input}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search everything"
                  aria-label="Search"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-transparent text-[clamp(1.6rem,5vw,3.4rem)] font-bold leading-none tracking-[-0.04em] text-[var(--color-paper)] outline-none placeholder:text-[var(--color-paper-20)]"
                />
                {!reduced ? (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none ml-1 block h-[0.9em] w-[3px] shrink-0 bg-[var(--color-signal)]"
                    animate={{ opacity: [1, 1, 0, 0] }}
                    transition={{ duration: 1.1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
                  />
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="t-micro hidden shrink-0 text-[var(--color-paper-20)] transition-colors duration-150 hover:text-[var(--color-paper)] md:block"
              >
                ESC
              </button>
            </div>

            <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[1fr_20rem]">
              <ul
                ref={listRef}
                role="listbox"
                aria-label="Results"
                className="max-h-[52dvh] min-h-0 overflow-y-auto overscroll-contain"
              >
                {results.length === 0 ? (
                  <li className="gutter py-10">
                    <p className="t-meta text-[var(--color-paper-35)]">
                      Nothing matches “{query}”.
                    </p>
                    <p className="t-micro mt-3 text-[var(--color-paper-20)]">
                      Try a section name, a record, or a machine.
                    </p>
                  </li>
                ) : (
                  results.map((entry, i) => {
                    const isActive = i === cursor;
                    return (
                      <motion.li
                        key={entry.id}
                        role="option"
                        aria-selected={isActive}
                        initial={reduced ? false : { opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          ...motionPreset.fast,
                          delay: Math.min(i, 12) * stagger.item * 0.35,
                        }}
                        onPointerMove={() => setCursor(i)}
                        onClick={() => void entry.run()}
                        className={cx(
                          "relative flex cursor-pointer items-center gap-4 border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-3",
                          isActive ? "bg-[var(--color-surface)]" : "",
                        )}
                      >
                        {isActive ? (
                          <motion.span
                            layoutId="palette-mark"
                            aria-hidden
                            transition={reduced ? { duration: 0 } : spring.snap}
                            className="absolute inset-y-0 left-0 block w-[2px] bg-[var(--color-signal)]"
                          />
                        ) : null}
                        <span className="t-micro w-6 shrink-0 text-[var(--color-paper-20)]">
                          {entry.index ?? "··"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold tracking-[-0.02em] text-[var(--color-paper)]">
                          {entry.label}
                        </span>
                        <span className="t-micro hidden shrink-0 text-[var(--color-paper-20)] sm:block">
                          {entry.group}
                        </span>
                      </motion.li>
                    );
                  })
                )}
              </ul>

              {/* Readout for the highlighted entry. Desktop only — on mobile
                  the list itself is the whole surface. */}
              <aside className="hidden border-l border-[var(--color-line)] p-6 lg:block">
                <AnimatePresence mode="wait" initial={false}>
                  {active ? (
                    <motion.div
                      key={active.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={motionPreset.fast}
                    >
                      <p className="t-micro text-[var(--color-signal)]">{active.group}</p>
                      <p className="mt-4 text-[1.5rem] font-bold leading-none tracking-[-0.035em] text-[var(--color-paper)]">
                        {active.label}
                      </p>
                      <p className="t-body mt-4 text-[0.85rem] leading-relaxed text-[var(--color-paper-50)]">
                        {active.detail}
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-line)] pt-5">
                  {[
                    ["↑ ↓", "Move"],
                    ["↵", "Open"],
                    ["ESC", "Close"],
                  ].map(([key, meaning]) => (
                    <span key={key} className="flex items-center gap-2">
                      <span className="t-micro border border-[var(--color-edge)] px-1.5 py-1 text-[var(--color-paper-50)]">
                        {key}
                      </span>
                      <span className="t-micro text-[var(--color-paper-20)]">{meaning}</span>
                    </span>
                  ))}
                </div>
              </aside>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
