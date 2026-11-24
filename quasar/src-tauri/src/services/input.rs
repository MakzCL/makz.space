//! Global input: key presses feed reactive lighting, macro recording, and
//! (Windows/macOS) remapping through a grab hook.

use std::time::Instant;

use enigo::{Direction, Enigo, Keyboard, Mouse, Settings};
use quasar_core::device::Binding;
use quasar_core::macros::{Macro, Repeat, Step};
use quasar_core::remap::{Action, Remapper};
use rdev::{Event, EventType};

use crate::{keys, App};

pub struct Recording {
    steps: Vec<Step>,
    last: Instant,
}

impl Default for Recording {
    fn default() -> Self {
        Self { steps: Vec::new(), last: Instant::now() }
    }
}

impl Recording {
    fn push(&mut self, s: Step) {
        let ms = self.last.elapsed().as_millis() as u32;
        self.last = Instant::now();
        if !self.steps.is_empty() {
            self.steps.push(Step::Delay { ms });
        }
        self.steps.push(s);
    }
    pub fn finish(self) -> Vec<Step> {
        Macro::tidy(self.steps, 8)
    }
}

fn button_name(b: &rdev::Button) -> String {
    match b {
        rdev::Button::Left => "Left".into(),
        rdev::Button::Right => "Right".into(),
        rdev::Button::Middle => "Middle".into(),
        rdev::Button::Unknown(1) => "Back".into(),
        rdev::Button::Unknown(2) => "Forward".into(),
        rdev::Button::Unknown(n) => format!("Button {n}"),
    }
}

