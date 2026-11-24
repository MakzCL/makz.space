use super::{Category, Effect, EffectInfo, FrameCtx};
use crate::canvas::Canvas;
use crate::color::{hsv, lerp3, palette, scale3};
use crate::params::{choice, color, number, Params, P};

#[derive(Default)]
pub struct Solid;
impl Solid {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "solid",
            name: "Solid",
            category: Category::Essentials,
            description: "One colour across every device.",
            params: vec![color("color", "Colour", "#7c5cff")],
        }
    }
}
impl Effect for Solid {
    fn render(&mut self, _: &FrameCtx, p: &Params, out: &mut Canvas) {
        out.fill(P(p).col("color", "#7c5cff"));
    }
}

#[derive(Default)]
pub struct Breathing;
impl Breathing {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "breathing",
            name: "Breathing",
            category: Category::Essentials,
            description: "A slow inhale and exhale between two colours.",
            params: vec![
                color("a", "Colour", "#2ee6ff"),
                color("b", "Second colour", "#000000"),
                number("speed", "Speed", 0.05, 3.0, 0.05, 0.6),
            ],
        }
    }
}
impl Effect for Breathing {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let s = 0.5 - 0.5 * (ctx.t * p.num("speed", 0.6) * std::f32::consts::TAU).cos();
        let k = s * s * (3.0 - 2.0 * s);
        out.fill(lerp3(p.col("b", "#000000"), p.col("a", "#2ee6ff"), k));
    }
}

#[derive(Default)]
pub struct Spectrum;
impl Spectrum {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "spectrum",
            name: "Spectrum Cycle",
            category: Category::Essentials,
            description: "The whole rig moves through the hue wheel together.",
            params: vec![
                number("speed", "Speed", 0.01, 1.0, 0.01, 0.08),
                number("saturation", "Saturation", 0.0, 1.0, 0.01, 1.0),
            ],
        }
    }
}
impl Effect for Spectrum {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        out.fill(hsv(ctx.t * p.num("speed", 0.08), p.num("saturation", 1.0), 1.0));
    }
}

#[derive(Default)]
pub struct RainbowWave;
impl RainbowWave {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "rainbow-wave",
            name: "Rainbow Wave",
            category: Category::Essentials,
            description: "A spectrum band sweeping across the desk at any angle.",
            params: vec![
                number("speed", "Speed", 0.0, 2.0, 0.01, 0.35),
                number("angle", "Angle", 0.0, 360.0, 1.0, 0.0),
                number("scale", "Bands", 0.2, 4.0, 0.05, 1.0),
                number("saturation", "Saturation", 0.0, 1.0, 0.01, 1.0),
                choice("shape", "Shape", &[("linear", "Linear"), ("radial", "Radial"), ("spiral", "Spiral")], "linear"),
            ],
        }
    }
}
impl Effect for RainbowWave {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let (speed, scale, sat) = (p.num("speed", 0.35), p.num("scale", 1.0), p.num("saturation", 1.0));
        let a = p.num("angle", 0.0).to_radians();
        let (ca, sa) = (a.cos(), a.sin());
        let shape = p.pick("shape", "linear").to_owned();
        let (t, asp) = (ctx.t, ctx.aspect);
        out.shade(|u, v| {
            let (x, y) = ((u - 0.5) * asp, v - 0.5);
            let d = match shape.as_str() {
                "radial" => (x * x + y * y).sqrt(),
                "spiral" => (x * x + y * y).sqrt() + y.atan2(x) / std::f32::consts::TAU,
                _ => (x * ca + y * sa) / asp,
            };
            hsv(d * scale - t * speed, sat, 1.0)
        });
    }
}

#[derive(Default)]
pub struct Gradient;
impl Gradient {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "gradient",
            name: "Gradient",
            category: Category::Essentials,
            description: "Two or three colours blended across the canvas, optionally drifting.",
            params: vec![
                color("a", "Start", "#2ee6ff"),
                color("b", "Middle", "#7c5cff"),
                color("c", "End", "#ff3db8"),
                number("angle", "Angle", 0.0, 360.0, 1.0, 20.0),
                number("drift", "Drift", 0.0, 1.0, 0.01, 0.1),
            ],
        }
    }
}
impl Effect for Gradient {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let stops = [p.col("a", "#2ee6ff"), p.col("b", "#7c5cff"), p.col("c", "#ff3db8")];
        let a = p.num("angle", 20.0).to_radians();
        let (ca, sa) = (a.cos(), a.sin());
        let drift = p.num("drift", 0.1);
        let t = ctx.t;
        out.shade(|u, v| {
            let d = (u - 0.5) * ca + (v - 0.5) * sa + 0.5;
            if drift > 0.0 {
                // ping-pong through the palette so it never seams
                let x = (d + t * drift).rem_euclid(2.0);
                palette(&stops, if x > 1.0 { 2.0 - x } else { x }, false)
            } else {
                palette(&stops, d, false)
            }
        });
    }
}

#[derive(Default)]
pub struct Comet;
impl Comet {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "comet",
            name: "Comet",
            category: Category::Essentials,
            description: "A bright head with a fading tail racing across the rig.",
            params: vec![
                color("color", "Colour", "#2ee6ff"),
                choice("mode", "Colour mode", &[("solid", "Solid"), ("rainbow", "Rainbow")], "rainbow"),
                number("speed", "Speed", 0.05, 3.0, 0.05, 0.6),
                number("tail", "Tail", 0.05, 1.0, 0.01, 0.35),
                number("count", "Comets", 1.0, 4.0, 1.0, 1.0),
            ],
        }
    }
}
impl Effect for Comet {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let (speed, tail, n) = (p.num("speed", 0.6), p.num("tail", 0.35).max(0.01), p.num("count", 1.0).max(1.0));
        let rainbow = p.pick("mode", "rainbow") == "rainbow";
        let base = p.col("color", "#2ee6ff");
        let t = ctx.t;
        out.shade(|u, v| {
            let head = (t * speed).rem_euclid(1.0);
            // distance behind the head, wrapping, repeated `n` times
            let d = ((head - u) * n).rem_euclid(1.0) / n;
            let k = if d < tail { (1.0 - d / tail).powf(2.2) } else { 0.0 };
            let c = if rainbow { hsv(u * 0.6 + t * 0.05, 0.9, 1.0) } else { base };
            let lift = 1.0 - (v - 0.5).abs() * 0.4;
            scale3(c, k * lift)
        });
    }
}
