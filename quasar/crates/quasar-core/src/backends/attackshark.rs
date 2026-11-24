//! Attack Shark X11 mouse (packet layer).
//!
//! Ported from libratbag's Attack Shark driver (libratbag pull request
//! #1822, MIT), itself based on the AttackTS reverse engineering. The mouse
//! is configured through HID feature reports on its vendor interface
//! (interface 2): 0x04 DPI, 0x05 preferences (lighting), 0x06 polling rate.
//! Lighting is a stored setting, not a streaming interface: the mouse keeps
//! a mode and one colour, so QUASAR sets it rather than animating it.

pub const VID: u16 = 0x1D57;
pub const PID_WIRED: u16 = 0xFA55;
pub const PID_WIRELESS: u16 = 0xFA60;
pub const INTERFACE: i32 = 2;
/// The firmware needs this long between reports.
pub const TRANSFER_DELAY_MS: u64 = 250;

pub const REPORT_DPI: u8 = 0x04;
pub const REPORT_PREFS: u8 = 0x05;
pub const REPORT_RATE: u8 = 0x06;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Light {
    Off = 0x00,
    Static = 0x10,
    Breathing = 0x20,
    /// Rainbow cycle.
    Neon = 0x30,
    ColorBreathing = 0x40,
}

impl Light {
    pub fn from_name(s: &str) -> Light {
        match s {
            "off" => Light::Off,
            "breathing" => Light::Breathing,
            "neon" | "spectrum" | "rainbow" => Light::Neon,
            "color-breathing" => Light::ColorBreathing,
            _ => Light::Static,
        }
    }
}

pub const MODES: &[&str] = &["static", "breathing", "neon", "color-breathing", "off"];
pub const RATES: &[u32] = &[125, 250, 500, 1000];

