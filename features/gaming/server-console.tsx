"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";

import { GAME_ART } from "@/lib/data/gaming";
import { duration, ease, motionPreset } from "@/motion/system";
import { useCopy } from "@/hooks/use-copy";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useToast } from "@/components/shell/toaster";
import { Rolling } from "@/components/ui/rolling";
import { ActionLink } from "@/components/ui/action";
import { SaveControl } from "@/features/saved/save-control";
import { cx } from "@/lib/utils";
import type { GameRecord, MinecraftStatus } from "@/types";

/**
 * THE SERVER CONSOLE
 *
 * Two machines, presented as operating equipment rather than product cards:
 * cover art bleeds behind a numbered header, connection details are copyable
 * controls instead of text to be selected by hand, and live player counts are
 * probed server-side and refreshed in place.
 */
export function ServerConsole({
  games,
  initialMinecraft,
  savedSlugs,
}: {
  games: GameRecord[];
  initialMinecraft: MinecraftStatus;
  savedSlugs: string[];
}) {
  const [mc, setMc] = useState(initialMinecraft);
  const reduced = useReducedMotion();

  // Re-probe while the tab is open; the route handler caches so this is cheap.
  useEffect(() => {
    const host = games.find((game) => game.probe)?.probe?.host;
    if (!host) return;

    let cancelled = false;
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(
          `/api/gaming/minecraft?host=${encodeURIComponent(host)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const next = (await response.json()) as MinecraftStatus;
        if (!cancelled) setMc(next);
      } catch {
        // Keep the last reading rather than blanking the panel.
      }
    };

    const id = window.setInterval(read, 60_000);
    document.addEventListener("visibilitychange", read);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", read);
    };
  }, [games]);

  return (
    <div className="border-t border-[var(--color-line)]">
      {games.map((game, i) => (
        <Machine
          key={game.slug}
          game={game}
          order={i}
          reduced={reduced}
          saved={savedSlugs.includes(game.slug)}
          live={game.probe ? mc : null}
        />
      ))}
    </div>
  );
}

function Machine({
  game,
  order,
  reduced,
  saved,
  live,
}: {
  game: GameRecord;
  order: number;
  reduced: boolean;
  saved: boolean;
  live: MinecraftStatus | null;
}) {
  const art = GAME_ART[game.slug];
  const online = live ? live.online : game.status !== "idle";

  return (
    <section
      id={game.slug}
      aria-labelledby={`${game.slug}-title`}
      className="relative border-b border-[var(--color-line)]"
    >
      {/* Cover art, bled behind the header at low opacity and masked out to
          the left so the type always sits on flat material. */}
      {art ? (
        <motion.div
          aria-hidden
          initial={reduced ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: duration.cinematic, ease: ease.out }}
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] md:block"
        >
          <Image
            src={art}
            alt=""
            fill
            sizes="52vw"
            loading={order === 0 ? "eager" : "lazy"}
            className="object-cover opacity-[0.16]"
          />
          <span className="absolute inset-0 bg-gradient-to-r from-[var(--color-base)] via-[var(--color-base)]/40 to-transparent" />
        </motion.div>
      ) : null}

      <div className="relative px-[var(--unit-gutter)] py-10 md:py-14">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10% 0px" }}
          transition={motionPreset.reveal}
        >
          <div className="flex items-center gap-3">
            <span className="t-micro t-tabular text-[var(--color-signal)]">
              {game.index}
            </span>
            <span aria-hidden className="block h-px w-8 bg-[var(--color-line-strong)]" />
            <span className="t-micro text-[var(--color-paper-20)]">{game.platform}</span>
          </div>

          <h2
            id={`${game.slug}-title`}
            className="t-title mt-4 max-w-[16ch] text-[var(--color-paper)]"
          >
            {game.title}
          </h2>

          <p className="t-body mt-5 max-w-[54ch]">{game.detail}</p>
        </motion.div>

        {/* Live state. */}
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-[var(--color-line)] pt-5">
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden
              className={cx(
                "block h-1.5 w-1.5",
                online ? "bg-[var(--color-signal)]" : "bg-[var(--color-paper-20)]",
              )}
            />
            <span
              className={cx(
                "t-micro",
                online ? "text-[var(--color-signal)]" : "text-[var(--color-paper-35)]",
              )}
            >
              {live
                ? live.online
                  ? "REACHABLE"
                  : "UNREACHABLE"
                : game.status.toUpperCase()}
            </span>
          </span>

          <AnimatePresence mode="popLayout">
            {live?.online && live.players ? (
              <motion.span
                key="players"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={motionPreset.fast}
                className="flex items-baseline gap-2"
              >
                <span className="t-micro text-[var(--color-paper-20)]">Players</span>
                <span className="t-micro t-tabular text-[var(--color-paper)]">
                  <Rolling value={live.players.online} /> / {live.players.max}
                </span>
              </motion.span>
            ) : null}
          </AnimatePresence>

          {live?.version ? (
            <span className="flex items-baseline gap-2">
              <span className="t-micro text-[var(--color-paper-20)]">Version</span>
              <span className="t-micro text-[var(--color-paper-70)]">{live.version}</span>
            </span>
          ) : null}

          <span className="flex items-baseline gap-2">
            <span className="t-micro text-[var(--color-paper-20)]">Role</span>
            <span className="t-micro text-[var(--color-paper-70)]">{game.role}</span>
          </span>
        </div>

        {/* Connection details as controls. */}
        <dl className="mt-8 grid grid-cols-1 gap-px border border-[var(--color-line)] sm:grid-cols-2">
          {game.facts.map((fact) => (
            <CopyRow key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </dl>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SaveControl
            type="game"
            slug={game.slug}
            title={game.title}
            href={`/gaming#${game.slug}`}
            saved={saved}
          />
          {game.links.map((link) => (
            <ActionLink
              key={link.href}
              href={link.href}
              external={link.external}
              tone="line"
            >
              {link.label}
            </ActionLink>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * A detail you are meant to take with you. The whole row is the control, the
 * confirmation replaces the label in place, and it reverts on its own.
 */
function CopyRow({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy();
  const { notify } = useToast();

  return (
    <div className="flex min-w-0 items-center border-[var(--color-line)] [&:not(:last-child)]:border-b sm:[&:not(:last-child)]:border-b-0 sm:[&:nth-child(odd)]:border-r">
      <button
        type="button"
        data-cursor="copy"
        onClick={() => {
          void copy(value);
          notify({ label: "Copied", detail: label, tone: "signal" });
        }}
        className="group flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5 text-left transition-colors duration-200 hover:bg-[var(--color-surface)]"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "t-micro block transition-colors duration-200",
              copied ? "text-[var(--color-signal)]" : "text-[var(--color-paper-20)]",
            )}
          >
            {copied ? "Copied" : label}
          </span>
          <span className="t-meta mt-1.5 block truncate text-[var(--color-paper)]">
            {value}
          </span>
        </span>
        <span
          aria-hidden
          className="t-micro shrink-0 text-[var(--color-paper-20)] transition-colors duration-200 group-hover:text-[var(--color-signal)]"
        >
          ⧉
        </span>
      </button>
    </div>
  );
}
