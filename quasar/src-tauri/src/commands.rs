//! IPC commands the UI calls. Every mutation marks state dirty; the frame
//! loop persists it a moment later.

use quasar_core::device::DeviceSettings;
use quasar_core::effects::{self, EffectInfo};
use quasar_core::engine::{BackendView, DeviceView};
use quasar_core::layout::Placement;
use quasar_core::macros::Macro;
use quasar_core::profiles::{Profile, Scene, Settings};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::App;

type R<T> = Result<T, String>;

#[derive(Serialize)]
pub struct Snapshot {
    devices: Vec<DeviceView>,
    backends: Vec<BackendView>,
    profiles: Vec<Profile>,
    active_profile: String,
    macros: Vec<Macro>,
    settings: Settings,
    platform: &'static str,
    version: &'static str,
}

fn snap(app: &App) -> Snapshot {
    let e = app.engine.lock();
    Snapshot {
        devices: e.devices(),
        backends: e.backends(),
        profiles: e.state.profiles.clone(),
        active_profile: e.state.active_profile.clone(),
        macros: e.state.macros.clone(),
        settings: e.state.settings.clone(),
        platform: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// The UI has painted its first frame: swap the splash for the main window.
#[tauri::command]
pub fn app_ready(handle: AppHandle, app: State<App>) {
    if app.ready.swap(true, std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let minimized = std::env::args().any(|a| a == "--minimized") || app.engine.lock().state.settings.start_minimized;
    if let Some(s) = handle.get_webview_window("splash") {
        let _ = s.close();
    }
    if !minimized {
        if let Some(w) = handle.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

#[tauri::command]
pub fn snapshot(app: State<App>) -> Snapshot {
    snap(&app)
}

#[tauri::command]
pub fn library() -> Vec<EffectInfo> {
    effects::library()
}

#[tauri::command]
pub fn set_scene(app: State<App>, scene: Scene) {
    app.engine.lock().set_scene(scene);
    app.touch();
}

#[tauri::command]
pub fn activate_profile(app: State<App>, id: String) -> Snapshot {
    app.engine.lock().activate_profile(&id);
    *app.base_profile.lock() = id;
    app.touch();
    snap(&app)
}

#[tauri::command]
pub fn save_profile(app: State<App>, profile: Profile) -> Snapshot {
    {
        let mut e = app.engine.lock();
        let active = e.state.active_profile == profile.id;
        match e.state.profiles.iter_mut().find(|p| p.id == profile.id) {
            Some(p) => *p = profile,
            None => {
                let mut p = profile;
                // a new profile inherits the current device settings
                if p.devices.is_empty() {
                    p.devices = e.state.profile().devices.clone();
                }
                e.state.profiles.push(p)
            }
        }
        if active {
            e.load_scene();
        }
    }
    app.touch();
    snap(&app)
}

#[tauri::command]
pub fn delete_profile(app: State<App>, id: String) -> R<Snapshot> {
    {
        let mut e = app.engine.lock();
        if e.state.profiles.len() <= 1 {
            return Err("Keep at least one profile.".into());
        }
        e.state.profiles.retain(|p| p.id != id);
        if e.state.active_profile == id {
            let first = e.state.profiles[0].id.clone();
            e.activate_profile(&first);
            *app.base_profile.lock() = first;
        }
    }
    app.touch();
    Ok(snap(&app))
}

#[tauri::command]
pub fn set_brightness(app: State<App>, value: f32) {
    app.engine.lock().state.profile_mut().brightness = value.clamp(0.0, 1.0);
    app.touch();
}

#[tauri::command]
pub fn set_placement(app: State<App>, id: String, placement: Placement) {
    app.engine.lock().set_placement(&id, placement);
    app.touch();
}

/// Put every device back into the uniform layout.
#[tauri::command]
pub fn arrange_layout(app: State<App>) -> Snapshot {
    app.engine.lock().arrange();
    app.touch();
    snap(&app)
}

#[tauri::command]
pub fn set_device_settings(app: State<App>, id: String, settings: DeviceSettings) {
    app.engine.lock().set_device_settings(&id, settings);
    app.touch();
}

#[tauri::command]
pub async fn rescan(app: State<'_, App>) -> R<Snapshot> {
    crate::configure_backends(&mut app.engine.lock());
    app.touch();
    Ok(snap(&app))
}

#[tauri::command]
pub async fn set_settings(app: State<'_, App>, settings: Settings) -> R<Snapshot> {
    {
        let mut e = app.engine.lock();
        let old = e.state.settings.clone();
        e.state.settings = settings.clone();
        let backends_changed = old.demo_rig != settings.demo_rig
            || old.openrgb_enabled != settings.openrgb_enabled
            || old.openrgb_host != settings.openrgb_host
            || old.openrgb_port != settings.openrgb_port
            || old.hid_enabled != settings.hid_enabled;
        if backends_changed {
            crate::configure_backends(&mut e);
        }
    }
    app.touch();
    Ok(snap(&app))
}

#[tauri::command]
pub fn save_macro(app: State<App>, m: Macro) -> Vec<Macro> {
    let mut e = app.engine.lock();
    match e.state.macros.iter_mut().find(|x| x.id == m.id) {
        Some(x) => *x = m,
        None => e.state.macros.push(m),
    }
    app.touch();
    e.state.macros.clone()
}

#[tauri::command]
pub fn delete_macro(app: State<App>, id: String) -> Vec<Macro> {
    let mut e = app.engine.lock();
    e.state.macros.retain(|m| m.id != id);
    app.touch();
    e.state.macros.clone()
}

#[tauri::command]
pub fn play_macro(app: State<App>, id: String) -> R<()> {
    let m = app.engine.lock().state.macros.iter().find(|m| m.id == id).cloned().ok_or("No such macro")?;
    crate::services::input::play(m);
    Ok(())
}

#[tauri::command]
pub fn start_recording(app: State<App>) {
    *app.recording.lock() = Some(crate::services::input::Recording::default());
}

#[tauri::command]
pub fn stop_recording(app: State<App>) -> Vec<quasar_core::macros::Step> {
    app.recording.lock().take().map(|r| r.finish()).unwrap_or_default()
}

/// Clicking the canvas preview in the Studio fires a press there.
#[tauri::command]
pub fn press_at(app: State<App>, u: f32, v: f32) {
    app.engine.lock().press_at(u, v);
}

#[tauri::command]
pub fn cs2_config(app: State<App>) -> String {
    quasar_core::game::cs2_cfg(app.engine.lock().state.settings.gsi_port)
}

/// Find CS2 through Steam's library folders and drop the cfg in place.
#[tauri::command]
pub fn install_cs2_config(app: State<App>) -> R<String> {
    let cfg = quasar_core::game::cs2_cfg(app.engine.lock().state.settings.gsi_port);
    let roots: Vec<std::path::PathBuf> = if cfg!(windows) {
        vec!["C:\\Program Files (x86)\\Steam".into(), "C:\\Program Files\\Steam".into()]
    } else {
        std::env::var_os("HOME")
            .map(|h| vec![std::path::Path::new(&h).join(".steam/steam"), std::path::Path::new(&h).join(".local/share/Steam")])
            .unwrap_or_default()
    };
    let mut libraries = roots.clone();
    for r in &roots {
        if let Ok(vdf) = std::fs::read_to_string(r.join("steamapps/libraryfolders.vdf")) {
            for line in vdf.lines() {
                let l = line.trim();
                if let Some(rest) = l.strip_prefix("\"path\"") {
                    let p = rest.trim().trim_matches('"').replace("\\\\", "\\");
                    libraries.push(p.into());
                }
            }
        }
    }
    for lib in libraries {
        let dir = lib.join("steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg");
        if dir.is_dir() {
            let file = dir.join("gamestate_integration_quasar.cfg");
            std::fs::write(&file, cfg).map_err(|e| e.to_string())?;
            return Ok(file.display().to_string());
        }
    }
    Err("Counter-Strike 2 was not found in any Steam library. Copy the config by hand.".into())
}

#[tauri::command]
pub fn set_autostart(handle: AppHandle, app: State<App>, enabled: bool) -> R<()> {
    use tauri_plugin_autostart::ManagerExt;
    let al = handle.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
    app.engine.lock().state.settings.launch_at_login = enabled;
    app.touch();
    Ok(())
}

// ---- built-in OpenRGB ----------------------------------------------------

#[tauri::command]
pub fn openrgb_status(app: State<App>) -> crate::services::openrgb::Status {
    let mut s = app.openrgb.lock().clone();
    s.version = crate::services::openrgb::VERSION;
    s
}

#[tauri::command]
pub fn openrgb_install(handle: AppHandle, app: State<App>) {
    crate::services::openrgb::install(handle, app.inner().clone());
}

#[tauri::command]
pub fn openrgb_start(handle: AppHandle, app: State<App>) -> R<()> {
    let exe = crate::services::openrgb::find(&handle).ok_or("OpenRGB is not installed.")?;
    crate::services::openrgb::start(&handle, app.inner(), &exe)
}

#[tauri::command]
pub fn openrgb_stop(handle: AppHandle, app: State<App>) {
    crate::services::openrgb::stop(app.inner());
    app.openrgb.lock().phase = crate::services::openrgb::Phase::Stopped;
    let _ = tauri::Emitter::emit(&handle, "openrgb", app.openrgb.lock().clone());
    crate::configure_backends(&mut app.engine.lock());
}

// ---- updates ---------------------------------------------------------------

#[tauri::command]
pub async fn check_updates(handle: AppHandle, app: State<'_, App>) -> R<Option<crate::services::updates::Update>> {
    let (h, a) = (handle.clone(), app.inner().clone());
    tauri::async_runtime::spawn_blocking(move || crate::services::updates::check(&h, &a)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn install_update(handle: AppHandle, app: State<App>) {
    crate::services::updates::install(handle, app.inner().clone());
}

/// Set the LED count of a resizable zone (a motherboard ARGB header).
#[tauri::command]
pub fn resize_zone(app: State<App>, id: String, zone: usize, size: u32) -> R<Snapshot> {
    app.engine.lock().resize_zone(&id, zone, size).map_err(|e| e.to_string())?;
    app.touch();
    Ok(snap(&app))
}

/// Everything useful for a bug report, as text.
#[tauri::command]
pub fn diagnostics(handle: AppHandle, app: State<App>) -> String {
    let e = app.engine.lock();
    let devices: Vec<_> = e
        .devices()
        .into_iter()
        .map(|d| {
            serde_json::json!({
                "name": d.info.name, "vendor": d.info.vendor, "kind": d.info.kind, "backend": d.info.backend,
                "leds": d.info.layout.leds.len(), "zones": d.info.zones, "modes": d.info.caps.hardware_modes,
                "lighting": d.settings.lighting, "error": d.error,
                "writes": e.counters(&d.info.id),
            })
        })
        .collect();
    let report = serde_json::json!({
        "quasar": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "backends": e.backends(),
        "stats": e.stats(),
        "openrgb": *app.openrgb.lock(),
        "settings": e.state.settings,
        "profile": {
            "name": e.state.profile().name,
            "brightness": e.state.profile().brightness,
            "layers": e.state.profile().scene.layers.iter().map(|l| serde_json::json!({"effect": l.effect, "enabled": l.enabled, "opacity": l.opacity, "blend": l.blend})).collect::<Vec<_>>(),
        },
        "devices": devices,
        "usb_hid": quasar_core::backends::hid::inventory(),
        "openrgb_log": crate::services::openrgb::log_tail(&handle, 80),
    });
    serde_json::to_string_pretty(&report).unwrap_or_default()
}

/// Flash a device red, green, blue to check it responds.
#[tauri::command]
pub fn test_device(app: State<App>, id: String) {
    app.engine.lock().test_device(&id);
}

#[tauri::command]
pub fn openrgb_open_gui(handle: AppHandle, app: State<App>) -> R<()> {
    crate::services::openrgb::open_gui(&handle, app.inner())
}

/// Push a device's colours now, re-sending its control mode; `save` also
/// stores it on the device so it survives without QUASAR.
#[tauri::command]
pub fn apply_device(app: State<App>, id: String, save: bool) -> R<()> {
    app.engine.lock().apply_device(&id, save).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_all(app: State<App>, save: bool) -> Vec<(String, String)> {
    app.engine.lock().apply_all(save)
}
