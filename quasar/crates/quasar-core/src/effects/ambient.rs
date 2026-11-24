use super::{Category, Effect, EffectInfo, FrameCtx};
use crate::canvas::Canvas;
use crate::color::{hsv, lerp3, palette, scale3};
use crate::noise::{fbm, hash, Rng};
use crate::params::{choice, color, number, Params, P};

fn named_palette(name: &str) -> Vec<[f32; 3]> {
    let hex = |s: &str| crate::color::Rgb::from_hex(s).unwrap_or_default().to_f();
    let list: &[&str] = match name {
        "ocean" => &["#001a33", "#0066cc", "#2ee6ff", "#b3fff9"],
        "lava" => &["#1a0000", "#b30000", "#ff5a00", "#ffd000"],
        "synth" => &["#12002e", "#7c5cff", "#ff3db8", "#2ee6ff"],
        "forest" => &["#001a0d", "#00733a", "#7bd389", "#e6ff99"],
        "mono" => &["#000000", "#ffffff"],
        _ => &["#2ee6ff", "#7c5cff", "#ff3db8", "#ffb547"], // quasar
    };
    list.iter().map(|s| hex(s)).collect()
}

const PALETTES: &[(&str, &str)] =
    &[("quasar", "Quasar"), ("synth", "Synthwave"), ("ocean", "Ocean"), ("lava", "Lava"), ("forest", "Forest"), ("mono", "Mono")];

#[derive(Default)]
pub struct Plasma;
impl Plasma {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "plasma",
            name: "Plasma",
            category: Category::Ambient,
            description: "Interfering sine fields, the classic demoscene glow.",
            params: vec![
                choice("palette", "Palette", PALETTES, "quasar"),
                number("speed", "Speed", 0.0, 2.0, 0.01, 0.4),
                number("scale", "Scale", 0.5, 6.0, 0.1, 2.2),
            ],
        }
    }
}
impl Effect for Plasma {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let pal = named_palette(p.pick("palette", "quasar"));
        let (t, s, asp) = (ctx.t * p.num("speed", 0.4), p.num("scale", 2.2), ctx.aspect);
        out.shade_half(|u, v| {
            let (x, y) = (u * asp * s, v * s);
            let a = (x + t).sin() + (y * 1.3 - t * 0.7).sin() + ((x + y + t) * 0.7).sin();
            let r = ((x - asp * s * 0.5).powi(2) + (y - s * 0.5).powi(2)).sqrt();
            let b = (r * 1.6 - t * 1.3).sin();
            palette(&pal, (a + b) * 0.125 + 0.5, true)
        });
    }
}

#[derive(Default)]
pub struct Aurora;
impl Aurora {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "aurora",
            name: "Aurora",
            category: Category::Ambient,
            description: "Soft curtains of light folding over a night sky.",
            params: vec![
                color("a", "Lower", "#00ffa3"),
                color("b", "Upper", "#7c5cff"),
                color("sky", "Sky", "#020214"),
                number("speed", "Speed", 0.0, 2.0, 0.01, 0.3),
            ],
        }
    }
}
impl Effect for Aurora {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let (a, b, sky) = (p.col("a", "#00ffa3"), p.col("b", "#7c5cff"), p.col("sky", "#020214"));
        let (t, asp) = (ctx.t * p.num("speed", 0.3), ctx.aspect);
        out.shade_half(|u, v| {
            let x = u * asp;
            let n = fbm(x * 1.4 + t * 0.6, t * 0.25, 4, 7);
            let center = 0.35 + (n - 0.5) * 0.9;
            let band = (-(v - center).powi(2) * 18.0).exp();
            let shimmer = 0.6 + 0.4 * fbm(x * 9.0, v * 3.0 - t * 2.0, 2, 3);
            let c = lerp3(a, b, (center - v + 0.5).clamp(0.0, 1.0));
            let k = band * shimmer;
            lerp3(sky, c, k.clamp(0.0, 1.0))
        });
    }
}

