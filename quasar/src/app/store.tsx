import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Api } from "../lib/api";
import type { EffectInfo, Frame, Profile, Snapshot } from "../lib/types";

export type Route =
  | { page: "rig" }
  | { page: "device"; id: string }
  | { page: "studio" }
  | { page: "library" }
  | { page: "macros" }
  | { page: "profiles" }
  | { page: "integrations" }
  | { page: "settings" };

interface Store {
  api: Api;
  snap: Snapshot;
  setSnap: (s: Snapshot) => void;
  refresh: () => Promise<void>;
  library: EffectInfo[];
  route: Route;
  go: (r: Route) => void;
  toast: (msg: string) => void;
  profile: Profile;
  /** Replace the active profile locally and persist it. */
  updateProfile: (fn: (p: Profile) => Profile) => void;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

// Frames bypass React state: subscribers draw straight to canvases.
type FrameSub = (f: Frame) => void;
const frameSubs = new Set<FrameSub>();
let lastFrame: Frame | null = null;
export function useFrame(cb: FrameSub) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const s: FrameSub = (f) => ref.current(f);
    frameSubs.add(s);
    if (lastFrame) s(lastFrame);
    return () => void frameSubs.delete(s);
  }, []);
}
export const latestFrame = () => lastFrame;

export function StoreProvider({ api, initial, library, children }: { api: Api; initial: Snapshot; library: EffectInfo[]; children: ReactNode }) {
  const [snap, setSnap] = useState(initial);
  const [route, setRoute] = useState<Route>({ page: "rig" });
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);

  useEffect(
    () =>
      api.onFrame((f) => {
        lastFrame = f;
        frameSubs.forEach((s) => s(f));
      }),
    [api],
  );

  const toast = useCallback((msg: string) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  const refresh = useCallback(async () => setSnap(await api.snapshot()), [api]);
  // OpenRGB finds devices over several seconds; follow along everywhere
  useEffect(() => api.on("devices-changed", () => void refresh()), [api, refresh]);
  const profile = snap.profiles.find((p) => p.id === snap.active_profile) ?? snap.profiles[0];

  const updateProfile = useCallback(
    (fn: (p: Profile) => Profile) => {
      setSnap((s) => {
        const next = { ...s, profiles: s.profiles.map((p) => (p.id === s.active_profile ? fn(structuredClone(p)) : p)) };
        const np = next.profiles.find((p) => p.id === s.active_profile)!;
        api.saveProfile(np);
        return next;
      });
    },
    [api],
  );

  const go = useCallback((r: Route) => {
    setRoute(r);
    document.querySelector(".main")?.scrollTo({ top: 0 });
  }, []);

  return (
    <Ctx.Provider value={{ api, snap, setSnap, refresh, library, route, go, toast, profile, updateProfile }}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
