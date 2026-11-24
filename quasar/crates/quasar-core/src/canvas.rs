use serde::{Deserialize, Serialize};

use crate::color::Rgb;

/// How a layer is combined with what is below it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Blend {
    #[default]
    Normal,
    Add,
    Screen,
    Multiply,
    Lighten,
    Mask,
}

/// The lighting canvas: a float RGB raster covering the whole desk.
///
/// Every device is placed somewhere on it and its LEDs sample the pixels
/// under them, so one effect flows naturally across keyboard, mouse, fans
/// and strips. Coordinates handed to effects are normalised: `u` 0..1 left
/// to right, `v` 0..1 top to bottom.
#[derive(Clone, Debug)]
pub struct Canvas {
    pub w: usize,
    pub h: usize,
    pub px: Vec<[f32; 3]>,
}

impl Canvas {
    /// 128x80 is ~4 px per key across a full keyboard: more than any LED
    /// needs, and cheap enough to keep the engine well under a millisecond.
    pub const DEFAULT_W: usize = 128;
    pub const DEFAULT_H: usize = 80;

    pub fn new(w: usize, h: usize) -> Self {
        Self { w, h, px: vec![[0.0; 3]; w * h] }
    }

    pub fn aspect(&self) -> f32 {
        self.w as f32 / self.h as f32
    }

    pub fn fill(&mut self, c: [f32; 3]) {
        self.px.fill(c);
    }

    #[inline]
    pub fn get(&self, x: usize, y: usize) -> [f32; 3] {
        self.px[y * self.w + x]
    }

    #[inline]
    pub fn set(&mut self, x: usize, y: usize, c: [f32; 3]) {
        let i = y * self.w + x;
        self.px[i] = c;
    }

    /// Run `f(u, v)` for every pixel centre and store the result.
    pub fn shade(&mut self, mut f: impl FnMut(f32, f32) -> [f32; 3]) {
        let (iw, ih) = (1.0 / self.w as f32, 1.0 / self.h as f32);
        for y in 0..self.h {
            let v = (y as f32 + 0.5) * ih;
            let row = &mut self.px[y * self.w..(y + 1) * self.w];
            for (x, p) in row.iter_mut().enumerate() {
                *p = f((x as f32 + 0.5) * iw, v);
            }
        }
    }

    /// Like `shade`, but evaluates `f` on a half-resolution lattice and
    /// interpolates. For smooth fields (noise, plasma) it looks the same and
    /// costs a quarter.
    pub fn shade_half(&mut self, mut f: impl FnMut(f32, f32) -> [f32; 3]) {
        let (lw, lh) = (self.w / 2 + 1, self.h / 2 + 1);
        let mut lat = Vec::with_capacity(lw * lh);
        for ly in 0..lh {
            let v = (ly as f32 * 2.0 + 0.5) / self.h as f32;
            for lx in 0..lw {
                lat.push(f((lx as f32 * 2.0 + 0.5) / self.w as f32, v));
            }
        }
        for y in 0..self.h {
            let (ly, fy) = (y / 2, if y % 2 == 1 { 0.5 } else { 0.0 });
            let ly1 = (ly + 1).min(lh - 1);
            for x in 0..self.w {
                let (lx, fx) = (x / 2, if x % 2 == 1 { 0.5 } else { 0.0 });
                let lx1 = (lx + 1).min(lw - 1);
                let (a, b) = (lat[ly * lw + lx], lat[ly * lw + lx1]);
                let (c, d) = (lat[ly1 * lw + lx], lat[ly1 * lw + lx1]);
                let mut o = [0.0; 3];
                for i in 0..3 {
                    let top = a[i] + (b[i] - a[i]) * fx;
                    let bot = c[i] + (d[i] - c[i]) * fx;
                    o[i] = top + (bot - top) * fy;
                }
                self.px[y * self.w + x] = o;
            }
        }
    }

    /// Bilinear sample at normalised coordinates, clamped to the edge.
    pub fn sample(&self, u: f32, v: f32) -> [f32; 3] {
        let x = (u * self.w as f32 - 0.5).clamp(0.0, (self.w - 1) as f32);
        let y = (v * self.h as f32 - 0.5).clamp(0.0, (self.h - 1) as f32);
        let (x0, y0) = (x.floor() as usize, y.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(self.w - 1), (y0 + 1).min(self.h - 1));
        let (fx, fy) = (x - x0 as f32, y - y0 as f32);
        let a = self.get(x0, y0);
        let b = self.get(x1, y0);
        let c = self.get(x0, y1);
        let d = self.get(x1, y1);
        let mut o = [0.0; 3];
        for i in 0..3 {
            let top = a[i] + (b[i] - a[i]) * fx;
            let bot = c[i] + (d[i] - c[i]) * fx;
            o[i] = top + (bot - top) * fy;
        }
        o
    }

