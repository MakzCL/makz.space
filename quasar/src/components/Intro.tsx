import { animate, motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Mark } from "./Mark";

/**
 * The launch sequence: the disk draws itself, the core ignites, the jets
 * fire, a flash, and the wordmark settles. ~2.4 s; click to skip.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const el = root.current!;
    const q = (p: string) => el.querySelector<SVGElement>(`[data-part="${p}"]`)!;
    const ring = [q("back"), q("front")] as SVGPathElement[];
    ring.forEach((r) => {
      const len = r.getTotalLength();
      r.style.strokeDasharray = `${len}`;
      r.style.strokeDashoffset = `${len}`;
    });
    for (const p of ["core", "glow", "jet"]) {
      q(p).style.transformOrigin = "256px 256px";
      q(p).style.transformBox = "view-box";
    }
    q("core").style.transform = "scale(0)";
    q("glow").style.opacity = "0";
    q("jet").style.transform = "scaleY(0)";

    const ease = [0.65, 0, 0.2, 1] as const;
    const anims = [
      animate(ring[0], { strokeDashoffset: 0 }, { duration: 1.0, ease, delay: 0.1 }),
      animate(ring[1], { strokeDashoffset: 0 }, { duration: 1.0, ease, delay: 0.2 }),
      animate(q("core"), { transform: ["scale(0)", "scale(1.35)", "scale(1)"] }, { duration: 0.55, delay: 0.85, ease: "easeOut" }),
      animate(q("glow"), { opacity: [0, 1, 0.85] }, { duration: 0.9, delay: 0.9 }),
      animate(q("jet"), { transform: ["scaleY(0)", "scaleY(1)"] }, { duration: 0.6, delay: 1.05, ease: [0.2, 0.9, 0.1, 1] }),
    ];
    const t1 = setTimeout(() => setFlash(true), 1050);
    const t2 = setTimeout(() => setLeaving(true), 2350);
    return () => {
      anims.forEach((a) => a.stop());
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!leaving && (
        <motion.div
          ref={root}
          className="intro"
          onClick={() => setLeaving(true)}
          exit={{ opacity: 0, scale: 1.08, filter: "blur(12px)" }}
          transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        >
          {flash && <motion.div className="flash" initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} transition={{ duration: 0.9 }} />}
          <div className="stack">
            <Mark size={220} className="mark" parts />
            <motion.img
              className="word"
              src="./wordmark.svg"
              alt="QUASAR"
              initial={{ opacity: 0, y: 10, letterSpacing: "0.4em", filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay: 1.25, duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
            />
            <motion.div className="tag" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 0.6 }}>
              Every device · One light
            </motion.div>
          </div>
          <div className="skip">click to skip</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
