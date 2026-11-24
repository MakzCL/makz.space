//! Per-effect render cost at the engine's canvas size.
//!
//!     cargo run --release -p quasar-core --example fxbench

use std::time::Instant;

use quasar_core::effects::{self, AudioFrame, FrameCtx, Press, ScreenFrame};
use quasar_core::game::GameState;
use quasar_core::params::defaults;
use quasar_core::Canvas;

fn main() {
    let audio = AudioFrame { bands: [0.5; 16], level: 0.5, beat: false };
    let screen = ScreenFrame { w: 64, h: 36, px: vec![[0.3, 0.5, 0.8]; 64 * 36] };
    let game = GameState { active: true, health: 0.6, ..Default::default() };
    let mut total = 0.0;
    for info in effects::library() {
        let mut fx = effects::create(info.id).unwrap();
        let p = defaults(&info.params);
        let mut c = Canvas::new(Canvas::DEFAULT_W, Canvas::DEFAULT_H);
        let n = 300;
        let t = Instant::now();
        for i in 0..n {
            let presses = [Press { u: 0.5, v: 0.5 }];
            let ctx = FrameCtx { t: i as f32 / 60.0, dt: 1.0 / 60.0, aspect: c.aspect(), audio: &audio, screen: Some(&screen), presses: if i % 6 == 0 { &presses } else { &[] }, game: &game };
            fx.render(&ctx, &p, &mut c);
        }
        let ms = t.elapsed().as_secs_f64() * 1000.0 / n as f64;
        total += ms;
        println!("{:16} {ms:.3} ms", info.id);
    }
    println!("canvas {}x{}, sum {total:.2} ms", Canvas::DEFAULT_W, Canvas::DEFAULT_H);
}
