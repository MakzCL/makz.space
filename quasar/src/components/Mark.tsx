import { useId } from "react";

/** The QUASAR mark: a bright core, its accretion disk and two jets. */
export function Mark({ size = 24, className, parts = false }: { size?: number; className?: string; parts?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 512 512" fill="none" aria-label="QUASAR">
      <defs>
        <linearGradient id={`r${id}`} x1="80" y1="330" x2="432" y2="182" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2EE6FF" />
          <stop offset=".5" stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#FF3DB8" />
        </linearGradient>
        <linearGradient id={`j${id}`} x1="256" y1="20" x2="256" y2="492" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`c${id}`} cx="256" cy="256" r="92" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".34" stopColor="#E9F9FF" />
          <stop offset=".55" stopColor="#7FE9FF" stopOpacity=".55" />
          <stop offset="1" stopColor="#7C5CFF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="rotate(-24 256 256)">
        <path data-part={parts ? "back" : undefined} d="M86 256a170 60 0 0 1 340 0" stroke={`url(#r${id})`} strokeWidth="22" opacity=".42" />
        <path data-part={parts ? "jet" : undefined} d="M256 14 270 256 256 498 242 256Z" fill={`url(#j${id})`} />
        <circle data-part={parts ? "glow" : undefined} cx="256" cy="256" r="92" fill={`url(#c${id})`} />
        <circle data-part={parts ? "core" : undefined} cx="256" cy="256" r="34" fill="#fff" />
        <path data-part={parts ? "front" : undefined} d="M86 256a170 60 0 0 0 340 0" stroke={`url(#r${id})`} strokeWidth="26" />
      </g>
    </svg>
  );
}
