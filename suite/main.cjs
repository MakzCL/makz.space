// SK Suite: one desktop home for the apps. The hub window lists the apps; each app opens in its own window
// (one per app, remembered size and position). Web apps load their live sites in a shared, persistent session,
// so a sign-in survives restarts. NUCLEUS is bundled and runs offline from a private app:// scheme.
const { app, BrowserWindow, protocol, net, shell, ipcMain, session, desktopCapturer, Menu, dialog, nativeTheme } = require("electron");
const path = require("node:path"); const fs = require("node:fs"); const crypto = require("node:crypto"); const { pathToFileURL } = require("node:url");
const BOOT = global.__suite ?? { root: __dirname, version: JSON.parse(fs.readFileSync(path.join(__dirname, "version.json"), "utf8")).version, updated: false, stateFile: null };
const VERSION = BOOT.version;
// One-click updates: the suite's own code and NUCLEUS come from this fixed HTTPS address; every file is checked
// against the SHA-256 in the manifest before it is used. The Electron runtime itself is not updated this way.
const UPDATE_BASE = process.env.SK_SUITE_UPDATE_BASE || "https://sk-suite.pages.dev/update/";

const APPS = JSON.parse(fs.readFileSync(path.join(__dirname, "apps.json"), "utf8"));
const PARTITION = "persist:sk-suite";
const NUCLEUS_ROOT = path.join(__dirname, "bundled", "nucleus");
const HUB_ROOT = path.join(__dirname, "hub");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- persisted state: palette, window bounds, last opened ----------
const stateFile = () => path.join(app.getPath("userData"), "suite-state.json");
let state = { palette: "granat", bounds: {}, lastOpened: {} };
const loadState = () => { try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile(), "utf8")) }; } catch { /* first run */ } };
let saveT = null; const saveState = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2)); } catch { /* read-only profile */ } }, 300); };
const BG = { light: "#f3f4fa", granat: "#0b1033", dark: "#060920" };

let hub = null; const wins = new Map(); // app id -> BrowserWindow
const appForUrl = (u) => { try { const h = new URL(u).hostname; return APPS.find((a) => a.hosts.includes(h)) ?? null; } catch { return null; } };
const allowedInApp = (a, u) => { try { const x = new URL(u); return a.offline ? x.protocol === "app:" : x.protocol === "https:" && (a.hosts.includes(x.hostname) || x.hostname.endsWith(".supabase.co")); } catch { return false; } };
const broadcast = () => hub && !hub.isDestroyed() && hub.webContents.send("suite:state", publicState());
const publicState = () => ({ palette: state.palette, running: [...wins.keys()], lastOpened: state.lastOpened, update: upd });

