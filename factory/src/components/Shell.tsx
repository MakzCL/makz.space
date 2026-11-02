import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, BarChart3, Boxes, Briefcase, CalendarCheck, Clock3, Home, Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { buzz } from "../lib/prefs";
import { ROLE_META, type Tab } from "../lib/roles";
import { useStore } from "../lib/store";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { spring } from "./ui";

export const TAB_META: Record<Tab, { label: string; icon: ReactNode }> = {
  home: { label: "Home", icon: <Home size={22} /> },
  jobs: { label: "Jobs", icon: <Briefcase size={22} /> },
  time: { label: "Time", icon: <Clock3 size={22} /> },
  team: { label: "Team", icon: <Users size={22} /> },
  requests: { label: "Requests", icon: <CalendarCheck size={22} /> },
  insights: { label: "Insights", icon: <BarChart3 size={22} /> },
  issues: { label: "Issues", icon: <AlertTriangle size={22} /> },
  stock: { label: "Stock", icon: <Boxes size={22} /> },
};

export function Background() {
  return (
    <div className="bg" aria-hidden>
      <i className="blob b1" /><i className="blob b2" /><i className="blob b3" />
      <div className="grid" />
      <div className="noise" />
    </div>
  );
}

export function Header({ onProfile, scrolled }: { onProfile: () => void; scrolled: boolean }) {
  const { me, backend } = useStore();
  const meta = ROLE_META[me.role];
  return (
    <header className={`top ${scrolled ? "scrolled" : ""}`}>
      <motion.div className="brand" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
        <Logo size={scrolled ? 24 : 30} />
        <div className="brand-txt">
          <b>FACTORY<span>·</span><em>APP</em></b>
          <small>{meta.gateway} gateway{backend.mode === "demo" && <span className="demo-pill">demo</span>}</small>
        </div>
      </motion.div>
      <motion.button className="me-btn" onClick={() => { buzz(8); onProfile(); }} whileTap={{ scale: 0.92 }} aria-label="Profile">
        <Avatar p={me} size={scrolled ? 34 : 40} ring />
      </motion.button>
    </header>
  );
}

export function BottomNav({ tabs, tab, onTab, badges }: {
  tabs: Tab[]; tab: Tab; onTab: (t: Tab) => void; badges: Partial<Record<Tab, number>>;
}) {
  return (
    <nav className="nav" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map((t) => {
        const on = t === tab;
        return (
          <button key={t} className={on ? "on" : ""} onClick={() => { if (!on) buzz(7); onTab(t); }} aria-current={on ? "page" : undefined}>
            {on && <motion.i layoutId="nav-pill" className="nav-pill" transition={spring} />}
            <motion.span className="nav-ic" animate={{ y: on ? -2 : 0, scale: on ? 1.08 : 1 }} transition={spring}>
              {TAB_META[t].icon}
              <AnimatePresence>
                {!!badges[t] && (
                  <motion.b className="nav-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}>
                    {badges[t]! > 9 ? "9+" : badges[t]}
                  </motion.b>
                )}
              </AnimatePresence>
            </motion.span>
            <span className="nav-lbl">{TAB_META[t].label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function OfflineBar({ online }: { online: boolean }) {
  return (
    <AnimatePresence>
      {!online && (
        <motion.div className="offline" initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}>
          You're offline — changes will sync when you reconnect
        </motion.div>
      )}
    </AnimatePresence>
  );
}