/// Bindings of every device in the active profile, merged. Hooks are global,
/// so a binding applies to that key or button whichever device sent it.
fn remapper(app: &App) -> Remapper {
    let e = app.engine.lock();
    let mut primary = std::collections::BTreeMap::new();
    let mut overdrive = std::collections::BTreeMap::new();
    for s in e.state.profile().devices.values() {
        primary.extend(s.bindings.iter().map(|(k, v)| (k.clone(), v.clone())));
        overdrive.extend(s.overdrive.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
    Remapper::new(primary, overdrive)
}

/// Handle one event; return false to swallow it (grab mode only).
fn on_event(app: &App, remap: &mut Remapper, ev: &Event) -> bool {
    let (key, down) = match &ev.event_type {
        EventType::KeyPress(k) => (keys::labels(k).first().map(|s| s.to_string()), true),
        EventType::KeyRelease(k) => (keys::labels(k).first().map(|s| s.to_string()), false),
        EventType::ButtonPress(b) => (Some(button_name(b)), true),
        EventType::ButtonRelease(b) => (Some(button_name(b)), false),
        _ => return true,
    };
    let Some(key) = key else { return true };
    if let Some(rec) = app.recording.lock().as_mut() {
        let is_button = matches!(ev.event_type, EventType::ButtonPress(_) | EventType::ButtonRelease(_));
        rec.push(match (is_button, down) {
            (false, true) => Step::KeyDown { key: key.clone() },
            (false, false) => Step::KeyUp { key: key.clone() },
            (true, true) => Step::MouseDown { button: key.clone() },
            (true, false) => Step::MouseUp { button: key.clone() },
        });
        return true;
    }
    if down {
        if let EventType::KeyPress(k) = &ev.event_type {
            if app.engine.lock().state.settings.keys_enabled {
                app.engine.lock().press_key(keys::labels(k));
            }
        }
    }
    match remap.resolve(&key, down) {
        Action::Pass => true,
        Action::Block => false,
        Action::Do(b) => {
            if down {
                perform(app, b);
            }
            false
        }
    }
}

fn perform(app: &App, b: Binding) {
    match b {
        Binding::Macro { id } => {
            if let Some(m) = app.engine.lock().state.macros.iter().find(|m| m.id == id).cloned() {
                play(m);
            }
        }
        Binding::DpiUp | Binding::DpiDown | Binding::DpiCycle => {
            let mut e = app.engine.lock();
            let ids: Vec<String> = e.devices().into_iter().filter(|d| d.info.caps.dpi.is_some()).map(|d| d.info.id).collect();
            for id in ids {
                let mut s = e.state.profile().devices.get(&id).cloned().unwrap_or_default();
                let n = s.dpi_stages.len().max(1);
                s.active_stage = match b {
                    Binding::DpiUp => (s.active_stage + 1).min(n - 1),
                    Binding::DpiDown => s.active_stage.saturating_sub(1),
                    _ => (s.active_stage + 1) % n,
                };
                e.set_device_settings(&id, s);
            }
            drop(e);
            app.touch();
        }
        Binding::ProfileNext => {
            let mut e = app.engine.lock();
            let ps = &e.state.profiles;
            let i = ps.iter().position(|p| p.id == e.state.active_profile).unwrap_or(0);
            let next = ps[(i + 1) % ps.len()].id.clone();
            e.activate_profile(&next);
            *app.base_profile.lock() = next;
            drop(e);
            app.touch();
        }
        Binding::Launch { path } => {
            let _ = std::process::Command::new(path).spawn();
        }
        other => {
            std::thread::spawn(move || {
                let Ok(mut en) = Enigo::new(&Settings::default()) else { return };
                match other {
                    Binding::Key { key, modifiers } => {
                        let mods: Vec<_> = modifiers.iter().filter_map(|m| keys::to_enigo(m)).collect();
                        for m in &mods {
                            let _ = en.key(*m, Direction::Press);
                        }
                        if let Some(k) = keys::to_enigo(&key) {
                            let _ = en.key(k, Direction::Click);
                        }
                        for m in mods.iter().rev() {
                            let _ = en.key(*m, Direction::Release);
                        }
                    }
                    Binding::Media { action } => {
                        if let Some(k) = keys::to_enigo(&action) {
                            let _ = en.key(k, Direction::Click);
                        }
                    }
                    Binding::Text { text } => {
                        let _ = en.text(&text);
                    }
                    Binding::Mouse { button } => {
                        let _ = en.button(mouse(&button), Direction::Click);
                    }
                    _ => {}
                }
            });
        }
    }
}

fn mouse(name: &str) -> enigo::Button {
    match name {
        "Right" => enigo::Button::Right,
        "Middle" => enigo::Button::Middle,
        "Back" => enigo::Button::Back,
        "Forward" => enigo::Button::Forward,
        _ => enigo::Button::Left,
    }
}

/// Play a macro on its own thread.
pub fn play(m: Macro) {
    std::thread::spawn(move || {
        let Ok(mut en) = Enigo::new(&Settings::default()) else { return };
        let times = match m.repeat {
            Repeat::Times { n } => n.clamp(1, 100),
            _ => 1,
        };
        for _ in 0..times {
            for s in &m.steps {
                match s {
                    Step::KeyDown { key } => {
                        if let Some(k) = keys::to_enigo(key) {
                            let _ = en.key(k, Direction::Press);
                        }
                    }
                    Step::KeyUp { key } => {
                        if let Some(k) = keys::to_enigo(key) {
                            let _ = en.key(k, Direction::Release);
                        }
                    }
                    Step::MouseDown { button } => {
                        let _ = en.button(mouse(button), Direction::Press);
                    }
                    Step::MouseUp { button } => {
                        let _ = en.button(mouse(button), Direction::Release);
                    }
                    Step::Delay { ms } => std::thread::sleep(std::time::Duration::from_millis(*ms as u64)),
                    Step::Text { text } => {
                        let _ = en.text(text);
                    }
                }
            }
        }
    });
}

#[cfg(any(windows, target_os = "macos"))]
pub fn run(app: App) {
    // grab takes an `Fn`, so the remapper lives behind a lock. It is rebuilt
    // at most once a second so binding edits apply without a restart.
    let state = parking_lot::Mutex::new((remapper(&app), Instant::now()));
    let res = rdev::grab(move |ev| {
        let mut st = state.lock();
        if st.1.elapsed().as_millis() > 1000 {
            *st = (remapper(&app), Instant::now());
        }
        on_event(&app, &mut st.0, &ev).then_some(ev)
    });
    if let Err(e) = res {
        log::warn!("input hook unavailable: {e:?}");
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn run(app: App) {
    let mut remap = remapper(&app);
    let mut built = Instant::now();
    let res = rdev::listen(move |ev| {
        if built.elapsed().as_millis() > 1000 {
            remap = remapper(&app);
            built = Instant::now();
        }
        // Listen-only: remapped actions still fire, the original key does too.
        on_event(&app, &mut remap, &ev);
    });
    if let Err(e) = res {
        log::warn!("input hook unavailable: {e:?}");
    }
}
