"use client";

import { useEffect, useState } from "react";

/**
 * True when motion should be suppressed — either the OS asks for it, or the
 * account has set motion to "reduced" in preferences (applied to <html> as
 * data-motion). Components keep their variant trees and simply stop moving.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () =>
      setReduced(
        media.matches ||
          document.documentElement.dataset.motion === "reduced",
      );

    read();
    media.addEventListener("change", read);

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });

    return () => {
      media.removeEventListener("change", read);
      observer.disconnect();
    };
  }, []);

  return reduced;
}
