//! A simulated rig from several brands. It renders exactly like hardware in
//! the UI, which is how the app is demoed and how layouts are designed
//! before the parts arrive.

use std::collections::BTreeMap;

use super::Backend;
use crate::color::Rgb;
use crate::device::{Capabilities, DeviceInfo, DeviceKind, DeviceSettings, DeviceStatus, DpiCaps};
use crate::layout::{Layout, Led};
use crate::Result;

#[derive(Default)]
pub struct VirtualRig {
    pub frames: BTreeMap<String, Vec<Rgb>>,
    pub applied: BTreeMap<String, DeviceSettings>,
}

const U: f32 = 19.05;

pub fn keyboard_layout() -> Layout {
    let f = |s: &'static str| (s, 1.0);
    let main: &[&[(&str, f32)]] = &[
        &[f("Esc"), ("", 1.0), f("F1"), f("F2"), f("F3"), f("F4"), ("", 0.5), f("F5"), f("F6"), f("F7"), f("F8"), ("", 0.5), f("F9"), f("F10"), f("F11"), f("F12"), ("", 0.25), f("PrtSc"), f("ScrLk"), f("Pause")],
        &[f("`"), f("1"), f("2"), f("3"), f("4"), f("5"), f("6"), f("7"), f("8"), f("9"), f("0"), f("-"), f("="), ("Backspace", 2.0), ("", 0.25), f("Ins"), f("Home"), f("PgUp"), ("", 0.25), f("NumLk"), f("Num/"), f("Num*"), f("Num-")],
        &[("Tab", 1.5), f("Q"), f("W"), f("E"), f("R"), f("T"), f("Y"), f("U"), f("I"), f("O"), f("P"), f("["), f("]"), ("\\", 1.5), ("", 0.25), f("Del"), f("End"), f("PgDn"), ("", 0.25), f("Num7"), f("Num8"), f("Num9"), f("Num+")],
        &[("Caps", 1.75), f("A"), f("S"), f("D"), f("F"), f("G"), f("H"), f("J"), f("K"), f("L"), f(";"), f("'"), ("Enter", 2.25), ("", 3.5), f("Num4"), f("Num5"), f("Num6")],
        &[("LShift", 2.25), f("Z"), f("X"), f("C"), f("V"), f("B"), f("N"), f("M"), f(","), f("."), f("/"), ("RShift", 2.75), ("", 1.25), f("Up"), ("", 1.25), f("Num1"), f("Num2"), f("Num3"), f("NumEnter")],
        &[("LCtrl", 1.25), ("Win", 1.25), ("LAlt", 1.25), ("Space", 6.25), ("RAlt", 1.25), ("Fn", 1.25), ("Menu", 1.25), ("RCtrl", 1.25), ("", 0.25), f("Left"), f("Down"), f("Right"), ("", 0.25), ("Num0", 2.0), f("Num.")],
    ];
    Layout::keyboard(main, U)
}

fn mouse_layout() -> Layout {
    let led = |x, y, l: &str, w, h| Led { x, y, label: Some(l.into()), w: Some(w), h: Some(h) };
    Layout {
        width: 68.0,
        height: 126.0,
        leds: vec![
            led(34.0, 26.0, "Scroll", 8.0, 18.0),
            led(34.0, 92.0, "Logo", 20.0, 20.0),
            led(4.0, 40.0, "Left 1", 4.0, 16.0),
            led(3.0, 60.0, "Left 2", 4.0, 16.0),
            led(4.0, 80.0, "Left 3", 4.0, 16.0),
            led(64.0, 40.0, "Right 1", 4.0, 16.0),
            led(65.0, 60.0, "Right 2", 4.0, 16.0),
            led(64.0, 80.0, "Right 3", 4.0, 16.0),
        ],
    }
}

fn mousepad_layout() -> Layout {
    // LEDs around the edge of a 360 x 280 mat
    let (w, h, n) = (360.0, 280.0, 15);
    let mut leds = Vec::new();
    for i in 0..n {
        leds.push(Layout::led(w * (i as f32 + 0.5) / n as f32, 3.0));
    }
    for i in 0..5 {
        leds.push(Layout::led(w - 3.0, h * (i as f32 + 0.5) / 5.0));
    }
    Layout { width: w, height: h, leds }
}

fn headset_layout() -> Layout {
    Layout {
        width: 180.0,
        height: 190.0,
        leds: vec![
            Led { x: 18.0, y: 150.0, label: Some("Left cup".into()), w: Some(30.0), h: Some(50.0) },
            Led { x: 162.0, y: 150.0, label: Some("Right cup".into()), w: Some(30.0), h: Some(50.0) },
        ],
    }
}

fn gpu_layout() -> Layout {
    let mut l = Layout::strip(18, 300.0);
    l.height = 40.0;
    for led in &mut l.leds {
        led.y = 6.0;
    }
    l
}

