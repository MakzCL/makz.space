use std::io::Read;

use super::nap;
use crate::App;

/// Local HTTP endpoint for Counter-Strike 2 Game State Integration.
pub fn run(app: App) {
    loop {
        let (enabled, port) = {
            let s = &app.engine.lock().state.settings;
            (s.gsi_enabled, s.gsi_port)
        };
        if !enabled {
            nap(1000);
            continue;
        }
        let server = match tiny_http::Server::http(("127.0.0.1", port)) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("game integration port {port}: {e}");
                nap(5000);
                continue;
            }
        };
        loop {
            let Ok(Some(mut req)) = server.recv_timeout(std::time::Duration::from_secs(1)) else {
                let s = &app.engine.lock().state.settings;
                if !s.gsi_enabled || s.gsi_port != port {
                    break;
                }
                continue;
            };
            let mut body = String::new();
            let _ = req.as_reader().take(1 << 20).read_to_string(&mut body);
            if req.url() == "/cs2" {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
                    app.engine.lock().game.apply_cs2(&v);
                }
            }
            let _ = req.respond(tiny_http::Response::empty(200));
        }
    }
}
