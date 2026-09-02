"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { StreamStatus } from "@/types";

interface LiveValue {
  status: StreamStatus;
  /** True while a refresh is in flight, for the tick's own micro-state. */
  refreshing: boolean;
  refresh: () => void;
}

const LiveContext = createContext<LiveValue | null>(null);

/** How often the shell re-checks the origin while the tab is visible. */
const INTERVAL = 30_000;

/**
 * One poller for the whole application. The ledger tick, the live surface and
 * the command palette all read this, so the broadcast state can never
 * disagree with itself and the origin is hit once per interval regardless of
 * how many components care.
 *
 * Polling stops entirely while the tab is hidden.
 */
export function LiveStatusProvider({
  initial,
  children,
}: {
  initial: StreamStatus;
  children: ReactNode;
}) {
  const [status, setStatus] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const read = async () => {
      if (document.visibilityState !== "visible") return;
      setRefreshing(true);
      try {
        const response = await fetch("/api/live/status", { cache: "no-store" });
        if (!response.ok) return;
        const next = (await response.json()) as StreamStatus;
        if (!cancelled) setStatus(next);
      } catch {
        // Leave the last known state on screen; a failed poll is not news.
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };

    const schedule = () => {
      timer = window.setTimeout(async () => {
        await read();
        schedule();
      }, INTERVAL);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [nonce]);

  const value = useMemo<LiveValue>(
    () => ({ status, refreshing, refresh: () => setNonce((n) => n + 1) }),
    [refreshing, status],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveStatus() {
  const context = useContext(LiveContext);
  if (!context) {
    throw new Error("useLiveStatus must be used inside LiveStatusProvider");
  }
  return context;
}
