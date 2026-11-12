import { URLS } from "../../packages/sk-channel/channel";
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
import { KIMERA_URL, can, tabsFor, type Tab } from "./lib/roles";
import { KLogo } from "./components/Logo";
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
import { ChatHub } from "./screens/Chat";
import { CallProvider, useCalls } from "./components/Calls";
import { BellButton, useNotificationToasts } from "./components/Notifications";
import { PermissionsPrompt } from "./components/Permissions";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
            : !backend || user === undefined ? <motion.div key="load" exit={{ opacity: 0 }}><StartUp onReset={async () => { try { await backend?.signOut(); } catch { /* ignore */ } try { Object.keys(localStorage).filter((k) => /^sb-.*-auth-token$/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } location.reload(); }} /></motion.div>
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

/** Permanent link to the latest SK Suite Windows build (served by the sk-suite site from its update feed). */
const SK_SUITE_DOWNLOAD = URLS.suiteDownload;

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
  const [headHidden, setHeadHidden] = useState(false);
  const lastY = useRef(0);
  // Header hides while scrolling down, comes back on any scroll up (and near the top).
  const onScroll = (y: number) => {
    setScrolled(y > 24);
    const d = y - lastY.current;
    if (y < 60) setHeadHidden(false);
    else if (d > 6) setHeadHidden(true);
    else if (d < -6) setHeadHidden(false);
    lastY.current = y;
  };
  const [online, setOnline] = useState(navigator.onLine);
  const scroller = useRef<HTMLElement>(null);
  const mine = useMine();
  const toast = useToast();
  const [openConv, setOpenConv] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const convs = useConversations();
  const chatUnread = totalUnread(convs);

  // Calls: remember the screen the person was on, and go back to it when the call ends
  // (answering from a notification opens the chat, which they never asked to see).
  const calls = useCalls();
  const here = useRef({ tab, profile, openConv, openEvent });
  here.current = { tab, profile, openConv, openEvent };
  const returnTo = useRef<{ at: number; s: typeof here.current } | null>(null);
  const callId = calls.current?.call.id ?? null;
  const wasIn = useRef<string | null>(null);
  useEffect(() => {
    if (callId && !wasIn.current) { if (!returnTo.current || Date.now() - returnTo.current.at > 90_000) returnTo.current = { at: Date.now(), s: here.current }; }
    if (!callId && wasIn.current && returnTo.current) {
      const r = returnTo.current.s; returnTo.current = null;
      setProfile(r.profile); setTab(r.tab); setOpenConv(r.openConv); setOpenEvent(r.openEvent); setHeadHidden(false);
    }
    wasIn.current = callId;
  }, [callId]);

  // Notification / push links: open the right tab, job, chat or meeting.
  const openLink = useCallback((l: NotifyLink) => {
    if (l.call_id && !wasIn.current) returnTo.current = { at: Date.now(), s: here.current };
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
    if (!tabs.includes(t)) t = t === "issues" || t === "time" ? t : "home";
    setDir(tabs.indexOf(t) >= tabs.indexOf(tab) ? 1 : -1);
    setProfile(false); setTab(t); setHeadHidden(false);
    scroller.current?.scrollTo({ top: 0 });
  };

  const badges = useMemo(() => ({
    home: mine.invites.length,
    chat: chatUnread,
    requests: db.absences.filter((a) => a.status === "pending").length + db.profiles.filter((p) => !p.active).length,
    issues: db.issues.filter((i) => i.status === "open").length,
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
      case "stock": return null;
      case "chat": return <ChatHub openConv={openConv} onOpenConv={setOpenConv} openEvent={openEvent} onOpenEvent={setOpenEvent} />;
    }
  })();

  return (
    <div className="app">
      <OfflineBar online={online} />
      <Header onProfile={() => { setProfile(!profile); scroller.current?.scrollTo({ top: 0 }); }} scrolled={scrolled} hidden={headHidden} extra={<>{can.editStock(me.role) && <a className="icon-btn kimera-link" href={KIMERA_URL} title={t("Open Kortana (inventory)")} aria-label={t("Open Kortana (inventory)")}><KLogo size={17} /></a>}<BellButton onOpen={openLink} /></>} />
      <main ref={scroller} className="scroller" onScroll={(e) => onScroll((e.target as HTMLElement).scrollTop)}>
        {!ready ? <FullLoader label={t("Syncing the floor…")} /> : (
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div key={page} custom={dir}
              initial={{ opacity: 0, x: profile ? 0 : dir * 36, y: profile ? 24 : 0 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: profile ? 0 : dir * -36 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}>
              {profile && <button type="button" className="back" onClick={() => setProfile(false)}><ArrowLeft size={18} /> {t("Back")}</button>}
              <ErrorBoundary place={`screen:${page}`}>{screen}</ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        )}
      </main>
      <BottomNav tabs={tabs} tab={profile ? ("" as Tab) : tab} onTab={go} badges={badges}
        foot={desktop ? <>
          {can.editStock(me.role) && <a className="nav-kimera" href={KIMERA_URL}><KLogo size={20} /><span><b>Kortana</b><small>{t("Inventory")}</small></span></a>}
          <a className="nav-kimera nav-suite" href={SK_SUITE_DOWNLOAD} download title={t("Download SK Suite for Windows")}><img src="/sk-suite.png" alt="" width={34} height={34} /><span><b>SK Suite</b><small>{t("Desktop app · Windows")}</small></span></a>
        </> : undefined} />

      <JobSheet job={job} onClose={() => setJob(null)}
        onEdit={(j) => { setJob(null); setEditJob({ job: j }); }}
        onReport={(j) => { setJob(null); setReportFor(j); go("issues"); }} />
      <JobEditor open={!!editJob} job={editJob?.job ?? null} onClose={() => setEditJob(null)} />
      <PersonSheet id={personId} onClose={() => setPersonId(null)} />
      <PermissionsPrompt />
    </div>
  );
}

/** Start-up screen; after 10 s offers a way out instead of spinning forever. */
function StartUp({ onReset }: { onReset: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const i = setTimeout(() => setSlow(true), 10000); return () => clearTimeout(i); }, []);
  return (
    <div className="fill startup">
      <FullLoader label={t("Starting up…")} />
      {slow && (
        <div className="startup-help">
          <p className="muted">{t("This is taking longer than usual.")}</p>
          <button type="button" className="btn primary" onClick={() => location.reload()}>{t("Reload")}</button>
          <button type="button" className="link center" onClick={onReset}>{t("Sign out and sign in again")}</button>
        </div>
      )}
    </div>
  );
}
