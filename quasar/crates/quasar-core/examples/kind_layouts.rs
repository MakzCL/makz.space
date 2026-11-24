//! Every per-kind layout for 0..=30 LEDs, as DeviceInfo JSON, for the UI's
//! art stress test.
use quasar_core::device::{Capabilities, DeviceInfo, DeviceKind as K};
use quasar_core::layout::{for_kind, Layout};

fn main() {
    let mut out = Vec::new();
    let kinds = [K::Fan, K::Cooler, K::Ram, K::Gpu, K::Mousepad, K::Mouse, K::Headset, K::LedStrip, K::Keyboard, K::Motherboard, K::Case, K::Other];
    for k in kinds {
        for n in 0..=30usize {
            let layout = for_kind(k, n).unwrap_or_else(|| Layout::strip(n.max(1), (n.max(1) as f32) * 12.0));
            out.push(DeviceInfo { id: format!("{k:?}-{n}"), name: format!("{k:?} {n}"), vendor: "Test".into(), kind: k, backend: "test".into(), firmware: None, serial: None, layout, caps: Capabilities::default(), virtual_device: false });
        }
    }
    println!("{}", serde_json::to_string(&out).unwrap());
}
