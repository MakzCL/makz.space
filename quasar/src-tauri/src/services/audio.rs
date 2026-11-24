use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use quasar_core::audio::Analyzer;

use super::{nap, scene_uses};
use crate::App;

/// Capture what the PC is playing. On Windows an input stream on the
/// default *output* device is a WASAPI loopback; elsewhere we take the
/// default input (point it at a monitor source for system audio).
pub fn run(app: App, slot: Arc<Mutex<Option<Analyzer>>>) {
    loop {
        // only capture while a scene actually listens
        while !(app.engine.lock().state.settings.audio_enabled && scene_uses(&app, "visualizer")) {
            *slot.lock() = None;
            nap(500);
        }
        if let Err(e) = capture(&app, &slot) {
            log::warn!("audio capture: {e}");
            nap(3000);
        }
    }
}

fn capture(app: &App, slot: &Arc<Mutex<Option<Analyzer>>>) -> Result<(), String> {
    let host = cpal::default_host();
    let device = if cfg!(windows) { host.default_output_device() } else { host.default_input_device() }.ok_or("no audio device")?;
    let config = if cfg!(windows) { device.default_output_config() } else { device.default_input_config() }.map_err(|e| e.to_string())?;
    let channels = config.channels() as usize;
    *slot.lock() = Some(Analyzer::new(config.sample_rate()));
    let sink = slot.clone();
    let stream = device
        .build_input_stream::<f32, _, _>(
            config.into(),
            move |data: &[f32], _| {
                let mono: Vec<f32> = data.chunks(channels.max(1)).map(|c| c.iter().sum::<f32>() / c.len() as f32).collect();
                if let Some(a) = sink.lock().as_mut() {
                    a.push(&mono);
                }
            },
            |e| log::warn!("audio stream: {e}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    while app.engine.lock().state.settings.audio_enabled && scene_uses(app, "visualizer") {
        nap(500);
    }
    Ok(())
}
