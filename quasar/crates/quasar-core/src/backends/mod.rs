//! Device backends.
//!
//! A backend discovers devices and moves colour and settings to them. QUASAR
//! layers several, so one rig can mix brands:
//!
//! - `openrgb`  — speaks the OpenRGB SDK protocol over TCP. One connection
//!   reaches every device OpenRGB supports (hundreds, across most brands,
//!   plus motherboards, RAM and GPUs).
//! - `hid`      — native USB HID drivers (Razer, Logitech HID++), for the
//!   things OpenRGB does not do: DPI, polling rate, battery. Behind the
//!   `hid` feature.
//! - `virtual`  — a simulated rig, so the app is explorable with no hardware.

pub mod attackshark;
pub mod logitech;
pub mod openrgb;
pub mod razer;
pub mod virtual_rig;

#[cfg(feature = "hid")]
pub mod hid;

use crate::color::Rgb;
use crate::device::{DeviceInfo, DeviceSettings, DeviceStatus};
use crate::Result;

pub trait Backend: Send {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    /// Discover devices. Called at start and when the user rescans.
    fn scan(&mut self) -> Result<Vec<DeviceInfo>>;
    /// Push one frame of per-LED colour (already brightness-scaled).
    fn write_leds(&mut self, device_id: &str, colors: &[Rgb]) -> Result<()>;
    /// Apply non-lighting settings: DPI, polling rate, fan duty...
    fn apply_settings(&mut self, device_id: &str, settings: &DeviceSettings) -> Result<()>;
    fn status(&mut self, _device_id: &str) -> Option<DeviceStatus> {
        None
    }
    /// Set how many LEDs hang off a resizable zone (an ARGB header).
    fn resize_zone(&mut self, device_id: &str, _zone: usize, _size: u32) -> Result<()> {
        Err(crate::Error::Unsupported(format!("{device_id} has no resizable zones")))
    }
    /// True once if the backend's device list changed since the last call
    /// (OpenRGB finishing detection, a device plugged in).
    fn take_changed(&mut self) -> bool {
        false
    }
}
