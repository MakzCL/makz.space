//! SEND desktop shell, lightweight edition (Tauri + the WebView2 that ships with Windows).
//!
//! Same job as the Electron shell, without bundling a browser: the window loads the hosted SEND
//! web app (so interface updates arrive with web deploys) and the shell adds what a browser
//! can't do — global push-to-talk, tray and close-to-tray, send:// invite links, native toasts,
//! Windows 11 Mica/Acrylic, launch on startup and manual updates from the R2 feed.
//!
//! Security: the page has no Node or file access, only the commands below; the hosted origin
//! (or the server the user picked) is the only remote origin allowed to call them; navigation
//! is locked to that origin and everything else opens in the system browser; camera, mic and
//! notification permission is granted only to that origin.

mod games;
mod ptt;
mod updater;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, Runtime, Url, UserAttentionType, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;

const BAKED_URL: &str = match option_env!("SEND_APP_URL") { Some(u) => u, None => "https://syndo.makz.space" };
const INIT_JS: &str = include_str!("init.js");

/* -------------------------------------------------------------- config -- */
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Config { server_url: String, close_to_tray: bool, material: String, start_hidden: bool, hardware_acceleration: bool, reduce_background_work: bool }
impl Default for Config {
  fn default() -> Self { Config { server_url: BAKED_URL.into(), close_to_tray: true, material: "none".into(), start_hidden: false, hardware_acceleration: true, reduce_background_work: true } }
}

struct Shell {
  config: Mutex<Config>,
  config_path: PathBuf,
  initial_hw: bool,
  quitting: AtomicBool,
  update: Mutex<updater::Status>,
  feed: Mutex<Option<updater::Feed>>,
  installer: Mutex<Option<PathBuf>>,
  install_when_ready: AtomicBool,
  pending_link: Mutex<Option<String>>,
}
impl Shell {
  fn cfg(&self) -> Config { self.config.lock().unwrap().clone() }
  fn save(&self) {
    let c = self.cfg();
    if let Some(dir) = self.config_path.parent() { let _ = std::fs::create_dir_all(dir); }
    let _ = std::fs::write(&self.config_path, serde_json::to_vec_pretty(&c).unwrap_or_default());
  }
}
fn shell<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, Shell> { app.state::<Shell>() }

fn origin_of(url: &str) -> Option<String> { Url::parse(url).ok().map(|u| u.origin().ascii_serialization()).filter(|o| o != "null") }

/// Only https (or http on localhost for development) servers are accepted.
fn normalize_server(input: &str) -> Option<String> {
  let s = input.trim();
  let with_scheme = if s.to_ascii_lowercase().starts_with("http://") || s.to_ascii_lowercase().starts_with("https://") { s.to_string() } else { format!("https://{s}") };
  let u = Url::parse(&with_scheme).ok()?;
  let local = matches!(u.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"));
  if u.scheme() != "https" && !(u.scheme() == "http" && local) { return None; }
  origin_of(u.as_str())
}

fn is_local_page(u: &Url) -> bool { u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost") }

fn open_external(url: &Url) {
  if !matches!(url.scheme(), "https" | "http" | "mailto") { return; }
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url.as_str()]).creation_flags(0x0800_0000).spawn();
  }
  #[cfg(not(windows))]
  { let _ = std::process::Command::new("xdg-open").arg(url.as_str()).spawn(); }
}

/* --------------------------------------------------------- windows info -- */
#[cfg(windows)]
fn windows_build() -> u32 {
  use windows::core::w;
  use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
  let mut buf = [0u16; 32];
  let mut len = (buf.len() * 2) as u32;
  let ok = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"), w!("CurrentBuildNumber"), RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut len)) };
  if ok.is_err() { return 0; }
  String::from_utf16_lossy(&buf[..(len as usize / 2).saturating_sub(1)]).trim().parse().unwrap_or(0)
}
#[cfg(not(windows))]
fn windows_build() -> u32 { 0 }
fn material_ok() -> bool { cfg!(windows) && windows_build() >= 22621 }

