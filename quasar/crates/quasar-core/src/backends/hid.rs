//! Native HID transport for the Razer and Logitech packet layers.

use std::collections::HashMap;
use std::ffi::CString;

use hidapi::{HidApi, HidDevice};

use super::{logitech, razer, Backend};
use crate::color::Rgb;
use crate::device::{Capabilities, DeviceInfo, DeviceSettings, DeviceStatus, DpiCaps};
use crate::layout::Layout;
use crate::{Error, Result};

enum Driver {
    Razer { model: &'static razer::Model },
    Logitech { model: &'static logitech::Model, features: HashMap<u16, u8> },
}

struct Open {
    dev: HidDevice,
    driver: Driver,
}

pub struct Hid {
    api: Option<HidApi>,
    open: HashMap<String, Open>,
}

impl Default for Hid {
    fn default() -> Self {
        Self { api: HidApi::new().ok(), open: HashMap::new() }
    }
}

fn razer_send(dev: &HidDevice, r: razer::Report) -> Result<razer::Report> {
    dev.send_feature_report(&r.feature_bytes()).map_err(|e| Error::Protocol(e.to_string()))?;
    std::thread::sleep(std::time::Duration::from_micros(800));
    let mut buf = [0u8; razer::REPORT_LEN + 1];
    let n = dev.get_feature_report(&mut buf).map_err(|e| Error::Protocol(e.to_string()))?;
    if n < razer::REPORT_LEN {
        return Err(Error::Protocol("short razer reply".into()));
    }
    let mut out = [0u8; razer::REPORT_LEN];
    out.copy_from_slice(&buf[n - razer::REPORT_LEN..n]);
    Ok(razer::Report(out))
}

fn hidpp(dev: &HidDevice, msg: &[u8; logitech::LONG_LEN]) -> Result<[u8; logitech::LONG_LEN]> {
    dev.write(msg).map_err(|e| Error::Protocol(e.to_string()))?;
    let mut buf = [0u8; logitech::LONG_LEN];
    for _ in 0..8 {
        let n = dev.read_timeout(&mut buf, 300).map_err(|e| Error::Protocol(e.to_string()))?;
        if n == 0 {
            break;
        }
        // match feature index + software id; 0xFF in byte 2 is an error reply
        if buf[0] == logitech::LONG && (buf[2] == msg[2] || buf[2] == 0xFF) && buf[3] & 0x0F == logitech::SW_ID {
            if buf[2] == 0xFF {
                return Err(Error::Protocol(format!("HID++ error 0x{:02x}", buf[5])));
            }
            return Ok(buf);
        }
    }
    Err(Error::Protocol("no HID++ reply".into()))
}

impl Backend for Hid {
    fn id(&self) -> &'static str {
        "hid"
    }
    fn name(&self) -> &'static str {
        "Native drivers"
    }

    fn scan(&mut self) -> Result<Vec<DeviceInfo>> {
        let api = self.api.as_mut().ok_or_else(|| Error::Other("HID unavailable".into()))?;
        api.refresh_devices().map_err(|e| Error::Other(e.to_string()))?;
        self.open.clear();
        let mut out = Vec::new();
        for d in api.device_list() {
            let (vid, pid) = (d.vendor_id(), d.product_id());
            let serial = d.serial_number().unwrap_or("").to_string();
            let path: CString = d.path().to_owned();
            if vid == razer::VID {
                let Some(m) = razer::model(pid) else { continue };
                if d.interface_number() != m.interface {
                    continue;
                }
                let id = format!("hid:1532:{pid:04x}:{serial}");
                if self.open.contains_key(&id) {
                    continue;
                }
                let Ok(dev) = api.open_path(&path) else { continue };
                let (rows, cols) = m.matrix;
                let layout = if rows > 1 {
                    let mut l = Layout { width: cols as f32 * 19.0, height: rows as f32 * 19.0, leds: Vec::new() };
                    for r in 0..rows {
                        for c in 0..cols {
                            l.leds.push(Layout::led((c as f32 + 0.5) * 19.0, (r as f32 + 0.5) * 19.0));
                        }
                    }
                    l
                } else {
                    crate::layout::for_kind(m.kind, cols as usize).unwrap_or_else(|| Layout::strip(cols.max(1) as usize, cols.max(1) as f32 * 20.0))
                };
                out.push(DeviceInfo {
                    id: id.clone(),
                    name: m.name.into(),
                    vendor: "Razer".into(),
                    kind: m.kind,
                    backend: "hid".into(),
                    firmware: None,
                    serial: Some(serial).filter(|s| !s.is_empty()),
                    layout,
                    caps: Capabilities {
                        per_led: cols > 0,
                        dpi: (m.max_dpi > 0).then_some(DpiCaps { min: 100, max: m.max_dpi, step: 50, max_stages: 5 }),
                        polling_rates: if m.max_dpi > 0 { vec![125, 500, 1000] } else { vec![] },
                        battery: m.wireless,
                        brightness: true,
                        hardware_modes: vec!["static".into(), "spectrum".into()],
                        ..Default::default()
                    },
                    virtual_device: false,
                });
                self.open.insert(id, Open { dev, driver: Driver::Razer { model: m } });
            } else if vid == logitech::VID {
                let Some(m) = logitech::model(pid) else { continue };
                // HID++ long reports live on the vendor collection
                if d.usage_page() != 0xFF00 || d.usage() != 0x0002 {
                    continue;
                }
                let id = format!("hid:046d:{pid:04x}:{serial}");
                let Ok(dev) = api.open_path(&path) else { continue };
                let mut features = HashMap::new();
                for f in [logitech::feature::ADJUSTABLE_DPI, logitech::feature::REPORT_RATE, logitech::feature::UNIFIED_BATTERY, logitech::feature::COLOR_LED_EFFECTS] {
                    if let Some(i) = hidpp(&dev, &logitech::get_feature(m.device, f)).ok().and_then(|r| logitech::parse_feature_index(&r)) {
                        features.insert(f, i);
                    }
                }
                out.push(DeviceInfo {
                    id: id.clone(),
                    name: m.name.into(),
                    vendor: "Logitech".into(),
                    kind: crate::device::DeviceKind::Mouse,
                    backend: "hid".into(),
                    firmware: None,
                    serial: Some(serial).filter(|s| !s.is_empty()),
                    layout: crate::layout::for_kind(crate::device::DeviceKind::Mouse, m.zones as usize).unwrap_or_default(),
                    caps: Capabilities {
                        per_led: features.contains_key(&logitech::feature::COLOR_LED_EFFECTS) && m.zones > 0,
                        dpi: features.contains_key(&logitech::feature::ADJUSTABLE_DPI).then_some(DpiCaps { min: 100, max: m.max_dpi, step: 50, max_stages: 5 }),
                        polling_rates: if features.contains_key(&logitech::feature::REPORT_RATE) { vec![125, 250, 500, 1000] } else { vec![] },
                        battery: features.contains_key(&logitech::feature::UNIFIED_BATTERY),
                        ..Default::default()
                    },
                    virtual_device: false,
                });
                self.open.insert(id, Open { dev, driver: Driver::Logitech { model: m, features } });
            }
        }
        Ok(out)
    }

