//! QUASAR core engine.
//!
//! Everything that is not UI and not OS glue lives here: the device model,
//! the lighting canvas and its effects, spatial sampling of LEDs, the vendor
//! protocol drivers, profiles and macros. The Tauri shell owns threads and IPC;
//! this crate owns the logic, so it is testable without a window or hardware.

pub mod audio;
pub mod b64;
pub mod remap;
pub mod backends;
pub mod canvas;
pub mod color;
pub mod device;
pub mod effects;
pub mod engine;
pub mod error;
pub mod game;
pub mod layout;
pub mod macros;
pub mod noise;
pub mod params;
pub mod profiles;

pub use canvas::Canvas;
pub use color::Rgb;
pub use engine::Engine;
pub use error::{Error, Result};
