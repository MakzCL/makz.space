/**
 * SEND desktop shell (Windows first; also runs on macOS/Linux for development).
 *
 * The window loads the hosted SEND web app, so interface updates arrive the
 * moment the web app is deployed. This shell adds what browsers can't do:
 *   - global push-to-talk (works while SEND is in the background),
 *   - screen sharing with whole-system audio on Windows (WASAPI loopback),
 *   - tray icon, close-to-tray, syndo:// invite links, native notifications,
 *   - Windows 11 window materials (Mica / Acrylic) where the OS supports them,
 *   - self-updates from a Cloudflare-hosted feed (electron-updater, generic provider).
 *
 * Security: context isolation + sandbox, no Node in the page, a tiny preload
 * API, navigation locked to the configured SEND origin, permissions granted
 * only to that origin, external links opened in the system browser.
 */
import { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, ipcMain, nativeImage, session, shell, systemPreferences, type DesktopCapturerSource } from "electron";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const APP_ID: string = pkg.syndo?.appId ?? "space.makz.syndo";
const BAKED_URL: string = process.env.SYNDO_APP_URL || pkg.syndo?.appUrl || "";
const STATIC = join(__dirname, "static");
const isWin = process.platform === "win32";
const winBuild = isWin ? Number(release().split(".")[2] ?? 0) : 0;
const MATERIAL_OK = isWin && winBuild >= 22621; // Windows 11 22H2+

/* -------------------------------------------------------------- config -- */
interface Config { serverUrl: string; closeToTray: boolean; material: "none" | "mica" | "acrylic"; startHidden: boolean; hardwareAcceleration: boolean; reduceBackgroundWork: boolean }
const CONFIG_PATH = () => join(app.getPath("userData"), "config.json");
let config: Config = { serverUrl: BAKED_URL, closeToTray: true, material: "none", startHidden: false, hardwareAcceleration: true, reduceBackgroundWork: true };
function loadConfig() {
  try { if (existsSync(CONFIG_PATH())) config = { ...config, ...JSON.parse(readFileSync(CONFIG_PATH(), "utf8")) }; } catch { /* corrupt → defaults */ }
  if (!config.serverUrl) config.serverUrl = BAKED_URL;
}
loadConfig();
const initialHardwareAcceleration = config.hardwareAcceleration !== false;
if (!initialHardwareAcceleration) app.disableHardwareAcceleration();
const saveConfig = () => { try { writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2)); } catch { /* read-only profile */ } };
const appOrigin = () => { try { return new URL(config.serverUrl).origin; } catch { return null; } };

/** Only https (or http on localhost for development) servers are accepted. */
function normalizeServer(input: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return u.origin;
  } catch { return null; }
}

/* -------------------------------------------------------------- window -- */
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let pendingDeepLink: string | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 420, minHeight: 520,
    frame: false,
    title: "SEND", icon: join(STATIC, "icon.png"), show: !config.startHidden,
    backgroundColor: config.material !== "none" && MATERIAL_OK ? "#00000000" : "#0E1220",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: true,
      backgroundThrottling: config.reduceBackgroundWork, // Chromium keeps real-time media active; decorative work can sleep
    },
  });
  if (MATERIAL_OK && config.material !== "none") win.setBackgroundMaterial(config.material);
  win.on("close", (e) => { if (!quitting && config.closeToTray && tray) { e.preventDefault(); win?.hide(); } });
  win.on("focus", () => win?.flashFrame(false));
  loadApp();
}

function loadApp() {
  if (!win) return;
  if (!config.serverUrl) { win.loadFile(join(STATIC, "connect.html")); return; }
  const target = pendingDeepLink ? `${config.serverUrl}${pendingDeepLink}` : `${config.serverUrl}/channels/@me`;
  pendingDeepLink = null;
  win.loadURL(target).catch(() => win?.loadFile(join(STATIC, "connect.html"), { query: { error: "unreachable", server: config.serverUrl } }));
}

