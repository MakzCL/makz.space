"use client";

import { useSyncExternalStore } from "react";

function subscribe(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

const snapshot = () => navigator.onLine;
/** Assume connected on the server; the first client snapshot corrects it. */
const serverSnapshot = () => true;

/**
 * Whether the device currently has a network connection.
 *
 * navigator.onLine only knows about the link, not whether anything is
 * reachable at the other end — so it is used to explain a failure the visitor
 * is already seeing, never to pre-emptively disable anything.
 */
export function useOnline() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
