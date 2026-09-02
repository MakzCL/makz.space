"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { browserClient } from "@/lib/supabase/client";
import type { Appearance, MotionSetting, Viewer } from "@/types";

export const APPEARANCE_KEY = "makz.appearance";
export const MOTION_KEY = "makz.motion";

/**
 * Dark is the primary material of this identity, so it is the default rather
 * than whatever the operating system happens to prefer. "Auto" is one press
 * away in the rail, the index sheet, the palette and settings.
 */
export const DEFAULT_APPEARANCE: Appearance = "dark";

interface EnvironmentValue {
  viewer: Viewer | null;
  appearance: Appearance;
  motion: MotionSetting;
  /** The material actually being rendered once "system" is resolved. */
  material: "dark" | "day";
  setAppearance: (next: Appearance) => void;
  setMotion: (next: MotionSetting) => void;
  cycleAppearance: () => void;
}

const EnvironmentContext = createContext<EnvironmentValue | null>(null);

function resolveMaterial(appearance: Appearance): "dark" | "day" {
  if (appearance !== "system") return appearance;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "day"
    : "dark";
}

/**
 * Environment state: who is here, which material the interface is rendered
 * in, and whether it is allowed to move.
 *
 * Signed in, these are database rows and follow the account across devices.
 * Signed out, they persist locally. The pre-paint script in the document head
 * applies the same values before first paint so there is never a flash.
 */
export function EnvironmentProvider({
  viewer,
  children,
}: {
  viewer: Viewer | null;
  children: ReactNode;
}) {
  const [appearance, setAppearanceState] = useState<Appearance>(
    viewer?.preferences.appearance ?? DEFAULT_APPEARANCE,
  );
  const [motion, setMotionState] = useState<MotionSetting>(
    viewer?.preferences.motion ?? "full",
  );
  const [material, setMaterial] = useState<"dark" | "day">("dark");

  // Signed-in accounts are authoritative: their rows win over anything this
  // device remembered. Derived during render, so a sign-in switches the
  // material in the same commit rather than a frame later.
  const [seenViewer, setSeenViewer] = useState(viewer?.id ?? null);
  if (viewer && seenViewer !== viewer.id) {
    setSeenViewer(viewer.id);
    setAppearanceState(viewer.preferences.appearance);
    setMotionState(viewer.preferences.motion);
  }

  // Signed out, the choice lives on the device. localStorage cannot be read
  // during render without disagreeing with the server-rendered markup, so it
  // is adopted once on mount — the pre-paint script has already applied the
  // same values to the document, so nothing visibly changes.
  useEffect(() => {
    if (viewer) return;
    const storedAppearance = window.localStorage.getItem(APPEARANCE_KEY);
    const storedMotion = window.localStorage.getItem(MOTION_KEY);
    if (
      storedAppearance === "dark" ||
      storedAppearance === "day" ||
      storedAppearance === "system"
    ) {
      /* Adopting a value from an external store (localStorage) that cannot be
         read during render without disagreeing with the server markup. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAppearanceState(storedAppearance);
    }
    if (storedMotion === "full" || storedMotion === "reduced") {
      setMotionState(storedMotion);
    }
  }, [viewer]);

  // Apply to the document and track the system preference while on "system".
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const next = resolveMaterial(appearance);
      setMaterial(next);
      document.documentElement.dataset.appearance = next;
      document.documentElement.style.colorScheme = next === "day" ? "light" : "dark";
    };
    apply();
    if (appearance !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  const persist = useCallback(
    (patch: Partial<{ appearance: Appearance; motion: MotionSetting }>) => {
      if (!viewer) {
        if (patch.appearance) {
          window.localStorage.setItem(APPEARANCE_KEY, patch.appearance);
        }
        if (patch.motion) window.localStorage.setItem(MOTION_KEY, patch.motion);
        return;
      }
      const supabase = browserClient();
      if (!supabase) return;
      // Optimistic: state has already moved, the row catches up.
      void supabase
        .from("preferences")
        .update(patch)
        .eq("user_id", viewer.id)
        .then(() => undefined);
    },
    [viewer],
  );

  const setAppearance = useCallback(
    (next: Appearance) => {
      setAppearanceState(next);
      persist({ appearance: next });
    },
    [persist],
  );

  const setMotion = useCallback(
    (next: MotionSetting) => {
      setMotionState(next);
      persist({ motion: next });
    },
    [persist],
  );

  const cycleAppearance = useCallback(() => {
    const order: Appearance[] = ["dark", "day", "system"];
    const next = order[(order.indexOf(appearance) + 1) % order.length]!;
    setAppearance(next);
  }, [appearance, setAppearance]);

  const value = useMemo<EnvironmentValue>(
    () => ({
      viewer,
      appearance,
      motion,
      material,
      setAppearance,
      setMotion,
      cycleAppearance,
    }),
    [appearance, cycleAppearance, material, motion, setAppearance, setMotion, viewer],
  );

  return (
    <EnvironmentContext.Provider value={value}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (!context) {
    throw new Error("useEnvironment must be used inside EnvironmentProvider");
  }
  return context;
}

/** The script that runs before first paint. Kept as a string so it can be
 *  inlined without a hydration boundary. */
export const APPEARANCE_BOOTSTRAP = `(function(){try{
var a=localStorage.getItem("${APPEARANCE_KEY}")||"${DEFAULT_APPEARANCE}";
var m=localStorage.getItem("${MOTION_KEY}")||"full";
var r=a==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"day":"dark"):a;
var d=document.documentElement;d.dataset.appearance=r;d.dataset.motion=m;
d.style.colorScheme=r==="day"?"light":"dark";
}catch(e){}})();`;
