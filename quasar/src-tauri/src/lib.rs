//! QUASAR desktop shell: windows, tray, IPC, and the OS-facing services
//! (frame loop, audio, screen capture, game feeds, input hooks, app watcher)
//! around the engine in `quasar-core`.

mod commands;
mod keys;
mod services;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use quasar_core::backends::{openrgb::OpenRgb, virtual_rig::VirtualRig};
use quasar_core::profiles::State;
use quasar_core::Engine;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub struct Shared {
    pub engine: Mutex<Engine>,
    pub path: PathBuf,
    pub dirty: AtomicBool,
    /// Profile the user picked by hand; auto-switch returns here.
    pub base_profile: Mutex<String>,
    pub recording: Mutex<Option<services::input::Recording>>,
    pub ready: AtomicBool,
    pub openrgb: Mutex<services::openrgb::Status>,
    pub openrgb_child: Mutex<Option<std::process::Child>>,
    pub update: Mutex<Option<services::updates::Manifest>>,
}

impl Shared {
    pub fn touch(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }

    pub fn save_now(&self) {
        if self.dirty.swap(false, Ordering::Relaxed) {
            let state = self.engine.lock().state.clone();
            if let Err(e) = state.save(&self.path) {
                log::error!("saving state: {e}");
            }
        }
    }
}

pub type App = Arc<Shared>;

/// (Re)build the backend list from settings and rescan.
pub fn configure_backends(engine: &mut Engine) {
    let s = engine.state.settings.clone();
    for id in ["virtual", "openrgb", "hid"] {
        engine.remove_backend(id);
    }
    if s.demo_rig {
        engine.add_backend(Box::new(VirtualRig::default()));
    }
    if s.openrgb_enabled {
        engine.add_backend(Box::new(OpenRgb::new(&s.openrgb_host, s.openrgb_port)));
    }
    if s.hid_enabled {
        engine.add_backend(Box::new(quasar_core::backends::hid::Hid::default()));
    }
    engine.scan();
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open QUASAR", true, None::<&str>)?;
    let off = MenuItem::with_id(app, "lights", "Lights off / on", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &off, &PredefinedMenuItem::separator(app)?, &quit])?;
    TrayIconBuilder::with_id("quasar")
        .icon(app.default_window_icon().cloned().expect("bundle has an icon"))
        .tooltip("QUASAR")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "open" => show_main(app),
            "lights" => {
                let shared = app.state::<App>();
                let mut e = shared.engine.lock();
                let p = e.state.profile_mut();
                p.brightness = if p.brightness > 0.0 { 0.0 } else { 0.9 };
                drop(e);
                shared.touch();
            }
            "quit" => {
                app.state::<App>().save_now();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let path = dir.join("state.json");
            let state = State::load(&path);
            let base = state.active_profile.clone();
            let mut engine = Engine::new(state);
            configure_backends(&mut engine);
            let shared: App = Arc::new(Shared {
                engine: Mutex::new(engine),
                path,
                dirty: AtomicBool::new(true),
                base_profile: Mutex::new(base),
                recording: Mutex::new(None),
                ready: AtomicBool::new(false),
                openrgb: Mutex::new(Default::default()),
                openrgb_child: Mutex::new(None),
                update: Mutex::new(None),
            });
            app.manage(shared.clone());
            build_tray(app.handle())?;
            services::start(app.handle().clone(), shared);
            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the main window keeps the lights running from the tray
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    window.app_handle().state::<App>().save_now();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_ready,
            commands::snapshot,
            commands::library,
            commands::set_scene,
            commands::activate_profile,
            commands::save_profile,
            commands::delete_profile,
            commands::set_brightness,
            commands::set_placement,
            commands::set_device_settings,
            commands::rescan,
            commands::set_settings,
            commands::save_macro,
            commands::delete_macro,
            commands::play_macro,
            commands::start_recording,
            commands::stop_recording,
            commands::press_at,
            commands::cs2_config,
            commands::install_cs2_config,
            commands::set_autostart,
            commands::arrange_layout,
            commands::openrgb_status,
            commands::openrgb_install,
            commands::openrgb_start,
            commands::openrgb_stop,
            commands::check_updates,
            commands::install_update,
            commands::resize_zone,
            commands::diagnostics,
            commands::test_device,
            commands::openrgb_open_gui,
            commands::apply_device,
            commands::apply_all,
            commands::health,
            commands::relaunch_elevated,
        ])
        .build(tauri::generate_context!())
        .expect("QUASAR failed to start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // never leave an OpenRGB server we started running behind us
                let shared = app.state::<App>();
                shared.save_now();
                services::openrgb::stop(&shared);
            }
        });
}
