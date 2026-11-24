use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use quasar_core::audio::Analyzer;
use quasar_core::effects::ScreenFrame;
use tauri::{AppHandle, Emitter, Manager};

use crate::App;

/// Render at the configured rate, push previews to the UI at 30 fps, poll
/// device status every few seconds and persist state when it changed.
pub fn run(handle: AppHandle, app: App, analyzer: Arc<Mutex<Option<Analyzer>>>, screen: Arc<Mutex<Option<ScreenFrame>>>) {
    let mut last = Instant::now();
    let mut last_preview = Instant::now();
    let mut last_status = Instant::now();
    let mut last_save = Instant::now();
    loop {
        let fps = app.engine.lock().state.settings.fps.clamp(10, 144);
        let budget = Duration::from_secs_f32(1.0 / fps as f32);
        let now = Instant::now();
        let dt = (now - last).as_secs_f32().min(0.1);
        last = now;

        let audio = analyzer.lock().as_mut().map(|a| a.analyse(dt));
        let shot = screen.lock().take();
        {
            let mut e = app.engine.lock();
            if let Some(a) = audio {
                e.audio = a;
            }
            if shot.is_some() {
                e.screen = shot;
            }
            e.tick(dt);
        }

        let visible = handle.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false);
        if visible && last_preview.elapsed() >= Duration::from_millis(33) {
            last_preview = Instant::now();
            let frame = app.engine.lock().frame(96, 60);
            let _ = handle.emit("frame", frame);
        }
        if last_status.elapsed() >= Duration::from_secs(5) {
            last_status = Instant::now();
            app.engine.lock().poll_status();
        }
        if last_save.elapsed() >= Duration::from_secs(2) {
            last_save = Instant::now();
            app.save_now();
        }
        if let Some(rest) = budget.checked_sub(now.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}