/* ------------------------------------------------------- security rules -- */
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (e, url) => {
    const o = appOrigin();
    if (url.startsWith("file://") && contents.getURL().startsWith("file://")) return; // connect page
    try { if (o && new URL(url).origin === o) return; } catch { /* */ }
    e.preventDefault();
    openExternal(url);
  });
  contents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  contents.on("will-attach-webview", (e) => e.preventDefault());
});
function openExternal(url: string) {
  try { const u = new URL(url); if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") shell.openExternal(u.toString()); } catch { /* ignore */ }
}

function setupSession() {
  const s = session.defaultSession;
  const allowed = new Set(["media", "display-capture", "notifications", "fullscreen", "clipboard-sanitized-write", "speaker-selection", "pointerLock"]);
  const fromApp = (origin: string | undefined) => { const o = appOrigin(); try { return !!o && !!origin && new URL(origin).origin === o; } catch { return false; } };
  s.setPermissionRequestHandler((wc, perm, cb, details) => cb(allowed.has(perm) && fromApp(details.requestingUrl ?? wc.getURL())));
  s.setPermissionCheckHandler((_wc, perm, origin) => allowed.has(perm) && fromApp(origin));

  // Screen sharing: our own picker (screens + windows), with whole-system audio on Windows.
  s.setDisplayMediaRequestHandler(async (_req, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
      const choice = await pickSource(sources);
      if (!choice) { callback({}); return; }
      const src = sources.find((x) => x.id === choice.id);
      if (!src) { callback({}); return; }
      callback(choice.audio && isWin ? { video: src, audio: "loopback" } : { video: src });
    } catch { callback({}); }
  }, { useSystemPicker: process.platform === "darwin" });
}

function pickSource(sources: DesktopCapturerSource[]): Promise<{ id: string; audio: boolean } | null> {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: win ?? undefined, modal: true, width: 760, height: 560, resizable: true, title: "Share your screen", icon: join(STATIC, "icon.png"),
      autoHideMenuBar: true, backgroundColor: "#141A2B",
      webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, additionalArguments: ["--syndo-picker"] },
    });
    let done = false;
    const finish = (v: { id: string; audio: boolean } | null) => { if (done) return; done = true; resolve(v); if (!picker.isDestroyed()) picker.close(); };
    ipcMain.removeHandler("picker:sources");
    ipcMain.handle("picker:sources", () => ({
      systemAudio: isWin,
      sources: sources.map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith("screen") ? "screen" : "window", thumb: s.thumbnail.toDataURL(), icon: s.appIcon?.toDataURL() ?? null })),
    }));
    ipcMain.once("picker:choose", (_e, v: { id: string; audio: boolean } | null) => finish(v && typeof v.id === "string" ? { id: v.id, audio: !!v.audio } : null));
    picker.on("closed", () => finish(null));
    picker.loadFile(join(STATIC, "picker.html"));
  });
}

