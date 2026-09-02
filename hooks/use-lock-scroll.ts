"use client";

import { useEffect } from "react";

let locks = 0;

/**
 * Reference-counted document scroll lock, so overlapping surfaces (a sheet
 * opened from inside the palette) do not unlock each other.
 */
export function useLockScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    locks += 1;
    document.body.dataset.locked = "true";
    return () => {
      locks -= 1;
      if (locks <= 0) {
        locks = 0;
        delete document.body.dataset.locked;
      }
    };
  }, [active]);
}
