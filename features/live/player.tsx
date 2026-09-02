"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { motionPreset, spring } from "@/motion/system";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cx } from "@/lib/utils";

type Phase = "idle" | "connecting" | "playing" | "failed";

/**
 * THE PLAYER
 *
 * HLS on a native <video>, with hls.js loaded only when the browser cannot
 * play the manifest itself — so Safari and iOS never download the library at
 * all, and everyone else only pays for it when a stream is actually up.
 *
 * Controls are custom: a hairline scrub of connection state, a mute toggle
 * that reads as a two-position selector, cinema mode and fullscreen. There is
 * no seek bar, because a live edge is not a timeline.
 */
export function Player({
  src,
  online,
  poster,
  cinema,
  onCinema,
}: {
  src: string;
  online: boolean;
  poster?: string;
  cinema: boolean;
  onCinema: (next: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("idle");
  const [muted, setMuted] = useState(true);
  const [full, setFull] = useState(false);
  const [level, setLevel] = useState<string | null>(null);

  // Attach the stream. Torn down completely when the broadcast ends so no
  // player instance is left polling a dead manifest.
  useEffect(() => {
    const node = video.current;
    if (!node || !online) {
      setPhase("idle");
      return;
    }

    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    setPhase("connecting");

    const native = node.canPlayType("application/vnd.apple.mpegurl");

    if (native) {
      node.src = src;
      const onReady = () => !destroyed && setPhase("playing");
      const onFail = () => !destroyed && setPhase("failed");
      node.addEventListener("loadedmetadata", onReady);
      node.addEventListener("error", onFail);
      void node.play().catch(() => undefined);
      return () => {
        destroyed = true;
        node.removeEventListener("loadedmetadata", onReady);
        node.removeEventListener("error", onFail);
        node.removeAttribute("src");
        node.load();
      };
    }

    void (async () => {
      try {
        const { default: Hls } = await import("hls.js");
        if (destroyed || !Hls.isSupported()) {
          if (!destroyed) setPhase("failed");
          return;
        }
        const instance = new Hls({
          lowLatencyMode: true,
          backBufferLength: 30,
          maxBufferLength: 20,
        });
        hls = instance;
        instance.loadSource(src);
        instance.attachMedia(node);
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (destroyed) return;
          setPhase("playing");
          void node.play().catch(() => undefined);
        });
        instance.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          const height = instance.levels?.[data.level]?.height;
          if (height && !destroyed) setLevel(`${height}p`);
        });
        instance.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal || destroyed) return;
          setPhase("failed");
          instance.destroy();
        });
      } catch {
        if (!destroyed) setPhase("failed");
      }
    })();

    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [online, src]);

  useEffect(() => {
    const node = video.current;
    if (node) node.muted = muted;
  }, [muted]);

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await shell.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  // Keyboard control, scoped to the player so it never fights the palette.
  useEffect(() => {
    const node = shell.current;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "m") setMuted((value) => !value);
      if (event.key === "f") void toggleFullscreen();
      if (event.key === "c") onCinema(!cinema);
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [cinema, onCinema, toggleFullscreen]);

  return (
    <div
      ref={shell}
      tabIndex={-1}
      className="relative mx-auto w-full bg-[var(--color-void)] outline-none"
      style={{
        aspectRatio: cinema ? "21 / 9" : "16 / 9",
        // A 16:9 box on an ultrawide display is taller than the screen; the
        // frame stops growing before the controls fall off the bottom.
        maxHeight: cinema ? "82dvh" : "72dvh",
      }}
    >
      <video
        ref={video}
        playsInline
        muted={muted}
        poster={poster}
        aria-label="Live broadcast"
        className={cx(
          "h-full w-full object-contain transition-opacity duration-500",
          phase === "playing" ? "opacity-100" : "opacity-0",
        )}
      />

      <AnimatePresence>
        {phase !== "playing" ? (
          <motion.div
            key={phase}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionPreset.interface}
            className="absolute inset-0 grid place-items-center px-6"
          >
            <ConnectionState phase={phase} reduced={reduced} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Controls. A single rule with three switches on it. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-px border-t border-[var(--color-line-strong)] bg-[var(--color-base)]">
        <span className="flex items-center gap-2.5 px-4 py-2.5">
          <span
            aria-hidden
            className={cx(
              "block h-1.5 w-1.5",
              phase === "playing"
                ? "bg-[var(--color-signal)]"
                : phase === "failed"
                  ? "bg-[var(--color-signal-lo)]"
                  : "bg-[var(--color-paper-20)]",
            )}
          />
          <span className="t-micro text-[var(--color-paper-50)]">
            {phase === "playing"
              ? "LIVE EDGE"
              : phase === "connecting"
                ? "CONNECTING"
                : phase === "failed"
                  ? "SIGNAL LOST"
                  : "STANDBY"}
          </span>
          {level ? (
            <span className="t-micro text-[var(--color-paper-20)]">{level}</span>
          ) : null}
        </span>

        <span aria-hidden className="mx-1 h-4 w-px bg-[var(--color-line)]" />

        <Control
          active={!muted}
          onClick={() => setMuted((value) => !value)}
          label={muted ? "Unmute" : "Mute"}
          hint="M"
        />
        <Control
          active={cinema}
          onClick={() => onCinema(!cinema)}
          label="Cinema"
          hint="C"
        />
        <Control
          active={full}
          onClick={() => void toggleFullscreen()}
          label="Fullscreen"
          hint="F"
        />
      </div>
    </div>
  );
}

function Control({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-cursor="focus"
      className={cx(
        "group relative flex items-center gap-2 px-3 py-2.5 transition-colors duration-200 sm:px-4",
        active
          ? "text-[var(--color-signal)]"
          : "text-[var(--color-paper-35)] hover:text-[var(--color-paper)]",
      )}
    >
      <motion.span
        aria-hidden
        initial={false}
        animate={{ scaleX: active ? 1 : 0 }}
        transition={spring.snap}
        className="absolute inset-x-2 bottom-1 block h-px origin-left bg-[var(--color-signal)]"
      />
      <span className="t-micro">{label}</span>
      <span className="t-micro hidden opacity-40 sm:inline">{hint}</span>
    </button>
  );
}

/**
 * Loading is contextual and typographic: a row of index ticks filling left to
 * right, never a spinner, and never shown for longer than the work takes.
 */
function ConnectionState({ phase, reduced }: { phase: Phase; reduced: boolean }) {
  const copy =
    phase === "connecting"
      ? { title: "Acquiring signal", note: "Negotiating with stream.makz.space" }
      : phase === "failed"
        ? { title: "Signal lost", note: "The broadcast dropped. Reload to try again." }
        : { title: "Off air", note: "Nothing is being transmitted right now." };

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <motion.span
            key={i}
            className={cx(
              "block h-3 w-[2px]",
              phase === "failed" ? "bg-[var(--color-signal-lo)]" : "bg-[var(--color-paper-20)]",
            )}
            animate={
              phase === "connecting" && !reduced
                ? { opacity: [0.2, 1, 0.2], scaleY: [0.6, 1, 0.6] }
                : { opacity: 0.35 }
            }
            transition={{
              duration: 1.2,
              repeat: phase === "connecting" && !reduced ? Infinity : 0,
              delay: i * 0.06,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      <p className="t-meta text-[var(--color-paper)]">{copy.title}</p>
      <p className="t-micro max-w-[34ch] leading-[1.8] text-[var(--color-paper-35)]">
        {copy.note}
      </p>
    </div>
  );
}