// ---------- updates ----------
let relaunchOnQuit = false; // set by an update; cleared if someone keeps working instead of closing
app.on("will-quit", () => { if (relaunchOnQuit) app.relaunch(); });
let upd = { status: "idle", version: null, notes: "", progress: 0, error: null, checkedAt: null };
const setUpd = (p) => { upd = { ...upd, ...p }; broadcast(); };
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
let manifest = null;
async function checkUpdate() {
  if (upd.status === "downloading") return upd;
  setUpd({ status: "checking", error: null });
  try {
    const r = await net.fetch(`${UPDATE_BASE}latest.json`, { cache: "no-store" }); if (!r.ok) throw new Error(`Update server answered ${r.status}`);
    const m = await r.json();
    if (!m || typeof m.version !== "string" || !Array.isArray(m.files) || !m.files.length) throw new Error("The update information is not valid");
    manifest = m;
    if (!newer(m.version, VERSION)) return setUpd({ status: "current", version: m.version, notes: m.notes ?? "", checkedAt: Date.now() }), upd;
    if (m.minRuntime && newer(m.minRuntime, process.versions.electron)) return setUpd({ status: "full", version: m.version, notes: m.notes ?? "", checkedAt: Date.now() }), upd;
    setUpd({ status: "available", version: m.version, notes: m.notes ?? "", checkedAt: Date.now() });
  } catch (e) { setUpd({ status: "error", error: navigatorish(e), checkedAt: Date.now() }); }
  return upd;
}
const navigatorish = (e) => (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to fetch/i.test(String(e?.message)) ? "No internet connection" : String(e?.message ?? e));
async function installUpdate() {
  if (upd.status !== "available" || !manifest) await checkUpdate();
  if (upd.status !== "available" || !manifest) return upd;
  const m = manifest; const base = path.join(app.getPath("userData"), "updates"); const part = path.join(base, `${m.version}.part`), dest = path.join(base, m.version);
  setUpd({ status: "downloading", progress: 0, error: null });
  try {
    fs.rmSync(part, { recursive: true, force: true }); fs.mkdirSync(part, { recursive: true });
    const total = m.files.reduce((a, f) => a + (f.size || 0), 0) || 1; let got = 0;
    for (const f of m.files) {
      if (typeof f.path !== "string" || f.path.includes("..") || path.isAbsolute(f.path) || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error("The update file list is not valid");
      const r = await net.fetch(`${UPDATE_BASE}${m.version}/${f.path.split("/").map(encodeURIComponent).join("/")}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Download failed (${r.status}): ${f.path}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (crypto.createHash("sha256").update(buf).digest("hex") !== f.sha256) throw new Error(`Checksum mismatch: ${f.path}`);
      const out = path.join(part, f.path); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf);
      got += buf.length; setUpd({ progress: Math.min(0.99, got / total) });
    }
    if (!fs.existsSync(path.join(part, "main.cjs"))) throw new Error("The update is incomplete");
    fs.rmSync(dest, { recursive: true, force: true }); fs.renameSync(part, dest);
    fs.writeFileSync(path.join(base, "current.json"), JSON.stringify({ version: m.version, dir: dest, installedAt: new Date().toISOString(), pending: false }));
    for (const d of fs.readdirSync(base)) if (d !== m.version && d !== "current.json" && d !== VERSION) fs.rmSync(path.join(base, d), { recursive: true, force: true });
    setUpd({ status: "ready", progress: 1 });
    // restart into the new version; windows with unsaved work still ask first (quitting is cancelled if you keep working)
    if (!process.env.SK_SUITE_NO_RELAUNCH) { relaunchOnQuit = true; app.quit(); }
  } catch (e) { fs.rmSync(part, { recursive: true, force: true }); setUpd({ status: "error", error: navigatorish(e) }); }
  return upd;
}
function markHealthy() {
  if (!BOOT.updated || !BOOT.stateFile) return;
  try { const c = JSON.parse(fs.readFileSync(BOOT.stateFile, "utf8")); if (c.pending) fs.writeFileSync(BOOT.stateFile, JSON.stringify({ ...c, pending: false })); } catch { /* ignore */ }
}

function track(win, key) {
  const b = state.bounds[key]; if (b) win.setBounds(b);
  const keep = () => { if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) { state.bounds[key] = win.getBounds(); saveState(); } };
  win.on("resize", keep); win.on("move", keep);
}

function guard(win, a) {
  const wc = win.webContents;
  // links inside an app: same app stays; another suite app opens that app's window; anything else goes to the browser
  const route = (url) => { const other = appForUrl(url); if (other && other.id !== a.id) { openApp(other.id, url); return true; } if (!allowedInApp(a, url)) { if (/^https?:|^mailto:/.test(url)) void shell.openExternal(url); return true; } return false; };
  wc.setWindowOpenHandler(({ url }) => { if (!route(url) && allowedInApp(a, url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: BG[state.palette] } }; return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => { if (url !== wc.getURL() && !allowedInApp(a, url)) { e.preventDefault(); route(url); } });
  wc.on("will-prevent-unload", (e) => {
    const r = dialog.showMessageBoxSync(win, { type: "warning", buttons: ["Keep working", "Close anyway"], defaultId: 0, cancelId: 0, title: a.name, message: `${a.name} has unsaved changes.`, detail: "Closing now may discard them." });
    if (r === 1) e.preventDefault(); else if (relaunchOnQuit) { relaunchOnQuit = false; setUpd({ status: "ready-restart" }); }
  });
  wc.on("did-fail-load", (_e, code, desc, url, isMain) => { if (!isMain || code === -3) return; void win.loadURL(`app://hub/offline.html?app=${encodeURIComponent(a.id)}&url=${encodeURIComponent(url)}&err=${encodeURIComponent(desc)}`); });
}

function openApp(id, url) {
  const a = APPS.find((x) => x.id === id); if (!a) return false;
  const open = wins.get(id);
  if (open && !open.isDestroyed()) { if (url && url !== open.webContents.getURL()) void open.loadURL(url); if (open.isMinimized()) open.restore(); open.show(); open.focus(); return true; }
  const win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: a.name, show: false, autoHideMenuBar: true, backgroundColor: BG[state.palette],
    icon: path.join(HUB_ROOT, "icons", "suite.png"),
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true } });
  wins.set(id, win); track(win, id); guard(win, a);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => { wins.delete(id); broadcast(); });
  void win.loadURL(url && allowedInApp(a, url) ? url : a.url);
  state.lastOpened[id] = new Date().toISOString(); saveState(); broadcast();
  return true;
}