    /// Composite `top` onto `self`.
    pub fn composite(&mut self, top: &Canvas, blend: Blend, opacity: f32) {
        debug_assert_eq!(self.px.len(), top.px.len());
        let k = opacity.clamp(0.0, 1.0);
        for (d, s) in self.px.iter_mut().zip(top.px.iter()) {
            for i in 0..3 {
                let (a, b) = (d[i], s[i]);
                let mixed = match blend {
                    Blend::Normal => b,
                    Blend::Add => a + b,
                    Blend::Screen => 1.0 - (1.0 - a) * (1.0 - b),
                    Blend::Multiply => a * b,
                    Blend::Lighten => a.max(b),
                    Blend::Mask => {
                        let l = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
                        a * l
                    }
                };
                d[i] = a + (mixed - a) * k;
            }
        }
    }

    /// Box-downsample to an 8-bit RGB buffer for previews.
    pub fn to_rgb8(&self, ow: usize, oh: usize, gain: f32) -> Vec<u8> {
        let mut out = Vec::with_capacity(ow * oh * 3);
        for oy in 0..oh {
            let (y0, y1) = (oy * self.h / oh, ((oy + 1) * self.h / oh).max(oy * self.h / oh + 1));
            for ox in 0..ow {
                let (x0, x1) = (ox * self.w / ow, ((ox + 1) * self.w / ow).max(ox * self.w / ow + 1));
                let mut acc = [0.0f32; 3];
                for y in y0..y1 {
                    for x in x0..x1 {
                        let p = self.get(x, y);
                        acc[0] += p[0];
                        acc[1] += p[1];
                        acc[2] += p[2];
                    }
                }
                let n = ((y1 - y0) * (x1 - x0)) as f32;
                let c = Rgb::from_f([acc[0] / n * gain, acc[1] / n * gain, acc[2] / n * gain]);
                out.extend_from_slice(&[c.r, c.g, c.b]);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_interpolates() {
        let mut c = Canvas::new(2, 1);
        c.set(0, 0, [0.0; 3]);
        c.set(1, 0, [1.0; 3]);
        assert_eq!(c.sample(0.0, 0.5), [0.0; 3]);
        assert_eq!(c.sample(1.0, 0.5), [1.0; 3]);
        let mid = c.sample(0.5, 0.5)[0];
        assert!((mid - 0.5).abs() < 1e-5);
    }

    #[test]
    fn composite_modes() {
        let mut a = Canvas::new(1, 1);
        a.fill([0.5; 3]);
        let mut b = Canvas::new(1, 1);
        b.fill([0.5; 3]);
        let mut add = a.clone();
        add.composite(&b, Blend::Add, 1.0);
        assert_eq!(add.px[0], [1.0; 3]);
        let mut mul = a.clone();
        mul.composite(&b, Blend::Multiply, 1.0);
        assert_eq!(mul.px[0], [0.25; 3]);
        let mut half = a.clone();
        let mut white = Canvas::new(1, 1);
        white.fill([1.0; 3]);
        half.composite(&white, Blend::Normal, 0.5);
        assert_eq!(half.px[0], [0.75; 3]);
    }

    #[test]
    fn shade_half_matches_linear_fields() {
        // a linear field is reproduced exactly by bilinear interpolation
        let mut a = Canvas::new(16, 10);
        let mut b = Canvas::new(16, 10);
        let f = |u: f32, v: f32| [u, v, 0.5 * u + 0.25 * v];
        a.shade(f);
        b.shade_half(f);
        for (p, q) in a.px.iter().zip(b.px.iter()) {
            for i in 0..3 {
                assert!((p[i] - q[i]).abs() < 1e-4, "{p:?} vs {q:?}");
            }
        }
    }

    #[test]
    fn downsample_averages() {
        let mut c = Canvas::new(4, 2);
        c.shade(|u, _| if u < 0.5 { [0.0; 3] } else { [1.0; 3] });
        assert_eq!(c.to_rgb8(2, 1, 1.0), vec![0, 0, 0, 255, 255, 255]);
    }
}
