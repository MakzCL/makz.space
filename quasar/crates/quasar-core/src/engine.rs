//! The frame loop: render the scene, sample every LED, ship colour to devices.

use std::time::Instant;

use serde::Serialize;

use crate::backends::Backend;
use crate::canvas::Canvas;
use crate::color::Rgb;
use crate::device::{DeviceInfo, DeviceSettings, DeviceStatus, LightingMode};
use crate::effects::{self, AudioFrame, Effect, FrameCtx, Press, ScreenFrame};
use crate::game::GameState;
use crate::layout::Placement;
use crate::profiles::{LayerSpec, Scene, State};

struct Layer {
    spec: LayerSpec,
    fx: Box<dyn Effect>,
    scratch: Canvas,
}

struct Managed {
    info: DeviceInfo,
    backend: usize,
    uv: Vec<(f32, f32)>,
    colors: Vec<Rgb>,
    sent: Vec<Rgb>,
    status: DeviceStatus,
    error: Option<String>,
    counters: Counters,
    last_write: Option<Instant>,
}

/// Re-send unchanged colours this often. Devices drop or reset colours
/// (mode switches, sleep, a missed packet); with a static scene nothing
/// would ever correct that otherwise.
const KEEPALIVE: std::time::Duration = std::time::Duration::from_secs(1);

/// Per-device write telemetry for diagnostics.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Counters {
    pub writes: u64,
    pub busy: u64,
    pub errors: u64,
    /// First LED of the last frame actually sent, `#rrggbb`.
    pub last_sent: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Stats {
    pub fps: f32,
    pub frame_ms: f32,
    pub leds: usize,
    pub devices: usize,
    pub writes_per_sec: f32,
}

#[derive(Clone, Debug, Serialize)]
pub struct DeviceView {
    pub info: DeviceInfo,
    pub placement: Placement,
    pub settings: DeviceSettings,
    pub status: DeviceStatus,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackendView {
    pub id: &'static str,
    pub name: &'static str,
    pub devices: usize,
    pub error: Option<String>,
}

/// One preview frame for the UI. Colour data is base64 RGB8.
#[derive(Clone, Debug, Serialize)]
pub struct Frame {
    pub w: usize,
    pub h: usize,
    pub canvas: String,
    pub devices: Vec<(String, String)>,
    pub stats: Stats,
}

pub struct Engine {
    pub state: State,
    canvas: Canvas,
    layers: Vec<Layer>,
    devices: Vec<Managed>,
    backends: Vec<Box<dyn Backend>>,
    backend_errors: Vec<Option<String>>,
    pub audio: AudioFrame,
    pub screen: Option<ScreenFrame>,
    pub game: GameState,
    presses: Vec<Press>,
    t: f32,
    stats: Stats,
    /// Device being flashed red, green, blue by "Test LEDs", and since when.
    test: Option<(String, Instant)>,
    writes: u32,
    stat_window: f32,
    frames: u32,
    frame_time_acc: f32,
}

impl Engine {
    pub fn new(state: State) -> Self {
        let mut e = Self {
            state,
            canvas: Canvas::new(Canvas::DEFAULT_W, Canvas::DEFAULT_H),
            layers: Vec::new(),
            devices: Vec::new(),
            backends: Vec::new(),
            backend_errors: Vec::new(),
            audio: AudioFrame::default(),
            screen: None,
            game: GameState::default(),
            presses: Vec::new(),
            t: 0.0,
            stats: Stats::default(),
            test: None,
            writes: 0,
            stat_window: 0.0,
            frames: 0,
            frame_time_acc: 0.0,
        };
        e.load_scene();
        e
    }

    pub fn add_backend(&mut self, b: Box<dyn Backend>) {
        self.backends.push(b);
        self.backend_errors.push(None);
    }

    pub fn remove_backend(&mut self, id: &str) {
        if let Some(i) = self.backends.iter().position(|b| b.id() == id) {
            self.backends.remove(i);
            self.backend_errors.remove(i);
            self.devices.retain(|d| d.backend != i);
            for d in &mut self.devices {
                if d.backend > i {
                    d.backend -= 1;
                }
            }
        }
    }

    pub fn has_backend(&self, id: &str) -> bool {
        self.backends.iter().any(|b| b.id() == id)
    }

