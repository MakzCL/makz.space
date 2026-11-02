import { playClock } from "../lib/sounds";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellRing, Briefcase, CalendarDays, Check, Megaphone, MessageSquare, Phone, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { enablePush, isIos, isStandalone, pushEnabled, pushSupported } from "../lib/comms";
import { t } from "../lib/i18n";
import { blip, buzz } from "../lib/prefs";
import { useStore } from "../lib/store";
import { ago } from "../lib/time";
import type { AppNotification, NotifyLink } from "../lib/types";
import { useToast } from "./Toast";
import { Btn, Empty, Sheet } from "./ui";

const ICON: Record<string, ReactNode> = {
  news: <Megaphone size={18} />, job_new: <Briefcase size={18} />, job_given: <Briefcase size={18} />, invite: <UserPlus size={18} />,
  message: <MessageSquare size={18} />, call: <Phone size={18} />, meeting: <CalendarDays size={18} />, reminder: <CalendarDays size={18} />,
};

export function useUnreadNotifications() {
  const { db, me } = useStore();
  return db.notifications.filter((n) => n.user_id === me.id && !n.read_at).length;
}

/** Bell for the header; opens the Activity list. */
export function BellButton({ onOpen }: { onOpen: (link: NotifyLink) => void }) {
  const [open, setOpen] = useState(false);
  const n = useUnreadNotifications();
  return (
    <>
      <motion.button className="bell" onClick={() => { buzz(8); setOpen(true); }} whileTap={{ scale: 0.9 }} aria-label={t("Activity")}>
        {n ? <BellRing size={21} /> : <Bell size={21} />}
        <AnimatePresence>{n > 0 && <motion.b className="nav-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>{n > 9 ? "9+" : n}</motion.b>}</AnimatePresence>
      </motion.button>
      <ActivitySheet open={open} onClose={() => setOpen(false)} onOpen={(l) => { setOpen(false); onOpen(l); }} />
    </>
  );
}

function ActivitySheet({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (l: NotifyLink) => void }) {
  const { db, me, backend, patch } = useStore();
  const list = useMemo(() => db.notifications.filter((n) => n.user_id === me.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 80), [db.notifications, me.id]);
  const unread = list.filter((n) => !n.read_at);
  const markAll = async () => {
    const at = new Date().toISOString();
    patch("notifications", (rows) => rows.map((r) => (r.user_id === me.id && !r.read_at ? { ...r, read_at: at } : r)));
    await Promise.all(unread.map((n) => backend.update("notifications", n.id, { read_at: at }).catch(() => {})));
  };
  const openOne = (n: AppNotification) => {
    if (!n.read_at) {
      const at = new Date().toISOString();
      patch("notifications", (rows) => rows.map((r) => (r.id === n.id ? { ...r, read_at: at } : r)));
      backend.update("notifications", n.id, { read_at: at }).catch(() => {});
    }
    onOpen(n.link ?? {});
  };
  return (
    <Sheet open={open} onClose={onClose} tall title={t("Activity")}>
      <div className="stack">
        <PushCard />
        {unread.length > 0 && <button className="link center" onClick={markAll}><Check size={14} /> {t("Mark all as read")}</button>}
        {list.length ? (
          <div className="activity">
            {list.map((n) => (
              <button key={n.id} className={`act-row k-${n.kind} ${n.read_at ? "" : "new"}`} onClick={() => openOne(n)}>
                <span className="act-ic">{ICON[n.kind] ?? <Bell size={18} />}</span>
                <span className="grow"><b>{n.title}</b>{n.body && <small>{n.body}</small>}</span>
                <small className="muted nowrap">{ago(n.created_at)}</small>
              </button>
            ))}
          </div>
        ) : <Empty icon={<Bell size={26} />} title={t("Nothing new")} hint={t("Jobs, messages, meetings and noticeboard posts for you show up here.")} />}
      </div>
    </Sheet>
  );
}

/** "Turn on notifications" — subscribes this phone/computer to push. */
export function PushCard({ compact }: { compact?: boolean }) {
  const { backend, me } = useStore();
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushEnabled().then(setOn).catch(() => setOn(false)); }, []);
  if (on === null || (on && !compact)) return null;
  const iosNeedsInstall = isIos() && !isStandalone();
  return (
    <div className={`card push-card ${on ? "on" : ""}`}>
      <div className="row gap"><BellRing size={22} />
        <div className="grow">
          <b>{on ? t("Notifications are on") : t("Get notified on this device")}</b>
          <small className="muted">{on ? t("Jobs, messages, calls and meetings will pop up even when the app is closed.")
            : iosNeedsInstall ? t("On iPhone: tap Share → Add to Home Screen, open the app from there, then turn this on.")
            : t("Jobs given to you, messages, calls, meetings and noticeboard posts.")}</small>
        </div>
      </div>
      {!on && (pushSupported() || !iosNeedsInstall) && (
        <Btn tone="primary" wide busy={busy} onClick={async () => {
          setBusy(true);
          try { await enablePush(backend, me.id); setOn(true); toast(t("Notifications are on"), "ok"); }
          catch (e) { toast(t((e as Error).message), "error"); }
          finally { setBusy(false); }
        }}>{t("Turn on notifications")}</Btn>
      )}
    </div>
  );
}

/** While the app is open: toast + sound for each new notification. */
export function useNotificationToasts(onOpen: (l: NotifyLink) => void) {
  const { db, me, ready } = useStore();
  const toast = useToast();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ready) return;
    const mine = db.notifications.filter((n) => n.user_id === me.id);
    if (!seen.current) { seen.current = new Set(mine.map((n) => n.id)); return; }
    for (const n of mine) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      if (n.read_at || n.kind === "call") continue; // calls have their own ringing screen
      if (n.kind === "clock") { try { navigator.vibrate?.([70, 60, 70]); } catch { /* unsupported */ } playClock(); }
      else { buzz([30, 50, 30]); blip(880, 0.08); }
      toast(n.title + (n.body ? ` — ${n.body}` : ""), "info");
      void onOpen;
    }
  }, [db.notifications, me.id, ready, toast, onOpen]);
}