/// (dpi, encoded byte, high flag, stage mask flag), ascending by dpi.
pub const DPI_TABLE: &[(u32, u8, bool, bool)] = &[
    (50, 0x01, false, false),
    (100, 0x02, false, false),
    (150, 0x03, false, false),
    (200, 0x04, false, false),
    (250, 0x05, false, false),
    (300, 0x06, false, false),
    (350, 0x08, false, false),
    (400, 0x09, false, false),
    (450, 0x0a, false, false),
    (500, 0x0b, false, false),
    (550, 0x0c, false, false),
    (600, 0x0e, false, false),
    (650, 0x0f, false, false),
    (700, 0x10, false, false),
    (750, 0x11, false, false),
    (800, 0x12, false, false),
    (850, 0x13, false, false),
    (900, 0x15, false, false),
    (950, 0x16, false, false),
    (1000, 0x17, false, false),
    (1050, 0x18, false, false),
    (1100, 0x19, false, false),
    (1150, 0x1b, false, false),
    (1200, 0x1c, false, false),
    (1250, 0x1d, false, false),
    (1300, 0x1e, false, false),
    (1350, 0x1f, false, false),
    (1400, 0x20, false, false),
    (1450, 0x22, false, false),
    (1500, 0x23, false, false),
    (1550, 0x24, false, false),
    (1600, 0x25, false, false),
    (1650, 0x26, false, false),
    (1700, 0x27, false, false),
    (1750, 0x29, false, false),
    (1800, 0x2a, false, false),
    (1850, 0x2b, false, false),
    (1900, 0x2c, false, false),
    (1950, 0x2d, false, false),
    (2000, 0x2f, false, false),
    (2050, 0x30, false, false),
    (2100, 0x31, false, false),
    (2150, 0x32, false, false),
    (2200, 0x33, false, false),
    (2250, 0x34, false, false),
    (2300, 0x36, false, false),
    (2350, 0x37, false, false),
    (2400, 0x38, false, false),
    (2450, 0x39, false, false),
    (2500, 0x3a, false, false),
    (2550, 0x3b, false, false),
    (2600, 0x3d, false, false),
    (2650, 0x3e, false, false),
    (2700, 0x3f, false, false),
    (2750, 0x40, false, false),
    (2800, 0x41, false, false),
    (2850, 0x43, false, false),
    (2900, 0x44, false, false),
    (2950, 0x45, false, false),
    (3000, 0x46, false, false),
    (3050, 0x47, false, false),
    (3100, 0x48, false, false),
    (3150, 0x4a, false, false),
    (3200, 0x4b, false, false),
    (3250, 0x4c, false, false),
    (3300, 0x4d, false, false),
    (3350, 0x4e, false, false),
    (3400, 0x4f, false, false),
    (3450, 0x51, false, false),
    (3500, 0x52, false, false),
    (3550, 0x53, false, false),
    (3600, 0x54, false, false),
    (3650, 0x55, false, false),
    (3700, 0x57, false, false),
    (3750, 0x58, false, false),
    (3800, 0x59, false, false),
    (3850, 0x5a, false, false),
    (3900, 0x5b, false, false),
    (3950, 0x5c, false, false),
    (4000, 0x5e, false, false),
    (4050, 0x5f, false, false),
    (4100, 0x60, false, false),
    (4150, 0x61, false, false),
    (4200, 0x62, false, false),
    (4250, 0x63, false, false),
    (4300, 0x65, false, false),
    (4350, 0x66, false, false),
    (4400, 0x67, false, false),
    (4450, 0x68, false, false),
    (4500, 0x69, false, false),
    (4550, 0x6b, false, false),
    (4600, 0x6c, false, false),
    (4650, 0x6d, false, false),
    (4700, 0x6e, false, false),
    (4750, 0x6f, false, false),
    (4800, 0x70, false, false),
    (4850, 0x72, false, false),
    (4900, 0x73, false, false),
    (4950, 0x74, false, false),
    (5000, 0x75, false, false),
    (5050, 0x76, false, false),
    (5100, 0x77, false, false),
    (5150, 0x79, false, false),
    (5200, 0x7a, false, false),
    (5250, 0x7b, false, false),
    (5300, 0x7c, false, false),
    (5350, 0x7d, false, false),
    (5400, 0x7f, false, false),
    (5450, 0x80, false, false),
    (5500, 0x81, false, false),
    (5550, 0x82, false, false),
    (5600, 0x83, false, false),
    (5650, 0x84, false, false),
    (5700, 0x86, false, false),
    (5750, 0x87, false, false),
    (5800, 0x88, false, false),
    (5850, 0x89, false, false),
    (5900, 0x8a, false, false),
    (5950, 0x8b, false, false),
    (6000, 0x8d, false, false),
    (6050, 0x8e, false, false),
    (6100, 0x8f, false, false),
    (6150, 0x90, false, false),
    (6200, 0x91, false, false),
    (6250, 0x93, false, false),
    (6300, 0x94, false, false),
    (6350, 0x95, false, false),
    (6400, 0x96, false, false),
    (6450, 0x97, false, false),
    (6500, 0x98, false, false),
    (6550, 0x9a, false, false),
    (6600, 0x9b, false, false),
    (6650, 0x9c, false, false),
    (6700, 0x9d, false, false),
    (6750, 0x9e, false, false),
    (6800, 0x9f, false, false),
    (6850, 0xa1, false, false),
    (6900, 0xa2, false, false),
    (6950, 0xa3, false, false),
    (7000, 0xa4, false, false),
    (7050, 0xa5, false, false),
    (7100, 0xa7, false, false),
    (7150, 0xa8, false, false),
    (7200, 0xa9, false, false),
    (7250, 0xaa, false, false),
    (7300, 0xab, false, false),
    (7350, 0xac, false, false),
    (7400, 0xae, false, false),
    (7450, 0xaf, false, false),
    (7500, 0xb0, false, false),
    (7550, 0xb1, false, false),
    (7600, 0xb2, false, false),
    (7650, 0xb3, false, false),
    (7700, 0xb5, false, false),
    (7750, 0xb6, false, false),
    (7800, 0xb7, false, false),
    (7850, 0xb8, false, false),
    (7900, 0xb9, false, false),
    (7950, 0xbb, false, false),
    (8000, 0xbc, false, false),
    (8050, 0xbd, false, false),
    (8100, 0xbe, false, false),
    (8150, 0xbf, false, false),
    (8200, 0xc0, false, false),
    (8250, 0xc2, false, false),
    (8300, 0xc3, false, false),
    (8350, 0xc4, false, false),
    (8400, 0xc5, false, false),
    (8450, 0xc6, false, false),
    (8500, 0xc7, false, false),
    (8550, 0xc9, false, false),
    (8600, 0xca, false, false),
    (8650, 0xcb, false, false),
    (8700, 0xcc, false, false),
    (8750, 0xcd, false, false),
    (8800, 0xcf, false, false),
    (8850, 0xd0, false, false),
    (8900, 0xd1, false, false),
    (8950, 0xd2, false, false),
    (9000, 0xd3, false, false),
    (9050, 0xd4, false, false),
    (9100, 0xd6, false, false),
    (9150, 0xd7, false, false),
    (9200, 0xd8, false, false),
    (9250, 0xd9, false, false),
    (9300, 0xda, false, false),
    (9350, 0xdb, false, false),
    (9400, 0xdd, false, false),
    (9450, 0xde, false, false),
    (9500, 0xdf, false, false),
    (9550, 0xe0, false, false),
    (9600, 0xe1, false, false),
    (9650, 0xe3, false, false),
    (9700, 0xe4, false, false),
    (9750, 0xe5, false, false),
    (9800, 0xe6, false, false),
    (9850, 0xe7, false, false),
    (9900, 0xe8, false, false),
    (9950, 0xea, false, false),
    (10000, 0xeb, false, false),
    (10100, 0x76, true, false),
    (10200, 0x77, true, false),
    (10300, 0x79, true, false),
    (10400, 0x7a, true, false),
    (10500, 0x7b, true, false),
    (10600, 0x7c, true, false),
    (10700, 0x7d, true, false),
    (10800, 0x7f, true, false),
    (10900, 0x80, true, false),
    (11000, 0x81, true, false),
    (11100, 0x82, true, false),
    (11200, 0x83, true, false),
    (11300, 0x84, true, false),
    (11400, 0x86, true, false),
    (11500, 0x87, true, false),
    (11600, 0x88, true, false),
    (11700, 0x89, true, false),
    (11800, 0x8a, true, false),
    (11900, 0x8b, true, false),
    (12000, 0x8d, true, false),
    (12100, 0x8e, false, true),
    (12200, 0x8f, false, true),
    (12300, 0x90, false, true),
    (12400, 0x91, false, true),
    (12500, 0x93, false, true),
    (12600, 0x94, false, true),
    (12700, 0x95, false, true),
    (12800, 0x96, false, true),
    (12900, 0x97, false, true),
    (13000, 0x98, false, true),
    (13100, 0x9a, false, true),
    (13200, 0x9b, false, true),
    (13300, 0x9c, false, true),
    (13400, 0x9d, false, true),
    (13500, 0x9e, false, true),
    (13600, 0x9f, false, true),
    (13700, 0xa1, false, true),
    (13800, 0xa2, false, true),
    (13900, 0xa3, false, true),
    (14000, 0xa4, false, true),
    (14100, 0xa5, false, true),
    (14200, 0xa7, false, true),
    (14300, 0xa8, false, true),
    (14400, 0xa9, false, true),
    (14500, 0xaa, false, true),
    (14600, 0xab, false, true),
    (14700, 0xac, false, true),
    (14800, 0xae, false, true),
    (14900, 0xaf, false, true),
    (15000, 0xb0, false, true),
    (15100, 0xb1, false, true),
    (15200, 0xb2, false, true),
    (15300, 0xb3, false, true),
    (15400, 0xb5, false, true),
    (15500, 0xb6, false, true),
    (15600, 0xb7, false, true),
    (15700, 0xb8, false, true),
    (15800, 0xb9, false, true),
    (15900, 0xbb, false, true),
    (16000, 0xbc, false, true),
    (16100, 0xbd, false, true),
    (16200, 0xbe, false, true),
    (16300, 0xbf, false, true),
    (16400, 0xc0, false, true),
    (16500, 0xc2, false, true),
    (16600, 0xc3, false, true),
    (16700, 0xc4, false, true),
    (16800, 0xc5, false, true),
    (16900, 0xc6, false, true),
    (17000, 0xc7, false, true),
    (17100, 0xc9, false, true),
    (17200, 0xca, false, true),
    (17300, 0xcb, false, true),
    (17400, 0xcc, false, true),
    (17500, 0xcd, false, true),
    (17600, 0xcf, false, true),
    (17700, 0xd0, false, true),
    (17800, 0xd1, false, true),
    (17900, 0xd2, false, true),
    (18000, 0xd3, false, true),
    (18100, 0xd4, false, true),
    (18200, 0xd6, false, true),
    (18300, 0xd7, false, true),
    (18400, 0xd8, false, true),
    (18500, 0xd9, false, true),
    (18600, 0xda, false, true),
    (18700, 0xdb, false, true),
    (18800, 0xdd, false, true),
    (18900, 0xde, false, true),
    (19000, 0xdf, false, true),
    (19100, 0xe0, false, true),
    (19200, 0xe1, false, true),
    (19300, 0xe3, false, true),
    (19400, 0xe4, false, true),
    (19500, 0xe5, false, true),
    (19600, 0xe6, false, true),
    (19700, 0xe7, false, true),
    (19800, 0xe8, false, true),
    (19900, 0xea, false, true),
    (20000, 0xeb, false, true),
    (20100, 0xeb, true, true),
    (20200, 0x76, true, true),
    (20300, 0x76, true, true),
    (20400, 0x77, true, true),
    (20500, 0x77, true, true),
    (20600, 0x79, true, true),
    (20700, 0x79, true, true),
    (20800, 0x7a, true, true),
    (20900, 0x7a, true, true),
    (21000, 0x7b, true, true),
    (21100, 0x7b, true, true),
    (21200, 0x7c, true, true),
    (21300, 0x7c, true, true),
    (21400, 0x7d, true, true),
    (21500, 0x7d, true, true),
    (21600, 0x7f, true, true),
    (21700, 0x7f, true, true),
    (21800, 0x80, true, true),
    (21900, 0x80, true, true),
    (22000, 0x81, true, true),
];

