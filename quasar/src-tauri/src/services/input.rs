//! Global input: key presses feed reactive lighting, macro recording, and
//! (Windows/macOS) remapping through a grab hook.

use std::time::Instant;

use enigo::{Direction, Enigo, Keyboard, Mouse, Settings};
use quasar_core::device::Binding;
use quasar_core::macros::{Hotkey, Macro, Repeat, Step};
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};

use parking_lot::Mutex;
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
/// Keys and buttons currently held (to tell auto-repeat from a new press).
static DOWN: LazyLock<Mutex<BTreeSet<String>>> = LazyLock::new(Default::default);
/// Hotkey presses we swallowed, so their release is swallowed too.
static SWALLOWED: LazyLock<Mutex<BTreeSet<String>>> = LazyLock::new(Default::default);
/// Macros running until stopped: toggles by macro id, while-held by key.
static RUNNING: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(Default::default);
static HELD: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(Default::default);
/// > 0 while a macro is typing: its own events must not trigger anything.
static INJECTING: AtomicUsize = AtomicUsize::new(0);

/// Start a macro as its repeat mode says, in response to `key`.
fn trigger(m: Macro, key: &str) {
    match m.repeat {
        Repeat::Toggle => {
            if let Some(flag) = RUNNING.lock().remove(&m.id) {
                flag.store(true, Ordering::Relaxed);
                return;
            }
            let flag = Arc::new(AtomicBool::new(false));
            RUNNING.lock().insert(m.id.clone(), flag.clone());
            run_macro(m, Some(flag));
        }
        Repeat::WhileHeld => {
            if HELD.lock().contains_key(key) {
                return;
            }
            let flag = Arc::new(AtomicBool::new(false));
            HELD.lock().insert(key.to_string(), flag.clone());
            run_macro(m, Some(flag));
        }
        _ => run_macro(m, None),
    }
}

fn on_event(app: &App, remap: &mut Remapper, ev: &Event) -> bool {
    let (key, down) = match &ev.event_type {
        EventType::KeyPress(k) => (keys::labels(k).first().map(|s| s.to_string()), true),
        EventType::KeyRelease(k) => (keys::labels(k).first().map(|s| s.to_string()), false),
        EventType::ButtonPress(b) => (Some(button_name(b)), true),
        EventType::ButtonRelease(b) => (Some(button_name(b)), false),
        _ => return true,
    };
    let Some(key) = key else { return true };
    let repeat = {
        let mut d = DOWN.lock();
        if down {
            !d.insert(key.clone())
        } else {
            d.remove(&key);
            false
        }
    };
    if !down {
        // releasing a while-held macro's key stops it
        if let Some(flag) = HELD.lock().remove(&key) {
            flag.store(true, Ordering::Relaxed);
        }
        if SWALLOWED.lock().remove(&key) {
            return false;
        }
    }
    let injecting = INJECTING.load(Ordering::Relaxed) > 0;
    if down && !injecting && app.recording.lock().is_none() && Hotkey::canonical(&key).is_none() {
        let held: Vec<String> = DOWN.lock().iter().filter(|k| Hotkey::canonical(k).is_some()).cloned().collect();
        let held: Vec<&str> = held.iter().map(|s| s.as_str()).collect();
        let hit = app.engine.lock().state.macros.iter().find(|m| m.hotkey.as_ref().is_some_and(|h| h.matches(&key, &held))).cloned();
        if let Some(m) = hit {
            SWALLOWED.lock().insert(key.clone());
            if !repeat {
                trigger(m, &key);
            }
            return false;
        }
    }
    if injecting {
        return true;
    }
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
            if down && !repeat {
                perform(app, b, &key);
            }
            false
        }
    }
}

fn perform(app: &App, b: Binding, key: &str) {
    match b {
        Binding::Macro { id } => {
            if let Some(m) = app.engine.lock().state.macros.iter().find(|m| m.id == id).cloned() {
                trigger(m, key);
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

/// Play a macro once (or N times), as the Macros page's Play button does.
pub fn play(m: Macro) {
    run_macro(m, None);
}

/// Run a macro on its own thread. With `stop`, loop until it is set (toggle
/// and while-held); otherwise once or N times.
fn run_macro(m: Macro, stop: Option<Arc<AtomicBool>>) {
    std::thread::spawn(move || {
        let Ok(mut en) = Enigo::new(&Settings::default()) else { return };
        INJECTING.fetch_add(1, Ordering::Relaxed);
        let stopped = || stop.as_ref().is_some_and(|f| f.load(Ordering::Relaxed));
        let times = match (&m.repeat, &stop) {
            (_, Some(_)) => u32::MAX,
            (Repeat::Times { n }, None) => (*n).clamp(1, 100),
            _ => 1,
        };
        // a looping macro with no delay would flood the system
        let has_delay = m.steps.iter().any(|s| matches!(s, Step::Delay { ms } if *ms > 0));
        'outer: for _ in 0..times {
            for s in &m.steps {
                if stopped() {
                    break 'outer;
                }
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
                    Step::Delay { ms } => {
                        // sleep in slices so a stop is honoured quickly
                        let mut left = *ms as u64;
                        while left > 0 && !stopped() {
                            let n = left.min(25);
                            std::thread::sleep(std::time::Duration::from_millis(n));
                            left -= n;
                        }
                    }
                    Step::Text { text } => {
                        let _ = en.text(text);
                    }
                }
            }
            if stop.is_some() && !has_delay {
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
        }
        INJECTING.fetch_sub(1, Ordering::Relaxed);
        if let Some(own) = &stop {
            RUNNING.lock().retain(|_, f| !Arc::ptr_eq(f, own));
        }
    });
}

/// The global hook is only installed once a feature needs it: a
/// keystroke-reactive layer, a remapped key or button, or macro recording.
/// Until then QUASAR never sees a keypress.
fn needed(app: &App) -> bool {
    let wants_keys = {
        let e = app.engine.lock();
        let p = e.state.profile();
        let reactive = e.state.settings.keys_enabled && p.scene.layers.iter().any(|l| l.enabled && l.effect == "ripple");
        let bindings = e.state.profiles.iter().any(|p| p.devices.values().any(|d| !d.bindings.is_empty() || !d.overdrive.is_empty()));
        let hotkeys = e.state.macros.iter().any(|m| m.hotkey.is_some());
        reactive || bindings || hotkeys
    };
    wants_keys || app.recording.lock().is_some()
}

pub fn run(app: App) {
    while !needed(&app) {
        std::thread::sleep(std::time::Duration::from_millis(750));
    }
    hook(app);
}

#[cfg(any(windows, target_os = "macos"))]
fn hook(app: App) {
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
fn hook(app: App) {
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
