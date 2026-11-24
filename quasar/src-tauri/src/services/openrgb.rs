//! Built-in OpenRGB.
//!
//! OpenRGB (GPL-2.0, openrgb.org) reaches hundreds of devices QUASAR's own
//! drivers do not. Rather than asking people to install and start it by
//! hand, QUASAR can fetch the official release into its own data folder,
//! verify it, and run it headless (`--server`) for as long as QUASAR runs.
//! If an OpenRGB server is already listening, QUASAR simply uses it.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::App;

/// Pinned official build. Updating it means changing all three lines.
pub const VERSION: &str = "1.1";
const URL: &str = "https://codeberg.org/OpenRGB/OpenRGB/releases/download/release_1.1/OpenRGB_1.1_Windows_64_8e16de2.zip";
const SHA256: &str = "63291726c6fc84eb479ef2ee752e97e1187f6ce9c49fd27eee40ded588a8172a";
const SIZE_MB: u32 = 22;

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    #[default]
    Unknown,
    /// No OpenRGB found; can be installed (Windows only).
    NotInstalled,
    Downloading,
    Installing,
    Starting,
    /// Running as our child process.
    Running,
    /// Someone else's OpenRGB server is answering on the port.
    External,
    Stopped,
    Error,
    /// Not on this OS: install OpenRGB yourself.
    Unsupported,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct Status {
    pub phase: Phase,
    /// 0..1 while downloading.
    pub progress: f32,
    pub message: Option<String>,
    pub path: Option<String>,
    pub version: &'static str,
    pub size_mb: u32,
}

pub fn root(handle: &AppHandle) -> PathBuf {
    handle.path().app_local_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("openrgb")
}

/// Our managed copy, a system install, or something on PATH.
pub fn find(handle: &AppHandle) -> Option<PathBuf> {
    let mut c = vec![root(handle).join("OpenRGB Windows 64-bit").join("OpenRGB.exe")];
    if cfg!(windows) {
        for base in ["C:\\Program Files\\OpenRGB", "C:\\Program Files (x86)\\OpenRGB"] {
            c.push(Path::new(base).join("OpenRGB.exe"));
        }
    } else {
        for base in ["/usr/bin", "/usr/local/bin", "/Applications/OpenRGB.app/Contents/MacOS"] {
            c.push(Path::new(base).join(if base.contains("MacOS") { "OpenRGB" } else { "openrgb" }));
        }
    }
    c.into_iter().find(|p| p.is_file())
}

fn listening(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}").parse::<SocketAddr>().unwrap_or(([127, 0, 0, 1], port).into());
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn set(handle: &AppHandle, app: &App, f: impl FnOnce(&mut Status)) {
    let s = {
        let mut st = app.openrgb.lock();
        f(&mut st);
        st.version = VERSION;
        st.size_mb = SIZE_MB;
        st.clone()
    };
    let _ = handle.emit("openrgb", s);
}

/// Called once at launch: start OpenRGB if we manage it and nothing is
/// already serving.
pub fn boot(handle: AppHandle, app: App) {
    let (managed, host, port) = {
        let s = &app.engine.lock().state.settings;
        (s.openrgb_managed && s.openrgb_enabled, s.openrgb_host.clone(), s.openrgb_port)
    };
    if listening(&host, port) {
        set(&handle, &app, |s| s.phase = Phase::External);
        return;
    }
    match find(&handle) {
        Some(p) if managed => {
            if let Err(e) = start(&handle, &app, &p) {
                set(&handle, &app, |s| {
                    s.phase = Phase::Error;
                    s.message = Some(e);
                });
            }
        }
        Some(p) => set(&handle, &app, |s| {
            s.phase = Phase::Stopped;
            s.path = Some(p.display().to_string());
        }),
        None => set(&handle, &app, |s| s.phase = if cfg!(windows) { Phase::NotInstalled } else { Phase::Unsupported }),
    }
}