/* ------------------------------------------------- global push-to-talk -- */
// uiohook-napi is optional: if it isn't available on this platform, the web app falls back to window-focused PTT.
let hook: any = null;
try { hook = require("uiohook-napi"); } catch { hook = null; }
let pttKey: { kind: "key"; code: number } | { kind: "mouse"; button: number } | null = null;
let pttDown = false;
const sendPtt = (down: boolean) => { if (down !== pttDown) { pttDown = down; win?.webContents.send("ptt", down); } };
function domCodeToHook(code: string): { kind: "key"; code: number } | { kind: "mouse"; button: number } | null {
  if (!hook) return null;
  const K = hook.UiohookKey as Record<string, number>;
  if (code === "Mouse4") return { kind: "mouse", button: 4 };
  if (code === "Mouse5") return { kind: "mouse", button: 5 };
  let m: RegExpMatchArray | null;
  if ((m = code.match(/^Key([A-Z])$/))) return K[m[1]!] !== undefined ? { kind: "key", code: K[m[1]!]! } : null;
  if ((m = code.match(/^Digit(\d)$/))) return K[m[1]!] !== undefined ? { kind: "key", code: K[m[1]!]! } : null;
  if ((m = code.match(/^F(\d{1,2})$/))) return K[`F${m[1]}`] !== undefined ? { kind: "key", code: K[`F${m[1]}`]! } : null;
  const named: Record<string, string> = {
    Space: "Space", Backquote: "Backquote", CapsLock: "CapsLock", Tab: "Tab", ControlLeft: "Ctrl", ControlRight: "CtrlRight",
    ShiftLeft: "Shift", ShiftRight: "ShiftRight", AltLeft: "Alt", AltRight: "AltRight", Insert: "Insert", Home: "Home", End: "End",
    PageUp: "PageUp", PageDown: "PageDown", Pause: "Pause", ScrollLock: "ScrollLock", NumpadEnter: "NumpadEnter",
  };
  const n = named[code];
  return n && K[n] !== undefined ? { kind: "key", code: K[n]! } : null;
}
function startHook() {
  if (!hook || startHook.started) return;
  startHook.started = true;
  const { uIOhook } = hook;
  uIOhook.on("keydown", (e: { keycode: number }) => { if (pttKey?.kind === "key" && e.keycode === pttKey.code) sendPtt(true); });
  uIOhook.on("keyup", (e: { keycode: number }) => { if (pttKey?.kind === "key" && e.keycode === pttKey.code) sendPtt(false); });
  uIOhook.on("mousedown", (e: { button: number }) => { if (pttKey?.kind === "mouse" && e.button === pttKey.button) sendPtt(true); });
  uIOhook.on("mouseup", (e: { button: number }) => { if (pttKey?.kind === "mouse" && e.button === pttKey.button) sendPtt(false); });
  try { uIOhook.start(); } catch { hook = null; }
}
startHook.started = false;

/* -------------------------------------------------------------- updates -- */
type UpdateStatus = { state: "idle" | "checking" | "available" | "downloading" | "ready" | "none" | "error" | "disabled"; version?: string; percent?: number; message?: string };
let updateStatus: UpdateStatus = { state: "idle" };
let autoUpdater: any = null;
/** Set when the user pressed "update": install as soon as the download finishes. */
let installWhenReady = false;
function installUpdate() { quitting = true; autoUpdater?.quitAndInstall(false, true); }
/** The user asked for the update: download it (if needed), then restart into it. */
async function downloadAndInstall() {
  if (!autoUpdater) return updateStatus;
  if (updateStatus.state === "ready") { installUpdate(); return updateStatus; }
  if (updateStatus.state !== "available" && updateStatus.state !== "error") return updateStatus;
  installWhenReady = true;
  setUpdate({ state: "downloading", percent: 0, version: updateStatus.version });
  await autoUpdater.downloadUpdate().catch((e: Error) => { installWhenReady = false; setUpdate({ state: "error", version: updateStatus.version, message: String(e?.message ?? e).slice(0, 200) }); });
  return updateStatus;
}
function setUpdate(s: UpdateStatus) { updateStatus = s; win?.webContents.send("update-status", s); buildTrayMenu(); }
function setupUpdates() {
  if (!app.isPackaged) { setUpdate({ state: "disabled", message: "Updates are checked in installed builds only." }); return; }
  if (!existsSync(join(process.resourcesPath, "app-update.yml"))) { setUpdate({ state: "disabled", message: "This build has no update feed configured." }); return; }
  try { autoUpdater = require("electron-updater").autoUpdater; } catch { setUpdate({ state: "disabled" }); return; }
  // Never update on our own: an update is downloaded and installed only when the user presses the
  // green download button (title bar, settings or tray).
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => setUpdate({ state: "checking" }));
  autoUpdater.on("update-available", (i: any) => setUpdate({ state: "available", version: i.version }));
  autoUpdater.on("update-not-available", () => setUpdate({ state: "none" }));
  autoUpdater.on("download-progress", (p: any) => setUpdate({ state: "downloading", percent: Math.round(p.percent), version: updateStatus.version }));
  autoUpdater.on("update-downloaded", (i: any) => { setUpdate({ state: "ready", version: i.version }); if (installWhenReady) installUpdate(); });
  autoUpdater.on("error", (e: Error) => { installWhenReady = false; setUpdate({ state: "error", version: updateStatus.version, message: String(e?.message ?? e).slice(0, 200) }); });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8_000);
  setInterval(check, 4 * 3600_000).unref();
}

