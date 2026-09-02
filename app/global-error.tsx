"use client";

import { useEffect } from "react";

/**
 * The shell itself failed, so this renders its own document. No providers, no
 * fonts, no dependencies — deliberately the plainest surface in the build,
 * because anything it relies on could be the thing that broke.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[makz] fatal", error);
  }, [error]);

  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "clamp(1.5rem, 6vw, 5rem)",
          background: "#0c0d10",
          color: "#f2efe9",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <span
          style={{
            fontSize: "0.625rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#fcba03",
          }}
        >
          Fault — environment
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(2rem, 7vw, 4.5rem)",
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 0.92,
            maxWidth: "16ch",
          }}
        >
          The environment failed to start.
        </h1>
        <p style={{ margin: 0, maxWidth: "48ch", lineHeight: 1.6, opacity: 0.7 }}>
          Reloading usually fixes it. If it keeps happening, the deployment
          needs attention.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              border: 0,
              background: "#f2efe9",
              color: "#08090b",
              padding: "0.85rem 1.5rem",
              fontSize: "0.6875rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
              the router itself may be what failed, so this must be a document
              request rather than a client-side navigation. */}
          <a
            href="/"
            style={{
              border: "1px solid rgba(242,239,233,0.2)",
              color: "#f2efe9",
              padding: "0.85rem 1.5rem",
              fontSize: "0.6875rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            Reload standby
          </a>
        </div>
      </body>
    </html>
  );
}
