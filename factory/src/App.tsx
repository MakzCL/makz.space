import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FullLoader } from "./components/Loader";
import { BottomNav, Background, Header, OfflineBar } from "./components/Shell";
import { Splash } from "./components/Splash";
import { ToastProvider, useToast } from "./components/Toast";
import { createBackend, type Backend } from "./lib/backend";
import { useMine } from "./lib/actions";
import { t } from "./lib/i18n";
import { buzz, getPrefs, usePrefs } from "./lib/prefs";
import { tabsFor, type Tab } from "./lib/roles";
import { useDesktop } from "./lib/media";
import { StoreProvider, useHasStore, useStore } from "./lib/store";
import type { Job } from "./lib/types";
import { Home } from "./screens/Home";
import { Insights } from "./screens/Insights";
import { Issues } from "./screens/Issues";
import { JobEditor, JobSheet, Jobs } from "./screens/Jobs";
import { Join, Pending } from "./screens/Join";
import { Login } from "./screens/Login";
import { Profile } from "./screens/Profile";
import { Requests } from "./screens/Requests";
import { Inventory } from "./screens/Inventory";
import { ChatHub } from "./screens/Chat";
import { CallProvider } from "./components/Calls";
import { BellButton, useNotificationToasts } from "./components/Notifications";
import { OnlineProvider, totalUnread, useConversations } from "./lib/comms";
import type { NotifyLink } from "./lib/types";
import { PersonSheet, Team } from "./screens/Team";
import { TimeScreen } from "./screens/Time";

export function App() {
  const prefs = usePrefs();
  const [splash, setSplash] = useState(() => { try { return !sessionStorage.getItem("skf-splashed"); } catch { return true; } });
  const [backend, setBackend] = useState<Backend | null>(null);
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const endSplash = useCallback(() => { try { sessionStorage.setItem("skf-splashed", "1"); } catch { /* storage blocked */ } setSplash(false); }, []);
  const [joinCode, setJoinCode] = useState<string | null>(() => new URLSearchParams(location.search).get("join")?.toUpperCase() ?? null);
  const clearJoin = useCallback(() => { setJoinCode(null); history.replaceState(null, "", location.pathname); }, []);

  useEffect(() => { createBackend().then(setBackend); }, []);
  const check = useCallback(async () => { if (backend) setUser(await backend.currentUser()); }, [backend]);
  useEffect(() => { if (!backend) return; check(); return backend.onAuthChange(check); }, [backend, check]);

  return (
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"}>
      <ToastProvider>
        <Background />
        <AnimatePresence mode="wait">
          {splash ? <Splash key="splash" onDone={endSplash} />
            : !backend || user === undefined ? <motion.div key="load" exit={{ opacity: 0 }}><FullLoader label={t("Starting up…")} /></motion.div>
              : user === null ? (
                <motion.div key={joinCode ? "join" : "login"} className="fill" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
                  {joinCode
                    ? <Join backend={backend} code={joinCode} onIn={() => { clearJoin(); check(); }} onCancel={clearJoin} />
                    : <Login backend={backend} onIn={check} />}
                </motion.div>
              ) : (
                <motion.div key={"app" + user} className="fill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <StoreProvider backend={backend} userId={user} onMissingProfile={async () => { await backend.signOut(); check(); }}>
                    <Gate joinCode={joinCode} clearJoin={clearJoin} signOut={async () => { await backend.signOut(); setUser(null); }} />
                  </StoreProvider>
                </motion.div>
              )}
        </AnimatePresence>
      </ToastProvider>
    </MotionConfig>
  );
}

function Gate({ signOut, joinCode, clearJoin }: { signOut: () => void; joinCode: string | null; clearJoin: () => void }) {
  const has = useHasStore();
  if (!has) return <FullLoader label={t("Syncing the floor…")} />;
  return <Member signOut={signOut} joinCode={joinCode} clearJoin={clearJoin} />;
}

function Member({ signOut, joinCode, clearJoin }: { signOut: () => void; joinCode: string | null; clearJoin: () => void }) {
  const { me, backend, refresh } = useStore();
  useEffect(() => { if (me.active && joinCode) clearJoin(); }, [me.active, joinCode, clearJoin]);
  if (!me.active) return <Pending backend={backend} name={me.full_name} code={joinCode} onSignOut={signOut} onActive={() => { clearJoin(); refresh(); }} />;
  return <OnlineProvider><CallProvider><Main signOut={signOut} /></CallProvider></OnlineProvider>;
}

