//! Logitech HID++ 2.0 (packet layer).
//!
//! HID++ is documented in Logitech's public feature specs and implemented by
//! Solaar and libratbag. A long report is 20 bytes:
//!
//! ```text
//! 0x11, device index, feature index, (function << 4) | software id, params[16]
//! ```
//!
//! Features are addressed by an index the device assigns, found through the
//! root feature (`0x0000`, function 0 `getFeature`).

pub const VID: u16 = 0x046D;
pub const LONG: u8 = 0x11;
pub const LONG_LEN: usize = 20;
/// Our software id; replies echo it so we can match them.
pub const SW_ID: u8 = 0x0A;
/// Device index for a device on a cable.
pub const WIRED: u8 = 0xFF;

pub mod feature {
    pub const ROOT: u16 = 0x0000;
    pub const DEVICE_NAME: u16 = 0x0005;
    pub const UNIFIED_BATTERY: u16 = 0x1004;
    pub const ADJUSTABLE_DPI: u16 = 0x2201;
    pub const REPORT_RATE: u16 = 0x8060;
    pub const COLOR_LED_EFFECTS: u16 = 0x8070;
}

pub fn long(device: u8, feature_index: u8, function: u8, params: &[u8]) -> [u8; LONG_LEN] {
    assert!(params.len() <= 16);
    let mut b = [0u8; LONG_LEN];
    b[0] = LONG;
    b[1] = device;
    b[2] = feature_index;
    b[3] = (function << 4) | SW_ID;
    b[4..4 + params.len()].copy_from_slice(params);
    b
}

pub fn get_feature(device: u8, feature: u16) -> [u8; LONG_LEN] {
    long(device, 0x00, 0x0, &feature.to_be_bytes())
}

/// Reply to `get_feature`: the index, or `None` if the device lacks it.
pub fn parse_feature_index(reply: &[u8]) -> Option<u8> {
    (reply.len() >= 5 && reply[0] == LONG && reply[2] == 0x00 && reply[4] != 0).then(|| reply[4])
}

/// `0x2201` function 3 `setSensorDpi(sensor, dpi)`.
pub fn set_dpi(device: u8, index: u8, dpi: u16) -> [u8; LONG_LEN] {
    let [h, l] = dpi.to_be_bytes();
    long(device, index, 0x3, &[0x00, h, l])
}

/// `0x8060` function 2 `setReportRate(ms)`.
pub fn set_report_rate(device: u8, index: u8, hz: u32) -> Option<[u8; LONG_LEN]> {
    let ms = match hz {
        1000 => 1,
        500 => 2,
        250 => 4,
        125 => 8,
        _ => return None,
    };
    Some(long(device, index, 0x2, &[ms]))
}

/// `0x1004` function 1 `getStatus` -> state of charge in `params[0]`.
pub fn get_battery(device: u8, index: u8) -> [u8; LONG_LEN] {
    long(device, index, 0x1, &[])
}

pub fn parse_battery(reply: &[u8]) -> Option<(u8, bool)> {
    (reply.len() >= 7 && reply[0] == LONG).then(|| (reply[4].min(100), matches!(reply[6], 1 | 2)))
}

/// `0x8070` function 3 `setZoneEffect`: static colour on a zone, effect
/// index 1 (static on every Logitech device we know), persisted.
pub fn set_zone_static(device: u8, index: u8, zone: u8, r: u8, g: u8, b: u8) -> [u8; LONG_LEN] {
    let mut p = [0u8; 16];
    p[0] = zone;
    p[1] = 0x01;
    p[2] = r;
    p[3] = g;
    p[4] = b;
    p[12] = 0x01;
    long(device, index, 0x3, &p)
}

#[derive(Clone, Copy, Debug)]
pub struct Model {
    pub pid: u16,
    pub name: &'static str,
    pub max_dpi: u32,
    /// HID++ device index: 0xFF wired, 1 behind a Lightspeed receiver.
    pub device: u8,
    pub zones: u8,
}

pub const MODELS: &[Model] = &[
    Model { pid: 0xC08B, name: "Logitech G502 HERO", max_dpi: 25600, device: WIRED, zones: 2 },
    Model { pid: 0xC092, name: "Logitech G203 LIGHTSYNC", max_dpi: 8000, device: WIRED, zones: 1 },
    Model { pid: 0xC094, name: "Logitech PRO X Superlight (wired)", max_dpi: 25600, device: WIRED, zones: 0 },
    Model { pid: 0xC539, name: "Logitech Lightspeed Receiver", max_dpi: 25600, device: 0x01, zones: 2 },
    Model { pid: 0xC547, name: "Logitech Lightspeed Receiver (PRO X 2)", max_dpi: 32000, device: 0x01, zones: 0 },
];

pub fn model(pid: u16) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.pid == pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_get_feature() {
        let b = get_feature(WIRED, feature::ADJUSTABLE_DPI);
        assert_eq!(&b[..6], &[0x11, 0xFF, 0x00, 0x0A, 0x22, 0x01]);
        let mut reply = [0u8; 20];
        reply[..5].copy_from_slice(&[0x11, 0xFF, 0x00, 0x0A, 0x07]);
        assert_eq!(parse_feature_index(&reply), Some(7));
        reply[4] = 0;
        assert_eq!(parse_feature_index(&reply), None);
    }

    #[test]
    fn dpi_and_rate() {
        let b = set_dpi(1, 9, 1600);
        assert_eq!(&b[..7], &[0x11, 0x01, 0x09, 0x3A, 0x00, 0x06, 0x40]);
        assert_eq!(set_report_rate(1, 4, 500).unwrap()[4], 2);
        assert!(set_report_rate(1, 4, 8000).is_none());
    }
}
