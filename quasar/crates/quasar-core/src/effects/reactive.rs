use super::{Category, Effect, EffectInfo, FrameCtx};
use crate::canvas::Canvas;
use crate::color::{hsv, lerp3, palette, saturate, scale3};
use crate::game::Bomb;
use crate::params::{choice, color, number, toggle, Params, P};

struct Wave {
    u: f32,
    v: f32,
    age: f32,
    hue: f32,
}

#[derive(Default)]
pub struct Ripple {
    waves: Vec<Wave>,
    idle: f32,
    n: u32,
}
impl Ripple {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "ripple",
            name: "Keystroke Ripple",
            category: Category::Reactive,
            description: "Every keypress sends a ring of light out across the whole setup.",
            params: vec![
                choice("mode", "Colour mode", &[("rainbow", "Rainbow"), ("solid", "Solid")], "rainbow"),
                color("color", "Colour", "#2ee6ff"),
                color("bg", "Background", "#06040f"),
                number("speed", "Speed", 0.1, 2.0, 0.05, 0.7),
                number("width", "Width", 0.02, 0.4, 0.01, 0.09),
                toggle("idle", "Ambient ripples when idle", true),
            ],
        }
    }
}
impl Effect for Ripple {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        for pr in ctx.presses {
            self.n += 1;
            self.waves.push(Wave { u: pr.u, v: pr.v, age: 0.0, hue: (self.n as f32 * 0.137).fract() });
            self.idle = 0.0;
        }
        self.idle += ctx.dt;
        if p.flag("idle", true) && self.idle > 1.6 {
            self.idle = 0.0;
            self.n += 1;
            let k = self.n as f32;
            self.waves.push(Wave { u: (k * 0.618).fract(), v: (k * 0.382 + 0.2).fract(), age: 0.0, hue: (k * 0.137).fract() });
        }
        let speed = p.num("speed", 0.7);
        for w in &mut self.waves {
            w.age += ctx.dt;
        }
        self.waves.retain(|w| w.age * speed < 1.6);
        if self.waves.len() > 48 {
            let drop = self.waves.len() - 48;
            self.waves.drain(..drop);
        }
        let (bg, col, width) = (p.col("bg", "#06040f"), p.col("color", "#2ee6ff"), p.num("width", 0.09).max(0.005));
        let rainbow = p.pick("mode", "rainbow") == "rainbow";
        let asp = ctx.aspect;
        let waves = &self.waves;
        // per wave: radius, and the squared bounds of its ring, so most
        // pixels are rejected without a square root
        let rings: Vec<(f32, f32, f32, f32)> = waves
            .iter()
            .map(|w| {
                let r = w.age * speed;
                let lo = (r - width).max(0.0);
                (r, lo * lo, (r + width) * (r + width), (1.0 - r / 1.6).max(0.0))
            })
            .collect();
        out.shade(|u, v| {
            let mut c = bg;
            for (w, &(r, lo2, hi2, fade)) in waves.iter().zip(rings.iter()) {
                let d2 = ((u - w.u) * asp).powi(2) + (v - w.v).powi(2);
                if d2 < lo2 || d2 > hi2 {
                    continue;
                }
                let d = d2.sqrt();
                let x = (d - r).abs() / width;
                if x < 1.0 {
                    let k = (1.0 - x * x) * fade;
                    let wc = if rainbow { hsv(w.hue + d * 0.4, 0.85, 1.0) } else { col };
                    for i in 0..3 {
                        c[i] += wc[i] * k;
                    }
                }
            }
            c
        });
    }
}

