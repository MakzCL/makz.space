import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { TransfersView } from "./Locations";
import { WarehouseTasksView } from "./Warehouse";
import { BarChart3, Boxes, CalendarClock, ChevronDown, Factory, LifeBuoy, LogOut, Moon, Package, Plus, Settings2, ShoppingCart, Sun, Tag, Upload, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { FullLoader } from "../components/Loader";
import { ToastProvider } from "../components/Toast";
import { Btn, Empty, LangSwitch } from "../components/ui";
import { createBackend, type Backend } from "../lib/backend";
import { t } from "../lib/i18n";
import { setPrefs, usePrefs } from "../lib/prefs";
import { ROLE_META, can, kimeraSections } from "../lib/roles";
import { StoreProvider, useHasStore, useStore } from "../lib/store";
import { HistoryView, ImportSheet, ItemsView, RecipesView, stockLevels } from "../screens/Inventory";
import { Login } from "../screens/Login";
import { ProductionSheet } from "../screens/Production";
import { PoSheet, PurchasingView, SuppliersView } from "../screens/Purchasing";
import { DocLinkProvider } from "../lib/doclink";
import { KInsights } from "./Insights";
import { Make, MoSheet } from "./Make";
import { Plan } from "./Plan";
import { Sell } from "./Sell";
import { Settings } from "./Settings";
import { SubTabs } from "./kit";
import { Tickets } from "./Tickets";
import { SkKimera } from "./mark";
import { KLogo } from "../components/Logo";
import { Splash } from "../components/Splash";

export const FACTORY_URL = "https://factory.makz.space";

type Tab = "sell" | "make" | "buy" | "stock" | "items" | "plan" | "tickets" | "insights" | "settings";
const NAV: { v: Tab; label: string; icon: ReactNode }[] = [
  { v: "sell", label: "Sell", icon: <Tag size={16} /> },
  { v: "make", label: "Make", icon: <Factory size={16} /> },
  { v: "buy", label: "Buy", icon: <ShoppingCart size={16} /> },
  { v: "stock", label: "Stock", icon: <Boxes size={16} /> },
  { v: "items", label: "Items", icon: <Package size={16} /> },
  { v: "plan", label: "Plan", icon: <CalendarClock size={16} /> },
  { v: "tickets", label: "Tickets", icon: <LifeBuoy size={16} /> },
  { v: "insights", label: "Insights", icon: <BarChart3 size={16} /> },
  { v: "settings", label: "Settings", icon: <Settings2 size={16} /> },
];

export function KimeraApp() {
  const prefs = usePrefs();
  const [backend, setBackend] = useState<Backend | null>(null);
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [splash, setSplash] = useState(() => { try { return !sessionStorage.getItem("kim-splashed"); } catch { return true; } });
  const endSplash = useCallback(() => { try { sessionStorage.setItem("kim-splashed", "1"); } catch { /* storage blocked */ } setSplash(false); }, []);
  useEffect(() => { createBackend().then(setBackend); }, []);
  const check = useCallback(async () => { if (backend) setUser(await backend.currentUser()); }, [backend]);
  useEffect(() => { if (!backend) return; check(); return backend.onAuthChange(check); }, [backend, check]);
  return (
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"}>
      <ToastProvider>
        <AnimatePresence>{splash && <Splash key="splash" onDone={endSplash} />}</AnimatePresence>
        <div className="kimera">
          {!backend || user === undefined ? <FullLoader label={t("Starting up…")} />
            : user === null ? <div className="fill"><Login backend={backend} onIn={check} brand={{ name: "Kimera", sub: t("Inventory · Skalarki Electronics Ltd"), logo: <KLogo size={30} /> }} /></div>
              : (
                <StoreProvider key={user} backend={backend} userId={user} onMissingProfile={async () => { await backend.signOut(); check(); }}>
                  <Gate signOut={async () => { await backend.signOut(); setUser(null); }} />
                </StoreProvider>
              )}
        </div>
      </ToastProvider>
    </MotionConfig>
  );
}

function Gate({ signOut }: { signOut: () => void }) {
  const has = useHasStore();
  if (!has) return <FullLoader label={t("Loading Kimera…")} />;
  return <Access signOut={signOut} />;
}

function Access({ signOut }: { signOut: () => void }) {
  const { me, db } = useStore();
  if (!me.active || kimeraSections(me.role, db.kimera_access).length === 0) {
    return (
      <div className="k-locked">
        <KLogo size={48} />
        <h2>{t("Kimera is not open for your role yet")}</h2>
        <p className="muted">{t("The owner can give your role access in Kimera → Settings → Access.")}</p>
        <p className="muted">{t("Your jobs, chat and clock-in live in the Factory app.")}</p>
        <a className="btn primary" href={FACTORY_URL}>{t("Open Factory")}</a>
        <button type="button" className="link center" onClick={signOut}>{t("Sign out")}</button>
      </div>
    );
  }
  return <Shell signOut={signOut} />;
}

const readHash = (): Tab => {
  const h = location.hash.replace("#", "").split("/")[0] as Tab;
  return NAV.some((n) => n.v === h) ? h : "sell";
};

function Shell({ signOut }: { signOut: () => void }) {
  const { db, me, ready } = useStore();
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>(readHash);
  const [order, setOrder] = useState<string | null>(null);
  const [sellKind, setSellKind] = useState<"order" | "quote" | "customers">("order");
  const [newOrder, setNewOrder] = useState<"order" | "quote" | null>(null);
  const [mo, setMo] = useState<string | null>(null);
  const [newMo, setNewMo] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [menu, setMenu] = useState<"create" | "me" | null>(null);
  const [stockView, setStockView] = useState<"inventory" | "history" | "transfers" | "tasks">(() => db.wh_tasks.some((w) => w.assigned_to === me.id && ["open", "in_progress"].includes(w.status)) && !can.admin(me.role) ? "tasks" : "inventory");
  const [itemsView, setItemsView] = useState<"products" | "materials" | "recipes">("products");
  const [buyView, setBuyView] = useState<"pos" | "suppliers">("pos");
  const [importing, setImporting] = useState(false);
  const [routes, setRoutes] = useState(false);
  const [jobPeek, setJobPeek] = useState<string | null>(null);
  const [poPeek, setPoPeek] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  // Section access is chosen by the owner in Settings → Access (Owner/Developer always see all).
  const allowed = kimeraSections(me.role, db.kimera_access) as Tab[];
  const cur: Tab | null = allowed.includes(tab) ? tab : allowed[0] ?? null;

  const go = (x: Tab) => { setTab(x); setMenu(null); history.replaceState(null, "", `#${x}`); main.current?.scrollTo({ top: 0 }); };
  useEffect(() => { const f = () => setTab(readHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  useEffect(() => { document.title = `Kimera · ${t(NAV.find((n) => n.v === (cur ?? "sell"))!.label)}`; }, [cur]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".k-menu-wrap")) setMenu(null); };
    window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close);
  }, [menu]);
  const openOrder = (id: string) => { setOrder(id); const o = db.orders.find((x) => x.id === id); if (o) setSellKind(o.kind); go("sell"); };

  const lv = stockLevels(db);
  const badges: Partial<Record<Tab, number>> = {
    sell: db.orders.filter((o) => o.kind === "order" && o.status === "open" && (o.delivery === "not_shipped" || o.delivery === "partially_shipped")).length,
    tickets: db.issues.filter((i) => i.status === "open").length,
    stock: db.stock_items.filter((s) => !s.archived && s.min_quantity > 0 && s.quantity - (lv.committed.get(s.id) ?? 0) + (lv.expected.get(s.id) ?? 0) <= s.min_quantity).length,
  };
  const admin = can.admin(me.role);

  const screen = (() => {
    if (!cur) return (
      <div className="k-page"><Empty icon={<Boxes size={28} />} title={t("No Kimera sections for your role yet")}
        hint={t("Ask the owner to give your role access in Kimera → Settings → Access.")} /></div>
    );
    switch (cur) {
      case "sell": return <Sell openId={order} onOpen={setOrder} kind={sellKind} setKind={setSellKind} creating={newOrder} setCreating={setNewOrder} />;
      case "make": return <Make openId={mo} onOpen={setMo} onOrder={(id) => { setMo(null); openOrder(id); }} creating={newMo} setCreating={setNewMo} />;
      case "buy": return (
        <div className="k-page">
          <div className="k-head"><div><h1>{t("Buy")}</h1><p className="muted">{t("Purchase orders and suppliers. Receiving books stock in at cost.")}</p></div>
            <div className="k-subtabs"><SubTabs value={buyView} onChange={setBuyView} tabs={[{ value: "pos", label: t("Purchase orders") }, { value: "suppliers", label: t("Suppliers") }]} /></div></div>
          {buyView === "pos" ? <PurchasingView /> : <SuppliersView />}
        </div>
      );
      case "stock": return (
        <div className="k-page">
          <div className="k-head"><div><h1>{t("Stock")}</h1><p className="muted">{t("What's on the shelf, what's committed to jobs and what's on the way.")}</p></div>
            <div className="k-subtabs"><SubTabs value={stockView} onChange={setStockView} tabs={[{ value: "inventory", label: t("Inventory") }, { value: "tasks", label: t("Tasks"), count: db.wh_tasks.filter((w) => w.assigned_to === me.id && ["open", "in_progress"].includes(w.status)).length }, { value: "transfers", label: t("Transfers"), count: db.stock_transfers.filter((x) => x.status === "in_transit").length }, { value: "history", label: t("Stock movements") }]} /></div>
            <div className="row gap"><Btn tone="soft" icon={<Upload size={16} />} onClick={() => setImporting(true)}>{t("Import CSV")}</Btn></div></div>
          {stockView === "inventory" ? <ItemsView /> : stockView === "tasks" ? <WarehouseTasksView /> : stockView === "transfers" ? <TransfersView /> : <HistoryView />}
        </div>
      );
      case "items": return (
        <div className="k-page">
          <div className="k-head"><div><h1>{t("Items")}</h1><p className="muted">{t("Products you sell, materials you buy, their recipes and production routes.")}</p></div>
            <div className="k-subtabs"><SubTabs value={itemsView} onChange={setItemsView} tabs={[{ value: "products", label: t("Products") }, { value: "materials", label: t("Materials") }, { value: "recipes", label: t("Recipes") }]} /></div>
            {admin && <div className="row gap"><Btn tone="soft" icon={<Wrench size={16} />} onClick={() => setRoutes(true)}>{t("Stations & routes")}</Btn></div>}</div>
          {itemsView === "products" ? <ItemsView key="p" kinds={["product", "part", "service"]} /> : itemsView === "materials" ? <ItemsView key="m" kinds={["material"]} /> : <RecipesView />}
        </div>
      );
      case "plan": return <Plan onOrder={openOrder} onBuy={() => { setBuyView("pos"); go("buy"); }} />;
      case "tickets": return <Tickets openId={ticket} onOpen={setTicket} onJob={(id) => setJobPeek(id)} />;
      case "insights": return <KInsights />;
      case "settings": return <Settings />;
    }
  })();

  return (
    <div className="k-app">
      <header className="k-top">
        <a className="k-brand" href="#sell" onClick={(e) => { e.preventDefault(); go("sell"); }}><SkKimera /></a>
        <nav className="k-nav" aria-label={t("Sections")}>
          {NAV.filter((n) => allowed.includes(n.v)).map((n) => (
            <button type="button" key={n.v} className={cur === n.v ? "on" : ""} aria-current={cur === n.v ? "page" : undefined} onClick={() => go(n.v)}>
              {n.icon}<span>{t(n.label)}</span>{badges[n.v] ? <i>{badges[n.v]}</i> : null}
              {cur === n.v && <motion.em layoutId="k-nav-on" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
            </button>
          ))}
        </nav>
        <div className="k-right">
          {admin && (
            <div className="k-menu-wrap">
              <Btn tone="primary" small icon={<Plus size={16} />} onClick={() => setMenu(menu === "create" ? null : "create")}>{t("Create")}</Btn>
              <AnimatePresence>{menu === "create" && (
                <motion.div className="k-menu right" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                  {allowed.includes("sell") && <button type="button" onClick={() => { setSellKind("order"); go("sell"); setNewOrder("order"); }}><Tag size={15} />{t("Sales order")}</button>}
                  {allowed.includes("sell") && <button type="button" onClick={() => { setSellKind("quote"); go("sell"); setNewOrder("quote"); }}><Tag size={15} />{t("Quote")}</button>}
                  {allowed.includes("make") && <button type="button" onClick={() => { go("make"); setNewMo(true); }}><Factory size={15} />{t("Manufacturing order")}</button>}
                  {allowed.includes("buy") && <button type="button" onClick={() => { setBuyView("pos"); go("buy"); }}><ShoppingCart size={15} />{t("Purchase order")}</button>}
                </motion.div>
              )}</AnimatePresence>
            </div>
          )}
          <div className="k-menu-wrap">
            <button type="button" className="k-me" onClick={() => setMenu(menu === "me" ? null : "me")} aria-label={t("Account")}><Avatar p={me} size={30} /><ChevronDown size={14} /></button>
            <AnimatePresence>{menu === "me" && (
              <motion.div className="k-menu right" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                <div className="k-menu-me"><b>{me.full_name}</b><small className="muted">{t(ROLE_META[me.role].label)}</small></div>
                <button type="button" onClick={() => setPrefs({ theme: prefs.theme === "light" ? "night" : "light" })}>{prefs.theme === "light" ? <Moon size={15} /> : <Sun size={15} />}{prefs.theme === "light" ? t("Dark mode") : t("Light mode")}</button>
                <div className="k-menu-lang"><LangSwitch /></div>
                <a href={FACTORY_URL}><Factory size={15} />{t("Open Factory app")}</a>
                <button type="button" onClick={signOut}><LogOut size={15} />{t("Sign out")}</button>
              </motion.div>
            )}</AnimatePresence>
          </div>
        </div>
      </header>
      <main ref={main} className="k-main">
        {!ready ? <FullLoader label={t("Loading Kimera…")} /> : (
          <motion.div key={cur ?? "none"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            <ErrorBoundary place={`kimera:${cur}`}>
              <DocLinkProvider value={(d) => d.kind === "po" ? setPoPeek(d.id) : d.kind === "job" ? setJobPeek(d.id) : allowed.includes("sell") ? openOrder(d.id) : undefined}>{screen}</DocLinkProvider>
            </ErrorBoundary>
          </motion.div>
        )}
      </main>
      <PoSheet po={poPeek ? db.purchase_orders.find((p) => p.id === poPeek) ?? null : null} onClose={() => setPoPeek(null)} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
      <ProductionSheet open={routes} onClose={() => setRoutes(false)} />
      <MoSheet job={jobPeek ? db.jobs.find((j) => j.id === jobPeek) ?? null : null} onClose={() => setJobPeek(null)} onOrder={(id) => { setJobPeek(null); setTicket(null); openOrder(id); }} />
    </div>
  );
}
