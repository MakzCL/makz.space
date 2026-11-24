//! Update checks against quasar.makz.space/version.json.
//!
//! The manifest names the latest version and, per platform, the installer
//! URL and its SHA-256. Installing downloads the file, verifies it, starts
//! the installer and quits so it can replace the app.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::App;

pub const MANIFEST: &str = "https://quasar.makz.space/version.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Asset {
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub windows: Option<Asset>,
    #[serde(default)]
    pub macos: Option<Asset>,
    #[serde(default)]
    pub linux: Option<Asset>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Update {
    pub current: &'static str,
    pub latest: String,
    pub date: String,
    pub notes: Vec<String>,
    /// Whether there is an installer for this platform.
    pub installable: bool,
}

/// `1.2.3` style versions, ignoring any `-beta` suffix.
pub fn newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> { v.trim_start_matches('v').split(['-', '+']).next().unwrap_or("").split('.').map(|p| p.parse().unwrap_or(0)).collect() };
    parse(latest) > parse(current)
}

fn asset(m: &Manifest) -> Option<&Asset> {
    if cfg!(windows) {
        m.windows.as_ref()
    } else if cfg!(target_os = "macos") {
        m.macos.as_ref()
    } else {
        m.linux.as_ref()
    }
}

pub fn fetch() -> Result<Manifest, String> {
    let body = ureq::get(MANIFEST).call().map_err(|e| e.to_string())?.body_mut().read_to_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

/// Check now. Returns the update when one is newer than this build.
pub fn check(handle: &AppHandle, app: &App) -> Result<Option<Update>, String> {
    let m = fetch()?;
    let current = env!("CARGO_PKG_VERSION");
    let up = newer(&m.version, current).then(|| Update { current, latest: m.version.clone(), date: m.date.clone(), notes: m.notes.clone(), installable: asset(&m).is_some() });
    *app.update.lock() = up.as_ref().map(|_| m);
    if let Some(u) = &up {
        let _ = handle.emit("update", u.clone());
    }
    Ok(up)
}

/// Background loop: shortly after launch, then every six hours.
pub fn run(handle: AppHandle, app: App) {
    std::thread::sleep(Duration::from_secs(8));
    loop {
        if app.engine.lock().state.settings.auto_update_check {
            if let Err(e) = check(&handle, &app) {
                log::info!("update check: {e}");
            }
        }
        std::thread::sleep(Duration::from_secs(6 * 3600));
    }
}

/// Download, verify and launch the installer, then exit.
pub fn install(handle: AppHandle, app: App) {
    std::thread::spawn(move || {
        let r = (|| -> Result<(), String> {
            let m = app.update.lock().clone().ok_or("No update to install. Check again.")?;
            let a = asset(&m).ok_or("No installer for this platform yet.")?.clone();
            let name = a.url.rsplit('/').next().unwrap_or("quasar-setup.exe").to_string();
            let dest = std::env::temp_dir().join(name);
            crate::services::openrgb::download(&a.url, &a.sha256, &dest, |p| {
                let _ = handle.emit("update-progress", p);
            })?;
            app.save_now();
            crate::services::openrgb::stop(&app);
            std::process::Command::new(&dest).spawn().map_err(|e| format!("could not start the installer: {e}"))?;
            handle.exit(0);
            Ok(())
        })();
        if let Err(e) = r {
            let _ = handle.emit("update-error", e);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn version_order() {
        assert!(newer("0.1.2", "0.1.1"));
        assert!(newer("0.2.0", "0.1.9"));
        assert!(newer("1.0.0", "0.9.9"));
        assert!(!newer("0.1.1", "0.1.1"));
        assert!(!newer("0.1.0", "0.1.1"));
        assert!(!newer("0.1.1-beta", "0.1.1"));
        assert!(newer("v0.10.0", "0.9.0"));
    }
}