#[derive(Default)]
pub struct Visualizer {
    smooth: [f32; 16],
    pulse: f32,
}
impl Visualizer {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "visualizer",
            name: "Audio Visualizer",
            category: Category::Audio,
            description: "Whatever your PC is playing, drawn as light: bars, a bass pulse or a spectrum field.",
            params: vec![
                choice("style", "Style", &[("bars", "Bars"), ("pulse", "Bass pulse"), ("field", "Spectrum field")], "bars"),
                color("low", "Low", "#7c5cff"),
                color("high", "High", "#2ee6ff"),
                color("peak", "Peak", "#ff3db8"),
                number("gain", "Sensitivity", 0.2, 4.0, 0.05, 1.4),
                number("smoothing", "Smoothing", 0.0, 0.95, 0.01, 0.55),
            ],
        }
    }
}
impl Effect for Visualizer {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let (gain, sm) = (p.num("gain", 1.4), p.num("smoothing", 0.55));
        for (s, b) in self.smooth.iter_mut().zip(ctx.audio.bands.iter()) {
            let target = (b * gain).min(1.0);
            *s = if target > *s { target } else { *s * sm + target * (1.0 - sm) };
        }
        if ctx.audio.beat {
            self.pulse = 1.0;
        }
        self.pulse = (self.pulse - ctx.dt * 2.5).max(0.0);
        let pal = [p.col("low", "#7c5cff"), p.col("high", "#2ee6ff"), p.col("peak", "#ff3db8")];
        let bands = self.smooth;
        let pulse = self.pulse;
        let level = (ctx.audio.level * gain).min(1.0);
        match p.pick("style", "bars") {
            "pulse" => {
                let bass = (bands[0] + bands[1] + bands[2]) / 3.0;
                let asp = ctx.aspect;
                out.shade(|u, v| {
                    let d = (((u - 0.5) * asp).powi(2) + (v - 0.5).powi(2)).sqrt();
                    let r = 0.15 + bass * 0.9 + pulse * 0.25;
                    let k = (1.0 - d / r.max(0.01)).clamp(0.0, 1.0);
                    scale3(palette(&pal, 1.0 - k + level * 0.3, false), k.powf(0.6) * (0.25 + 0.75 * bass.max(pulse)))
                });
            }
            "field" => {
                out.shade(|u, v| {
                    let i = ((u * 16.0) as usize).min(15);
                    let e = bands[i];
                    scale3(palette(&pal, u, false), (e * (1.2 - (v - 0.5).abs() * 1.4)).clamp(0.0, 1.0))
                });
            }
            _ => {
                out.shade(|u, v| {
                    let x = u * 16.0;
                    let i = (x as usize).min(15);
                    let gap = (x.fract() - 0.5).abs() > 0.42;
                    let height = bands[i];
                    let y = 1.0 - v;
                    if gap || y > height {
                        return [0.0; 3];
                    }
                    palette(&pal, y / height.max(0.05) * height, false)
                });
            }
        }
    }
}

#[derive(Default)]
pub struct Ambience {
    last: Vec<[f32; 3]>,
}
impl Ambience {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "ambience",
            name: "Screen Ambience",
            category: Category::Screen,
            description: "Mirrors the colours on your monitor onto your desk, like bias lighting for everything.",
            params: vec![
                choice("mode", "Mode", &[("mirror", "Mirror the screen"), ("edges", "Edge glow"), ("average", "Average colour")], "mirror"),
                number("saturation", "Saturation boost", 0.5, 2.5, 0.05, 1.35),
                number("smoothing", "Smoothing", 0.0, 0.95, 0.01, 0.6),
                number("brightness", "Brightness", 0.2, 2.0, 0.05, 1.0),
            ],
        }
    }
}
impl Effect for Ambience {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let Some(scr) = ctx.screen.filter(|s| s.w > 0 && s.h > 0) else {
            // no capture yet: a gentle placeholder so devices are not dark
            let t = ctx.t;
            out.shade(|u, _| scale3(hsv(u * 0.3 + t * 0.03, 0.6, 1.0), 0.35));
            return;
        };
        let (sat, sm, gain) = (p.num("saturation", 1.35), p.num("smoothing", 0.6), p.num("brightness", 1.0));
        let avg = {
            let mut a = [0.0; 3];
            for c in &scr.px {
                for i in 0..3 {
                    a[i] += c[i];
                }
            }
            scale3(a, 1.0 / scr.px.len() as f32)
        };
        let mode = p.pick("mode", "mirror").to_owned();
        let sample = |u: f32, v: f32| {
            let x = ((u * scr.w as f32) as usize).min(scr.w - 1);
            let y = ((v * scr.h as f32) as usize).min(scr.h - 1);
            scr.px[y * scr.w + x]
        };
        if self.last.len() != out.px.len() {
            self.last = vec![[0.0; 3]; out.px.len()];
        }
        let (w, h) = (out.w, out.h);
        for y in 0..h {
            let v = (y as f32 + 0.5) / h as f32;
            for x in 0..w {
                let u = (x as f32 + 0.5) / w as f32;
                let target = match mode.as_str() {
                    "average" => avg,
                    "edges" => {
                        // project to the nearest screen edge
                        let (du, dv) = ((u - 0.5).abs(), (v - 0.5).abs());
                        if du > dv { sample(if u < 0.5 { 0.0 } else { 0.999 }, v) } else { sample(u, if v < 0.5 { 0.0 } else { 0.999 }) }
                    }
                    _ => sample(u, v),
                };
                let target = scale3(saturate(target, sat), gain);
                let i = y * w + x;
                self.last[i] = lerp3(target, self.last[i], sm);
                out.px[i] = self.last[i];
            }
        }
    }
}