fn apply_material<R: Runtime>(win: &WebviewWindow<R>, m: &str) {
  #[cfg(windows)]
  {
    let _ = window_vibrancy::clear_mica(win);
    let _ = window_vibrancy::clear_acrylic(win);
    match m {
      "mica" => { let _ = window_vibrancy::apply_mica(win, Some(true)); }
      "acrylic" => { let _ = window_vibrancy::apply_acrylic(win, Some((14, 18, 32, 140))); }
      _ => {}
    }
  }
  #[cfg(not(windows))]
  { let _ = (win, m); }
}

/* ----------------------------------------------------------- the page -- */
fn emit<R: Runtime>(app: &AppHandle<R>, channel: &str, value: &Value) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.eval(format!("window.__sendEmit&&window.__sendEmit({},{})", json!(channel), value));
  }
}

fn start_url(c: &Config, link: Option<String>) -> WebviewUrl {
  match Url::parse(&c.server_url) {
    Ok(base) if !c.server_url.is_empty() => {
      let path = link.unwrap_or_else(|| "/channels/@me".into());
      base.join(&path).map(WebviewUrl::External).unwrap_or(WebviewUrl::App("connect.html".into()))
    }
    _ => WebviewUrl::App("connect.html".into()),
  }
}

/// Let a server chosen at runtime call the shell's commands (the hosted one is in capabilities/).
fn allow_origin<R: Runtime>(app: &AppHandle<R>, origin: &str) {
  if origin == "https://syndo.makz.space" { return; }
  let mut cap = tauri::ipc::CapabilityBuilder::new(format!("server-{}", origin.replace(|c: char| !c.is_ascii_alphanumeric(), "-")))
    .remote(format!("{origin}/*"))
    .window("main")
    .permission("core:app:default");
  // The shell's own commands (window buttons, push-to-talk, updates…) — the same set as capabilities/send-remote.json.
  for p in REMOTE_COMMANDS { cap = cap.permission(*p); }
  let _ = app.add_capability(cap);
}

const REMOTE_COMMANDS: &[&str] = &[
  "allow-window-control", "allow-set-ptt", "allow-set-material", "allow-get-settings", "allow-set-performance", "allow-set-startup",
  "allow-restart-app", "allow-refresh", "allow-set-close-to-tray", "allow-change-server", "allow-update-status", "allow-check-updates",
  "allow-download-update", "allow-restart-to-update", "allow-flash", "allow-notify", "allow-set-capture-excluded",
];

fn load_app<R: Runtime>(app: &AppHandle<R>) {
  let st = shell(app);
  let c = st.cfg();
  let link = st.pending_link.lock().unwrap().take();
  if let Some(o) = origin_of(&c.server_url) { allow_origin(app, &o); }
  let Some(win) = app.get_webview_window("main") else { return };
  match start_url(&c, link) {
    WebviewUrl::External(u) => { let _ = win.navigate(u); }
    _ => {
      let local = if cfg!(windows) { "http://tauri.localhost/connect.html" } else { "tauri://localhost/connect.html" };
      if let Ok(u) = Url::parse(local) { let _ = win.navigate(u); }
    }
  }
}

