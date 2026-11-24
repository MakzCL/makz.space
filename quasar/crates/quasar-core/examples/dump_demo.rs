//! Writes the simulated rig, the effect library and the default state as
//! JSON for the browser demo, so the web build and the engine never drift.
//!
//!     cargo run -p quasar-core --example dump_demo > src/lib/demo/seed.json

use quasar_core::backends::virtual_rig;
use quasar_core::profiles::State;
use quasar_core::Engine;

fn main() {
    let mut e = Engine::new(State::default());
    e.add_backend(Box::new(virtual_rig::VirtualRig::default()));
    e.scan();
    let out = serde_json::json!({
        "devices": e.devices(),
        "backends": e.backends(),
        "library": quasar_core::effects::library(),
        "state": e.state,
    });
    println!("{}", serde_json::to_string(&out).unwrap());
}
