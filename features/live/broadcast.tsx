"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { CHANNELS, STREAM } from "@/lib/site";
import { motionPreset, stagger } from "@/motion/system";
import { useLiveStatus } from "@/components/shell/live-status";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useMounted } from "@/hooks/use-mounted";
import { Rolling } from "@/components/ui/rolling";
import { ActionLink } from "@/components/ui/action";
import { cx, elapsed, formatRelative } from "@/lib/utils";

import { Player } from "./player";

/**
 * THE BROADCAST SURFACE
 *
 * Live, the video is the page: the player takes the stage, chat sits beside
 * it on desktop and behind a toggle on mobile, and the readouts run along a
 * single rule.
 *
 * Off air, it is not a dead rectangle. The surface restates what this is,
 * when it tends to run, and where else to find it — absence handled as a
 * designed state rather than an empty one.
 */
export function Broadcast() {
  const { status, refresh, refreshing } = useLiveStatus();
  const reduced = useReducedMotion();
  const [cinema, setCinema] = useState(false);
  const [chat, setChat] = useState(false);
  const [uptime, setUptime] = useState<string | null>(null);
  // Relative times differ between the render on the server and the one in the
  // browser, so they are only ever printed after mount.
  const mounted = useMounted();

  useEffect(() => {
    if (!status.online || !status.startedAt) return;
    const started = status.startedAt;
    const tick = () => setUptime(elapsed(started));
    const id = window.setInterval(tick, 1000);
    const first = requestAnimationFrame(tick);
    return () => {
      window.clearInterval(id);
      cancelAnimationFrame(first);
      setUptime(null);
    };
  }, [status.online, status.startedAt]);

  return (
    <div className={cx("relative", cinema && "bg-[var(--color-void)]")}>
      {/* ---- STATE RULE ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--color-line)] px-[var(--unit-gutter)] py-4">
        <span className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2 items-center justify-center">
            <span
              className={cx(
                "block h-2 w-2",
                status.online ? "bg-[var(--color-signal)]" : "bg-[var(--color-paper-20)]",
              )}
            />
            {status.online && !reduced ? (
              <motion.span
                aria-hidden
                className="absolute inset-0 bg-[var(--color-signal)]"
                animate={{ opacity: [0.85, 0, 0.85], scale: [1, 2.8, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
              />
            ) : null}
          </span>
          <span
            className={cx(
              "t-meta",
              status.online ? "text-[var(--color-signal)]" : "text-[var(--color-paper-35)]",
            )}
          >
            {status.online ? "ON AIR" : "OFF AIR"}
          </span>
        </span>

        {status.online ? (
          <>
            <Readout label="Watching">
              <Rolling value={status.viewers} />
            </Readout>
            {uptime ? <Readout label="Uptime">{uptime}</Readout> : null}
          </>
        ) : (
          <Readout label="Last checked">
            {mounted ? formatRelative(status.checkedAt) : "—"}
          </Readout>
        )}

        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="t-micro ml-auto text-[var(--color-paper-20)] transition-colors duration-200 hover:text-[var(--color-paper)] disabled:opacity-50"
        >
          {refreshing ? "Checking…" : "Re-check"}
        </button>
      </div>

      {/* ---- TITLE ------------------------------------------------------ */}
      <AnimatePresence mode="wait">
        {status.online && status.title ? (
          <motion.p
            key={status.title}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={motionPreset.reveal}
            className="gutter border-b border-[var(--color-line)] py-4 text-[clamp(1.05rem,2.4vw,1.6rem)] font-semibold tracking-[-0.03em] text-[var(--color-paper)]"
          >
            {status.title}
          </motion.p>
        ) : null}
      </AnimatePresence>

      {/* ---- STAGE ------------------------------------------------------ */}
      <div
        className={cx(
          "grid grid-cols-1",
          !cinema && "xl:grid-cols-[1fr_22rem]",
        )}
      >
        <div className="border-b border-[var(--color-line)] xl:border-b-0">
          {status.online ? (
            <Player
              src={status.streamUrl}
              online={status.online}
              cinema={cinema}
              onCinema={setCinema}
            />
          ) : (
            <OffAir />
          )}
        </div>

        {!cinema ? (
          <aside
            aria-label="Stream chat"
            className="flex min-h-[22rem] flex-col border-[var(--color-line)] xl:border-l"
          >
            <div className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-3">
              <span className="t-micro text-[var(--color-paper-35)]">Chat</span>
              <button
                type="button"
                onClick={() => setChat((value) => !value)}
                className="t-micro text-[var(--color-paper-20)] transition-colors duration-200 hover:text-[var(--color-paper)] xl:hidden"
              >
                {chat ? "Hide" : "Show"}
              </button>
            </div>
            <div className={cx("min-h-0 flex-1", chat ? "block" : "hidden xl:block")}>
              {status.online ? (
                <iframe
                  title="Stream chat"
                  src={STREAM.chatEmbed}
                  loading="lazy"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  className="h-full min-h-[22rem] w-full border-0 bg-[var(--color-surface)]"
                />
              ) : (
                <ChatClosed />
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {/* ---- ELSEWHERE --------------------------------------------------- */}
      <div className="grid grid-cols-2 border-t border-[var(--color-line)] md:grid-cols-4">
        {CHANNELS.map((channel, i) => (
          <motion.a
            key={channel.key}
            href={channel.href}
            target="_blank"
            rel="noreferrer noopener"
            data-cursor="external"
            initial={reduced ? false : { opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ ...motionPreset.reveal, delay: i * stagger.item }}
            className="group flex items-center justify-between gap-3 border-b border-r border-[var(--color-line)] px-4 py-4 transition-colors duration-200 last:border-r-0 hover:bg-[var(--color-surface)] md:border-b-0 [&:nth-child(2n)]:border-r-0 md:[&:nth-child(2n)]:border-r"
          >
            <span className="min-w-0">
              <span className="t-micro block text-[var(--color-paper-20)]">
                {channel.label}
              </span>
              <span className="t-meta mt-1.5 block truncate text-[var(--color-paper-70)] transition-colors duration-200 group-hover:text-[var(--color-signal)]">
                {channel.handle}
              </span>
            </span>
            <span aria-hidden className="t-micro text-[var(--color-paper-20)]">↗</span>
          </motion.a>
        ))}
      </div>
    </div>
  );
}

/**
 * Off air there is nothing to say in chat, so the embed is not mounted at
 * all — no cross-origin frame, no stray white rectangle, no wasted request.
 */
function ChatClosed() {
  return (
    <div className="flex h-full min-h-[22rem] flex-col justify-center gap-4 px-5 py-8">
      <span aria-hidden className="block h-px w-10 bg-[var(--color-line-strong)]" />
      <p className="t-meta text-[var(--color-paper-70)]">Chat opens with the stream</p>
      <p className="t-micro max-w-[30ch] leading-[1.9] text-[var(--color-paper-20)]">
        The room is attached to the broadcast. While it is off air, the Discord
        is where everything happens.
      </p>
      <a
        href="https://discord.gg/HWUrCtQar8"
        target="_blank"
        rel="noreferrer noopener"
        data-cursor="external"
        className="t-micro w-fit border-b border-[var(--color-signal)] pb-1 text-[var(--color-signal)]"
      >
        Open the Discord ↗
      </a>
    </div>
  );
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="t-micro text-[var(--color-paper-20)]">{label}</span>
      <span className="t-micro t-tabular text-[var(--color-paper)]">{children}</span>
    </span>
  );
}

/** The off-air state. Deliberately the same weight as the live one. */
function OffAir() {
  return (
    <div className="flex aspect-[16/9] max-h-[72dvh] w-full flex-col justify-center gap-6 bg-[var(--color-surface)] px-[var(--unit-gutter)] py-8">
      <div className="flex items-center gap-3">
        <span aria-hidden className="block h-px w-10 bg-[var(--color-line-strong)]" />
        <span className="t-micro text-[var(--color-paper-20)]">No transmission</span>
      </div>

      <p className="max-w-[28ch] text-[clamp(1.5rem,4.5vw,3rem)] font-bold leading-[0.95] tracking-[-0.04em] text-[var(--color-paper)]">
        The channel is quiet.
      </p>

      <p className="t-body max-w-[52ch]">
        Design, gaming, IRL and build sessions, self-hosted with no ads and no
        platform in between. When a session starts this surface takes over
        automatically — the page is already watching for it.
      </p>

      <div className="flex flex-wrap gap-3">
        <ActionLink href="https://discord.gg/HWUrCtQar8" external tone="line">
          Get notified on Discord
        </ActionLink>
        <ActionLink href="/work/broadcast" tone="ghost">
          How it is built
        </ActionLink>
      </div>
    </div>
  );
}
