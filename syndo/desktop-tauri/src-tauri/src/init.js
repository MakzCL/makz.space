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
    setCaptureExcluded: (excluded) => inv("set_capture_excluded", { excluded: !!excluded }),
    // SEND's own screen sharing: list screens/windows (with thumbnails) and stream one of them.
    // onVideo gets JPEG frames (ArrayBuffer; an empty one means the window closed), onAudio 20 ms of 48 kHz stereo f32.
    capture: Object.freeze({
      sources: (thumbWidth) => inv("capture_sources", { thumbWidth: thumbWidth || 320 }),
      start: async (source, options, onVideo, onAudio) => {
        const chan = (cb) => {
          const id = T.transformCallback((m) => { if (!m || m.end) return; try { cb(m.message, m.index); } catch (_) { /* listener error */ } });
          return { id, arg: "__CHANNEL__:" + id };
        };
        const v = chan(onVideo), a = chan(onAudio || (() => {}));
        try {
          const id = await inv("capture_start", { source: String(source), options: options || {}, video: v.arg, audio: a.arg });
          return {
            id,
            ack: () => inv("capture_ack", { id }).catch(() => {}),
            stop: () => { inv("capture_stop", { id }).catch(() => {}); try { T.unregisterCallback(v.id); T.unregisterCallback(a.id); } catch (_) { /* gone */ } },
          };
        } catch (e) { try { T.unregisterCallback(v.id); T.unregisterCallback(a.id); } catch (_) { /* gone */ } throw e; }
      },
    }),
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
