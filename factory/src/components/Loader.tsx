import { motion } from "motion/react";
import { useId } from "react";
import { KGrad, MARK, TGrad, fillOf } from "./Logo";

/** Branded buffer: the four blades pulse in sequence while a stroke traces the mark. */
export function Loader({ size = 40, label }: { size?: number; label?: string }) {
  const gid = `k-grad-${useId().replace(/:/g, "")}`;
  return (
    <div className="loader" role="status" aria-live="polite">
      <svg viewBox={MARK.viewBox} width={size * MARK.ratio} height={size} style={{ overflow: "visible" }}>
        <defs><KGrad id={gid} /><TGrad id={`${gid}-t`} /></defs>
        {MARK.paths.map((d, i) => (
          <g key={d}>
            <motion.path d={d} fill={fillOf(MARK, gid)}
              animate={{ opacity: [0.18, 1, 0.18] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * (MARK.paths.length > 2 ? 0.15 : 0.3), ease: "easeInOut" }} />
            <motion.path d={d} fill="none" stroke={MARK.hi} strokeWidth={6}
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
