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
    /// The QuasarOpenRGB Windows service is serving.
    Service,
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
    /// State of the QuasarOpenRGB Windows service, when installed.
    pub service: Option<String>,
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
        st.service = service::state();
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
    if let Some(state) = service::state() {
        if state != "running" {
            service::start();
        }
        wait_and_scan(handle, app, port, Phase::Service);
        return;
    }
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
    cmd.args(["--server", "--server-port", &port.to_string(), "--noautoconnect", "--verbose"]);
    // keep OpenRGB's own log for diagnostics
    if let Ok(f) = std::fs::create_dir_all(root(handle)).and_then(|_| std::fs::File::create(log_path(handle))) {
        if let Ok(f2) = f.try_clone() {
            cmd.stdout(f).stderr(f2);
        }
    }
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
                // list what is there now; the frame loop rescans each time
                // OpenRGB reports more devices as its detection continues
                std::thread::sleep(Duration::from_millis(500));
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

/// Wait for a server on `port`, then rescan and report `phase`.
fn wait_and_scan(handle: AppHandle, app: App, port: u16, phase: Phase) {
    set(&handle, &app, |s| {
        s.phase = Phase::Starting;
        s.message = None;
    });
    std::thread::spawn(move || {
        let t = Instant::now();
        while t.elapsed() < Duration::from_secs(60) {
            if listening("127.0.0.1", port) {
                std::thread::sleep(Duration::from_millis(500));
                crate::configure_backends(&mut app.engine.lock());
                app.touch();
                set(&handle, &app, |s| s.phase = phase);
                let _ = handle.emit("devices-changed", ());
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        set(&handle, &app, |s| {
            s.phase = Phase::Error;
            s.message = Some("The OpenRGB service did not open its server. Check it in Windows Services (QuasarOpenRGB).".into());
        });
    });
}

/// The QuasarOpenRGB Windows service: OpenRGB 1.1 runs as a service natively
/// (startup/main_Windows.cpp: server mode, config in `service_config` beside
/// the exe), as LocalSystem, so PawnIO can reach RAM without elevating the app.
pub mod service {
    use super::*;

    #[cfg_attr(not(windows), allow(dead_code))]
    pub const NAME: &str = "QuasarOpenRGB";

    /// Where the service's copy lives. Must be admin-only: a LocalSystem
    /// service run from a user-writable folder is a privilege escalation.
    pub fn dir() -> PathBuf {
        PathBuf::from(std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into())).join("QUASAR OpenRGB")
    }

    #[cfg(windows)]
    fn hidden(cmd: &mut Command) -> &mut Command {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000)
    }

    /// `running`, `stopped`, ... or None when not installed (or not Windows).
    pub fn state() -> Option<String> {
        #[cfg(windows)]
        {
            let out = hidden(&mut Command::new("sc.exe")).args(["query", NAME]).output().ok()?;
            if !out.status.success() {
                return None;
            }
            let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
            for s in ["running", "stopped", "start_pending", "stop_pending"] {
                if text.contains(s) {
                    return Some(s.replace('_', "-"));
                }
            }
            return Some("unknown".into());
        }
        #[allow(unreachable_code)]
        None
    }

    /// Start it; allowed without elevation by the ACL set at install.
    pub fn start() {
        #[cfg(windows)]
        let _ = hidden(&mut Command::new("sc.exe")).args(["start", NAME]).status();
    }

    /// Newest log file the service wrote.
    pub fn log() -> Option<PathBuf> {
        let dir = dir().join("service_config").join("logs");
        std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok()).map(|e| e.path())
    }

    /// Run a PowerShell script elevated (one UAC prompt) and wait for it.
    /// The script travels as -EncodedCommand, never as a file: a script on
    /// disk could be swapped between writing it and the elevated run. Only
    /// its "ok"/error text comes back through a file.
    #[cfg(windows)]
    fn run_elevated(script: &str) -> Result<(), String> {
        let result = std::env::temp_dir().join("quasar-openrgb-service.txt");
        let _ = std::fs::remove_file(&result);
        let q = |p: &Path| p.display().to_string().replace('\'', "''");
        let body = format!(
            "$ErrorActionPreference = 'Stop'\ntry {{\n{script}\n  'ok' | Set-Content -Path '{r}'\n}} catch {{ $_.Exception.Message | Set-Content -Path '{r}' }}\n",
            r = q(&result)
        );
        let utf16: Vec<u8> = body.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let encoded = quasar_core::b64::encode(&utf16);
        let launcher = format!(
            "Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','{encoded}'"
        );
        let st = hidden(&mut Command::new("powershell")).args(["-NoProfile", "-Command", &launcher]).status().map_err(|e| e.to_string())?;
        match std::fs::read_to_string(&result) {
            Ok(s) if s.trim() == "ok" => Ok(()),
            Ok(s) => Err(s.trim().to_string()),
            Err(_) if !st.success() => Err("Windows did not grant administrator rights.".into()),
            Err(_) => Err("The setup was cancelled.".into()),
        }
    }

    /// Register and start the service. The elevated step fetches the
    /// pinned OpenRGB release itself and checks its SHA-256, so nothing
    /// from a user-writable folder ever becomes a LocalSystem service.
    pub fn install(handle: &AppHandle, app: &App) -> Result<(), String> {
        #[cfg(windows)]
        {
            stop(app); // free the port
            let q = |p: &Path| p.display().to_string().replace('\'', "''");
            let dst = dir();
            let exe = dst.join("OpenRGB.exe");
            let script = format!(
                r#"  if (Get-Service -Name {NAME} -ErrorAction SilentlyContinue) {{ Stop-Service -Name {NAME} -Force -ErrorAction SilentlyContinue; sc.exe delete {NAME} | Out-Null; Start-Sleep -Seconds 1 }}
  $dst = '{dst}'
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  $zip = Join-Path $dst 'openrgb.zip'
  $tmp = Join-Path $dst 'unpack'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri '{URL}' -OutFile $zip -UseBasicParsing
  if ((Get-FileHash -Path $zip -Algorithm SHA256).Hash -ne '{SHA256}') {{ Remove-Item $zip -Force; throw 'The OpenRGB download did not match its checksum.' }}
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  Copy-Item -Path (Join-Path $tmp 'OpenRGB Windows 64-bit\*') -Destination $dst -Recurse -Force
  Remove-Item $tmp, $zip -Recurse -Force
  New-Service -Name {NAME} -BinaryPathName '"{exe}"' -DisplayName 'QUASAR OpenRGB' -Description 'OpenRGB SDK server for QUASAR, with access to RAM and motherboard lighting.' -StartupType Automatic | Out-Null
  sc.exe sdset {NAME} 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPWPLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)' | Out-Null
  Start-Service -Name {NAME}"#,
                dst = q(&dst),
                exe = q(&exe),
            );
            run_elevated(&script)?;
            let port = app.engine.lock().state.settings.openrgb_port;
            wait_and_scan(handle.clone(), app.clone(), port, Phase::Service);
            return Ok(());
        }
        #[allow(unreachable_code)]
        {
            let _ = (handle, app);
            Err("The OpenRGB service is for Windows.".into())
        }
    }

    /// Stop and delete the service and its folder; QUASAR goes back to
    /// running OpenRGB itself.
    pub fn remove(handle: &AppHandle, app: &App) -> Result<(), String> {
        #[cfg(windows)]
        {
            let q = |p: &Path| p.display().to_string().replace('\'', "''");
            let script = format!(
                "  Stop-Service -Name {NAME} -Force -ErrorAction SilentlyContinue\n  sc.exe delete {NAME} | Out-Null\n  Start-Sleep -Seconds 1\n  Remove-Item -Path '{}' -Recurse -Force -ErrorAction SilentlyContinue",
                q(&dir())
            );
            run_elevated(&script)?;
            let (h, a) = (handle.clone(), app.clone());
            std::thread::spawn(move || boot(h, a));
            return Ok(());
        }
        #[allow(unreachable_code)]
        {
            let _ = (handle, app);
            Err("The OpenRGB service is for Windows.".into())
        }
    }
}

