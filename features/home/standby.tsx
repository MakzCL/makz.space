"use client";

import Link from "next/link";
import { motion } from "motion/react";

import { SITE } from "@/lib/site";
import { motionPreset } from "@/motion/system";
import { useClock } from "@/hooks/use-clock";
import { useLiveStatus } from "@/components/shell/live-status";
import { SplitText } from "@/components/ui/split-text";
import { Plate } from "@/components/media/plate";
import { elapsed } from "@/lib/utils";
import type { FrameRecord, GameRecord, MinecraftStatus, WorkRecord } from "@/types";

import { Wordmark } from "./wordmark";

/**
 * STANDBY
 *
 * The entry screen is a single composition that fits the stage without
 * scrolling: identity at display scale, cut by a band of live state, with
 * three readouts ruled along the bottom edge. Nothing here is a card and
 * nothing is centred — the eye is led from the mark, across the band, down
 * into the readouts, and then into the index below.
 */
export function Standby({
  current,
  latest,
  server,
  serverStatus,
  counts,
}: {
  current: WorkRecord;
  latest: FrameRecord;
  server: GameRecord;
  serverStatus: MinecraftStatus;
  counts: { records: number; frames: number; servers: number };
}) {
  const { status } = useLiveStatus();
  const { time } = useClock();

  const uptime = elapsed(status.startedAt);

  return (
    <section
      aria-labelledby="standby-title"
      className="relative flex min-h-[calc(100dvh-var(--unit-ledger)-var(--unit-dock))] flex-col justify-between lg:min-h-[calc(100dvh-var(--unit-ledger)-var(--unit-deck))]"
    >
      {/* Top rule: position in the environment. */}
      <div className="gutter flex items-baseline justify-between gap-6 pt-6 md:pt-8">
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...motionPreset.interface, delay: 0.15 }}
          className="t-micro text-[var(--color-paper-35)]"
        >
          {SITE.domain} — standby
        </motion.span>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...motionPreset.interface, delay: 0.2 }}
          className="t-micro text-[var(--color-paper-20)]"
        >
          <span className="hidden sm:inline">
            {counts.records} records — {counts.frames} frames — {counts.servers} servers —{" "}
          </span>
          2026
        </motion.span>
      </div>

      {/* The mark. Centred in whatever space the readouts leave, so the
          emptiness sits around it rather than pooling underneath. */}
      <div className="gutter relative flex flex-1 flex-col justify-center py-8">
        <span id="standby-title" className="sr-only">
          MAKZ — {SITE.operator}, {SITE.role}
        </span>
        <Wordmark
          band={
            <>
              <span className="t-micro flex items-center gap-2 text-[var(--color-paper-50)]">
                <span
                  aria-hidden
                  className={
                    status.online
                      ? "block h-1.5 w-1.5 bg-[var(--color-signal)]"
                      : "block h-1.5 w-1.5 bg-[var(--color-paper-20)]"
                  }
                />
                <span className="hidden sm:inline">STATUS</span>
                <span className={status.online ? "text-[var(--color-signal)]" : undefined}>
                  {status.online ? "BROADCASTING" : "STANDBY"}
                </span>
              </span>

              <span className="t-micro hidden text-[var(--color-paper-35)] md:inline">
                {SITE.locality.toUpperCase()} — {SITE.region.toUpperCase()}
              </span>

              <span className="t-micro t-tabular text-[var(--color-paper-50)]">
                {time ?? "--:--:--"}
              </span>
            </>
          }
        />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...motionPreset.reveal, delay: 0.55 }}
          className="mt-7 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3"
        >
          <span className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <SplitText
              by="word"
              delay={0.6}
              className="text-[clamp(1.05rem,2.2vw,1.6rem)] font-semibold tracking-[-0.03em] text-[var(--color-paper)]"
            >
              {SITE.operator}
            </SplitText>
            <span className="t-micro text-[var(--color-paper-35)]">
              {SITE.role.toUpperCase()}
            </span>
          </span>

          {/* Where to go next, stated rather than assumed. */}
          <span className="flex items-center gap-3">
            <span className="t-micro text-[var(--color-paper-20)]">
              Descend for the index
            </span>
            <motion.span
              aria-hidden
              className="block h-px w-10 origin-left bg-[var(--color-signal)]"
              animate={{ scaleX: [0.25, 1, 0.25] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            />
          </span>
        </motion.div>
      </div>

      {/* Readouts. Four ruled cells, no borders around them — only between.
          Each one is live: what is being worked on, whether the broadcast is
          up, whether the server is up, and the most recent frame. */}
      <div className="grid grid-cols-1 border-t border-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4">
        <Readout
          index="A"
          label="Current record"
          delay={0.7}
          href={`/work/${current.slug}`}
          value={current.title}
          note={current.subtitle}
        />
        <Readout
          index="B"
          label="Broadcast"
          delay={0.76}
          href="/live"
          value={status.online ? "LIVE NOW" : "OFF AIR"}
          accent={status.online}
          note={
            status.online
              ? `${status.viewers} watching${uptime ? ` — up ${uptime}` : ""}`
              : "Next session announced on Discord"
          }
        />
        <Readout
          index="C"
          label="Now running"
          delay={0.82}
          href={`/gaming#${server.slug}`}
          value={server.title.split(" ")[0] ?? server.title}
          accent={serverStatus.online}
          note={
            serverStatus.online && serverStatus.players
              ? `${serverStatus.players.online} / ${serverStatus.players.max} online — ${server.facts[0]?.value ?? ""}`
              : `Unreachable — ${server.facts[0]?.value ?? ""}`
          }
        />
        <Readout
          index="D"
          label="Latest frame"
          delay={0.88}
          href={`/frames?frame=${latest.slug}`}
          value={latest.title}
          note={`${latest.subject} — ${latest.medium}`}
          plate={latest}
        />
      </div>

    </section>
  );
}

