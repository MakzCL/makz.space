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
