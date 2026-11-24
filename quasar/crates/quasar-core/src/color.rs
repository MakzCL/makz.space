use serde::{Deserialize, Serialize};

/// 8-bit sRGB colour, the unit every device driver speaks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    pub const BLACK: Rgb = Rgb::new(0, 0, 0);
    pub const WHITE: Rgb = Rgb::new(255, 255, 255);

    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    pub fn from_hex(s: &str) -> Option<Self> {
        let s = s.trim().trim_start_matches('#');
        let v = match s.len() {
            6 => u32::from_str_radix(s, 16).ok()?,
            3 => {
                let v = u32::from_str_radix(s, 16).ok()?;
                let (r, g, b) = ((v >> 8) & 15, (v >> 4) & 15, v & 15);
                ((r * 17) << 16) | ((g * 17) << 8) | (b * 17)
            }
            _ => return None,
        };
        Some(Self::new((v >> 16) as u8, (v >> 8) as u8, v as u8))
    }

    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    pub fn to_f(self) -> [f32; 3] {
        [self.r as f32 / 255.0, self.g as f32 / 255.0, self.b as f32 / 255.0]
    }

    pub fn from_f(c: [f32; 3]) -> Self {
        let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        Self::new(q(c[0]), q(c[1]), q(c[2]))
    }

    pub fn scale(self, k: f32) -> Self {
        let c = self.to_f();
        Self::from_f([c[0] * k, c[1] * k, c[2] * k])
    }
}

impl Serialize for Rgb {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_hex())
    }
}

impl<'de> Deserialize<'de> for Rgb {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Rgb::from_hex(&s).ok_or_else(|| serde::de::Error::custom(format!("bad colour {s}")))
    }
}

/// HSV to linear-ish float RGB. `h` in turns (0..1 wraps), `s`/`v` in 0..1.
pub fn hsv(h: f32, s: f32, v: f32) -> [f32; 3] {
    let h = h.rem_euclid(1.0) * 6.0;
    let i = h.floor();
    let f = h - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match i as i32 {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}

pub fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

pub fn scale3(a: [f32; 3], k: f32) -> [f32; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}

/// Sample a multi-stop palette at `t` (wrapping when `wrap`).
pub fn palette(stops: &[[f32; 3]], t: f32, wrap: bool) -> [f32; 3] {
    match stops.len() {
        0 => [0.0; 3],
        1 => stops[0],
        n => {
            let (t, segs) = if wrap { (t.rem_euclid(1.0), n) } else { (t.clamp(0.0, 1.0), n - 1) };
            let x = t * segs as f32;
            let i = (x.floor() as usize).min(segs - 1);
            lerp3(stops[i], stops[(i + 1) % n], x - i as f32)
        }
    }
}

/// Boost or cut saturation around luma.
pub fn saturate(c: [f32; 3], k: f32) -> [f32; 3] {
    let l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        let c = Rgb::from_hex("#2ee6ff").unwrap();
        assert_eq!(c, Rgb::new(0x2e, 0xe6, 0xff));
        assert_eq!(c.to_hex(), "#2ee6ff");
        assert_eq!(Rgb::from_hex("f0a"), Some(Rgb::new(255, 0, 170)));
        assert_eq!(Rgb::from_hex("nope"), None);
    }

    #[test]
    fn hsv_primaries() {
        assert_eq!(Rgb::from_f(hsv(0.0, 1.0, 1.0)), Rgb::new(255, 0, 0));
        assert_eq!(Rgb::from_f(hsv(1.0 / 3.0, 1.0, 1.0)), Rgb::new(0, 255, 0));
        assert_eq!(Rgb::from_f(hsv(2.0 / 3.0, 1.0, 1.0)), Rgb::new(0, 0, 255));
    }

    #[test]
    fn palette_wraps() {
        let p = [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0]];
        assert_eq!(palette(&p, 0.0, true), [1.0, 0.0, 0.0]);
        assert_eq!(palette(&p, 0.5, true), [0.0, 0.0, 1.0]);
        assert_eq!(palette(&p, 1.0, false), [0.0, 0.0, 1.0]);
    }
}