    /// Rediscover devices on every backend. Placements and settings persist by id.
    pub fn scan(&mut self) {
        self.devices.clear();
        for (bi, b) in self.backends.iter_mut().enumerate() {
            match b.scan() {
                Ok(list) => {
                    self.backend_errors[bi] = None;
                    for info in list {
                        let status = b.status(&info.id).unwrap_or(DeviceStatus { connected: true, ..Default::default() });
                        self.devices.push(Managed { info, backend: bi, uv: Vec::new(), colors: Vec::new(), sent: Vec::new(), status, error: None, counters: Counters::default(), last_write: None });
                    }
                }
                Err(e) => self.backend_errors[bi] = Some(e.to_string()),
            }
        }
        // anything new joins the uniform layout; placed devices stay put
        if self.devices.iter().any(|d| !self.state.placements.contains_key(&d.info.id)) {
            let fresh: Vec<String> = self.devices.iter().map(|d| d.info.id.clone()).filter(|id| !self.state.placements.contains_key(id)).collect();
            let all = self.arranged();
            for id in fresh {
                if let Some(p) = all.get(&id) {
                    self.state.placements.insert(id, *p);
                }
            }
        }
        for d in &self.devices {
            let id = d.info.id.clone();
            for prof in &mut self.state.profiles {
                prof.devices.entry(id.clone()).or_insert_with(|| DeviceSettings::for_device(&d.info));
            }
        }
        self.relayout();
        self.apply_all_settings();
    }

    fn relayout(&mut self) {
        let aspect = self.canvas.aspect();
        for d in &mut self.devices {
            let p = self.state.placements.get(&d.info.id).copied().unwrap_or_default();
            d.uv = d.info.layout.project(&p, aspect);
            d.colors = vec![Rgb::BLACK; d.uv.len()];
        }
        self.stats.leds = self.devices.iter().map(|d| d.uv.len()).sum();
        self.stats.devices = self.devices.len();
    }

    fn apply_all_settings(&mut self) {
        let ids: Vec<String> = self.devices.iter().map(|d| d.info.id.clone()).collect();
        for id in ids {
            self.push_settings(&id);
        }
    }

    fn push_settings(&mut self, id: &str) {
        let Some(s) = self.state.profile().devices.get(id).cloned() else { return };
        if let Some(d) = self.devices.iter_mut().find(|d| d.info.id == id) {
            d.error = self.backends[d.backend].apply_settings(id, &s).err().map(|e| e.to_string());
            d.sent.clear(); // force a colour write too
        }
    }

    /// Rebuild live layers from the active profile's scene, keeping the
    /// state of layers whose effect did not change (so ripples keep rippling).
    pub fn load_scene(&mut self) {
        let scene = self.state.profile().scene.clone();
        let mut old: Vec<Layer> = std::mem::take(&mut self.layers);
        for spec in scene.layers {
            let kept = old.iter().position(|l| l.spec.id == spec.id && l.spec.effect == spec.effect).map(|i| old.remove(i));
            let layer = match kept {
                Some(mut l) => {
                    l.spec = spec;
                    l
                }
                None => match effects::create(&spec.effect) {
                    Some(fx) => Layer { spec, fx, scratch: Canvas::new(self.canvas.w, self.canvas.h) },
                    None => continue,
                },
            };
            self.layers.push(layer);
        }
    }

    pub fn set_scene(&mut self, scene: Scene) {
        self.state.profile_mut().scene = scene;
        self.load_scene();
    }

    pub fn activate_profile(&mut self, id: &str) -> bool {
        if self.state.active_profile == id || !self.state.profiles.iter().any(|p| p.id == id) {
            return false;
        }
        self.state.active_profile = id.to_string();
        self.load_scene();
        self.apply_all_settings();
        true
    }

    fn arranged(&self) -> std::collections::BTreeMap<String, Placement> {
        let items: Vec<crate::layout::Item> = self.devices.iter().map(|d| crate::layout::Item { kind: d.info.kind, w: d.info.layout.width, h: d.info.layout.height }).collect();
        let places = crate::layout::arrange(&items, self.canvas.aspect());
        self.devices.iter().map(|d| d.info.id.clone()).zip(places).collect()
    }

    /// Reset every device to the uniform layout.
    pub fn arrange(&mut self) {
        let all = self.arranged();
        self.state.placements.extend(all);
        self.relayout();
    }

    pub fn set_placement(&mut self, id: &str, p: Placement) {
        self.state.placements.insert(id.to_string(), p);
        self.relayout();
    }

    pub fn set_device_settings(&mut self, id: &str, s: DeviceSettings) {
        self.state.profile_mut().devices.insert(id.to_string(), s);
        self.push_settings(id);
    }