function Readout({
  index,
  label,
  value,
  note,
  href,
  accent,
  delay,
  plate,
}: {
  index: string;
  label: string;
  value: React.ReactNode;
  note: string;
  href: string;
  accent?: boolean;
  delay: number;
  /** One small image, where a cell earns it. */
  plate?: FrameRecord;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...motionPreset.reveal, delay }}
      className="border-b border-[var(--color-line)] sm:[&:nth-child(odd)]:border-r xl:border-r xl:last:border-r-0"
    >
      <Link
        href={href}
        data-cursor="open"
        className="group flex h-full items-start gap-4 px-[var(--unit-gutter)] py-5 transition-colors duration-200 hover:bg-[var(--color-surface)] sm:px-6"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="flex items-center gap-3">
            <span className="t-micro text-[var(--color-paper-20)]">{index}</span>
            <span className="t-micro text-[var(--color-paper-35)]">{label}</span>
            <span
              aria-hidden
              className="ml-auto block h-px w-0 bg-[var(--color-signal)] transition-[width] duration-300 ease-out group-hover:w-8"
            />
          </span>

          <span
            className={
              accent
                ? "text-[clamp(1.1rem,2.2vw,1.6rem)] font-bold leading-none tracking-[-0.035em] text-[var(--color-signal)]"
                : "text-[clamp(1.1rem,2.2vw,1.6rem)] font-bold leading-none tracking-[-0.035em] text-[var(--color-paper)]"
            }
          >
            {value}
          </span>

          <span className="t-micro leading-[1.7] text-[var(--color-paper-20)]">{note}</span>
        </span>

        {plate ? (
          <Plate
            src={plate.asset.src}
            label={plate.index}
            size="mt-0.5 h-12 w-12"
            sizes="48px"
            className="border border-[var(--color-line)]"
            imgClassName="opacity-80 transition-opacity duration-300 group-hover:opacity-100"
          />
        ) : null}
      </Link>
    </motion.div>
  );
}
