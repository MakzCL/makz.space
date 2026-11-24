use std::sync::Arc;

use parking_lot::Mutex;
use quasar_core::effects::ScreenFrame;

use super::{nap, scene_uses};
use crate::App;

const W: usize = 64;
const H: usize = 36;

/// Grab the primary monitor ~15 times a second while an ambience layer is on,
/// and box-filter it down to 64x36.
pub fn run(app: App, slot: Arc<Mutex<Option<ScreenFrame>>>) {
    loop {
        if !(app.engine.lock().state.settings.screen_enabled && scene_uses(&app, "ambience")) {
            nap(500);
            continue;
        }
        let started = std::time::Instant::now();
        match grab() {
            Ok(f) => *slot.lock() = Some(f),
            Err(e) => {
                log::warn!("screen capture: {e}");
                nap(3000);
            }
        }
        nap(66u64.saturating_sub(started.elapsed().as_millis() as u64));
    }
}

fn grab() -> Result<ScreenFrame, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let m = monitors.iter().find(|m| m.is_primary().unwrap_or(false)).or(monitors.first()).ok_or("no monitor")?;
    let img = m.capture_image().map_err(|e| e.to_string())?;
    let (iw, ih) = (img.width() as usize, img.height() as usize);
    let raw = img.as_raw();
    let mut px = vec![[0.0f32; 3]; W * H];
    // sample a sparse grid inside each cell; plenty for ambient colour
    for (cy, row) in px.chunks_mut(W).enumerate() {
        for (cx, out) in row.iter_mut().enumerate() {
            let (x0, y0) = (cx * iw / W, cy * ih / H);
            let (x1, y1) = (((cx + 1) * iw / W).max(x0 + 1), ((cy + 1) * ih / H).max(y0 + 1));
            let (sx, sy) = (((x1 - x0) / 4).max(1), ((y1 - y0) / 4).max(1));
            let mut acc = [0.0f32; 3];
            let mut n = 0.0;
            for y in (y0..y1).step_by(sy) {
                for x in (x0..x1).step_by(sx) {
                    let i = (y * iw + x) * 4;
                    acc[0] += raw[i] as f32;
                    acc[1] += raw[i + 1] as f32;
                    acc[2] += raw[i + 2] as f32;
                    n += 1.0;
                }
            }
            *out = [acc[0] / n / 255.0, acc[1] / n / 255.0, acc[2] / n / 255.0];
        }
    }
    Ok(ScreenFrame { w: W, h: H, px })
}