fn ram_layout() -> Layout {
    let mut l = Layout { width: 8.0, height: 40.0, leds: Vec::new() };
    for i in 0..8 {
        l.leds.push(Layout::led(4.0, 2.5 + i as f32 * 5.0));
    }
    l
}

fn mouse_caps() -> Capabilities {
    Capabilities {
        per_led: true,
        dpi: Some(DpiCaps { min: 100, max: 30000, step: 50, max_stages: 5 }),
        polling_rates: vec![125, 500, 1000, 2000, 4000, 8000],
        battery: true,
        remappable: ["Left", "Right", "Middle", "Back", "Forward", "Scroll up", "Scroll down", "DPI up", "DPI down", "Sniper"]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        lift_off: true,
        brightness: true,
        hardware_modes: vec!["static".into(), "breathing".into(), "spectrum".into()],
        onboard_profiles: 5,
        fan_control: false,
    }
}

pub fn devices() -> Vec<DeviceInfo> {
    let kb = keyboard_layout();
    let kb_keys: Vec<String> = kb.leds.iter().filter_map(|l| l.label.clone()).collect();
    let rgb_only = |modes: &[&str]| Capabilities {
        per_led: true,
        brightness: true,
        hardware_modes: modes.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    };
    let dev = |id: &str, name: &str, vendor: &str, kind, layout, caps| DeviceInfo {
        id: format!("virtual:{id}"),
        name: name.into(),
        vendor: vendor.into(),
        kind,
        backend: "virtual".into(),
        firmware: Some("1.0.4".into()),
        serial: Some(format!("QSR-{}", id.to_uppercase())),
        layout,
        caps,
        virtual_device: true,
    };
    vec![
        dev(
            "kb",
            "Mechanical Keyboard TKL+",
            "Razer",
            DeviceKind::Keyboard,
            kb,
            Capabilities {
                per_led: true,
                polling_rates: vec![125, 500, 1000, 8000],
                remappable: kb_keys,
                brightness: true,
                hardware_modes: vec!["static".into(), "wave".into(), "reactive".into()],
                onboard_profiles: 3,
                ..Default::default()
            },
        ),
        dev("mouse", "Ergonomic Wireless Mouse", "Logitech", DeviceKind::Mouse, mouse_layout(), mouse_caps()),
        dev("pad", "Desk Mat XL", "SteelSeries", DeviceKind::Mousepad, mousepad_layout(), rgb_only(&["static", "wave"])),
        dev(
            "headset",
            "Wireless Headset",
            "Corsair",
            DeviceKind::Headset,
            headset_layout(),
            Capabilities { battery: true, ..rgb_only(&["static", "breathing"]) },
        ),
        dev(
            "fan1",
            "120mm ARGB Fan",
            "Lian Li",
            DeviceKind::Fan,
            Layout::ring(16, 120.0),
            Capabilities { fan_control: true, ..rgb_only(&["static", "rainbow"]) },
        ),
        dev(
            "fan2",
            "120mm ARGB Fan",
            "Lian Li",
            DeviceKind::Fan,
            Layout::ring(16, 120.0),
            Capabilities { fan_control: true, ..rgb_only(&["static", "rainbow"]) },
        ),
        dev("strip", "Monitor Light Bar", "Govee", DeviceKind::LedStrip, Layout::strip(30, 600.0), rgb_only(&["static"])),
        dev("gpu", "Graphics Card", "ASUS", DeviceKind::Gpu, gpu_layout(), rgb_only(&["static", "rainbow"])),
        dev("ram1", "DDR5 Memory", "G.Skill", DeviceKind::Ram, ram_layout(), rgb_only(&["static", "rainbow"])),
        dev("ram2", "DDR5 Memory", "G.Skill", DeviceKind::Ram, ram_layout(), rgb_only(&["static", "rainbow"])),
    ]
}

impl Backend for VirtualRig {
    fn id(&self) -> &'static str {
        "virtual"
    }
    fn name(&self) -> &'static str {
        "Demo rig"
    }
    fn scan(&mut self) -> Result<Vec<DeviceInfo>> {
        Ok(devices())
    }
    fn write_leds(&mut self, device_id: &str, colors: &[Rgb]) -> Result<()> {
        self.frames.insert(device_id.to_string(), colors.to_vec());
        Ok(())
    }
    fn apply_settings(&mut self, device_id: &str, settings: &DeviceSettings) -> Result<()> {
        self.applied.insert(device_id.to_string(), settings.clone());
        Ok(())
    }
    fn status(&mut self, device_id: &str) -> Option<DeviceStatus> {
        let battery = match device_id {
            "virtual:mouse" => Some(78),
            "virtual:headset" => Some(46),
            _ => None,
        };
        Some(DeviceStatus { connected: true, battery, charging: false })
    }
}