    pub fn press_at(&mut self, u: f32, v: f32) {
        if self.presses.len() < 64 {
            self.presses.push(Press { u, v });
        }
    }

    /// A key went down: ripple from wherever that key is on every keyboard.
    /// `labels` are aliases for the same key (`"Esc"`, `"Escape"`), since
    /// drivers name keys differently.
    pub fn press_key(&mut self, labels: &[&str]) {
        let hits: Vec<(f32, f32)> = self
            .devices
            .iter()
            .filter(|d| d.info.kind == crate::device::DeviceKind::Keyboard)
            .filter_map(|d| {
                d.info
                    .layout
                    .leds
                    .iter()
                    .position(|l| l.label.as_deref().is_some_and(|x| labels.iter().any(|k| x.eq_ignore_ascii_case(k))))
                    .map(|i| d.uv[i])
            })
            .collect();
        if hits.is_empty() {
            // no keyboard knows that key: ripple from the first keyboard's centre
            if let Some(p) = self.devices.iter().find(|d| d.info.kind == crate::device::DeviceKind::Keyboard).and_then(|d| self.state.placements.get(&d.info.id)) {
                let (u, v) = (p.x, p.y);
                self.press_at(u, v);
            }
        }
        for (u, v) in hits {
            self.press_at(u, v);
        }
    }

    /// Advance one frame.
    pub fn tick(&mut self, dt: f32) {
        let started = Instant::now();
        self.t += dt;
        self.game.advance(dt);
        let presses = std::mem::take(&mut self.presses);
        let ctx = FrameCtx {
            t: self.t,
            dt,
            aspect: self.canvas.aspect(),
            audio: &self.audio,
            screen: self.screen.as_ref(),
            presses: &presses,
            game: &self.game,
        };
        self.canvas.fill([0.0; 3]);
        for l in &mut self.layers {
            if !l.spec.enabled {
                continue;
            }
            l.fx.render(&ctx, &l.spec.params, &mut l.scratch);
            self.canvas.composite(&l.scratch, l.spec.blend, l.spec.opacity);
        }
        let profile = self.state.profile();
        let global = profile.brightness;
        if self.test.as_ref().is_some_and(|(_, t)| t.elapsed().as_secs_f32() > 3.0) {
            self.test = None;
        }
        let test = self.test.clone();
        for d in &mut self.devices {
            if let Some((id, t)) = test.as_ref().filter(|(id, _)| *id == d.info.id) {
                let _ = id;
                let c = match (t.elapsed().as_secs_f32() as u32).min(2) {
                    0 => Rgb::new(255, 0, 0),
                    1 => Rgb::new(0, 255, 0),
                    _ => Rgb::new(0, 0, 255),
                };
                d.colors.fill(c);
                if d.colors != d.sent {
                    // through apply(): re-asserts the control mode with each colour
                    match self.backends[d.backend].apply(&d.info.id, &d.colors, false) {
                        Ok(()) => {
                            d.sent.clone_from(&d.colors);
                            d.counters.writes += 1;
                            d.counters.last_sent = Some(c.to_hex());
                        }
                        Err(crate::Error::Busy) => d.counters.busy += 1,
                        Err(e) => {
                            d.counters.errors += 1;
                            d.error = Some(e.to_string());
                        }
                    }
                }
                continue;
            }
            let s = profile.devices.get(&d.info.id);
            let k = global * s.map(|s| s.brightness).unwrap_or(1.0);
            let mode = s.map(|s| &s.lighting).unwrap_or(&LightingMode::Engine);
            match mode {
                LightingMode::Engine => {
                    for (c, (u, v)) in d.colors.iter_mut().zip(d.uv.iter()) {
                        let px = self.canvas.sample(*u, *v);
                        *c = Rgb::from_f([px[0] * k, px[1] * k, px[2] * k]);
                    }
                }
                LightingMode::Static { color } => d.colors.fill(color.scale(k)),
                LightingMode::Off => d.colors.fill(Rgb::BLACK),
                LightingMode::Hardware { .. } => continue,
            }
            let stale = d.last_write.is_none_or(|t| t.elapsed() >= KEEPALIVE);
            if d.info.caps.per_led && (d.colors != d.sent || stale) {
                match self.backends[d.backend].write_leds(&d.info.id, &d.colors) {
                    Ok(()) => {
                        d.sent.clone_from(&d.colors);
                        d.last_write = Some(Instant::now());
                        d.error = None;
                        self.writes += 1;
                        d.counters.writes += 1;
                        d.counters.last_sent = d.colors.first().map(|c| c.to_hex());
                    }
                    // still applying the last frame: keep `sent` stale so the
                    // newest colours go out as soon as the device is ready
                    Err(crate::Error::Busy) => d.counters.busy += 1,
                    Err(e) => {
                        d.counters.errors += 1;
                        d.error = Some(e.to_string());
                    }
                }
            }
        }
        self.frames += 1;
        self.frame_time_acc += started.elapsed().as_secs_f32() * 1000.0;
        self.stat_window += dt;
        if self.stat_window >= 1.0 {
            self.stats.fps = self.frames as f32 / self.stat_window;
            self.stats.frame_ms = self.frame_time_acc / self.frames.max(1) as f32;
            self.stats.writes_per_sec = self.writes as f32 / self.stat_window;
            self.frames = 0;
            self.writes = 0;
            self.frame_time_acc = 0.0;
            self.stat_window = 0.0;
        }
    }

