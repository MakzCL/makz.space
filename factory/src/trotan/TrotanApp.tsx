// TROTAN — laser design & production. Shares sign-in, people and roles with SK Factory and KORTANA;
// keeps its own data (projects, machines, materials, settings, jobs) behind server-enforced rights.
import { LogOut, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FullLoader } from "../components/Loader";
import { ToastProvider } from "../components/Toast";
import { createBackend, type Backend } from "../lib/backend";
import { ROLE_META } from "../lib/roles";
import { StoreProvider, useHasStore, useStore } from "../lib/store";
import { Login } from "../screens/Login";
import { TrotanProvider, useT, type Section } from "./data";
import { Editor } from "./editor/Editor";
import { TrotanMark } from "./Mark";
import { Prepare } from "./prod/Prepare";
import { Produce } from "./prod/Produce";
import { SessionProvider, useSession } from "./session";
import { Btn, Empty } from "./ui";
import { Admin } from "./ws/Admin";
import { Manage } from "./ws/Manage";
import css from "./trotan.css?inline";

// The stylesheet ships inside this lazy chunk and is attached once (the other apps never load it).
if (typeof document !== "undefined" && !document.getElementById("trotan-css")) { const st = document.createElement("style"); st.id = "trotan-css"; st.textContent = css; document.head.appendChild(st); }

type WS = "manage" | "design" | "prepare" | "produce" | "admin";
const WORKSPACES: { v: WS; label: string; need: Section[] }[] = [
  { v: "manage", label: "Manage", need: ["manage"] }, { v: "design", label: "Design", need: ["design", "manage"] },
  { v: "prepare", label: "Prepare", need: ["prepare", "produce"] }, { v: "produce", label: "Produce", need: ["produce"] },
  { v: "admin", label: "Administration", need: ["admin", "approve", "manage"] },
];
const FACTORY_URL = "https://factory.makz.space", KORTANA_URL = "https://kortana.makz.space";
const getTheme = () => { try { return localStorage.getItem("trotan-theme") === "light" ? "light" : "dark"; } catch { return "dark"; } };

export function TrotanApp() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [theme, setTheme] = useState<"dark" | "light">(getTheme);
  useEffect(() => { createBackend().then(setBackend); }, []);
  useEffect(() => { document.documentElement.dataset.trotanTheme = theme; try { localStorage.setItem("trotan-theme", theme); } catch { /* ignore */ } }, [theme]);
  const check = useCallback(async () => { if (backend) setUser(await backend.currentUser()); }, [backend]);
  useEffect(() => { if (!backend) return; check(); return backend.onAuthChange(check); }, [backend, check]);
  return (
    <ToastProvider>
      <div className={`trotan ${theme}`}>
        {!backend || user === undefined ? <FullLoader label="Starting TROTAN…" />
          : user === null ? <div className="t-login"><Login backend={backend} onIn={check} brand={{ name: "TROTAN", sub: "Laser design & production · Skalarki Electronics Ltd", logo: <TrotanMark size={34} /> }} /></div>
            : <StoreProvider key={user} backend={backend} userId={user} onMissingProfile={async () => { await backend.signOut(); check(); }}>
              <Gate theme={theme} setTheme={setTheme} signOut={async () => { await backend.signOut(); setUser(null); }} />
            </StoreProvider>}
      </div>
    </ToastProvider>
  );
}
function Gate(p: { theme: "dark" | "light"; setTheme: (t: "dark" | "light") => void; signOut: () => void }) {
  const has = useHasStore();
  if (!has) return <FullLoader label="Loading TROTAN…" />;
  return <TrotanProvider><SessionProvider><Shell {...p} /></SessionProvider></TrotanProvider>;
}
const readHash = (): WS => { const h = location.hash.replace("#", "") as WS; return WORKSPACES.some((w) => w.v === h) ? h : "manage"; };