pub fn log_path(handle: &AppHandle) -> PathBuf {
    root(handle).join("openrgb.log")
}

/// The last `n` lines of the managed server's log.
pub fn log_tail(handle: &AppHandle, n: usize) -> Vec<String> {
    let path = if service::state().is_some() { service::log().unwrap_or_else(|| log_path(handle)) } else { log_path(handle) };
    let text = std::fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let lines: Vec<String> = text.lines().map(|l| l.trim_end().to_string()).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].to_vec()
}

/// Open OpenRGB's own window as a client of the server QUASAR talks to, so
/// a person can check a device in OpenRGB directly.
pub fn open_gui(handle: &AppHandle, app: &App) -> Result<(), String> {
    let svc = service::dir().join("OpenRGB.exe");
    let exe = find(handle).or_else(|| svc.is_file().then_some(svc)).ok_or("OpenRGB is not installed.")?;
    let port = app.engine.lock().state.settings.openrgb_port;
    let cfg = root(handle).join("gui-config");
    let _ = std::fs::create_dir_all(&cfg);
    let mut cmd = Command::new(&exe);
    cmd.arg("--client").arg(format!("127.0.0.1:{port}")).args(["--nodetect", "--gui", "--config"]).arg(&cfg);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not open OpenRGB: {e}"))
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

/// Why RAM and some motherboard lighting (SMBus) may be missing, read from
/// OpenRGB's own log lines (i2c_smbus_pawnio.cpp in OpenRGB 1.1).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Smbus {
    Unknown,
    Ok,
    /// OpenRGB is not elevated: PawnIO refuses it.
    NeedsAdmin,
    /// The PawnIO driver is not installed.
    PawnioMissing,
}

