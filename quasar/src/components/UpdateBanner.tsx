import { AnimatePresence, motion } from "motion/react";
import { ArrowUpCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../app/store";
import type { UpdateInfo } from "../lib/types";

/** Slides in under the top bar when quasar.makz.space has a newer build. */
export function UpdateBanner() {
  const { api, toast } = useStore();
  const [up, setUp] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    const a = api.on<UpdateInfo>("update", (u) => {
      setUp(u);
      setHidden(false);
    });
    const b = api.on<number>("update-progress", setProgress);
    const c = api.on<string>("update-error", (e) => {
      setProgress(null);
      toast(`Update failed: ${e}`);
    });
    return () => {
      a();
      b();
      c();
    };
  }, [api, toast]);
  return (
    <AnimatePresence>
      {up && !hidden && (
        <motion.div className="update" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
          <div className="inner">
            <ArrowUpCircle size={16} />
            <b>QUASAR {up.latest} is available</b>
            <span className="muted">you have {up.current}{up.notes.length ? ` · ${up.notes.slice(0, 2).join(" · ")}` : ""}</span>
            <span style={{ flex: 1 }} />
            {progress != null ? (
              <span className="mono" style={{ fontSize: 12 }}>
                {progress >= 1 ? "Starting installer…" : `Downloading ${Math.round(progress * 100)}%`}
              </span>
            ) : up.installable ? (
              <button className="btn sm primary" onClick={() => (setProgress(0), api.installUpdate())}>
                Update now
              </button>
            ) : (
              <a className="btn sm" href="https://quasar.makz.space/#download" target="_blank" rel="noreferrer">
                Download
              </a>
            )}
            <button className="btn sm icon ghost" aria-label="Later" onClick={() => setHidden(true)}>
              <X size={14} />
            </button>
          </div>
          {progress != null && <div className="bar" style={{ width: `${progress * 100}%` }} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