/* ----------------------------------------------------------------- tray -- */
function buildTrayMenu() {
  if (!tray) return;
  const u = updateStatus;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open SEND", click: () => { win?.show(); win?.focus(); } },
    { type: "separator" },
    u.state === "ready" ? { label: `Restart to update (${u.version})`, click: () => installUpdate() }
      : u.state === "available" ? { label: `Download and install update (${u.version})`, click: () => { downloadAndInstall(); } }
      : { label: u.state === "downloading" ? `Downloading update… ${u.percent ?? 0}%` : "Check for updates", enabled: !!autoUpdater && u.state !== "downloading", click: () => autoUpdater?.checkForUpdates().catch(() => {}) },
    { label: "Change server…", click: () => changeServer() },
    { label: "Close to tray", type: "checkbox", checked: config.closeToTray, click: (m) => { config.closeToTray = m.checked; saveConfig(); } },
    { type: "separator" },
    { label: "Quit SEND", click: () => { quitting = true; app.quit(); } },
  ]));
}
function changeServer() {
  config.serverUrl = ""; saveConfig();
  win?.show(); loadApp();
}

/* ------------------------------------------------------------ IPC API -- */
function registerIpc() {
  ipcMain.on("desktop:info", (e) => {
    e.returnValue = {
      version: app.getVersion(), platform: process.platform, osBuild: winBuild,
      capabilities: { customTitlebar: true, globalPtt: !!hook, systemAudio: isWin, windowMaterial: MATERIAL_OK, autoUpdate: app.isPackaged, tray: true },
    };
  });
  ipcMain.handle("desktop:window", (e, action: unknown) => {
    if (e.sender !== win?.webContents || !win) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.close();
    return { maximized: win.isMaximized() };
  });
  ipcMain.handle("desktop:set-ptt", (_e, code: unknown) => {
    if (code === null) { pttKey = null; sendPtt(false); return { ok: true }; }
    if (typeof code !== "string" || code.length > 32) return { ok: false, reason: "Invalid key." };
    if (!hook) return { ok: false, reason: "Global push-to-talk isn't available on this system." };
    const k = domCodeToHook(code);
    if (!k) return { ok: false, reason: `${code} can't be used as a global key. Try a letter, F-key, mouse button 4/5 or a modifier.` };
    pttKey = k; startHook();
    return { ok: !!hook };
  });
  ipcMain.handle("desktop:set-material", (_e, m: unknown) => {
    if (!MATERIAL_OK || (m !== "none" && m !== "mica" && m !== "acrylic")) return { ok: false };
    config.material = m; saveConfig();
    win?.setBackgroundMaterial(m);
    return { ok: true };
  });
  ipcMain.handle("desktop:settings", () => ({ ...config, launchOnStartup: isWin ? app.getLoginItemSettings().openAtLogin : false, restartRequired: config.hardwareAcceleration !== initialHardwareAcceleration }));
  ipcMain.handle("desktop:set-performance", (e, input: unknown) => {
    if (e.sender !== win?.webContents || !input || typeof input !== "object") return { ok: false };
    const p = input as Record<string, unknown>;
    if (Object.keys(p).some(k => !["hardwareAcceleration", "reduceBackgroundWork"].includes(k)) || Object.values(p).some(v => typeof v !== "boolean")) return { ok: false };
    if (typeof p.hardwareAcceleration === "boolean") config.hardwareAcceleration = p.hardwareAcceleration;
    if (typeof p.reduceBackgroundWork === "boolean") { config.reduceBackgroundWork = p.reduceBackgroundWork; win.webContents.setBackgroundThrottling(config.reduceBackgroundWork); }
    saveConfig();
    return { ok: true, restartRequired: config.hardwareAcceleration !== initialHardwareAcceleration };
  });
  ipcMain.handle("desktop:set-startup", (e, enabled: unknown) => {
    if (!isWin || e.sender !== win?.webContents || typeof enabled !== "boolean") return { ok: false };
    app.setLoginItemSettings({ openAtLogin: enabled });
    return { ok: true };
  });
  ipcMain.handle("desktop:restart", e => { if (e.sender === win?.webContents) { quitting = true; app.relaunch(); app.quit(); } });
  ipcMain.handle("desktop:refresh", e => { if (e.sender === win?.webContents) win.webContents.reloadIgnoringCache(); });
  ipcMain.handle("desktop:set-close-to-tray", (_e, v: unknown) => { config.closeToTray = v === true; saveConfig(); buildTrayMenu(); return { ok: true }; });
  ipcMain.handle("desktop:update-status", () => updateStatus);
  ipcMain.handle("desktop:check-updates", async () => { if (!autoUpdater) return updateStatus; await autoUpdater.checkForUpdates().catch(() => {}); return updateStatus; });
  ipcMain.handle("desktop:restart-to-update", () => { if (updateStatus.state === "ready") installUpdate(); });
  ipcMain.handle("desktop:download-update", () => downloadAndInstall());
  ipcMain.handle("desktop:flash", () => { if (win && !win.isFocused()) win.flashFrame(true); });
  ipcMain.handle("desktop:change-server", () => changeServer());
  // First-run chooser (local page): validate and save the server address.
  ipcMain.handle("connect:set-server", async (_e, input: unknown) => {
    const url = typeof input === "string" ? normalizeServer(input.trim()) : null;
    if (!url) return { ok: false, reason: "Enter an https:// address, for example https://chat.example.com" };
    try {
      const r = await fetch(`${url}/api/instance`, { signal: AbortSignal.timeout(8000) });
      const j = r.ok ? await r.json() : null;
      if (!j?.name) return { ok: false, reason: "That address didn't answer like a SEND server." };
    } catch { return { ok: false, reason: "Couldn't reach that server. Check the address and your connection." }; }
    config.serverUrl = url; saveConfig(); loadApp();
    return { ok: true };
  });
  ipcMain.handle("connect:info", () => ({ baked: BAKED_URL, current: config.serverUrl }));
}

