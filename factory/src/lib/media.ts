import { useEffect, useState } from "react";

const Q = "(min-width: 1024px)";
export const isDesktop = () => typeof window !== "undefined" && window.matchMedia(Q).matches;

/** True on the desktop layout (wide screens). Inventory is desktop-only. */
export function useDesktop() {
  const [d, setD] = useState(isDesktop);
  useEffect(() => {
    const m = window.matchMedia(Q);
    const on = () => setD(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return d;
}
