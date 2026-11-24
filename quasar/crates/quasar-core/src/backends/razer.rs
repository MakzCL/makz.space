//! Razer USB protocol (packet layer).
//!
//! Razer peripherals take 90-byte HID feature reports. The layout and the
//! command set below follow the reverse-engineering in OpenRazer
//! (github.com/openrazer/openrazer, `razercommon.h`, `razerchromacommon.c`).
//!
//! ```text
//!  0  status            0x00 = new command
//!  1  transaction id    0x1F / 0x3F / 0xFF depending on the device family
//!  2  remaining packets u16 big-endian
//!  4  protocol type     0x00
//!  5  data size
//!  6  command class
//!  7  command id
//!  8  arguments [80]
//! 88  crc               XOR of bytes 2..88
//! 89  reserved
//! ```

use crate::color::Rgb;
use crate::device::DeviceKind;

pub const VID: u16 = 0x1532;
pub const REPORT_LEN: usize = 90;

pub const NOSTORE: u8 = 0x00;
pub const VARSTORE: u8 = 0x01;

pub mod led {
    pub const ZERO: u8 = 0x00;
    pub const SCROLL_WHEEL: u8 = 0x01;
    pub const LOGO: u8 = 0x04;
    pub const BACKLIGHT: u8 = 0x05;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Report(pub [u8; REPORT_LEN]);

impl Report {
    pub fn new(tid: u8, class: u8, id: u8, args: &[u8]) -> Self {
        assert!(args.len() <= 80, "razer arguments are at most 80 bytes");
        let mut r = [0u8; REPORT_LEN];
        r[1] = tid;
        r[5] = args.len() as u8;
        r[6] = class;
        r[7] = id;
        r[8..8 + args.len()].copy_from_slice(args);
        r[88] = crc(&r);
        Report(r)
    }

    /// With an explicit data size (some commands declare more than they send).
    pub fn sized(tid: u8, class: u8, id: u8, size: u8, args: &[u8]) -> Self {
        let mut r = Self::new(tid, class, id, args);
        r.0[5] = size;
        r.0[88] = crc(&r.0);
        r
    }

    /// Bytes for `hid_send_feature_report`, prefixed with report id 0.
    pub fn feature_bytes(&self) -> [u8; REPORT_LEN + 1] {
        let mut b = [0u8; REPORT_LEN + 1];
        b[1..].copy_from_slice(&self.0);
        b
    }

