//! Scenes, profiles and the persisted app state.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::canvas::Blend;
use crate::device::DeviceSettings;
use crate::layout::Placement;
use crate::macros::Macro;
use crate::params::Params;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LayerSpec {
    pub id: String,
    pub effect: String,
    #[serde(default)]
    pub params: Params,
    #[serde(default)]
    pub blend: Blend,
    pub opacity: f32,
    pub enabled: bool,
}

impl LayerSpec {
    pub fn new(id: &str, effect: &str) -> Self {
        let params = crate::effects::info(effect).map(|i| crate::params::defaults(&i.params)).unwrap_or_default();
        Self { id: id.into(), effect: effect.into(), params, blend: Blend::Normal, opacity: 1.0, enabled: true }
    }
}

/// A lighting scene: a stack of effect layers, bottom first.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Scene {
    pub layers: Vec<LayerSpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Executable names that activate this profile when focused/running.
    #[serde(default)]
    pub apps: Vec<String>,
    pub scene: Scene,
    #[serde(default)]
    pub devices: BTreeMap<String, DeviceSettings>,
    pub brightness: f32,
    /// Accent shown in the UI.
    #[serde(default = "default_accent")]
    pub accent: String,
}

fn default_accent() -> String {
    "#7c5cff".into()
}

/// Missing fields take their defaults, so older state files keep loading
/// as settings are added.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub fps: u32,
    /// Start (and stop) the bundled OpenRGB server together with QUASAR.
    pub openrgb_managed: bool,
    pub auto_update_check: bool,
    pub openrgb_enabled: bool,
    pub openrgb_host: String,
    pub openrgb_port: u16,
    pub hid_enabled: bool,
    pub demo_rig: bool,
    pub auto_switch: bool,
    pub gsi_enabled: bool,
    pub gsi_port: u16,
    pub audio_enabled: bool,
    pub screen_enabled: bool,
    pub keys_enabled: bool,
    pub start_minimized: bool,
    pub launch_at_login: bool,
    /// Dim everything after this many idle minutes (0 = never).
    pub idle_dim_minutes: u32,
    pub reduce_motion: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            fps: 60,
            openrgb_managed: true,
            auto_update_check: true,
            openrgb_enabled: true,
            openrgb_host: "127.0.0.1".into(),
            openrgb_port: crate::backends::openrgb::DEFAULT_PORT,
            hid_enabled: true,
            demo_rig: true,
            auto_switch: true,
            gsi_enabled: true,
            gsi_port: 3077,
            audio_enabled: true,
            screen_enabled: true,
            keys_enabled: true,
            start_minimized: false,
            launch_at_login: false,
            idle_dim_minutes: 0,
            reduce_motion: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct State {
    pub version: u32,
    pub profiles: Vec<Profile>,
    pub active_profile: String,
    #[serde(default)]
    pub placements: BTreeMap<String, Placement>,
    #[serde(default)]
    pub macros: Vec<Macro>,
    #[serde(default)]
    pub settings: Settings,
}

/// Current state file version. 2 dropped the demo rig and sample data.
pub const STATE_VERSION: u32 = 2;

impl Default for State {
    /// A clean install: one profile, real hardware only, no sample macros.
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            profiles: vec![Profile {
                id: "default".into(),
                name: "Default".into(),
                apps: vec![],
                // no keystroke layer by default: that needs a global keyboard
                // hook, which QUASAR only installs when a scene asks for it
                scene: Scene { layers: vec![LayerSpec::new("l1", "nebula")] },
                devices: BTreeMap::new(),
                brightness: 0.9,
                accent: "#2ee6ff".into(),
            }],
            active_profile: "default".into(),
            placements: BTreeMap::new(),
            macros: Vec::new(),
            settings: Settings { demo_rig: false, ..Settings::default() },
        }
    }
}

