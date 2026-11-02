import { motion } from "motion/react";
import { SK_PATHS, SK_VIEWBOX } from "./Logo";

/** Branded buffer: the four blades pulse in sequence while a stroke traces the mark. */
export function Loader({ size = 40, label }: { size?: number; label?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <svg viewBox={SK_VIEWBOX} width={size * 2.28} height={size} style={{ overflow: "visible" }}>
        {SK_PATHS.map((d, i) => (
          <g key={d}>
            <motion.path d={d} fill="var(--brand)"
              animate={{ opacity: [0.18, 1, 0.18] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }} />
            <motion.path d={d} fill="none" stroke="var(--brand-hi)" strokeWidth={6}
              initial={{ pathLength: 0 }} animate={{ pathLength: [0, 1, 1], opacity: [1, 1, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }} />
          </g>
        ))}
      </svg>
      {label && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>{label}</motion.span>}
    </div>
  );
}

export function FullLoader({ label = "Syncing the floor…" }: { label?: string }) {
  return <div className="full-loader"><Loader size={44} label={label} /></div>;
}

export function Spinner() { return <span className="spinner" aria-hidden />; }

export function Skeleton({ h = 72, n = 3 }: { h?: number; n?: number }) {
  return <div className="stack">{Array.from({ length: n }, (_, i) => <div key={i} className="skel" style={{ height: h, animationDelay: `${i * 0.12}s` }} />)}</div>;
}
