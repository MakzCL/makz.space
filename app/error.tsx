"use client";

import { useEffect } from "react";

import { Action, ActionLink } from "@/components/ui/action";

/**
 * A route threw. The visitor gets a plain statement and two ways out; the
 * detail goes to the console, not the screen.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[makz] route error", error);
  }, [error]);

  return (
    <div className="gutter flex min-h-full flex-col justify-center py-14">
      <span className="t-micro text-[var(--color-signal)]">FAULT — ROUTE</span>

      <h1 className="mt-6 max-w-[16ch] text-[clamp(2.2rem,7vw,5rem)] font-extrabold leading-[0.9] tracking-[-0.045em] text-[var(--color-paper)]">
        Something broke on the way in.
      </h1>

      <p className="t-lead mt-7 max-w-[50ch]">
        This section failed to render. Trying again usually resolves it — the
        rest of the environment is unaffected.
      </p>

      {error.digest ? (
        <p className="t-micro mt-6 text-[var(--color-paper-20)]">
          Reference {error.digest}
        </p>
      ) : null}

      <div className="mt-9 flex flex-wrap gap-3">
        <Action tone="solid" onClick={reset}>
          Try again
        </Action>
        <ActionLink href="/" tone="line">
          Return to standby
        </ActionLink>
      </div>
    </div>
  );
}
