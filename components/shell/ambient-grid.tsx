"use client";

/**
 * A single hairline column grid drawn behind everything, aligned to the same
 * measure the layouts use. It gives the environment a floor: type and media
 * sit on a structure rather than floating in a void.
 *
 * One element, one repeating gradient, no per-column DOM and nothing animated
 * — it costs a paint, not a frame budget.
 */
export function AmbientGrid() {
  return (
    <div
      aria-hidden
      data-chrome
      className="pointer-events-none absolute inset-0 z-0 opacity-[0.55]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(to right, var(--color-line) 0 1px, transparent 1px calc(100% / 6))",
        backgroundSize: "100% 100%",
      }}
    />
  );
}