fn create_main<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
  let st = shell(app);
  let c = st.cfg();
  let info = json!({
    "version": app.package_info().version.to_string(),
    "platform": if cfg!(windows) { "win32" } else { std::env::consts::OS },
    "osBuild": windows_build(),
    "capabilities": { "customTitlebar": true, "gameDetection": cfg!(windows), "globalPtt": ptt::available(), "systemAudio": cfg!(windows), "windowMaterial": material_ok(), "autoUpdate": !cfg!(debug_assertions), "tray": true, "captureExclusion": cfg!(windows) },
  });
  let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required");
  if !c.hardware_acceleration { args.push_str(" --disable-gpu"); }
  let link = st.pending_link.lock().unwrap().take();
  if let Some(o) = origin_of(&c.server_url) { allow_origin(app, &o); }
  let transparent = material_ok() && c.material != "none";

  let nav_app = app.clone();
  let perm_app = app.clone();
  let win = WebviewWindowBuilder::new(app, "main", start_url(&c, link))
    .title("SEND")
    .inner_size(1280.0, 820.0)
    .min_inner_size(940.0, 560.0)
    .decorations(false)
    .transparent(transparent)
    .visible(!c.start_hidden)
    .background_color(tauri::window::Color(14, 18, 32, if transparent { 0 } else { 255 }))
    .initialization_script(INIT_JS.replace("__SEND_INFO__", &info.to_string()))
    .additional_browser_args(&args)
    .on_navigation(move |url| {
      if is_local_page(url) || url.scheme() == "about" || url.scheme() == "data" { return true; }
      let o = origin_of(&shell(&nav_app).cfg().server_url);
      if o.is_some() && o == Some(url.origin().ascii_serialization()) { return true; }
      open_external(url);
      false
    })
    .on_new_window(|url, _features| { open_external(&url); NewWindowResponse::Deny })
    .on_permission_request(move |webview, kind| {
      let o = origin_of(&shell(&perm_app).cfg().server_url);
      let from_app = webview.url().ok().map(|u| u.origin().ascii_serialization()) == o && o.is_some();
      match kind {
        PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::Notifications | PermissionKind::ClipboardRead | PermissionKind::Autoplay if from_app => PermissionResponse::Allow,
        _ => PermissionResponse::Default,
      }
    })
    .build()?;
  if transparent { apply_material(&win, &c.material); }

  let close_app = app.clone();
  win.on_window_event(move |e| {
    if let WindowEvent::CloseRequested { api, .. } = e {
      let st = shell(&close_app);
      if !st.quitting.load(Ordering::SeqCst) && st.cfg().close_to_tray {
        api.prevent_close();
        if let Some(w) = close_app.get_webview_window("main") { let _ = w.hide(); }
      }
    }
  });
  Ok(win)
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
  if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
}

/* -------------------------------------------------------------- updates -- */
fn set_update<R: Runtime>(app: &AppHandle<R>, s: updater::Status) {
  *shell(app).update.lock().unwrap() = s.clone();
  let v = serde_json::to_value(&s).unwrap_or(Value::Null);
  emit(app, "update-status", &v);
  push_updater(app, &v);
  rebuild_tray(app);
}
fn push_updater<R: Runtime>(app: &AppHandle<R>, v: &Value) {
  if let Some(w) = app.get_webview_window("updater") { let _ = w.eval(format!("window.sendUpdate&&window.sendUpdate({v})")); }
}
fn show_updater<R: Runtime>(app: &AppHandle<R>) {
  if let Some(w) = app.get_webview_window("updater") { let _ = w.show(); let _ = w.set_focus(); return; }
  let current = serde_json::to_value(&*shell(app).update.lock().unwrap()).unwrap_or(Value::Null);
  let ready_app = app.clone();
  let built = WebviewWindowBuilder::new(app, "updater", WebviewUrl::App("updater.html".into()))
    .title("Updating SEND").inner_size(300.0, 340.0).resizable(false).maximizable(false).decorations(false).center()
    .background_color(tauri::window::Color(14, 18, 32, 255))
    .on_page_load(move |_w, p| { if matches!(p.event(), tauri::webview::PageLoadEvent::Finished) { push_updater(&ready_app, &current); } })
    .build();
  if built.is_ok() { if let Some(m) = app.get_webview_window("main") { let _ = m.hide(); } }
}
fn close_updater_after_error<R: Runtime>(app: &AppHandle<R>) {
  let app = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(4500));
    if shell(&app).update.lock().unwrap().state == "error" {
      if let Some(w) = app.get_webview_window("updater") { let _ = w.close(); }
      show_main(&app);
    }
  });
}

fn check_now<R: Runtime>(app: &AppHandle<R>) -> updater::Status {
  if cfg!(debug_assertions) { return updater::Status { state: "disabled", message: Some("Updates are checked in installed builds only.".into()), ..Default::default() }; }
  let busy = matches!(shell(app).update.lock().unwrap().state, "downloading" | "ready" | "installing");
  if busy { return shell(app).update.lock().unwrap().clone(); }
  set_update(app, updater::Status::new("checking"));
  let local = app.package_info().version.to_string();
  let s = match updater::fetch_feed() {
    Ok(f) if updater::newer(&f.version, &local) => { let v = f.version.clone(); *shell(app).feed.lock().unwrap() = Some(f); updater::Status::v("available", Some(v)) }
    Ok(_) => updater::Status::new("none"),
    Err(e) => updater::Status { state: "error", message: Some(e), ..Default::default() },
  };
  set_update(app, s.clone());
  s
}