function Shell({ theme, setTheme, signOut }: { theme: "dark" | "light"; setTheme: (t: "dark" | "light") => void; signOut: () => void }) {
  const T = useT(); const S = useSession(); const { me } = useStore();
  const [ws, setWs] = useState<WS>(readHash);
  const allowed = WORKSPACES.filter((w) => w.need.some((n) => T.can(n)));
  const cur = allowed.find((w) => w.v === ws)?.v ?? allowed[0]?.v ?? null;
  const go = useCallback((w: WS) => { setWs(w); history.replaceState(null, "", `#${w}`); }, []);
  useEffect(() => { const f = () => setWs(readHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  useEffect(() => { document.title = `TROTAN · ${WORKSPACES.find((w) => w.v === cur)?.label ?? ""}${S.project ? ` · ${S.project.name}` : ""}`; }, [cur, S.project]);
  if (!T.ready) return <FullLoader label="Loading TROTAN…" />;
  if (!allowed.length) return (
    <div className="t-locked"><TrotanMark size={56} /><h2>TROTAN is not open for your role yet</h2>
      <p className="t-note">The Owner can give your role access in TROTAN → Administration → Access.</p>
      {T.error && <p className="t-note err">{T.error}</p>}
      <div className="t-row"><a className="t-btn" href={FACTORY_URL}>Open SK Factory</a><Btn onClick={signOut}>Sign out</Btn></div></div>
  );
  const dark = theme === "dark";
  return (
    <div className="t-app">
      <header className="t-top">
        <div className="t-brand"><TrotanMark size={26} /><b>TROTAN</b></div>
        <nav className="t-nav" aria-label="Workspaces">
          {allowed.map((w) => <button key={w.v} type="button" className={cur === w.v ? "on" : ""} onClick={() => go(w.v)} data-testid={`ws-${w.v}`}>{w.label}</button>)}
        </nav>
        <div className="t-proj">{S.project ? <><span className="t-proj-n" title={S.project.name}>{S.project.number} · {S.project.name}</span><span className={`t-dot ${S.saveState}`} title={S.saveState} /></> : <span className="t-muted">No project open</span>}</div>
        <div className="t-top-r">
          <a className="t-applink" href={FACTORY_URL} title="SK Factory">Factory</a><a className="t-applink" href={KORTANA_URL} title="KORTANA inventory">Kortana</a>
          <button type="button" className="t-btn icon" onClick={() => setTheme(dark ? "light" : "dark")} title={dark ? "Light mode" : "Dark mode"} aria-label="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
          <span className="t-me" title={ROLE_META[me.role]?.label}>{me.full_name}<small>{ROLE_META[me.role]?.label}</small></span>
          <button type="button" className="t-btn icon" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
      </header>
      {S.recovery && <div className="t-banner warn" data-testid="recovery">Unsaved changes from {new Date(S.recovery.at).toLocaleString("en-GB")} were found in this browser. <Btn small tone="primary" onClick={S.restoreRecovery} testid="restore-recovery">Restore them</Btn><Btn small onClick={S.dropRecovery}>Discard</Btn></div>}
      {S.saveState === "conflict" && <div className="t-banner err">Someone else saved this project while you were editing. Your changes are kept in this browser. <Btn small onClick={() => S.project && S.open(S.project.id)}>Reload their version</Btn></div>}
      {T.error && <div className="t-banner err">{T.error}</div>}
      <main className="t-main">
        {cur === "manage" && <Manage go={go} />}
        {cur === "design" && (S.project ? <Editor dark={dark} readOnly={!T.can("design")} /> : <div className="t-page"><Empty title="No project open" hint="Create or open a project in MANAGE."><Btn tone="primary" onClick={() => go("manage")}>Go to MANAGE</Btn></Empty></div>)}
        {cur === "prepare" && <Prepare dark={dark} go={go} />}
        {cur === "produce" && <Produce dark={dark} />}
        {cur === "admin" && <Admin go={go} />}
      </main>
    </div>
  );
}
