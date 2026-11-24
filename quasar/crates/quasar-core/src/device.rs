//! The device model shared by every backend and the UI.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::color::Rgb;
use crate::layout::Layout;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum DeviceKind {
    Keyboard,
    Mouse,
    Mousepad,
    Headset,
    HeadsetStand,
    Keypad,
    Controller,
    Speaker,
    Microphone,
    Fan,
    LedStrip,
    Motherboard,
    Gpu,
    Ram,
    Cooler,
    Case,
    Light,
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DpiCaps {
    pub min: u32,
    pub max: u32,
    pub step: u32,
    pub max_stages: u8,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Capabilities {
    /// The device takes per-LED colour from the engine.
    pub per_led: bool,
    pub dpi: Option<DpiCaps>,
    #[serde(default)]
    pub polling_rates: Vec<u32>,
    pub battery: bool,
    /// Buttons or keys that can be rebound, by label.
    #[serde(default)]
    pub remappable: Vec<String>,
    pub lift_off: bool,
    pub brightness: bool,
    /// Built-in hardware effects (when the engine is not driving it).
    #[serde(default)]
    pub hardware_modes: Vec<String>,
    pub onboard_profiles: u8,
    /// Fans and pumps whose speed can be set, 0..100.
    pub fan_control: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DeviceInfo {
    /// Stable across reboots: `backend:vendor:product:serial-or-index`.
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub kind: DeviceKind,
    pub backend: String,
    #[serde(default)]
    pub firmware: Option<String>,
    #[serde(default)]
    pub serial: Option<String>,
    pub layout: Layout,
    pub caps: Capabilities,
    /// Simulated hardware, shown with a badge in the UI.
    #[serde(default)]
    pub virtual_device: bool,
    /// Lighting zones as the driver reports them. Zones whose size can be
    /// set (motherboard ARGB headers) have `min < max`.
    #[serde(default)]
    pub zones: Vec<ZoneInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ZoneInfo {
    pub name: String,
    pub count: u32,
    pub min: u32,
    pub max: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DpiStage {
    pub dpi: u32,
    #[serde(default)]
    pub dpi_y: Option<u32>,
    pub color: Rgb,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Binding {
    Default,
    Disabled,
    Key { key: String, #[serde(default)] modifiers: Vec<String> },
    Mouse { button: String },
    Macro { id: String },
    DpiUp,
    DpiDown,
    DpiCycle,
    /// Hold to temporarily switch to the given DPI (sniper).
    DpiClutch { dpi: u32 },
    ProfileNext,
    Media { action: String },
    Launch { path: String },
    Text { text: String },
    /// Hold to switch every binding to its secondary layer.
    Overdrive,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum LightingMode {
    /// Driven by the canvas.
    Engine,
    Static { color: Rgb },
    Hardware { effect: String },
    Off,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DeviceSettings {
    #[serde(default)]
    pub dpi_stages: Vec<DpiStage>,
    #[serde(default)]
    pub active_stage: usize,
    #[serde(default)]
    pub polling_rate: Option<u32>,
    #[serde(default)]
    pub lift_off_mm: Option<f32>,
    /// 0..1, multiplies engine output for this device.
    pub brightness: f32,
    pub lighting: LightingMode,
    /// Primary layer bindings by key/button label.
    #[serde(default)]
    pub bindings: BTreeMap<String, Binding>,
    /// Secondary (Overdrive) layer.
    #[serde(default)]
    pub overdrive: BTreeMap<String, Binding>,
    /// Fan or pump duty 0..100 or `None` for automatic.
    #[serde(default)]
    pub fan_duty: Option<u8>,
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            dpi_stages: Vec::new(),
            active_stage: 0,
            polling_rate: None,
            lift_off_mm: None,
            brightness: 1.0,
            lighting: LightingMode::Engine,
            bindings: BTreeMap::new(),
            overdrive: BTreeMap::new(),
            fan_duty: None,
        }
    }
}

impl DeviceSettings {
    /// Sensible defaults for a freshly discovered device.
    pub fn for_device(info: &DeviceInfo) -> Self {
        let mut s = Self::default();
        if let Some(d) = &info.caps.dpi {
            let palette = ["#ff3db8", "#ffb547", "#2eff8c", "#2ee6ff", "#7c5cff"];
            s.dpi_stages = [400, 800, 1600, 3200, 6400]
                .iter()
                .filter(|v| **v >= d.min && **v <= d.max)
                .take(d.max_stages as usize)
                .enumerate()
                .map(|(i, v)| DpiStage { dpi: *v, dpi_y: None, color: Rgb::from_hex(palette[i % 5]).unwrap() })
                .collect();
            s.active_stage = 2.min(s.dpi_stages.len().saturating_sub(1));
        }
        s.polling_rate = info.caps.polling_rates.iter().copied().max();
        if !info.caps.per_led {
            // devices that keep one stored colour cannot follow the canvas
            s.lighting = LightingMode::Static { color: Rgb::new(0x7c, 0x5c, 0xff) };
        }
        if info.caps.lift_off {
            s.lift_off_mm = Some(1.0);
        }
        s
    }

    pub fn current_dpi(&self) -> Option<u32> {
        self.dpi_stages.get(self.active_stage).map(|s| s.dpi)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct DeviceStatus {
    pub connected: bool,
    pub battery: Option<u8>,
    pub charging: bool,
}