pub struct Fire {
    heat: Vec<f32>,
    w: usize,
    h: usize,
    rng: Rng,
}
impl Default for Fire {
    fn default() -> Self {
        Self { heat: Vec::new(), w: 0, h: 0, rng: Rng::new(0xF12E) }
    }
}
impl Fire {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "fire",
            name: "Fire",
            category: Category::Ambient,
            description: "Flames rising from the bottom edge of the desk.",
            params: vec![
                choice("palette", "Palette", &[("lava", "Classic"), ("synth", "Plasma"), ("ocean", "Ghost")], "lava"),
                number("intensity", "Intensity", 0.1, 1.0, 0.01, 0.75),
                number("cooling", "Height", 0.0, 1.0, 0.01, 0.5),
            ],
        }
    }
}
impl Effect for Fire {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        // run the simulation at quarter resolution; it is blurry by nature
        let (w, h) = ((out.w / 4).max(4), (out.h / 4).max(4));
        if self.w != w || self.h != h {
            self.heat = vec![0.0; w * h];
            self.w = w;
            self.h = h;
        }
        let intensity = p.num("intensity", 0.75);
        let cooling = 0.02 + (1.0 - p.num("cooling", 0.5)) * 0.12;
        let steps = ((ctx.dt * 40.0).round() as usize).clamp(1, 4);
        for _ in 0..steps {
            for x in 0..w {
                let r = self.rng.f();
                self.heat[(h - 1) * w + x] = if r < intensity { 0.75 + r * 0.25 } else { r * 0.3 };
            }
            for y in 0..h - 1 {
                for x in 0..w {
                    let below = (y + 1) * w;
                    let l = self.heat[below + x.saturating_sub(1)];
                    let c = self.heat[below + x];
                    let r = self.heat[below + (x + 1).min(w - 1)];
                    let b2 = self.heat[((y + 2).min(h - 1)) * w + x];
                    let v = (l + c + r + b2) * 0.25 - cooling * self.rng.f();
                    self.heat[y * w + x] = v.max(0.0);
                }
            }
        }
        let pal = {
            let mut v = vec![[0.0; 3]];
            v.extend(named_palette(p.pick("palette", "lava")).into_iter().skip(1));
            v
        };
        let (fw, fh) = (w as f32, h as f32);
        let heat = &self.heat;
        out.shade(|u, v| {
            let x = (u * fw - 0.5).clamp(0.0, fw - 1.0);
            let y = (v * fh - 0.5).clamp(0.0, fh - 1.0);
            let (x0, y0) = (x as usize, y as usize);
            let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
            let (fx, fy) = (x - x0 as f32, y - y0 as f32);
            let top = heat[y0 * w + x0] * (1.0 - fx) + heat[y0 * w + x1] * fx;
            let bot = heat[y1 * w + x0] * (1.0 - fx) + heat[y1 * w + x1] * fx;
            palette(&pal, (top * (1.0 - fy) + bot * fy).clamp(0.0, 1.0), false)
        });
    }
}

#[derive(Clone)]
struct Star {
    u: f32,
    v: f32,
    age: f32,
    life: f32,
    hue: f32,
}

pub struct Starfield {
    stars: Vec<Star>,
    rng: Rng,
}
impl Default for Starfield {
    fn default() -> Self {
        Self { stars: Vec::new(), rng: Rng::new(0x57A2) }
    }
}
impl Starfield {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "starfield",
            name: "Starfield",
            category: Category::Ambient,
            description: "Points of light twinkling in and out over a dark field.",
            params: vec![
                color("color", "Star colour", "#ffffff"),
                color("bg", "Background", "#05030f"),
                choice("mode", "Colour mode", &[("solid", "Solid"), ("rainbow", "Rainbow")], "solid"),
                number("density", "Density", 0.05, 1.0, 0.01, 0.35),
                number("size", "Size", 0.01, 0.12, 0.005, 0.04),
            ],
        }
    }
}
impl Effect for Starfield {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let target = (p.num("density", 0.35) * 120.0) as usize;
        while self.stars.len() < target {
            let r = &mut self.rng;
            self.stars.push(Star { u: r.f(), v: r.f(), age: -r.f() * 2.0, life: 0.8 + r.f() * 2.2, hue: r.f() });
        }
        self.stars.truncate(target);
        for s in &mut self.stars {
            s.age += ctx.dt;
            if s.age > s.life {
                *s = Star { u: self.rng.f(), v: self.rng.f(), age: 0.0, life: 0.8 + self.rng.f() * 2.2, hue: self.rng.f() };
            }
        }
        let (bg, col) = (p.col("bg", "#05030f"), p.col("color", "#ffffff"));
        let rainbow = p.pick("mode", "solid") == "rainbow";
        let size = p.num("size", 0.04);
        out.fill(bg);
        stamp_points(out, ctx.aspect, size, self.stars.iter().filter(|s| s.age > 0.0).map(|s| {
            let k = (s.age / s.life * std::f32::consts::PI).sin();
            let c = if rainbow { hsv(s.hue, 0.8, 1.0) } else { col };
            (s.u, s.v, scale3(c, k))
        }));
    }
}

