"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string, fallback = false) {
  const [matches, setMatches] = useState(fallback);

  useEffect(() => {
    const media = window.matchMedia(query);
    const read = () => setMatches(media.matches);
    read();
    media.addEventListener("change", read);
    return () => media.removeEventListener("change", read);
  }, [query]);

  return matches;
}

/** The rail appears here; below it the dock takes over. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/** Only precise pointers get the custom cursor and magnetic behaviour. */
export const useIsFinePointer = () =>
  useMediaQuery("(hover: hover) and (pointer: fine)");