function Main({ signOut }: { signOut: () => void }) {
  const { db, me, ready } = useStore();
  const desktop = useDesktop();
  const tabs = tabsFor(me.role, desktop);
  const [tab, setTab] = useState<Tab>(() => (tabs.includes(getPrefs().startTab) ? getPrefs().startTab : "home"));
  const [dir, setDir] = useState(1);
  const [profile, setProfile] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [editJob, setEditJob] = useState<{ job: Job | null } | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<Job | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const scroller = useRef<HTMLElement>(null);
  const mine = useMine();
  const toast = useToast();
  const [openConv, setOpenConv] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const convs = useConversations();
  const chatUnread = totalUnread(convs);

  // Notification / push links: open the right tab, job, chat or meeting.
  const openLink = useCallback((l: NotifyLink) => {
    if (l.conversation_id) { setOpenConv(l.conversation_id); go("chat"); }
    else if (l.event_id) { setOpenEvent(l.event_id); go("chat"); }
    else if (l.job_id) { const j = db.jobs.find((x) => x.id === l.job_id); if (l.tab && l.tab !== "jobs") go(l.tab as Tab); else go("jobs"); if (j) setJob(j); }
    else if (l.tab) go(l.tab as Tab);
  }, [db.jobs]); // eslint-disable-line react-hooks/exhaustive-deps
  useNotificationToasts(openLink);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const l: NotifyLink = { tab: q.get("open") ?? undefined, job_id: q.get("job_id") ?? undefined, conversation_id: q.get("conversation_id") ?? undefined, event_id: q.get("event_id") ?? undefined };
    if (ready && (l.tab || l.job_id || l.conversation_id || l.event_id)) { openLink(l); history.replaceState(null, "", location.pathname); }
    const fromSw = (e: MessageEvent) => { if (e.data?.type === "open") openLink(e.data.link ?? {}); };
    navigator.serviceWorker?.addEventListener("message", fromSw);
    return () => navigator.serviceWorker?.removeEventListener("message", fromSw);
  }, [ready, openLink]);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Ping when a new team invite lands.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const i of mine.invites) {
      if (seen.current.has(i.id)) continue;
      seen.current.add(i.id);
      if (ready) { buzz([40, 60, 40]); toast(t("New team invite — check Home"), "info"); }
    }
  }, [mine.invites, ready, toast]);

  const go = (t: Tab) => {
    if (!tabs.includes(t)) t = t === "issues" || t === "time" || (t === "stock" && desktop) ? t : "home";
    setDir(tabs.indexOf(t) >= tabs.indexOf(tab) ? 1 : -1);
    setProfile(false); setTab(t);
    scroller.current?.scrollTo({ top: 0 });
  };

  const badges = useMemo(() => ({
    home: mine.invites.length,
    chat: chatUnread,
    requests: db.absences.filter((a) => a.status === "pending").length + db.profiles.filter((p) => !p.active).length,
    issues: db.issues.filter((i) => i.status === "open").length,
    stock: tabs.includes("stock") ? db.stock_items.filter((s) => !s.archived && s.min_quantity > 0 && s.quantity <= s.min_quantity).length : 0,
  }), [db, mine.invites, tabs, me.role, chatUnread]);

  // Keyboard shortcuts on tablets / desktops: 1–5 switch tabs.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      const n = Number(e.key); if (n >= 1 && n <= tabs.length) go(tabs[n - 1]!);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  const page = profile ? "profile" : tab;
  const screen = (() => {
    if (profile) return <Profile onSignOut={signOut} />;
    switch (tab) {
      case "home": return <Home onOpenJob={setJob} go={go} onPerson={setPersonId} onReport={(j) => { setReportFor(j); go("issues"); }} />;
      case "jobs": return <Jobs onOpenJob={setJob} onNew={() => setEditJob({ job: null })} />;
      case "time": return <TimeScreen />;
      case "team": return <Team onPerson={setPersonId} />;
      case "requests": return <Requests />;
      case "insights": return <Insights onOpenJob={setJob} />;
      case "issues": return <Issues preset={reportFor} onPresetUsed={() => setReportFor(null)} />;
      case "stock": return <Inventory />;
      case "chat": return <ChatHub openConv={openConv} onOpenConv={setOpenConv} openEvent={openEvent} onOpenEvent={setOpenEvent} />;
    }
  })();

  return (
    <div className="app">
      <OfflineBar online={online} />
      <Header onProfile={() => { setProfile(!profile); scroller.current?.scrollTo({ top: 0 }); }} scrolled={scrolled} extra={<BellButton onOpen={openLink} />} />
      <main ref={scroller} className="scroller" onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 24)}>
        {!ready ? <FullLoader label={t("Syncing the floor…")} /> : (
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div key={page} custom={dir}
              initial={{ opacity: 0, x: profile ? 0 : dir * 36, y: profile ? 24 : 0 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: profile ? 0 : dir * -36 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}>
              {profile && <button className="back" onClick={() => setProfile(false)}><ArrowLeft size={18} /> {t("Back")}</button>}
              {screen}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
      <BottomNav tabs={tabs} tab={profile ? ("" as Tab) : tab} onTab={go} badges={badges} />

      <JobSheet job={job} onClose={() => setJob(null)}
        onEdit={(j) => { setJob(null); setEditJob({ job: j }); }}
        onReport={(j) => { setJob(null); setReportFor(j); go("issues"); }} />
      <JobEditor open={!!editJob} job={editJob?.job ?? null} onClose={() => setEditJob(null)} />
      <PersonSheet id={personId} onClose={() => setPersonId(null)} />
    </div>
  );
}