    pub fn args(&self) -> &[u8] {
        &self.0[8..88]
    }
}

pub fn crc(r: &[u8; REPORT_LEN]) -> u8 {
    r[2..88].iter().fold(0, |a, b| a ^ b)
}

pub fn set_dpi(tid: u8, x: u16, y: u16) -> Report {
    let [xh, xl] = x.to_be_bytes();
    let [yh, yl] = y.to_be_bytes();
    Report::new(tid, 0x04, 0x05, &[VARSTORE, xh, xl, yh, yl, 0, 0])
}

pub fn get_dpi(tid: u8) -> Report {
    Report::sized(tid, 0x04, 0x85, 0x07, &[VARSTORE])
}

/// 125, 500 or 1000 Hz. Higher rates use a different command per device.
pub fn set_polling_rate(tid: u8, hz: u32) -> Option<Report> {
    let v = match hz {
        1000 => 0x01,
        500 => 0x02,
        125 => 0x08,
        _ => return None,
    };
    Some(Report::new(tid, 0x00, 0x05, &[v]))
}

pub fn get_battery(tid: u8) -> Report {
    Report::sized(tid, 0x07, 0x80, 0x02, &[])
}

pub fn set_brightness(tid: u8, led: u8, level: u8) -> Report {
    Report::new(tid, 0x0F, 0x04, &[VARSTORE, led, level])
}

pub fn static_color(tid: u8, led: u8, c: Rgb) -> Report {
    Report::new(tid, 0x0F, 0x02, &[VARSTORE, led, 0x01, 0x00, 0x00, 0x01, c.r, c.g, c.b])
}

pub fn spectrum(tid: u8, led: u8) -> Report {
    Report::sized(tid, 0x0F, 0x02, 0x06, &[VARSTORE, led, 0x03])
}

/// One row of a per-LED custom frame (extended matrix devices).
pub fn custom_frame_row(tid: u8, row: u8, start: u8, colors: &[Rgb]) -> Report {
    let n = colors.len().min(25);
    let stop = start + n as u8 - 1;
    let mut args = vec![0x00, 0x00, row, start, stop];
    for c in &colors[..n] {
        args.extend_from_slice(&[c.r, c.g, c.b]);
    }
    Report::new(tid, 0x0F, 0x03, &args)
}

/// Switch the device to display the uploaded custom frame.
pub fn custom_frame_apply(tid: u8) -> Report {
    Report::sized(tid, 0x0F, 0x02, 0x0C, &[NOSTORE, led::ZERO, 0x08])
}

#[derive(Clone, Copy, Debug)]
pub struct Model {
    pub pid: u16,
    pub name: &'static str,
    pub kind: DeviceKind,
    pub tid: u8,
    pub max_dpi: u32,
    /// Custom-frame matrix size (rows, cols). (0, 0) means no per-LED control.
    pub matrix: (u8, u8),
    pub interface: i32,
    pub wireless: bool,
}

/// Devices whose ids and transaction ids are taken from OpenRazer's tables.
/// Untested on hardware here; report a model that misbehaves and it gets
/// corrected or removed.
pub const MODELS: &[Model] = &[
    Model { pid: 0x0084, name: "Razer DeathAdder V2", kind: DeviceKind::Mouse, tid: 0x3F, max_dpi: 20000, matrix: (1, 2), interface: 0, wireless: false },
    Model { pid: 0x008C, name: "Razer DeathAdder V2 Mini", kind: DeviceKind::Mouse, tid: 0x3F, max_dpi: 8500, matrix: (1, 1), interface: 0, wireless: false },
    Model { pid: 0x0099, name: "Razer Basilisk V3", kind: DeviceKind::Mouse, tid: 0x1F, max_dpi: 26000, matrix: (1, 11), interface: 0, wireless: false },
    Model { pid: 0x007A, name: "Razer Viper Ultimate (Wired)", kind: DeviceKind::Mouse, tid: 0x3F, max_dpi: 20000, matrix: (1, 1), interface: 0, wireless: false },
    Model { pid: 0x007B, name: "Razer Viper Ultimate (Wireless)", kind: DeviceKind::Mouse, tid: 0x3F, max_dpi: 20000, matrix: (1, 1), interface: 0, wireless: true },
    Model { pid: 0x0078, name: "Razer Viper", kind: DeviceKind::Mouse, tid: 0x3F, max_dpi: 16000, matrix: (1, 1), interface: 0, wireless: false },
    Model { pid: 0x024E, name: "Razer BlackWidow V3", kind: DeviceKind::Keyboard, tid: 0x1F, max_dpi: 0, matrix: (6, 22), interface: 3, wireless: false },
    Model { pid: 0x026C, name: "Razer Huntsman V2", kind: DeviceKind::Keyboard, tid: 0x1F, max_dpi: 0, matrix: (6, 22), interface: 3, wireless: false },
    Model { pid: 0x0C02, name: "Razer Goliathus Chroma", kind: DeviceKind::Mousepad, tid: 0x3F, max_dpi: 0, matrix: (1, 1), interface: 0, wireless: false },
];

pub fn model(pid: u16) -> Option<&'static Model> {
    MODELS.iter().find(|m| m.pid == pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpi_report_matches_openrazer_layout() {
        let r = set_dpi(0x3F, 1600, 1600);
        assert_eq!(r.0[1], 0x3F);
        assert_eq!(r.0[5], 7);
        assert_eq!((r.0[6], r.0[7]), (0x04, 0x05));
        assert_eq!(&r.0[8..15], &[0x01, 0x06, 0x40, 0x06, 0x40, 0, 0]);
        assert_eq!(r.0[88], crc(&r.0));
        // crc covers bytes 2..88 only, so the transaction id does not change it
        assert_eq!(set_dpi(0xFF, 1600, 1600).0[88], r.0[88]);
        assert_eq!(r.feature_bytes()[0], 0);
        assert_eq!(r.feature_bytes().len(), 91);
    }

    #[test]
    #[allow(clippy::identity_op)]
    fn known_crc() {
        // static colour on the logo, red: xor of 0x09,0x0F,0x02,0x01,0x04,0x01,0x01,0xFF
        let r = static_color(0x1F, led::LOGO, Rgb::new(255, 0, 0));
        assert_eq!(r.0[88], 0x09 ^ 0x0F ^ 0x02 ^ 0x01 ^ 0x04 ^ 0x01 ^ 0x01 ^ 0xFF);
    }

    #[test]
    fn polling_rates() {
        assert_eq!(set_polling_rate(0x1F, 1000).unwrap().args()[0], 0x01);
        assert_eq!(set_polling_rate(0x1F, 125).unwrap().args()[0], 0x08);
        assert!(set_polling_rate(0x1F, 4000).is_none());
    }

    #[test]
    fn custom_frame_row_caps_and_sizes() {
        let r = custom_frame_row(0x1F, 2, 0, &[Rgb::new(1, 2, 3); 3]);
        assert_eq!(r.0[5], 5 + 9);
        assert_eq!(&r.0[8..13], &[0, 0, 2, 0, 2]);
        assert_eq!(&r.0[13..16], &[1, 2, 3]);
    }
}
