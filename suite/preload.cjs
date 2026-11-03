// Narrow bridge for the hub page only (app windows get no preload).
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("suite", {
  apps: () => ipcRenderer.invoke("suite:apps"),
  state: () => ipcRenderer.invoke("suite:state"),
  open: (id) => ipcRenderer.invoke("suite:open", id),
  openInBrowser: (id) => ipcRenderer.invoke("suite:openInBrowser", id),
  setPalette: (p) => ipcRenderer.invoke("suite:palette", p),
  version: () => ipcRenderer.invoke("suite:version"),
  onState: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on("suite:state", h); return () => ipcRenderer.removeListener("suite:state", h); },
});
