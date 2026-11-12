// NUCLUES desktop shell (Electron). Serves the built web app (dist/) from a private app:// scheme so the
// ngspice worker and its WebAssembly load the same way as on the web. No network access is needed.
const { app, BrowserWindow, protocol, net, shell, Menu, dialog } = require("electron");
const path = require("node:path"); const { pathToFileURL } = require("node:url");

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const ROOT = path.join(__dirname, "..", "dist");

function createWindow() {
  const win = new BrowserWindow({ width: 1500, height: 920, minWidth: 1000, minHeight: 640, backgroundColor: "#0b1033", title: "NUCLUES", show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://")) e.preventDefault(); });
  // the page blocks unloading while the design has unsaved changes; ask instead of silently refusing to close
  win.webContents.on("will-prevent-unload", (e) => {
    const r = dialog.showMessageBoxSync(win, { type: "warning", buttons: ["Keep editing", "Close without saving"], defaultId: 0, cancelId: 0, title: "NUCLUES",
      message: "The design has unsaved changes.", detail: "Closing now discards changes made since the last save. A recovery copy of the latest design is kept on this computer." });
    if (r === 1) e.preventDefault();
  });
  void win.loadURL("app://nucleus/index.html");
  return win;
}

app.whenReady().then(() => {
  protocol.handle("app", (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "") || "index.html";
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null); // NUCLUES has its own menu bar
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
