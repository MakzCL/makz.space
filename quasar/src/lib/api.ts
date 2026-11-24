// One API for both worlds: the Tauri desktop app (Rust engine over IPC) and
// the browser demo (DemoEngine in this tab).

import type { DeviceSettings, EffectInfo, Frame, Macro, OpenRgbStatus, Placement, Profile, Scene, Settings, Snapshot, Step, UpdateInfo } from "./types";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Api {
  desktop: boolean;
  ready(): Promise<void>;
  snapshot(): Promise<Snapshot>;
  library(): Promise<EffectInfo[]>;
  setScene(scene: Scene): Promise<void>;
  activateProfile(id: string): Promise<Snapshot>;
  saveProfile(p: Profile): Promise<Snapshot>;
  deleteProfile(id: string): Promise<Snapshot>;
  setBrightness(v: number): Promise<void>;
  setPlacement(id: string, p: Placement): Promise<void>;
  arrange(): Promise<Snapshot>;
  setDeviceSettings(id: string, s: DeviceSettings): Promise<void>;
  rescan(): Promise<Snapshot>;
  setSettings(s: Settings): Promise<Snapshot>;
  saveMacro(m: Macro): Promise<Macro[]>;
  deleteMacro(id: string): Promise<Macro[]>;
  playMacro(id: string): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<Step[]>;
  pressAt(u: number, v: number): Promise<void>;
  cs2Config(): Promise<string>;
  installCs2(): Promise<string>;
  setAutostart(on: boolean): Promise<void>;
  onFrame(cb: (f: Frame) => void): () => void;
  openrgbStatus(): Promise<OpenRgbStatus>;
  openrgbInstall(): Promise<void>;
  openrgbStart(): Promise<void>;
  openrgbStop(): Promise<void>;
  checkUpdates(): Promise<UpdateInfo | null>;
  installUpdate(): Promise<void>;
  /** Backend events: openrgb, update, update-progress, update-error, devices-changed. */
  on<T>(event: string, cb: (payload: T) => void): () => void;
  /** Demo only: simulate a keypress / a hit in game. */
  demoKey?(label: string): void;
  demoHit?(): void;
}

function decode(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function desktopApi(): Promise<Api> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return {
    desktop: true,
    ready: () => invoke("app_ready"),
    snapshot: () => invoke("snapshot"),
    library: () => invoke("library"),
    setScene: (scene) => invoke("set_scene", { scene }),
    activateProfile: (id) => invoke("activate_profile", { id }),
    saveProfile: (profile) => invoke("save_profile", { profile }),
    deleteProfile: (id) => invoke("delete_profile", { id }),
    setBrightness: (value) => invoke("set_brightness", { value }),
    setPlacement: (id, placement) => invoke("set_placement", { id, placement }),
    arrange: () => invoke("arrange_layout"),
    setDeviceSettings: (id, settings) => invoke("set_device_settings", { id, settings }),
    rescan: () => invoke("rescan"),
    setSettings: (settings) => invoke("set_settings", { settings }),
    saveMacro: (m) => invoke("save_macro", { m }),
    deleteMacro: (id) => invoke("delete_macro", { id }),
    playMacro: (id) => invoke("play_macro", { id }),
    startRecording: () => invoke("start_recording"),
    stopRecording: () => invoke("stop_recording"),
    pressAt: (u, v) => invoke("press_at", { u, v }),
    cs2Config: () => invoke("cs2_config"),
    installCs2: () => invoke("install_cs2_config"),
    setAutostart: (enabled) => invoke("set_autostart", { enabled }),
    openrgbStatus: () => invoke("openrgb_status"),
    openrgbInstall: () => invoke("openrgb_install"),
    openrgbStart: () => invoke("openrgb_start"),
    openrgbStop: () => invoke("openrgb_stop"),
    checkUpdates: () => invoke("check_updates"),
    installUpdate: () => invoke("install_update"),
    on(event, cb) {
      let un: (() => void) | undefined;
      let dead = false;
      listen(event, (e) => cb(e.payload as never)).then((u) => (dead ? u() : (un = u)));
      return () => {
        dead = true;
        un?.();
      };
    },
    onFrame(cb) {
      let un: (() => void) | undefined;
      let dead = false;
      listen<{ w: number; h: number; canvas: string; devices: [string, string][]; stats: Frame["stats"] }>("frame", (e) => {
        const p = e.payload;
        cb({ w: p.w, h: p.h, canvas: decode(p.canvas), devices: new Map(p.devices.map(([id, c]) => [id, decode(c)])), stats: p.stats });
      }).then((u) => (dead ? u() : (un = u)));
      return () => {
        dead = true;
        un?.();
      };
    },
  };
}

