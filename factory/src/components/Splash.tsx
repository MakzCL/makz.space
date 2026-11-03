import { motion } from "motion/react";
import { useEffect, useMemo } from "react";
import { AssemblingLogo, IS_KIMERA, MARK } from "./Logo";

/**
 * Opened as an installed app on a phone, Android shows its own launch screen first:
 * the app icon, about 65.5% of the screen wide, dead centre, on the navy background.
 * We start on exactly that frame and carry on from it, so it reads as one animation.
 */
const TILE_VW = 65.5;
const MARK_IN_TILE = 150 / 512; // logo height inside the icon (see public/*-maskable-512.png)

function launchedAsPhoneApp() {
  try {
    if (new URLSearchParams(location.search).has("handoff")) return true; // for testing in a browser
    return matchMedia("(display-mode: standalone)").matches && Math.min(innerWidth, innerHeight) < 700;
  } catch { return false; }
}

export function Splash({ onDone }: { onDone: () => void }) {
  const handoff = useMemo(launchedAsPhoneApp, []);
  useEffect(() => { const t = setTimeout(onDone, handoff ? 2600 : 2400); return () => clearTimeout(t); }, [onDone, handoff]);
  // The splash now shows the same frame: drop the static one from index.html.
  useEffect(() => { document.getElementById("boot")?.remove(); }, []);
  const word = IS_KIMERA ? <>Kortana <span>Inventory</span></> : <>Skalarki <span>Electronics</span></>;

  if (handoff) {
    const tile = Math.min(innerWidth, innerHeight) * TILE_VW / 100;
    const markH = tile * MARK_IN_TILE;
    return (
      <motion.div className="splash handoff" exit={{ opacity: 0, y: -24 }} transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }} onClick={onDone}>
        {/* The halo grows out from where the launch-screen tile was. */}
        <motion.div className="splash-disc" initial={{ scale: tile / 380, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, type: "spring", stiffness: 90, damping: 18 }} />
        {/* Frame 0 = Android's launch screen: the same icon, same size, same place. */}
        <motion.img className="handoff-tile" src={IS_KIMERA ? "/kimera-maskable-512.png" : "/icon-maskable-512.png"} alt=""
          style={{ width: tile, height: tile, marginLeft: -tile / 2, marginTop: -tile / 2 }}
          initial={{ opacity: 1, scale: 1 }} animate={{ opacity: 0, scale: 0.92 }} transition={{ delay: 0.12, duration: 0.45, ease: [0.4, 0, 0.2, 1] }} />
        <div className="handoff-mark" style={{ height: markH * MARK.pad, marginTop: -(markH * MARK.pad) / 2 }}>
          <AssemblingLogo size={markH * MARK.pad} delay={0.35} burst />
        </div>
        <motion.div className="splash-word" style={{ top: `calc(50% + ${markH / 2 + 26}px)` }}
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, type: "spring", stiffness: 160, damping: 18 }}>
          {word}
        </motion.div>
        <motion.div className="splash-bar" style={{ top: `calc(50% + ${markH / 2 + 78}px)` }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
          <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.95, duration: 1.3, ease: [0.65, 0, 0.35, 1] }} />
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div className="splash" exit={{ opacity: 0, y: -24 }} transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }} onClick={onDone}>
      <motion.div className="splash-disc" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 90, damping: 16 }} />
      <AssemblingLogo size={IS_KIMERA ? 92 : 78} delay={0.15} />
      <motion.div className="splash-word" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8, type: "spring", stiffness: 160, damping: 18 }}>
        {word}
      </motion.div>
      <motion.div className="splash-bar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }}>
        <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.05, duration: 1.1, ease: [0.65, 0, 0.35, 1] }} />
      </motion.div>
    </motion.div>
  );
}
