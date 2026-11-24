use sysinfo::{ProcessesToUpdate, System};

use super::nap;
use crate::App;

/// Switch profiles when a linked app starts, and back when it exits.
pub fn run(app: App) {
    let mut sys = match System::new() {
        Ok(s) => s,
        Err(e) => {
            log::warn!("process watcher unavailable: {e:?}");
            return;
        }
    };
    loop {
        nap(2500);
        if !app.engine.lock().state.settings.auto_switch {
            continue;
        }
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let names: Vec<String> = sys.processes().values().map(|p| p.name().to_string_lossy().into_owned()).collect();
        let mut e = app.engine.lock();
        let target = e.state.match_app(names.iter().map(|s| s.as_str())).map(|p| p.id.clone()).unwrap_or_else(|| app.base_profile.lock().clone());
        if e.activate_profile(&target) {
            log::info!("auto-switched to profile {target}");
            drop(e);
            app.touch();
        }
    }
}
