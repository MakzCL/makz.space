import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { getApi, type Api } from "../lib/api";
import type { EffectInfo, Snapshot } from "../lib/types";
import { StoreProvider, useStore } from "./store";
import { Intro } from "../components/Intro";
import { TitleBar } from "../components/TitleBar";
import { Ambient } from "../components/Preview";
import { Rig } from "../pages/Rig";
import { DevicePage } from "../pages/Device";
import { Studio } from "../pages/Studio";
import { Library } from "../pages/Library";
import { Macros } from "../pages/Macros";
import { Profiles } from "../pages/Profiles";
import { Integrations } from "../pages/Integrations";
import { SettingsPage } from "../pages/Settings";

function Pages() {
  const { route, snap } = useStore();
  const key = route.page === "device" ? `device:${route.id}` : route.page;
  let page;
  switch (route.page) {
    case "rig": page = <Rig />; break;
    case "device": {
      const d = snap.devices.find((d) => d.info.id === route.id);
      page = d ? <DevicePage device={d} /> : <Rig />;
      break;
    }
    case "studio": page = <Studio />; break;
    case "library": page = <Library />; break;
    case "macros": page = <Macros />; break;
    case "profiles": page = <Profiles />; break;
    case "integrations": page = <Integrations />; break;
    case "settings": page = <SettingsPage />; break;
  }
  return (
    <main className="main">
      <AnimatePresence mode="wait">
        <motion.div key={key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
          {page}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

function DemoKeys() {
  const { api } = useStore();
  useEffect(() => {
    if (api.desktop) return;
    const label = (e: KeyboardEvent) => {
      const map: Record<string, string> = { Escape: "Esc", " ": "Space", Enter: "Enter", Backspace: "Backspace", Tab: "Tab", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Shift: "LShift", Control: "LCtrl", Alt: "LAlt", CapsLock: "Caps" };
      return map[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      api.demoKey?.(label(e));
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [api]);
  return null;
}

export function App() {
  const [boot, setBoot] = useState<{ api: Api; snap: Snapshot; lib: EffectInfo[] } | null>(null);
  const [intro, setIntro] = useState(() => {
    try {
      return !sessionStorage.getItem("quasar-intro") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    (async () => {
      const api = await getApi();
      const [snap, lib] = await Promise.all([api.snapshot(), api.library()]);
      setBoot({ api, snap, lib });
      // not requestAnimationFrame: the main window is hidden until this
      // call lands, and hidden webviews do not run animation frames
      setTimeout(() => api.ready(), 30);
    })();
  }, []);

  const done = () => {
    setIntro(false);
    try {
      sessionStorage.setItem("quasar-intro", "1");
    } catch {
      /* private mode */
    }
  };
  return (
    <>
      {boot && (
        <StoreProvider api={boot.api} initial={boot.snap} library={boot.lib}>
          <Ambient />
          <div className="grain" />
          <div className="app">
            <TitleBar />
            <Pages />
          </div>
          <DemoKeys />
        </StoreProvider>
      )}
      {intro && <Intro onDone={done} />}
    </>
  );
}
