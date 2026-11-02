import { motion } from "motion/react";

/** The Skalarki "SK" mark — four blades meeting at one point. */
export const SK_PATHS = [
  "M130 152 C138 98 182 65 250 65 L512 65 C492 116 452 150 396 150 Z",
  "M130 154 L446 238 L186 238 C152 238 128 214 128 186 Z",
  "M446 240 L42 412 L292 412 C372 412 422 366 434 300 Z",
  "M452 238 L742 72 C748 69 754 68 760 68 L852 68 C862 68 864 78 856 83 L628 238 L734 412 L618 412 C604 412 594 406 588 396 Z",
];
export const SK_VIEWBOX = "30 55 840 368";

/** Kimera "K": a rounded upright stem plus the SK arm (same blade geometry). */
export const K_PATHS = [
  "M96 150 C104 98 146 66 206 66 L262 66 L262 412 L96 412 Z",
  "M282 238 L572 72 C578 69 584 68 590 68 L682 68 C692 68 694 78 686 83 L458 238 L564 412 L448 412 C434 412 424 406 418 396 Z",
];
export const K_VIEWBOX = "86 60 614 358";

/** Kimera runs on kimera.makz.space (or /kimera): loaders and splash use the K there. */
export const IS_KIMERA = typeof location !== "undefined" && (location.hostname.startsWith("kimera.") || location.pathname.startsWith("/kimera"));
export interface Mark { paths: string[]; viewBox: string; ratio: number; /** viewBox height ÷ drawn mark height */ pad: number; fill: string; hi: string; from: { x: number; y: number; rotate: number }[]; origin: string }
export const SK_MARK: Mark = { paths: [], viewBox: "30 55 840 368", ratio: 840 / 368, pad: 368 / 347, fill: "var(--brand)", hi: "var(--brand-hi)", from: [], origin: "450px 240px" };
export const K_MARK: Mark = { paths: [], viewBox: "86 60 614 358", ratio: 614 / 358, pad: 358 / 346, fill: "url(#k-grad)", hi: "#e7a3ff", from: [], origin: "390px 240px" };

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

SK_MARK.paths = SK_PATHS; SK_MARK.from = FROM;
K_MARK.paths = K_PATHS; K_MARK.from = [{ x: -280, y: 60, rotate: -14 }, { x: 300, y: -60, rotate: 12 }];
export const MARK = IS_KIMERA ? K_MARK : SK_MARK;

/** Kimera's violet → berry sweep, continuous across the whole K. */
export const KGrad = () => <linearGradient id="k-grad" gradientUnits="userSpaceOnUse" x1="92" y1="66" x2="691" y2="412"><stop offset="0" stopColor="#8a6bff" /><stop offset="1" stopColor="#c7368f" /></linearGradient>;

/** Plain Kimera K (no tile) — for headers, the sidebar button and the notch. */
export function KLogo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox={K_VIEWBOX} width={size * K_MARK.ratio} height={size} className={`k-logo ${className}`} aria-label="Kimera">
      <defs><KGrad /></defs>
      {K_PATHS.map((d) => <path key={d} d={d} fill="url(#k-grad)" />)}
    </svg>
  );
}

/**
 * The mark assembling. `burst`: it starts already assembled in place (matching the
 * phone's launch screen), then the pieces kick out a little and lock back together.
 */
export function AssemblingLogo({ size = 96, delay = 0, mark = MARK, burst = false }: { size?: number; delay?: number; mark?: Mark; burst?: boolean }) {
  const SK_PATHS = mark.paths, FROM = mark.from;
  return (
    <svg viewBox={mark.viewBox} width={size * mark.ratio} height={size} className="sk-logo" style={{ overflow: "visible" }}>
      <defs>
        <KGrad />
        <linearGradient id="sk-shine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="sk-clip">{mark.paths.map((d) => <path key={d} d={d} />)}</clipPath>
      </defs>
      <g>
        {SK_PATHS.map((d, i) => (
          <motion.path
            key={d} d={d} fill={mark.fill}
            initial={burst ? { x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 } : { ...FROM[i], opacity: 0, scale: 0.6 }}
            animate={burst
              ? { x: [0, FROM[i]!.x * 0.16, 0], y: [0, FROM[i]!.y * 0.16, 0], rotate: [0, FROM[i]!.rotate * 0.45, 0], scale: [1, 0.9, 1] }
              : { x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
            transition={burst
              ? { duration: 0.75, times: [0, 0.42, 1], ease: [0.3, 0, 0.2, 1], delay: delay + i * 0.05 }
              : { type: "spring", stiffness: 140, damping: 16, mass: 0.9, delay: delay + i * 0.09 }}
            style={{ transformOrigin: mark.origin }}
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