fn install<R: Runtime>(app: &AppHandle<R>) {
  let Some(path) = shell(app).installer.lock().unwrap().clone() else { return };
  let version = shell(app).update.lock().unwrap().version.clone();
  show_updater(app);
  push_updater(app, &json!({ "state": "installing", "version": version }));
  let app = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(900));
    push_updater(&app, &json!({ "state": "restarting", "version": version }));
    std::thread::sleep(std::time::Duration::from_millis(600));
    match updater::run_installer(&path) {
      Ok(()) => { shell(&app).quitting.store(true, Ordering::SeqCst); app.exit(0); }
      Err(e) => { set_update(&app, updater::Status { state: "error", version, message: Some(e), ..Default::default() }); close_updater_after_error(&app); }
    }
  });
}

fn download_and_install<R: Runtime>(app: &AppHandle<R>) -> updater::Status {
  let cur = shell(app).update.lock().unwrap().clone();
  if cur.state == "ready" { install(app); return cur; }
  if cur.state != "available" && cur.state != "error" { return cur; }
  let Some(feed) = shell(app).feed.lock().unwrap().clone() else { return cur };
  shell(app).install_when_ready.store(true, Ordering::SeqCst);
  let version = Some(feed.version.clone());
  set_update(app, updater::Status { state: "downloading", version: version.clone(), percent: Some(0), message: None });
  show_updater(app);
  let app2 = app.clone();
  std::thread::spawn(move || {
    let pv = version.clone();
    let pa = app2.clone();
    match updater::download(&feed, move |p| set_update(&pa, updater::Status { state: "downloading", version: pv.clone(), percent: Some(p), message: None })) {
      Ok(path) => {
        *shell(&app2).installer.lock().unwrap() = Some(path);
        set_update(&app2, updater::Status::v("ready", version));
        if shell(&app2).install_when_ready.swap(false, Ordering::SeqCst) { install(&app2); }
      }
      Err(e) => {
        shell(&app2).install_when_ready.store(false, Ordering::SeqCst);
        set_update(&app2, updater::Status { state: "error", version, message: Some(e), ..Default::default() });
        close_updater_after_error(&app2);
      }
    }
  });
  shell(app).update.lock().unwrap().clone()
}

/* ----------------------------------------------------------------- tray -- */
fn tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
  let st = shell(app);
  let u = st.update.lock().unwrap().clone();
  let (label, enabled) = match u.state {
    "ready" => (format!("Restart to update ({})", u.version.clone().unwrap_or_default()), true),
    "available" => (format!("Download and install update ({})", u.version.clone().unwrap_or_default()), true),
    "downloading" => (format!("Downloading update… {}%", u.percent.unwrap_or(0)), false),
    _ => ("Check for updates".to_string(), !cfg!(debug_assertions)),
  };
  Menu::with_items(app, &[
    &MenuItem::with_id(app, "open", "Open SEND", true, None::<&str>)?,
    &PredefinedMenuItem::separator(app)?,
    &MenuItem::with_id(app, "update", label, enabled, None::<&str>)?,
    &MenuItem::with_id(app, "server", "Change server…", true, None::<&str>)?,
    &CheckMenuItem::with_id(app, "tray", "Close to tray", true, st.cfg().close_to_tray, None::<&str>)?,
    &PredefinedMenuItem::separator(app)?,
    &MenuItem::with_id(app, "quit", "Quit SEND", true, None::<&str>)?,
  ])
}
fn rebuild_tray<R: Runtime>(app: &AppHandle<R>) {
  if let (Some(t), Ok(m)) = (app.tray_by_id("send"), tray_menu(app)) { let _ = t.set_menu(Some(m)); }
}
fn change_server_now<R: Runtime>(app: &AppHandle<R>) {
  let st = shell(app);
  st.config.lock().unwrap().server_url = String::new();
  st.save();
  show_main(app);
  load_app(app);
}

/* ------------------------------------------------------------- commands -- */
fn main_only<R: Runtime>(w: &tauri::Webview<R>) -> Result<(), String> { if w.label() == "main" { Ok(()) } else { Err("not allowed".into()) } }