async function demoApi(): Promise<Api> {
  const { DemoEngine } = await import("./demo/engine");
  const e = new DemoEngine();
  const subs = new Set<(f: Frame) => void>();
  let last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    e.tick(dt);
    e.stats.fps = e.stats.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    if (subs.size) {
      const f = e.frame();
      subs.forEach((s) => s(f));
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const ok = <T,>(v: T) => Promise.resolve(v);
  return {
    desktop: false,
    ready: () => ok(undefined),
    snapshot: () => ok(e.snapshot()),
    library: () => ok(e.library),
    setScene: (s) => ok(e.setScene(s)),
    activateProfile: (id) => (e.activate(id), ok(e.snapshot())),
    saveProfile: (p) => (e.saveProfile(p), ok(e.snapshot())),
    deleteProfile: (id) => {
      try {
        e.deleteProfile(id);
        return ok(e.snapshot());
      } catch (err) {
        return Promise.reject(String((err as Error).message));
      }
    },
    setBrightness: (v) => ok(void (e.profile().brightness = v)),
    setPlacement: (id, p) => ok(e.setPlacement(id, p)),
    arrange: () => (e.arrange(), ok(e.snapshot())),
    setDeviceSettings: (id, s) => ok(e.setDeviceSettings(id, s)),
    rescan: () => new Promise((r) => setTimeout(() => r(e.snapshot()), 700)),
    setSettings: (s) => ((e.settings = s), ok(e.snapshot())),
    saveMacro: (m) => (e.saveMacro(m), ok(structuredClone(e.macros))),
    deleteMacro: (id) => (e.deleteMacro(id), ok(structuredClone(e.macros))),
    playMacro: () => ok(undefined),
    startRecording: () => ok(e.startRecording()),
    stopRecording: () => ok(e.stopRecording()),
    pressAt: (u, v) => ok(e.pressAt(u, v)),
    cs2Config: () =>
      ok(`"QUASAR Lighting"\n{\n  "uri" "http://127.0.0.1:${e.settings.gsi_port}/cs2"\n  "timeout" "1.0"\n  "buffer" "0.05"\n  "throttle" "0.05"\n  "heartbeat" "10.0"\n  "data"\n  {\n    "provider" "1"\n    "round" "1"\n    "player_id" "1"\n    "player_state" "1"\n    "player_weapons" "1"\n  }\n}\n`),
    installCs2: () => Promise.reject("Installing the game config needs the desktop app."),
    setAutostart: () => ok(undefined),
    openrgbStatus: () => ok({ phase: "unsupported", progress: 0, message: "The web demo cannot run OpenRGB.", path: null, version: "1.1", size_mb: 22 }),
    openrgbInstall: () => Promise.reject("Needs the desktop app."),
    openrgbStart: () => Promise.reject("Needs the desktop app."),
    openrgbStop: () => ok(undefined),
    checkUpdates: () => ok(null),
    installUpdate: () => Promise.reject("Needs the desktop app."),
    on: () => () => {},
    onFrame(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    demoKey: (label) => {
      e.pressKey(label);
      e.recordKey(label, true);
    },
    demoHit: () => e.hit(),
  };
}

let api: Promise<Api> | null = null;
export function getApi(): Promise<Api> {
  return (api ??= isDesktop ? desktopApi() : demoApi());
}