pub fn dpi_entry(dpi: u32) -> (u32, u8, bool, bool) {
    *DPI_TABLE.iter().find(|e| e.0 >= dpi).unwrap_or(DPI_TABLE.last().unwrap())
}

/// Report 0x04: six DPI stages and the active one (0-based).
pub fn dpi_packet(stages: &[u32], active: usize, wireless: bool) -> Vec<u8> {
    let mut b = vec![0u8; if wireless { 56 } else { 52 }];
    b[0] = REPORT_DPI;
    b[1] = 0x38;
    b[2] = 0x01;
    b[3] = 0x00; // angle snap off
    b[4] = 0x01; // ripple control
    b[5] = 0x3f;
    let mut mask = 0u8;
    for i in 0..6 {
        let dpi = stages.get(i).or(stages.last()).copied().unwrap_or(1600);
        let (_, enc, high, sm) = dpi_entry(dpi);
        b[8 + i] = enc;
        b[16 + i] = high as u8;
        if sm {
            mask |= 1 << i;
        }
    }
    b[6] = mask;
    b[7] = mask;
    b[24] = (active.min(5) + 1) as u8;
    for i in [25, 29, 33, 34, 35, 38, 39, 40, 42, 43, 46, 47, 48] {
        b[i] = 0xff;
    }
    b[44] = 0x40;
    b[49] = 0x02;
    let sum: u16 = b[3..=49].iter().map(|v| *v as u16).fold(0, u16::wrapping_add);
    b[50] = (sum >> 8) as u8;
    b[51] = sum as u8;
    b
}