impl State {
    /// The showcase state used by the browser demo and tests: preset
    /// profiles and example macros. Never written to a user's disk.
    pub fn demo() -> Self {
        let mut s = State::default();
        let mut ripple = LayerSpec::new("l2", "ripple");
        ripple.blend = Blend::Screen;
        ripple.params.insert("bg".into(), crate::params::ParamValue::Text("#000000".into()));
        ripple.params.insert("idle".into(), crate::params::ParamValue::Bool(false));
        s.profiles[0].scene.layers.push(ripple);
        s.profiles[0].name = "Nebula".into();
        s.profiles[0].accent = "#7c5cff".into();
        let scene = |layers: Vec<LayerSpec>| Scene { layers };
        let preset = |id: &str, name: &str, apps: &[&str], fx: &str, b: f32, accent: &str| Profile {
            id: id.into(),
            name: name.into(),
            apps: apps.iter().map(|a| a.to_string()).collect(),
            scene: scene(vec![LayerSpec::new("l1", fx)]),
            devices: BTreeMap::new(),
            brightness: b,
            accent: accent.into(),
        };
        s.profiles.push(preset("fps", "Competitive", &["cs2.exe"], "game-pulse", 1.0, "#ff3db8"));
        s.profiles.push(preset("focus", "Focus", &["Code.exe"], "breathing", 0.5, "#2ee6ff"));
        s.profiles.push(preset("movie", "Cinema", &["vlc.exe"], "ambience", 0.8, "#ffb547"));
        s.macros = crate::macros::examples();
        s.settings.demo_rig = true;
        s
    }

    /// Bring an older state file up to date.
    fn migrate(mut self) -> Self {
        if self.version < 2 {
            // 0.1.0 shipped with the simulated rig on and sample macros
            self.settings.demo_rig = false;
            self.placements.retain(|id, _| !id.starts_with("virtual:"));
            for p in &mut self.profiles {
                p.devices.retain(|id, _| !id.starts_with("virtual:"));
            }
            self.macros.retain(|m| m.id != "m-gg" && m.id != "m-burst");
        }
        self.version = STATE_VERSION;
        self
    }

    pub fn load(path: &Path) -> Self {
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<State>(&b).ok()).map(State::migrate).unwrap_or_default()
    }

    /// Atomic write: temp file then rename, so a crash never leaves half a file.
    pub fn save(&self, path: &Path) -> crate::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    pub fn profile(&self) -> &Profile {
        self.profiles.iter().find(|p| p.id == self.active_profile).unwrap_or(&self.profiles[0])
    }

    pub fn profile_mut(&mut self) -> &mut Profile {
        let id = self.active_profile.clone();
        let i = self.profiles.iter().position(|p| p.id == id).unwrap_or(0);
        &mut self.profiles[i]
    }

    /// Profile whose app list matches any of `running` (case-insensitive).
    pub fn match_app<'a>(&self, running: impl IntoIterator<Item = &'a str>) -> Option<&Profile> {
        let running: Vec<String> = running.into_iter().map(|s| s.to_ascii_lowercase()).collect();
        self.profiles.iter().find(|p| p.apps.iter().any(|a| running.contains(&a.to_ascii_lowercase())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_roundtrips_through_disk() {
        let dir = std::env::temp_dir().join(format!("quasar-test-{}", std::process::id()));
        let path = dir.join("state.json");
        let s = State::default();
        s.save(&path).unwrap();
        assert_eq!(State::load(&path), s);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn app_matching_is_case_insensitive() {
        let s = State::demo();
        assert_eq!(s.match_app(["explorer.exe", "CS2.EXE"]).unwrap().id, "fps");
        assert!(State::default().macros.is_empty() && !State::default().settings.demo_rig);
        assert!(s.match_app(["explorer.exe"]).is_none());
    }

    #[test]
    fn migrates_v1_demo_data_away() {
        let mut old = State::demo();
        old.version = 1;
        old.placements.insert("virtual:kb".into(), Default::default());
        old.placements.insert("openrgb:real".into(), Default::default());
        let m = old.migrate();
        assert_eq!(m.version, STATE_VERSION);
        assert!(!m.settings.demo_rig);
        assert!(m.macros.is_empty());
        assert_eq!(m.placements.keys().collect::<Vec<_>>(), vec!["openrgb:real"]);
    }

    #[test]
    fn settings_tolerate_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"fps":30}"#).unwrap();
        assert_eq!(s.fps, 30);
        assert!(s.openrgb_managed && s.auto_update_check);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("quasar-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("state.json");
        std::fs::write(&path, b"{not json").unwrap();
        assert_eq!(State::load(&path), State::default());
        std::fs::remove_dir_all(dir).ok();
    }
}