function createHub() {
  hub = new BrowserWindow({ width: 1180, height: 760, minWidth: 820, minHeight: 560, title: "SK Suite", show: false, autoHideMenuBar: true, backgroundColor: BG[state.palette],
    icon: path.join(HUB_ROOT, "icons", "suite.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  track(hub, "hub");
  hub.once("ready-to-show", () => hub.show());
  hub.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  hub.webContents.on("will-navigate", (e) => e.preventDefault());
  hub.on("closed", () => { hub = null; });
  void hub.loadURL("app://hub/index.html");
}

function serve(root) {
  return (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "") || "index.html";
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root + path.sep) && file !== root) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  };
}

app.whenReady().then(() => {
  loadState(); nativeTheme.themeSource = state.palette === "light" ? "light" : "dark";
  const hubFiles = serve(HUB_ROOT), nucFiles = serve(NUCLEUS_ROOT);
  const handler = (req) => (new URL(req.url).host === "nucleus" ? nucFiles(req) : hubFiles(req));
  protocol.handle("app", handler);
  const ses = session.fromPartition(PARTITION);
  ses.protocol.handle("app", handler);
  // Kortana / Factory calls need camera, microphone, notifications and screen sharing; only for suite apps
  const trusted = (u) => { try { const x = new URL(u); return x.protocol === "app:" || APPS.some((a) => a.hosts.includes(x.hostname)); } catch { return false; } };
  const OK = new Set(["media", "notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen", "display-capture", "mediaKeySystem", "speaker-selection"]);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(OK.has(perm) && trusted(wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => OK.has(perm) && trusted(origin || wc?.getURL() || ""));
  ses.setDisplayMediaRequestHandler((req, cb) => {
    if (!trusted(req.frame?.url ?? "")) return cb({});
    void desktopCapturer.getSources({ types: ["screen", "window"] }).then((src) => {
      if (!src.length) return cb({});
      const names = src.slice(0, 12).map((s) => s.name);
      const parent = BrowserWindow.getFocusedWindow() ?? undefined;
      const i = dialog.showMessageBoxSync(parent, { type: "question", title: "Share your screen", message: "Choose what to share", buttons: [...names, "Cancel"], cancelId: names.length });
      cb(i < names.length ? { video: src[i] } : {});
    });
  });

  ipcMain.handle("suite:apps", () => APPS.map(({ hosts, ...a }) => a));
  ipcMain.handle("suite:state", () => publicState());
  ipcMain.handle("suite:open", (_e, id) => openApp(String(id)));
  ipcMain.handle("suite:openInBrowser", (_e, id) => { const a = APPS.find((x) => x.id === id); if (a && !a.offline) void shell.openExternal(a.url); return !!a; });
  ipcMain.handle("suite:palette", (_e, p) => { if (["light", "granat", "dark"].includes(p)) { state.palette = p; nativeTheme.themeSource = p === "light" ? "light" : "dark"; saveState(); broadcast(); } return state.palette; });
  ipcMain.handle("suite:version", () => ({ suite: VERSION, shipped: BOOT.shipped ?? VERSION, updated: BOOT.updated, electron: process.versions.electron, chrome: process.versions.chrome }));
  ipcMain.handle("suite:healthy", () => { markHealthy(); return true; });
  ipcMain.handle("suite:checkUpdate", () => checkUpdate());
  ipcMain.handle("suite:restart", () => { relaunchOnQuit = true; app.quit(); return true; });
  ipcMain.handle("suite:installUpdate", () => installUpdate());
  // sign this computer out of every web app in the suite (their shared session), and close their windows
  ipcMain.handle("suite:signOutHere", async () => {
    for (const [id, w] of wins) if (APPS.find((a) => a.id === id && !a.offline)) w.destroy();
    await session.fromPartition(PARTITION).clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] });
    broadcast(); return true;
  });

  Menu.setApplicationMenu(null);
  createHub();
  setTimeout(() => void checkUpdate(), 5000); setInterval(() => void checkUpdate(), 6 * 3600e3); // quiet background checks
  app.on("activate", () => { if (!hub) createHub(); });
});
app.on("second-instance", () => { if (!hub) createHub(); else { if (hub.isMinimized()) hub.restore(); hub.focus(); } });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
module.exports = { APPS };
