//! The effect library.
//!
//! An effect paints the whole canvas each frame. Effects are small, stateful
//! and parameterised by a schema the UI turns into controls, in the spirit of
//! a shader: `u`/`v` in, colour out, with a little memory where it helps
//! (ripples, particles, fire).

mod ambient;
mod basic;
mod reactive;

use serde::Serialize;

use crate::canvas::Canvas;
use crate::game::GameState;
use crate::params::{ParamSpec, Params};

/// Audio analysis for the current frame, filled by the shell's capture thread.
#[derive(Clone, Debug, Default, Serialize)]
pub struct AudioFrame {
    /// 16 log-spaced bands, 0..1, low to high.
    pub bands: [f32; 16],
    /// Overall level 0..1.
    pub level: f32,
    /// True on the frame a bass onset was detected.
    pub beat: bool,
}

/// A downscaled screen grab for ambience.
#[derive(Clone, Debug, Default)]
pub struct ScreenFrame {
    pub w: usize,
    pub h: usize,
    pub px: Vec<[f32; 3]>,
}

/// A key or button press, already mapped to canvas coordinates.
#[derive(Clone, Copy, Debug)]
pub struct Press {
    pub u: f32,
    pub v: f32,
}

pub struct FrameCtx<'a> {
    /// Seconds since the engine started.
    pub t: f32,
    pub dt: f32,
    pub aspect: f32,
    pub audio: &'a AudioFrame,
    pub screen: Option<&'a ScreenFrame>,
    /// Presses since the previous frame.
    pub presses: &'a [Press],
    pub game: &'a GameState,
}

pub trait Effect: Send {
    fn render(&mut self, ctx: &FrameCtx, p: &Params, out: &mut Canvas);
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    Essentials,
    Ambient,
    Reactive,
    Audio,
    Screen,
    Game,
}

#[derive(Clone, Debug, Serialize)]
pub struct EffectInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub category: Category,
    pub description: &'static str,
    pub params: Vec<ParamSpec>,
}

struct Entry {
    info: fn() -> EffectInfo,
    make: fn() -> Box<dyn Effect>,
}

macro_rules! entries {
    ($($m:ident :: $t:ident),* $(,)?) => {
        &[$(Entry { info: $m::$t::info, make: || Box::new($m::$t::default()) }),*]
    };
}

const REGISTRY: &[Entry] = entries![
    basic::Solid,
    basic::Breathing,
    basic::Spectrum,
    basic::RainbowWave,
    basic::Gradient,
    basic::Comet,
    ambient::Plasma,
    ambient::Aurora,
    ambient::Fire,
    ambient::Starfield,
    ambient::DigitalRain,
    ambient::Nebula,
    reactive::Ripple,
    reactive::Visualizer,
    reactive::Ambience,
    reactive::GamePulse,
];

pub fn library() -> Vec<EffectInfo> {
    REGISTRY.iter().map(|e| (e.info)()).collect()
}

pub fn info(id: &str) -> Option<EffectInfo> {
    REGISTRY.iter().map(|e| (e.info)()).find(|i| i.id == id)
}

pub fn create(id: &str) -> Option<Box<dyn Effect>> {
    REGISTRY.iter().find(|e| (e.info)().id == id).map(|e| (e.make)())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::defaults;

    #[test]
    fn every_effect_renders_finite_pixels() {
        let audio = AudioFrame { bands: [0.6; 16], level: 0.7, beat: true };
        let screen = ScreenFrame { w: 4, h: 2, px: vec![[0.2, 0.4, 0.9]; 8] };
        let game = GameState { active: true, health: 0.5, ..Default::default() };
        let presses = [Press { u: 0.3, v: 0.4 }];
        let ids: Vec<_> = library().iter().map(|i| i.id).collect();
        assert!(ids.len() >= 16);
        let mut uniq = ids.clone();
        uniq.dedup();
        assert_eq!(uniq.len(), ids.len(), "effect ids are unique");
        for info in library() {
            let mut fx = create(info.id).unwrap();
            let params = defaults(&info.params);
            let mut c = Canvas::new(48, 30);
            for f in 0..30 {
                let ctx = FrameCtx {
                    t: f as f32 / 30.0,
                    dt: 1.0 / 30.0,
                    aspect: c.aspect(),
                    audio: &audio,
                    screen: Some(&screen),
                    presses: if f == 3 { &presses } else { &[] },
                    game: &game,
                };
                fx.render(&ctx, &params, &mut c);
            }
            assert!(c.px.iter().all(|p| p.iter().all(|v| v.is_finite())), "{} produced NaN", info.id);
            let lit = c.px.iter().any(|p| p.iter().any(|v| *v > 0.01));
            assert!(lit, "{} painted nothing", info.id);
        }
    }
}