pub fn start(handle: &AppHandle, app: &App, exe: &Path) -> Result<(), String> {
    let port = app.engine.lock().state.settings.openrgb_port;
    if listening("127.0.0.1", port) {
        set(handle, app, |s| s.phase = Phase::External);
        return Ok(());
    }
    set(handle, app, |s| {
        s.phase = Phase::Starting;
        s.path = Some(exe.display().to_string());
        s.message = None;
    });
    let mut cmd = Command::new(exe);
    cmd.args(["--server", "--server-port", &port.to_string(), "--noautoconnect"]);
    if exe.starts_with(root(handle)) {
        // keep our copy's config beside it, not in the user's profile
        cmd.arg("--localconfig");
    }
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let child: Child = cmd.spawn().map_err(|e| format!("could not start OpenRGB: {e}"))?;
    *app.openrgb_child.lock() = Some(child);
    // device detection takes a few seconds; rescan once the server answers
    let (handle, app) = (handle.clone(), app.clone());
    std::thread::spawn(move || {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(45) {
            if listening("127.0.0.1", port) {
                // give detection a moment to finish before listing controllers
                std::thread::sleep(Duration::from_secs(3));
                crate::configure_backends(&mut app.engine.lock());
                app.touch();
                set(&handle, &app, |s| s.phase = Phase::Running);
                let _ = handle.emit("devices-changed", ());
                return;
            }
            if let Some(Ok(Some(code))) = app.openrgb_child.lock().as_mut().map(|c| c.try_wait()) {
                set(&handle, &app, |s| {
                    s.phase = Phase::Error;
                    s.message = Some(format!("OpenRGB exited ({code})"));
                });
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        set(&handle, &app, |s| {
            s.phase = Phase::Error;
            s.message = Some("OpenRGB did not open its server in time".into());
        });
    });
    Ok(())
}

pub fn stop(app: &App) {
    if let Some(mut c) = app.openrgb_child.lock().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// Download, verify and unpack the pinned release, then start it.
pub fn install(handle: AppHandle, app: App) {
    std::thread::spawn(move || {
        let r = (|| -> Result<PathBuf, String> {
            set(&handle, &app, |s| {
                s.phase = Phase::Downloading;
                s.progress = 0.0;
                s.message = None;
            });
            let dir = root(&handle);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let zip_path = dir.join("openrgb.zip");
            download(URL, SHA256, &zip_path, |p| set(&handle, &app, |s| s.progress = p))?;
            set(&handle, &app, |s| s.phase = Phase::Installing);
            let f = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
            let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
            z.extract(&dir).map_err(|e| format!("unpacking OpenRGB: {e}"))?;
            let _ = std::fs::remove_file(&zip_path);
            find(&handle).ok_or_else(|| "OpenRGB.exe missing after unpacking".to_string())
        })();
        match r {
            Ok(exe) => {
                if let Err(e) = start(&handle, &app, &exe) {
                    set(&handle, &app, |s| {
                        s.phase = Phase::Error;
                        s.message = Some(e);
                    });
                }
            }
            Err(e) => set(&handle, &app, |s| {
                s.phase = Phase::Error;
                s.message = Some(e);
            }),
        }
    });
}

/// Stream `url` to `dest`, reporting progress, and refuse it unless its
/// SHA-256 matches.
pub fn download(url: &str, sha256: &str, dest: &Path, mut progress: impl FnMut(f32)) -> Result<(), String> {
    let mut resp = ureq::get(url).call().map_err(|e| format!("download failed: {e}"))?;
    let total: u64 = resp.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
    let tmp = dest.with_extension("part");
    let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut reader = resp.body_mut().as_reader();
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let (mut got, mut last) = (0u64, Instant::now());
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        if total > 0 && last.elapsed() > Duration::from_millis(150) {
            last = Instant::now();
            progress(got as f32 / total as f32);
        }
    }
    drop(out);
    let hash: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if !hash.eq_ignore_ascii_case(sha256) {
        let _ = std::fs::remove_file(&tmp);
        return Err("the download did not match its checksum and was discarded".into());
    }
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    progress(1.0);
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Fetches the real 22 MB release: `cargo test -p quasar -- --ignored`.
    #[test]
    #[ignore]
    fn pinned_release_downloads_verifies_and_unpacks() {
        let dir = std::env::temp_dir().join("quasar-openrgb-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("o.zip");
        super::download(super::URL, super::SHA256, &zip_path, |_| {}).unwrap();
        let mut z = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        z.extract(&dir).unwrap();
        assert!(dir.join("OpenRGB Windows 64-bit").join("OpenRGB.exe").is_file());
        // a wrong checksum is refused and leaves nothing behind
        let bad = dir.join("bad.zip");
        assert!(super::download(super::URL, &"0".repeat(64), &bad, |_| {}).is_err());
        assert!(!bad.exists() && !bad.with_extension("part").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
