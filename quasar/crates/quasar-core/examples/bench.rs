//! Frame-time benchmark for the default scene on the demo rig.
//!
//!     cargo run --release -p quasar-core --example bench

use std::time::Instant;

use quasar_core::backends::virtual_rig::VirtualRig;
use quasar_core::profiles::State;
use quasar_core::Engine;

fn main() {
    let mut e = Engine::new(State::demo());
    e.add_backend(Box::new(VirtualRig::default()));
    e.scan();
    for id in ["default", "fps", "focus", "movie"] {
        e.activate_profile(id);
        for _ in 0..60 {
            e.tick(1.0 / 60.0);
        }
        let n = 600;
        let t = Instant::now();
        for i in 0..n {
            if i % 10 == 0 {
                e.press_key(&["W"]);
            }
            e.tick(1.0 / 60.0);
        }
        let ms = t.elapsed().as_secs_f64() * 1000.0 / n as f64;
        let scene: Vec<_> = e.state.profile().scene.layers.iter().map(|l| l.effect.clone()).collect();
        println!("{id:8} {:28} {ms:.3} ms/frame ({} LEDs)", scene.join(" + "), e.stats().leds);
    }
}
