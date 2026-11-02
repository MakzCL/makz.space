import { motion } from "motion/react";
import { useEffect } from "react";
import { AssemblingLogo } from "./Logo";

const WORD = "SKALARKI";

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2500); return () => clearTimeout(t); }, [onDone]);
  return (
    <motion.div
      className="splash"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.08, filter: "blur(12px)" }}
      transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
      onClick={onDone}
    >
      <motion.div className="splash-ring" initial={{ scale: 0.2, opacity: 0 }} animate={{ scale: [0.2, 1.6], opacity: [0, 0.5, 0] }} transition={{ delay: 0.5, duration: 1.4, ease: "easeOut" }} />
      <motion.div className="splash-ring r2" initial={{ scale: 0.2, opacity: 0 }} animate={{ scale: [0.2, 2.2], opacity: [0, 0.35, 0] }} transition={{ delay: 0.7, duration: 1.6, ease: "easeOut" }} />
      <AssemblingLogo size={84} delay={0.1} />
      <div className="splash-word" aria-label="Skalarki">
        {WORD.split("").map((c, i) => (
          <motion.span key={i}
            initial={{ y: 28, opacity: 0, filter: "blur(8px)" }}
            animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
            transition={{ delay: 0.75 + i * 0.045, type: "spring", stiffness: 260, damping: 20 }}
          >{c}</motion.span>
        ))}
      </div>
      <motion.div className="splash-sub" initial={{ opacity: 0, letterSpacing: "0.1em" }} animate={{ opacity: 1, letterSpacing: "0.42em" }} transition={{ delay: 1.15, duration: 0.8 }}>
        ELECTRONICS LTD
      </motion.div>
      <motion.div className="splash-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }}>
        <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.15, duration: 1.1, ease: [0.65, 0, 0.35, 1] }} />
      </motion.div>
    </motion.div>
  );
}
