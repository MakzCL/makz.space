import { motion } from "motion/react";
import { useEffect } from "react";
import { AssemblingLogo } from "./Logo";

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t); }, [onDone]);
  return (
    <motion.div className="splash" exit={{ opacity: 0, y: -24 }} transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }} onClick={onDone}>
      <motion.div className="splash-disc" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 90, damping: 16 }} />
      <AssemblingLogo size={78} delay={0.15} />
      <motion.div className="splash-word" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, type: "spring", stiffness: 160, damping: 18 }}>
        Skalarki <span>Electronics</span>
      </motion.div>
      <motion.div className="splash-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
        <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.05, duration: 1.1, ease: [0.65, 0, 0.35, 1] }} />
      </motion.div>
    </motion.div>
  );
}