/// Report 0x05: lighting mode, colour, speed (1 slow .. 5 fast), plus the
/// sleep and debounce settings the same report carries (kept at defaults).
pub fn prefs_packet(light: Light, r: u8, g: u8, bl: u8, speed: u8, wireless: bool) -> Vec<u8> {
    let deep_sleep_min: u32 = 10;
    let debounce_ms: u32 = 4;
    let hw_speed = 6 - speed.clamp(1, 5);
    let bucket = ((deep_sleep_min - 1) / 16) as u8;
    let mut b = vec![0u8; if wireless { 15 } else { 13 }];
    b[0] = REPORT_PREFS;
    b[1] = 0x0f;
    b[2] = 0x01;
    b[3] = light as u8;
    b[4] = (bucket << 4) | (hw_speed & 0x0f);
    b[5] = ((0x08 + deep_sleep_min * 0x10) & 0xff) as u8;
    b[6] = r;
    b[7] = g;
    b[8] = bl;
    b[9] = 4; // sleep after 2 minutes
    b[10] = ((debounce_ms - 4) / 2 + 2) as u8;
    b[11] = [r, g, bl].iter().filter(|c| **c >= 0x64).count() as u8;
    b[12] = b[3..=10].iter().fold(0u8, |a, v| a.wrapping_add(*v));
    b
}