    fn write_leds(&mut self, device_id: &str, colors: &[Rgb]) -> Result<()> {
        let o = self.open.get(device_id).ok_or_else(|| Error::DeviceNotFound(device_id.into()))?;
        match &o.driver {
            Driver::Razer { model } => {
                let (rows, cols) = model.matrix;
                for r in 0..rows.max(1) {
                    let start = r as usize * cols as usize;
                    let row = &colors[start.min(colors.len())..(start + cols as usize).min(colors.len())];
                    if !row.is_empty() {
                        razer_send(&o.dev, razer::custom_frame_row(model.tid, r, 0, row))?;
                    }
                }
                razer_send(&o.dev, razer::custom_frame_apply(model.tid))?;
            }
            Driver::Logitech { model, features } => {
                // 0x8070 is not a streaming interface; only send on change and keep it cheap
                if let Some(i) = features.get(&logitech::feature::COLOR_LED_EFFECTS) {
                    for (z, c) in colors.iter().take(model.zones as usize).enumerate() {
                        hidpp(&o.dev, &logitech::set_zone_static(model.device, *i, z as u8, c.r, c.g, c.b))?;
                    }
                }
            }
        }
        Ok(())
    }

    fn apply_settings(&mut self, device_id: &str, s: &DeviceSettings) -> Result<()> {
        let o = self.open.get(device_id).ok_or_else(|| Error::DeviceNotFound(device_id.into()))?;
        match &o.driver {
            Driver::Razer { model } => {
                if let Some(stage) = s.dpi_stages.get(s.active_stage) {
                    let y = stage.dpi_y.unwrap_or(stage.dpi);
                    razer_send(&o.dev, razer::set_dpi(model.tid, stage.dpi as u16, y as u16))?;
                }
                if let Some(r) = s.polling_rate.and_then(|hz| razer::set_polling_rate(model.tid, hz)) {
                    razer_send(&o.dev, r)?;
                }
            }
            Driver::Logitech { model, features } => {
                if let (Some(i), Some(dpi)) = (features.get(&logitech::feature::ADJUSTABLE_DPI), s.current_dpi()) {
                    hidpp(&o.dev, &logitech::set_dpi(model.device, *i, dpi as u16))?;
                }
                if let (Some(i), Some(hz)) = (features.get(&logitech::feature::REPORT_RATE), s.polling_rate) {
                    if let Some(m) = logitech::set_report_rate(model.device, *i, hz) {
                        hidpp(&o.dev, &m)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn status(&mut self, device_id: &str) -> Option<DeviceStatus> {
        let o = self.open.get(device_id)?;
        let battery = match &o.driver {
            Driver::Razer { model } if model.wireless => razer_send(&o.dev, razer::get_battery(model.tid))
                .ok()
                .map(|r| ((r.args()[1] as u32 * 100) / 255) as u8),
            Driver::Logitech { model, features } => features
                .get(&logitech::feature::UNIFIED_BATTERY)
                .and_then(|i| hidpp(&o.dev, &logitech::get_battery(model.device, *i)).ok())
                .and_then(|r| logitech::parse_battery(&r))
                .map(|(b, _)| b),
            _ => None,
        };
        Some(DeviceStatus { connected: true, battery, charging: false })
    }
}
