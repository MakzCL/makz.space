// Injected into every page of the main window before the page's own scripts.
// Gives the SEND web app the same `window.sendDesktop` API the Electron shell had,
// backed by this shell's Rust commands. `__SEND_INFO__` is replaced at startup.
(() => {
  if (window.sendDesktop || window.sendLocal) return;
  const T = window.__TAURI_INTERNALS__;
  if (!T || typeof T.invoke !== "function") return;
  const inv = (cmd, args) => T.invoke(cmd, args || {});
  const subs = Object.create(null);
  Object.defineProperty(window, "__sendEmit", {
    value: (ch, v) => { for (const f of (subs[ch] || []).slice()) { try { f(v); } catch (_) { /* listener error */ } } },
    writable: false, configurable: false,
  });
  const on = (ch, cb) => { (subs[ch] = subs[ch] || []).push(cb); return () => { subs[ch] = (subs[ch] || []).filter((f) => f !== cb); }; };
  const info = __SEND_INFO__;
  const local = location.hostname === "tauri.localhost" || location.protocol === "tauri:";

  if (local) {
    window.sendLocal = Object.freeze({
      windowControl: (action) => inv("window_control", { action }),
      setServer: (url) => inv("connect_set_server", { input: String(url) }),
      connectInfo: () => inv("connect_info"),
    });
    return;
  }

  window.sendDesktop = Object.freeze({
    version: String(info.version),
    platform: String(info.platform),
    shell: "tauri",
    capabilities: Object.freeze({ ...info.capabilities }),
    setPushToTalk: (code) => inv("set_ptt", { code: code == null ? null : String(code) }),
    onPushToTalk: (cb) => on("ptt", (v) => cb(!!v)),
    setWindowMaterial: (material) => inv("set_material", { material }),
    windowControl: (action) => inv("window_control", { action }),
    setPerformance: (value) => inv("set_performance", { value }),
    setLaunchOnStartup: (enabled) => inv("set_startup", { enabled: !!enabled }),
    restart: () => inv("restart_app"),
    refreshInterface: () => inv("refresh"),
    getSettings: () => inv("get_settings"),
    setCloseToTray: (value) => inv("set_close_to_tray", { value: !!value }),
    changeServer: () => inv("change_server"),
    getUpdateStatus: () => inv("update_status"),
    checkForUpdates: () => inv("check_updates"),
    restartToUpdate: () => inv("restart_to_update"),
    downloadUpdate: () => inv("download_update"),
    onUpdateStatus: (cb) => on("update-status", cb),
    onActivity: (cb) => on("activity", cb),
    flash: () => inv("flash"),
  });

  // Web notifications → native Windows toasts (WebView2's own notification support varies by runtime).
  class SENDNotification {
    constructor(title, opts) {
      const o = opts || {};
      this.title = String(title); this.body = String(o.body || ""); this.tag = o.tag || "";
      this.onclick = null; this.onclose = null; this.onerror = null; this.onshow = null;
      inv("notify", { title: this.title.slice(0, 200), body: this.body.slice(0, 400) }).catch(() => {});
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    static get permission() { return "granted"; }
    static requestPermission(cb) { if (typeof cb === "function") cb("granted"); return Promise.resolve("granted"); }
  }
  try { Object.defineProperty(window, "Notification", { value: SENDNotification, configurable: true, writable: true }); } catch (_) { /* keep the built-in */ }
})();