pub fn smbus_status(handle: &AppHandle) -> Smbus {
    let log = log_tail(handle, 2000).join("\n");
    if log.contains("Permission Denied, PawnIO initialization aborted") {
        Smbus::NeedsAdmin
    } else if log.contains("Could not open PawnIO") {
        Smbus::PawnioMissing
    } else if log.contains("PawnIO SMBus") || log.contains("Start PawnIO") {
        Smbus::Ok
    } else {
        Smbus::Unknown
    }
}

/// Other OpenRGB processes than ours: two instances fight over the same
/// USB and I2C devices, and devices go missing or ignore colours.
pub fn other_instances(app: &App) -> usize {
    let ours = app.openrgb_child.lock().as_ref().map(|c| c.id());
    let Ok(mut sys) = sysinfo::System::new() else { return 0 };
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let n = sys
        .processes()
        .iter()
        .filter(|(pid, p)| p.name().to_string_lossy().eq_ignore_ascii_case("OpenRGB.exe") && Some(pid.as_u32()) != ours)
        .count();
    // the service's own OpenRGB is expected
    n.saturating_sub(usize::from(service::state().as_deref() == Some("running")))
}

/// Whether this process runs as administrator (Windows only).
pub fn elevated() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `net session` only succeeds for administrators
        return Command::new("net").arg("session").creation_flags(0x0800_0000).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
    }
    #[allow(unreachable_code)]
    false
}

/// Relaunch QUASAR elevated (one UAC prompt), then quit this instance so
/// the new one can take over OpenRGB and the single-instance lock.
pub fn relaunch_elevated(handle: &AppHandle, app: &App) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let script = format!("Start-Sleep -Milliseconds 1500; Start-Process -FilePath '{}' -Verb RunAs", exe.display().to_string().replace('\'', "''"));
        Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("could not ask for administrator rights: {e}"))?;
        app.save_now();
        stop(app);
        handle.exit(0);
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = (handle, app);
        Err("Only needed on Windows.".into())
    }
}
