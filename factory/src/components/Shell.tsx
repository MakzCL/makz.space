import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, BarChart3, Boxes, Briefcase, CalendarCheck, Clock3, Home, MessageSquare, Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../lib/i18n";
import { buzz } from "../lib/prefs";
import { ROLE_META, type Tab } from "../lib/roles";
import { useStore } from "../lib/store";
import { Avatar } from "./Avatar";
import { STATUS_META, shownStatus, useOnline } from "../lib/comms";
import { Logo } from "./Logo";

const ICON: Record<Tab, ReactNode> = {
  home: <Home size={21} strokeWidth={1.8} />,
  jobs: <Briefcase size={21} strokeWidth={1.8} />,
  chat: <MessageSquare size={21} strokeWidth={1.8} />,
  time: <Clock3 size={21} strokeWidth={1.8} />,
  team: <Users size={21} strokeWidth={1.8} />,
  requests: <CalendarCheck size={21} strokeWidth={1.8} />,
  insights: <BarChart3 size={21} strokeWidth={1.8} />,
  issues: <AlertTriangle size={21} strokeWidth={1.8} />,
  stock: <Boxes size={21} strokeWidth={1.8} />,
};
const LABEL: Record<Tab, string> = {
  home: "Home", jobs: "Jobs", chat: "Chat", time: "Time", team: "Team", requests: "Requests", insights: "Insights", issues: "Issues", stock: "Inventory",
};
export const tabLabel = (tab: Tab) => t(LABEL[tab]);

export function Background() { return <div className="bg" aria-hidden />; }

export function Header({ onProfile, scrolled, hidden, extra }: { onProfile: () => void; scrolled: boolean; hidden?: boolean; extra?: ReactNode }) {
  const { me } = useStore();
  return (
    <header className={`top ${scrolled ? "scrolled" : ""} ${hidden ? "hide" : ""}`}>
      <div className="brand">
        <Logo size={22} />
        <div className="brand-txt">
          <b>Factory</b>
          <small>{t(ROLE_META[me.role].label)}</small>
        </div>
      </div>
      <div className="top-actions">
        {extra}
        <motion.button type="button" className="me-btn" onClick={() => { buzz(8); onProfile(); }} whileTap={{ scale: 0.92 }} aria-label={t("Profile")}>
          <Avatar p={me} size={38} /><MyDot />
        </motion.button>
      </div>
    </header>
  );
}

export function BottomNav({ tabs, tab, onTab, badges, foot }: {
  tabs: Tab[]; tab: Tab; onTab: (t: Tab) => void; badges: Partial<Record<Tab, number>>;
  /** Desktop only: pinned to the bottom of the side menu (e.g. the Kimera button). */
  foot?: ReactNode;
}) {
  return (
    <nav className="nav" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map((x) => {
        const on = x === tab;
        return (
          <button type="button" key={x} className={on ? "on" : ""} onClick={() => { if (!on) buzz(7); onTab(x); }} aria-current={on ? "page" : undefined}>
            <span className="nav-ic">
              {ICON[x]}
              <AnimatePresence>
                {!!badges[x] && (
                  <motion.b className="nav-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                    {badges[x]! > 9 ? "9+" : badges[x]}
                  </motion.b>
                )}
              </AnimatePresence>
            </span>
            <span className="nav-lbl">{tabLabel(x)}</span>
            {on && <motion.i layoutId="nav-dot" className="nav-dot" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          </button>
        );
      })}
      {foot && <div className="nav-foot">{foot}</div>}
    </nav>
  );
}

export function OfflineBar({ online }: { online: boolean }) {
  return (
    <AnimatePresence>
      {!online && (
        <motion.div className="offline" initial={{ y: -40 }} animate={{ y: 0 }} exit={{ y: -40 }}>
          {t("You're offline — changes will sync when you reconnect")}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MyDot() {
  const { me } = useStore();
  const online = useOnline();
  const s = shownStatus(me, online.size ? online : new Set([me.id]));
  return <i className="pdot me-dot" style={{ background: STATUS_META[s].color }} />;
}