#[tauri::command]
fn window_control<R: Runtime>(window: tauri::Window<R>, action: String) -> Value {
  match action.as_str() {
    "minimize" => { let _ = window.minimize(); }
    "maximize" => { if window.is_maximized().unwrap_or(false) { let _ = window.unmaximize(); } else { let _ = window.maximize(); } }
    "close" => { let _ = window.close(); }
    _ => {}
  }
  json!({ "maximized": window.is_maximized().unwrap_or(false) })
}

#[tauri::command]
fn set_ptt<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, code: Option<String>) -> Value {
  if main_only(&webview).is_err() { return json!({ "ok": false }); }
  let Some(code) = code else { ptt::set_key(None, |_| {}); return json!({ "ok": true }); };
  if code.len() > 32 { return json!({ "ok": false, "reason": "Invalid key." }); }
  if !ptt::available() { return json!({ "ok": false, "reason": "Global push-to-talk isn't available on this system." }); }
  let Some(k) = ptt::dom_code_to_key(&code) else {
    return json!({ "ok": false, "reason": format!("{code} can't be used as a global key. Try a letter, F-key, mouse button 4/5 or a modifier.") });
  };
  let a = app.clone();
  ptt::set_key(Some(k), move |down| emit(&a, "ptt", &json!(down)));
  json!({ "ok": true })
}

#[tauri::command]
fn set_material<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, material: String) -> Value {
  if main_only(&webview).is_err() || !material_ok() || !matches!(material.as_str(), "none" | "mica" | "acrylic") { return json!({ "ok": false }); }
  let st = shell(&app);
  st.config.lock().unwrap().material = material.clone();
  st.save();
  if let Some(w) = app.get_webview_window("main") { apply_material(&w, &material); }
  json!({ "ok": true })
}

#[tauri::command]
fn get_settings<R: Runtime>(app: AppHandle<R>) -> Value {
  let st = shell(&app);
  let c = st.cfg();
  let mut v = serde_json::to_value(&c).unwrap_or(json!({}));
  v["launchOnStartup"] = json!(app.autolaunch().is_enabled().unwrap_or(false));
  v["restartRequired"] = json!(c.hardware_acceleration != st.initial_hw);
  v
}

#[tauri::command]
fn set_performance<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, value: Value) -> Value {
  let Some(p) = value.as_object() else { return json!({ "ok": false }) };
  if main_only(&webview).is_err() || p.iter().any(|(k, v)| !matches!(k.as_str(), "hardwareAcceleration" | "reduceBackgroundWork") || !v.is_boolean()) { return json!({ "ok": false }); }
  let st = shell(&app);
  {
    let mut c = st.config.lock().unwrap();
    if let Some(b) = p.get("hardwareAcceleration").and_then(Value::as_bool) { c.hardware_acceleration = b; }
    if let Some(b) = p.get("reduceBackgroundWork").and_then(Value::as_bool) { c.reduce_background_work = b; }
  }
  st.save();
  json!({ "ok": true, "restartRequired": st.cfg().hardware_acceleration != st.initial_hw })
}

#[tauri::command]
fn set_startup<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, enabled: bool) -> Value {
  if main_only(&webview).is_err() { return json!({ "ok": false }); }
  let r = if enabled { app.autolaunch().enable() } else { app.autolaunch().disable() };
  json!({ "ok": r.is_ok() })
}

#[tauri::command]
fn restart_app<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>) {
  if main_only(&webview).is_ok() { shell(&app).quitting.store(true, Ordering::SeqCst); app.restart(); }
}

#[tauri::command]
fn refresh<R: Runtime>(webview: tauri::Webview<R>) { if main_only(&webview).is_ok() { let _ = webview.eval("location.reload()"); } }

#[tauri::command]
fn set_close_to_tray<R: Runtime>(app: AppHandle<R>, value: bool) -> Value {
  let st = shell(&app);
  st.config.lock().unwrap().close_to_tray = value;
  st.save();
  rebuild_tray(&app);
  json!({ "ok": true })
}

#[tauri::command]
async fn change_server<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>) { if main_only(&webview).is_ok() { change_server_now(&app); } }

#[tauri::command]
fn update_status<R: Runtime>(app: AppHandle<R>) -> updater::Status { shell(&app).update.lock().unwrap().clone() }

