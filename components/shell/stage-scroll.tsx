"use client";

import {
  createContext,
  useContext,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * The stage owns the scroll, not the document — so anything that needs to
 * measure scroll (the deck's progress rule, a record's cover parallax) needs a
 * handle on that element.
 *
 * Sharing the ref through context means no component ever reaches for the DOM
 * by id, and there is no window where the element has not been found yet.
 */
const StageScrollContext = createContext<RefObject<HTMLDivElement | null> | null>(
  null,
);

export function StageScrollProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <StageScrollContext.Provider value={ref}>
      {children}
    </StageScrollContext.Provider>
  );
}

export function useStageScroll() {
  const ref = useContext(StageScrollContext);
  if (!ref) {
    throw new Error("useStageScroll must be used inside StageScrollProvider");
  }
  return ref;
}