/* ------------------------------------------------------------ lifecycle -- */
function handleDeepLink(argv: string[]) {
  const link = argv.find((a) => a.startsWith("syndo://"));
  if (!link) return;
  try {
    const u = new URL(link);
    const m = `${u.host}${u.pathname}`.match(/^invite\/([A-Za-z0-9-]{3,32})$/);
    if (m) { pendingDeepLink = `/invite/${m[1]}`; if (win && config.serverUrl) loadApp(); }
  } catch { /* ignore malformed links */ }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_e, argv) => { handleDeepLink(argv); if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.setAppUserModelId(APP_ID); // native Windows toasts for web notifications
  app.setAsDefaultProtocolClient("syndo");
  app.whenReady().then(() => {
    handleDeepLink(process.argv);
    registerIpc();
    setupSession();
    createWindow();
    tray = new Tray(nativeImage.createFromPath(join(STATIC, "tray.png")));
    tray.setToolTip("SEND");
    tray.on("click", () => { win?.show(); win?.focus(); });
    buildTrayMenu();
    setupUpdates();
    if (process.platform === "darwin") systemPreferences.askForMediaAccess("microphone").catch(() => {});
  });
  app.on("before-quit", () => { quitting = true; try { hook?.uIOhook?.stop(); } catch { /* */ } });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("activate", () => { if (!win) createWindow(); else win.show(); });
}
void dialog;