#[tauri::command]
async fn check_updates<R: Runtime>(app: AppHandle<R>) -> updater::Status {
  tauri::async_runtime::spawn_blocking(move || check_now(&app)).await.unwrap_or_else(|_| updater::Status::new("error"))
}

#[tauri::command]
// These open windows ("Updating SEND", the connect window). A synchronous command runs on the main thread, and
// building a window from there deadlocks on Windows — the updater froze on its animation in 0.6.2/0.6.3. Async
// commands run off the main thread, so the window is created by the event loop as it should be.
async fn download_update<R: Runtime>(app: AppHandle<R>) -> updater::Status { download_and_install(&app) }

#[tauri::command]
async fn restart_to_update<R: Runtime>(app: AppHandle<R>) { if shell(&app).update.lock().unwrap().state == "ready" { install(&app); } }

#[tauri::command]
fn flash<R: Runtime>(app: AppHandle<R>) {
  if let Some(w) = app.get_webview_window("main") {
    if !w.is_focused().unwrap_or(true) { let _ = w.request_user_attention(Some(UserAttentionType::Informational)); }
  }
}

/// Keep SEND's own window out of screen captures (Windows 10 2004+: WDA_EXCLUDEFROMCAPTURE). The web app turns it
/// on while you share your screen, so people watching don't see SEND inside your share.
#[tauri::command]
fn set_capture_excluded<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, excluded: bool) -> bool {
  if main_only(&webview).is_err() { return false; }
  #[cfg(windows)]
  if let Some(w) = app.get_webview_window("main") {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    if let Ok(h) = w.hwnd() {
      let hwnd = windows::Win32::Foundation::HWND(h.0 as _);
      return unsafe { SetWindowDisplayAffinity(hwnd, if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }) }.is_ok();
    }
  }
  #[cfg(not(windows))]
  let _ = (app, excluded);
  false
}

#[tauri::command]
fn notify<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, title: String, body: String) {
  if main_only(&webview).is_err() { return; }
  let t: String = title.chars().take(200).collect();
  let b: String = body.chars().take(400).collect();
  let _ = app.notification().builder().title(t).body(b).show();
}

#[tauri::command]
async fn connect_set_server<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>, input: String) -> Value {
  if main_only(&webview).is_err() { return json!({ "ok": false, "reason": "not allowed" }); }
  let Some(url) = normalize_server(&input) else { return json!({ "ok": false, "reason": "Enter an https:// address, for example https://chat.example.com" }) };
  let probe = url.clone();
  let ok = tauri::async_runtime::spawn_blocking(move || {
    let r = updater::agent().get(&format!("{probe}/api/instance")).timeout(std::time::Duration::from_secs(8)).call();
    match r { Ok(resp) => resp.into_json::<Value>().ok().and_then(|j| j.get("name").and_then(Value::as_str).map(|_| true)).unwrap_or(false), Err(_) => false }
  }).await.unwrap_or(false);
  if !ok { return json!({ "ok": false, "reason": "Couldn't reach a SEND server at that address. Check the address and your connection." }); }
  let st = shell(&app);
  st.config.lock().unwrap().server_url = url;
  st.save();
  load_app(&app);
  json!({ "ok": true })
}

#[tauri::command]
fn connect_info<R: Runtime>(app: AppHandle<R>) -> Value { json!({ "baked": BAKED_URL, "current": shell(&app).cfg().server_url }) }