#[derive(Default)]
pub struct GamePulse;
impl GamePulse {
    pub fn info() -> EffectInfo {
        EffectInfo {
            id: "game-pulse",
            name: "Game Pulse",
            category: Category::Game,
            description: "Health as a bar of light, a red flash when you take damage, white-out when flashed and a ticking bomb. Works with Counter-Strike 2.",
            params: vec![
                color("ct", "Team colour (CT)", "#2e8bff"),
                color("t", "Team colour (T)", "#ffb547"),
                color("idle", "No game running", "#7c5cff"),
                toggle("health_bar", "Health bar", true),
            ],
        }
    }
}
impl Effect for GamePulse {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas) {
        let p = P(p);
        let g = ctx.game;
        if !g.active {
            let k = 0.55 + 0.45 * (ctx.t * 1.2).sin();
            out.fill(scale3(p.col("idle", "#7c5cff"), 0.3 + 0.4 * k));
            return;
        }
        let team = if g.team == "T" { p.col("t", "#ffb547") } else { p.col("ct", "#2e8bff") };
        let health_bar = p.flag("health_bar", true);
        let hit = (1.0 - g.since_hit / 0.5).clamp(0.0, 1.0);
        let kill = (1.0 - g.since_kill / 0.6).clamp(0.0, 1.0);
        let bomb = match g.bomb {
            Bomb::Planted => 0.5 + 0.5 * (ctx.t * 9.0).sin(),
            Bomb::Exploded => 1.0,
            _ => 0.0,
        };
        let low = g.health < 0.25 && g.health > 0.0;
        let heartbeat = if low { 0.5 + 0.5 * (ctx.t * 7.0).sin() } else { 0.0 };
        let (health, flashed, burning, t) = (g.health, g.flashed, g.burning, ctx.t);
        out.shade(|u, v| {
            let mut c = scale3(team, 0.35);
            if health_bar {
                let lit = u <= health;
                let hc = lerp3([1.0, 0.1, 0.1], [0.2, 1.0, 0.4], health);
                if v > 0.82 {
                    c = if lit { hc } else { [0.05, 0.0, 0.0] };
                }
            }
            if burning {
                let f = crate::noise::fbm(u * 6.0, v * 3.0 + t * 3.0, 3, 9);
                c = lerp3(c, [1.0, 0.35, 0.0], f * (1.0 - v * 0.5));
            }
            c = lerp3(c, [1.0, 0.0, 0.0], heartbeat * 0.6);
            c = lerp3(c, [1.0, 0.0, 0.05], hit);
            c = lerp3(c, [1.0, 0.85, 0.2], bomb * 0.8);
            c = lerp3(c, [1.0, 1.0, 1.0], kill * 0.5 * (1.0 - v));
            lerp3(c, [1.0, 1.0, 1.0], flashed)
        });
    }
}
