//! Long-running background services.

pub mod apps;
pub mod audio;
pub mod frame_loop;
pub mod gsi;
pub mod input;
pub mod openrgb;
pub mod screen;
pub mod updates;

use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;

use crate::App;

pub fn start(handle: AppHandle, app: App) {
    let analyzer = Arc::new(parking_lot::Mutex::new(None));
    let screen = Arc::new(parking_lot::Mutex::new(None));
    spawn("openrgb", {
        let (h, app) = (handle.clone(), app.clone());
        move || openrgb::boot(h, app)
    });
    spawn("updates", {
        let (h, app) = (handle.clone(), app.clone());
        move || updates::run(h, app)
    });
    spawn("frame-loop", {
        let (app, analyzer, screen) = (app.clone(), analyzer.clone(), screen.clone());
        move || frame_loop::run(handle, app, analyzer, screen)
    });
    spawn("audio", {
        let app = app.clone();
        move || audio::run(app, analyzer)
    });
    spawn("screen", {
        let app = app.clone();
        move || screen::run(app, screen)
    });
    spawn("gsi", {
        let app = app.clone();
        move || gsi::run(app)
    });
    spawn("apps", {
        let app = app.clone();
        move || apps::run(app)
    });
    spawn("input", move || input::run(app));
}

fn spawn(name: &str, f: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new().name(format!("quasar-{name}")).spawn(f).expect("spawn service thread");
}

/// Sleep helper for services that poll.
pub fn nap(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

/// True if any enabled layer of the active scene uses `effect`.
pub fn scene_uses(app: &App, effect: &str) -> bool {
    app.engine.lock().state.profile().scene.layers.iter().any(|l| l.enabled && l.effect == effect)
}
