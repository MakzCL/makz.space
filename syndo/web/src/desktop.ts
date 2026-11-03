/**
 * Integration with the SEND desktop shell (when running inside it).
 * Everything here is optional: in a browser `window.syndoDesktop` is absent
 * and nothing changes.
 */
import { useVoice, pttPress, pttRelease } from "./voice/session.ts";
import { onEvent, useStore } from "./store.ts";

export interface DesktopUpdate { state: "idle" | "checking" | "available" | "downloading" | "ready" | "none" | "error" | "disabled"; version?: string; percent?: number; message?: string }
export interface DesktopSettings { serverUrl: string; closeToTray: boolean; material: "none" | "mica" | "acrylic"; hardwareAcceleration: boolean; reduceBackgroundWork: boolean; launchOnStartup: boolean; restartRequired: boolean }
export interface SENDDesktop {
  version: string; platform: string;
  capabilities: { customTitlebar?: boolean; globalPtt: boolean; systemAudio: boolean; windowMaterial: boolean; autoUpdate: boolean; tray: boolean };
  setPushToTalk(code: string | null): Promise<{ ok: boolean; reason?: string }>;
  onPushToTalk(cb: (down: boolean) => void): () => void;
  setWindowMaterial(m: "none" | "mica" | "acrylic"): Promise<{ ok: boolean }>;
  getSettings(): Promise<DesktopSettings>;
  windowControl?(action: "minimize" | "maximize" | "close"): Promise<{ maximized: boolean }>;
  setPerformance?(v: { hardwareAcceleration?: boolean; reduceBackgroundWork?: boolean }): Promise<{ ok: boolean; restartRequired: boolean }>;
  setLaunchOnStartup?(v: boolean): Promise<{ ok: boolean }>;
  restart?(): Promise<void>;
  refreshInterface?(): Promise<void>;
  setCloseToTray(v: boolean): Promise<{ ok: boolean }>;
  changeServer(): Promise<void>;
  getUpdateStatus(): Promise<DesktopUpdate>;
  checkForUpdates(): Promise<DesktopUpdate>;
  restartToUpdate(): Promise<void>;
  onUpdateStatus(cb: (s: DesktopUpdate) => void): () => void;
  flash(): Promise<void>;
}
export const desktop: SENDDesktop | null = (window as any).syndoDesktop ?? null;

export let globalPttError: string | null = null;
/** Keep the shell's global push-to-talk key in sync with Voice settings. */
async function syncPtt() {
  if (!desktop?.capabilities.globalPtt) return;
  const s = useVoice.getState().settings;
  const r = await desktop.setPushToTalk(s.mode === "ptt" ? s.pttKey : null).catch(() => ({ ok: false, reason: "Global push-to-talk failed to start." }));
  globalPttError = r.ok ? null : r.reason ?? null;
}

export function initDesktop() {
  if (!desktop) return;
  document.documentElement.dataset.desktop = desktop.platform;
  desktop.onPushToTalk((down) => (down ? pttPress() : pttRelease()));
  let last = "";
  useVoice.subscribe((s) => { const k = `${s.settings.mode}|${s.settings.pttKey}`; if (k !== last) { last = k; syncPtt(); } });
  syncPtt();
  desktop.getSettings().then((c) => { if (c.material !== "none") document.documentElement.dataset.desktopMaterial = c.material; }).catch(() => {});
  // Taskbar attention for mentions/DMs while the window isn't focused.
  onEvent("MENTION", () => { if (!document.hasFocus() && useStore.getState().me?.status !== "dnd") desktop.flash(); });
}

export async function setDesktopMaterial(m: "none" | "mica" | "acrylic") {
  if (!desktop?.capabilities.windowMaterial) return false;
  const r = await desktop.setWindowMaterial(m);
  if (r.ok) { if (m === "none") delete document.documentElement.dataset.desktopMaterial; else document.documentElement.dataset.desktopMaterial = m; }
  return r.ok;
}
