/**
 * The only bridge between the web app and the desktop shell. Exposes a small,
 * explicit API (no Node, no arbitrary IPC). Local pages (server chooser,
 * screen picker) get their own narrow APIs.
 */
import { contextBridge, ipcRenderer } from "electron";

const info = ipcRenderer.sendSync("desktop:info");
const on = <T>(channel: string, cb: (v: T) => void) => {
  const fn = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, fn);
  return () => { ipcRenderer.removeListener(channel, fn); };
};

if (location.protocol === "file:") {
  // Local pages bundled with the app.
  contextBridge.exposeInMainWorld("syndoLocal", {
    setServer: (url: string) => ipcRenderer.invoke("connect:set-server", String(url)),
    connectInfo: () => ipcRenderer.invoke("connect:info"),
    pickerSources: () => ipcRenderer.invoke("picker:sources"),
    choose: (v: { id: string; audio: boolean } | null) => ipcRenderer.send("picker:choose", v),
  });
} else {
  contextBridge.exposeInMainWorld("syndoDesktop", {
    version: String(info.version),
    platform: String(info.platform),
    capabilities: Object.freeze({ ...info.capabilities }),
    setPushToTalk: (code: string | null) => ipcRenderer.invoke("desktop:set-ptt", code),
    onPushToTalk: (cb: (down: boolean) => void) => on<boolean>("ptt", (v) => cb(!!v)),
    setWindowMaterial: (m: "none" | "mica" | "acrylic") => ipcRenderer.invoke("desktop:set-material", m),
    getSettings: () => ipcRenderer.invoke("desktop:settings"),
    setCloseToTray: (v: boolean) => ipcRenderer.invoke("desktop:set-close-to-tray", !!v),
    changeServer: () => ipcRenderer.invoke("desktop:change-server"),
    getUpdateStatus: () => ipcRenderer.invoke("desktop:update-status"),
    checkForUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
    restartToUpdate: () => ipcRenderer.invoke("desktop:restart-to-update"),
    onUpdateStatus: (cb: (s: unknown) => void) => on("update-status", cb),
    flash: () => ipcRenderer.invoke("desktop:flash"),
  });
}