    /// Push one device's current colours now, re-sending its control mode
    /// (and storing it on the device when `save`).
    pub fn apply_device(&mut self, id: &str, save: bool) -> crate::Result<()> {
        let d = self.devices.iter_mut().find(|d| d.info.id == id).ok_or_else(|| crate::Error::DeviceNotFound(id.into()))?;
        let r = self.backends[d.backend].apply(&d.info.id, &d.colors, save);
        match &r {
            Ok(()) => {
                d.sent.clone_from(&d.colors);
                d.last_write = Some(Instant::now());
                d.counters.writes += 1;
                d.counters.last_sent = d.colors.first().map(|c| c.to_hex());
                d.error = None;
            }
            Err(e) => {
                d.counters.errors += 1;
                d.error = Some(e.to_string());
            }
        }
        r
    }

    /// `apply_device` for every device; returns the errors by device name.
    pub fn apply_all(&mut self, save: bool) -> Vec<(String, String)> {
        let ids: Vec<(String, String)> = self.devices.iter().filter(|d| d.info.caps.per_led).map(|d| (d.info.id.clone(), d.info.name.clone())).collect();
        ids.into_iter().filter_map(|(id, name)| self.apply_device(&id, save).err().map(|e| (name, e.to_string()))).collect()
    }

    /// Flash one device red, green, blue (a second each), bypassing the
    /// scene, to check the path to the hardware.
    pub fn test_device(&mut self, id: &str) {
        self.test = Some((id.to_string(), Instant::now()));
    }

    pub fn counters(&self, id: &str) -> Option<&Counters> {
        self.devices.iter().find(|d| d.info.id == id).map(|d| &d.counters)
    }

    /// Rescan if any backend reports its device list changed. Returns true
    /// when it did, so the shell can refresh the UI.
    pub fn poll_backends(&mut self) -> bool {
        let mut changed = false;
        for b in &mut self.backends {
            changed |= b.take_changed();
        }
        if changed {
            self.scan();
        }
        changed
    }

    pub fn resize_zone(&mut self, id: &str, zone: usize, size: u32) -> crate::Result<()> {
        let bi = self.devices.iter().find(|d| d.info.id == id).map(|d| d.backend).ok_or_else(|| crate::Error::DeviceNotFound(id.into()))?;
        self.backends[bi].resize_zone(id, zone, size)?;
        // layouts and LED counts change; forget the old placement so the
        // resized device is arranged again at its new size
        self.state.placements.remove(id);
        self.scan();
        Ok(())
    }

    /// Poll batteries and connection state (call every few seconds, not per frame).
    pub fn poll_status(&mut self) {
        for d in &mut self.devices {
            if let Some(s) = self.backends[d.backend].status(&d.info.id) {
                d.status = s;
            }
        }
    }

    pub fn frame(&self, w: usize, h: usize) -> Frame {
        Frame {
            w,
            h,
            canvas: crate::b64::encode(&self.canvas.to_rgb8(w, h, 1.0)),
            devices: self
                .devices
                .iter()
                .map(|d| (d.info.id.clone(), crate::b64::encode(&d.colors.iter().flat_map(|c| [c.r, c.g, c.b]).collect::<Vec<_>>())))
                .collect(),
            stats: self.stats.clone(),
        }
    }

    pub fn devices(&self) -> Vec<DeviceView> {
        let prof = self.state.profile();
        self.devices
            .iter()
            .map(|d| DeviceView {
                info: d.info.clone(),
                placement: self.state.placements.get(&d.info.id).copied().unwrap_or_default(),
                settings: prof.devices.get(&d.info.id).cloned().unwrap_or_else(|| DeviceSettings::for_device(&d.info)),
                status: d.status.clone(),
                error: d.error.clone(),
            })
            .collect()
    }

