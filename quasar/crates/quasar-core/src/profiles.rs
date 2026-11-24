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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub fps: u32,
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

impl Default for State {
    fn default() -> Self {
        let scene = |layers: Vec<LayerSpec>| Scene { layers };
        let mut ripple = LayerSpec::new("l2", "ripple");
        ripple.blend = Blend::Screen;
        ripple.params.insert("bg".into(), crate::params::ParamValue::Text("#000000".into()));
        ripple.params.insert("idle".into(), crate::params::ParamValue::Bool(false));
        let profiles = vec![
            Profile {
                id: "default".into(),
                name: "Nebula".into(),
                apps: vec![],
                scene: scene(vec![LayerSpec::new("l1", "nebula"), ripple]),
                devices: BTreeMap::new(),
                brightness: 0.9,
                accent: "#7c5cff".into(),
            },
            Profile {
                id: "fps".into(),
                name: "Competitive".into(),
                apps: vec!["cs2.exe".into(), "VALORANT-Win64-Shipping.exe".into()],
                scene: scene(vec![LayerSpec::new("l1", "game-pulse")]),
                devices: BTreeMap::new(),
                brightness: 1.0,
                accent: "#ff3db8".into(),
            },
            Profile {
                id: "focus".into(),
                name: "Focus".into(),
                apps: vec!["Code.exe".into(), "figma.exe".into()],
                scene: scene(vec![LayerSpec::new("l1", "breathing")]),
                devices: BTreeMap::new(),
                brightness: 0.5,
                accent: "#2ee6ff".into(),
            },
            Profile {
                id: "movie".into(),
                name: "Cinema".into(),
                apps: vec!["vlc.exe".into(), "mpv.exe".into()],
                scene: scene(vec![LayerSpec::new("l1", "ambience")]),
                devices: BTreeMap::new(),
                brightness: 0.8,
                accent: "#ffb547".into(),
            },
        ];
        Self {
            version: 1,
            profiles,
            active_profile: "default".into(),
            placements: BTreeMap::new(),
            macros: crate::macros::examples(),
            settings: Settings::default(),
        }
    }
}

impl State {
    pub fn load(path: &Path) -> Self {
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
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
        let s = State::default();
        assert_eq!(s.match_app(["explorer.exe", "CS2.EXE"]).unwrap().id, "fps");
        assert!(s.match_app(["explorer.exe"]).is_none());
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
