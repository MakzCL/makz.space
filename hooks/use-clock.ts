"use client";

import { useSyncExternalStore } from "react";

import { SITE } from "@/lib/site";

/** Ticks once a second while anything is subscribed, and not at all otherwise. */
function subscribe(notify: () => void) {
  const id = window.setInterval(notify, 1000);
  return () => window.clearInterval(id);
}

/** Whole seconds — a stable snapshot, so React only re-renders when it moves. */
const snapshot = () => Math.floor(Date.now() / 1000);
const serverSnapshot = () => null;

/**
 * Local time at the operator's location.
 *
 * Read through an external store rather than state-in-an-effect: the server
 * snapshot is null, so the markup never claims a time it cannot know, and the
 * browser subscribes to a single shared interval.
 */
export function useClock(timeZone: string = SITE.timezone) {
  const stamp = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  if (stamp === null) return { time: null, date: null, now: null };

  const now = new Date(stamp * 1000);

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone,
  }).format(now);

  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(now);

  return { time, date, now };
}