/* ------------------------------------------------------------ lifecycle -- */
/// send://invite/CODE → /invite/CODE (syndo:// links from before the rename work too)
fn invite_path(link: &str) -> Option<String> {
  let u = Url::parse(link).ok()?;
  if !matches!(u.scheme(), "send" | "syndo") { return None; }
  let rest = format!("{}{}", u.host_str().unwrap_or(""), u.path());
  let code = rest.strip_prefix("invite/")?;
  let ok = (3..=32).contains(&code.len()) && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
  ok.then(|| format!("/invite/{code}"))
}
fn handle_links<R: Runtime>(app: &AppHandle<R>, links: impl IntoIterator<Item = String>) {
  for l in links {
    if let Some(p) = invite_path(&l) {
      *shell(app).pending_link.lock().unwrap() = Some(p);
      if app.get_webview_window("main").is_some() && !shell(app).cfg().server_url.is_empty() { load_app(app); }
      show_main(app);
      return;
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      handle_links(app, argv);
      show_main(app);
    }))
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![
      window_control, set_ptt, set_material, get_settings, set_performance, set_startup, restart_app, refresh,
      set_close_to_tray, change_server, update_status, check_updates, download_update, restart_to_update,
      flash, notify, connect_set_server, connect_info, set_capture_excluded
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      let config_path = app.path().app_config_dir().map(|d| d.join("config.json")).unwrap_or_else(|_| PathBuf::from("config.json"));
      let mut config: Config = std::fs::read(&config_path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
      if config.server_url.is_empty() { config.server_url = BAKED_URL.into(); }
      let initial_hw = config.hardware_acceleration;
      app.manage(Shell {
        config: Mutex::new(config), config_path, initial_hw, quitting: AtomicBool::new(false),
        update: Mutex::new(updater::Status::new("idle")), feed: Mutex::new(None), installer: Mutex::new(None),
        install_when_ready: AtomicBool::new(false), pending_link: Mutex::new(None),
      });

      // Invite links: at launch (argv) and while running (deep-link plugin + single instance).
      #[cfg(windows)]
      { let _ = app.deep_link().register_all(); }
      if let Ok(Some(urls)) = app.deep_link().get_current() { for u in urls { if let Some(p) = invite_path(u.as_str()) { *shell(&handle).pending_link.lock().unwrap() = Some(p); } } }
      handle_links(&handle, std::env::args().skip(1));
      let dl = handle.clone();
      app.deep_link().on_open_url(move |e| handle_links(&dl, e.urls().into_iter().map(|u| u.to_string())));

      create_main(&handle)?;

      let menu = tray_menu(&handle)?;
      TrayIconBuilder::with_id("send")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .tooltip("SEND")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, e| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e { show_main(tray.app_handle()); }
        })
        .on_menu_event(|app, e| match e.id().as_ref() {
          "open" => show_main(app),
          "update" => {
            let state = shell(app).update.lock().unwrap().state;
            match state {
              "ready" => install(app),
              "available" | "error" if shell(app).feed.lock().unwrap().is_some() => { download_and_install(app); }
              _ => { let a = app.clone(); std::thread::spawn(move || { check_now(&a); }); }
            }
          }
          "server" => change_server_now(app),
          "tray" => {
            let st = shell(app);
            let v = !st.cfg().close_to_tray;
            st.config.lock().unwrap().close_to_tray = v;
            st.save();
            rebuild_tray(app);
          }
          "quit" => { shell(app).quitting.store(true, Ordering::SeqCst); app.exit(0); }
          _ => {}
        })
        .build(app)?;

      // "Playing …": look for a known game every 20 s and tell the page when it changes.
      let gh = handle.clone();
      std::thread::spawn(move || {
        let mut last: Option<&'static str> = None;
        loop {
          std::thread::sleep(std::time::Duration::from_secs(20));
          let now = games::running();
          if now != last { last = now; emit(&gh, "activity", &json!(now.map(|n| json!({ "type": 0, "name": n })))); }
        }
      });

      // Check for updates a little after start, then every 4 hours (never downloads on its own).
      let up = handle.clone();
      std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(8));
        loop { check_now(&up); std::thread::sleep(std::time::Duration::from_secs(4 * 3600)); }
      });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running SEND");
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn servers_and_links() {
    assert_eq!(normalize_server("chat.example.com").as_deref(), Some("https://chat.example.com"));
    assert_eq!(normalize_server("http://localhost:3900/x").as_deref(), Some("http://localhost:3900"));
    assert_eq!(normalize_server("http://evil.example"), None);
    assert_eq!(invite_path("send://invite/AbC-123").as_deref(), Some("/invite/AbC-123"));
    assert_eq!(invite_path("syndo://invite/AbC-123").as_deref(), Some("/invite/AbC-123"));
    assert_eq!(invite_path("send://invite/../x"), None);
    assert_eq!(invite_path("syndo://invite/../x"), None);
    assert_eq!(invite_path("https://invite/abc"), None);
  }
}