/// Report 0x06: polling rate.
pub fn rate_packet(hz: u32) -> Vec<u8> {
    let enc = match hz {
        125 => 0x08,
        250 => 0x04,
        500 => 0x02,
        _ => 0x01,
    };
    let mut b = vec![0u8; 9];
    b[0] = REPORT_RATE;
    b[1] = 0x09;
    b[2] = 0x01;
    b[3] = enc;
    b[4] = 0xff - enc;
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_is_sorted_and_spans_the_range() {
        assert!(DPI_TABLE.windows(2).all(|w| w[0].0 < w[1].0));
        assert_eq!(DPI_TABLE[0].0, 50);
        assert_eq!(DPI_TABLE.last().unwrap().0, 22000);
        assert_eq!(dpi_entry(1600).0, 1600);
        assert_eq!(dpi_entry(1601).0, 1650);
        assert_eq!(dpi_entry(99999).0, 22000);
    }

    #[test]
    fn prefs_packet_layout_and_checksum() {
        let p = prefs_packet(Light::Static, 0x7c, 0x5c, 0xff, 3, true);
        assert_eq!(p.len(), 15);
        assert_eq!(&p[..4], &[0x05, 0x0f, 0x01, 0x10]);
        assert_eq!(&p[6..9], &[0x7c, 0x5c, 0xff]);
        assert_eq!(p[11], 2, "two channels at or above 0x64");
        let sum = p[3..=10].iter().fold(0u8, |a, v| a.wrapping_add(*v));
        assert_eq!(p[12], sum);
        assert_eq!(prefs_packet(Light::Off, 0, 0, 0, 3, false).len(), 13);
    }

    #[test]
    fn dpi_and_rate_packets() {
        let d = dpi_packet(&[400, 800, 1600, 3200, 6400], 2, true);
        assert_eq!(d.len(), 56);
        assert_eq!(&d[..3], &[0x04, 0x38, 0x01]);
        assert_eq!(d[24], 3);
        assert_eq!(d[8 + 5], d[8 + 4], "missing sixth stage repeats the last");
        let sum: u16 = d[3..=49].iter().map(|v| *v as u16).sum();
        assert_eq!(u16::from_be_bytes([d[50], d[51]]), sum);
        let r = rate_packet(500);
        assert_eq!(&r[..5], &[0x06, 0x09, 0x01, 0x02, 0xfd]);
    }
}