/// Additively splat soft round points onto the canvas.
pub(crate) fn stamp_points(out: &mut Canvas, aspect: f32, radius: f32, pts: impl Iterator<Item = (f32, f32, [f32; 3])>) {
    let (w, h) = (out.w as f32, out.h as f32);
    let rx = (radius / aspect * w).max(1.0);
    let ry = (radius * h).max(1.0);
    for (u, v, c) in pts {
        let (cx, cy) = (u * w, v * h);
        let (x0, x1) = ((cx - rx).floor().max(0.0) as usize, ((cx + rx).ceil() as usize).min(out.w));
        let (y0, y1) = ((cy - ry).floor().max(0.0) as usize, ((cy + ry).ceil() as usize).min(out.h));
        for y in y0..y1 {
            for x in x0..x1 {
                let dx = (x as f32 + 0.5 - cx) / rx;
                let dy = (y as f32 + 0.5 - cy) / ry;
                let d2 = dx * dx + dy * dy;
                if d2 < 1.0 {
                    let k = (1.0 - d2).powi(2);
                    let i = y * out.w + x;
                    for (o, cv) in out.px[i].iter_mut().zip(c) {
                        *o = (*o + cv * k).min(1.5);
                    }
                }
            }
        }
    }
}

#[derive(Default)]
pub struct DigitalRain {
    t: f32,
}
impl DigitalRain {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "digital-rain",
            name: "Digital Rain",
            category: Category::Ambient,
            description: "Falling streams of code with bright leading glyphs.",
            params: vec![
                color("color", "Colour", "#2eff8c"),
                number("speed", "Speed", 0.1, 3.0, 0.05, 1.0),
                number("columns", "Columns", 8.0, 64.0, 1.0, 28.0),
            ],
        }
    }
}
impl Effect for DigitalRain {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        self.t += ctx.dt * p.num("speed", 1.0);
        let cols = p.num("columns", 28.0).max(1.0);
        let col = p.col("color", "#2eff8c");
        let t = self.t;
        out.shade(|u, v| {
            let ci = (u * cols).floor() as i32;
            let speed = 0.25 + hash(ci, 0, 11) * 0.6;
            let offset = hash(ci, 1, 11) * 10.0;
            let head = (t * speed + offset).rem_euclid(1.6) - 0.3;
            let d = head - v;
            if !(0.0..=0.55).contains(&d) {
                return [0.0; 3];
            }
            let k = (1.0 - d / 0.55).powf(1.8);
            if d < 0.025 {
                lerp3(col, [1.0; 3], 0.7)
            } else {
                scale3(col, k * (0.6 + 0.4 * hash(ci, (v * 40.0) as i32, (t * 8.0) as u32)))
            }
        });
    }
}

#[derive(Default)]
pub struct Nebula;
impl Nebula {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "nebula",
            name: "Nebula",
            category: Category::Ambient,
            description: "Slow-drifting clouds of colour. QUASAR's signature scene.",
            params: vec![
                choice("palette", "Palette", PALETTES, "synth"),
                number("speed", "Speed", 0.0, 1.0, 0.01, 0.12),
                number("detail", "Detail", 1.0, 6.0, 1.0, 4.0),
                number("brightness", "Glow", 0.2, 1.5, 0.01, 1.0),
            ],
        }
    }
}
impl Effect for Nebula {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let pal = named_palette(p.pick("palette", "synth"));
        let (t, oct, glow, asp) = (ctx.t * p.num("speed", 0.12), p.num("detail", 4.0) as u32, p.num("brightness", 1.0), ctx.aspect);
        out.shade_half(|u, v| {
            let (x, y) = (u * asp * 1.6, v * 1.6);
            let q = fbm(x + t, y - t * 0.5, oct, 1);
            let r = fbm(x + q * 1.8 - t * 0.3, y + q * 1.2, oct, 2);
            let c = palette(&pal, r * 1.4 + t * 0.2, true);
            scale3(c, (0.25 + r * r * 1.4) * glow)
        });
    }
}