    pub fn backends(&self) -> Vec<BackendView> {
        self.backends
            .iter()
            .enumerate()
            .map(|(i, b)| BackendView {
                id: b.id(),
                name: b.name(),
                devices: self.devices.iter().filter(|d| d.backend == i).count(),
                error: self.backend_errors[i].clone(),
            })
            .collect()
    }

    pub fn device_colors(&self, id: &str) -> Option<&[Rgb]> {
        self.devices.iter().find(|d| d.info.id == id).map(|d| d.colors.as_slice())
    }

    pub fn stats(&self) -> &Stats {
        &self.stats
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::virtual_rig::VirtualRig;

    fn engine() -> Engine {
        let mut e = Engine::new(State::demo());
        e.add_backend(Box::new(VirtualRig::default()));
        e.scan();
        e
    }

    #[test]
    fn scan_places_and_configures_devices() {
        let e = engine();
        let views = e.devices();
        assert_eq!(views.len(), 10);
        let mouse = views.iter().find(|d| d.info.id == "virtual:mouse").unwrap();
        assert_eq!(mouse.settings.current_dpi(), Some(1600));
        assert_eq!(mouse.settings.polling_rate, Some(8000));
        assert!(e.stats().leds > 150);
    }

    #[test]
    fn solid_scene_reaches_every_led_with_brightness() {
        let mut e = engine();
        let mut layer = LayerSpec::new("a", "solid");
        layer.params.insert("color".into(), crate::params::ParamValue::Text("#ff0000".into()));
        e.set_scene(Scene { layers: vec![layer] });
        e.state.profile_mut().brightness = 0.5;
        e.tick(1.0 / 60.0);
        let kb = e.device_colors("virtual:kb").unwrap();
        assert!(kb.iter().all(|c| *c == Rgb::new(128, 0, 0)));
    }

    #[test]
    fn static_and_off_override_engine() {
        let mut e = engine();
        let mut s = e.devices().into_iter().find(|d| d.info.id == "virtual:pad").unwrap().settings;
        s.lighting = LightingMode::Off;
        e.set_device_settings("virtual:pad", s);
        e.tick(0.016);
        assert!(e.device_colors("virtual:pad").unwrap().iter().all(|c| *c == Rgb::BLACK));
    }

    #[test]
    fn test_pattern_overrides_scene_and_counts_writes() {
        let mut e = engine();
        e.test_device("virtual:pad");
        e.tick(0.016);
        assert!(e.device_colors("virtual:pad").unwrap().iter().all(|c| *c == Rgb::new(255, 0, 0)));
        let c = e.counters("virtual:pad").unwrap();
        assert_eq!(c.writes, 1);
        assert_eq!(c.last_sent.as_deref(), Some("#ff0000"));
    }

    #[test]
    fn static_scene_is_resent_as_keepalive() {
        let mut e = engine();
        let layer = LayerSpec::new("a", "solid");
        e.set_scene(Scene { layers: vec![layer] });
        e.tick(0.016);
        let first = e.counters("virtual:kb").unwrap().writes;
        e.tick(0.016);
        assert_eq!(e.counters("virtual:kb").unwrap().writes, first, "no resend within a second");
        std::thread::sleep(KEEPALIVE + std::time::Duration::from_millis(20));
        e.tick(0.016);
        assert_eq!(e.counters("virtual:kb").unwrap().writes, first + 1, "resent after a second");
    }

    #[test]
    fn profile_switch_changes_scene() {
        let mut e = engine();
        assert!(e.activate_profile("focus"));
        assert_eq!(e.state.profile().scene.layers[0].effect, "breathing");
        assert!(!e.activate_profile("focus"));
        assert!(!e.activate_profile("missing"));
    }

    #[test]
    fn frame_is_well_formed_and_fast() {
        let mut e = engine();
        let t = Instant::now();
        for _ in 0..120 {
            e.press_key(&["W"]);
            e.tick(1.0 / 60.0);
        }
        let per_frame = t.elapsed().as_secs_f32() * 1000.0 / 120.0;
        // debug build; release is ~10x faster. Generous bound to catch regressions.
        assert!(per_frame < 50.0, "frame took {per_frame} ms");
        let f = e.frame(96, 60);
        assert_eq!(f.canvas.len(), (96 * 60 * 3usize).div_ceil(3) * 4);
        assert_eq!(f.devices.len(), 10);
    }
}
