import { motion } from "motion/react";

/** The Skalarki "SK" mark — four blades meeting at one point. */
export const SK_PATHS = [
  "M130 152 C138 98 182 65 250 65 L512 65 C492 116 452 150 396 150 Z",
  "M130 154 L446 238 L186 238 C152 238 128 214 128 186 Z",
  "M446 240 L42 412 L292 412 C372 412 422 366 434 300 Z",
  "M452 238 L742 72 C748 69 754 68 760 68 L852 68 C862 68 864 78 856 83 L628 238 L734 412 L618 412 C604 412 594 406 588 396 Z",
];
export const SK_VIEWBOX = "30 55 840 368";

export function Logo({ size = 44, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox={SK_VIEWBOX} width={size * 2.28} height={size} className={`sk-logo ${className}`} aria-label="Skalarki Electronics">
      {SK_PATHS.map((d) => <path key={d} d={d} fill="var(--brand)" />)}
    </svg>
  );
}

/** Each blade flies in from its own direction and locks into place. */
const FROM = [
  { x: -260, y: -120, rotate: -18 },
  { x: -320, y: 0, rotate: 10 },
  { x: -220, y: 160, rotate: 16 },
  { x: 300, y: -40, rotate: -12 },
];

export function AssemblingLogo({ size = 96, delay = 0 }: { size?: number; delay?: number }) {
  return (
    <svg viewBox={SK_VIEWBOX} width={size * 2.28} height={size} className="sk-logo" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="sk-shine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="sk-clip">{SK_PATHS.map((d) => <path key={d} d={d} />)}</clipPath>
      </defs>
      <g>
        {SK_PATHS.map((d, i) => (
          <motion.path
            key={d} d={d} fill="var(--brand)"
            initial={{ ...FROM[i], opacity: 0, scale: 0.6 }}
            animate={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 140, damping: 16, mass: 0.9, delay: delay + i * 0.09 }}
            style={{ transformOrigin: "450px 240px" }}
          />
        ))}
      </g>
      <g clipPath="url(#sk-clip)">
        <motion.rect
          y="40" width="260" height="420" fill="url(#sk-shine)"
          initial={{ x: -300 }} animate={{ x: 1000 }}
          transition={{ delay: delay + 0.85, duration: 0.9, ease: [0.4, 0, 0.2, 1] }}
          style={{ skewX: -20 }}
        />
      </g>
    </svg>
  );
}
