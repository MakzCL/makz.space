//! Spatial model: where each LED of each device is, and where each device
//! sits on the shared canvas.

use serde::{Deserialize, Serialize};

/// The canvas spans this many millimetres horizontally; vertical span
/// follows the canvas aspect ratio. A desk, roughly.
pub const CANVAS_MM: f32 = 1000.0;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Led {
    /// Position inside the device, in millimetres from its top-left corner.
    pub x: f32,
    pub y: f32,
    /// Optional key or zone label (`"Esc"`, `"Logo"`, `"Scroll"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Size of the key cap or diffuser, for drawing. Defaults to a dot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub w: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<f32>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Layout {
    pub width: f32,
    pub height: f32,
    pub leds: Vec<Led>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Placement {
    /// Centre of the device on the canvas, normalised 0..1.
    pub x: f32,
    pub y: f32,
    pub scale: f32,
    /// Degrees clockwise.
    pub rotation: f32,
    pub visible: bool,
}

impl Default for Placement {
    fn default() -> Self {
        Self { x: 0.5, y: 0.5, scale: 1.0, rotation: 0.0, visible: true }
    }
}

impl Layout {
    pub fn led(x: f32, y: f32) -> Led {
        Led { x, y, label: None, w: None, h: None }
    }

    /// Canvas (u, v) for every LED under `p`, for a canvas of `aspect`.
    pub fn project(&self, p: &Placement, aspect: f32) -> Vec<(f32, f32)> {
        let canvas_h_mm = CANVAS_MM / aspect;
        let (s, c) = p.rotation.to_radians().sin_cos();
        self.leds
            .iter()
            .map(|l| {
                let lx = (l.x - self.width / 2.0) * p.scale;
                let ly = (l.y - self.height / 2.0) * p.scale;
                let rx = lx * c - ly * s;
                let ry = lx * s + ly * c;
                (p.x + rx / CANVAS_MM, p.y + ry / canvas_h_mm)
            })
            .collect()
    }

    /// A grid of keys from rows of `(label, width_in_units)`; `0.0` width
    /// with an empty label is a gap.
    pub fn keyboard(rows: &[&[(&str, f32)]], unit: f32) -> Layout {
        let mut leds = Vec::new();
        let mut width: f32 = 0.0;
        for (r, row) in rows.iter().enumerate() {
            let mut x = 0.0;
            for (label, w) in row.iter() {
                if !label.is_empty() {
                    leds.push(Led {
                        x: (x + w / 2.0) * unit,
                        y: (r as f32 + 0.5) * unit + if r > 0 { unit * 0.25 } else { 0.0 },
                        label: Some((*label).to_string()),
                        w: Some(w * unit - 2.0),
                        h: Some(unit - 2.0),
                    });
                }
                x += w;
            }
            width = width.max(x * unit);
        }
        Layout { width, height: (rows.len() as f32 + 0.25) * unit, leds }
    }

    pub fn ring(count: usize, diameter: f32) -> Layout {
        let r = diameter / 2.0 - 6.0;
        let leds = (0..count)
            .map(|i| {
                let a = i as f32 / count as f32 * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2;
                Layout::led(diameter / 2.0 + r * a.cos(), diameter / 2.0 + r * a.sin())
            })
            .collect();
        Layout { width: diameter, height: diameter, leds }
    }

    pub fn strip(count: usize, length: f32) -> Layout {
        let step = length / count as f32;
        Layout { width: length, height: 10.0, leds: (0..count).map(|i| Layout::led((i as f32 + 0.5) * step, 5.0)).collect() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_centres_and_rotates() {
        let l = Layout { width: 100.0, height: 10.0, leds: vec![Layout::led(0.0, 5.0), Layout::led(100.0, 5.0)] };
        let p = Placement { x: 0.5, y: 0.5, ..Default::default() };
        let pts = l.project(&p, 1.0);
        assert!((pts[0].0 - 0.45).abs() < 1e-5 && (pts[1].0 - 0.55).abs() < 1e-5);
        let p90 = Placement { rotation: 90.0, ..p };
        let pts = l.project(&p90, 1.0);
        assert!((pts[0].0 - 0.5).abs() < 1e-5);
        assert!((pts[0].1 - 0.45).abs() < 1e-5 && (pts[1].1 - 0.55).abs() < 1e-5);
    }

    #[test]
    fn keyboard_rows() {
        let k = Layout::keyboard(&[&[("Esc", 1.0), ("", 1.0), ("F1", 1.0)], &[("Tab", 1.5)]], 19.0);
        assert_eq!(k.leds.len(), 3);
        assert_eq!(k.leds[1].label.as_deref(), Some("F1"));
        assert!((k.width - 57.0).abs() < 1e-4);
    }
}

/// One device to arrange: its kind and natural size in millimetres.
#[derive(Clone, Copy, Debug)]
pub struct Item {
    pub kind: crate::device::DeviceKind,
    pub w: f32,
    pub h: f32,
}

#[derive(Clone, Copy)]
struct Zone {
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
}

/// Lay devices out in a row (or column) inside `z`, centred, at one shared
/// scale no larger than `max_scale`, so the group reads as a single unit.
fn pack(z: Zone, items: &[(usize, Item)], vertical: bool, max_scale: f32, aspect: f32, out: &mut [Placement]) {
    if items.is_empty() {
        return;
    }
    let ch = CANVAS_MM / aspect;
    // natural sizes in canvas units
    let sizes: Vec<(f32, f32)> = items.iter().map(|(_, it)| (it.w / CANVAS_MM, it.h / ch)).collect();
    let gap = 0.018;
    let (along, across) = if vertical { (z.y1 - z.y0, z.x1 - z.x0) } else { (z.x1 - z.x0, z.y1 - z.y0) };
    let total: f32 = sizes.iter().map(|s| if vertical { s.1 } else { s.0 }).sum::<f32>();
    let widest = sizes.iter().map(|s| if vertical { s.0 } else { s.1 }).fold(0.0, f32::max);
    let gaps = gap * (items.len() - 1) as f32;
    let scale = max_scale.min((along - gaps).max(0.01) / total).min(across / widest);
    let used = total * scale + gaps;
    let mut cursor = (if vertical { z.y0 } else { z.x0 }) + (along - used) / 2.0;
    for ((i, _), (w, h)) in items.iter().zip(sizes) {
        let len = if vertical { h } else { w } * scale;
        let (x, y) = if vertical { ((z.x0 + z.x1) / 2.0, cursor + len / 2.0) } else { (cursor + len / 2.0, (z.y0 + z.y1) / 2.0) };
        out[*i] = Placement { x, y, scale, rotation: 0.0, visible: true };
        cursor += len + gap;
    }
}

/// The uniform desk layout used for every rig: light bars across the top,
/// audio on the left, the desk (mat, keyboard, mouse) in the middle and the
/// PC (fans, memory, graphics, board) in a column on the right.
pub fn arrange(items: &[Item], aspect: f32) -> Vec<Placement> {
    use crate::device::DeviceKind as K;
    let mut out = vec![Placement::default(); items.len()];
    let pick = |f: &dyn Fn(K) -> bool| items.iter().copied().enumerate().filter(|(_, it)| f(it.kind)).collect::<Vec<_>>();
    let z = |x0, y0, x1, y1| Zone { x0, y0, x1, y1 };

    pack(z(0.18, 0.03, 0.76, 0.13), &pick(&|k| matches!(k, K::LedStrip | K::Light)), false, 1.0, aspect, &mut out);
    pack(z(0.01, 0.18, 0.15, 0.96), &pick(&|k| matches!(k, K::Headset | K::HeadsetStand | K::Speaker | K::Microphone | K::Controller | K::Other)), true, 1.0, aspect, &mut out);
    // the desk: mats fill it, keyboard and keypads on the left, mice on the right
    pack(z(0.17, 0.26, 0.77, 0.96), &pick(&|k| k == K::Mousepad), true, 2.2, aspect, &mut out);
    pack(z(0.20, 0.40, 0.60, 0.84), &pick(&|k| matches!(k, K::Keyboard | K::Keypad)), true, 1.15, aspect, &mut out);
    pack(z(0.62, 0.40, 0.74, 0.84), &pick(&|k| k == K::Mouse), false, 1.3, aspect, &mut out);
    // the PC column
    pack(z(0.81, 0.03, 0.99, 0.50), &pick(&|k| matches!(k, K::Fan | K::Cooler)), true, 1.0, aspect, &mut out);
    pack(z(0.81, 0.53, 0.99, 0.70), &pick(&|k| k == K::Ram), false, 2.0, aspect, &mut out);
    pack(z(0.81, 0.73, 0.99, 0.97), &pick(&|k| matches!(k, K::Gpu | K::Motherboard | K::Case)), true, 1.0, aspect, &mut out);
    out
}

#[cfg(test)]
mod arrange_tests {
    use super::*;
    use crate::device::DeviceKind as K;

    #[test]
    fn everything_lands_on_canvas_without_overlap_within_groups() {
        let items = [
            Item { kind: K::Keyboard, w: 440.0, h: 130.0 },
            Item { kind: K::Mouse, w: 68.0, h: 126.0 },
            Item { kind: K::Mousepad, w: 360.0, h: 280.0 },
            Item { kind: K::Fan, w: 120.0, h: 120.0 },
            Item { kind: K::Fan, w: 120.0, h: 120.0 },
            Item { kind: K::Fan, w: 120.0, h: 120.0 },
            Item { kind: K::Fan, w: 120.0, h: 120.0 },
            Item { kind: K::Ram, w: 8.0, h: 40.0 },
            Item { kind: K::Ram, w: 8.0, h: 40.0 },
            Item { kind: K::LedStrip, w: 600.0, h: 10.0 },
        ];
        let p = arrange(&items, 1.6);
        for (it, pl) in items.iter().zip(&p) {
            let (hw, hh) = (it.w * pl.scale / CANVAS_MM / 2.0, it.h * pl.scale / (CANVAS_MM / 1.6) / 2.0);
            assert!(pl.x - hw >= -1e-3 && pl.x + hw <= 1.0 + 1e-3, "{:?} off canvas x", it.kind);
            assert!(pl.y - hh >= -1e-3 && pl.y + hh <= 1.0 + 1e-3, "{:?} off canvas y", it.kind);
        }
        // four fans share a column: same x, increasing y, same scale
        let fans: Vec<_> = p[3..7].to_vec();
        assert!(fans.windows(2).all(|w| (w[0].x - w[1].x).abs() < 1e-5 && w[0].y < w[1].y && w[0].scale == w[1].scale));
        // keyboard left of mouse
        assert!(p[0].x < p[1].x);
    }
}

/// A display layout for `n` LEDs of a device kind whose driver gives no
/// positions (OpenRGB linear zones, USB drivers). LED order is kept, so the
/// colour sent to LED `i` still lands on the device's LED `i`; only where
/// they are drawn and sampled changes, to match the shape of the hardware.
pub fn for_kind(kind: crate::device::DeviceKind, n: usize) -> Option<Layout> {
    use crate::device::DeviceKind as K;
    let even = |i: usize, len: f32, pad: f32| pad + (len - 2.0 * pad) * (i as f32 + 0.5) / n.max(1) as f32;
    Some(match kind {
        K::Fan | K::Cooler => Layout::ring(n, 120.0),
        K::Ram => Layout { width: 8.0, height: 40.0, leds: (0..n).map(|i| Layout::led(4.0, even(i, 40.0, 1.0))).collect() },
        K::Gpu => Layout { width: 300.0, height: 40.0, leds: (0..n).map(|i| Layout::led(even(i, 300.0, 14.0), 6.0)).collect() },
        K::Mousepad => {
            // around the edge, clockwise from the top-left corner
            let (w, h) = (360.0f32, 280.0f32);
            let per = 2.0 * (w + h);
            let leds = (0..n)
                .map(|i| {
                    let d = per * (i as f32 + 0.5) / n.max(1) as f32;
                    let (x, y) = if d < w {
                        (d, 3.0)
                    } else if d < w + h {
                        (w - 3.0, d - w)
                    } else if d < 2.0 * w + h {
                        (w - (d - w - h), h - 3.0)
                    } else {
                        (3.0, h - (d - 2.0 * w - h))
                    };
                    Layout::led(x, y)
                })
                .collect();
            Layout { width: w, height: h, leds }
        }
        K::Mouse => {
            // scroll wheel and logo first, the rest down both sides
            let named = |x: f32, y: f32, l: &str, w: f32, h: f32| Led { x, y, label: Some(l.into()), w: Some(w), h: Some(h) };
            let mut leds = Vec::new();
            match n {
                0 => {}
                1 => leds.push(named(34.0, 92.0, "Logo", 20.0, 20.0)),
                _ => {
                    leds.push(named(34.0, 26.0, "Scroll", 8.0, 18.0));
                    leds.push(named(34.0, 92.0, "Logo", 20.0, 20.0));
                    let rest = n - 2;
                    let per_side = rest.div_ceil(2);
                    for i in 0..rest {
                        let (side, k) = if i < per_side { ("Left", i) } else { ("Right", i - per_side) };
                        let cnt = if side == "Left" { per_side } else { rest - per_side };
                        let y = 36.0 + 52.0 * (k as f32 + 0.5) / cnt.max(1) as f32;
                        let x = if side == "Left" { 4.0 } else { 64.0 };
                        leds.push(named(x, y, &format!("{side} {}", k + 1), 4.0, 16.0));
                    }
                }
            }
            Layout { width: 68.0, height: 126.0, leds }
        }
        K::Headset | K::HeadsetStand => {
            // split between the two cups, each on a ring
            let half = n.div_ceil(2);
            let leds = (0..n)
                .map(|i| {
                    let (cx, k, cnt) = if i < half { (18.0, i, half) } else { (162.0, i - half, n - half) };
                    let a = k as f32 / cnt.max(1) as f32 * std::f32::consts::TAU;
                    Layout::led(cx + 10.0 * a.cos(), 150.0 + 18.0 * a.sin())
                })
                .collect();
            Layout { width: 180.0, height: 190.0, leds }
        }
        K::LedStrip | K::Light => Layout::strip(n.max(1), (n as f32 * 16.0).clamp(120.0, 1000.0)),
        _ => return None,
    })
}

#[cfg(test)]
mod kind_tests {
    use super::*;
    use crate::device::DeviceKind as K;

    #[test]
    fn layouts_keep_led_count_and_stay_inside() {
        for k in [K::Fan, K::Cooler, K::Ram, K::Gpu, K::Mousepad, K::Mouse, K::Headset, K::LedStrip] {
            for n in [0usize, 1, 2, 3, 7, 24] {
                let l = for_kind(k, n).unwrap();
                assert_eq!(l.leds.len(), if k == K::LedStrip && n == 0 { 1 } else { n }, "{k:?} {n}");
                for p in &l.leds {
                    assert!(p.x >= 0.0 && p.x <= l.width && p.y >= 0.0 && p.y <= l.height, "{k:?} {n} {p:?}");
                }
            }
        }
        assert!(for_kind(K::Keyboard, 10).is_none());
    }
}
